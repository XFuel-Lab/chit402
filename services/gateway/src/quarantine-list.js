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
import { computeJwkThumbprint, ephemeralIssuerKid, jwsSigningInput, verifyJwsWithJwks } from './issuer-key.js';
import { PRODUCTION_ISSUER_KID } from './issuer-history.js';
import { peekIssuerSigner } from './issuer-signer-state.js';
import { isProductionIssuerPublicKey, nodeEnvIsProduction, wellFormedPublicJwk } from './production-process.js';
import { issuerMaterialKid, loadedIssuerKid, testIssuerKids } from './production-process.js';

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

/**
 * Issuer history entries named in ISSUER_HISTORY_EXTRA (either env): their
 * keys are refused too. A set value that does not parse, is not a list, or
 * has an entry without a well-formed P-256 `jwk` is `malformed`: the guard
 * refuses rather than skipping it.
 */
function historyExtraKeys(...envs) {
  const keys = [];
  let malformed = false;
  for (const e of envs) {
    const raw = e?.ISSUER_HISTORY_EXTRA;
    if (raw == null || !String(raw).trim()) continue;
    let parsed;
    try {
      parsed = JSON.parse(raw);
    } catch {
      malformed = true;
      continue;
    }
    const list = Array.isArray(parsed) ? parsed : parsed?.entries;
    if (!Array.isArray(list)) {
      malformed = true;
      continue;
    }
    for (const entry of list) {
      if (!entry || typeof entry !== 'object' || !wellFormedPublicJwk(entry.jwk)) {
        malformed = true;
        continue;
      }
      keys.push(entry.jwk);
    }
  }
  return { keys, malformed };
}

function kmsSetting(e) {
  return String(e?.ISSUER_SIGNER || '').trim().toLowerCase() === 'kms';
}

/**
 * Which issuer the list may be signed with. Only a stub or test signer: a
 * production environment (NODE_ENV unset or anything but test/development),
 * the KMS signer (ISSUER_SIGNER=kms or an active KMS signer), the production
 * kid, and any production public key (matched by x/y against every key in
 * the published issuer history and ISSUER_HISTORY_EXTRA, whatever its kid)
 * are always refused. The passed `env` and this process's own env are both
 * checked, because the key is loaded from process.env. There is no override
 * of any kind: --apply --confirm YES, extra flags and extra env vars change
 * nothing. Signing list v1 with the production issuer is a later, separately
 * reviewed host step, not this script.
 * @param {{ env?: NodeJS.ProcessEnv, kid?: string|null, signerKind?: string|null, publicJwk?: { x?: string, y?: string, crv?: string }|null }} [opts]
 * @returns {{ ok: true } | { ok: false, reason: string }}
 */
export function quarantineSignGuard({ env = process.env, kid = null, signerKind = null, publicJwk = null } = {}) {
  // null, not undefined: an unset NODE_ENV must not fall back to this process's value.
  if (nodeEnvIsProduction(env.NODE_ENV ?? null)) return { ok: false, reason: 'production_env' };
  if (nodeEnvIsProduction(process.env.NODE_ENV ?? null)) return { ok: false, reason: 'production_env' };
  if (kmsSetting(env) || kmsSetting(process.env)) return { ok: false, reason: 'kms_signer' };
  if (signerKind != null && String(signerKind).toLowerCase() === 'kms') return { ok: false, reason: 'kms_signer' };
  if (kid != null && kid === PRODUCTION_ISSUER_KID) return { ok: false, reason: 'production_kid' };
  for (const e of [env, process.env]) {
    if (String(e?.ISSUER_KID || '').trim() === PRODUCTION_ISSUER_KID) return { ok: false, reason: 'production_kid' };
  }
  const extra = historyExtraKeys(env, process.env);
  if (extra.malformed) return { ok: false, reason: 'history_extra_malformed' };
  if (publicJwk && isProductionIssuerPublicKey(publicJwk, extra.keys)) {
    return { ok: false, reason: 'production_key' };
  }
  // ISSUER_TEST_KEY is ignored here. Only two kinds of key sign: a known test
  // key (testIssuerKids, derived from public seeds), or the ephemeral key that
  // issuer-key.js generated in this process because no key material was set
  // (ephemeralIssuerKid, recorded in issuer-key's own state, never read from
  // env). A stub signer must use a known test key. Every check below runs on
  // every call, whatever the env holds now: the signer's public key by its
  // own thumbprint, the claimed kid, ISSUER_PRIVATE_KEY and ISSUER_KID in
  // either env, and the key issuer-key loaded. So a key that was loaded or
  // installed in-process and then had its env vars removed is still refused,
  // and an unlisted key, including a new production key not yet in
  // PRODUCTION_ISSUER_PUBLIC_KEYS, never signs.
  const testKids = testIssuerKids();
  const ephemeral = ephemeralIssuerKid();
  const allowed = (k) => testKids.has(k) || (ephemeral != null && k === ephemeral);
  if (publicJwk) {
    let thumb = null;
    try {
      thumb = wellFormedPublicJwk(publicJwk) ? computeJwkThumbprint({ kty: 'EC', crv: 'P-256', x: publicJwk.x, y: publicJwk.y }) : null;
    } catch {
      thumb = null;
    }
    if (!thumb || !allowed(thumb)) return { ok: false, reason: 'not_test_key' };
  }
  if (kid != null && !allowed(String(kid))) return { ok: false, reason: 'not_test_key' };
  for (const e of [env, process.env]) {
    const material = e?.ISSUER_PRIVATE_KEY;
    if (material != null && String(material).trim() && !testKids.has(issuerMaterialKid(material))) {
      return { ok: false, reason: 'not_test_key' };
    }
    const configured = String(e?.ISSUER_KID || '').trim();
    if (configured && !testKids.has(configured)) return { ok: false, reason: 'not_test_key' };
  }
  const loaded = loadedIssuerKid();
  if (loaded && !allowed(loaded)) return { ok: false, reason: 'not_test_key' };
  return { ok: true };
}

function guardError(reason) {
  const err = new Error(`quarantine list signing refused (${reason}); only a stub or test signer may sign here`);
  err.code = 'quarantine_sign_refused';
  err.reason = reason;
  return err;
}

/**
 * Sign with the active issuer signer (JWS path). Ops script and tests only.
 * Always refuses a production environment, the KMS signer and the production
 * kid (quarantineSignGuard), checked before the signer is created and again
 * on the active signer's kind and kid. No override exists.
 * @param {object} doc from buildQuarantineList
 * @param {{ env?: NodeJS.ProcessEnv }} [opts]
 * @returns {Promise<string>} stored bytes
 */
export async function signQuarantineList(doc, { env = process.env } = {}) {
  // Each signer property is read once, into a snapshot of plain values. The
  // guards, the kid in the JWS header and the post-sign verify all use only
  // the snapshot, so a getter cannot show the guard one key and kid and then
  // sign or label with another. After the snapshot, the signer object is
  // touched only to call sign().
  const peeked = peekIssuerSigner();
  const peekedSnap = peeked ? signerSnapshot(peeked) : null;
  const first = quarantineSignGuard({
    env,
    kid: peekedSnap?.kid ?? null,
    signerKind: peekedSnap?.kind ?? null,
    publicJwk: peekedSnap?.publicJwk ?? null,
  });
  if (!first.ok) throw guardError(first.reason);
  const active = peeked || await (await import('./issuer-signer.js')).initIssuerSigner(env);
  const snap = peeked ? peekedSnap : signerSnapshot(active);
  const second = quarantineSignGuard({
    env,
    kid: snap.kid,
    signerKind: snap.kind,
    publicJwk: snap.publicJwk,
  });
  if (!second.ok) throw guardError(second.reason);
  if (snap.accessor) throw guardError('signer_accessor');
  // The guard judged the signer by the public key it reports, so it must report one.
  if (!snap.publicJwk) throw guardError('no_public_key');
  if (snap.kid == null) throw guardError('no_kid');
  const signingInput = jwsSigningInput(quarantineListClaims(doc), { typ: QUARANTINE_LIST_TYP, kid: snap.kid });
  const signature = await snap.sign(Buffer.from(signingInput, 'utf8'));
  if (!Buffer.isBuffer(signature) || signature.length !== 64) throw guardError('issuer_sign_invalid');
  const jws = `${signingInput}.${signature.toString('base64url')}`;
  if (jwsHeader(jws)?.kid !== snap.kid) throw guardError('signer_changed');
  // The signature must verify under the public key the guard judged, so a
  // signer that reports a test or ephemeral key but signs with another
  // private key is refused.
  const reported = { kty: 'EC', crv: 'P-256', x: snap.publicJwk.x, y: snap.publicJwk.y, kid: snap.kid, alg: 'ES256' };
  if (!verifyJwsWithJwks(jws, { keys: [reported] }).valid) throw guardError('signer_mismatch');
  return jcsRfc8785({
    ...doc,
    issuer_signature: { alg: 'ES256', typ: QUARANTINE_LIST_TYP, kid: snap.kid, jws },
  });
}

/** True when `name` is a getter or setter on `obj` or its prototype chain. */
function hasAccessor(obj, name) {
  for (let o = obj; o && typeof o === 'object'; o = Object.getPrototypeOf(o)) {
    const d = Object.getOwnPropertyDescriptor(o, name);
    if (d) return Boolean(d.get || d.set);
  }
  return false;
}

/**
 * Plain copies of a signer's kind, kid and public key x/y, each property read
 * exactly once, plus a bound sign() on the same object. `accessor` is true
 * when any of them is a getter or setter: real signers (env, KMS, test stubs)
 * are plain objects, so a getter there is refused rather than trusted.
 */
function signerSnapshot(signer) {
  if (!signer) return { kind: null, kid: null, publicJwk: null, sign: null, accessor: false };
  const kind = signer.kind;
  const kid = signer.kid;
  const pub = signer.publicJwk;
  const sign = signer.sign;
  let accessor = ['kind', 'kid', 'publicJwk', 'sign'].some((n) => hasAccessor(signer, n));
  let publicJwk = null;
  if (pub && typeof pub === 'object') {
    const x = pub.x;
    const y = pub.y;
    accessor = accessor || hasAccessor(pub, 'x') || hasAccessor(pub, 'y');
    publicJwk = { x: typeof x === 'string' ? x : null, y: typeof y === 'string' ? y : null };
  }
  return {
    accessor,
    kind: kind == null ? null : String(kind),
    kid: kid == null ? null : String(kid),
    publicJwk,
    sign: typeof sign === 'function' ? (input) => sign.call(signer, input) : async () => { throw guardError('issuer_sign_invalid'); },
  };
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
  // The outer labels must say what the JWS header says: ES256, same kid.
  if (sig.alg !== 'ES256' || header?.alg !== 'ES256') return { ok: false, reason: 'alg' };
  if (typeof sig.kid !== 'string' || !sig.kid || sig.kid !== header?.kid) return { ok: false, reason: 'kid' };
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

/**
 * A list that exists but cannot be read is an error, never "no list": the
 * list is a deny list, so reading it as empty would let excluded heads back in.
 */
function unreadable(err, what) {
  const out = coded(`quarantine list ${what} cannot be read (${err?.code || 'error'})`, 'quarantine_list_unreadable');
  out.cause = err;
  return out;
}

/**
 * Sorted version numbers present on disk. Empty only when the directory does
 * not exist (ENOENT); any other read error throws quarantine_list_unreadable.
 */
export function quarantineListVersions(dir) {
  let names = [];
  try {
    names = fs.readdirSync(dir);
  } catch (err) {
    if (err?.code === 'ENOENT') return [];
    throw unreadable(err, 'directory');
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
  try {
    return { version: want, bytes: fs.readFileSync(path.join(dir, `v${want}.json`), 'utf8') };
  } catch (err) {
    throw unreadable(err, `version ${want}`);
  }
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
 * Entries of every stored version, for refusal R-2. Read only. Empty only
 * when no list exists; an unreadable or unparseable list throws
 * quarantine_list_unreadable, so the caller refuses rather than signs.
 * @param {string} dir
 */
export function quarantinedTriples(dir) {
  const latest = readQuarantineList(dir);
  if (!latest) return [];
  let doc;
  try {
    doc = JSON.parse(latest.bytes);
  } catch (err) {
    throw unreadable(err, `version ${latest.version}`);
  }
  if (!doc || !Array.isArray(doc.entries)) throw unreadable({ code: 'no_entries' }, `version ${latest.version}`);
  return doc.entries.map((e) => ({ epoch: e.epoch, tree_size: e.tree_size, root: e.root }));
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
