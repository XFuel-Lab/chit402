/**
 * Exact bytes of a signed public record, keyed by receipt id.
 * Bytes live on disk. The first successful create wins, including across
 * a process restart, so a later pass cannot re-sign different bytes.
 * A read never inserts.
 *
 * PUBLIC_RECORD_SERVE is not enough to serve. ROTATION_TRUST_SHIPPED stays
 * false until that verifier is what operators run.
 */
import {
  closeSync,
  fsyncSync,
  mkdirSync,
  openSync,
  readFileSync,
  readdirSync,
  unlinkSync,
  writeSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/** Hard gate. The env flag cannot open serving while this is false. */
export const ROTATION_TRUST_SHIPPED = false;

const ID_FILE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,200}$/;

const records = new Map();
let directory = null;
let loaded = false;

function resolveDir() {
  const fromEnv = String(process.env.PUBLIC_RECORD_DIR || '').trim();
  if (fromEnv) return fromEnv;
  if (process.env.NODE_ENV === 'test') return join(tmpdir(), `chit402-public-records-${process.pid}`);
  return join(process.cwd(), 'data', 'public-records');
}

function loadDir() {
  if (loaded) return;
  loaded = true;
  if (!directory) directory = resolveDir();
  mkdirSync(directory, { recursive: true });
  records.clear();
  for (const name of readdirSync(directory)) {
    if (!name.endsWith('.jws')) continue;
    const id = name.slice(0, -4);
    if (!ID_FILE.test(id)) continue;
    records.set(id, readFileSync(join(directory, name)));
  }
}

/** Point the store at a directory and load the records already there. */
export function configurePublicRecordDir(next) {
  directory = String(next || '');
  records.clear();
  loaded = false;
  if (!directory) return;
  loadDir();
}

/** Drop the in-memory copy and read the directory again. */
export function reloadPublicRecords() {
  records.clear();
  loaded = false;
  loadDir();
}

export function publicRecordDirectory() {
  loadDir();
  return directory;
}

export function publicRecordServeEnabled(env = process.env) {
  if (ROTATION_TRUST_SHIPPED !== true) return false;
  return String(env.PUBLIC_RECORD_SERVE || '').trim() === 'true';
}

export function publicRecordJobEnabled(env = process.env) {
  return String(env.PUBLIC_RECORD_JOB || '').trim() === 'true';
}

export function getPublicRecordBytes(receiptId) {
  loadDir();
  if (receiptId == null || receiptId === '') return null;
  const hit = records.get(String(receiptId));
  return hit ? Buffer.from(hit) : null;
}

/**
 * First write wins. An existing file is loaded and left unchanged.
 * The create is exclusive, so two processes cannot both sign.
 */
export function putPublicRecordBytes(receiptId, bytes) {
  loadDir();
  const key = String(receiptId || '');
  if (!ID_FILE.test(key) || records.has(key)) return false;
  const file = join(directory, `${key}.jws`);
  const body = Buffer.from(bytes);
  let fd;
  try {
    fd = openSync(file, 'wx', 0o600);
  } catch (err) {
    if (err && err.code === 'EEXIST') {
      try {
        records.set(key, readFileSync(file));
      } catch {
        // The winner is the file. A read failure leaves this process without a copy.
      }
      return false;
    }
    throw err;
  }
  try {
    writeSync(fd, body);
    fsyncSync(fd);
  } catch (err) {
    try { unlinkSync(file); } catch { /* the failed create is not a record */ }
    throw err;
  } finally {
    closeSync(fd);
  }
  records.set(key, Buffer.from(body));
  return true;
}

export function publicRecordCount() {
  loadDir();
  return records.size;
}

/** Test isolation. Does not run from the backfill script. */
export function resetPublicRecords() {
  records.clear();
  loaded = false;
  directory = resolveDir();
  if (process.env.NODE_ENV === 'test') {
    mkdirSync(directory, { recursive: true });
    for (const name of readdirSync(directory)) {
      if (name.endsWith('.jws')) unlinkSync(join(directory, name));
    }
    loaded = true;
  }
}
