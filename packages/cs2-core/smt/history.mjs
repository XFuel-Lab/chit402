/**
 * Slot histories and SIMPLE §S5 rules 1–7.
 *
 * The bytes stored under a slot key are this history, not a second encoding
 * of the slot key. The slot key itself is only ever produced by `slotKey`
 * in the line module (see placeHistory). Rule 6 hashing is stateLeaf.
 *
 * Rule 1: seq starts at 0 and rises by 1. Ordering uses the admission
 * block. fromBlock is stored and is not that block. That block must be
 * after the previous epoch's anchor transaction and no later than the
 * anchor transaction of the epoch that first shows the record. Count
 * equals the number of records, which equals last seq + 1. A record that
 * breaks a rule still occupies its seq. An ignored record does not move
 * the block floor and does not claim its id.
 *
 * Rule 2: payTo intervals are [registration admission block, revocation
 * admission block). They are pairwise disjoint and only the last may be
 * open. A registration carries expiry, not a signed validFrom. expiry must
 * be greater than the hourStart of the epoch that first shows the record.
 * A revocation carries no time. keyHash is SHA-256(keyAlg || key). A
 * RevokeByKey admission writes that keyHash into a permanent tombstone set.
 * A later PayToControl for a tombstoned keyHash is refused in every slot
 * and under every contract in the pinned lineage. The set is seeded from
 * ctx.tombstones and carries over on migration. A payTo-signed Revoke stays
 * on its own slot and does not tombstone the key. A wallet has at most one
 * active book, unless the slot is in STOP.
 *
 * Rule 3: the seller key covering the payment block is the one whose
 * payTo-control signature verifies against the Transfer `to`.
 *
 * Rule 4: a revocation is signed by the payTo or by the revoked key. A
 * wallet join, leave or stop is signed by the wallet. A book creation is
 * signed by the identity key. A record whose signature does not verify is
 * invalid.
 *
 * Rule 5: the history at e+1 extends the history at e. A set record never
 * changes. Anything else, under two roots that both prove, is equivocation.
 *
 * Rule 7: a seller key already held by an earlier payTo is rejected unless
 * that holder and this payTo both sign. Later registrations and slots that
 * do not hold the key do not change a record's verdict. The check is made
 * at admission, so two checkers given different later slots agree. A
 * revocation signed by the key applies to every slot that holds it, and
 * the tombstone blocks every later registration of that keyHash. The
 * revoke record id is (slot, keyHash). The RevokeByKey record carries
 * keyAlg and the key beside the signed struct. The hash of those bytes
 * must equal keyHash, and the key must have signed the v13 digest.
 *
 * admit rejects a breaching record. assess, for a history that was anchored
 * anyway, ignores that record, prints "invalid record at seq n (Chit fault)",
 * and does not kill the slot. A structural decode error is not that case:
 * the bytes are not a history, the slot is unproven, and killed stays false.
 * The payTo key table in SIMPLE §S5 (version, count, keys) is a projection
 * of the effective keys. A clean one-key table is 124 bytes, 156 with the
 * slot key.
 */

import { createHash } from 'node:crypto';
import { KIND_BOOK, KIND_PAYTO, KIND_WALLET, isAllowedAlg, slotKey } from '../line/index.mjs';
import { bytesToHex, equalBytes } from '../ecdsa/bytes.js';
import { verifyProof } from './tree.mjs';
import { fail } from './reasons.mjs';
import {
  contractForHour,
  sellerKeyHash,
  verifyBookCreate,
  verifyCrossSig,
  verifyKeyRevoke,
  verifyPayToControl,
  verifyPayToRevoke,
  verifyWalletJoin,
  verifyWalletLeave,
  verifyWalletStop,
} from './sig.mjs';

export const HISTORY_VERSION = 1;
export const REC_REGISTER = 1;
export const REC_REVOKE = 2;
export const REC_JOIN = 3;
export const REC_LEAVE = 4;
export const REC_STOP = 5;
export const REC_BOOK = 6;

/** Implementation limit on records in one history. Not a wire field. */
export const MAX_RECORDS = 1_048_576;

const U64 = (1n << 64n) - 1n;
const NO_FROM = U64;

export const KEY_STATUS_UNPROVEN = 'key status unproven';

export function faultLine(seq) {
  return `invalid record at seq ${seq} (Chit fault)`;
}

function sha256(parts) {
  const hash = createHash('sha256');
  for (const part of parts) hash.update(part);
  return new Uint8Array(hash.digest());
}

function idLength(kind) {
  if (kind === KIND_PAYTO || kind === KIND_WALLET) return 20;
  if (kind === KIND_BOOK) return 32;
  return null;
}

function writeU64(target, offset, value) {
  let x = value;
  for (let i = 7; i >= 0; i -= 1) {
    target[offset + i] = Number(x & 0xffn);
    x >>= 8n;
  }
}

function readU64(bytes, offset) {
  if (offset + 8 > bytes.length) return null;
  let x = 0n;
  for (let i = 0; i < 8; i += 1) x = (x << 8n) | BigInt(bytes[offset + i]);
  return x;
}

function fitU64(value) {
  if (typeof value !== 'bigint' || value < 0n || value > U64) return null;
  return value;
}

function take(bytes, cursor, length) {
  if (cursor.at + length > bytes.length) return null;
  const out = bytes.subarray(cursor.at, cursor.at + length);
  cursor.at += length;
  return out;
}

function encodeBody(record) {
  if (record.type === REC_REGISTER) {
    if (typeof record.alg !== 'number' || !Number.isInteger(record.alg) || record.alg < 0 || record.alg > 255) {
      return null;
    }
    if (!(record.key instanceof Uint8Array) || record.key.length !== 33) return null;
    if (typeof record.expiry !== 'bigint') return null;
    const cross = record.cross ? 1 : 0;
    const extra = cross ? 20 + 65 + 65 : 0;
    const body = new Uint8Array(1 + 33 + 8 + 1 + extra);
    body[0] = record.alg;
    body.set(record.key, 1);
    writeU64(body, 34, record.expiry);
    body[42] = cross;
    if (cross) {
      body.set(record.cross.other, 43);
      body.set(record.cross.otherSig, 63);
      body.set(record.cross.selfSig, 128);
    }
    return body;
  }
  if (record.type === REC_REVOKE) {
    if (record.by === 'key') {
      if (!(record.keyHash instanceof Uint8Array) || record.keyHash.length !== 32) return null;
      if (typeof record.alg !== 'number' || !Number.isInteger(record.alg) || record.alg < 0 || record.alg > 255) {
        return null;
      }
      if (!(record.key instanceof Uint8Array) || record.key.length !== 33) return null;
      const body = new Uint8Array(32 + 1 + 1 + 33);
      body.set(record.keyHash, 0);
      body[32] = 2;
      body[33] = record.alg;
      body.set(record.key, 34);
      return body;
    }
    const body = new Uint8Array(32 + 1);
    body.set(record.keyHash, 0);
    body[32] = 1;
    return body;
  }
  if (record.type === REC_JOIN || record.type === REC_STOP) {
    const body = new Uint8Array(32);
    body.set(record.commitment, 0);
    return body;
  }
  if (record.type === REC_LEAVE) return new Uint8Array(0);
  if (record.type === REC_BOOK) {
    const body = new Uint8Array(33);
    body.set(record.identityKey, 0);
    return body;
  }
  return null;
}

function decodeBody(type, body) {
  if (type === REC_REGISTER) {
    if (body.length < 43) return null;
    const alg = body[0];
    const key = body.subarray(1, 34);
    const expiry = readU64(body, 34);
    const cross = body[42];
    if (expiry === null) return null;
    if (cross === 0) {
      if (body.length !== 43) return null;
      return { alg, key: new Uint8Array(key), expiry, cross: null };
    }
    if (cross !== 1 || body.length !== 43 + 20 + 65 + 65) return null;
    return {
      alg,
      key: new Uint8Array(key),
      expiry,
      cross: {
        other: new Uint8Array(body.subarray(43, 63)),
        otherSig: new Uint8Array(body.subarray(63, 128)),
        selfSig: new Uint8Array(body.subarray(128, 193)),
      },
    };
  }
  if (type === REC_REVOKE) {
    if (body.length === 33) {
      const by = body[32];
      if (by !== 1 && by !== 2) return null;
      if (by === 2) return null;
      return { keyHash: new Uint8Array(body.subarray(0, 32)), by: 'payTo' };
    }
    if (body.length !== 67) return null;
    if (body[32] !== 2) return null;
    return {
      keyHash: new Uint8Array(body.subarray(0, 32)),
      by: 'key',
      alg: body[33],
      key: new Uint8Array(body.subarray(34, 67)),
    };
  }
  if (type === REC_JOIN || type === REC_STOP) {
    if (body.length !== 32) return null;
    return { commitment: new Uint8Array(body) };
  }
  if (type === REC_LEAVE) {
    if (body.length !== 0) return null;
    return {};
  }
  if (type === REC_BOOK) {
    if (body.length !== 33) return null;
    return { identityKey: new Uint8Array(body) };
  }
  return null;
}

export function encodeRecord(record) {
  const body = encodeBody(record);
  if (!body || body.length > 0xffff) return null;
  if (record.sig.length > 0xffff) return null;
  const out = new Uint8Array(8 + 8 + 8 + 32 + 1 + 2 + body.length + 2 + record.sig.length);
  writeU64(out, 0, record.seq);
  writeU64(out, 8, record.block);
  writeU64(out, 16, record.fromBlock === null ? NO_FROM : record.fromBlock);
  out.set(record.id, 24);
  out[56] = record.type;
  out[57] = Math.floor(body.length / 256) % 256;
  out[58] = body.length % 256;
  out.set(body, 59);
  const sigAt = 59 + body.length;
  out[sigAt] = Math.floor(record.sig.length / 256) % 256;
  out[sigAt + 1] = record.sig.length % 256;
  out.set(record.sig, sigAt + 2);
  return out;
}

function decodeRecord(bytes, cursor) {
  const seq = readU64(bytes, cursor.at);
  if (seq === null) return null;
  cursor.at += 8;
  const block = readU64(bytes, cursor.at);
  if (block === null) return null;
  cursor.at += 8;
  const fromRaw = readU64(bytes, cursor.at);
  if (fromRaw === null) return null;
  cursor.at += 8;
  const id = take(bytes, cursor, 32);
  const typeByte = take(bytes, cursor, 1);
  const lenBytes = take(bytes, cursor, 2);
  if (!id || !typeByte || !lenBytes) return null;
  const bodyLen = lenBytes[0] * 256 + lenBytes[1];
  const body = take(bytes, cursor, bodyLen);
  const sigLenBytes = take(bytes, cursor, 2);
  if (!body || !sigLenBytes) return null;
  const sigLen = sigLenBytes[0] * 256 + sigLenBytes[1];
  const sig = take(bytes, cursor, sigLen);
  if (!sig) return null;
  const parsed = decodeBody(typeByte[0], body);
  if (!parsed) return null;
  return {
    seq,
    block,
    fromBlock: fromRaw === NO_FROM ? null : fromRaw,
    id: new Uint8Array(id),
    type: typeByte[0],
    sig: new Uint8Array(sig),
    ...parsed,
  };
}

function checkRecordShape(record, index) {
  if (!record || typeof record !== 'object') return fail('bad_type');
  if (fitU64(record.seq) === null || record.seq !== BigInt(index)) return fail('rule_1');
  if (fitU64(record.block) === null) return fail('bad_history');
  if (record.fromBlock !== null && fitU64(record.fromBlock) === null) return fail('bad_history');
  if (!(record.id instanceof Uint8Array) || record.id.length !== 32) return fail('bad_length');
  if (!(record.sig instanceof Uint8Array) || record.sig.length > 0xffff) return fail('bad_length');
  if (encodeBody(record) === null) return fail('bad_history');
  return { ok: true };
}

export function encodeHistory(history) {
  if (!history || typeof history !== 'object') return fail('bad_type');
  const idLen = idLength(history.kind);
  if (idLen === null) return fail('bad_kind');
  const chainId = fitU64(history.chainId);
  if (chainId === null) return fail('bad_history');
  if (!(history.id instanceof Uint8Array) || history.id.length !== idLen) return fail('bad_length');
  if (!Array.isArray(history.records)) return fail('bad_type');
  if (history.records.length > MAX_RECORDS) return fail('bad_size');
  const parts = [];
  for (let i = 0; i < history.records.length; i += 1) {
    const shaped = checkRecordShape(history.records[i], i);
    if (!shaped.ok) return shaped;
    const encoded = encodeRecord(history.records[i]);
    if (!encoded) return fail('bad_history');
    parts.push(encoded);
  }
  let total = 1 + 1 + 8 + 1 + idLen + 4;
  for (const part of parts) total += part.length;
  const out = new Uint8Array(total);
  out[0] = HISTORY_VERSION;
  out[1] = history.kind;
  writeU64(out, 2, chainId);
  out[10] = idLen;
  out.set(history.id, 11);
  const count = history.records.length;
  out[11 + idLen] = Math.floor(count / 16777216) % 256;
  out[12 + idLen] = Math.floor(count / 65536) % 256;
  out[13 + idLen] = Math.floor(count / 256) % 256;
  out[14 + idLen] = count % 256;
  let at = 15 + idLen;
  for (const part of parts) {
    out.set(part, at);
    at += part.length;
  }
  return { ok: true, bytes: out };
}

export function decodeHistory(bytes) {
  if (!(bytes instanceof Uint8Array)) return fail('bad_type');
  if (bytes.length < 15) return fail('bad_history');
  if (bytes[0] !== HISTORY_VERSION) return fail('bad_history');
  const kind = bytes[1];
  const idLen = idLength(kind);
  if (idLen === null || bytes[10] !== idLen) return fail('bad_kind');
  if (bytes.length < 15 + idLen) return fail('bad_history');
  const chainId = readU64(bytes, 2);
  const id = bytes.subarray(11, 11 + idLen);
  const count = bytes[11 + idLen] * 16777216
    + bytes[12 + idLen] * 65536
    + bytes[13 + idLen] * 256
    + bytes[14 + idLen];
  if (count > MAX_RECORDS) return fail('bad_size');
  const cursor = { at: 15 + idLen };
  const records = [];
  for (let i = 0; i < count; i += 1) {
    const record = decodeRecord(bytes, cursor);
    if (!record) return fail('bad_history');
    if (record.seq !== BigInt(i)) return fail('rule_1');
    records.push(record);
  }
  if (cursor.at !== bytes.length) return fail('bad_history');
  if (records.length !== count) return fail('rule_1');
  if (records.length > 0 && records[records.length - 1].seq + 1n !== BigInt(records.length)) {
    return fail('rule_1');
  }
  return {
    ok: true,
    kind,
    chainId,
    id: new Uint8Array(id),
    records,
  };
}

export function emptyHistory(kind, chainId, id) {
  const chain = typeof chainId === 'bigint' ? chainId : BigInt(chainId);
  return encodeHistory({ kind, chainId: chain, id, records: [] });
}

function overlaps(aFrom, aTo, bFrom, bTo) {
  if (aTo !== 0n && aTo <= bFrom) return false;
  if (bTo !== 0n && bTo <= aFrom) return false;
  return true;
}

function covers(key, block, tombstones) {
  if (block < key.validFrom) return false;
  if (key.revokedAt !== 0n && block >= key.revokedAt) return false;
  if (tombstones) {
    const hash = sellerKeyHash(key.alg, key.key);
    if (!hash) return false;
    const at = tombstones.get(bytesToHex(hash));
    if (at !== undefined && block >= at) return false;
  }
  return true;
}

function rememberTombstone(set, hex, block) {
  const prev = set.get(hex);
  if (prev === undefined || block < prev) set.set(hex, block);
}

function tombstoneHex(item) {
  if (typeof item === 'string' && /^[0-9a-fA-F]{64}$/.test(item)) return item.toLowerCase();
  if (item instanceof Uint8Array && item.length === 32) return bytesToHex(item);
  return null;
}

/**
 * Bare hashes are already dead (migration carry, block unknown), so they
 * bind at block 0. A RevokeByKey in another slot contributes its admission
 * block. Scanning does not walk ctx.others again.
 */
function seedTombstones(ctx) {
  const set = new Map();
  if (!ctx) return set;
  const raw = ctx.tombstones;
  const list = raw instanceof Set ? [...raw] : (Array.isArray(raw) ? raw : []);
  for (const item of list) {
    if (item && typeof item === 'object' && !(item instanceof Uint8Array)) {
      const hex = tombstoneHex(item.keyHash);
      const block = typeof item.block === 'bigint' ? item.block : 0n;
      if (hex) rememberTombstone(set, hex, block);
      continue;
    }
    const hex = tombstoneHex(item);
    if (hex) rememberTombstone(set, hex, 0n);
  }
  if (ctx._scanning || !Array.isArray(ctx.others)) return set;
  for (const other of ctx.others) {
    if (!(other?.bytes instanceof Uint8Array)) continue;
    const decoded = decodeHistory(other.bytes);
    if (!decoded.ok || decoded.kind !== KIND_PAYTO) continue;
    const folded = fold(decoded, {
      epochs: ctx.epochs,
      contracts: ctx.contracts,
      _scanning: true,
    });
    for (const [hex, block] of folded.tombstones) rememberTombstone(set, hex, block);
  }
  return set;
}

function epochFor(ctx, block) {
  const epochs = ctx && Array.isArray(ctx.epochs) ? ctx.epochs : null;
  if (!epochs) return null;
  let found = null;
  for (const epoch of epochs) {
    if (!epoch || typeof epoch.prevAnchorBlock !== 'bigint' || typeof epoch.showAnchorBlock !== 'bigint') continue;
    if (typeof epoch.hourStart !== 'bigint') continue;
    const afterPrev = block > epoch.prevAnchorBlock;
    const byShow = block <= epoch.showAnchorBlock;
    if (afterPrev && byShow) {
      if (found) return null;
      found = epoch;
    }
  }
  if (!found) return null;
  let contract = found.contract;
  if (!(contract instanceof Uint8Array) || contract.length !== 20) {
    contract = contractForHour(ctx.contracts, found.hourStart);
  }
  if (!(contract instanceof Uint8Array) || contract.length !== 20) return null;
  return {
    prevAnchorBlock: found.prevAnchorBlock,
    showAnchorBlock: found.showAnchorBlock,
    hourStart: found.hourStart,
    contract,
  };
}

function openKeys(bytes, ctx) {
  const decoded = decodeHistory(bytes);
  if (!decoded.ok) return [];
  const folded = fold(decoded, { epochs: ctx?.epochs, contracts: ctx?.contracts });
  return folded.keys.filter((key) => key.revokedAt === 0n);
}

function earlierHolders(ctx, selfId, key, record) {
  if (!ctx || !Array.isArray(ctx.others)) return [];
  const out = [];
  for (const other of ctx.others) {
    if (!(other?.id instanceof Uint8Array) || !(other.bytes instanceof Uint8Array)) continue;
    if (equalBytes(other.id, selfId)) continue;
    const held = openKeys(other.bytes, ctx).find((item) => equalBytes(item.key, key));
    if (!held) continue;
    const earlier = held.validFrom < record.block
      || (held.validFrom === record.block && held.seq < record.seq);
    if (earlier) out.push(other.id);
  }
  return out;
}

function crossOk(decoded, record, contract) {
  const hash = sellerKeyHash(record.alg, record.key);
  if (!hash || !record.cross) return false;
  const selfOk = verifyCrossSig(
    decoded.chainId,
    contract,
    decoded.id,
    record.cross.other,
    hash,
    record.cross.selfSig,
    decoded.id,
  );
  const otherOk = verifyCrossSig(
    decoded.chainId,
    contract,
    decoded.id,
    record.cross.other,
    hash,
    record.cross.otherSig,
    record.cross.other,
  );
  return selfOk && otherOk;
}

function holderConsent(decoded, record, holder, contract) {
  if (!record.cross || !equalBytes(record.cross.other, holder)) return false;
  return crossOk(decoded, record, contract);
}

function judge(decoded, record, state, ctx) {
  if (record.sig.length !== 65) return 'rule_4';
  if (record.type === REC_REGISTER) {
    if (decoded.kind !== KIND_PAYTO) return 'rule_4';
    if (!isAllowedAlg(record.alg)) return 'rule_4';
    const placed = epochFor(ctx, record.block);
    if (!placed) return 'rule_1';
    if (typeof record.expiry !== 'bigint' || record.expiry <= placed.hourStart) return 'rule_2';
    const hash = sellerKeyHash(record.alg, record.key);
    if (!hash) return 'rule_4';
    const deadAt = state.tombstones.get(bytesToHex(hash));
    if (deadAt !== undefined && record.block >= deadAt) return 'rule_2';
    if (!verifyPayToControl(
      decoded.chainId,
      placed.contract,
      decoded.id,
      record.alg,
      record.key,
      record.expiry,
      record.sig,
    )) {
      return 'rule_4';
    }
    for (const key of state.keys) {
      if (equalBytes(key.key, record.key)) return 'rule_2';
      if (overlaps(key.validFrom, key.revokedAt, record.block, 0n)) return 'rule_2';
    }
    if (record.cross && !crossOk(decoded, record, placed.contract)) return 'rule_7';
    return null;
  }
  if (record.type === REC_REVOKE) {
    if (decoded.kind !== KIND_PAYTO) return 'rule_4';
    const placed = epochFor(ctx, record.block);
    if (!placed) return 'rule_1';
    const key = state.keys.find((item) => equalBytes(sellerKeyHash(item.alg, item.key), record.keyHash));
    if (!key || key.revokedAt !== 0n) return 'rule_2';
    if (record.block <= key.validFrom) return 'rule_2';
    const signed = record.by === 'key'
      ? (sellerKeyHash(record.alg, record.key) && equalBytes(sellerKeyHash(record.alg, record.key), record.keyHash)
        && verifyKeyRevoke(decoded.chainId, placed.contract, record.key, record.keyHash, record.sig))
      : verifyPayToRevoke(decoded.chainId, placed.contract, decoded.id, record.keyHash, record.sig);
    if (!signed) return 'rule_4';
    return null;
  }
  if (record.type === REC_JOIN) {
    const placed = epochFor(ctx, record.block);
    if (!placed) return 'rule_1';
    if (decoded.kind !== KIND_WALLET) return 'rule_4';
    if (!verifyWalletJoin(decoded.chainId, placed.contract, decoded.id, record.commitment, record.block, record.sig)) {
      return 'rule_4';
    }
    if (state.stopped || state.active !== null) return 'rule_2';
    return null;
  }
  if (record.type === REC_STOP) {
    const placed = epochFor(ctx, record.block);
    if (!placed) return 'rule_1';
    if (decoded.kind !== KIND_WALLET) return 'rule_4';
    if (!verifyWalletStop(decoded.chainId, placed.contract, decoded.id, record.commitment, record.block, record.sig)) {
      return 'rule_4';
    }
    if (state.active === null || state.stopped) return 'rule_2';
    return null;
  }
  if (record.type === REC_LEAVE) {
    const placed = epochFor(ctx, record.block);
    if (!placed) return 'rule_1';
    if (decoded.kind !== KIND_WALLET) return 'rule_4';
    if (!verifyWalletLeave(decoded.chainId, placed.contract, decoded.id, record.block, record.sig)) return 'rule_4';
    if (state.active === null && !state.stopped) return 'rule_2';
    return null;
  }
  if (record.type === REC_BOOK) {
    const placed = epochFor(ctx, record.block);
    if (!placed) return 'rule_1';
    if (decoded.kind !== KIND_BOOK) return 'rule_4';
    if (!verifyBookCreate(decoded.chainId, placed.contract, decoded.id, record.identityKey, record.block, record.sig)) {
      return 'rule_4';
    }
    if (state.book !== null) return 'rule_1';
    return null;
  }
  return 'rule_4';
}

function apply(record, state) {
  if (record.type === REC_REGISTER) {
    state.keys.push({
      alg: record.alg,
      key: record.key,
      validFrom: record.block,
      revokedAt: 0n,
      controlSig: record.sig,
      revokeSig: null,
      seq: record.seq,
    });
    return;
  }
  if (record.type === REC_REVOKE) {
    const key = state.keys.find((item) => equalBytes(sellerKeyHash(item.alg, item.key), record.keyHash));
    key.revokedAt = record.block;
    key.revokeSig = record.sig;
    if (record.by === 'key') rememberTombstone(state.tombstones, bytesToHex(record.keyHash), record.block);
    return;
  }
  if (record.type === REC_JOIN) {
    state.active = record.commitment;
    return;
  }
  if (record.type === REC_STOP) {
    state.stopped = true;
    state.active = null;
    return;
  }
  if (record.type === REC_LEAVE) {
    state.active = null;
    state.stopped = false;
    return;
  }
  if (record.type === REC_BOOK) {
    state.book = record.identityKey;
  }
}

/**
 * Ordering compares admission blocks only. fromBlock is a different field
 * and is not read here.
 */
function blockDecreased(record, previousBlock) {
  if (previousBlock === null) return false;
  return record.block < previousBlock;
}

function fold(decoded, ctx) {
  const state = {
    keys: [],
    active: null,
    stopped: false,
    book: null,
    tombstones: seedTombstones(ctx),
  };
  const faults = [];
  const seen = new Set();
  let previousBlock = null;
  for (const record of decoded.records) {
    let reason = null;
    if (blockDecreased(record, previousBlock)) reason = 'rule_1';
    const idHex = bytesToHex(record.id);
    if (!reason && seen.has(idHex)) reason = 'rule_1';
    if (!reason) reason = judge(decoded, record, state, ctx);
    if (reason) {
      faults.push({
        seq: record.seq.toString(),
        rule: reason,
        line: faultLine(record.seq),
      });
    } else {
      apply(record, state);
      seen.add(idHex);
      previousBlock = record.block;
    }
  }
  return { ...state, faults };
}

export function assess(bytes, ctx) {
  const decoded = decodeHistory(bytes);
  if (!decoded.ok) {
    return {
      ok: false,
      reason: decoded.reason,
      killed: false,
      faults: [],
      status: KEY_STATUS_UNPROVEN,
    };
  }
  const folded = fold(decoded, ctx || null);
  const killed = false;
  return {
    ok: true,
    killed,
    kind: decoded.kind,
    chainId: decoded.chainId,
    id: decoded.id,
    faults: folded.faults,
    keys: folded.keys,
    active: folded.active,
    stopped: folded.stopped,
    book: folded.book,
    tombstones: folded.tombstones,
    count: decoded.records.length,
  };
}

export function admit(bytes, record, ctx) {
  const decoded = decodeHistory(bytes);
  if (!decoded.ok) return decoded;
  const seq = BigInt(decoded.records.length);
  if (!record || record.seq !== seq) return fail('rule_1');
  const encoded = encodeHistory({
    kind: decoded.kind,
    chainId: decoded.chainId,
    id: decoded.id,
    records: [...decoded.records, record],
  });
  if (!encoded.ok) return encoded;
  const view = assess(encoded.bytes, ctx);
  if (!view.ok) return { ok: false, reason: view.reason };
  const fault = view.faults.find((item) => item.seq === seq.toString());
  if (fault) return { ok: false, reason: fault.rule };
  if (record.type === REC_REGISTER) {
    const placed = epochFor(ctx, record.block);
    const holders = earlierHolders(ctx, decoded.id, record.key, record);
    if (holders.length > 0 && !holderConsent(decoded, record, holders[0], placed.contract)) {
      return fail('rule_7');
    }
    if (holders.length > 1) return fail('rule_7');
  }
  return { ok: true, bytes: encoded.bytes };
}

function chainOf(value) {
  if (typeof value === 'bigint' && value >= 0n && value <= U64) return value;
  if (typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 && !Object.is(value, -0)) {
    return BigInt(value);
  }
  return null;
}

export function keyStatus(bytes, query) {
  const view = assess(bytes, query?.ctx);
  const unproven = { ok: false, reason: 'key_status_unproven', status: KEY_STATUS_UNPROVEN, killed: false };
  if (!view.ok) return unproven;
  const chain = chainOf(query?.chainId);
  if (chain === null || chain !== view.chainId) {
    return { ok: false, reason: 'bad_history', status: KEY_STATUS_UNPROVEN, killed: false };
  }
  if (view.kind !== KIND_PAYTO) return { ok: false, reason: 'bad_kind', status: KEY_STATUS_UNPROVEN, killed: false };
  const block = typeof query.paymentBlock === 'bigint'
    ? query.paymentBlock
    : (Number.isSafeInteger(query.paymentBlock) ? BigInt(query.paymentBlock) : null);
  if (block === null || !(query.sellerKey instanceof Uint8Array) || !(query.transferTo instanceof Uint8Array)) {
    return fail('bad_type');
  }
  if (!equalBytes(query.transferTo, view.id)) return unproven;
  const matches = view.keys.filter((key) => equalBytes(key.key, query.sellerKey) && covers(key, block, view.tombstones));
  if (matches.length !== 1) return unproven;
  return { ok: true, key: matches[0], status: 'proven' };
}


/**
 * One call for a later verifier: derive the slot key, check the proof, and
 * require the history header to be that kind, chain and id.
 */
export function verifySlot(kind, chainId, id, value, proof, root) {
  const chain = chainOf(chainId);
  if (chain === null) return fail('bad_history');
  if (!(id instanceof Uint8Array)) return fail('bad_type');
  const key = slotKey({ kind, chainId: chain, id });
  if (!key.ok) return key;
  const proved = verifyProof(key.bytes, value, proof, root);
  if (!proved.ok) return proved;
  const decoded = decodeHistory(value);
  if (!decoded.ok) return decoded;
  if (decoded.kind !== kind || decoded.chainId !== chain || !equalBytes(decoded.id, id)) {
    return fail('bad_history');
  }
  return { ok: true, slotKey: key.bytes };
}

/**
 * §S5 payTo key table of the effective keys. Header 9 bytes, an active key
 * 115 bytes, a revoked key 180 bytes.
 */
export function payToEntryBytes(bytes, ctx) {
  const view = assess(bytes, ctx);
  if (!view.ok) return view;
  if (view.kind !== KIND_PAYTO) return fail('bad_kind');
  let size = 9;
  for (const key of view.keys) size += key.revokedAt === 0n ? 115 : 180;
  const out = new Uint8Array(size);
  writeU64(out, 0, 1n);
  out[8] = view.keys.length;
  let at = 9;
  for (const key of view.keys) {
    out[at] = key.alg;
    out.set(key.key, at + 1);
    writeU64(out, at + 34, key.validFrom);
    writeU64(out, at + 42, key.revokedAt);
    out.set(key.controlSig, at + 50);
    at += 115;
    if (key.revokedAt !== 0n) {
      out.set(key.revokeSig, at);
      at += 65;
    }
  }
  return { ok: true, bytes: out };
}

export function extendsHistory(prevBytes, nextBytes) {
  const prev = decodeHistory(prevBytes);
  const next = decodeHistory(nextBytes);
  if (!prev.ok || !next.ok) return { ok: false, reason: 'bad_history' };
  if (prev.kind !== next.kind || prev.chainId !== next.chainId || !equalBytes(prev.id, next.id)) {
    return { ok: true, extends: false };
  }
  if (next.records.length < prev.records.length) return { ok: true, extends: false };
  for (let i = 0; i < prev.records.length; i += 1) {
    const left = encodeRecord(prev.records[i]);
    const right = encodeRecord(next.records[i]);
    if (!left || !right || !equalBytes(left, right)) return { ok: true, extends: false };
  }
  return { ok: true, extends: true };
}

/**
 * Both roots prove their values, and neither history extends the other.
 * That is slot equivocation (rule 5). A longer history that keeps the
 * earlier records byte for byte is not.
 */
export function detectEquivocation(earlier, later) {
  if (!earlier || !later || !(earlier.key instanceof Uint8Array) || !(later.key instanceof Uint8Array)) {
    return fail('bad_type');
  }
  if (!equalBytes(earlier.key, later.key)) return { ok: true, equivocation: false };
  const provedEarlier = verifyProof(earlier.key, earlier.value, earlier.proof, earlier.root);
  if (!provedEarlier.ok) return provedEarlier;
  const provedLater = verifyProof(later.key, later.value, later.proof, later.root);
  if (!provedLater.ok) return provedLater;
  const older = decodeHistory(earlier.value);
  const newer = decodeHistory(later.value);
  if (!older.ok || !newer.ok) return { ok: false, reason: 'bad_history' };
  if (older.kind !== newer.kind || older.chainId !== newer.chainId || !equalBytes(older.id, newer.id)) {
    return { ok: true, equivocation: false };
  }
  const derived = slotKey({ kind: older.kind, chainId: older.chainId, id: older.id });
  if (!derived.ok || !equalBytes(derived.bytes, earlier.key)) return { ok: false, reason: 'bad_key' };
  const forward = extendsHistory(earlier.value, later.value);
  if (!forward.ok) return forward;
  if (forward.extends) return { ok: true, equivocation: false };
  return { ok: true, equivocation: true, reason: 'rule_5' };
}


function revokeRecordId(slotId, keyHash) {
  return sha256([
    new TextEncoder().encode('chit402-smt-revoke-v1'),
    slotId,
    keyHash,
  ]);
}

/**
 * Rule 7: a key-signed revocation is written into every payTo history that
 * still holds that seller key. PayTo-signed revocations stay on their own
 * slot (the typed message binds the payTo).
 */
export function revokeAcross(histories, input, ctx) {
  if (!Array.isArray(histories) || !input) return fail('bad_type');
  const alg = input.alg === undefined ? 1 : input.alg;
  const keyHash = sellerKeyHash(alg, input.key);
  if (!keyHash) return fail('bad_key');
  const block = fitU64(input.block);
  if (block === null) return fail('bad_history');
  if (!(input.sig instanceof Uint8Array)) return fail('bad_length');
  const next = [];
  let applied = 0;
  for (const bytes of histories) {
    const decoded = decodeHistory(bytes);
    if (!decoded.ok) return decoded;
    const view = assess(bytes, ctx);
    if (!view.ok) return view;
    const holds = view.keys.some((key) => equalBytes(key.key, input.key) && key.revokedAt === 0n);
    if (!holds) {
      next.push(bytes);
      continue;
    }
    const record = {
      seq: BigInt(decoded.records.length),
      block,
      fromBlock: input.fromBlock === undefined ? null : input.fromBlock,
      id: revokeRecordId(decoded.id, keyHash),
      type: REC_REVOKE,
      sig: input.sig,
      keyHash,
      by: 'key',
      alg,
      key: input.key,
    };
    const admitted = admit(bytes, record, ctx);
    if (!admitted.ok) return admitted;
    next.push(admitted.bytes);
    applied += 1;
  }
  if (applied === 0) return fail('rule_4');
  return { ok: true, histories: next, applied };
}
