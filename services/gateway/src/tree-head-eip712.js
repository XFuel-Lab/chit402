/**
 * Fixed tree heads: an EIP-712 TreeHead signed next to the JWS tree head.
 *
 * Flag RECEIPT_FIXED_HEAD_EIP712, on only when the value is exactly "true".
 * Default off. With the flag off nothing here runs and no file is created.
 *
 * signFixedHead() is called once, right after a JWS head is signed and
 * persisted, inside the publish chain. It reads the signed claims and never
 * edits them. It returns a separate object that is stored in
 * fixed-heads.jsonl (fsync before it is served), not in the receipt journal.
 *
 * Refusals. Each gives no fixed head, one coded log line, and leaves the JWS
 * head as published:
 * - R-1 root_mismatch: claims.root is not the root of leaves[0..tree_size).
 * - R-2 quarantined: (epoch, tree_size, root) is quarantined.
 * - R-3 conflicting_root: a fixed head with another root exists for this
 *   (epoch, tree_size). Checked against the file, so it survives restarts.
 * - R-4 log_not_durable | log_boot_disabled | fresh_genesis | pin_unverified
 *   | log_lock_missing | log_identity: see receiptLogSigningReady, plus the
 *   salt from the boot-verified log identity must equal EXPECTED_LOG_SALT.
 * - R-5 field_range: a field is out of range or unparseable.
 * - R-6 not_open_epoch: only heads of the current open epoch at publish
 *   time. No backfill, no closed-epoch head, never from a GET handler.
 */
import fs from 'node:fs';
import path from 'node:path';
import logger from './logger.js';
import {
  EIP712_CHAIN_ID,
  EIP712_DIGEST_ALG,
  EIP712_DOMAIN_VERSION,
  EXPECTED_LOG_SALT,
  TREE_HEAD_DOMAIN_NAME,
  TREE_HEAD_TYPE,
  kidBytes32,
  logIdSalt,
  signTypedStruct,
  typedDigest,
  verifyTypedSignature,
} from './eip712-p256.js';

export const FIXED_HEAD_SCHEMA = 'chit402.tree_head_eip712.v1';
export const FIXED_HEADS_FILE = 'fixed-heads.jsonl';
export const FIXED_HEAD_FLAG = 'RECEIPT_FIXED_HEAD_EIP712';

const SIGNED_TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/;
const ROOT_HEX = /^[0-9a-f]{64}$/;
const UINT32_MAX = 0xffffffff;

function coded(message, code) {
  const err = new Error(message);
  err.code = code;
  return err;
}

/** @param {NodeJS.ProcessEnv} [env] */
export function fixedHeadFlagOn(env = process.env) {
  return env[FIXED_HEAD_FLAG] === 'true';
}

/**
 * Strict ISO time to floor(ms / 1000). Null for anything else.
 * @param {unknown} value
 */
export function publishedAtSeconds(value) {
  if (typeof value !== 'string' || !SIGNED_TIME.test(value)) return null;
  const ms = Date.parse(value);
  if (!Number.isFinite(ms) || ms < 0) return null;
  // Round trip the calendar part so 2026-02-30 is not accepted as March 2.
  if (new Date(ms).toISOString().slice(0, 19) !== value.slice(0, 19)) return null;
  return Math.floor(ms / 1000);
}

/**
 * TreeHead message from signed JWS head claims. Throws field_range.
 * @param {object} claims
 * @param {string} kid base64url thumbprint
 */
export function treeHeadMessageFromClaims(claims, kid) {
  const epoch = claims?.epoch;
  if (!Number.isSafeInteger(epoch) || epoch < 0 || epoch > UINT32_MAX) {
    throw coded('epoch out of range', 'field_range');
  }
  const treeSize = claims?.tree_size;
  if (!Number.isSafeInteger(treeSize) || treeSize < 0) {
    throw coded('tree_size out of range', 'field_range');
  }
  const root = claims?.root;
  if (typeof root !== 'string' || !ROOT_HEX.test(root)) {
    throw coded('root must be 64 lowercase hex', 'field_range');
  }
  const publishedAt = publishedAtSeconds(claims?.published_at);
  if (publishedAt == null) throw coded('published_at is not a signed time', 'field_range');
  let kidHex;
  try {
    kidHex = kidBytes32(kid);
  } catch {
    throw coded('kid is not a 32-byte thumbprint', 'field_range');
  }
  return { epoch, tree_size: treeSize, root: `0x${root}`, published_at: publishedAt, kid: kidHex };
}

/**
 * The stored and served object.
 * @param {object} message
 * @param {string} salt
 * @param {{ r: string, s: string }} sig
 */
export function fixedHeadObject(message, salt, sig) {
  return {
    schema: FIXED_HEAD_SCHEMA,
    digest_alg: EIP712_DIGEST_ALG,
    domain: {
      name: TREE_HEAD_DOMAIN_NAME,
      version: EIP712_DOMAIN_VERSION,
      chainId: EIP712_CHAIN_ID,
      salt,
    },
    types: TREE_HEAD_TYPE,
    message: { ...message },
    r: sig.r,
    s: sig.s,
  };
}

/**
 * Reference check of a fixed head against a public JWK and the expected salt.
 * @param {object} fixed
 * @param {{ x: string, y: string }} jwk
 * @param {{ salt?: string }} [opts]
 * @returns {{ ok: true } | { ok: false, reason: string }}
 */
export function verifyFixedHead(fixed, jwk, { salt = EXPECTED_LOG_SALT } = {}) {
  if (!fixed || fixed.schema !== FIXED_HEAD_SCHEMA) return { ok: false, reason: 'schema' };
  if (fixed.digest_alg !== EIP712_DIGEST_ALG || fixed.types !== TREE_HEAD_TYPE) return { ok: false, reason: 'type' };
  const d = fixed.domain || {};
  if (d.name !== TREE_HEAD_DOMAIN_NAME || d.version !== EIP712_DOMAIN_VERSION
    || d.chainId !== EIP712_CHAIN_ID || d.salt !== salt) {
    return { ok: false, reason: 'domain' };
  }
  let digest;
  try {
    digest = typedDigest('TreeHead', fixed.message, d.salt);
  } catch {
    return { ok: false, reason: 'field_range' };
  }
  if (!verifyTypedSignature(digest.preimage, fixed.r, fixed.s, jwk)) return { ok: false, reason: 'signature' };
  return { ok: true };
}

/**
 * Append-only store for fixed heads. One JSON line per signed head. A line
 * that does not parse marks the store broken, and a broken store refuses
 * every new fixed head (R-3 cannot be checked).
 * @param {string} dir
 */
export function openFixedHeadStore(dir) {
  const file = path.join(dir, FIXED_HEADS_FILE);
  const rows = [];
  let broken = false;
  let text = '';
  try {
    text = fs.readFileSync(file, 'utf8');
  } catch (err) {
    if (err?.code !== 'ENOENT') broken = true;
  }
  if (text) {
    const lines = text.split('\n');
    if (lines[lines.length - 1] === '') lines.pop();
    for (const line of lines) {
      try {
        const row = JSON.parse(line);
        const fh = row?.fixed_head;
        if (row?.v !== 1 || !fh || fh.schema !== FIXED_HEAD_SCHEMA) throw new Error('row');
        rows.push(fh);
      } catch {
        broken = true;
      }
    }
  }
  const keyOf = (epoch, size) => `${epoch}|${size}`;
  const byKey = new Map();
  const index = (fh) => {
    const key = keyOf(fh.message.epoch, fh.message.tree_size);
    if (!byKey.has(key)) byKey.set(key, []);
    byKey.get(key).push(fh);
  };
  rows.forEach(index);
  return {
    file,
    get broken() { return broken; },
    rows,
    /** True when another root is already signed for (epoch, size). */
    conflicts(epoch, size, root0x) {
      return (byKey.get(keyOf(epoch, size)) || []).some((fh) => fh.message.root !== root0x);
    },
    find(epoch, size, root0x, publishedAt) {
      return (byKey.get(keyOf(epoch, size)) || []).find((fh) => (
        fh.message.root === root0x && fh.message.published_at === publishedAt
      )) || null;
    },
    append(fh) {
      fs.mkdirSync(dir, { recursive: true });
      const fd = fs.openSync(file, 'a', 0o600);
      try {
        fs.writeSync(fd, `${JSON.stringify({ v: 1, fixed_head: fh })}\n`);
        fs.fsyncSync(fd);
      } finally {
        fs.closeSync(fd);
      }
      rows.push(fh);
      index(fh);
    },
  };
}

function refuse(reason, claims) {
  logger.warn({
    code: 'fixed_head_refused',
    reason,
    epoch: Number.isSafeInteger(claims?.epoch) ? claims.epoch : null,
    tree_size: Number.isSafeInteger(claims?.tree_size) ? claims.tree_size : null,
  }, 'fixed tree head not signed');
  return { fixed_head: null, refused: reason };
}

/**
 * @param {object} claims the signed JWS head claims, unchanged
 * @param {{
 *   ready: { ok: boolean, reason?: string },
 *   logIdentity: { epoch1_root: string, genesis_digest: string } | null,
 *   currentEpoch: number,
 *   leafCount: number,
 *   rootAt: (size: number) => string,
 *   quarantined: Array<{ epoch: number, tree_size: number, root: string }>,
 *   store: ReturnType<typeof openFixedHeadStore>,
 *   kid: string,
 *   signer?: object,
 * }} ctx
 * @returns {Promise<{ fixed_head: object|null, refused?: string }>}
 */
export async function signFixedHead(claims, ctx) {
  // R-4
  if (!ctx?.ready?.ok) return refuse(ctx?.ready?.reason || 'log_not_ready', claims);
  let salt;
  try {
    salt = logIdSalt(ctx.logIdentity?.epoch1_root, ctx.logIdentity?.genesis_digest);
  } catch {
    return refuse('log_identity', claims);
  }
  if (salt !== EXPECTED_LOG_SALT) return refuse('log_identity', claims);
  // R-5
  let message;
  try {
    message = treeHeadMessageFromClaims(claims, ctx.kid);
  } catch {
    return refuse('field_range', claims);
  }
  // R-6
  if (message.epoch !== ctx.currentEpoch || message.tree_size > ctx.leafCount) {
    return refuse('not_open_epoch', claims);
  }
  // R-1
  let recomputed = null;
  try {
    recomputed = ctx.rootAt(message.tree_size);
  } catch {
    recomputed = null;
  }
  if (recomputed !== claims.root) return refuse('root_mismatch', claims);
  // R-2
  const listed = (ctx.quarantined || []).some((row) => (
    Number(row?.epoch) === message.epoch
    && Number(row?.tree_size) === message.tree_size
    && String(row?.root || '').toLowerCase() === claims.root
  ));
  if (listed) return refuse('quarantined', claims);
  // R-3
  const store = ctx.store;
  if (!store || store.broken) return refuse('store_unreadable', claims);
  if (store.conflicts(message.epoch, message.tree_size, message.root)) return refuse('conflicting_root', claims);
  const existing = store.find(message.epoch, message.tree_size, message.root, message.published_at);
  if (existing) return { fixed_head: existing };
  let sig;
  try {
    sig = await signTypedStruct('TreeHead', message, { salt, signer: ctx.signer || null });
  } catch (err) {
    return refuse(err?.code === 'issuer_sign_unavailable' ? 'signer_unavailable' : 'signer_error', claims);
  }
  const fixed = fixedHeadObject(message, salt, sig);
  try {
    store.append(fixed);
  } catch {
    return refuse('store_write', claims);
  }
  return { fixed_head: fixed };
}
