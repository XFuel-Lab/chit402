/**
 * Stable ES256 bytes for export-coverage claims.
 *
 * ECDSA is non-deterministic. Signing the same coverage claims on every
 * GET /receipt/:id mints a new JWS and spends the issuer key. This cache
 * returns the signature already stored for those exact claims and the
 * current kid/header/public key.
 *
 * The lookup key is SHA-256 of the JCS (RFC 8785) form of every signed
 * claim field, the JWS header (alg, typ, kid, jku), and the issuer public
 * key. A new row, cap, epoch, scope, subject, kid, or key misses.
 *
 * Disk matches the issuer-JWS fix: the signature is written immediately
 * (atomic tmp + rename) and reused after a restart. Memory is an LRU in
 * front of that directory. Both are bounded. A file is served only after
 * the canonical bytes match and the JWS verifies under the current key.
 * Request fields are never a cache key or a filename.
 */
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { verifyJws } from './issuer-key.js';
import { jcsCanonicalize } from './offer-receipt.js';

const CACHE_SCHEMA = 'chit402.coverage_signature_cache.v1';
const DEFAULT_MAX = 256;
const DIGEST_RE = /^[0-9a-f]{64}$/;

/** @type {Map<string, object>} digest → record, oldest first */
const memory = new Map();
const stats = { signed: 0, hits: 0 };
let storeSeq = 0;

function cacheMax() {
  const n = Number(process.env.COVERAGE_SIG_CACHE_MAX);
  if (Number.isInteger(n) && n >= 1 && n <= 10_000) return n;
  return DEFAULT_MAX;
}

/**
 * Directory for durable coverage signatures, or null for memory only.
 * `COVERAGE_SIG_DIR` overrides. Otherwise persistence follows the task
 * store: off when `TASK_STORE_PERSIST=false`, else a sibling of
 * `TASK_STORE_DIR` (default `services/gateway/.data/coverage-signatures`).
 */
export function coverageSignatureDir() {
  const explicit = process.env.COVERAGE_SIG_DIR;
  if (explicit === 'false' || explicit === '') return null;
  if (explicit && explicit !== 'true') return explicit;
  if (process.env.TASK_STORE_PERSIST === 'false') return null;
  const taskDir = process.env.TASK_STORE_DIR;
  if (taskDir) return path.join(path.dirname(taskDir), 'coverage-signatures');
  return path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '.data', 'coverage-signatures');
}

function publicKeyBinding(jwk) {
  return {
    crv: jwk?.crv || null,
    kid: jwk?.kid || null,
    kty: jwk?.kty || null,
    x: jwk?.x || null,
    y: jwk?.y || null,
  };
}

/**
 * SHA-256 hex of the JCS document that binds claims, header, and key.
 * @param {object} claims
 * @param {{ header: object, publicJwk: object }} material
 */
export function coverageSignatureDigest(claims, { header, publicJwk }) {
  const canonical = jcsCanonicalize({
    claims,
    header,
    issuer_public_key: publicKeyBinding(publicJwk),
  });
  const digest = crypto.createHash('sha256').update(canonical).digest('hex');
  return { canonical, digest };
}

function headerMatches(got, expected) {
  if (!got || typeof got !== 'object') return false;
  if (got.alg !== expected.alg || got.kid !== expected.kid) return false;
  if ((got.typ ?? null) !== (expected.typ ?? null)) return false;
  if ((got.jku ?? null) !== (expected.jku ?? null)) return false;
  return true;
}

function signatureAcceptable(record, digest, canonical, claims, header, publicJwk) {
  if (!record || record.schema !== CACHE_SCHEMA) return false;
  if (record.digest !== digest || !DIGEST_RE.test(digest)) return false;
  if (typeof record.canonical !== 'string' || record.canonical !== canonical) return false;
  if (crypto.createHash('sha256').update(record.canonical).digest('hex') !== digest) return false;
  const sig = record.issuer_signature;
  if (!sig || typeof sig.jws !== 'string' || sig.kid !== header.kid) return false;
  const storedKey = sig.issuer_jwk;
  if (!storedKey || storedKey.x !== publicJwk.x || storedKey.y !== publicJwk.y || storedKey.kid !== publicJwk.kid) {
    return false;
  }
  const verified = verifyJws(sig.jws, publicJwk);
  if (!verified.valid) return false;
  if (!headerMatches(verified.header, header)) return false;
  if (jcsCanonicalize(verified.payload) !== jcsCanonicalize(claims)) return false;
  return true;
}

function remember(digest, record) {
  if (memory.has(digest)) memory.delete(digest);
  memory.set(digest, record);
  while (memory.size > cacheMax()) {
    const oldest = memory.keys().next().value;
    memory.delete(oldest);
  }
}

function fileFor(dir, digest) {
  if (!DIGEST_RE.test(digest)) return null;
  return path.join(dir, `${digest}.json`);
}

function readDisk(digest) {
  const dir = coverageSignatureDir();
  if (!dir) return null;
  const target = fileFor(dir, digest);
  if (!target) return null;
  try {
    return JSON.parse(fs.readFileSync(target, 'utf8'));
  } catch {
    return null;
  }
}

function evictDisk(dir, keepDigest) {
  let names;
  try {
    names = fs.readdirSync(dir);
  } catch {
    return;
  }
  const files = names.filter((name) => /^[0-9a-f]{64}\.json$/.test(name));
  if (files.length <= cacheMax()) return;
  const ranked = files.map((name) => {
    const full = path.join(dir, name);
    let storedAt = 0;
    try {
      const parsed = JSON.parse(fs.readFileSync(full, 'utf8'));
      storedAt = Number(parsed?.stored_at) || 0;
    } catch {
      // Unreadable files sort first and are the ones eviction drops.
    }
    return { name, full, storedAt };
  }).sort((a, b) => a.storedAt - b.storedAt || (a.name < b.name ? -1 : 1));
  let extra = files.length - cacheMax();
  for (const file of ranked) {
    if (extra <= 0) break;
    if (file.name === `${keepDigest}.json`) continue;
    try { fs.unlinkSync(file.full); extra -= 1; } catch { /* next */ }
  }
}

function writeDisk(digest, record) {
  const dir = coverageSignatureDir();
  if (!dir) return;
  const target = fileFor(dir, digest);
  if (!target) return;
  try {
    fs.mkdirSync(dir, { recursive: true });
    const tmp = `${target}.tmp-${process.pid}`;
    fs.writeFileSync(tmp, JSON.stringify(record));
    fs.renameSync(tmp, target);
    evictDisk(dir, digest);
  } catch {
    // Memory still holds the signature for this process. The next restart
    // signs once if the file never landed.
  }
}

function cloneSignature(sig) {
  return {
    ...sig,
    issuer_jwk: sig.issuer_jwk ? { ...sig.issuer_jwk } : sig.issuer_jwk,
  };
}

/**
 * Stored signature for these claims and the current header/key, or null.
 * A hit is returned only when the stored JWS verifies against that key.
 */
export function loadStableCoverageSignature(claims, { header, publicJwk }) {
  const { canonical, digest } = coverageSignatureDigest(claims, { header, publicJwk });
  const cached = memory.get(digest) || readDisk(digest);
  if (!signatureAcceptable(cached, digest, canonical, claims, header, publicJwk)) return null;
  remember(digest, cached);
  stats.hits += 1;
  return cloneSignature(cached.issuer_signature);
}

/**
 * Remember a signature this process just minted. Does not accept a
 * caller-supplied JWS: `sign` is invoked here.
 * @param {object} claims
 * @param {{ header: object, publicJwk: object, sign: () => object }} opts
 */
export function takeStableCoverageSignature(claims, { header, publicJwk, sign }) {
  const hit = loadStableCoverageSignature(claims, { header, publicJwk });
  if (hit) return hit;
  const issuerSignature = sign();
  stats.signed += 1;
  if (!issuerSignature?.jws) return issuerSignature;
  const verified = verifyJws(issuerSignature.jws, publicJwk);
  if (!verified.valid || !headerMatches(verified.header, header)) return issuerSignature;
  if (jcsCanonicalize(verified.payload) !== jcsCanonicalize(claims)) return issuerSignature;
  const { canonical, digest } = coverageSignatureDigest(claims, { header, publicJwk });
  const record = {
    schema: CACHE_SCHEMA,
    digest,
    canonical,
    stored_at: ++storeSeq,
    issuer_signature: cloneSignature(issuerSignature),
  };
  remember(digest, record);
  writeDisk(digest, record);
  return cloneSignature(issuerSignature);
}

export function coverageSignatureStats() {
  return { signed: stats.signed, hits: stats.hits };
}

export function resetCoverageSignatureStats() {
  stats.signed = 0;
  stats.hits = 0;
}

/** Drop the in-memory pin. Disk files stay, so the next read is a restart. */
export function clearCoverageSignatureMemory() {
  memory.clear();
}

/** Drop memory and delete digest files in the current directory. */
export function clearCoverageSignatureCache() {
  memory.clear();
  resetCoverageSignatureStats();
  const dir = coverageSignatureDir();
  if (!dir) return;
  let names;
  try { names = fs.readdirSync(dir); } catch { return; }
  for (const name of names) {
    if (!/^[0-9a-f]{64}\.json$/.test(name) && !/\.tmp-/.test(name)) continue;
    try { fs.unlinkSync(path.join(dir, name)); } catch { /* gone */ }
  }
}
