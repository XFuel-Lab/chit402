/**
 * Durable pending-hour intake.
 *
 * One leaf per payment ref. The write is temp + fsync + rename, the same
 * bar as the sealer journal and the store. The owner is bound after the
 * payment verifies. A different caller with the public id gets nothing.
 * closeHour is the only reader that turns a booked leaf into an epoch.
 */

import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
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

function readIntakeText(io, file) {
  const flags = fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW | fs.constants.O_NONBLOCK | (fs.constants.O_CLOEXEC || 0);
  if (typeof io.openSync !== 'function' || typeof io.fstatSync !== 'function' || typeof io.closeSync !== 'function') {
    return io.readFileSync(file, 'utf8');
  }
  const fd = io.openSync(file, flags);
  try {
    const st = io.fstatSync(fd);
    if (!st || typeof st.isFile !== 'function' || st.isFile() !== true) {
      const err = new Error('intake is not a regular file');
      err.code = 'ENOTREG';
      throw err;
    }
    return io.readFileSync(fd, 'utf8');
  } finally {
    io.closeSync(fd);
  }
}

function loadState(io, file) {
  if (!io.existsSync(file)) return emptyState();
  let parsed;
  try {
    parsed = JSON.parse(readIntakeText(io, file));
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
  const row = {
    paymentRef: input.paymentRef,
    pendingId: /^[0-9a-f]{32}$/.test(String(input.pendingId || ''))
      ? input.pendingId
      : randomBytes(16).toString('hex'),
    bookId: input.bookId,
    tokenHash: input.tokenHash,
    line: lineHex,
    hourStart,
    state: 'pending_anchor',
    finality: input.finality === 'final' ? 'final' : 'pending',
    receiptId: null,
    epoch: null,
  };
  if (typeof input.paymentHash === 'string' && /^[0-9a-f]{64}$/.test(input.paymentHash)) {
    row.paymentHash = input.paymentHash;
  }
  if (typeof input.txHash === 'string' && input.txHash) row.txHash = input.txHash;
  if (typeof input.rebookedFrom === 'string' && /^[0-9a-f]{64}$/.test(input.rebookedFrom)) {
    row.rebooked_from = input.rebookedFrom;
  }
  return row;
}

/** Missing finality is pending and is re-checked at seal. */
export function rowFinality(row) {
  if (row && row.finality === 'final') return 'final';
  return 'pending';
}

let houseDir = '';

export function setHouseIntakeDir(dir) {
  houseDir = typeof dir === 'string' ? dir : '';
}

export function houseIntakeDir() {
  return houseDir;
}

/**
 * Book one leaf. The same payment ref returns the same row.
 * A second line for that ref is refused. The owner is the first caller.
 * @param {object} intake
 * @param {object} input
 */
export function bookLeaf(intake, input) {
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
    if (existing.line !== lineHex) {
      if (existing.state === 'reorged' && existing.receiptId == null && typeof input.rebookedFrom === 'string') {
        const oldSha = createHash('sha256').update(Buffer.from(existing.line, 'hex')).digest('hex');
        if (input.rebookedFrom !== oldSha) return { ok: false, reason: 'intake_conflict' };
        existing.line = lineHex;
        existing.state = 'pending_anchor';
        existing.finality = 'pending';
        existing.rebooked_from = input.rebookedFrom;
        existing.receiptId = null;
        existing.epoch = null;
        if (Number.isSafeInteger(input.hourStart)) existing.hourStart = input.hourStart;
        if (typeof input.txHash === 'string' && input.txHash) existing.txHash = input.txHash;
        try {
          persist(intake);
        } catch (err) {
          const wrapped = new Error('intake not booked');
          wrapped.code = 'intake_not_booked';
          wrapped.cause = err;
          throw wrapped;
        }
        return { ok: true, replay: false, rebooked: true, row: existing };
      }
      return { ok: false, reason: 'intake_conflict' };
    }
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
    pendingId: randomBytes(16).toString('hex'),
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

export function readIntakeLeaves(dir, io = fs) {
  if (typeof dir !== 'string' || dir === '') return { ok: true, leaves: [] };
  let intake;
  try {
    intake = openIntake(dir, { io });
  } catch (err) {
    return { ok: false, reason: err?.code || 'intake_unreadable' };
  }
  return { ok: true, leaves: intake.leaves };
}

export function updateLeaf(dir, paymentRef, mutate, io = fs) {
  let intake;
  try {
    intake = openIntake(dir, { io });
  } catch (err) {
    return { ok: false, reason: err?.code || 'intake_unreadable' };
  }
  const row = findRef(intake, paymentRef);
  if (!row) return { ok: false, reason: 'intake_unreadable' };
  mutate(row);
  try {
    persist(intake);
  } catch (err) {
    return { ok: false, reason: err?.code || 'intake_not_booked' };
  }
  return { ok: true, row };
}

export function findLeafByPendingId(dir, pendingId, io = fs) {
  if (typeof pendingId !== 'string' || !PENDING_ID.test(pendingId)) return null;
  let intake;
  try {
    intake = openIntake(dir, { io });
  } catch {
    return null;
  }
  for (let i = 0; i < intake.leaves.length; i += 1) {
    if (intake.leaves[i].pendingId === pendingId) return intake.leaves[i];
  }
  return null;
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
    const line = {
      line: Uint8Array.from(Buffer.from(row.line, 'hex')),
      bookId: row.bookId,
      paymentRef: row.paymentRef,
    };
    if (row.finality === 'final' || row.finality === 'pending') line.finality = row.finality;
    if (Number.isSafeInteger(row.hourStart) && row.hourStart >= 0) line.hourStart = row.hourStart;
    lines.push(line);
  }
  return { ok: true, lines };
}

/**
 * The sealer included these leaves. They are not booked again.
 */
export function sealIntakeLines(dir, pairs, io = fs) {
  if (!Array.isArray(pairs) || pairs.length === 0) return { ok: true, sealed: 0 };
  let intake;
  try {
    intake = openIntake(dir, { io });
  } catch (err) {
    return { ok: false, reason: err?.code || 'intake_unreadable' };
  }
  let sealed = 0;
  for (let i = 0; i < pairs.length; i += 1) {
    const pair = pairs[i];
    const row = findRef(intake, pair.paymentRef);
    if (!row || row.state !== 'pending_anchor') continue;
    if (row.receiptId != null && row.receiptId !== pair.receiptId) {
      return { ok: false, reason: 'intake_conflict' };
    }
    row.receiptId = pair.receiptId;
    row.epoch = pair.epoch;
    sealed += 1;
  }
  if (sealed === 0) return { ok: true, sealed: 0 };
  try {
    persist(intake);
  } catch {
    return { ok: false, reason: 'intake_not_booked' };
  }
  return { ok: true, sealed };
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
