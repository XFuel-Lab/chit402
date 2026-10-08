/**
 * Signed, append-only issuer key history.
 *
 * GET /.well-known/issuer-history.json
 * GET /.well-known/issuer-history.json?version=N
 * GET /.well-known/issuer-history.json?hash=<sha256>
 *
 * Each entry names a kid, its public JWK, the window it may sign, and where
 * the private key is held. Entries chain by prev_hash. entry_hash and the
 * well-known document hash use chit402-jcs-v1 (`jcsCanonicalize`), not RFC
 * 8785. The issuer_root fingerprint suffix uses RFC 8785. The current issuer
 * key signs the head hash, so a rewritten entry breaks the chain or the
 * signature.
 *
 * A published snapshot is sealed once. A later key, retirement, or not_after
 * appends a new version. Old version bytes stay fetchable. The receipt pins
 * the version that was current at issuance.
 *
 * The private key stays in the process environment. This document publishes
 * the public key. A custody note lives in the issuer-root description, not
 * in a signed entry.
 */
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { jcsCanonicalize, jcsRfc8785 } from './offer-receipt.js';
import { V11_CANONICALIZATION } from './canonical-preimage.js';
import { getIssuerKid, getIssuerPublicKeyJwk, getJwks, signJws, verifyJwsWithJwks } from './issuer-key.js';
import {
  assertSigningKeyNotRetired,
  bindIssuerRoot,
  issuerRootActive,
  issuerRootClaim,
  REFUSAL_PAYLOAD_VERSION_V2,
  REFUSAL_SCHEMA_V2,
  retirementBlockForKid,
  retirementNotAfterForKid,
} from './issuer-root.js';
import { assertSigningKeyNotGuardian, currentGuardianSetHash } from './issuer-guardian.js';

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

function guardianSetHashField(entry) {
  if (typeof entry?.guardian_set_hash !== 'string') return null;
  const hash = entry.guardian_set_hash.toLowerCase();
  return /^[0-9a-f]{64}$/.test(hash) ? hash : null;
}

function retirementBlockField(entry) {
  if (!Number.isInteger(entry?.retirement_block) || entry.retirement_block < 0) return null;
  return entry.retirement_block;
}

/**
 * Fields covered by entry_hash. entry_hash itself is excluded.
 * guardian_set_hash and retirement_block are included only when the entry
 * carries them. Omitting them keeps the flag-off and pinned snapshot bytes.
 */
export function issuerHistoryEntryBody(entry) {
  const body = {
    kid: entry.kid,
    jwk: publicJwk(entry.jwk),
    alg: entry.alg || 'ES256',
    not_before: entry.not_before,
    not_after: entry.not_after ?? null,
    status: entry.status,
    revoked_at: entry.revoked_at ?? null,
    reason: entry.reason ?? null,
    prev_hash: entry.prev_hash ?? null,
  };
  if (typeof entry.custody === 'string' && entry.custody) body.custody = entry.custody;
  const setHash = guardianSetHashField(entry);
  if (setHash) body.guardian_set_hash = setHash;
  const block = retirementBlockField(entry);
  if (block != null) body.retirement_block = block;
  return body;
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

/**
 * Production kid keeps the first ES256 deployment date. Any other live kid
 * uses an explicit not_before (history entry or ISSUER_KEY_NOT_BEFORE).
 * Missing means unknown: the window check fails closed, and the key is not
 * treated as valid back to the production date.
 * @param {string} kid
 * @param {string|null|undefined} override
 */
export function notBeforeForKid(kid, override) {
  if (override) return override;
  if (kid === PRODUCTION_ISSUER_KID) return PRODUCTION_KEY_NOT_BEFORE;
  const configured = process.env.ISSUER_KEY_NOT_BEFORE;
  if (typeof configured === 'string' && configured.trim() && !Number.isNaN(Date.parse(configured))) {
    return new Date(Date.parse(configured)).toISOString();
  }
  return null;
}

function liveEntry(overrides = {}) {
  const jwk = publicJwk(getIssuerPublicKeyJwk());
  const entry = {
    kid: jwk.kid,
    jwk,
    alg: 'ES256',
    not_before: notBeforeForKid(jwk.kid, overrides.not_before || null),
    not_after: overrides.not_after ?? null,
    status: overrides.status || 'active',
    revoked_at: overrides.revoked_at ?? null,
    reason: overrides.reason ?? null,
  };
  if (typeof overrides.custody === 'string' && overrides.custody) entry.custody = overrides.custody;
  return entry;
}

/**
 * Build the public history. The live process key is the tail. Extra entries
 * from ISSUER_HISTORY_EXTRA are earlier keys (retired or revoked).
 * `version` and `seq` stamp a sealed snapshot. Omit them for an unsigned
 * preview of the entry chain.
 * @param {{ entries?: object[]|null, version?: number|null, seq?: number|null }} [opts]
 */
/**
 * v11 entries reference the committed guardian set by hash and show a
 * registry retirement block. Flag-off drops both, even if an extra entry
 * already has them, so the well-known document stays on the previous shape.
 * @param {object} entry
 */
function withGuardianFacts(entry) {
  if (!issuerRootActive()) {
    const { guardian_set_hash: _set, retirement_block: _block, ...rest } = entry;
    return rest;
  }
  const next = { ...entry };
  const setHash = currentGuardianSetHash();
  if (setHash) next.guardian_set_hash = setHash;
  else delete next.guardian_set_hash;
  const block = retirementBlockForKid(next.kid);
  if (block != null) {
    next.retirement_block = block;
    if (next.status !== 'revoked') next.status = 'retired';
    if (next.not_after == null) {
      const notAfter = retirementNotAfterForKid(next.kid);
      if (notAfter) next.not_after = notAfter;
    }
  } else {
    delete next.retirement_block;
  }
  return next;
}

export function buildIssuerHistory({ entries = null, version = null, seq = null } = {}) {
  assertSigningKeyNotGuardian();
  assertSigningKeyNotRetired();
  const extras = entries || readExtraEntries();
  const current = getIssuerPublicKeyJwk();
  const prior = [];
  let currentOverride = null;
  for (const extra of extras) {
    if (extra.kid === current.kid) currentOverride = extra;
    else prior.push(extra);
  }
  const tail = withGuardianFacts(liveEntry(currentOverride || {}));
  const chained = chainEntries([...prior.map(withGuardianFacts), tail]);
  const head = chained[chained.length - 1];
  const claims = {
    schema: ISSUER_HISTORY_SCHEMA,
    payload_version: ISSUER_HISTORY_VERSION,
    entry_count: chained.length,
    head_hash: head.entry_hash,
  };
  if (version != null) {
    claims.version = version;
    claims.seq = seq == null ? version : seq;
  }
  if (issuerRootActive()) claims.issuer_root = issuerRootClaim(getIssuerKid());
  const { jws, kid } = signJws(claims, { typ: ISSUER_HISTORY_JWT_TYP });
  bindIssuerRoot(claims, kid, current);
  return {
    schema: ISSUER_HISTORY_SCHEMA,
    payload_version: ISSUER_HISTORY_VERSION,
    ...(version != null ? { version, seq: seq == null ? version : seq } : {}),
    canonicalization: 'Each entry_hash is SHA-256 of the JCS (RFC 8785) UTF-8 bytes of the entry without entry_hash. prev_hash is the previous entry_hash, or null on the first entry. The current issuer key signs head_hash and entry_count. A sealed snapshot also signs version and seq. SHA-256 of the JCS bytes of the whole document is the snapshot hash a receipt pins.',
    not_before_note: `Only kid ${PRODUCTION_ISSUER_KID} defaults not_before to ${PRODUCTION_KEY_NOT_BEFORE}, the first deployment of this ES256 issuer path. The earliest receipt in the repo signed by that kid is 2026-09-26T17:27:32Z (fixture chit-5d775d12). Any other kid uses its history entry or ISSUER_KEY_NOT_BEFORE. A null not_before is unknown and the window check fails closed.`,
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
  if (payload.issuer_root) {
    const signedKid = result.kid || sig.kid || null;
    if (!payload.issuer_root.kid || payload.issuer_root.kid !== signedKid) {
      return { valid: false, reason: 'issuer_root_kid_mismatch' };
    }
  }
  if (payload.version != null && Number(payload.version) !== Number(doc.version)) {
    return { valid: false, reason: 'version_mismatch' };
  }
  if (payload.seq != null && Number(payload.seq) !== Number(doc.seq)) {
    return { valid: false, reason: 'seq_mismatch' };
  }
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
  return { ok: true, kid, status: entry.status, not_after: entry.not_after ?? null };
}

function historySha256(text) {
  return crypto.createHash('sha256').update(text, 'utf8').digest('hex');
}

function entryFingerprint(entries) {
  return (entries || []).map((entry) => entry.entry_hash).join(',');
}

/**
 * Flag-off fingerprint is the entry chain only, so a sealed snapshot still
 * matches. When the issuer root is on, the signed claims changed, so the
 * fingerprint includes that object and a new version is sealed. The
 * issuer_root suffix is RFC 8785. entry_hash and the document body stay on
 * chit402-jcs-v1.
 */
function sealFingerprint(preview) {
  const base = entryFingerprint(preview.entries);
  if (!issuerRootActive()) return base;
  return `${base}|${jcsRfc8785(issuerRootClaim(getIssuerKid()))}`;
}

/** In-process append-only snapshots. Disk is optional. */
const historyStore = {
  dir: null,
  persist: false,
  versions: [],
};

function historyFile() {
  return historyStore.dir ? path.join(historyStore.dir, 'issuer-history-versions.jsonl') : null;
}

function loadHistoryStore() {
  const file = historyFile();
  if (!file || !fs.existsSync(file)) return;
  const text = fs.readFileSync(file, 'utf8');
  for (const line of text.split('\n')) {
    if (!line.trim()) continue;
    try {
      const row = JSON.parse(line);
      if (row && row.version && typeof row.body === 'string' && row.hash) {
        if (!row.entries_snapshot_hash) {
          try {
            row.entries_snapshot_hash = historyEntriesSnapshotHash(JSON.parse(row.body).entries);
          } catch {
            /* a row that cannot be parsed still serves by its document hash */
          }
        }
        historyStore.versions.push(row);
      }
    } catch {
      /* a torn last line is ignored; earlier versions stay */
    }
  }
}

/**
 * @param {{ dir?: string|null, persist?: boolean }} [opts]
 */
export function configureIssuerHistoryStore({ dir = null, persist = false } = {}) {
  historyStore.dir = persist && dir ? String(dir) : null;
  historyStore.persist = !!historyStore.dir;
  historyStore.versions = [];
  if (historyStore.persist) {
    fs.mkdirSync(historyStore.dir, { recursive: true });
    loadHistoryStore();
  }
}

/** Test helper. Does not delete a configured directory's file. */
export function resetIssuerHistoryStore() {
  historyStore.versions = [];
}

function persistHistoryRecord(record) {
  const file = historyFile();
  if (!historyStore.persist || !file) return;
  fs.appendFileSync(file, `${JSON.stringify(record)}\n`);
}

/**
 * The snapshot in effect now. A matching entry chain reuses the sealed
 * bytes. A different chain appends the next version.
 * @returns {{ version: number, seq: number, hash: string, fingerprint: string, head_hash: string, body: string }}
 */
export function currentIssuerHistory() {
  const preview = buildIssuerHistory();
  const fingerprint = sealFingerprint(preview);
  const latest = historyStore.versions[historyStore.versions.length - 1] || null;
  if (latest && latest.fingerprint === fingerprint) return latest;
  const version = (latest?.version || 0) + 1;
  const seq = version;
  const doc = buildIssuerHistory({ version, seq });
  const body = jcsCanonicalize(doc);
  const record = {
    version,
    seq,
    hash: historySha256(body),
    entries_snapshot_hash: historyEntriesSnapshotHash(doc.entries),
    fingerprint: sealFingerprint(doc),
    head_hash: doc.head_hash,
    body,
  };
  historyStore.versions.push(record);
  persistHistoryRecord(record);
  return record;
}

/**
 * Pin written into a new receipt or refusal JWS.
 * @returns {{ hash: string, version: number, seq: number }}
 */
export function currentHistoryPin() {
  const record = currentIssuerHistory();
  // Flag-off receipts pin the well-known document hash (chit402-jcs-v1).
  // v11 and refusal v2 pin the entries snapshot hash, the same value
  // snapshot_hash commits to.
  const hash = issuerRootActive() ? record.entries_snapshot_hash : record.hash;
  return { hash, version: record.version, seq: record.seq };
}

export const ISSUER_HISTORY_EMBED_SCHEMA = 'chit402.issuer_history_embed.v1';

/**
 * One embed entry. These fields, and only these, are the snapshot_hash
 * preimage. entry_hash stays SHA-256 of the chit402-jcs-v1 entry body.
 * @param {object} entry
 */
export function historyEmbedEntry(entry) {
  const body = {
    kid: entry.kid,
    jwk: entry.jwk,
    alg: entry.alg,
    not_before: entry.not_before,
    not_after: entry.not_after ?? null,
    status: entry.status,
    revoked_at: entry.revoked_at ?? null,
    reason: entry.reason ?? null,
    prev_hash: entry.prev_hash ?? null,
    entry_hash: entry.entry_hash,
  };
  if (typeof entry.custody === 'string' && entry.custody) body.custody = entry.custody;
  const setHash = guardianSetHashField(entry);
  if (setHash) body.guardian_set_hash = setHash;
  const block = retirementBlockField(entry);
  if (block != null) body.retirement_block = block;
  return body;
}

/**
 * SHA-256 of the RFC 8785 canonical bytes of the embed entries array.
 * UTF-8, no trailing newline. The preimage is `jcsRfc8785(entries)` after
 * {@link historyEmbedEntry}, not the well-known document and not one entry.
 * @param {object[]|null|undefined} entries
 */
export function historyEntriesSnapshotHash(entries) {
  const list = (entries || []).map(historyEmbedEntry);
  return historySha256(jcsRfc8785(list));
}

/**
 * Payment v11 carries the embed. Refusal v2 is payload version 3, so a
 * check written as payload_version >= 11 does not see it.
 * @param {object|null|undefined} claims
 */
export function claimsBindHistorySnapshot(claims) {
  if (!claims || typeof claims !== 'object') return false;
  const version = Number(claims.payload_version);
  if (claims.schema === REFUSAL_SCHEMA_V2 || (claims.kind === 'refusal' && version === REFUSAL_PAYLOAD_VERSION_V2)) {
    return true;
  }
  return Number.isFinite(version) && version >= 11 && claims.kind !== 'refusal';
}

/**
 * snapshot_hash is the entries hash, and the issuer_history pin is that
 * same digest. A self-consistent entry_hash chain is not enough: forged
 * entries hash to a different snapshot_hash, so they cannot match the
 * signed pin.
 * @param {object|null|undefined} claims verified JWS claims
 * @param {{ publishedEntries?: object[]|null }} [opts]
 */
export function verifyHistorySnapshotClaims(claims, { publishedEntries = undefined } = {}) {
  if (!claimsBindHistorySnapshot(claims)) return { ok: true, checked: false };
  const snap = claims.issuer_history_snapshot;
  const pin = claims.issuer_history;
  if (!snap || snap.schema !== ISSUER_HISTORY_EMBED_SCHEMA || !Array.isArray(snap.entries)) {
    return { ok: false, checked: true, reason: 'history_snapshot_missing' };
  }
  const canon = claims.canonicalization;
  if (!canon || canon.hash_alg !== V11_CANONICALIZATION.hash_alg || canon.jcs !== V11_CANONICALIZATION.jcs
    || Object.prototype.hasOwnProperty.call(canon, 'string_escaping')) {
    return { ok: false, checked: true, reason: 'canonicalization_mismatch' };
  }
  if (!pin || typeof pin.hash !== 'string' || !/^[0-9a-f]{64}$/.test(pin.hash)
    || pin.version == null || pin.seq == null) {
    return { ok: false, checked: true, reason: 'issuer_history_pin_missing' };
  }
  if (Number(pin.version) !== Number(snap.version) || Number(pin.seq) !== Number(snap.seq)) {
    return { ok: false, checked: true, reason: 'snapshot_pin_mismatch' };
  }
  let prev = null;
  for (const entry of snap.entries) {
    if ((entry.prev_hash ?? null) !== prev) {
      return { ok: false, checked: true, reason: 'prev_hash_mismatch' };
    }
    if (issuerHistoryEntryHash(entry) !== entry.entry_hash) {
      return { ok: false, checked: true, reason: 'entry_hash_mismatch' };
    }
    prev = entry.entry_hash;
  }
  const head = snap.entries.length ? snap.entries[snap.entries.length - 1].entry_hash : null;
  if (snap.head_hash !== head) return { ok: false, checked: true, reason: 'head_hash_mismatch' };
  const computed = historyEntriesSnapshotHash(snap.entries);
  if (computed !== snap.snapshot_hash) {
    return { ok: false, checked: true, reason: 'snapshot_hash_mismatch' };
  }
  if (pin.hash !== snap.snapshot_hash) {
    return { ok: false, checked: true, reason: 'snapshot_pin_mismatch' };
  }
  if (publishedEntries != null) {
    const published = historyEntriesSnapshotHash(publishedEntries);
    if (published !== pin.hash) {
      return { ok: false, checked: true, reason: 'snapshot_pin_mismatch' };
    }
  }
  return { ok: true, checked: true, snapshot_hash: computed };
}

/**
 * Minimal history carried inside a v11 signature and a v2 refusal.
 * snapshot_hash is {@link historyEntriesSnapshotHash} of these entries.
 * The issuer_history pin in the same payload is that hash computed from
 * the published document's entries. One live key is about 1KB.
 * @param {{ version: number, seq: number, hash: string, body: string, entries_snapshot_hash?: string }} [record]
 */
/**
 * Entries of the published history version named by the pin, or null when
 * this process has not sealed that version.
 * @param {{ version?: unknown }} [pin]
 */
export function publishedHistoryEntries(pin) {
  if (!pin || pin.version == null) return null;
  const record = issuerHistoryRecord({ version: pin.version });
  if (!record?.body) return null;
  try {
    const entries = JSON.parse(record.body).entries;
    return Array.isArray(entries) ? entries : null;
  } catch {
    return null;
  }
}

export function issuerHistorySnapshotClaim(record = currentIssuerHistory()) {
  const doc = JSON.parse(record.body);
  const entries = (doc.entries || []).map(historyEmbedEntry);
  return {
    schema: ISSUER_HISTORY_EMBED_SCHEMA,
    version: record.version,
    seq: record.seq,
    head_hash: doc.head_hash,
    snapshot_hash: historyEntriesSnapshotHash(entries),
    entries,
  };
}

/**
 * Latest snapshot, or a sealed older one by version or hash.
 * @param {{ version?: unknown, hash?: unknown }} [query]
 */
export function issuerHistoryRecord({ version = null, hash = null } = {}) {
  const wantsVersion = version != null && version !== '';
  const wantsHash = hash != null && hash !== '';
  if (!wantsVersion && !wantsHash) return currentIssuerHistory();
  currentIssuerHistory();
  if (wantsVersion) {
    const n = Number(version);
    if (!Number.isInteger(n) || n < 1) return null;
    return historyStore.versions.find((row) => row.version === n) || null;
  }
  const needle = String(hash).replace(/^0x/, '').toLowerCase();
  return historyStore.versions.find((row) => row.hash === needle || row.entries_snapshot_hash === needle) || null;
}

/**
 * Serve stored snapshot bytes. The body is not rebuilt.
 * @param {import('express').Response} res
 * @param {{ version?: unknown, hash?: unknown }} [query]
 */
export function writeIssuerHistory(res, query = {}) {
  const record = issuerHistoryRecord(query);
  if (!record) {
    return res.status(404).json({
      error: 'not_found',
      message: 'No issuer history with that version or hash.',
    });
  }
  const pinned = (query.version != null && query.version !== '')
    || (query.hash != null && query.hash !== '');
  res.set('Cache-Control', pinned ? 'public, max-age=31536000, immutable' : 'public, max-age=300');
  res.set('X-Chit-Hash-Alg', 'sha256');
  res.set('X-Chit-History-Hash', record.hash);
  res.set('X-Chit-History-Version', String(record.version));
  res.set('X-Chit-History-Seq', String(record.seq));
  res.type('application/json; charset=utf-8');
  return res.send(Buffer.from(record.body, 'utf8'));
}
