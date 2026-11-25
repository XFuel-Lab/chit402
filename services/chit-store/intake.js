/**
 * Durable pending-hour intake.
 *
 * One leaf per payment ref. The write is temp + fsync + rename, the same
 * bar as the sealer journal and the store. The owner is bound after the
 * payment verifies. A different caller with the public id gets nothing.
 * closeHour is the only reader that turns a booked leaf into an epoch.
 */

import { createHash, timingSafeEqual } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

export const INTAKE_FILE = 'pending-intake.json';

const PAYMENT_REF = /^[0-9a-f]{160}$/;
const LINE_HEX = /^[0-9a-f]{2048}$/;
const PENDING_ID = /^[0-9a-f]{32}$/;

function atomicWrite(io, dir, file, text) {
  io.mkdirSync(dir, { recursive: true });
  const tmp = `${file}.tmp`;
  if (typeof io.existsSync === 'function' && io.existsSync(tmp) && typeof io.chmodSync === 'function') {
    io.chmodSync(tmp, 0o600);
  }
  const fd = io.openSync(tmp, 'w', 0o600);
  if (typeof io.fchmodSync === 'function') io.fchmodSync(fd, 0o600);
  try {
    const buf = Buffer.from(text);
    let offset = 0;
    while (offset < buf.length) {
      const n = io.writeSync(fd, buf, offset, buf.length - offset);
      if (!Number.isInteger(n) || n <= 0) throw new Error('short write');
      offset += n;
    }
    io.fsyncSync(fd);
  } finally {
    io.closeSync(fd);
  }
  io.renameSync(tmp, file);
  const dfd = io.openSync(dir, 'r');
  try {
    io.fsyncSync(dfd);
  } finally {
    io.closeSync(dfd);
  }
}

function emptyState() {
  return { v: 1, leaves: [] };
}

function loadState(io, file) {
  if (!io.existsSync(file)) return emptyState();
  let parsed;
  try {
    parsed = JSON.parse(io.readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
  if (!parsed || parsed.v !== 1 || !Array.isArray(parsed.leaves)) return null;
  return parsed;
}

/**
 * @param {string} dir
 * @param {{ io?: object }} [opts]
 */
export function openIntake(dir, { io = fs } = {}) {
  if (typeof dir !== 'string' || dir === '') {
    const err = new Error('intake dir is missing');
    err.code = 'intake_unreadable';
    throw err;
  }
  const file = path.join(dir, INTAKE_FILE);
  const loaded = loadState(io, file);
  if (!loaded) {
    const err = new Error('intake is unreadable');
    err.code = 'intake_unreadable';
    throw err;
  }
  return {
    dir,
    file,
    io,
    leaves: loaded.leaves,
  };
}

function persist(intake) {
  const text = JSON.stringify({ v: 1, leaves: intake.leaves });
  atomicWrite(intake.io, intake.dir, intake.file, text);
}

const LOCK_WAIT_MS = 5000;
const LOCK_STALE_MS = 10000;
const pauseBuf = new Int32Array(new SharedArrayBuffer(4));

function pauseMs(ms) {
  Atomics.wait(pauseBuf, 0, 0, ms);
}

/**
 * One writer at a time. The lock covers reload, mutate, and replace so a
 * house book and a sealer stamp cannot drop each other's row.
 */
function withIntakeLock(dir, io, fn) {
  const lock = path.join(dir, `${INTAKE_FILE}.lock`);
  io.mkdirSync(dir, { recursive: true });
  const started = Date.now();
  let fd = null;
  for (;;) {
    try {
      fd = io.openSync(lock, 'wx', 0o600);
      break;
    } catch (err) {
      if (!err || err.code !== 'EEXIST') throw err;
      let stale = false;
      try {
        const st = io.statSync(lock);
        stale = Date.now() - st.mtimeMs > LOCK_STALE_MS;
      } catch {
        stale = false;
      }
      if (stale) {
        try { io.unlinkSync(lock); } catch { /* the other writer took it */ }
        continue;
      }
      if (Date.now() - started > LOCK_WAIT_MS) {
        const busy = new Error('intake is locked');
        busy.code = 'intake_unreadable';
        throw busy;
      }
      pauseMs(5);
    }
  }
  try {
    return fn();
  } finally {
    try { io.closeSync(fd); } catch { /* the lock file is removed next */ }
    try { io.unlinkSync(lock); } catch { /* a stale takeover may already have removed it */ }
  }
}

function reloadLocked(dir, io, fn) {
  return withIntakeLock(dir, io, () => {
    const fresh = openIntake(dir, { io });
    return fn(fresh);
  });
}

export function tokenHashHex(token) {
  return createHash('sha256').update(String(token)).digest('hex');
}

export function pendingIdFor(paymentRef) {
  return createHash('sha256').update(String(paymentRef)).digest('hex').slice(0, 32);
}

function sameOwner(row, caller) {
  if (!row || !caller || typeof caller.bookId !== 'string' || typeof caller.token !== 'string') return false;
  if (row.bookId !== caller.bookId) return false;
  if (typeof row.tokenHash !== 'string' || !/^[0-9a-f]{64}$/.test(row.tokenHash)) return false;
  const got = Buffer.from(tokenHashHex(caller.token), 'hex');
  const want = Buffer.from(row.tokenHash, 'hex');
  if (got.length !== want.length) return false;
  return timingSafeEqual(got, want);
}

function hashBound(row, bookId, tokenHash) {
  if (!row || typeof bookId !== 'string' || bookId === '') return false;
  if (typeof tokenHash !== 'string' || !/^[0-9a-f]{64}$/.test(tokenHash)) return false;
  if (row.bookId !== bookId) return false;
  if (typeof row.tokenHash !== 'string' || row.tokenHash.length !== tokenHash.length) return false;
  return timingSafeEqual(Buffer.from(row.tokenHash, 'hex'), Buffer.from(tokenHash, 'hex'));
}

function lineHexOf(line) {
  if (line instanceof Uint8Array) return Buffer.from(line).toString('hex');
  if (typeof line === 'string') return line.toLowerCase();
  return '';
}

function findRef(intake, paymentRef) {
  for (let i = 0; i < intake.leaves.length; i += 1) {
    if (intake.leaves[i].paymentRef === paymentRef) return intake.leaves[i];
  }
  return null;
}

function leafRow(input, lineHex) {
  const hourStart = Number.isSafeInteger(input.hourStart) ? input.hourStart : null;
  return {
    paymentRef: input.paymentRef,
    pendingId: pendingIdFor(input.paymentRef),
    bookId: input.bookId,
    tokenHash: input.tokenHash,
    line: lineHex,
    hourStart,
    state: 'pending_anchor',
    receiptId: null,
    epoch: null,
  };
}

/**
 * Book one leaf. The same payment ref returns the same row.
 * A second line for that ref is refused. The owner is the first caller.
 * @param {object} intake
 * @param {object} input
 */
export function bookLeaf(intake, input) {
  if (!intake || typeof intake.dir !== 'string' || intake.dir === '') {
    return bookLeafBody(intake, input);
  }
  try {
    return reloadLocked(intake.dir, intake.io || fs, (fresh) => bookLeafBody(fresh, input));
  } catch (err) {
    if (err && err.code === 'intake_not_booked') throw err;
    const wrapped = new Error('intake not booked');
    wrapped.code = 'intake_not_booked';
    wrapped.cause = err;
    throw wrapped;
  }
}

function bookLeafBody(intake, input) {
  if (!intake || !Array.isArray(intake.leaves)) return { ok: false, reason: 'intake_unreadable' };
  const paymentRef = typeof input?.paymentRef === 'string' ? input.paymentRef : '';
  if (!PAYMENT_REF.test(paymentRef)) return { ok: false, reason: 'bad_payment_ref' };
  const lineHex = lineHexOf(input?.line);
  if (!LINE_HEX.test(lineHex)) return { ok: false, reason: 'bad_line' };
  const bookId = input?.caller?.bookId;
  const token = input?.caller?.token;
  if (typeof bookId !== 'string' || bookId === '' || typeof token !== 'string' || token === '') {
    return { ok: false, reason: 'bad_owner' };
  }
  const tokenHash = tokenHashHex(token);
  const existing = findRef(intake, paymentRef);
  if (existing) {
    if (!sameOwner(existing, input.caller)) return { ok: false, reason: 'not_owner' };
    if (existing.state === 'refund_owed') return { ok: true, replay: true, row: existing };
    if (existing.line !== lineHex) return { ok: false, reason: 'intake_conflict' };
    return { ok: true, replay: true, row: existing };
  }
  const row = leafRow({
    paymentRef,
    bookId,
    tokenHash,
    hourStart: input.hourStart,
  }, lineHex);
  intake.leaves.push(row);
  try {
    persist(intake);
  } catch (err) {
    intake.leaves.pop();
    const wrapped = new Error('intake not booked');
    wrapped.code = 'intake_not_booked';
    wrapped.cause = err;
    throw wrapped;
  }
  return { ok: true, replay: false, row };
}

/**
 * Rebook a leaf that is already owner-bound (the migrate path).
 * The raw token is not required. A live pending row is left as it is.
 */
export function bookBoundLeaf(intake, input) {
  if (!intake || typeof intake.dir !== 'string' || intake.dir === '') {
    return bookBoundBody(intake, input);
  }
  try {
    return reloadLocked(intake.dir, intake.io || fs, (fresh) => bookBoundBody(fresh, input));
  } catch (err) {
    if (err && err.code === 'intake_not_booked') throw err;
    const wrapped = new Error('intake not booked');
    wrapped.code = 'intake_not_booked';
    wrapped.cause = err;
    throw wrapped;
  }
}

function bookBoundBody(intake, input) {
  if (!intake || !Array.isArray(intake.leaves)) return { ok: false, reason: 'intake_unreadable' };
  const paymentRef = typeof input?.paymentRef === 'string' ? input.paymentRef : '';
  if (!PAYMENT_REF.test(paymentRef)) return { ok: false, reason: 'bad_payment_ref' };
  const lineHex = lineHexOf(input?.line);
  if (!LINE_HEX.test(lineHex)) return { ok: false, reason: 'bad_line' };
  const bookId = input?.bookId;
  const tokenHash = typeof input?.tokenHash === 'string' ? input.tokenHash.toLowerCase() : '';
  if (typeof bookId !== 'string' || bookId === '' || !/^[0-9a-f]{64}$/.test(tokenHash)) {
    return { ok: false, reason: 'bad_owner' };
  }
  const existing = findRef(intake, paymentRef);
  if (existing) {
    if (!hashBound(existing, bookId, tokenHash)) return { ok: false, reason: 'not_owner' };
    if (existing.line !== lineHex) return { ok: false, reason: 'intake_conflict' };
    return { ok: true, replay: true, row: existing };
  }
  const row = leafRow({
    paymentRef,
    bookId,
    tokenHash,
    hourStart: input.hourStart,
  }, lineHex);
  intake.leaves.push(row);
  try {
    persist(intake);
  } catch (err) {
    intake.leaves.pop();
    const wrapped = new Error('intake not booked');
    wrapped.code = 'intake_not_booked';
    wrapped.cause = err;
    throw wrapped;
  }
  return { ok: true, replay: false, row };
}

/**
 * Terminal hold after a paid book failed. Does not replace a booked leaf.
 */
export function writeRefund(intake, input) {
  if (!intake || typeof intake.dir !== 'string' || intake.dir === '') {
    return writeRefundBody(intake, input);
  }
  try {
    return reloadLocked(intake.dir, intake.io || fs, (fresh) => writeRefundBody(fresh, input));
  } catch (err) {
    if (err && err.code === 'intake_not_booked') throw err;
    const wrapped = new Error('intake not booked');
    wrapped.code = 'intake_not_booked';
    wrapped.cause = err;
    throw wrapped;
  }
}

function writeRefundBody(intake, input) {
  if (!intake || !Array.isArray(intake.leaves)) return { ok: false, reason: 'intake_unreadable' };
  const paymentRef = typeof input?.paymentRef === 'string' ? input.paymentRef : '';
  if (!PAYMENT_REF.test(paymentRef)) return { ok: false, reason: 'bad_payment_ref' };
  const bookId = input?.caller?.bookId;
  const token = input?.caller?.token;
  if (typeof bookId !== 'string' || bookId === '' || typeof token !== 'string' || token === '') {
    return { ok: false, reason: 'bad_owner' };
  }
  const existing = findRef(intake, paymentRef);
  if (existing) {
    if (!sameOwner(existing, input.caller)) return { ok: false, reason: 'not_owner' };
    return { ok: true, replay: true, row: existing };
  }
  const row = {
    paymentRef,
    pendingId: pendingIdFor(paymentRef),
    bookId,
    tokenHash: tokenHashHex(token),
    line: null,
    hourStart: Number.isSafeInteger(input.hourStart) ? input.hourStart : null,
    state: 'refund_owed',
    receiptId: null,
    epoch: null,
  };
  intake.leaves.push(row);
  try {
    persist(intake);
  } catch (err) {
    intake.leaves.pop();
    const wrapped = new Error('intake not booked');
    wrapped.code = 'intake_not_booked';
    wrapped.cause = err;
    throw wrapped;
  }
  return { ok: true, replay: false, row };
}

export function findByPaymentRef(intake, paymentRef) {
  if (!intake || !Array.isArray(intake.leaves)) return null;
  return findRef(intake, paymentRef);
}

/**
 * Leaves still waiting for a sealer epoch. A missing file is empty.
 * A corrupt file is refused.
 */
export function readPendingLines(dir, io = fs) {
  if (typeof dir !== 'string' || dir === '') return { ok: true, lines: [] };
  let intake;
  try {
    intake = openIntake(dir, { io });
  } catch (err) {
    return { ok: false, reason: err?.code || 'intake_unreadable' };
  }
  const lines = [];
  for (let i = 0; i < intake.leaves.length; i += 1) {
    const row = intake.leaves[i];
    if (!row || row.state !== 'pending_anchor' || row.receiptId != null) continue;
    if (typeof row.line !== 'string' || !LINE_HEX.test(row.line)) {
      return { ok: false, reason: 'intake_unreadable' };
    }
    if (typeof row.bookId !== 'string' || row.bookId === '') return { ok: false, reason: 'intake_unreadable' };
    if (!PAYMENT_REF.test(row.paymentRef || '')) return { ok: false, reason: 'intake_unreadable' };
    lines.push({
      line: Uint8Array.from(Buffer.from(row.line, 'hex')),
      bookId: row.bookId,
      paymentRef: row.paymentRef,
    });
  }
  return { ok: true, lines };
}

/**
 * The sealer included these leaves. They are not booked again.
 */
function stampPairs(intake, pairs) {
  let sealed = 0;
  for (let i = 0; i < pairs.length; i += 1) {
    const pair = pairs[i];
    const row = findRef(intake, pair.paymentRef);
    if (!row || row.state !== 'pending_anchor') continue;
    if (row.receiptId != null && row.receiptId !== pair.receiptId) {
      return { ok: false, reason: 'intake_conflict' };
    }
    if (row.receiptId === pair.receiptId) continue;
    row.receiptId = pair.receiptId;
    row.epoch = pair.epoch;
    sealed += 1;
  }
  return { ok: true, sealed };
}

export function sealIntakeLines(dir, pairs, io = fs) {
  if (!Array.isArray(pairs) || pairs.length === 0) return { ok: true, sealed: 0 };
  if (typeof dir !== 'string' || dir === '') return { ok: false, reason: 'intake_unreadable' };
  try {
    return reloadLocked(dir, io, (intake) => {
      const stamped = stampPairs(intake, pairs);
      if (!stamped.ok) return stamped;
      if (stamped.sealed > 0) persist(intake);
      return stamped;
    });
  } catch (err) {
    return { ok: false, reason: err?.code || 'intake_unreadable' };
  }
}

/**
 * Stamp every pending leaf whose line is already in a committed epoch.
 * recover calls this when the stamp after commit did not land.
 */
export function sealCommittedIntake(dir, record, io = fs) {
  const receipts = Array.isArray(record?.receipts) ? record.receipts : [];
  if (typeof dir !== 'string' || dir === '' || receipts.length === 0) return { ok: true, sealed: 0 };
  try {
    return reloadLocked(dir, io, (intake) => {
      let sealed = 0;
      for (let i = 0; i < receipts.length; i += 1) {
        const receipt = receipts[i];
        if (!receipt || typeof receipt.line !== 'string' || typeof receipt.id !== 'string') continue;
        for (let j = 0; j < intake.leaves.length; j += 1) {
          const row = intake.leaves[j];
          if (!row || row.state !== 'pending_anchor' || row.line !== receipt.line) continue;
          if (row.receiptId != null && row.receiptId !== receipt.id) {
            return { ok: false, reason: 'intake_conflict' };
          }
          if (row.receiptId === receipt.id) continue;
          row.receiptId = receipt.id;
          row.epoch = record.epoch;
          sealed += 1;
        }
      }
      if (sealed > 0) persist(intake);
      return { ok: true, sealed };
    });
  } catch (err) {
    return { ok: false, reason: err?.code || 'intake_unreadable' };
  }
}

/**
 * Owner read by public id. A different caller gets null, the same as a miss.
 */
export function readOwnedPending(dir, pendingId, caller, io = fs) {
  if (typeof dir !== 'string' || dir === '') return null;
  if (typeof pendingId !== 'string' || !PENDING_ID.test(pendingId)) return null;
  let intake;
  try {
    intake = openIntake(dir, { io });
  } catch {
    return null;
  }
  for (let i = 0; i < intake.leaves.length; i += 1) {
    const row = intake.leaves[i];
    if (row.pendingId !== pendingId) continue;
    if (!sameOwner(row, caller)) return null;
    return row;
  }
  return null;
}
