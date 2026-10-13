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
import { getIssuerKid, getIssuerPublicKeyJwk, getJwks, isProductionIssuerEnv, signJws, verifyJwsWithJwks } from './issuer-key.js';
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
const ISSUER_HISTORY_QUERY_KEYS = new Set(['version', 'hash']);

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

export function buildIssuerHistory({ entries = null, version = null, seq = null, sealedEntries = null } = {}) {
  assertSigningKeyNotGuardian();
  assertSigningKeyNotRetired();
  const current = getIssuerPublicKeyJwk();
  let chained;
  if (Array.isArray(sealedEntries) && sealedEntries.length) {
    chained = sealedEntries;
  } else {
    const extras = entries || readExtraEntries();
    const prior = [];
    let currentOverride = null;
    for (const extra of extras) {
      if (extra.kid === current.kid) currentOverride = extra;
      else prior.push(extra);
    }
    const tail = withGuardianFacts(liveEntry(currentOverride || {}));
    chained = chainEntries([...prior.map(withGuardianFacts), tail]);
  }
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
  if (kidStatusRegression(doc.entries)) return { valid: false, reason: 'kid_status_regression' };
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
  if (inheritedKeyWindow(doc.entries)) {
    return { valid: false, reason: 'inherited_key_window' };
  }
  const signerKid = result.kid || sig.kid || null;
  if (signedOnlyByIntroducedKey(doc.entries, signerKid)) {
    return { valid: false, reason: 'introduced_key_signature' };
  }
  return { valid: true, payload, kid: signerKid };
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
 * Revocation sticks. A later entry cannot move a kid off `revoked`, and a
 * retired kid cannot become active again.
 * @param {object[]} entries
 */
function kidStatusRegression(entries) {
  const prior = new Map();
  for (const entry of entries || []) {
    const prev = prior.get(entry?.kid);
    if (prev === 'revoked') return true;
    if (prev === 'retired' && entry?.status === 'active') return true;
    prior.set(entry?.kid, entry?.status);
  }
  return false;
}

/**
 * The receipt's issued time must fall inside the kid's window. The earliest
 * revoked_at and the earliest not_after across every entry for that kid
 * stay in force. A later active row does not clear them.
 * @param {object} doc verified or unverified history
 * @param {string} kid
 * @param {number|string} issuedAt unix seconds or ISO
 */
export function issuerKeyWindow(doc, kid, issuedAt) {
  const matches = (doc?.entries || []).filter((row) => row && row.kid === kid);
  if (!matches.length) return { ok: false, reason: 'kid_not_in_history', kid };
  const last = matches[matches.length - 1];
  let notAfter = null;
  let notAfterMs = null;
  for (const row of matches) {
    if (row.not_after == null || row.not_after === '') continue;
    const parsed = parseTime(row.not_after);
    if (parsed == null) return { ok: false, reason: 'not_after_invalid', kid };
    if (notAfterMs == null || parsed < notAfterMs) {
      notAfterMs = parsed;
      notAfter = row.not_after;
    }
  }
  let revoked = false;
  let revokedAt = null;
  let revokedMs = null;
  for (const row of matches) {
    const stamp = row.revoked_at;
    const hasStamp = stamp != null && stamp !== '';
    if (row.status === 'revoked' || hasStamp) revoked = true;
    if (!hasStamp) continue;
    const parsed = parseTime(stamp);
    if (parsed == null) return { ok: false, reason: 'revoked_at_missing', kid };
    if (revokedMs == null || parsed < revokedMs) {
      revokedMs = parsed;
      revokedAt = stamp;
    }
  }
  if (revoked && revokedAt == null) return { ok: false, reason: 'revoked_at_missing', kid };
  const issued = parseTime(issuedAt);
  if (issued == null) return { ok: false, reason: 'issued_at_missing', kid };
  const notBefore = parseTime(last.not_before);
  if (notBefore == null) return { ok: false, reason: 'not_before_missing', kid };
  if (issued < notBefore) return { ok: false, reason: 'issued_before_not_before', kid };
  if (notAfterMs != null && issued > notAfterMs) return { ok: false, reason: 'issued_after_not_after', kid };
  if (revoked && issued >= revokedMs) return { ok: false, reason: 'kid_revoked_before_issuance', kid };
  return {
    ok: true,
    kid,
    status: revoked ? 'revoked' : last.status,
    not_after: notAfter,
  };
}

/**
 * A later key must not start at or before an earlier key's not_before.
 * Copying the previous window would let receipts from the old key verify
 * under the new one. The same kid may appear again; that is not a new key.
 * @param {object[]} entries
 */
function inheritedKeyWindow(entries) {
  const seen = new Set();
  let maxPrior = null;
  for (const entry of entries || []) {
    const start = parseTime(entry?.not_before);
    if (!seen.has(entry?.kid)) {
      if (seen.size > 0 && start != null && maxPrior != null && start <= maxPrior) return true;
      seen.add(entry?.kid);
    }
    if (start != null && (maxPrior == null || start > maxPrior)) maxPrior = start;
  }
  return false;
}

/**
 * The signing key's first entry must be the genesis entry. A key that first
 * appears later is a key this document introduces, and it must not be the
 * only signature. Rotation that has the previous key sign the new entry is
 * a different path and is not built here.
 * @param {object[]} entries
 * @param {string|null} signerKid
 */
function signedOnlyByIntroducedKey(entries, signerKid) {
  if (!signerKid || !Array.isArray(entries) || entries.length < 2) return false;
  const first = entries.findIndex((entry) => entry.kid === signerKid);
  return first > 0;
}

/**
 * True when every sealed entry_hash is an unchanged prefix of next.
 * A longer chain is an extension. An equal chain is the same entries.
 * @param {object[]} prev
 * @param {object[]} next
 */
export function entriesExtend(prev, next) {
  if (!Array.isArray(prev) || !Array.isArray(next)) return false;
  if (next.length < prev.length) return false;
  for (let i = 0; i < prev.length; i += 1) {
    if (prev[i]?.entry_hash !== next[i]?.entry_hash) return false;
  }
  return true;
}

function issuerHistoryRewriteError() {
  const err = new Error('sealed issuer-history entries are append-only');
  err.code = 'issuer_history_rewrite';
  return err;
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
  // A test process that minted a new key must not append a non-extending
  // line onto a file sealed by the previous key.
  suppressPersist: false,
  versions: [],
  highWater: null,
  ignoredRewrite: false,
  notes: [],
};

function historyFile() {
  return historyStore.dir ? path.join(historyStore.dir, 'issuer-history-versions.jsonl') : null;
}

const HIGH_WATER_NAME = 'issuer-history-high-water.json';
const NOTES_NAME = 'issuer-history-notes.jsonl';
const ANCHOR_STATE_NAME = 'anchor-state.json';

function notesFile() {
  return historyStore.dir ? path.join(historyStore.dir, NOTES_NAME) : null;
}

function testRotationAllowed() {
  return String(process.env.ISSUER_HISTORY_TEST_ROTATION || '').trim() === 'true';
}

function readJsonFile(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
}

function markFromValue(value) {
  if (!value || typeof value !== 'object') return null;
  const version = Number(value.version);
  const head = value.head_hash;
  if (!Number.isInteger(version) || version < 1) return null;
  if (typeof head !== 'string' || !/^[0-9a-f]{64}$/.test(head)) return null;
  return { version, head_hash: head };
}

function strongerMark(left, right) {
  if (!left) return right;
  if (!right) return left;
  if (left.version !== right.version) return left.version > right.version ? left : right;
  if (left.head_hash !== right.head_hash) {
    const err = new Error('issuer-history high-water marks disagree');
    err.code = 'issuer_history_truncated';
    throw err;
  }
  return left;
}

function markFiles() {
  const files = [];
  if (historyStore.dir) files.push(path.join(historyStore.dir, HIGH_WATER_NAME));
  const logDir = process.env.RECEIPT_LOG_DIR;
  if (logDir) files.push(path.join(logDir, ANCHOR_STATE_NAME));
  return files;
}

function readMarkAt(file) {
  if (!file || !fs.existsSync(file)) return null;
  const parsed = readJsonFile(file);
  if (!parsed) return null;
  if (file.endsWith(ANCHOR_STATE_NAME)) return markFromValue(parsed.issuer_history);
  return markFromValue(parsed);
}

function refreshHighWater() {
  let mark = null;
  for (const file of markFiles()) mark = strongerMark(mark, readMarkAt(file));
  historyStore.highWater = mark;
  return mark;
}

function writeHighWater(mark) {
  const prev = historyStore.highWater;
  if (prev && prev.version > mark.version) return;
  if (prev && prev.version === mark.version && prev.head_hash !== mark.head_hash) {
    const err = new Error('issuer-history high-water mark already records this version');
    err.code = 'issuer_history_truncated';
    throw err;
  }
  historyStore.highWater = mark;
  if (!historyStore.persist || historyStore.suppressPersist || !historyStore.dir) return;
  const body = {
    schema: 'chit402.issuer_history_high_water.v1',
    version: mark.version,
    head_hash: mark.head_hash,
  };
  fs.writeFileSync(path.join(historyStore.dir, HIGH_WATER_NAME), `${JSON.stringify(body)}\n`);
  const logDir = process.env.RECEIPT_LOG_DIR;
  if (!logDir) return;
  fs.mkdirSync(logDir, { recursive: true });
  const anchorPath = path.join(logDir, ANCHOR_STATE_NAME);
  const state = fs.existsSync(anchorPath)
    ? (readJsonFile(anchorPath) || { schema: 'chit402.receipt_anchor_state.v1', solana: {}, base: {} })
    : { schema: 'chit402.receipt_anchor_state.v1', solana: {}, base: {} };
  state.issuer_history = { version: mark.version, head_hash: mark.head_hash };
  if (!state.schema) state.schema = 'chit402.receipt_anchor_state.v1';
  if (!state.solana) state.solana = {};
  if (!state.base) state.base = {};
  fs.writeFileSync(anchorPath, `${JSON.stringify(state)}\n`);
}

function raiseHighWater(record) {
  if (!record?.version || !record.head_hash) return;
  const mark = { version: Number(record.version), head_hash: record.head_hash };
  const prev = historyStore.highWater;
  if (prev && prev.version > mark.version) {
    const err = new Error('issuer-history file is shorter than the anchored high-water mark');
    err.code = 'issuer_history_truncated';
    throw err;
  }
  if (prev && prev.version === mark.version && prev.head_hash !== mark.head_hash) {
    const err = new Error('issuer-history high-water mark already records this version');
    err.code = 'issuer_history_truncated';
    throw err;
  }
  if (!prev || prev.version < mark.version) writeHighWater(mark);
}

function assertHighWater(versions) {
  const mark = refreshHighWater();
  if (!mark) return;
  const latest = versions[versions.length - 1] || null;
  const maxVersion = latest ? Number(latest.version) : 0;
  if (maxVersion < mark.version) {
    const err = new Error('issuer-history file is shorter than the anchored high-water mark');
    err.code = 'issuer_history_truncated';
    throw err;
  }
  const row = versions.find((item) => Number(item.version) === mark.version);
  if (row && row.head_hash !== mark.head_hash) throw issuerHistoryRewriteError();
}

function recordGrandfatherNote(spec) {
  const entry = {
    schema: 'chit402.issuer_history_note.v1',
    kind: 'grandfathered_rewrite',
    from_head: spec.from,
    to_head: spec.to,
    note: spec.note,
  };
  const key = `${entry.from_head}>${entry.to_head}`;
  if (historyStore.notes.some((row) => `${row.from_head}>${row.to_head}` === key)) return entry;
  historyStore.notes.push(entry);
  const file = notesFile();
  if (historyStore.persist && file) fs.appendFileSync(file, `${JSON.stringify(entry)}\n`);
  return entry;
}

function loadNotes() {
  historyStore.notes = [];
  const file = notesFile();
  if (!file || !fs.existsSync(file)) return;
  for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
    if (!line.trim()) continue;
    try {
      const row = JSON.parse(line);
      if (row && row.kind === 'grandfathered_rewrite') historyStore.notes.push(row);
    } catch {
      /* a torn last line is ignored */
    }
  }
}

export function issuerHistoryNotes() {
  return historyStore.notes.slice();
}

/**
 * The one recorded rewrite (prod 2026-10, v1 genesis custody field dropped in v2).
 * Both versions stay served. The note is appended beside the log. Any other
 * non-extending pair on disk fails closed.
 */
const GRANDFATHERED_REWRITES = [
  {
    from: '3d8259fb043f8ac80c924ea89d508f0a898f70bd0335658ef47370d5757e27a6',
    to: '349d7bb495bad55aaa25d05ee91134575e6e7d300795b37b41f4bcf29af80f0e',
    note: 'Prod 2026-10: issuer-history v2 dropped the custody field from the v1 genesis entry (head 3d8259fb rewritten to 349d7bb4). Both versions stay served. This is the only grandfathered rewrite.',
  },
];

function grandfatherNote(prev, next) {
  const from = prev?.head_hash;
  const to = next?.head_hash;
  return GRANDFATHERED_REWRITES.find((row) => row.from === from && row.to === to) || null;
}

function assertLoadedVersionsExtend(versions) {
  for (let i = 1; i < versions.length; i += 1) {
    const prev = versions[i - 1];
    const next = versions[i];
    if (Number(next.version) !== Number(prev.version) + 1) {
      const err = new Error('issuer-history versions on disk are not consecutive');
      err.code = 'issuer_history_rewrite';
      throw err;
    }
    const note = grandfatherNote(prev, next);
    if (entriesExtend(sealedEntriesOf(prev), sealedEntriesOf(next))) continue;
    if (note) {
      recordGrandfatherNote(note);
      continue;
    }
    throw issuerHistoryRewriteError();
  }
}

function loadHistoryStore() {
  const file = historyFile();
  loadNotes();
  refreshHighWater();
  if (!file || !fs.existsSync(file)) {
    assertHighWater(historyStore.versions);
    return;
  }
  try {
    loadHistoryRows(file);
    assertLoadedVersionsExtend(historyStore.versions);
    assertHighWater(historyStore.versions);
  } catch (err) {
    historyStore.versions = [];
    throw err;
  }
}

function loadHistoryRows(file) {
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
  historyStore.suppressPersist = false;
  historyStore.versions = [];
  historyStore.highWater = null;
  historyStore.ignoredRewrite = false;
  historyStore.notes = [];
  if (historyStore.persist) {
    fs.mkdirSync(historyStore.dir, { recursive: true });
    loadHistoryStore();
  }
}

/** Test helper. Does not delete a configured directory's file. */
export function resetIssuerHistoryStore() {
  historyStore.versions = [];
  historyStore.suppressPersist = false;
  historyStore.ignoredRewrite = false;
  historyStore.notes = [];
  if (!historyStore.persist) historyStore.highWater = null;
}

function persistHistoryRecord(record) {
  const file = historyFile();
  if (!historyStore.persist || historyStore.suppressPersist || !file) return;
  fs.appendFileSync(file, `${JSON.stringify(record)}\n`);
}

/**
 * The snapshot in effect now. A matching entry chain reuses the sealed
 * bytes. A different chain appends the next version.
 * @returns {{ version: number, seq: number, hash: string, fingerprint: string, head_hash: string, body: string }}
 */
function sealedEntriesOf(record) {
  if (!record?.body) return [];
  try {
    const entries = JSON.parse(record.body).entries;
    return Array.isArray(entries) ? entries : [];
  } catch {
    return [];
  }
}

function tailKid(entries) {
  if (!Array.isArray(entries) || entries.length === 0) return null;
  return entries[entries.length - 1]?.kid || null;
}

/**
 * A test process mints a new key that is not in the sealed chain only when
 * ISSUER_HISTORY_TEST_ROTATION=true. Production never drops. A development
 * process pointed at a prod directory does not drop unless that flag is set.
 * @param {{ body?: string }|null} latest
 * @param {object[]} previewEntries
 */
function dropUnrelatedProcessKey(latest, previewEntries) {
  if (!latest || isProductionIssuerEnv() || !testRotationAllowed()) return false;
  const sealed = sealedEntriesOf(latest);
  if (entriesExtend(sealed, previewEntries)) return false;
  const liveTail = tailKid(previewEntries);
  if (!liveTail) return false;
  if (sealed.some((entry) => entry?.kid === liveTail)) return false;
  historyStore.versions = [];
  historyStore.suppressPersist = true;
  historyStore.highWater = null;
  return true;
}

export function currentIssuerHistory() {
  const preview = buildIssuerHistory();
  const fingerprint = sealFingerprint(preview);
  let latest = historyStore.versions[historyStore.versions.length - 1] || null;
  if (latest && latest.fingerprint === fingerprint) return latest;
  if (latest && dropUnrelatedProcessKey(latest, preview.entries)) latest = null;
  if (latest && entriesExtend(preview.entries, sealedEntriesOf(latest))
    && !entriesExtend(sealedEntriesOf(latest), preview.entries)) {
    // The sealed chain already extends the live prefix (a retire or revoke
    // append). Signing keeps those bytes. It does not mint a shorter version.
    return latest;
  }
  if (latest && !entriesExtend(sealedEntriesOf(latest), preview.entries)) {
    const sealed = sealedEntriesOf(latest);
    const liveTail = tailKid(preview.entries);
    if (liveTail && sealed.some((entry) => entry?.kid === liveTail)) {
      // An in-place edit of the live entry (ISSUER_HISTORY_EXTRA, not_before)
      // must not replace sealed bytes and must not stop signing.
      historyStore.ignoredRewrite = true;
      return latest;
    }
    throw issuerHistoryRewriteError();
  }
  const version = (latest?.version || 0) + 1;
  const seq = version;
  const doc = buildIssuerHistory({ version, seq });
  if (latest && !entriesExtend(sealedEntriesOf(latest), doc.entries)) {
    throw issuerHistoryRewriteError();
  }
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
  raiseHighWater(record);
  return record;
}

/**
 * Append entries after the sealed prefix and store the next snapshot.
 * A chain that does not extend, a new key that reuses an older not_before,
 * or a document signed by the key it introduces is refused.
 * @param {object[]} rawEntries
 */
export function sealExtendingIssuerHistory(rawEntries) {
  if (!Array.isArray(rawEntries) || rawEntries.length === 0) {
    const err = new Error('issuer history extension needs a new entry');
    err.code = 'issuer_history_extension';
    throw err;
  }
  const latest = currentIssuerHistory();
  const prefix = sealedEntriesOf(latest);
  let prev = prefix.length ? prefix[prefix.length - 1].entry_hash : null;
  const added = [];
  for (const raw of rawEntries) {
    const body = issuerHistoryEntryBody({ ...raw, prev_hash: prev });
    const entry_hash = issuerHistoryEntryHash(body);
    added.push({ ...body, entry_hash });
    prev = entry_hash;
  }
  const chained = [...prefix, ...added];
  if (!entriesExtend(prefix, chained) || chained.length === prefix.length) {
    throw issuerHistoryRewriteError();
  }
  const version = latest.version + 1;
  const doc = buildIssuerHistory({ version, seq: version, sealedEntries: chained });
  const verified = verifyIssuerHistory(doc);
  if (!verified.valid) {
    const err = new Error(`issuer history extension refused: ${verified.reason}`);
    err.code = verified.reason || 'issuer_history_invalid';
    throw err;
  }
  const body = jcsCanonicalize(doc);
  const record = {
    version,
    seq: version,
    hash: historySha256(body),
    entries_snapshot_hash: historyEntriesSnapshotHash(doc.entries),
    fingerprint: sealFingerprint(doc),
    head_hash: doc.head_hash,
    body,
  };
  historyStore.versions.push(record);
  persistHistoryRecord(record);
  raiseHighWater(record);
  return record;
}

/**
 * Append a retire or revoke entry for the live signing key.
 * The previous key signs the new snapshot. An in-place edit is not used.
 * @param {{ status?: string, not_before: string, not_after?: string|null, revoked_at?: string|null, reason?: string|null, custody?: string|null, kid?: string|null }} spec
 */
export function retireOrRevokeIssuerKey(spec = {}) {
  const status = spec.status === 'revoked' ? 'revoked' : 'retired';
  const latest = currentIssuerHistory();
  const doc = JSON.parse(latest.body);
  const kid = spec.kid || getIssuerKid();
  const prior = [...(doc.entries || [])].reverse().find((entry) => entry.kid === kid);
  if (!prior) {
    const err = new Error('issuer key is not in the sealed history');
    err.code = 'kid_not_in_history';
    throw err;
  }
  if (status === 'revoked' && !spec.revoked_at) {
    const err = new Error('revoked_at is required to revoke an issuer key');
    err.code = 'revoked_at_missing';
    throw err;
  }
  if (!spec.not_before) {
    const err = new Error('not_before is required to retire or revoke an issuer key');
    err.code = 'not_before_missing';
    throw err;
  }
  if (kidStatusRegression([...(doc.entries || []), { kid, status }])) {
    const err = new Error('issuer key status cannot move backwards');
    err.code = 'kid_status_regression';
    throw err;
  }
  return sealExtendingIssuerHistory([{
    kid,
    jwk: prior.jwk,
    alg: prior.alg || 'ES256',
    not_before: spec.not_before,
    not_after: spec.not_after ?? null,
    status,
    revoked_at: status === 'revoked' ? spec.revoked_at : null,
    reason: spec.reason ?? null,
    custody: spec.custody || prior.custody || 'operator retire',
  }]);
}

/**
 * Boot check. A revoked or retired signing key refuses to serve.
 * A stale in-place edit does not. Call after the history store is loaded
 * and before listen.
 */
export function assertIssuerHistoryBoot() {
  const record = currentIssuerHistory();
  const doc = JSON.parse(record.body);
  const kid = getIssuerKid();
  if (kidStatusRegression(doc.entries)) {
    const err = new Error('issuer history status moved backwards');
    err.code = 'kid_status_regression';
    throw err;
  }
  const rows = (doc.entries || []).filter((row) => row.kid === kid);
  if (!rows.length) {
    const err = new Error('signing key is not in issuer history');
    err.code = 'kid_not_in_history';
    throw err;
  }
  if (rows.some((row) => row.status === 'revoked' || row.status === 'retired')) {
    const status = rows.some((row) => row.status === 'revoked') ? 'revoked' : 'retired';
    const err = new Error(`signing key is ${status}; refusing to serve`);
    err.code = 'issuer_key_not_active';
    throw err;
  }
  return { ok: true, kid, status: 'active', ignoredRewrite: historyStore.ignoredRewrite === true };
}

/**
 * Pin written into a new receipt or refusal JWS.
 * Payload version 10 pins the whole-document hash. v11 and refusal v2 pin
 * the entries snapshot hash. The chain-head pin is not issued on this line.
 * @param {number|null} [_payloadVersion]
 * @returns {{ hash: string, version: number, seq: number }}
 */
export function currentHistoryPin(_payloadVersion = null) {
  const record = currentIssuerHistory();
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
  // A live chain that would rewrite a sealed entry must not hide the bytes
  // already stored. Old versions stay fetchable.
  try {
    currentIssuerHistory();
  } catch (err) {
    if (err?.code !== 'issuer_history_rewrite') throw err;
  }
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
  const keys = query && typeof query === 'object' ? Object.keys(query) : [];
  for (const key of keys) {
    if (!ISSUER_HISTORY_QUERY_KEYS.has(key)) {
      return res.status(400).json({
        error: 'bad_query',
        message: 'issuer-history accepts only version and hash. seq and other parameters are rejected.',
      });
    }
  }
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
