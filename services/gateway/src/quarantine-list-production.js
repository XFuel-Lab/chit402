/**
 * Production signer for quarantine list v1. Host only, run by hand.
 *
 * scripts/sign-quarantine-list.mjs builds the list and signs only with a stub
 * or test key; its guard (quarantineSignGuard) refuses the production key and
 * stays as it is. This module is the separate host step that signs v1 with
 * the production issuer key. It shares no allow switch with that script.
 *
 * - The key is the gateway's own issuer signer (initIssuerSigner: env
 *   ISSUER_PRIVATE_KEY or KMS). This module never reads, prints, logs or
 *   writes key material; it only calls signer.sign().
 * - Input is the unsigned v1 document the dry run printed. Its sha256 is
 *   shown first, and --apply needs that hash and the confirm word.
 * - The input must be byte-identical to the list rebuilt here from the log.
 * - The signer's public key must be one of PRODUCTION_ISSUER_PUBLIC_KEYS, by
 *   decoded x/y bytes, and its kid the thumbprint of that key.
 * - After signing, the JWS is verified against that allowlisted key's x/y
 *   bytes (not the key the signer reports) before anything is written. A
 *   mismatch is refused as signer_mismatch.
 * - Dry run by default. v1 is written once, atomically (temp file, fsync,
 *   link, which fails if v1 exists). An existing v1 is left alone; if it
 *   already holds this exact list under a valid production signature the
 *   run is a no-op.
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { jcsRfc8785 } from './offer-receipt.js';
import { computeJwkThumbprint, ephemeralIssuerKid, jwsSigningInput } from './issuer-key.js';
import { PRODUCTION_ISSUER_PUBLIC_KEYS, isProductionProcess } from './production-process.js';
import {
  QUARANTINE_LIST_SCHEMA,
  QUARANTINE_LIST_TYP,
  buildQuarantineList,
  quarantineListClaims,
  quarantineListDir,
  quarantineListVersions,
  verifyQuarantineList,
} from './quarantine-list.js';

/** The word --confirm must carry for --apply. */
export const PRODUCTION_SIGN_CONFIRM = 'SIGN-QUARANTINE-LIST-V1-WITH-PRODUCTION-KEY';

const HEX64 = /^[0-9a-f]{64}$/;

export class ProductionListRefused extends Error {
  constructor(reason, message) {
    super(message || reason);
    this.code = 'quarantine_production_sign_refused';
    this.reason = reason;
  }
}

function refuse(reason, message) {
  throw new ProductionListRefused(reason, message);
}

function sha256Hex(buf) {
  return crypto.createHash('sha256').update(buf).digest('hex');
}

/** Strict 32-byte coordinate from base64url, or null. */
function coord(v) {
  if (typeof v !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(v)) return null;
  const b = Buffer.from(v, 'base64url');
  if (b.length !== 32 || b.toString('base64url') !== v) return null;
  return b;
}

/** Allowlist as decoded points, with the thumbprint kid of each. */
function decodedKeys(keys) {
  if (!Array.isArray(keys) || keys.length === 0) refuse('no_production_keys');
  return keys.map((k) => {
    const x = coord(k?.x);
    const y = coord(k?.y);
    if (!x || !y || (k.crv != null && k.crv !== 'P-256')) refuse('no_production_keys', 'production key list is malformed');
    const jwk = { kty: 'EC', crv: 'P-256', x: x.toString('base64url'), y: y.toString('base64url') };
    return { x, y, jwk, kid: computeJwkThumbprint(jwk) };
  });
}

function hasAccessor(obj, name) {
  for (let o = obj; o && typeof o === 'object'; o = Object.getPrototypeOf(o)) {
    const d = Object.getOwnPropertyDescriptor(o, name);
    if (d) return Boolean(d.get || d.set);
  }
  return false;
}

/** Each signer property read once. A getter or setter anywhere is refused. */
function snapshot(signer) {
  if (!signer || typeof signer !== 'object') refuse('no_signer');
  if (['kind', 'kid', 'publicJwk', 'sign'].some((n) => hasAccessor(signer, n))) refuse('signer_accessor');
  const kind = signer.kind;
  const kid = signer.kid;
  const pub = signer.publicJwk;
  const sign = signer.sign;
  if (!pub || typeof pub !== 'object') refuse('no_public_key');
  if (hasAccessor(pub, 'x') || hasAccessor(pub, 'y')) refuse('signer_accessor');
  const x = pub.x;
  const y = pub.y;
  if (typeof sign !== 'function') refuse('issuer_sign_invalid');
  return {
    kind: kind == null ? null : String(kind),
    kid: kid == null ? null : String(kid),
    x: coord(x),
    y: coord(y),
    sign: (input) => sign.call(signer, input),
  };
}

/** The allowlisted key the signer reports, matched on decoded x/y bytes. */
function matchProductionKey(snap, keys) {
  if (!snap.x || !snap.y) refuse('no_public_key');
  const match = keys.find((k) => k.x.equals(snap.x) && k.y.equals(snap.y));
  if (!match) refuse('not_production_key');
  if (snap.kid !== match.kid) refuse('kid_mismatch');
  return match;
}

/**
 * Input file bytes: canonical JCS of an unsigned v1 list, optionally followed
 * by exactly one newline (what the dry run's stdout holds).
 */
export function parseUnsignedV1(fileBytes) {
  const text = Buffer.isBuffer(fileBytes) ? fileBytes.toString('utf8') : String(fileBytes);
  const canonical = text.endsWith('\n') ? text.slice(0, -1) : text;
  let doc;
  try {
    doc = JSON.parse(canonical);
  } catch {
    refuse('list_not_canonical', 'input is not JSON');
  }
  if (!doc || typeof doc !== 'object' || Array.isArray(doc) || jcsRfc8785(doc) !== canonical) {
    refuse('list_not_canonical', 'input is not RFC 8785 canonical bytes');
  }
  if (doc.schema !== QUARANTINE_LIST_SCHEMA || doc.version !== 1 || doc.seq !== 1 || doc.prev_list_hash !== null
    || 'issuer_signature' in doc) {
    refuse('list_not_unsigned_v1', 'input is not an unsigned version 1 list');
  }
  // Same bytes as a fresh build of its own entries and high water.
  let rebuilt;
  try {
    rebuilt = buildQuarantineList({ entries: doc.entries, highWater: doc.high_water, prevBytes: null });
  } catch (err) {
    refuse('list_not_unsigned_v1', `input does not build: ${err?.code || 'invalid'}`);
  }
  if (jcsRfc8785(rebuilt) !== canonical) refuse('list_not_unsigned_v1', 'input is not a clean build of its own entries');
  return { doc, canonical };
}

function unsignedBodyOf(signedBytes) {
  try {
    const doc = JSON.parse(signedBytes);
    if (!doc || typeof doc !== 'object') return null;
    const { issuer_signature: _sig, ...rest } = doc;
    return jcsRfc8785(rest);
  } catch {
    return null;
  }
}

function jwksOf(keys) {
  return { keys: keys.map((k) => ({ ...k.jwk, kid: k.kid, alg: 'ES256', use: 'sig' })) };
}

/**
 * State of <dir>: 'empty', or 'same' when v1 already holds this exact list
 * under a valid signature by an allowlisted key. Anything else is refused.
 */
export function existingV1State(dir, canonical, keys) {
  const versions = quarantineListVersions(dir);
  if (versions.length === 0) return 'empty';
  if (versions.length !== 1 || versions[0] !== 1) refuse('later_version_exists', 'a version other than v1 exists; this tool signs v1 only');
  const bytes = fs.readFileSync(path.join(dir, 'v1.json'), 'utf8');
  if (unsignedBodyOf(bytes) !== canonical) refuse('v1_exists_different', 'v1 exists with a different list; it is never overwritten');
  const verdict = verifyQuarantineList(bytes, jwksOf(keys));
  if (!verdict.ok) refuse('v1_exists_different', `v1 exists and does not verify under the production key (${verdict.reason})`);
  return 'same';
}

/**
 * Sign the unsigned v1 document with the active issuer signer, then verify
 * against the allowlisted key's bytes. Writes nothing. The signer is read
 * once (snapshot) for the key match, the sign call and the verify.
 * @returns {Promise<string>} stored bytes
 */
export async function signProductionV1(doc, signer, productionKeys = PRODUCTION_ISSUER_PUBLIC_KEYS) {
  return signWithSnapshot(doc, snapshot(signer), decodedKeys(productionKeys));
}

async function signWithSnapshot(doc, snap, keys) {
  const match = matchProductionKey(snap, keys);
  const signingInput = jwsSigningInput(quarantineListClaims(doc), { typ: QUARANTINE_LIST_TYP, kid: match.kid });
  const message = Buffer.from(signingInput, 'utf8');
  const signature = await snap.sign(message);
  if (!Buffer.isBuffer(signature) || signature.length !== 64) refuse('issuer_sign_invalid');
  const key = crypto.createPublicKey({ key: match.jwk, format: 'jwk' });
  if (!crypto.verify('sha256', message, { key, dsaEncoding: 'ieee-p1363' }, signature)) refuse('signer_mismatch');
  const jws = `${signingInput}.${signature.toString('base64url')}`;
  const bytes = jcsRfc8785({
    ...doc,
    issuer_signature: { alg: 'ES256', typ: QUARANTINE_LIST_TYP, kid: match.kid, jws },
  });
  const verdict = verifyQuarantineList(bytes, jwksOf([match]));
  // Whole-document check, as a verifier reads it (canonical bytes, entries, claims).
  if (!verdict.ok) refuse('verify_failed', `signed list does not verify (${verdict.reason})`);
  return bytes;
}

/** Write v1.json once: temp file, fsync, link (fails if v1 exists), fsync dir. */
export function writeV1Atomic(dir, bytes) {
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  const file = path.join(dir, 'v1.json');
  const tmp = path.join(dir, `.v1.json.tmp-${process.pid}-${crypto.randomBytes(6).toString('hex')}`);
  const fd = fs.openSync(tmp, fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL, 0o644);
  try {
    try {
      fs.writeSync(fd, bytes);
      fs.fsyncSync(fd);
    } finally {
      fs.closeSync(fd);
    }
    try {
      fs.linkSync(tmp, file);
    } catch (err) {
      if (err?.code === 'EEXIST') refuse('v1_exists_different', 'v1 appeared while signing; it is never overwritten');
      throw err;
    }
  } finally {
    fs.rmSync(tmp, { force: true });
  }
  try {
    const dfd = fs.openSync(dir, 'r');
    try {
      fs.fsyncSync(dfd);
    } finally {
      fs.closeSync(dfd);
    }
  } catch {
    // Directory fsync is not supported everywhere; the file itself is synced.
  }
  return file;
}

/** pinQuarantineList arguments: (epoch, tree_size, root) tuples. */
export function pinArgs(doc) {
  const tuple = (r) => [r.epoch, r.tree_size, `0x${r.root}`];
  return { entries: doc.entries.map(tuple), highWater: doc.high_water.map(tuple) };
}

function parseArgs(argv) {
  const out = { apply: false, confirm: null, list: null, listSha256: null, logDir: null };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === '--apply') out.apply = true;
    else if (a === '--confirm') out.confirm = argv[++i] ?? null;
    else if (a === '--list') out.list = argv[++i] ?? null;
    else if (a === '--list-sha256') out.listSha256 = argv[++i] ?? null;
    else if (a === '--log-dir') out.logDir = argv[++i] ?? null;
    else refuse('usage', `unknown argument ${a}`);
  }
  return out;
}

/**
 * The host command. `productionKeys` is the allowlist; the script passes
 * nothing, so it is always PRODUCTION_ISSUER_PUBLIC_KEYS. Tests pass a test
 * key's x/y here. `buildFromLog(logDir)` returns the unsigned document the
 * log gives today.
 * @returns {Promise<{ ok: boolean, reason?: string, state?: string }>}
 */
export async function runProductionListSigner({
  argv,
  env = process.env,
  buildFromLog,
  loadSigner,
  productionKeys = PRODUCTION_ISSUER_PUBLIC_KEYS,
  out = (line) => process.stdout.write(`${line}\n`),
  err = (line) => process.stderr.write(`${line}\n`),
}) {
  try {
    const args = parseArgs(argv);
    if (!args.list) refuse('usage', '--list <unsigned v1 file> is required');
    const logDir = args.logDir || env.RECEIPT_LOG_DIR || '';
    if (!logDir) refuse('usage', '--log-dir or RECEIPT_LOG_DIR is required');
    const fileBytes = fs.readFileSync(args.list);
    const inputHash = sha256Hex(fileBytes);
    out(`LIST_SHA256=${inputHash}`);
    if (args.apply && args.confirm !== PRODUCTION_SIGN_CONFIRM) {
      refuse('confirm_missing', `--apply needs --confirm ${PRODUCTION_SIGN_CONFIRM}`);
    }
    if (args.apply && args.listSha256 == null) refuse('list_hash_mismatch', '--apply needs --list-sha256 <the hash above>');
    if (args.listSha256 != null && !(HEX64.test(args.listSha256) && args.listSha256 === inputHash)) {
      refuse('list_hash_mismatch', '--list-sha256 does not equal the input file hash');
    }
    if (!isProductionProcess(env)) refuse('not_production_process', 'this tool runs only in the production gateway environment');
    const keys = decodedKeys(productionKeys);
    const { doc, canonical } = parseUnsignedV1(fileBytes);
    const dir = quarantineListDir(logDir);
    const state = existingV1State(dir, canonical, keys);
    if (state === 'same') {
      const stored = fs.readFileSync(path.join(dir, 'v1.json'));
      out(`SIGNED_LIST_SHA256=${sha256Hex(stored)}`);
      err('v1 already holds this list under the production key; nothing signed or written');
      return { ok: true, state: 'same' };
    }
    // The signer is loaded before the log is read: under KMS the log loader
    // needs the active signer for the JWKS. It is read once, here; the same
    // snapshot is used for the key match, the sign call and the verify.
    const signer = await loadSigner(env);
    if (ephemeralIssuerKid() != null) refuse('not_production_key', 'the loaded issuer key is ephemeral');
    const snap = snapshot(signer);
    const match = matchProductionKey(snap, keys);
    let built;
    try {
      built = await buildFromLog(logDir);
    } catch (e) {
      if (e?.code === 'quarantine_list_build') refuse('list_build_failed', e.message);
      throw e;
    }
    if (!built || jcsRfc8785(built) !== canonical) {
      refuse('list_not_build_output', 'input is not the list the log builds today');
    }
    if (!args.apply) {
      err(`dry run: version 1, ${doc.entries.length} entries, signer kid ${match.kid} (${snap.kind}); nothing signed or written`);
      return { ok: true, state: 'dry_run' };
    }
    const bytes = await signWithSnapshot(doc, snap, keys);
    const file = writeV1Atomic(dir, bytes);
    const stored = fs.readFileSync(file, 'utf8');
    if (stored !== bytes) refuse('write_mismatch', 'v1 on disk does not equal the signed bytes');
    const pin = pinArgs(doc);
    out(`SIGNED_LIST_SHA256=${sha256Hex(Buffer.from(stored, 'utf8'))}`);
    out(`LIST_ENTRIES=${JSON.stringify(pin.entries)}`);
    out(`LIST_HIGH_WATER=${JSON.stringify(pin.highWater)}`);
    out(`FILE=${file}`);
    err(`signed and wrote version 1, ${doc.entries.length} entries`);
    return { ok: true, state: 'written' };
  } catch (e) {
    if (e instanceof ProductionListRefused) {
      err(`refused: ${e.reason}. ${e.message === e.reason ? '' : e.message}`.trim());
      return { ok: false, reason: e.reason };
    }
    err(`failed: ${e?.code || 'error'}. Nothing written.`);
    return { ok: false, reason: 'error' };
  }
}
