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
  linkSync,
  mkdirSync,
  openSync,
  readFileSync,
  readdirSync,
  unlinkSync,
  writeSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

/** Hard gate. The env flag cannot open serving while this is false. */
export const ROTATION_TRUST_SHIPPED = false;

const ID_FILE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,200}$/;
const COMPACT_JWS = /^[A-Za-z0-9_-]+$/;

const records = new Map();
let directory = null;
let loaded = false;

/** Gateway and the backfill script both use this folder unless PUBLIC_RECORD_DIR is set. */
export function publicRecordDirDefault() {
  return join(fileURLToPath(new URL('..', import.meta.url)), '.data', 'public-records');
}

function resolveDir() {
  const fromEnv = String(process.env.PUBLIC_RECORD_DIR || '').trim();
  if (fromEnv) return fromEnv;
  if (process.env.NODE_ENV === 'test') return join(tmpdir(), `chit402-public-records-${process.pid}`);
  return publicRecordDirDefault();
}

/**
 * One folder for the server and the backfill. A test process keeps its
 * temporary directory and does not create the gateway data folder.
 */
export function ensurePublicRecordDir() {
  const existing = String(process.env.PUBLIC_RECORD_DIR || '').trim();
  if (existing) return existing;
  if (process.env.NODE_ENV === 'test') return resolveDir();
  process.env.PUBLIC_RECORD_DIR = publicRecordDirDefault();
  if (directory && directory !== process.env.PUBLIC_RECORD_DIR) {
    records.clear();
    loaded = false;
    directory = process.env.PUBLIC_RECORD_DIR;
  }
  return process.env.PUBLIC_RECORD_DIR;
}

/** Compact JWS only. An empty file or a partial write is not a record. */
export function isCompactJws(bytes) {
  if (!bytes || bytes.length === 0) return false;
  const text = Buffer.from(bytes).toString('utf8');
  const parts = text.split('.');
  if (parts.length !== 3) return false;
  return parts.every((part) => part.length > 0 && COMPACT_JWS.test(part));
}

function readValid(file) {
  try {
    const buf = readFileSync(file);
    return isCompactJws(buf) ? buf : null;
  } catch {
    return null;
  }
}

function unlinkQuiet(file) {
  try { unlinkSync(file); } catch { /* already gone */ }
}

function fsyncDir(dir) {
  const fd = openSync(dir, 'r');
  try {
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
}

function writeTemp(tmp, body) {
  const fd = openSync(tmp, 'wx', 0o600);
  try {
    let offset = 0;
    while (offset < body.length) {
      const wrote = writeSync(fd, body, offset, body.length - offset);
      if (!Number.isInteger(wrote) || wrote <= 0 || offset + wrote > body.length) {
        const err = new Error('public_record_short_write');
        err.code = 'public_record_short_write';
        throw err;
      }
      offset += wrote;
    }
    if (offset !== body.length) {
      const err = new Error('public_record_short_write');
      err.code = 'public_record_short_write';
      throw err;
    }
    fsyncSync(fd);
  } catch (err) {
    try { closeSync(fd); } catch { /* closing a failed write */ }
    unlinkQuiet(tmp);
    throw err;
  }
  closeSync(fd);
}

function loadDir() {
  if (loaded) return;
  loaded = true;
  if (!directory) directory = resolveDir();
  mkdirSync(directory, { recursive: true });
  records.clear();
  for (const name of readdirSync(directory)) {
    if (!name.endsWith('.jws') || name.startsWith('.')) continue;
    const id = name.slice(0, -4);
    if (!ID_FILE.test(id)) continue;
    const buf = readValid(join(directory, name));
    if (!buf) continue;
    records.set(id, buf);
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
  const key = String(receiptId || '');
  if (!ID_FILE.test(key)) return null;
  if (records.has(key)) {
    const hit = records.get(key);
    return hit && hit.length ? Buffer.from(hit) : null;
  }
  // A backfill may have linked the file after this process loaded the directory.
  const buf = readValid(join(directory, `${key}.jws`));
  if (!buf) return null;
  records.set(key, buf);
  return Buffer.from(buf);
}

/**
 * First durable write wins. Bytes are fsynced in a temp file, then linked
 * into place. A crash before the link leaves no .jws. An empty or non-JWS
 * name left behind is not a record and does not block the real bytes.
 */
export function putPublicRecordBytes(receiptId, bytes) {
  loadDir();
  const key = String(receiptId || '');
  if (!ID_FILE.test(key) || records.has(key)) return false;
  const body = Buffer.from(bytes);
  if (!isCompactJws(body)) return false;
  const file = join(directory, `${key}.jws`);
  const tmp = join(directory, `.${key}.${process.pid}.${Date.now()}.${Math.random().toString(16).slice(2)}.tmp`);
  writeTemp(tmp, body);
  try {
    linkSync(tmp, file);
  } catch (err) {
    if (!err || err.code !== 'EEXIST') {
      unlinkQuiet(tmp);
      throw err;
    }
    const existing = readValid(file);
    if (existing) {
      unlinkQuiet(tmp);
      records.set(key, existing);
      return false;
    }
    unlinkQuiet(file);
    try {
      linkSync(tmp, file);
    } catch (again) {
      unlinkQuiet(tmp);
      if (again && again.code === 'EEXIST') {
        const winner = readValid(file);
        if (winner) {
          records.set(key, winner);
          return false;
        }
      }
      throw again;
    }
  }
  try {
    fsyncDir(directory);
  } finally {
    unlinkQuiet(tmp);
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
      if (name.endsWith('.jws') || name.endsWith('.tmp')) unlinkSync(join(directory, name));
    }
    loaded = true;
  }
}
