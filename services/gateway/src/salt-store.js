/**
 * SaltStore — the only path that reads or writes a v11 receipt salt.
 *
 * Issuance code calls get / put / delete. It does not put the salt on an
 * enumerable request field, in a log line, or on disk. A later owner-view
 * can replace the process Map with another SaltStore of kind `encrypted`
 * without changing issuance.
 *
 * Record shape, both implementations (no migration when the encrypted
 * store drops in):
 *
 *   { receipt_id, wrap_kid, alg: 'A256GCM', iv, ct, tag }
 *
 * `iv`, `ct`, and `tag` are base64url. The plaintext inside `ct` is the
 * 32-byte salt. The record has no `salt` field.
 *
 * AAD is the UTF-8 bytes of `v11/salt` concatenated with `receipt_id`,
 * with no separator byte.
 *
 * MemorySaltStore (kind `memory`) wraps with an ephemeral 32-byte key
 * generated in this process (`wrap_kid` `memory-ephemeral`). It is allowed
 * in tests and in local or dev runs. EncryptedSaltStore (kind `encrypted`)
 * requires a caller-supplied 32-byte wrap key. Both keep ciphertext in a
 * Map. Neither writes the Map to disk, a backup, or a database.
 *
 * Production is every NODE_ENV other than `test` and `development`.
 * Unset NODE_ENV is production. Production with `ISSUER_ROOT_ENABLED`
 * refuses v11 issuance unless the active store's kind is `encrypted` and
 * `durable` is true. `SALT_STORE_ALLOW_EPHEMERAL=true` is the local opt-in
 * that allows a non-durable store.
 *
 * TTL defaults to the idempotency window (24h). `get` of an expired row
 * deletes it and returns null. Salts are never derived from a server key.
 */

import crypto from 'crypto';

export const SALT_AAD_LABEL = 'v11/salt';
export const SALT_ALG = 'A256GCM';
export const SALT_RECORD_FIELDS = Object.freeze(['receipt_id', 'wrap_kid', 'alg', 'iv', 'ct', 'tag']);
export const MEMORY_WRAP_KID = 'memory-ephemeral';
/** Idempotency window. A salt is not kept longer than this. */
export const IDEMPOTENCY_WINDOW_MS = 24 * 60 * 60 * 1000;
export const SALT_STORE_PROD_REASON = 'production v11 issuance requires the encrypted SaltStore';

const SALT_LEN = 32;

/**
 * @param {string} receiptId
 * @returns {Buffer}
 */
export function saltAad(receiptId) {
  return Buffer.from(`${SALT_AAD_LABEL}${receiptId}`, 'utf8');
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
  const cipher = crypto.createCipheriv('aes-256-gcm', wrapKey, iv);
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
  const decipher = crypto.createDecipheriv('aes-256-gcm', wrapKey, Buffer.from(record.iv, 'base64url'));
  decipher.setAAD(saltAad(record.receipt_id));
  decipher.setAuthTag(Buffer.from(record.tag, 'base64url'));
  const salt = Buffer.concat([
    decipher.update(Buffer.from(record.ct, 'base64url')),
    decipher.final(),
  ]);
  if (salt.length !== SALT_LEN) throw new Error('opened salt is not 32 bytes');
  return salt;
}

class MapSaltStore {
  /**
   * @param {'memory'|'encrypted'} kind
   * @param {Buffer} wrapKey
   * @param {string} wrapKid
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
  }

  saltIndex(bytes) {
    return crypto.createHmac('sha256', this._key).update(bytes).digest('hex');
  }

  /**
   * @param {string} receiptId
   * @param {Buffer|string} salt
   * @param {number} [ttlMs]
   */
  put(receiptId, salt, ttlMs = IDEMPOTENCY_WINDOW_MS) {
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
    const row = this._rows.get(String(receiptId));
    if (!row) return null;
    if (row.expiresAt <= Date.now()) {
      this.delete(receiptId);
      return null;
    }
    try {
      return openSaltRecord(row.record, this._key);
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
  }

  clear() {
    this._rows.clear();
    this._bySalt.clear();
  }
}

/**
 * Ephemeral process key. Kind `memory`.
 */
export class MemorySaltStore extends MapSaltStore {
  constructor() {
    super('memory', crypto.randomBytes(SALT_LEN), MEMORY_WRAP_KID);
  }
}

/**
 * Caller-supplied 32-byte wrap key. Kind `encrypted`.
 * Ciphertext still lives only in this process Map.
 * @param {Buffer|string} wrapKey 32 bytes, or 64 hex chars
 * @param {string} [wrapKid]
 */
export class EncryptedSaltStore extends MapSaltStore {
  /**
   * @param {Buffer|string} wrapKey
   * @param {string} [wrapKid]
   * @param {{ durable?: boolean }} [opts] durable is true only for a store that
   *   survives process restart. An in-memory ciphertext map is not durable.
   */
  constructor(wrapKey, wrapKid, opts = {}) {
    const key = Buffer.isBuffer(wrapKey) ? wrapKey : Buffer.from(String(wrapKey || ''), 'hex');
    if (key.length !== SALT_LEN) throw new Error('encrypted SaltStore wrap key must be 32 bytes');
    const kid = wrapKid || `enc-${crypto.createHash('sha256').update(key).digest('hex').slice(0, 16)}`;
    const durable = !!(opts && typeof opts === 'object' && opts.durable === true);
    super('encrypted', key, kid, durable);
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
  const active = store || getSaltStore();
  if (active?.kind === 'encrypted' && active?.durable === true) return { ok: true, reason: null };
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
