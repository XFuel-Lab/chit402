/**
 * Quarantine list: chit402.quarantine_list.v1.
 *
 * A signed, append-only list of tree heads that the log excludes (today the
 * publish/append race class: a size-N label on a size-(N-1) root).
 *
 * - Canonicalization is RFC 8785 through jcsRfc8785. The served bytes are the
 *   stored bytes; two reads are byte-identical.
 * - entries_hash = sha256(jcsRfc8785(entries)). The JWS (typ
 *   chit402-quarantine-list+jwt) signs { schema, version, seq,
 *   prev_list_hash, entries_hash, high_water, entry_count }.
 * - Version N+1 carries every entry of version N byte for byte, in order,
 *   and prev_list_hash = sha256(stored bytes of version N).
 * - Versions are sealed files v<N>.json, created once with O_EXCL.
 * - Signing happens only in scripts/sign-quarantine-list.mjs, run at the
 *   host. The gateway never signs a list, and GET only reads stored bytes.
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { jcsRfc8785 } from './offer-receipt.js';
import { isProductionIssuerEnv, signJwsAsync, verifyJwsWithJwks } from './issuer-key.js';
import { PRODUCTION_ISSUER_KID } from './issuer-history.js';
import { peekIssuerSigner } from './issuer-signer-state.js';

export const QUARANTINE_LIST_SCHEMA = 'chit402.quarantine_list.v1';
export const QUARANTINE_LIST_TYP = 'chit402-quarantine-list+jwt';
export const QUARANTINE_LIST_CANONICALIZATION = 'RFC 8785 (jcsRfc8785)';
export const QUARANTINE_LIST_DIRNAME = 'quarantine-list';

const ROOT_HEX = /^[0-9a-f]{64}$/;
const VERSION_FILE = /^v([1-9]\d*)\.json$/;

function coded(message, code) {
  const err = new Error(message);
  err.code = code;
  return err;
}

function sha256Hex(text) {
  return crypto.createHash('sha256').update(Buffer.from(text, 'utf8')).digest('hex');
}

function isCount(n) {
  return Number.isSafeInteger(n) && n >= 0;
}

function checkEntry(entry) {
  const ok = entry
    && isCount(entry.epoch)
    && isCount(entry.tree_size) && entry.tree_size > 0
    && typeof entry.root === 'string' && ROOT_HEX.test(entry.root)
    && isCount(entry.prefix_size) && entry.prefix_size < entry.tree_size
    && typeof entry.reason === 'string' && entry.reason.length > 0
    && entry.consistency && typeof entry.consistency === 'object'
    && entry.consistency.first === entry.prefix_size
    && isCount(entry.consistency.second) && entry.consistency.second >= entry.prefix_size
    && typeof entry.consistency.second_root === 'string' && ROOT_HEX.test(entry.consistency.second_root)
    && Array.isArray(entry.consistency.proof)
    && entry.consistency.proof.every((p) => typeof p === 'string' && ROOT_HEX.test(p))
    && typeof entry.quarantine_ack_jws === 'string' && entry.quarantine_ack_jws.split('.').length === 3;
  if (!ok) throw coded('quarantine list entry is malformed', 'quarantine_list_entry');
}

function checkHighWater(rows, entries) {
  if (!Array.isArray(rows)) throw coded('high_water must be a list', 'quarantine_list_high_water');
  const byEpoch = new Map();
  for (const row of rows) {
    if (!row || !isCount(row.epoch) || !isCount(row.tree_size) || typeof row.root !== 'string' || !ROOT_HEX.test(row.root)) {
      throw coded('high_water row is malformed', 'quarantine_list_high_water');
    }
    if (byEpoch.has(row.epoch)) throw coded('high_water repeats an epoch', 'quarantine_list_high_water');
    byEpoch.set(row.epoch, row);
  }
  for (const entry of entries) {
    const hw = byEpoch.get(entry.epoch);
    if (!hw || entry.tree_size > hw.tree_size) {
      throw coded('an entry is above the high-water mark for its epoch', 'quarantine_list_high_water');
    }
  }
}

/** The claims the JWS signs. */
export function quarantineListClaims(doc) {
  return {
    schema: doc.schema,
    version: doc.version,
    seq: doc.seq,
    prev_list_hash: doc.prev_list_hash,
    entries_hash: doc.entries_hash,
    high_water: doc.high_water,
    entry_count: doc.entries.length,
  };
}

/**
 * Unsigned document for the next version.
 * @param {{ entries: object[], highWater: object[], prevBytes?: string|null }} input
 */
export function buildQuarantineList({ entries, highWater, prevBytes = null }) {
  if (!Array.isArray(entries)) throw coded('entries must be a list', 'quarantine_list_entry');
  entries.forEach(checkEntry);
  checkHighWater(highWater, entries);
  let version = 1;
  let prevHash = null;
  if (prevBytes != null) {
    const prev = JSON.parse(prevBytes);
    if (prev?.schema !== QUARANTINE_LIST_SCHEMA || !Number.isSafeInteger(prev.version)) {
      throw coded('previous list is not a quarantine list', 'quarantine_list_prev');
    }
    const prevEntries = prev.entries || [];
    if (entries.length < prevEntries.length) throw coded('a version may not drop entries', 'quarantine_list_append_only');
    for (let i = 0; i < prevEntries.length; i += 1) {
      if (jcsRfc8785(prevEntries[i]) !== jcsRfc8785(entries[i])) {
        throw coded('a version must keep every prior entry byte for byte', 'quarantine_list_append_only');
      }
    }
    version = prev.version + 1;
    prevHash = sha256Hex(prevBytes);
  }
  return {
    schema: QUARANTINE_LIST_SCHEMA,
    version,
    seq: version,
    prev_list_hash: prevHash,
    canonicalization: QUARANTINE_LIST_CANONICALIZATION,
    high_water: highWater.map((row) => ({ epoch: row.epoch, tree_size: row.tree_size, root: row.root })),
    entries,
    entries_hash: sha256Hex(jcsRfc8785(entries)),
  };
}

/** Env var and flag that must BOTH be present to sign with a production or KMS issuer. */
export const QUARANTINE_SIGN_ALLOW_ENV = 'QUARANTINE_SIGN_ALLOW_PRODUCTION';
export const QUARANTINE_SIGN_ALLOW_FLAG = '--allow-production-issuer';

/**
 * Which issuer the list may be signed with. A production environment
 * (NODE_ENV unset or anything but test/development), the KMS signer, or the
 * production kid is refused unless QUARANTINE_SIGN_ALLOW_PRODUCTION=1 AND
 * --allow-production-issuer are both given. --apply --confirm YES is not an
 * allow.
 * @param {{ env?: NodeJS.ProcessEnv, argv?: string[], kid?: string|null }} [opts]
 * @returns {{ ok: true, allowed: boolean } | { ok: false, reason: string }}
 */
export function quarantineSignGuard({ env = process.env, argv = process.argv, kid = null } = {}) {
  const allowed = env[QUARANTINE_SIGN_ALLOW_ENV] === '1' && Array.isArray(argv) && argv.includes(QUARANTINE_SIGN_ALLOW_FLAG);
  let reason = null;
  // null, not undefined: an unset NODE_ENV must not fall back to this process's value.
  if (isProductionIssuerEnv(env.NODE_ENV ?? null)) reason = 'production_env';
  else if (String(env.ISSUER_SIGNER || '').trim().toLowerCase() === 'kms') reason = 'kms_signer';
  else if (kid != null && kid === PRODUCTION_ISSUER_KID) reason = 'production_kid';
  if (reason && !allowed) return { ok: false, reason };
  return { ok: true, allowed: Boolean(reason) };
}

function guardError(reason) {
  const err = new Error(`quarantine list signing refused (${reason}); a production or KMS issuer needs ${QUARANTINE_SIGN_ALLOW_ENV}=1 and ${QUARANTINE_SIGN_ALLOW_FLAG}`);
  err.code = 'quarantine_sign_refused';
  err.reason = reason;
  return err;
}

/**
 * Sign with the active issuer signer (JWS path). Ops script only. Refuses a
 * production or KMS issuer unless both allows are given (quarantineSignGuard),
 * checked before the signer is created and again on its kid.
 * @param {object} doc from buildQuarantineList
 * @param {{ env?: NodeJS.ProcessEnv, argv?: string[] }} [opts]
 * @returns {Promise<string>} stored bytes
 */
export async function signQuarantineList(doc, { env = process.env, argv = process.argv } = {}) {
  const first = quarantineSignGuard({ env, argv });
  if (!first.ok) throw guardError(first.reason);
  const active = peekIssuerSigner() || await (await import('./issuer-signer.js')).initIssuerSigner(env);
  const second = quarantineSignGuard({ env, argv, kid: active?.kid ?? null });
  if (!second.ok) throw guardError(second.reason);
  const { jws, kid } = await signJwsAsync(quarantineListClaims(doc), { typ: QUARANTINE_LIST_TYP });
  if (kid !== active?.kid) throw guardError('signer_changed');
  return jcsRfc8785({
    ...doc,
    issuer_signature: { alg: 'ES256', typ: QUARANTINE_LIST_TYP, kid, jws },
  });
}

function jwsPayload(jws) {
  try {
    return JSON.parse(Buffer.from(String(jws).split('.')[1], 'base64url').toString('utf8'));
  } catch {
    return null;
  }
}

function jwsHeader(jws) {
  try {
    return JSON.parse(Buffer.from(String(jws).split('.')[0], 'base64url').toString('utf8'));
  } catch {
    return null;
  }
}

/**
 * @param {string} bytes stored document
 * @param {{ keys: object[] }} jwks
 * @param {{ prevBytes?: string|null }} [opts]
 * @returns {{ ok: true, doc: object } | { ok: false, reason: string }}
 */
export function verifyQuarantineList(bytes, jwks, { prevBytes = null } = {}) {
  let doc;
  try {
    doc = JSON.parse(bytes);
  } catch {
    return { ok: false, reason: 'parse' };
  }
  if (jcsRfc8785(doc) !== bytes) return { ok: false, reason: 'not_canonical' };
  if (doc.schema !== QUARANTINE_LIST_SCHEMA || doc.canonicalization !== QUARANTINE_LIST_CANONICALIZATION) {
    return { ok: false, reason: 'schema' };
  }
  try {
    (doc.entries || []).forEach(checkEntry);
    checkHighWater(doc.high_water, doc.entries || []);
  } catch (err) {
    return { ok: false, reason: err.code || 'entry' };
  }
  if (doc.entries_hash !== sha256Hex(jcsRfc8785(doc.entries))) return { ok: false, reason: 'entries_hash' };
  const sig = doc.issuer_signature || {};
  const header = jwsHeader(sig.jws);
  if (sig.typ !== QUARANTINE_LIST_TYP || header?.typ !== QUARANTINE_LIST_TYP) return { ok: false, reason: 'typ' };
  const checked = verifyJwsWithJwks(sig.jws, jwks);
  if (!checked.valid) return { ok: false, reason: 'signature' };
  if (jcsRfc8785(jwsPayload(sig.jws)) !== jcsRfc8785(quarantineListClaims(doc))) {
    return { ok: false, reason: 'claims' };
  }
  if (prevBytes != null) {
    let prev;
    try {
      prev = JSON.parse(prevBytes);
    } catch {
      return { ok: false, reason: 'prev_parse' };
    }
    if (doc.version !== prev.version + 1 || doc.prev_list_hash !== sha256Hex(prevBytes)) {
      return { ok: false, reason: 'prev_list_hash' };
    }
    const prevEntries = prev.entries || [];
    for (let i = 0; i < prevEntries.length; i += 1) {
      if (!doc.entries[i] || jcsRfc8785(prevEntries[i]) !== jcsRfc8785(doc.entries[i])) {
        return { ok: false, reason: 'append_only' };
      }
    }
  } else if (doc.version === 1 && doc.prev_list_hash !== null) {
    return { ok: false, reason: 'prev_list_hash' };
  }
  return { ok: true, doc };
}

/** @param {string} logDir */
export function quarantineListDir(logDir) {
  return path.join(logDir, QUARANTINE_LIST_DIRNAME);
}

/** Sorted version numbers present on disk. */
export function quarantineListVersions(dir) {
  let names = [];
  try {
    names = fs.readdirSync(dir);
  } catch {
    return [];
  }
  return names
    .map((name) => VERSION_FILE.exec(name))
    .filter(Boolean)
    .map((m) => Number(m[1]))
    .filter((n) => Number.isSafeInteger(n))
    .sort((a, b) => a - b);
}

/**
 * Stored bytes for a version, or the latest when version is null.
 * @returns {{ version: number, bytes: string } | null}
 */
export function readQuarantineList(dir, version = null) {
  const versions = quarantineListVersions(dir);
  if (versions.length === 0) return null;
  const want = version == null ? versions[versions.length - 1] : version;
  if (!versions.includes(want)) return null;
  return { version: want, bytes: fs.readFileSync(path.join(dir, `v${want}.json`), 'utf8') };
}

/**
 * Seal a new version. Refuses to overwrite and refuses a gap.
 * @param {string} dir
 * @param {string} bytes
 */
export function writeQuarantineListVersion(dir, bytes) {
  const doc = JSON.parse(bytes);
  const versions = quarantineListVersions(dir);
  const next = versions.length ? versions[versions.length - 1] + 1 : 1;
  if (doc.version !== next) throw coded(`next version must be ${next}`, 'quarantine_list_version');
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  const file = path.join(dir, `v${next}.json`);
  const fd = fs.openSync(file, fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL, 0o644);
  try {
    fs.writeSync(fd, bytes);
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
  return { version: next, file };
}

/**
 * Entries of every stored version, for refusal R-2. Read only.
 * @param {string} dir
 */
export function quarantinedTriples(dir) {
  const latest = readQuarantineList(dir);
  if (!latest) return [];
  try {
    const doc = JSON.parse(latest.bytes);
    return (doc.entries || []).map((e) => ({ epoch: e.epoch, tree_size: e.tree_size, root: e.root }));
  } catch {
    return [];
  }
}

/**
 * GET /.well-known/quarantine-list.json. Only `version` is accepted. Serves
 * stored bytes. Never signs.
 */
export function writeQuarantineListResponse(res, dir, query = {}) {
  const keys = query && typeof query === 'object' ? Object.keys(query) : [];
  for (const key of keys) {
    if (key !== 'version') {
      return res.status(400).json({ error: 'bad_query', message: 'quarantine-list accepts only version.' });
    }
  }
  let version = null;
  if (keys.includes('version')) {
    const raw = query.version;
    if (typeof raw !== 'string' || !/^[1-9]\d*$/.test(raw) || !Number.isSafeInteger(Number(raw))) {
      return res.status(400).json({ error: 'bad_version', message: 'version must be a positive integer.' });
    }
    version = Number(raw);
  }
  const found = dir ? readQuarantineList(dir, version) : null;
  if (!found) {
    return res.status(404).json({ error: 'not_found', message: 'No quarantine list with that version.' });
  }
  res.set('Cache-Control', version != null ? 'public, max-age=31536000, immutable' : 'public, max-age=300');
  res.set('X-Chit-Hash-Alg', 'sha256');
  res.set('X-Chit-List-Hash', sha256Hex(found.bytes));
  res.set('X-Chit-List-Version', String(found.version));
  res.type('application/json; charset=utf-8');
  return res.send(Buffer.from(found.bytes, 'utf8'));
}
