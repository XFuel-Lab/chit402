/**
 * Wallet and book slot histories, plus the depth-256 state tree's epoch slot.
 *
 * The bytes stored under a slot key are this history. The slot key itself
 * is only produced by `slotKey` in the line module. Rule 6 hashing is stateLeaf.
 *
 * Rule 1: seq starts at 0 and rises by 1. Ordering uses the admission block.
 * fromBlock is stored and is not that block. The block must fall after the
 * previous epoch anchor and no later than the anchor of the epoch that shows
 * the record. An ignored record does not move the block floor or claim its id.
 *
 * A wallet has at most one active book, unless the slot is in STOP.
 * A wallet join, leave, or stop is signed by the wallet. A book creation is
 * signed by the identity key named in the record. A record whose signature
 * does not verify is invalid.
 *
 * Rule 5: the history at e+1 extends the history at e. Anything else, under
 * two roots that both prove the same slot, is equivocation.
 *
 * admit rejects a breaching record. assess ignores that record, prints
 * "invalid record at seq n (Chit fault)", and does not kill the slot.
 */

import { KIND_BOOK, KIND_WALLET, slotKey } from '../line/index.mjs';
import { bytesToHex, equalBytes } from '../ecdsa/bytes.js';
import { verifyProof } from './tree.mjs';
import { fail } from './reasons.mjs';
import {
  contractForHour,
  verifyBookCreate,
  verifyWalletJoin,
  verifyWalletLeave,
  verifyWalletStop,
} from './sig.mjs';

export const HISTORY_VERSION = 1;
export const REC_JOIN = 3;
export const REC_LEAVE = 4;
export const REC_STOP = 5;
export const REC_BOOK = 6;
export const NEWER_VERIFIER = 'needs a newer verifier';

/**
 * Record types. 1 and 2 are payTo records on the seller-key add-on.
 * 3–6 are the wallet and book records this module folds. 7–15 are reserved
 * for SIMPLE book records. 16 is the E6 cap row. 0 and 255 are invalid.
 * Any other type is opaque: it round-trips, and folding stops at its block.
 */
export const RECORD_TYPES = Object.freeze([
  Object.freeze({ type: 0, name: 'invalid' }),
  Object.freeze({ type: 1, name: 'payTo' }),
  Object.freeze({ type: 2, name: 'payTo' }),
  Object.freeze({ type: 3, name: 'wallet_join' }),
  Object.freeze({ type: 4, name: 'wallet_leave' }),
  Object.freeze({ type: 5, name: 'wallet_stop' }),
  Object.freeze({ type: 6, name: 'book_create' }),
  Object.freeze({ type: 7, name: 'reserved_simple_book' }),
  Object.freeze({ type: 8, name: 'reserved_simple_book' }),
  Object.freeze({ type: 9, name: 'reserved_simple_book' }),
  Object.freeze({ type: 10, name: 'reserved_simple_book' }),
  Object.freeze({ type: 11, name: 'reserved_simple_book' }),
  Object.freeze({ type: 12, name: 'reserved_simple_book' }),
  Object.freeze({ type: 13, name: 'reserved_simple_book' }),
  Object.freeze({ type: 14, name: 'reserved_simple_book' }),
  Object.freeze({ type: 15, name: 'reserved_simple_book' }),
  Object.freeze({ type: 16, name: 'e6_cap_row' }),
  Object.freeze({ type: 255, name: 'invalid' }),
]);

/** Implementation limit on records in one history. Not a wire field. */
export const MAX_RECORDS = 1_048_576;

const U64 = (1n << 64n) - 1n;
const NO_FROM = U64;

export function faultLine(seq) {
  return `invalid record at seq ${seq} (Chit fault)`;
}

function idLength(kind) {
  if (kind === KIND_WALLET) return 20;
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

function knownType(type) {
  return type === REC_JOIN || type === REC_LEAVE || type === REC_STOP || type === REC_BOOK;
}

function invalidType(type) {
  return type === 0 || type === 255;
}

function encodeBody(record) {
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
  if (!knownType(record.type) && !invalidType(record.type) && record.body instanceof Uint8Array) {
    if (record.body.length > 0xffff) return null;
    return new Uint8Array(record.body);
  }
  return null;
}

function decodeBody(type, body) {
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
  if (invalidType(type)) return null;
  return { body: new Uint8Array(body), opaque: true };
}

export function encodeRecord(record) {
  const body = encodeBody(record);
  if (!body || body.length > 0xffff) return null;
  if (!(record.sig instanceof Uint8Array) || record.sig.length > 0xffff) return null;
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
  const start = cursor.at;
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
  if (invalidType(typeByte[0])) return { invalidType: true };
  const parsed = decodeBody(typeByte[0], body);
  if (!parsed) return null;
  return {
    seq,
    block,
    fromBlock: fromRaw === NO_FROM ? null : fromRaw,
    id: new Uint8Array(id),
    type: typeByte[0],
    sig: new Uint8Array(sig),
    raw: bytes.slice(start, cursor.at),
    ...parsed,
  };
}

function checkRecordShape(record, index) {
  if (!record || typeof record !== 'object') return fail('bad_type');
  if (fitU64(record.seq) === null || record.seq !== BigInt(index)) return fail('rule_1');
  if (fitU64(record.block) === null) return fail('bad_history');
  if (record.fromBlock === U64) return fail('bad_history');
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
    if (record && record.invalidType) return fail('bad_type');
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

function judge(decoded, record, state, ctx) {
  if (record.opaque) return 'newer_rules';
  if (record.type === REC_JOIN) {
    if (record.sig.length !== 65) return 'rule_4';
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
    if (record.sig.length !== 65) return 'rule_4';
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
    if (record.sig.length !== 65) return 'rule_4';
    const placed = epochFor(ctx, record.block);
    if (!placed) return 'rule_1';
    if (decoded.kind !== KIND_WALLET) return 'rule_4';
    if (!verifyWalletLeave(decoded.chainId, placed.contract, decoded.id, record.block, record.sig)) return 'rule_4';
    if (state.active === null && !state.stopped) return 'rule_2';
    return null;
  }
  if (record.type === REC_BOOK) {
    if (record.sig.length !== 65) return 'rule_4';
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
    active: null,
    stopped: false,
    book: null,
  };
  const faults = [];
  const seen = new Set();
  let previousBlock = null;
  let newerFrom = null;
  for (const record of decoded.records) {
    if (newerFrom !== null) break;
    let reason = null;
    if (blockDecreased(record, previousBlock)) reason = 'rule_1';
    const idHex = bytesToHex(record.id);
    if (!reason && seen.has(idHex)) reason = 'rule_1';
    if (!reason) reason = judge(decoded, record, state, ctx);
    if (reason === 'newer_rules') {
      newerFrom = record.block;
      faults.push({
        seq: record.seq.toString(),
        rule: reason,
        line: NEWER_VERIFIER,
      });
      break;
    }
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
  return { ...state, faults, newerFrom };
}

export function assess(bytes, ctx) {
  const decoded = decodeHistory(bytes);
  if (!decoded.ok) {
    return {
      ok: false,
      reason: decoded.reason,
      killed: false,
      faults: [],
    };
  }
  const folded = fold(decoded, ctx || null);
  if (folded.error) {
    return {
      ok: false,
      reason: folded.error,
      killed: false,
      faults: [],
    };
  }
  const killed = false;
  return {
    ok: true,
    killed,
    kind: decoded.kind,
    chainId: decoded.chainId,
    id: decoded.id,
    faults: folded.faults,
    newerFrom: folded.newerFrom,
    active: folded.active,
    stopped: folded.stopped,
    book: folded.book,
    count: decoded.records.length,
  };
}

/**
 * A fact at a block before an opaque record still stands. From that record's
 * block onward the result is exit 2, never exit 0.
 */
export function factAt(bytes, block, ctx) {
  const blockNum = typeof block === 'bigint'
    ? block
    : (typeof block === 'number' && Number.isSafeInteger(block) && block >= 0 ? BigInt(block) : null);
  if (blockNum === null) return { exit: 1, reason: 'bad_history' };
  const view = assess(bytes, ctx);
  if (!view.ok) return { exit: view.reason === 'bad_type' ? 1 : 2, reason: view.reason };
  if (view.newerFrom !== null && view.newerFrom !== undefined && blockNum >= view.newerFrom) {
    return { exit: 2, reason: NEWER_VERIFIER };
  }
  return { exit: 0, reason: null };
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
  if (view.newerFrom != null) return { ok: false, reason: 'newer_rules' };
  const fault = view.faults.find((item) => item.seq === seq.toString());
  if (fault) return { ok: false, reason: fault.rule };
  return { ok: true, bytes: encoded.bytes };
}

function chainOf(value) {
  if (typeof value === 'bigint' && value >= 0n && value <= U64) return value;
  if (typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 && !Object.is(value, -0)) {
    return BigInt(value);
  }
  return null;
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
 * An admission block is accepted only when the record is absent under the
 * previous epoch root, present under this epoch root, and the block sits
 * strictly after the previous anchor and at or before this epoch's anchor.
 */
export function extendsHistory(prevBytes, nextBytes) {
  const prev = decodeHistory(prevBytes);
  const next = decodeHistory(nextBytes);
  if (!prev.ok || !next.ok) return { ok: false, reason: 'bad_history' };
  if (prev.kind !== next.kind || prev.chainId !== next.chainId || !equalBytes(prev.id, next.id)) {
    return { ok: true, extends: false };
  }
  if (next.records.length < prev.records.length) return { ok: true, extends: false };
  for (let i = 0; i < prev.records.length; i += 1) {
    const left = prev.records[i].raw instanceof Uint8Array ? prev.records[i].raw : encodeRecord(prev.records[i]);
    const right = next.records[i].raw instanceof Uint8Array ? next.records[i].raw : encodeRecord(next.records[i]);
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
  const epochNum = (value) => {
    if (typeof value === 'bigint' && value >= 0n) return value;
    if (typeof value === 'number' && Number.isSafeInteger(value) && value >= 0) return BigInt(value);
    return null;
  };
  const earlierEpoch = epochNum(earlier.epoch);
  const laterEpoch = epochNum(later.epoch);
  if (earlierEpoch === null || laterEpoch === null || earlierEpoch >= laterEpoch) return fail('bad_epoch');
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
