/**
 * Signed, append-only issuer key history.
 *
 * GET /.well-known/issuer-history.json
 *
 * Each entry names a kid, its public JWK, the window it may sign, and where
 * the private key is held. Entries chain by prev_hash (JCS / RFC 8785, then
 * SHA-256). The current issuer key signs the head hash, so a rewritten entry
 * breaks the chain or the signature.
 *
 * The private key stays in the process environment. This document publishes
 * the public key and a custody sentence, not the secret.
 */
import crypto from 'crypto';
import { jcsCanonicalize } from './offer-receipt.js';
import { getIssuerPublicKeyJwk, getJwks, signJws, verifyJwsWithJwks } from './issuer-key.js';

export const ISSUER_HISTORY_SCHEMA = 'chit402.issuer_history.v1';
export const ISSUER_HISTORY_VERSION = 1;
export const ISSUER_HISTORY_JWT_TYP = 'chit402-issuer-history+jwt';

/**
 * First deployment of the ES256 receipt JWS path
 * (`fix(receipt): standard JWT/JWS mechanics`, 2026-09-04T08:52:05Z).
 * The earliest receipt in this repo signed by the production kid is fixture
 * chit-5d775d12, iat 2026-09-26T17:27:32Z. The host ledger is not in the
 * repo, so not_before is the earlier deployment date. Every captured
 * receipt falls inside the window.
 */
export const PRODUCTION_KEY_NOT_BEFORE = '2026-09-04T08:52:05Z';

export const PRODUCTION_ISSUER_KID = 'IvFpmC-vPhkY_v0vidsrWVT9uzlE5XWKZgAEOeJTq1Q';

export const CUSTODY_STATEMENT = 'The ES256 private key is the base64 PEM in the gateway process environment variable ISSUER_PRIVATE_KEY. The process does not call a cloud KMS. When that variable is unset, the process generates an ephemeral key for local runs; production sets the variable. This sentence names where the key is held. It is not the key.';

function sha256Hex(text) {
  return crypto.createHash('sha256').update(text, 'utf8').digest('hex');
}

function publicJwk(jwk) {
  if (!jwk || jwk.kty !== 'EC') return null;
  return {
    kty: jwk.kty,
    crv: jwk.crv,
    x: jwk.x,
    y: jwk.y,
    kid: jwk.kid,
    alg: jwk.alg || 'ES256',
    use: jwk.use || 'sig',
  };
}

/** Fields covered by entry_hash. entry_hash itself is excluded. */
export function issuerHistoryEntryBody(entry) {
  return {
    kid: entry.kid,
    jwk: publicJwk(entry.jwk),
    alg: entry.alg || 'ES256',
    not_before: entry.not_before,
    not_after: entry.not_after ?? null,
    status: entry.status,
    revoked_at: entry.revoked_at ?? null,
    reason: entry.reason ?? null,
    custody: entry.custody,
    prev_hash: entry.prev_hash ?? null,
  };
}

export function issuerHistoryEntryHash(entry) {
  return sha256Hex(jcsCanonicalize(issuerHistoryEntryBody(entry)));
}

function chainEntries(rawEntries) {
  const chained = [];
  let prev = null;
  for (const raw of rawEntries) {
    const body = issuerHistoryEntryBody({ ...raw, prev_hash: prev });
    const entry_hash = issuerHistoryEntryHash(body);
    chained.push({ ...body, entry_hash });
    prev = entry_hash;
  }
  return chained;
}

function readExtraEntries() {
  const raw = process.env.ISSUER_HISTORY_EXTRA;
  if (!raw || !String(raw).trim()) return [];
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return [];
  }
  const list = Array.isArray(parsed) ? parsed : parsed?.entries;
  if (!Array.isArray(list)) return [];
  return list.filter((entry) => entry && typeof entry.kid === 'string' && entry.jwk);
}

function liveEntry(overrides = {}) {
  const jwk = publicJwk(getIssuerPublicKeyJwk());
  return {
    kid: jwk.kid,
    jwk,
    alg: 'ES256',
    not_before: overrides.not_before || PRODUCTION_KEY_NOT_BEFORE,
    not_after: overrides.not_after ?? null,
    status: overrides.status || 'active',
    revoked_at: overrides.revoked_at ?? null,
    reason: overrides.reason ?? null,
    custody: overrides.custody || CUSTODY_STATEMENT,
  };
}

/**
 * Build the public history. The live process key is the tail. Extra entries
 * from ISSUER_HISTORY_EXTRA are earlier keys (retired or revoked).
 * @param {{ entries?: object[] }} [opts]
 */
export function buildIssuerHistory({ entries = null } = {}) {
  const extras = entries || readExtraEntries();
  const current = getIssuerPublicKeyJwk();
  const prior = [];
  let currentOverride = null;
  for (const extra of extras) {
    if (extra.kid === current.kid) currentOverride = extra;
    else prior.push(extra);
  }
  const tail = liveEntry(currentOverride || {});
  if (current.kid === PRODUCTION_ISSUER_KID && !currentOverride?.not_before) {
    tail.not_before = PRODUCTION_KEY_NOT_BEFORE;
  }
  const chained = chainEntries([...prior, tail]);
  const head = chained[chained.length - 1];
  const claims = {
    schema: ISSUER_HISTORY_SCHEMA,
    payload_version: ISSUER_HISTORY_VERSION,
    entry_count: chained.length,
    head_hash: head.entry_hash,
  };
  const { jws, kid } = signJws(claims, { typ: ISSUER_HISTORY_JWT_TYP });
  return {
    schema: ISSUER_HISTORY_SCHEMA,
    payload_version: ISSUER_HISTORY_VERSION,
    canonicalization: 'Each entry_hash is SHA-256 of the JCS (RFC 8785) UTF-8 bytes of the entry without entry_hash. prev_hash is the previous entry_hash, or null on the first entry. The current issuer key signs head_hash and entry_count.',
    not_before_note: `The production kid ${PRODUCTION_ISSUER_KID} uses not_before ${PRODUCTION_KEY_NOT_BEFORE}, the first deployment of this ES256 issuer path. The earliest receipt in the repo signed by that kid is 2026-09-26T17:27:32Z (fixture chit-5d775d12).`,
    entries: chained,
    head_hash: head.entry_hash,
    issuer_signature: {
      alg: 'ES256',
      typ: ISSUER_HISTORY_JWT_TYP,
      payload_version: ISSUER_HISTORY_VERSION,
      jws,
      kid,
      issuer_jwk: current,
    },
  };
}

/**
 * Recompute the chain and check the current issuer signature.
 * @param {object} doc
 * @param {{ keys: object[] }|null} [jwks]
 */
export function verifyIssuerHistory(doc, jwks = null) {
  if (!doc || doc.schema !== ISSUER_HISTORY_SCHEMA || !Array.isArray(doc.entries) || !doc.entries.length) {
    return { valid: false, reason: 'not_issuer_history' };
  }
  let prev = null;
  for (const entry of doc.entries) {
    if ((entry.prev_hash ?? null) !== prev) {
      return { valid: false, reason: 'prev_hash_mismatch', kid: entry.kid };
    }
    const expected = issuerHistoryEntryHash(entry);
    if (expected !== entry.entry_hash) {
      return { valid: false, reason: 'entry_hash_mismatch', kid: entry.kid };
    }
    if (!entry.kid || !entry.jwk || entry.alg !== 'ES256') {
      return { valid: false, reason: 'entry_incomplete', kid: entry.kid || null };
    }
    if (!['active', 'retired', 'revoked'].includes(entry.status)) {
      return { valid: false, reason: 'bad_status', kid: entry.kid };
    }
    prev = entry.entry_hash;
  }
  const head = doc.entries[doc.entries.length - 1].entry_hash;
  if (doc.head_hash !== head) return { valid: false, reason: 'head_hash_mismatch' };
  const sig = doc.issuer_signature;
  if (!sig?.jws) return { valid: false, reason: 'no_signature' };
  const result = verifyJwsWithJwks(sig.jws, jwks || getJwks());
  if (!result.valid) return { valid: false, reason: result.reason || 'signature_invalid' };
  const payload = result.payload || {};
  if (payload.schema !== ISSUER_HISTORY_SCHEMA) return { valid: false, reason: 'schema_mismatch' };
  if (Number(payload.entry_count) !== doc.entries.length) return { valid: false, reason: 'entry_count_mismatch' };
  if (payload.head_hash !== head) return { valid: false, reason: 'signed_head_mismatch' };
  return { valid: true, payload, kid: result.kid || sig.kid };
}

function parseTime(value) {
  if (value == null || value === '') return null;
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value > 1e12 ? value : value * 1000;
  }
  const ms = Date.parse(String(value));
  return Number.isFinite(ms) ? ms : null;
}

/**
 * The receipt's issued time must fall inside the kid's window, and the kid
 * must not have been revoked before issuance.
 * @param {object} doc verified or unverified history
 * @param {string} kid
 * @param {number|string} issuedAt unix seconds or ISO
 */
export function issuerKeyWindow(doc, kid, issuedAt) {
  const entry = (doc?.entries || []).find((row) => row.kid === kid);
  if (!entry) return { ok: false, reason: 'kid_not_in_history', kid };
  const issued = parseTime(issuedAt);
  if (issued == null) return { ok: false, reason: 'issued_at_missing', kid };
  const notBefore = parseTime(entry.not_before);
  if (notBefore == null) return { ok: false, reason: 'not_before_missing', kid };
  if (issued < notBefore) return { ok: false, reason: 'issued_before_not_before', kid };
  const notAfter = parseTime(entry.not_after);
  if (entry.not_after != null && notAfter == null) return { ok: false, reason: 'not_after_invalid', kid };
  if (notAfter != null && issued > notAfter) return { ok: false, reason: 'issued_after_not_after', kid };
  if (entry.status === 'revoked') {
    const revoked = parseTime(entry.revoked_at);
    if (revoked == null) return { ok: false, reason: 'revoked_at_missing', kid };
    if (issued >= revoked) return { ok: false, reason: 'kid_revoked_before_issuance', kid };
  }
  return { ok: true, kid, status: entry.status };
}
