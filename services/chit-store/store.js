/**
 * Book store for a sealed hour.
 *
 * A receipt is fetched by id, and only by the book's own caller.
 * Unknown id, another book's id, a bad credential, a missing proof,
 * and a caller-supplied payTo, wallet, or book lookup all return the
 * same body and status. Proofs are inside that receipt, and only after
 * a finalized Anchored event matches the committed epoch. The sealed
 * ciphertext stays in the store.
 */

import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { INTAKE_FILE, bookBoundLeaf, openIntake, readOwnedPending, sealIntakeLines } from './intake.js';

export const STORE_STATUS = 404;

export const STORE_BODY = Object.freeze({ error: 'not_found' });

function storeError() {
  return { ok: false, status: STORE_STATUS, body: STORE_BODY };
}

function sha256Text(text) {
  return createHash('sha256').update(String(text)).digest();
}

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
  return { v: 1, epochs: [], receipts: [] };
}

function loadState(io, file) {
  if (!io.existsSync(file)) return emptyState();
  const parsed = JSON.parse(io.readFileSync(file, 'utf8'));
  if (!parsed || parsed.v !== 1 || !Array.isArray(parsed.epochs) || !Array.isArray(parsed.receipts)) {
    return null;
  }
  return parsed;
}

/**
 * @param {string} dir
 * @param {{ books?: { id: string, token: string }[], io?: object }} [opts]
 */
export function openStore(dir, { books = [], io = fs } = {}) {
  const file = path.join(dir, 'store-state.json');
  const loaded = loadState(io, file);
  if (!loaded) {
    const err = new Error('store state is unreadable');
    err.code = 'store_unreadable';
    throw err;
  }
  const bookHashes = new Map();
  const bookRecords = new Map();
  const fileBooks = loaded.books && typeof loaded.books === 'object' && !Array.isArray(loaded.books) ? loaded.books : {};
  let freshSalt = false;
  for (const book of books) {
    if (!book || typeof book.id !== 'string' || typeof book.token !== 'string' || book.id.length === 0) {
      const err = new Error('book credential is incomplete');
      err.code = 'bad_book';
      throw err;
    }
    const pk = bytes32(book.bookPk);
    if (!pk) {
      const err = new Error('book credential is incomplete');
      err.code = 'bad_book';
      throw err;
    }
    const prior = fileBooks[book.id] && typeof fileBooks[book.id] === 'object' ? fileBooks[book.id] : {};
    const fromCaller = bytes32(book.bookSalt);
    const fromFile = bytes32(prior.bookSalt);
    const salt = fromCaller || fromFile || new Uint8Array(randomBytes(32));
    if (!fromCaller && !fromFile) freshSalt = true;
    bookHashes.set(book.id, sha256Text(book.token));
    // The token stays in memory for the process that opened the book.
    // persist writes the salt only.
    bookRecords.set(book.id, {
      bookPk: pk,
      bookSalt: salt,
      wallets: walletSet(book.wallets),
      token: book.token,
    });
  }
  const epochs = new Map();
  for (const row of loaded.epochs) epochs.set(String(row.epoch), row);
  const receipts = new Map();
  for (const row of loaded.receipts) receipts.set(row.id, row);
  const houseRetired = Array.isArray(loaded.houseRetired) ? loaded.houseRetired.slice() : [];
  const store = {
    dir,
    file,
    io,
    bookHashes,
    books: bookRecords,
    epochs,
    receipts,
    houseRetired,
    knowsBook(bookId) {
      return knowsBook(store, bookId);
    },
    acceptEpoch(record) {
      return acceptEpoch(store, record);
    },
    commitEpoch(record) {
      return commitEpoch(store, record);
    },
    hasCommitted(record) {
      return hasCommitted(store, record);
    },
    bookRecord(bookId) {
      const row = store.books.get(bookId);
      if (!row) return null;
      return { bookPk: row.bookPk, bookSalt: row.bookSalt, wallets: row.wallets };
    },
    bookToken(bookId) {
      const row = store.books.get(bookId);
      return row && typeof row.token === 'string' && row.token !== '' ? row.token : null;
    },
  };
  if (freshSalt) persist(store);
  // Commit already stored the leaf on the receipt. If the process died
  // before the intake seal, drop that leaf before the next closeHour.
  reconcileCommittedIntake(store);
  return store;
}

function persist(store) {
  const epochs = [];
  for (const row of store.epochs.values()) epochs.push(row);
  const receipts = [];
  for (const row of store.receipts.values()) receipts.push(row);
  const books = {};
  for (const [id, book] of store.books) books[id] = { bookSalt: Buffer.from(book.bookSalt).toString('hex') };
  const body = { v: 1, epochs, receipts, books };
  if (Array.isArray(store.houseRetired) && store.houseRetired.length > 0) body.houseRetired = store.houseRetired;
  const text = JSON.stringify(body);
  atomicWrite(store.io, store.dir, store.file, text);
}

function epochTuple(record) {
  return {
    epoch: record.epoch,
    hourStart: record.hourStart,
    size: record.size,
    root: record.root,
    stateRoot: record.stateRoot,
    chainId: record.chainId,
    contract: record.contract,
    checkpoint: record.checkpoint,
    released: false,
  };
}

function tuplesMatch(row, record) {
  return row.hourStart === record.hourStart
    && row.size === record.size
    && row.root === record.root
    && row.stateRoot === record.stateRoot
    && String(row.chainId) === String(record.chainId)
    && normAddr(row.contract) === normAddr(record.contract)
    && normAddr(row.checkpoint) === normAddr(record.checkpoint);
}

/**
 * Durably record an epoch the sealer already built. Ciphertext is kept
 * on the receipt row and is not part of the served object.
 * @param {object} store
 * @param {object} record
 */
function snapshot(store) {
  return {
    epochs: new Map(store.epochs),
    receipts: new Map(store.receipts),
  };
}

function restore(store, saved) {
  store.epochs = saved.epochs;
  store.receipts = saved.receipts;
}

function parseEpoch(value) {
  if (typeof value === 'number') {
    if (!Number.isSafeInteger(value) || value < 1) return null;
    return value;
  }
  if (typeof value === 'string' && /^[0-9]+$/.test(value)) {
    let big;
    try { big = BigInt(value); } catch { return null; }
    if (big < 1n || big > BigInt(Number.MAX_SAFE_INTEGER)) return null;
    return Number(big);
  }
  return null;
}

function houseSingleton(store, row) {
  const exact = [];
  for (const item of store.receipts.values()) {
    if (item && item.epoch != null && String(item.epoch) === String(row.epoch)) exact.push(item);
  }
  if (exact.length === 1) return exact[0];
  if (exact.length > 1) return null;
  const loose = [];
  for (const item of store.receipts.values()) {
    if (!item || item.epoch != null) continue;
    if (item.sealed != null || item.proof != null || item.index != null) continue;
    loose.push(item);
  }
  const open = [];
  for (const candidate of store.epochs.values()) {
    if (Number(candidate.size) !== 1024) continue;
    let exactCount = 0;
    for (const item of store.receipts.values()) {
      if (item && item.epoch != null && String(item.epoch) === String(candidate.epoch)) exactCount += 1;
    }
    if (exactCount === 0) open.push(candidate);
  }
  if (loose.length === 0 || loose.length !== open.length) return null;
  open.sort((a, b) => Number(a.epoch) - Number(b.epoch));
  loose.sort((a, b) => String(a.id).localeCompare(String(b.id)));
  const at = open.findIndex((candidate) => String(candidate.epoch) === String(row.epoch));
  if (at < 0) return null;
  return loose[at];
}

/**
 * A legacy house epoch: size 1024, one receipt, no sealer proof fields.
 * When the receipt still has its line, the root must be sha256 of that line.
 */
export function isHouseShapedEpoch(store, row) {
  if (!row || typeof row !== 'object') return false;
  if (Number(row.size) !== 1024) return false;
  const item = houseSingleton(store, row);
  if (!item) return false;
  if (item.sealed != null || item.proof != null || item.index != null) return false;
  if (typeof item.bookId !== 'string' || item.bookId.length === 0) return false;
  if (typeof item.id !== 'string' || item.id.length === 0) return false;
  if (item.line != null) {
    if (typeof item.line !== 'string' || !/^[0-9a-fA-F]{2048}$/.test(item.line)) return false;
    const root = createHash('sha256').update(Buffer.from(item.line, 'hex')).digest('hex');
    if (root !== String(row.root || '').toLowerCase()) return false;
  }
  return true;
}

function hasHouseEpoch(store) {
  for (const row of store.epochs.values()) {
    if (isHouseShapedEpoch(store, row)) return true;
  }
  return false;
}

function maxSealerEpoch(store) {
  let max = 0;
  for (const row of store.epochs.values()) {
    if (isHouseShapedEpoch(store, row)) continue;
    const n = parseEpoch(row.epoch);
    if (n != null && n > max) max = n;
  }
  return max;
}

function committedLineReceipt(store) {
  const sealerEpochs = new Set();
  for (const row of store.epochs.values()) {
    if (isHouseShapedEpoch(store, row)) continue;
    const n = parseEpoch(row.epoch);
    if (n != null) sealerEpochs.add(String(n));
  }
  const byLine = new Map();
  if (sealerEpochs.size === 0) return byLine;
  for (const item of store.receipts.values()) {
    if (!item || typeof item.line !== 'string' || typeof item.id !== 'string' || item.id === '') continue;
    if (!sealerEpochs.has(String(item.epoch))) continue;
    const hex = item.line.toLowerCase();
    if (!/^[0-9a-f]{2048}$/.test(hex)) continue;
    if (!byLine.has(hex)) byLine.set(hex, item);
  }
  return byLine;
}

/**
 * Startup recovery. A crash after commitEpoch and before the intake seal
 * leaves the committed line pending. Stamp it from the committed receipt
 * so the next closeHour cannot mint it again. A missing intake file is
 * left missing. House-shaped epochs are not sealer commits.
 */
function reconcileCommittedIntake(store) {
  const io = store.io;
  if (!io || typeof io.existsSync !== 'function') return;
  const file = path.join(store.dir, INTAKE_FILE);
  if (io.existsSync(file) !== true) return;
  const byLine = committedLineReceipt(store);
  if (byLine.size === 0) return;
  let intake;
  try {
    intake = openIntake(store.dir, { io });
  } catch {
    return;
  }
  const pairs = [];
  for (let i = 0; i < intake.leaves.length; i += 1) {
    const row = intake.leaves[i];
    if (!row || row.state !== 'pending_anchor' || row.receiptId != null) continue;
    if (typeof row.line !== 'string' || typeof row.paymentRef !== 'string') continue;
    const match = byLine.get(row.line.toLowerCase());
    if (!match) continue;
    const epoch = parseEpoch(match.epoch);
    if (epoch == null) continue;
    pairs.push({ paymentRef: row.paymentRef, receiptId: match.id, epoch });
  }
  if (pairs.length === 0) return;
  const sealed = sealIntakeLines(store.dir, pairs, io);
  if (!sealed || sealed.ok !== true) {
    const err = new Error('committed intake was not sealed');
    err.code = sealed && sealed.reason ? sealed.reason : 'intake_unreadable';
    throw err;
  }
}

/**
 * Sequential sealer epochs only. Empty store accepts 1.
 * The current max may be recommitted when the tuple matches.
 * Anything else is epoch_not_next. A legacy house row is epoch_house_conflict.
 */
export function acceptEpoch(store, record) {
  if (!store || !record || typeof record !== 'object' || Array.isArray(record)) {
    return { ok: false, reason: 'bad_epoch' };
  }
  if (record.epoch == null) return { ok: false, reason: 'bad_epoch' };
  const epoch = parseEpoch(record.epoch);
  if (epoch == null) return { ok: false, reason: 'bad_epoch' };
  if (hasHouseEpoch(store)) return { ok: false, reason: 'epoch_house_conflict' };
  const max = maxSealerEpoch(store);
  const existing = store.epochs.get(String(epoch));
  if (existing) {
    if (epoch === max && tuplesMatch(existing, record)) return { ok: true, mode: 'replay', epoch };
    if (!tuplesMatch(existing, record)) return { ok: false, reason: 'store_conflict' };
    return { ok: false, reason: 'epoch_not_next' };
  }
  if (epoch !== max + 1) return { ok: false, reason: 'epoch_not_next' };
  return { ok: true, mode: 'next', epoch };
}

export function commitEpoch(store, record) {
  const gate = acceptEpoch(store, record);
  if (!gate.ok) return gate;
  const key = String(gate.epoch);
  const existing = store.epochs.get(key);
  const saved = snapshot(store);
  try {
    if (!existing) store.epochs.set(key, epochTuple(record));
    const receipts = record.receipts || [];
    for (let i = 0; i < receipts.length; i += 1) {
      const item = receipts[i];
      if (!store.bookHashes.has(item.bookId)) {
        restore(store, saved);
        return { ok: false, reason: 'unknown_book' };
      }
      if (!store.receipts.has(item.id)) store.receipts.set(item.id, item);
    }
    persist(store);
    return { ok: true };
  } catch {
    restore(store, saved);
    return { ok: false, reason: 'store_not_committed' };
  }
}

/**
 * Move house-shaped epochs out of the sealer counter.
 * Bookable leaves (a line whose sha256 is the epoch root) go into the intake.
 * The rows are kept under houseRetired. They are not deleted.
 */
export function migrateHouseEpochs(store) {
  if (!store || !store.epochs || !store.receipts) return { ok: false, reason: 'bad_epoch' };
  const found = [];
  for (const row of store.epochs.values()) {
    if (isHouseShapedEpoch(store, row)) found.push(row);
  }
  if (found.length === 0) return { ok: true, migrated: 0, booked: 0 };
  let intake;
  try {
    intake = openIntake(store.dir, { io: store.io });
  } catch (err) {
    return { ok: false, reason: err?.code || 'intake_unreadable' };
  }
  const savedEpochs = new Map(store.epochs);
  const savedReceipts = new Map(store.receipts);
  const savedRetired = store.houseRetired;
  const undo = () => {
    store.epochs = savedEpochs;
    store.receipts = savedReceipts;
    store.houseRetired = savedRetired;
  };
  let booked = 0;
  const retired = [];
  for (let i = 0; i < found.length; i += 1) {
    const row = found[i];
    const item = houseSingleton(store, row);
    if (item && typeof item.line === 'string' && typeof item.paymentRef === 'string' && typeof item.tokenHash === 'string') {
      const result = bookBoundLeaf(intake, {
        paymentRef: item.paymentRef,
        line: item.line,
        bookId: item.bookId,
        tokenHash: item.tokenHash,
        hourStart: row.hourStart,
      });
      if (!result.ok) {
        undo();
        return { ok: false, reason: result.reason || 'intake_not_booked' };
      }
      if (result.replay !== true) booked += 1;
    }
    store.epochs.delete(String(row.epoch));
    if (item && store.receipts.has(item.id)) store.receipts.delete(item.id);
    retired.push({ epoch: row, receipt: item || null });
  }
  store.houseRetired = (savedRetired || []).concat(retired);
  try {
    persist(store);
  } catch {
    undo();
    return { ok: false, reason: 'store_not_committed' };
  }
  return { ok: true, migrated: found.length, booked };
}

export function hasCommitted(store, record) {
  const row = store.epochs.get(String(record.epoch));
  if (!row) return false;
  return tuplesMatch(row, record);
}

export function knowsBook(store, bookId) {
  return store.bookHashes.has(bookId);
}

function anchoredMatches(row, event) {
  if (!event || event.finalized !== true) return false;
  if (!sameU64(event.epoch, row.epoch)) return false;
  if (!sameU64(event.hourStart, row.hourStart)) return false;
  if (!sameU64(event.size, row.size)) return false;
  if (event.root !== row.root) return false;
  if (event.stateRoot !== row.stateRoot) return false;
  if (normAddr(event.contract) !== normAddr(row.contract)) return false;
  if (!sameU64(event.chainId, row.chainId)) return false;
  if (normAddr(event.from) !== normAddr(row.checkpoint)) return false;
  return true;
}

/**
 * Record a finalized Anchored observation. A mismatch does not release proofs.
 * @param {object} store
 * @param {object} event
 */
export function noteAnchored(store, event) {
  if (event && typeof event === 'object') {
    for (const field of ['epoch', 'hourStart', 'size', 'chainId']) {
      if (event[field] == null) continue;
      const parsed = normU64(event[field]);
      if (!parsed.ok && parsed.reason === 'uint64_above_cap') {
        return { ok: false, reason: 'uint64_above_cap', released: false };
      }
    }
  }
  const row = store.epochs.get(String(event?.epoch));
  if (!row || !anchoredMatches(row, event)) return { ok: true, released: false };
  if (row.released === true) return { ok: true, released: true };
  row.released = true;
  try {
    persist(store);
  } catch {
    row.released = false;
    return { ok: false, released: false };
  }
  return { ok: true, released: true };
}

function bookOk(store, bookId, token) {
  if (typeof bookId !== 'string' || typeof token !== 'string') return false;
  const expected = store.bookHashes.get(bookId);
  if (!expected) return false;
  const got = sha256Text(token);
  if (got.length !== expected.length) return false;
  return timingSafeEqual(got, expected);
}

function servedBody(receipt, epoch) {
  return {
    id: receipt.id,
    bookId: receipt.bookId,
    epoch: epoch.epoch,
    hourStart: epoch.hourStart,
    size: epoch.size,
    root: epoch.root,
    stateRoot: epoch.stateRoot,
    index: receipt.index,
    line: receipt.line,
    proof: receipt.proof,
    epochProof: receipt.epochProof,
    paymentProof: receipt.paymentProof,
    saltedBook: receipt.saltedBook,
    slotKey: receipt.slotKey,
    slotValue: receipt.slotValue,
    slotProof: receipt.slotProof,
  };
}

/**
 * Fetch one receipt by id for the caller's own book.
 * payTo, wallet, and bookId are not lookup keys. receiptId is.
 * @param {object} store
 * @param {{ receiptId?: string, bookId?: string, token?: string, payTo?: string, wallet?: string }} input
 */
export function fetchReceipt(store, input) {
  const callerBook = typeof input?.bookId === 'string' ? input.bookId : '';
  const token = typeof input?.token === 'string' ? input.token : '';
  const authed = bookOk(store, callerBook, token);
  // Lookup is by receipt id only. A caller-supplied payTo or wallet is not a key.
  const id = typeof input?.receiptId === 'string' ? input.receiptId : '';
  void input?.payTo;
  void input?.wallet;
  const receipt = id ? store.receipts.get(id) : undefined;
  const epoch = receipt ? store.epochs.get(String(receipt.epoch)) : undefined;
  const owns = authed && receipt && epoch && receipt.bookId === callerBook;
  const pending = owns && epoch.released === false
    ? { state: 'pending_anchor', epoch: epoch.epoch }
    : null;
  if (!owns || epoch.released !== true) {
    if (pending) return { ok: false, status: 202, body: pending };
    if (authed) {
      const held = intakeHold(store, id, callerBook, token);
      if (held) return held;
    }
    return storeError();
  }
  return { ok: true, status: 200, body: servedBody(receipt, epoch) };
}

function intakeHold(store, id, bookId, token) {
  const row = readOwnedPending(store.dir, id, { bookId, token }, store.io);
  if (!row || row.bookId !== bookId) return null;
  if (row.state === 'refund_owed') {
    return {
      ok: false,
      status: 409,
      body: { state: 'refund_owed', status: 'refund_owed', pending_id: row.pendingId },
    };
  }
  if (row.receiptId && row.epoch != null) {
    const receipt = store.receipts.get(row.receiptId);
    const epoch = store.epochs.get(String(row.epoch));
    if (receipt && epoch && epoch.released === true && receipt.bookId === bookId) {
      return { ok: true, status: 200, body: servedBody(receipt, epoch) };
    }
  }
  if (row.state === 'pending_anchor') {
    return { ok: false, status: 202, body: { state: 'pending_anchor', pending_id: row.pendingId } };
  }
  return null;
}

function bytes32(value) {
  if (value instanceof Uint8Array && value.length === 32) return new Uint8Array(value);
  if (typeof value === 'string' && /^(0x)?[0-9a-fA-F]{64}$/.test(value)) {
    return Uint8Array.from(Buffer.from(value.replace(/^0x/i, ''), 'hex'));
  }
  return null;
}

function normAddr(value) {
  if (typeof value !== 'string') return '';
  const hex = value.replace(/^0x/i, '').toLowerCase();
  if (!/^[0-9a-f]{40}$/.test(hex)) return '';
  return `0x${hex}`;
}

function walletSet(list) {
  const out = new Set();
  if (!Array.isArray(list)) return out;
  for (let i = 0; i < list.length; i += 1) {
    const addr = normAddr(typeof list[i] === 'string' ? list[i] : '');
    if (addr) out.add(addr);
  }
  return out;
}

function normU64(value) {
  if (typeof value === 'number') {
    if (Number.isSafeInteger(value) && value >= 0) return { ok: true, n: value };
    if (Number.isFinite(value) && value > Number.MAX_SAFE_INTEGER) return { ok: false, reason: 'uint64_above_cap' };
    return { ok: false, reason: 'bad_uint64' };
  }
  if (typeof value === 'bigint') {
    if (value < 0n || value > BigInt(Number.MAX_SAFE_INTEGER)) return { ok: false, reason: 'uint64_above_cap' };
    return { ok: true, n: Number(value) };
  }
  if (typeof value === 'string' && /^[0-9]+$/.test(value)) {
    let big;
    try { big = BigInt(value); } catch { return { ok: false, reason: 'bad_uint64' }; }
    if (big < 0n || big > BigInt(Number.MAX_SAFE_INTEGER)) return { ok: false, reason: 'uint64_above_cap' };
    return { ok: true, n: Number(big) };
  }
  return { ok: false, reason: 'bad_uint64' };
}

function sameU64(left, right) {
  const a = normU64(left);
  const b = normU64(right);
  return a.ok && b.ok && a.n === b.n;
}

export function sealedHeld(store, receiptId) {
  const row = store.receipts.get(receiptId);
  return row ? row.sealed : null;
}
