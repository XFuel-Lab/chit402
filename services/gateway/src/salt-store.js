/**
 * SaltStore — persistence seam for v11 receipt salts and private fields.
 *
 * #483 (issuer root) keeps salts in memory today. It should call `put` / `get`
 * on the store booted here. Encrypted records on disk are exactly
 * `{receipt_id, wrap_kid, alg:'A256GCM', iv, ct, tag}`.
 * AAD is the UTF-8 bytes of `'v11/salt' || receipt_id` (no separator).
 *
 * The wrap key is loaded from the environment and is never written under the
 * data directory. v11 issuance must refuse to boot on the memory store.
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

export const SALT_ALG = 'A256GCM';
export const SALT_AAD_PREFIX = 'v11/salt';

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

export function saltAad(receiptId) {
  return Buffer.from(`${SALT_AAD_PREFIX}${String(receiptId)}`, 'utf8');
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

function decodeKey(b64) {
  const key = Buffer.from(String(b64 || ''), 'base64');
  if (key.length !== 32) throw new Error('wrap key must be 32 bytes');
  return key;
}

function safeName(receiptId) {
  const id = String(receiptId || '');
  if (!/^[\w.-]{1,160}$/.test(id)) throw new Error('bad receipt id');
  return `${id}.json`;
}

export class MemorySaltStore {
  constructor() {
    this.kind = 'memory';
    this.rows = new Map();
  }

  put({ receiptId, salt, privateFields = null }) {
    if (!receiptId) throw new Error('receipt_id required');
    assertNoRaw(privateFields);
    if (salt != null && typeof salt !== 'string') throw new Error('salt must be a string');
    this.rows.set(String(receiptId), {
      salt: salt == null ? null : String(salt),
      privateFields: privateFields ?? null,
    });
  }

  get(receiptId) {
    return this.rows.get(String(receiptId)) || null;
  }
}

export class EncryptedSaltStore {
  /**
   * @param {{ dir: string, keys: Map<string, Buffer>, currentKid: string }} opts
   */
  constructor({ dir, keys, currentKid }) {
    if (!dir) throw new Error('salt data dir required');
    if (!keys || keys.size === 0) throw new Error('wrap key required');
    if (!currentKid || !keys.has(currentKid)) throw new Error('current wrap kid required');
    this.kind = 'encrypted';
    this.dir = path.resolve(dir);
    this.keys = keys;
    this.currentKid = currentKid;
    fs.mkdirSync(this.dir, { recursive: true });
  }

  recordPath(receiptId) {
    return path.join(this.dir, safeName(receiptId));
  }

  put({ receiptId, salt, privateFields = null }) {
    if (!receiptId) throw new Error('receipt_id required');
    assertNoRaw(privateFields);
    const key = this.keys.get(this.currentKid);
    if (!key) throw new Error('current wrap kid is not loaded');
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
    const aad = saltAad(receiptId);
    cipher.setAAD(aad);
    const plaintext = Buffer.from(JSON.stringify({
      salt: salt == null ? null : String(salt),
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
    const file = this.recordPath(receiptId);
    fs.writeFileSync(file, `${JSON.stringify(record)}\n`, { mode: 0o600 });
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

  get(receiptId) {
    const record = this.readRecord(receiptId);
    if (!record) return null;
    const key = this.keys.get(record.wrap_kid);
    if (!key) throw new Error('unknown wrap kid');
    return decryptRecord(record, key);
  }

  rotate(kid) {
    if (!this.keys.has(kid)) throw new Error('unknown wrap kid');
    this.currentKid = kid;
  }
}

export function decryptRecord(record, key, receiptId = record?.receipt_id) {
  const iv = Buffer.from(record.iv, 'base64');
  const ct = Buffer.from(record.ct, 'base64');
  const tag = Buffer.from(record.tag, 'base64');
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAAD(saltAad(receiptId));
  decipher.setAuthTag(tag);
  const plain = Buffer.concat([decipher.update(ct), decipher.final()]);
  const decoded = JSON.parse(plain.toString('utf8'));
  return {
    salt: decoded.salt ?? null,
    privateFields: decoded.private_fields ?? null,
  };
}

function keyFileInsideDir(keyFile, dir) {
  const file = path.resolve(keyFile);
  const root = path.resolve(dir);
  return file === root || file.startsWith(root + path.sep);
}

/**
 * @param {NodeJS.ProcessEnv} [env]
 * @returns {MemorySaltStore|EncryptedSaltStore}
 */
export function bootSaltStore(env = process.env) {
  const dir = env.RECEIPT_SALT_DIR || '';
  const keyFile = env.RECEIPT_SALT_WRAP_KEY_FILE || '';
  if (keyFile && dir && keyFileInsideDir(keyFile, dir)) {
    throw new Error('wrap key file must live outside the salt data dir');
  }
  let keysJson = env.RECEIPT_SALT_WRAP_KEYS || '';
  if (!keysJson && keyFile) {
    const raw = fs.readFileSync(keyFile, 'utf8').trim();
    const kid = env.RECEIPT_SALT_WRAP_KID || 'current';
    keysJson = JSON.stringify({ [kid]: raw });
  }
  if (!keysJson || !dir) return new MemorySaltStore();
  const parsed = JSON.parse(keysJson);
  const keys = new Map();
  for (const [kid, value] of Object.entries(parsed)) {
    keys.set(kid, decodeKey(value));
  }
  const currentKid = env.RECEIPT_SALT_WRAP_KID || [...keys.keys()][0];
  return new EncryptedSaltStore({ dir, keys, currentKid });
}

/**
 * Prod-shaped boot: memory salts cannot back v11 issuance.
 * Called at the top of createApp, before other init.
 * @param {{ kind?: string }|null} store
 * @param {NodeJS.ProcessEnv} [env]
 */
export function assertV11IssuanceAllowed(store, env = process.env) {
  const enabled = String(env.ISSUER_ROOT_ENABLED || '').trim().toLowerCase() === 'true';
  if (!enabled) return;
  if (!store || store.kind !== 'encrypted') {
    throw new Error(
      'ISSUER_ROOT_ENABLED refuses v11 issuance with a memory-only salt store. Wire the encrypted SaltStore before enabling v11.',
    );
  }
}
