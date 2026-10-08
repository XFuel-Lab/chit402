/**
 * SaltStore — v11 receipt salts and private fields.
 *
 * Issuance calls get / put / delete on the process store (`getSaltStore`).
 * The salt is not an enumerable request field, a log line, or a plaintext
 * field of the stored record.
 *
 * Two durable shapes share one record envelope
 * `{receipt_id, wrap_kid, alg:'A256GCM', iv, ct, tag}` and the same AAD,
 * the UTF-8 bytes of `v11/salt` concatenated with `receipt_id`.
 *
 * The process store (kind `memory`, or kind `encrypted`) seals the raw
 * 32-byte salt. `iv`, `ct`, and `tag` are base64url. The record has no
 * `salt` field. It lives in this process only. `durable` is false there.
 * A caller cannot set `durable: true` on that store.
 *
 * The file store (kind `encrypted`, `durable` true, on disk) is what
 * production boots when `RECEIPT_SALT_DIR` and a wrap key are set. A
 * partial config (a directory without a key, or a key without a
 * directory) refuses to boot. It does not fall back to memory. The
 * wrap key env is `RECEIPT_SALT_WRAP_KEYS` or
 * `RECEIPT_SALT_WRAP_KEY_FILE`. `SALT_WRAP_KEY` is the single-key alias.
 * Setting that alias beside `RECEIPT_SALT_WRAP_KEYS` refuses to boot.
 * The wrap key must not be the issuer private key. The ciphertext is
 * JSON `{salt, private_fields}`. `iv`, `ct`, and `tag` are base64. The wrap
 * key is loaded from the environment and is never written under the data
 * directory. `wrap_kid` selects the key so a rotated key still opens older
 * rows. Raw prompts and plaintext outputs are rejected.
 *
 * `get` returns the 32-byte salt as a Buffer. `salt` and `privateFields`
 * sit on that buffer as non-enumerable properties so the owner view can
 * read them without a second shape.
 *
 * Production is every NODE_ENV other than `test` and `development`.
 * Unset NODE_ENV is production. Production with the issuer root on refuses
 * v11 issuance unless the active store is the encrypted file store.
 * `ISSUER_ROOT_ENABLED` refuses every in-memory store, including one whose
 * kind is `encrypted`.
 * `SALT_STORE_ALLOW_EPHEMERAL=true` is the local opt-in for the production
 * check only.
 */

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

export const SALT_AAD_LABEL = 'v11/salt';
export const SALT_AAD_PREFIX = SALT_AAD_LABEL;
export const SALT_ALG = 'A256GCM';
export const SALT_RECORD_FIELDS = Object.freeze(['receipt_id', 'wrap_kid', 'alg', 'iv', 'ct', 'tag']);
export const MEMORY_WRAP_KID = 'memory-ephemeral';
/** Idempotency window. A process-local salt is not kept longer than this. */
export const IDEMPOTENCY_WINDOW_MS = 24 * 60 * 60 * 1000;
export const SALT_STORE_PROD_REASON = 'production v11 issuance requires the encrypted SaltStore';

const SALT_LEN = 32;
const GCM_TAG_BYTES = 16;
const CIPHER = 'aes-256-gcm';
const RECORD_KEYS = ['receipt_id', 'wrap_kid', 'alg', 'iv', 'ct', 'tag'];
const BANNED_FIELD_KEYS = new Set([
  'prompt',
  'prompts',
  'messages',
  'output_text',
  'plaintext',
  'plaintext_output',
  'body',
  'raw_body',
  'completion',
  'output',
]);

/**
 * @param {string} receiptId
 * @returns {Buffer}
 */
export function saltAad(receiptId) {
  return Buffer.from(`${SALT_AAD_LABEL}${receiptId}`, 'utf8');
}

function assertNoRaw(value) {
  if (value == null) return;
  if (Array.isArray(value)) {
    for (const item of value) assertNoRaw(item);
    return;
  }
  if (typeof value !== 'object') return;
  for (const [key, child] of Object.entries(value)) {
    if (BANNED_FIELD_KEYS.has(key)) {
      throw new Error(`refusing to store raw field ${key}`);
    }
    assertNoRaw(child);
  }
}

function gcmCipher(key, iv) {
  return crypto.createCipheriv(CIPHER, key, iv, { authTagLength: GCM_TAG_BYTES });
}

function gcmDecipher(key, iv) {
  return crypto.createDecipheriv(CIPHER, key, iv, { authTagLength: GCM_TAG_BYTES });
}

/**
 * The wrap key is not the issuer signing key. A PEM, a PKCS8 blob, or the
 * P-256 private scalar `d` all refuse.
 * @param {Iterable<Buffer>} keys
 * @param {string} issuerPrivateKey PEM, hex, or raw scalar. Empty skips the check.
 */
function assertWrapKeysAreNotIssuer(keys, issuerPrivateKey) {
  const raw = String(issuerPrivateKey || '').trim();
  if (!raw) return;
  /** @type {Buffer[]} */
  const scalars = [];
  try {
    const parsed = crypto.createPrivateKey(raw);
    const jwk = parsed.export({ format: 'jwk' });
    if (jwk && typeof jwk === 'object' && jwk.d) {
      scalars.push(Buffer.from(jwk.d, 'base64url'));
    }
  } catch {
    // Not a parseable private key. String equality still applies.
  }
  for (const key of keys) {
    if (!Buffer.isBuffer(key)) continue;
    const forms = [key.toString('base64'), key.toString('hex'), key.toString('base64url')];
    if (forms.includes(raw)) {
      throw new Error('salt wrap key must not be the issuer key');
    }
    for (const scalar of scalars) {
      if (scalar.length === key.length && scalar.equals(key)) {
        throw new Error('salt wrap key must not be the issuer key');
      }
    }
  }
}

function decodeKey(b64) {
  const key = Buffer.from(String(b64 || ''), 'base64');
  if (key.length !== SALT_LEN) throw new Error('wrap key must be 32 bytes');
  return key;
}

function safeName(receiptId) {
  const id = String(receiptId || '');
  if (!/^[\w.-]{1,160}$/.test(id)) throw new Error('bad receipt id');
  return `${id}.json`;
}

function keyFileInsideDir(keyFile, dir) {
  const file = path.resolve(keyFile);
  const root = path.resolve(dir);
  return file === root || file.startsWith(root + path.sep);
}

function isDiskOpts(value) {
  return !!value
    && typeof value === 'object'
    && !Buffer.isBuffer(value)
    && typeof value.dir === 'string'
    && value.keys
    && typeof value.keys.get === 'function';
}

/**
 * Buffer salt plus the owner-view fields. The extra fields are not enumerable.
 * @param {{ salt?: string|null, privateFields?: object|null }} opened
 * @param {Buffer|null} [bytes]
 */
function asSaltValue(opened, bytes = null) {
  const saltStr = opened?.salt == null ? null : String(opened.salt);
  const buf = bytes
    || (/^[0-9a-f]{64}$/i.test(saltStr || '') ? Buffer.from(saltStr, 'hex') : Buffer.alloc(0));
  Object.defineProperty(buf, 'salt', { value: saltStr, enumerable: false });
  Object.defineProperty(buf, 'privateFields', {
    value: opened?.privateFields ?? null,
    enumerable: false,
  });
  return buf;
}

/**
 * @param {string} receiptId
 * @param {Buffer} salt
 * @param {Buffer} wrapKey
 * @param {string} wrapKid
 */
export function sealSaltRecord(receiptId, salt, wrapKey, wrapKid) {
  if (!receiptId || typeof receiptId !== 'string') throw new Error('salt record needs a receipt_id');
  if (!Buffer.isBuffer(salt) || salt.length !== SALT_LEN) throw new Error('salt must be 32 bytes');
  if (!Buffer.isBuffer(wrapKey) || wrapKey.length !== SALT_LEN) throw new Error('wrap key must be 32 bytes');
  const iv = crypto.randomBytes(12);
  const cipher = gcmCipher(wrapKey, iv);
  cipher.setAAD(saltAad(receiptId));
  const ct = Buffer.concat([cipher.update(salt), cipher.final()]);
  const tag = cipher.getAuthTag();
  return {
    receipt_id: receiptId,
    wrap_kid: wrapKid,
    alg: SALT_ALG,
    iv: iv.toString('base64url'),
    ct: ct.toString('base64url'),
    tag: tag.toString('base64url'),
  };
}

/**
 * @param {object} record
 * @param {Buffer} wrapKey
 * @returns {Buffer}
 */
export function openSaltRecord(record, wrapKey) {
  if (!record || typeof record !== 'object') throw new Error('salt record missing');
  if (Object.prototype.hasOwnProperty.call(record, 'salt')) {
    throw new Error('salt record must not carry a plaintext salt');
  }
  if (record.alg !== SALT_ALG) throw new Error('salt record alg must be A256GCM');
  for (const field of SALT_RECORD_FIELDS) {
    if (typeof record[field] !== 'string' || record[field] === '') {
      throw new Error(`salt record missing ${field}`);
    }
  }
  const decipher = gcmDecipher(wrapKey, Buffer.from(record.iv, 'base64url'));
  decipher.setAAD(saltAad(record.receipt_id));
  decipher.setAuthTag(Buffer.from(record.tag, 'base64url'));
  const salt = Buffer.concat([
    decipher.update(Buffer.from(record.ct, 'base64url')),
    decipher.final(),
  ]);
  if (salt.length !== SALT_LEN) throw new Error('opened salt is not 32 bytes');
  return salt;
}

/**
 * Open a file record. Plaintext is JSON `{salt, private_fields}`.
 * @param {object} record
 * @param {Buffer} key
 * @param {string} [receiptId]
 */
export function decryptRecord(record, key, receiptId = record?.receipt_id) {
  const iv = Buffer.from(record.iv, 'base64');
  const ct = Buffer.from(record.ct, 'base64');
  const tag = Buffer.from(record.tag, 'base64');
  const decipher = gcmDecipher(key, iv);
  decipher.setAAD(saltAad(receiptId));
  decipher.setAuthTag(tag);
  const plain = Buffer.concat([decipher.update(ct), decipher.final()]);
  const decoded = JSON.parse(plain.toString('utf8'));
  return {
    salt: decoded.salt ?? null,
    privateFields: decoded.private_fields ?? null,
  };
}

class MapSaltStore {
  /**
   * @param {'memory'|'encrypted'} kind
   * @param {Buffer} wrapKey
   * @param {string} wrapKid
   * @param {boolean} [durable]
   */
  constructor(kind, wrapKey, wrapKid, durable = false) {
    this.kind = kind;
    this.durable = durable === true;
    this._key = wrapKey;
    this._kid = wrapKid;
    /** @type {Map<string, { record: object, expiresAt: number }>} */
    this._rows = new Map();
    /** HMAC(wrapKey, salt) → receipt id. The salt is not the map key. */
    this._bySalt = new Map();
    /** @type {Map<string, object|null>} */
    this._private = new Map();
  }

  saltIndex(bytes) {
    return crypto.createHmac('sha256', this._key).update(bytes).digest('hex');
  }

  /**
   * @param {string|{ receiptId: string, salt?: string|null, privateFields?: object|null }} receiptId
   * @param {Buffer|string} [salt]
   * @param {number} [ttlMs]
   */
  put(receiptId, salt, ttlMs = IDEMPOTENCY_WINDOW_MS) {
    if (receiptId && typeof receiptId === 'object' && !Buffer.isBuffer(receiptId)) {
      const id = receiptId.receiptId;
      const privateFields = receiptId.privateFields ?? null;
      assertNoRaw(privateFields);
      if (!id) throw new Error('receipt_id required');
      const saltStr = receiptId.salt == null ? null : String(receiptId.salt);
      if (saltStr != null && !/^[0-9a-f]{64}$/i.test(saltStr)) {
        throw new Error('salt must be 32 bytes');
      }
      this._private.set(String(id), privateFields);
      if (saltStr == null) return null;
      return this.put(String(id), Buffer.from(saltStr, 'hex'), ttlMs);
    }
    const id = String(receiptId);
    const bytes = Buffer.isBuffer(salt) ? salt : Buffer.from(String(salt), 'hex');
    const prev = this._rows.get(id);
    if (prev) {
      try {
        const old = this.saltIndex(openSaltRecord(prev.record, this._key));
        if (this._bySalt.get(old) === id) this._bySalt.delete(old);
      } catch {
        // replaced row was not readable; drop it
      }
    }
    const record = sealSaltRecord(id, bytes, this._key, this._kid);
    const ttl = Number.isFinite(ttlMs) && ttlMs > 0 ? ttlMs : IDEMPOTENCY_WINDOW_MS;
    this._rows.set(id, { record, expiresAt: Date.now() + ttl });
    this._bySalt.set(this.saltIndex(bytes), id);
    return record;
  }

  /**
   * @param {string} receiptId
   * @returns {Buffer|null}
   */
  get(receiptId) {
    const id = String(receiptId);
    const row = this._rows.get(id);
    if (!row) return null;
    if (row.expiresAt <= Date.now()) {
      this.delete(receiptId);
      return null;
    }
    try {
      const bytes = openSaltRecord(row.record, this._key);
      return asSaltValue({
        salt: bytes.toString('hex'),
        privateFields: this._private.get(id) ?? null,
      }, bytes);
    } catch {
      this.delete(receiptId);
      return null;
    }
  }

  /**
   * Ciphertext record for tests. No plaintext salt.
   * @param {string} receiptId
   * @returns {object|null}
   */
  peek(receiptId) {
    const row = this._rows.get(String(receiptId));
    if (!row) return null;
    if (row.expiresAt <= Date.now()) {
      this.delete(receiptId);
      return null;
    }
    return { ...row.record };
  }

  /**
   * @param {string} saltHex
   * @returns {string|null}
   */
  receiptIdForSalt(saltHex) {
    const hex = String(saltHex || '').trim();
    if (!/^[0-9a-f]{64}$/.test(hex)) return null;
    const id = this._bySalt.get(this.saltIndex(Buffer.from(hex, 'hex')));
    if (!id) return null;
    if (!this.get(id)) return null;
    return id;
  }

  /**
   * @param {string} receiptId
   */
  delete(receiptId) {
    const id = String(receiptId);
    const row = this._rows.get(id);
    if (row) {
      try {
        const index = this.saltIndex(openSaltRecord(row.record, this._key));
        if (this._bySalt.get(index) === id) this._bySalt.delete(index);
      } catch {
        // already unreadable
      }
    }
    this._rows.delete(id);
    this._private.delete(id);
  }

  clear() {
    this._rows.clear();
    this._bySalt.clear();
    this._private.clear();
  }
}

/**
 * Ephemeral process key. Kind `memory`.
 */
export class MemorySaltStore extends MapSaltStore {
  constructor() {
    super('memory', crypto.randomBytes(SALT_LEN), MEMORY_WRAP_KID, false);
  }
}

/**
 * Caller-supplied wrap key, or a directory of encrypted records.
 *
 * `new EncryptedSaltStore(wrapKey, wrapKid)` keeps ciphertext in this
 * process. That store is not durable. `{ durable: true }` does not change
 * that.
 *
 * `new EncryptedSaltStore({ dir, keys, currentKid })` writes one file per
 * receipt. That store is durable.
 */
export class EncryptedSaltStore extends MapSaltStore {
  /**
   * @param {Buffer|string|{ dir: string, keys: Map<string, Buffer>, currentKid: string }} wrapKey
   * @param {string} [wrapKid]
   * @param {{ durable?: boolean }} [opts]
   */
  constructor(wrapKey, wrapKid, opts = {}) {
    if (isDiskOpts(wrapKey)) {
      const currentKid = wrapKey.currentKid;
      const key = wrapKey.keys.get(currentKid);
      if (!currentKid || !Buffer.isBuffer(key) || key.length !== SALT_LEN) {
        throw new Error('current wrap kid required');
      }
      super('encrypted', key, currentKid, true);
      this._disk = true;
      this.dir = path.resolve(wrapKey.dir);
      this.keys = wrapKey.keys;
      this.currentKid = currentKid;
      for (const [kid, value] of this.keys) {
        if (!Buffer.isBuffer(value) || value.length !== SALT_LEN) {
          throw new Error(`wrap key ${kid} must be 32 bytes`);
        }
      }
      fs.mkdirSync(this.dir, { recursive: true });
      return;
    }
    const key = Buffer.isBuffer(wrapKey) ? wrapKey : Buffer.from(String(wrapKey || ''), 'hex');
    if (key.length !== SALT_LEN) throw new Error('encrypted SaltStore wrap key must be 32 bytes');
    const kid = wrapKid || `enc-${crypto.createHash('sha256').update(key).digest('hex').slice(0, 16)}`;
    // opts is accepted so older callers still construct. Durability is the
    // directory store only. An in-memory flag must not pass the boot gate.
    void opts;
    super('encrypted', key, kid, false);
    this._disk = false;
  }

  recordPath(receiptId) {
    return path.join(this.dir, safeName(receiptId));
  }

  put(receiptId, salt, ttlMs = IDEMPOTENCY_WINDOW_MS) {
    if (this._disk) return this._putDisk(receiptId, salt);
    return super.put(receiptId, salt, ttlMs);
  }

  get(receiptId) {
    if (this._disk) return this._getDisk(receiptId);
    return super.get(receiptId);
  }

  peek(receiptId) {
    if (!this._disk) return super.peek(receiptId);
    const record = this.readRecord(receiptId);
    return record ? { ...record } : null;
  }

  delete(receiptId) {
    if (!this._disk) return super.delete(receiptId);
    const id = String(receiptId);
    const file = this.recordPath(id);
    if (fs.existsSync(file)) fs.unlinkSync(file);
    this._private.delete(id);
    for (const [index, rowId] of this._bySalt) {
      if (rowId === id) this._bySalt.delete(index);
    }
  }

  receiptIdForSalt(saltHex) {
    if (!this._disk) return super.receiptIdForSalt(saltHex);
    const hex = String(saltHex || '').trim();
    if (!/^[0-9a-f]{64}$/.test(hex)) return null;
    const cached = this._bySalt.get(this.saltIndex(Buffer.from(hex, 'hex')));
    if (cached && this.get(cached)) return cached;
    let names = [];
    try {
      names = fs.readdirSync(this.dir);
    } catch {
      return null;
    }
    for (const name of names) {
      if (!name.endsWith('.json')) continue;
      const id = name.slice(0, -5);
      const got = this.get(id);
      if (got && got.toString('hex') === hex) return id;
    }
    return null;
  }

  readRecord(receiptId) {
    const file = this.recordPath(receiptId);
    if (!fs.existsSync(file)) return null;
    const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
    const keys = Object.keys(parsed).sort();
    const want = [...RECORD_KEYS].sort();
    if (keys.length !== want.length || keys.some((key, i) => key !== want[i])) {
      throw new Error('salt record shape rejected');
    }
    if (parsed.alg !== SALT_ALG) throw new Error('salt alg rejected');
    if (parsed.receipt_id !== String(receiptId)) throw new Error('salt receipt_id rejected');
    return parsed;
  }

  rotate(kid) {
    if (!this._disk) throw new Error('process salt store has one wrap key');
    if (!this.keys.has(kid)) throw new Error('unknown wrap kid');
    this.currentKid = kid;
    this._kid = kid;
    this._key = this.keys.get(kid);
  }

  _putDisk(receiptIdOrOpts, salt) {
    let receiptId;
    let saltValue;
    let privateFields;
    if (receiptIdOrOpts && typeof receiptIdOrOpts === 'object' && !Buffer.isBuffer(receiptIdOrOpts)) {
      receiptId = receiptIdOrOpts.receiptId;
      saltValue = receiptIdOrOpts.salt;
      privateFields = receiptIdOrOpts.privateFields ?? null;
      assertNoRaw(privateFields);
    } else {
      receiptId = receiptIdOrOpts;
      saltValue = salt;
      privateFields = this._private.get(String(receiptId)) ?? null;
    }
    if (!receiptId) throw new Error('receipt_id required');
    if (saltValue != null && typeof saltValue !== 'string' && !Buffer.isBuffer(saltValue)) {
      throw new Error('salt must be a string');
    }
    const saltStr = saltValue == null
      ? null
      : (Buffer.isBuffer(saltValue) ? saltValue.toString('hex') : String(saltValue));
    const key = this.keys.get(this.currentKid);
    if (!key) throw new Error('current wrap kid is not loaded');
    const iv = crypto.randomBytes(12);
    const cipher = gcmCipher(key, iv);
    const aad = saltAad(receiptId);
    cipher.setAAD(aad);
    const plaintext = Buffer.from(JSON.stringify({
      salt: saltStr,
      private_fields: privateFields ?? null,
    }), 'utf8');
    const ct = Buffer.concat([cipher.update(plaintext), cipher.final()]);
    const tag = cipher.getAuthTag();
    const record = {
      receipt_id: String(receiptId),
      wrap_kid: this.currentKid,
      alg: SALT_ALG,
      iv: iv.toString('base64'),
      ct: ct.toString('base64'),
      tag: tag.toString('base64'),
    };
    fs.writeFileSync(this.recordPath(receiptId), `${JSON.stringify(record)}\n`, { mode: 0o600 });
    this._private.set(String(receiptId), privateFields ?? null);
    if (saltStr && /^[0-9a-f]{64}$/i.test(saltStr)) {
      this._bySalt.set(this.saltIndex(Buffer.from(saltStr, 'hex')), String(receiptId));
    }
    return record;
  }

  _getDisk(receiptId) {
    const record = this.readRecord(receiptId);
    if (!record) return null;
    const key = this.keys.get(record.wrap_kid);
    if (!key) throw new Error('unknown wrap kid');
    try {
      return asSaltValue(decryptRecord(record, key));
    } catch {
      return null;
    }
  }
}

/** @type {MemorySaltStore|EncryptedSaltStore} */
let active = new MemorySaltStore();

export function getSaltStore() {
  return active;
}

/**
 * @param {MemorySaltStore|EncryptedSaltStore} store
 */
export function setSaltStore(store) {
  if (!store || (store.kind !== 'memory' && store.kind !== 'encrypted')) {
    throw new Error('SaltStore kind must be memory or encrypted');
  }
  active = store;
  return active;
}

export function resetSaltStore() {
  active = new MemorySaltStore();
  return active;
}

/**
 * Production is anything other than explicit test or development.
 * Unset NODE_ENV is production.
 * @param {string|undefined|null} nodeEnv
 */
export function isProductionEnv(nodeEnv = process.env.NODE_ENV) {
  const env = nodeEnv == null ? '' : String(nodeEnv).trim();
  return env !== 'test' && env !== 'development';
}

/**
 * Pure check. Production + issuer root refuses v11 issuance unless the store
 * is encrypted and durable. `allowEphemeral` (SALT_STORE_ALLOW_EPHEMERAL)
 * is the local opt-in.
 * @param {{ nodeEnv?: string, issuerRootEnabled?: boolean, store?: { kind?: string, durable?: boolean }, allowEphemeral?: boolean }} [opts]
 */
export function saltStoreAllowsV11Issuance({ nodeEnv, issuerRootEnabled, store, allowEphemeral } = {}) {
  if (!issuerRootEnabled) return { ok: true, reason: null };
  const ephemeral = allowEphemeral === true;
  if (!isProductionEnv(nodeEnv) || ephemeral) return { ok: true, reason: null };
  const current = store || getSaltStore();
  if (current?.kind === 'encrypted' && current?.durable === true && current?._disk === true) {
    return { ok: true, reason: null };
  }
  return { ok: false, reason: SALT_STORE_PROD_REASON };
}

/**
 * Throws when this process must not issue v11.
 * Caller has already decided the issuer root is on.
 * @param {NodeJS.ProcessEnv} [env]
 */
export function assertSaltStoreForIssuance(env = process.env) {
  const decision = saltStoreAllowsV11Issuance({
    nodeEnv: env.NODE_ENV,
    issuerRootEnabled: true,
    store: getSaltStore(),
    allowEphemeral: String(env.SALT_STORE_ALLOW_EPHEMERAL || '').trim() === 'true',
  });
  if (decision.ok) return;
  const err = new Error(decision.reason);
  err.code = 'salt_store_refused';
  throw err;
}

/**
 * @param {NodeJS.ProcessEnv} [env]
 * @returns {MemorySaltStore|EncryptedSaltStore}
 */
export function bootSaltStore(env = process.env, issuerPrivateKey = '') {
  const dir = String(env.RECEIPT_SALT_DIR || '').trim();
  const keyFile = String(env.RECEIPT_SALT_WRAP_KEY_FILE || '').trim();
  const named = String(env.RECEIPT_SALT_WRAP_KEYS || '').trim();
  const legacy = String(env.SALT_WRAP_KEY || '').trim();
  if (named && legacy) {
    throw new Error('RECEIPT_SALT_WRAP_KEYS and SALT_WRAP_KEY are both set; set one wrap key source');
  }
  if (keyFile && dir && keyFileInsideDir(keyFile, dir)) {
    throw new Error('wrap key file must live outside the salt data dir');
  }
  let keysJson = named;
  if (!keysJson && keyFile) {
    const raw = fs.readFileSync(keyFile, 'utf8').trim();
    const kid = env.RECEIPT_SALT_WRAP_KID || 'current';
    keysJson = JSON.stringify({ [kid]: raw });
  }
  if (!keysJson && legacy) {
    const kid = env.RECEIPT_SALT_WRAP_KID || 'current';
    keysJson = JSON.stringify({ [kid]: legacy });
  }
  const configured = Boolean(dir || keysJson || keyFile || named || legacy);
  if (!keysJson || !dir) {
    if (configured) {
      throw new Error(
        'salt store config is partial: set RECEIPT_SALT_DIR and one wrap key (RECEIPT_SALT_WRAP_KEYS, RECEIPT_SALT_WRAP_KEY_FILE, or SALT_WRAP_KEY), or set none of them',
      );
    }
    return new MemorySaltStore();
  }
  const parsed = JSON.parse(keysJson);
  const keys = new Map();
  for (const [kid, value] of Object.entries(parsed)) {
    keys.set(kid, decodeKey(value));
  }
  assertWrapKeysAreNotIssuer(keys.values(), issuerPrivateKey);
  const currentKid = env.RECEIPT_SALT_WRAP_KID || [...keys.keys()][0];
  return new EncryptedSaltStore({ dir, keys, currentKid });
}

/**
 * Every environment: an in-memory store cannot back v11 issuance.
 * Kind `encrypted` is not enough. The store has to be the file store.
 * Called at the top of createApp, before other init.
 * @param {{ kind?: string, durable?: boolean, _disk?: boolean }|null} store
 * @param {NodeJS.ProcessEnv} [env]
 */
export function assertV11IssuanceAllowed(store, env = process.env) {
  const enabled = String(env.ISSUER_ROOT_ENABLED || '').trim().toLowerCase() === 'true';
  if (!enabled) return;
  if (store && store.kind === 'encrypted' && store.durable === true && store._disk === true) return;
  throw new Error(
    'ISSUER_ROOT_ENABLED refuses v11 issuance with a memory-only salt store. The store must be encrypted and durable on disk. An in-memory store is not enough, including kind encrypted.',
  );
}
