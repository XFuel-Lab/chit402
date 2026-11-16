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

export const STORE_STATUS = 404;

export const STORE_BODY = Object.freeze({ error: 'not_found' });

let pendingBody = null;

function storeError() {
  if (pendingBody) {
    const body = pendingBody;
    pendingBody = null;
    return { ok: false, status: 202, body };
  }
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
    const salt = bytes32(book.bookSalt) || bytes32(prior.bookSalt) || new Uint8Array(randomBytes(32));
    bookHashes.set(book.id, sha256Text(book.token));
    bookRecords.set(book.id, { bookPk: pk, bookSalt: salt, wallets: walletSet(book.wallets) });
  }
  const epochs = new Map();
  for (const row of loaded.epochs) epochs.set(String(row.epoch), row);
  const receipts = new Map();
  for (const row of loaded.receipts) receipts.set(row.id, row);
  const store = {
    dir,
    file,
    io,
    bookHashes,
    books: bookRecords,
    epochs,
    receipts,
    knowsBook(bookId) {
      return knowsBook(store, bookId);
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
  };
  return store;
}

function persist(store) {
  const epochs = [];
  for (const row of store.epochs.values()) epochs.push(row);
  const receipts = [];
  for (const row of store.receipts.values()) receipts.push(row);
  const books = {};
  for (const [id, book] of store.books) books[id] = { bookSalt: Buffer.from(book.bookSalt).toString('hex') };
  const text = JSON.stringify({ v: 1, epochs, receipts, books });
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

export function commitEpoch(store, record) {
  const key = String(record.epoch);
  const existing = store.epochs.get(key);
  if (existing && !tuplesMatch(existing, record)) return { ok: false, reason: 'store_conflict' };
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
  pendingBody = owns && epoch.released === false
    ? { state: 'pending_anchor', epoch: epoch.epoch }
    : null;
  if (!owns || epoch.released !== true) return storeError();
  pendingBody = null;
  return { ok: true, status: 200, body: servedBody(receipt, epoch) };
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
