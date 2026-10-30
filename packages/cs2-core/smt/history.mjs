/**
 * Slot histories and SIMPLE §S5 rules 1–7.
 *
 * The bytes stored under a slot key are this history, not a second encoding
 * of the slot key. The slot key itself is only ever produced by `slotKey`
 * in the line module (see placeHistory). Rule 6 hashing is stateLeaf.
 *
 * Rule 1 (DS-70, DS-79, DS-78): seq starts at 0 and rises by 1. Ordering
 * uses the admission block. fromBlock is stored and is not that block.
 * Count equals the number of records, which equals last seq + 1. A record
 * that breaks a rule still occupies its seq.
 *
 * Rule 2: payTo intervals [validFrom, revokedAt) are pairwise disjoint and
 * only the last may be open (revokedAt 0). A wallet has at most one active
 * book, unless the slot is in STOP.
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
 * Rule 7 (DS-58): a seller key already in another payTo slot is rejected
 * unless both payTos sign. A revocation signed by the key (by keyHash)
 * applies to every slot that holds that key.
 *
 * DS-78: admit rejects a breaching record. assess, for a history that was
 * anchored anyway, ignores that record, prints
 * "invalid record at seq n (Chit fault)", and does not kill the slot.
 * The payTo key table in SIMPLE §S5 (version, count, keys) is a projection
 * of the effective keys. A clean one-key table is 124 bytes, 156 with the
 * slot key.
 */

import { createHash } from 'node:crypto';
import { KIND_BOOK, KIND_PAYTO, KIND_WALLET, isAllowedAlg } from '../line/index.mjs';
import { bytesToHex, equalBytes } from '../ecdsa/bytes.js';
import { verifyProof } from './tree.mjs';
import { fail } from './reasons.mjs';
import {
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
    const cross = record.cross ? 1 : 0;
    const extra = cross ? 20 + 65 + 65 : 0;
    const body = new Uint8Array(1 + 33 + 8 + 1 + extra);
    body[0] = record.alg;
    body.set(record.key, 1);
    writeU64(body, 34, record.validFrom);
    body[42] = cross;
    if (cross) {
      body.set(record.cross.other, 43);
      body.set(record.cross.otherSig, 63);
      body.set(record.cross.selfSig, 128);
    }
    return body;
  }
  if (record.type === REC_REVOKE) {
    const body = new Uint8Array(32 + 8 + 1);
    body.set(record.keyHash, 0);
    writeU64(body, 32, record.revokedAt);
    body[40] = record.by === 'key' ? 2 : 1;
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
    const validFrom = readU64(body, 34);
    const cross = body[42];
    if (validFrom === null) return null;
    if (cross === 0) {
      if (body.length !== 43) return null;
      return { alg, key: new Uint8Array(key), validFrom, cross: null };
    }
    if (cross !== 1 || body.length !== 43 + 20 + 65 + 65) return null;
    return {
      alg,
      key: new Uint8Array(key),
      validFrom,
      cross: {
        other: new Uint8Array(body.subarray(43, 63)),
        otherSig: new Uint8Array(body.subarray(63, 128)),
        selfSig: new Uint8Array(body.subarray(128, 193)),
      },
    };
  }
  if (type === REC_REVOKE) {
    if (body.length !== 41) return null;
    const by = body[40];
    if (by !== 1 && by !== 2) return null;
    return {
      keyHash: new Uint8Array(body.subarray(0, 32)),
      revokedAt: readU64(body, 32),
      by: by === 2 ? 'key' : 'payTo',
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
  const out = new Uint8Array(8 + 8 + 8 + 32 + 1 + 2 + body.length + 65);
  writeU64(out, 0, record.seq);
  writeU64(out, 8, record.block);
  writeU64(out, 16, record.fromBlock === null ? NO_FROM : record.fromBlock);
  out.set(record.id, 24);
  out[56] = record.type;
  out[57] = Math.floor(body.length / 256) % 256;
  out[58] = body.length % 256;
  out.set(body, 59);
  out.set(record.sig, 59 + body.length);
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
  const sig = take(bytes, cursor, 65);
  if (!body || !sig) return null;
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
  if (!(record.sig instanceof Uint8Array) || record.sig.length !== 65) return fail('bad_length');
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

function covers(key, block) {
  if (block < key.validFrom) return false;
  if (key.revokedAt !== 0n && block >= key.revokedAt) return false;
  return true;
}

function localKeys(bytes) {
  const decoded = decodeHistory(bytes);
  if (!decoded.ok) return new Set();
  const folded = fold(decoded, null);
  const out = new Set();
  for (const key of folded.keys) out.add(bytesToHex(key.key));
  return out;
}

function othersHaveKey(ctx, selfId, key) {
  if (!ctx || !Array.isArray(ctx.others)) return false;
  const want = bytesToHex(key);
  for (const other of ctx.others) {
    if (!(other?.id instanceof Uint8Array) || !(other.bytes instanceof Uint8Array)) continue;
    if (equalBytes(other.id, selfId)) continue;
    if (localKeys(other.bytes).has(want)) return true;
  }
  return false;
}

function crossOk(decoded, record) {
  const hash = sellerKeyHash(record.key);
  if (!hash || !record.cross) return false;
  const selfOk = verifyCrossSig(
    decoded.chainId,
    decoded.id,
    record.cross.other,
    hash,
    record.cross.selfSig,
    decoded.id,
  );
  const otherOk = verifyCrossSig(
    decoded.chainId,
    decoded.id,
    record.cross.other,
    hash,
    record.cross.otherSig,
    record.cross.other,
  );
  return selfOk && otherOk;
}

function judge(decoded, record, state, ctx) {
  if (record.type === REC_REGISTER) {
    if (decoded.kind !== KIND_PAYTO) return 'rule_4';
    if (!isAllowedAlg(record.alg)) return 'rule_4';
    if (!verifyPayToControl(decoded.chainId, decoded.id, record.alg, record.key, record.validFrom, record.sig)) {
      return 'rule_4';
    }
    // The interval starts at admission. fromBlock is not this block (DS-79).
    if (record.validFrom !== record.block) return 'rule_2';
    for (const key of state.keys) {
      if (equalBytes(key.key, record.key)) return 'rule_2';
      if (overlaps(key.validFrom, key.revokedAt, record.validFrom, 0n)) return 'rule_2';
    }
    if (record.cross && !crossOk(decoded, record)) return 'rule_7';
    if (othersHaveKey(ctx, decoded.id, record.key) && !crossOk(decoded, record)) return 'rule_7';
    return null;
  }
  if (record.type === REC_REVOKE) {
    if (decoded.kind !== KIND_PAYTO) return 'rule_4';
    const key = state.keys.find((item) => equalBytes(sellerKeyHash(item.key), record.keyHash));
    if (!key || key.revokedAt !== 0n) return 'rule_2';
    if (record.revokedAt <= key.validFrom) return 'rule_2';
    if (record.revokedAt < record.block) return 'rule_2';
    const signed = record.by === 'key'
      ? verifyKeyRevoke(decoded.chainId, key.key, record.keyHash, record.revokedAt, record.sig)
      : verifyPayToRevoke(decoded.chainId, decoded.id, record.keyHash, record.revokedAt, record.sig);
    if (!signed) return 'rule_4';
    return null;
  }
  if (record.type === REC_JOIN) {
    if (decoded.kind !== KIND_WALLET) return 'rule_4';
    if (!verifyWalletJoin(decoded.chainId, decoded.id, record.commitment, record.block, record.sig)) {
      return 'rule_4';
    }
    if (state.stopped || state.active !== null) return 'rule_2';
    return null;
  }
  if (record.type === REC_STOP) {
    if (decoded.kind !== KIND_WALLET) return 'rule_4';
    if (!verifyWalletStop(decoded.chainId, decoded.id, record.commitment, record.block, record.sig)) {
      return 'rule_4';
    }
    if (state.active === null || state.stopped) return 'rule_2';
    return null;
  }
  if (record.type === REC_LEAVE) {
    if (decoded.kind !== KIND_WALLET) return 'rule_4';
    if (!verifyWalletLeave(decoded.chainId, decoded.id, record.block, record.sig)) return 'rule_4';
    if (state.active === null && !state.stopped) return 'rule_2';
    return null;
  }
  if (record.type === REC_BOOK) {
    if (decoded.kind !== KIND_BOOK) return 'rule_4';
    if (!verifyBookCreate(decoded.chainId, decoded.id, record.identityKey, record.block, record.sig)) {
      return 'rule_4';
    }
    // One creation record. Book events past creation are rule 8, not this module.
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
      validFrom: record.validFrom,
      revokedAt: 0n,
      controlSig: record.sig,
      revokeSig: null,
      seq: record.seq,
    });
    return;
  }
  if (record.type === REC_REVOKE) {
    const key = state.keys.find((item) => equalBytes(sellerKeyHash(item.key), record.keyHash));
    key.revokedAt = record.revokedAt;
    key.revokeSig = record.sig;
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
 * (DS-79) and is not read here.
 */
function blockDecreased(record, previousBlock) {
  if (previousBlock === null) return false;
  return record.block < previousBlock;
}

function fold(decoded, ctx) {
  const state = { keys: [], active: null, stopped: false, book: null };
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
    }
    seen.add(idHex);
    previousBlock = record.block;
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
  return { ok: true, bytes: encoded.bytes };
}

export function keyStatus(bytes, query) {
  const view = assess(bytes, query?.ctx);
  const unproven = { ok: false, reason: 'key_status_unproven', status: KEY_STATUS_UNPROVEN, killed: false };
  if (!view.ok) return unproven;
  if (view.kind !== KIND_PAYTO) return unproven;
  const block = typeof query.paymentBlock === 'bigint'
    ? query.paymentBlock
    : (Number.isSafeInteger(query.paymentBlock) ? BigInt(query.paymentBlock) : null);
  if (block === null || !(query.sellerKey instanceof Uint8Array) || !(query.transferTo instanceof Uint8Array)) {
    return fail('bad_type');
  }
  if (!equalBytes(query.transferTo, view.id)) return unproven;
  const matches = view.keys.filter((key) => equalBytes(key.key, query.sellerKey) && covers(key, block));
  if (matches.length !== 1) return unproven;
  return { ok: true, key: matches[0], status: 'proven' };
}

/**
 * §S5 payTo key table of the effective keys. Header 9 bytes, an active key
 * 115 bytes, a revoked key 180 bytes.
 */
export function payToEntryBytes(bytes) {
  const view = assess(bytes);
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
export function detectEquivocation(left, right) {
  const provedLeft = verifyProof(left.key, left.value, left.proof, left.root);
  if (!provedLeft.ok) return provedLeft;
  const provedRight = verifyProof(right.key, right.value, right.proof, right.root);
  if (!provedRight.ok) return provedRight;
  if (equalBytes(left.value, right.value)) return { ok: true, equivocation: false };
  const forward = extendsHistory(left.value, right.value);
  if (!forward.ok) return forward;
  if (forward.extends) return { ok: true, equivocation: false };
  const backward = extendsHistory(right.value, left.value);
  if (!backward.ok) return backward;
  if (backward.extends) return { ok: true, equivocation: false };
  return { ok: true, equivocation: true, reason: 'rule_5' };
}

function u64Bytes(value) {
  const out = new Uint8Array(8);
  writeU64(out, 0, value);
  return out;
}

function revokeRecordId(slotId, keyHash, revokedAt) {
  return sha256([
    new TextEncoder().encode('chit402-smt-revoke-v1'),
    slotId,
    keyHash,
    u64Bytes(revokedAt),
  ]);
}

/**
 * Rule 7: a key-signed revocation is written into every payTo history that
 * still holds that seller key. PayTo-signed revocations stay on their own
 * slot (the typed message binds the payTo).
 */
export function revokeAcross(histories, input) {
  if (!Array.isArray(histories)) return fail('bad_type');
  const keyHash = sellerKeyHash(input.key);
  if (!keyHash) return fail('bad_key');
  const revokedAt = fitU64(input.revokedAt);
  const block = fitU64(input.block);
  if (revokedAt === null || block === null) return fail('bad_history');
  if (!(input.sig instanceof Uint8Array)) return fail('bad_length');
  const next = [];
  let applied = 0;
  for (const bytes of histories) {
    const decoded = decodeHistory(bytes);
    if (!decoded.ok) return decoded;
    const view = assess(bytes);
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
      id: revokeRecordId(decoded.id, keyHash, revokedAt),
      type: REC_REVOKE,
      sig: input.sig,
      keyHash,
      revokedAt,
      by: 'key',
    };
    const admitted = admit(bytes, record, null);
    if (!admitted.ok) return admitted;
    next.push(admitted.bytes);
    applied += 1;
  }
  if (applied === 0) return fail('rule_4');
  return { ok: true, histories: next, applied };
}
