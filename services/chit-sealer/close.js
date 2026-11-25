/**
 * Hourly close.
 *
 * Finished hours only: hourStart + 3600 <= now. The current hour is not
 * closed. A catch-up close lands on the last complete hour and pads the
 * log to k·N, and a covered hour is not closed again.
 *
 * The epoch slot is drawn here from the sealer CSPRNG. A value on the
 * close input is ignored. The finished-hour clock is the sealer clock,
 * in unix seconds. (epoch, hourStart, size, root, stateRoot) and the
 * receipt rows, including sealed ciphertext, are committed to the
 * private journal before the store write and the first broadcast.
 * Recovery re-commits that journaled record. It does not rebuild an
 * epoch. Fee bumps reuse that calldata at the same nonce.
 */

import { createHash } from 'node:crypto';
import { anchorBackoffMs, classifyAnchorSendError } from './anchor-class.js';
import { bytesToHex } from '../../packages/cs2-core/ecdsa/bytes.js';
import { eip1559Decode, eip1559TxHash } from '../../packages/cs2-core/ecdsa/eip1559.js';
import {
  consistencyProof,
  inclusionProof,
  leafHash,
  mth,
} from '../../packages/cs2-core/merkle/index.js';
import { KIND_EPOCH, KIND_PAYMENT, KIND_PAYTO, KIND_WALLET, canonicalPaymentId, slotKey } from '../../packages/cs2-core/line/index.mjs';
import {
  createTree,
  drawEpoch,
  emptyHistory,
  entryCount,
  hasLeaf,
  padTo1024,
  placeHistory,
  prove,
  putLeaf,
  rootBytes,
} from '../../packages/cs2-core/smt/index.mjs';
import { sealLine } from '../../packages/cs2-core/seal/index.js';
import {
  broadcastAnchor,
  bumpAnchorFees,
  bumpFeeQuote,
  openAnchorIntentLog,
} from './kms-secp256k1.js';
import { buildAnchorCalldata } from './calldata.js';
import { readPendingLines, sealIntakeLines } from '../chit-store/intake.js';
import { openJournal } from './journal.js';
import { acceptCoreLine } from './lines.js';
import { TIER_N, padLeaves } from './pad.js';
import { addLogSize, leafIndex } from './size.js';

const HOUR = 3600;
const MAX_BACKLOG = 168;

export function csprng(n) {
  const cryptoObj = globalThis.crypto;
  if (!cryptoObj || typeof cryptoObj.getRandomValues !== 'function') return null;
  const out = new Uint8Array(n);
  cryptoObj.getRandomValues(out);
  return out;
}

function fail(reason) {
  return { ok: false, reason };
}

/**
 * DS-140. hourStart is a multiple of 3600, and the hour has ended.
 * @param {number} hourStart
 * @param {number} now
 */
export function hourIsFinished(hourStart, now) {
  if (typeof hourStart !== 'number' || typeof now !== 'number') return false;
  if (Object.is(hourStart, -0) || Object.is(now, -0)) return false;
  if (!Number.isSafeInteger(hourStart) || !Number.isSafeInteger(now)) return false;
  if (hourStart < 0 || now < 0) return false;
  if (Math.floor(hourStart) !== hourStart) return false;
  if (hourStart % HOUR !== 0) return false;
  return hourStart + 3600 <= now;
}

function planHours(state, now, requested) {
  if (typeof now !== 'number' || !Number.isSafeInteger(now) || now < 0 || Object.is(now, -0)) {
    return fail('hour_not_finished');
  }
  const boundary = Math.floor(now / HOUR) * HOUR;
  const lastComplete = boundary - HOUR;
  if (!Number.isSafeInteger(lastComplete) || lastComplete < 0) return fail('hour_not_finished');
  const hourStart = requested == null ? lastComplete : requested;
  if (!hourIsFinished(hourStart, now)) return fail('hour_not_finished');
  if (state.lastHourStart == null) {
    return { ok: true, hourStart, k: 1, hours: [hourStart] };
  }
  if (!Number.isSafeInteger(state.lastHourStart)) return fail('hour_not_finished');
  if (hourStart <= state.lastHourStart) return fail('hour_already_covered');
  const gap = (hourStart - state.lastHourStart) / HOUR;
  if (!Number.isSafeInteger(gap) || gap < 1) return fail('hour_not_finished');
  if (gap > MAX_BACKLOG) return fail('backlog_too_large');
  const hours = [];
  for (let step = 1; step <= gap; step += 1) {
    const hour = state.lastHourStart + (step * HOUR);
    if (!Number.isSafeInteger(hour)) return fail('size_cap');
    hours.push(hour);
  }
  return { ok: true, hourStart, k: gap, hours };
}

function refuseRebuilt(state) {
  if (state.commits.some((row) => row.broadcast === false)) {
    return fail('nonce_reused');
  }
  return null;
}

function drawEpochSlot(sealer, input) {
  void input;
  const draw = sealer.randomBytes(32);
  if (!(draw instanceof Uint8Array) || draw.length !== 32) return null;
  return draw;
}

function tierCount(k) {
  if (!Number.isSafeInteger(k) || k < 1) return fail('size_cap');
  const count = Math.floor(k) * TIER_N;
  if (!Number.isSafeInteger(count) || count < TIER_N) return fail('size_cap');
  return { ok: true, count };
}

function acceptLines(items) {
  if (items == null) return { ok: true, lines: [] };
  if (!Array.isArray(items)) return fail('bad_type');
  const lines = [];
  const seen = new Set();
  for (let i = 0; i < items.length; i += 1) {
    const item = items[i];
    if (!item || typeof item.bookId !== 'string') {
      return fail('bad_line');
    }
    const accepted = acceptCoreLine(item.line);
    if (!accepted.ok) return accepted;
    const id = canonicalPaymentId(accepted.payment);
    if (!id.ok) return fail(id.reason);
    if (seen.has(id.hex)) return fail('duplicate_payment');
    seen.add(id.hex);
    lines.push({
      line: accepted.line,
      bookId: item.bookId,
      callerPk: item.bookPk instanceof Uint8Array ? item.bookPk : null,
      payment: accepted.payment,
      paymentId: id.bytes,
    });
  }
  return { ok: true, lines };
}

function sha256Bytes(...parts) {
  const hash = createHash('sha256');
  for (let i = 0; i < parts.length; i += 1) hash.update(parts[i]);
  return new Uint8Array(hash.digest());
}

function bookIdBytes(bookId) {
  if (/^[0-9a-fA-F]{64}$/.test(bookId)) return Uint8Array.from(Buffer.from(bookId, 'hex'));
  return new TextEncoder().encode(bookId);
}

function hashSaltedBook(bookId, bookSalt) {
  return sha256Bytes(bookIdBytes(bookId), bookSalt);
}

function paymentSlotValue(salted, leaf) {
  return sha256Bytes(new TextEncoder().encode('cs2-pay-slot'), salted, leaf);
}

function walletHex(from) {
  if (from instanceof Uint8Array) return `0x${Buffer.from(from).toString('hex')}`;
  return '';
}

function walletInBook(record, from) {
  return record.wallets.has(walletHex(from));
}

function bindBooks(sealer, lines) {
  const tree = sealer.state.tree || createTree();
  for (let i = 0; i < lines.length; i += 1) {
    const row = lines[i];
    const record = sealer.store.bookRecord(row.bookId);
    if (!record) return fail('unknown_book');
    if (!walletInBook(record, row.payment.from)) return fail('unknown_wallet');
    const key = slotKey({ kind: KIND_PAYMENT, chainId: row.payment.chainId, id: row.paymentId });
    if (!key.ok) return fail(key.reason);
    if (hasLeaf(tree, key.bytes)) return fail('duplicate_payment');
    row.bookPk = record.bookPk;
    row.bookSalt = record.bookSalt;
    row.paymentKey = key.bytes;
  }
  return { ok: true };
}

/**
 * Kind 0x01 is a slot, not a history record, so the payTo leaf is written
 * with putLeaf. An empty wallet history is written only when that slot is empty.
 */
function placePayTo(tree, row) {
  const key = slotKey({ kind: KIND_PAYTO, chainId: row.payment.chainId, id: row.payment.to });
  if (!key.ok) return fail(key.reason);
  const value = sha256Bytes(new TextEncoder().encode('cs2-payto-slot'), row.payment.to);
  const placed = putLeaf(tree, key.bytes, value, { dummy: false });
  if (!placed.ok) return fail(placed.reason);
  return { ok: true, tree: placed.tree, key: key.bytes, value };
}

function placeBookedSlots(tree, lines) {
  let next = tree;
  for (let i = 0; i < lines.length; i += 1) {
    const row = lines[i];
    const leaf = leafHash(row.line);
    if (!leaf.ok) return fail(leaf.reason);
    const salted = hashSaltedBook(row.bookId, row.bookSalt);
    const value = paymentSlotValue(salted, leaf.hash);
    const placed = putLeaf(next, row.paymentKey, value, { dummy: false });
    if (!placed.ok) return fail(placed.reason);
    next = placed.tree;
    row.saltedBook = bytesToHex(salted);
    row.paymentValue = bytesToHex(value);
    const payToPlaced = placePayTo(next, row);
    if (!payToPlaced.ok) return payToPlaced;
    next = payToPlaced.tree;
    row.payToKey = payToPlaced.key;
    row.slotValue = bytesToHex(payToPlaced.value);
    row.slotKey = bytesToHex(payToPlaced.key);
    const history = emptyHistory(KIND_WALLET, row.payment.chainId, row.payment.from);
    if (!history.ok) return fail(history.reason);
    const walletKey = slotKey({ kind: KIND_WALLET, chainId: row.payment.chainId, id: row.payment.from });
    if (!walletKey.ok) return fail(walletKey.reason);
    if (!hasLeaf(next, walletKey.bytes)) {
      const booked = placeHistory(next, history.bytes);
      if (!booked.ok) return fail(booked.reason);
      next = booked.tree;
    }
  }
  return { ok: true, tree: next };
}

function advanceTree(sealer, tree, hours, lines) {
  let next = tree;
  for (let i = 0; i < hours.length; i += 1) {
    const epoch = next.epoch ? next.epoch.epoch + 1 : 0;
    const randomness = drawEpochSlot(sealer, sealer._input);
    if (!randomness) return fail('bad_random');
    const drawn = drawEpoch(next, {
      epoch,
      hourStart: hours[i],
      randomness,
      chainId: sealer.chainId,
    });
    if (!drawn.ok) return fail(drawn.reason);
    next = drawn.tree;
  }
  const booked = placeBookedSlots(next, lines || []);
  if (!booked.ok) return booked;
  next = booked.tree;
  if (entryCount(next) < 1024) {
    const seed = sealer.randomBytes(32);
    if (!(seed instanceof Uint8Array) || seed.length !== 32) return fail('bad_random');
    const padded = padTo1024(next, seed);
    if (!padded.ok) return fail(padded.reason);
    next = padded.tree;
  }
  return { ok: true, tree: next };
}

function fingerprintOf(record) {
  const body = [
    record.epoch,
    record.hourStart,
    record.size,
    record.root,
    record.stateRoot,
    record.calldata,
    record.nonce,
  ].join('|');
  return createHash('sha256').update(body).digest('hex');
}

function buildEpoch(sealer, planned, lines) {
  const counted = tierCount(planned.k);
  if (!counted.ok) return counted;
  if (lines.length > counted.count) return fail('tier_exceeded');
  const sized = addLogSize(sealer.state.logSize, counted.count);
  if (!sized.ok) return sized;
  if (sized.size <= sealer.state.logSize) return fail('size_cap');
  const advanced = advanceTree(sealer, sealer.state.tree || createTree(), planned.hours, lines);
  if (!advanced.ok) return advanced;
  const stateRoot = bytesToHex(rootBytes(advanced.tree));
  const epochKey = epochSlotKey(sealer);
  if (!epochKey) return fail('bad_epoch');
  const epochProof = prove(advanced.tree, epochKey);
  if (!epochProof.ok || !epochProof.present) return fail('bad_epoch');
  const real = [];
  for (let i = 0; i < lines.length; i += 1) real.push(lines[i].line);
  const padded = padLeaves(real, counted.count, (n) => sealer.randomBytes(n));
  if (!padded.ok) return padded;
  const announced = padded.count;
  if (announced !== counted.count) return fail('tier_exceeded');
  const all = sealer.state.leaves.concat(padded.leaves);
  const root = mth(all);
  if (!root.ok) return fail(root.reason);
  const proof = consistencyProof(all, sealer.state.logSize, sized.size);
  if (!proof.ok) return fail(proof.reason);
  const rootHex = bytesToHex(root.hash);
  const epoch = sealer.state.anchorEpoch + 1;
  if (!Number.isSafeInteger(epoch)) return fail('size_cap');
  const nonceNumber = sealer.state.nextNonce;
  if (!Number.isSafeInteger(nonceNumber) || nonceNumber < 0) return fail('size_cap');
  const packed = buildAnchorCalldata({
    chainId: sealer.chainId,
    contract: sealer.contract,
    epoch,
    hourStart: planned.hourStart,
    size: sized.size,
    root: rootHex,
    stateRoot,
    proof: proof.proof,
  });
  const epochProofHex = bytesToHex(epochProof.proof);
  const receipts = [];
  for (let i = 0; i < lines.length; i += 1) {
    const sealed = sealLine(lines[i].line, lines[i].bookPk, null);
    if (!sealed.ok) return fail(sealed.reason || 'bad_line');
    let index = -1;
    for (let at = 0; at < padded.leaves.length; at += 1) {
      if (padded.leaves[at] === lines[i].line) {
        const absolute = sealer.state.leaves.length + at;
        const checked = leafIndex(absolute);
        if (!checked.ok) return checked;
        index = checked.index;
        break;
      }
    }
    if (index < 0) return fail('bad_line');
    const inclusion = inclusionProof(all, index);
    if (!inclusion.ok) return fail(inclusion.reason);
    const payProof = prove(advanced.tree, lines[i].paymentKey);
    if (!payProof.ok || !payProof.present) return fail('bad_epoch');
    const toProof = prove(advanced.tree, lines[i].payToKey);
    if (!toProof.ok || !toProof.present) return fail('bad_epoch');
    const idBytes = sealer.randomBytes(16);
    if (!(idBytes instanceof Uint8Array) || idBytes.length !== 16) return fail('bad_random');
    receipts.push({
      id: bytesToHex(idBytes),
      bookId: lines[i].bookId,
      epoch,
      index,
      line: bytesToHex(lines[i].line),
      proof: inclusion.proof,
      epochProof: epochProofHex,
      paymentProof: bytesToHex(payProof.proof),
      saltedBook: lines[i].saltedBook,
      slotKey: lines[i].slotKey,
      slotValue: lines[i].slotValue,
      slotProof: bytesToHex(toProof.proof),
      sealed: bytesToHex(sealed.sealed),
    });
  }
  const nonce = String(nonceNumber);
  const record = {
    epoch,
    hourStart: planned.hourStart,
    size: sized.size,
    root: rootHex,
    stateRoot,
    calldata: packed.calldata,
    domain: packed.domain,
    nonce,
    fees: sealer.fees,
    receipts,
    leaves: all,
    tree: advanced.tree,
    proof: proof.proof,
    chainId: sealer.chainId.toString(),
    contract: sealer.contract,
    checkpoint: String(sealer.signer.address || '').toLowerCase(),
  };
  record.fingerprint = fingerprintOf(record);
  return { ok: true, record };
}

function epochSlotKey(sealer) {
  const key = slotKey({ kind: KIND_EPOCH, chainId: sealer.chainId, id: new Uint8Array(0) });
  if (!key.ok) return null;
  return key.bytes;
}

function commitBeforeBroadcast(sealer, record) {
  const pub = publicRecord(record);
  if (typeof sealer.store.acceptEpoch === 'function') {
    const gate = sealer.store.acceptEpoch(pub);
    if (!gate.ok) return { ok: false, reason: gate.reason, broadcast: false };
  }
  const saved = saveCommit(sealer, record);
  if (!saved.ok) return saved;
  const stored = sealer.store.commitEpoch(pub);
  if (!stored.ok) {
    const named = stored.reason === 'epoch_house_conflict'
      || stored.reason === 'epoch_not_next'
      || stored.reason === 'store_conflict'
      ? stored.reason
      : 'store_not_committed';
    return { ok: false, reason: named, broadcast: false };
  }
  return { ok: true };
}

function publicRecord(record) {
  return {
    epoch: record.epoch,
    hourStart: record.hourStart,
    size: record.size,
    root: record.root,
    stateRoot: record.stateRoot,
    chainId: record.chainId,
    contract: record.contract,
    checkpoint: record.checkpoint,
    receipts: record.receipts,
  };
}

function summaryOf(record) {
  return {
    epoch: record.epoch,
    hourStart: record.hourStart,
    size: record.size,
    root: record.root,
    stateRoot: record.stateRoot,
    calldata: record.calldata,
    domain: record.domain,
    nonce: record.nonce,
    fees: record.fees,
    fingerprint: record.fingerprint,
    broadcast: false,
    receipts: record.receipts.map((item) => ({
      id: item.id,
      bookId: item.bookId,
      epoch: item.epoch,
      index: item.index,
      line: item.line,
      proof: item.proof,
      epochProof: item.epochProof,
      paymentProof: item.paymentProof,
      saltedBook: item.saltedBook,
      slotKey: item.slotKey,
      slotValue: item.slotValue,
      slotProof: item.slotProof,
      sealed: item.sealed,
    })),
    chainId: record.chainId,
    contract: record.contract,
    checkpoint: record.checkpoint,
  };
}

function saveCommit(sealer, record) {
  const nonceNext = addLogSize(sealer.state.nextNonce, 1);
  if (!nonceNext.ok) return nonceNext;
  const next = {
    ...sealer.state,
    anchorEpoch: record.epoch,
    lastHourStart: record.hourStart,
    logSize: record.size,
    logRoot: record.root,
    nextNonce: nonceNext.size,
    leaves: record.leaves,
    tree: record.tree,
    commits: sealer.state.commits.concat([summaryOf(record)]),
  };
  try {
    sealer.journal.write(next);
  } catch {
    return fail('commit_failed');
  }
  return { ok: true };
}

function anchorOf(sealer, record) {
  return {
    chainId: sealer.chainId,
    to: sealer.contract,
    nonce: record.nonce,
    epoch: record.epoch,
    hourStart: record.hourStart,
    size: record.size,
    root: record.root,
    stateRoot: record.stateRoot,
    calldata: record.calldata,
  };
}

async function broadcastRecord(sealer, record, send, signal) {
  const wireSend = async (wire) => {
    try {
      return await send(wire);
    } catch (err) {
      const kind = classifyAnchorSendError(err);
      if (kind === 'known') return `0x${bytesToHex(eip1559TxHash(wire))}`;
      const wrapped = new Error('broadcast_failed');
      wrapped.code = 'broadcast_failed';
      wrapped.kind = kind;
      wrapped.backoffMs = anchorBackoffMs(1);
      throw wrapped;
    }
  };
  try {
    const row = await broadcastAnchor({
      signer: sealer.signer,
      log: sealer.intentLog,
      anchor: anchorOf(sealer, record),
      fees: record.fees,
      send: wireSend,
      signal,
    });
    markBroadcast(sealer, record.nonce);
    return { ok: true, raw: row.raw, tx: row.tx, calldata: record.calldata, record: publicView(record) };
  } catch (err) {
    return {
      ok: false,
      reason: 'broadcast_failed',
      committed: true,
      kind: err.kind || classifyAnchorSendError(err),
      backoffMs: err.backoffMs || anchorBackoffMs(1),
    };
  }
}

function publicView(record) {
  return {
    epoch: record.epoch,
    hourStart: record.hourStart,
    size: record.size,
    root: record.root,
    stateRoot: record.stateRoot,
    calldata: record.calldata,
    nonce: record.nonce,
    leafCount: record.size,
  };
}

function markBroadcast(sealer, nonce) {
  const commits = sealer.state.commits.map((row) => (
    row.nonce === nonce ? { ...row, broadcast: true } : row
  ));
  const next = { ...sealer.state, commits };
  sealer.journal.write(next);
}

function normalizeFees(fees) {
  if (!fees) return null;
  try {
    const gasLimit = BigInt(fees.gasLimit);
    const maxFeePerGas = BigInt(fees.maxFeePerGas);
    const maxPriorityFeePerGas = BigInt(fees.maxPriorityFeePerGas);
    if (gasLimit <= 0n || maxFeePerGas <= 0n || maxPriorityFeePerGas < 0n) return null;
    if (maxPriorityFeePerGas > maxFeePerGas) return null;
    return {
      gasLimit: gasLimit.toString(),
      maxFeePerGas: maxFeePerGas.toString(),
      maxPriorityFeePerGas: maxPriorityFeePerGas.toString(),
    };
  } catch {
    return null;
  }
}

function addressOk(value) {
  return typeof value === 'string' && /^0x[0-9a-fA-F]{40}$/.test(value);
}

/**
 * @param {{ dir: string, store: object, signer: object, chainId: bigint | number, contract: string, clock?: () => number, randomBytes?: (n: number) => Uint8Array | null }} config
 */
export function openSealer(config) {
  if (!config || !config.store || !config.signer) {
    throw Object.assign(new Error('sealer config is incomplete'), { code: 'bad_sealer' });
  }
  if (!addressOk(config.contract)) {
    throw Object.assign(new Error('contract must be 20 bytes'), { code: 'bad_sealer' });
  }
  let chainId;
  try {
    chainId = BigInt(config.chainId);
  } catch {
    throw Object.assign(new Error('chain id is not an integer'), { code: 'bad_sealer' });
  }
  if (chainId < 0n || chainId > 0xffffffffffffffffn) {
    throw Object.assign(new Error('chain id does not fit'), { code: 'bad_sealer' });
  }
  if (config.clock != null && typeof config.clock !== 'function') {
    throw Object.assign(new Error('clock must return unix seconds'), { code: 'bad_sealer' });
  }
  const contract = config.contract.toLowerCase();
  const journal = openJournal(config.dir, { chainId, contract });
  const intentLog = openAnchorIntentLog(config.dir);
  return {
    dir: config.dir,
    store: config.store,
    signer: config.signer,
    chainId,
    contract,
    randomBytes: config.randomBytes || csprng,
    clock: config.clock || (() => Math.floor(Date.now() / 1000)),
    journal,
    intentLog,
    get state() {
      return journal.state;
    },
    fees: null,
  };
}

function mergeIntake(sealer, planned, explicit) {
  const counted = tierCount(planned.k);
  if (!counted.ok) return counted;
  const room = counted.count - explicit.length;
  const seen = new Set();
  for (let i = 0; i < explicit.length; i += 1) {
    const id = explicit[i].paymentId;
    if (id) seen.add(Buffer.from(id).toString('hex'));
  }
  if (room <= 0 || !sealer.store || typeof sealer.store.dir !== 'string') {
    return { ok: true, lines: explicit };
  }
  const pending = readPendingLines(sealer.store.dir, sealer.store.io);
  if (!pending.ok) return pending;
  const extra = [];
  for (let i = 0; i < pending.lines.length && extra.length < room; i += 1) {
    const item = pending.lines[i];
    const accepted = acceptCoreLine(item.line);
    if (!accepted.ok) return fail('intake_unreadable');
    const id = canonicalPaymentId(accepted.payment);
    if (!id.ok) return fail('intake_unreadable');
    if (seen.has(id.hex)) continue;
    seen.add(id.hex);
    extra.push({
      line: accepted.line,
      bookId: item.bookId,
      callerPk: null,
      payment: accepted.payment,
      paymentId: id.bytes,
      paymentRef: item.paymentRef,
    });
  }
  return { ok: true, lines: explicit.concat(extra) };
}

function rememberIntake(sealer, record, lines) {
  const pairs = [];
  for (let i = 0; i < lines.length; i += 1) {
    const row = lines[i];
    if (!row.paymentRef) continue;
    const hex = Buffer.from(row.line).toString('hex');
    const receipt = (record.receipts || []).find((item) => item.line === hex);
    if (!receipt) return fail('intake_unreadable');
    pairs.push({ paymentRef: row.paymentRef, receiptId: receipt.id, epoch: record.epoch });
  }
  if (pairs.length === 0) return { ok: true };
  return sealIntakeLines(sealer.store.dir, pairs, sealer.store.io);
}

/**
 * Close one finished hour, or a catch-up through the last complete hour.
 * The clock is sealer.clock(), in unix seconds. input.now is not read.
 * Commits before broadcast. Does not read input.epochSlot.
 * @param {object} sealer
 * @param {object} input
 */
export async function closeHour(sealer, input) {
  const body = input || {};
  sealer._input = body;
  const planned = planHours(sealer.state, readClock(sealer), body.hourStart);
  if (!planned.ok) return planned;
  const blocked = refuseRebuilt(sealer.state);
  if (blocked) return blocked;
  const fees = normalizeFees(body.fees);
  if (!fees) return fail('bad_fees');
  if (typeof body.send !== 'function') return fail('bad_broadcast');
  const accepted = acceptLines(body.lines);
  if (!accepted.ok) return accepted;
  const merged = mergeIntake(sealer, planned, accepted.lines);
  if (!merged.ok) return merged;
  const booked = bindBooks(sealer, merged.lines);
  if (!booked.ok) return booked;
  sealer.fees = fees;
  const built = buildEpoch(sealer, planned, merged.lines);
  if (!built.ok) return built;
  const record = built.record;
  const committed = commitBeforeBroadcast(sealer, record);
  if (!committed.ok) {
    return {
      ok: false,
      reason: committed.reason || 'store_not_committed',
      broadcast: false,
    };
  }
  if (!sealer.store.hasCommitted(record)) {
    return { ok: false, reason: 'store_not_committed', broadcast: false };
  }
  const sealed = rememberIntake(sealer, record, merged.lines);
  if (!sealed.ok) return { ok: false, reason: sealed.reason, broadcast: false, committed: true };
  return broadcastRecord(sealer, record, body.send, body.signal);
}

/**
 * Resend a committed epoch that never broadcast. Calldata is the committed
 * calldata. A different epoch is not built here.
 * @param {object} sealer
 * @param {{ send: Function }} input
 */
export async function recover(sealer, input) {
  if (!input || typeof input.send !== 'function') return fail('bad_broadcast');
  const pending = sealer.state.commits.filter((row) => row.broadcast === false);
  if (pending.length === 0) return fail('nothing_pending');
  const sent = [];
  for (let i = 0; i < pending.length; i += 1) {
    const record = pending[i];
    if (!sealer.store.hasCommitted(record)) {
      const stored = sealer.store.commitEpoch(publicRecord(record));
      if (stored.reason === 'store_conflict'
        || stored.reason === 'epoch_house_conflict'
        || stored.reason === 'epoch_not_next') {
        return { ok: false, reason: stored.reason, broadcast: false };
      }
      if (!stored.ok || !sealer.store.hasCommitted(record)) {
        return { ok: false, reason: 'store_not_committed', broadcast: false };
      }
    }
    const result = await broadcastRecord(sealer, record, input.send);
    sent.push(result);
    if (!result.ok) return { ok: false, reason: result.reason, committed: true, sent };
  }
  return { ok: true, sent };
}

/**
 * Fee bump at a used nonce. The calldata bytes are the committed ones.
 * @param {object} sealer
 * @param {{ nonce: string | number, send: Function }} input
 */
export async function feeBump(sealer, input) {
  if (!input || typeof input.send !== 'function') return fail('bad_broadcast');
  let key;
  try {
    key = BigInt(input.nonce).toString();
  } catch {
    return fail('nonce_unused');
  }
  const committed = sealer.state.commits.find((row) => row.nonce === key && row.broadcast === true);
  if (!committed) return fail('nonce_unused');
  const calldata = committed.calldata;
  let quote;
  try {
    const bumped = bumpFeeQuote(committed.fees, sealer.signer.feeCeiling);
    quote = {
      gasLimit: bumped.gasLimit.toString(),
      maxFeePerGas: bumped.maxFeePerGas.toString(),
      maxPriorityFeePerGas: bumped.maxPriorityFeePerGas.toString(),
    };
  } catch {
    return fail('fee_ceiling');
  }
  try {
    const row = await bumpAnchorFees({
      signer: sealer.signer,
      log: sealer.intentLog,
      nonce: key,
      fees: quote,
      send: async (wire) => {
        const decoded = eip1559Decode(wire);
        if (decoded.data !== calldata) {
          throw Object.assign(new Error('fee bump calldata mismatch'), { code: 'calldata_mismatch' });
        }
        return input.send(wire);
      },
    });
    const commits = sealer.state.commits.map((item) => (
      item.nonce === key ? { ...item, fees: quote } : item
    ));
    try {
      sealer.journal.write({ ...sealer.state, commits });
    } catch {
      // The bump was already broadcast with the committed calldata.
    }
    return { ok: true, raw: row.raw, calldata };
  } catch (err) {
    return {
      ok: false,
      reason: err.code || 'broadcast_failed',
      kind: classifyAnchorSendError(err),
    };
  }
}

function readClock(sealer) {
  if (!sealer || typeof sealer.clock !== 'function') return Number.NaN;
  try {
    return sealer.clock();
  } catch {
    return Number.NaN;
  }
}

export function pendingCommits(sealer) {
  return sealer.state.commits.filter((row) => row.broadcast === false).map((row) => ({
    epoch: row.epoch,
    hourStart: row.hourStart,
    size: row.size,
    root: row.root,
    stateRoot: row.stateRoot,
    calldata: row.calldata,
    nonce: row.nonce,
  }));
}

export { leafHash };
