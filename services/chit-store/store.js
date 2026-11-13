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

import { createHash, timingSafeEqual } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

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
  const fd = io.openSync(tmp, 'w', 0o600);
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
  for (const book of books) {
    if (!book || typeof book.id !== 'string' || typeof book.token !== 'string' || book.id.length === 0) {
      const err = new Error('book credential is incomplete');
      err.code = 'bad_book';
      throw err;
    }
    bookHashes.set(book.id, sha256Text(book.token));
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
  };
  return store;
}

function persist(store) {
  const epochs = [];
  for (const row of store.epochs.values()) epochs.push(row);
  const receipts = [];
  for (const row of store.receipts.values()) receipts.push(row);
  const text = JSON.stringify({ v: 1, epochs, receipts });
  atomicWrite(store.io, store.dir, store.file, text);
}

function epochTuple(record) {
  return {
    epoch: record.epoch,
    hourStart: record.hourStart,
    size: record.size,
    root: record.root,
    stateRoot: record.stateRoot,
    released: false,
  };
}

function tuplesMatch(row, record) {
  return row.hourStart === record.hourStart
    && row.size === record.size
    && row.root === record.root
    && row.stateRoot === record.stateRoot;
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
  if (String(event.epoch) !== String(row.epoch)) return false;
  if (event.hourStart !== row.hourStart) return false;
  if (event.size !== row.size) return false;
  if (event.root !== row.root) return false;
  if (event.stateRoot !== row.stateRoot) return false;
  return true;
}

/**
 * Record a finalized Anchored observation. A mismatch does not release proofs.
 * @param {object} store
 * @param {object} event
 */
export function noteAnchored(store, event) {
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
  if (!owns || epoch.released !== true) return storeError();
  return { ok: true, status: 200, body: servedBody(receipt, epoch) };
}

export function sealedHeld(store, receiptId) {
  const row = store.receipts.get(receiptId);
  return row ? row.sealed : null;
}
