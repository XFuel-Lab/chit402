/**
 * One snapshot, one file. The temp file is created in the same directory
 * with O_EXCL and mode 600 (umask can only narrow that), fsynced, then
 * renamed over the target. A failed write unlinks the temp file and throws
 * persist_failed. Directory fsync after the rename is best effort.
 */
import fs from 'node:fs';
import path from 'node:path';
import { persistFailed } from './persist-error.js';

let tmpSeq = 0;

/** Crash leftovers from this writer: `.<name>.<pid>.<seq>.tmp` in one directory. */
const STALE_TMP = /^\..+\.\d+\.\d+\.tmp$/;

/**
 * Drop stale temp files in `dir` only. Subdirectories are left alone.
 * A name that is not a regular file is left alone.
 * @param {string} dir
 * @param {typeof import('node:fs')} [fsImpl]
 */
export function unlinkStaleAtomicTemps(dir, fsImpl = fs) {
  let names;
  try {
    names = fsImpl.readdirSync(dir);
  } catch {
    return;
  }
  for (const name of names) {
    if (!STALE_TMP.test(name)) continue;
    const full = path.join(dir, name);
    try {
      if (!fsImpl.lstatSync(full).isFile()) continue;
      fsImpl.unlinkSync(full);
    } catch { /* a stuck temp must not refuse boot */ }
  }
}

/**
 * @param {string} target
 * @param {string} text
 * @param {{ fs?: typeof import('node:fs'), label?: string }} [opts]
 */
export function writeAtomicJsonFile(target, text, { fs: fsImpl = fs, label = 'atomic-json: save failed' } = {}) {
  const dir = path.dirname(target);
  const tmp = path.join(dir, `.${path.basename(target)}.${process.pid}.${++tmpSeq}.tmp`);
  const payload = typeof text === 'string' ? text : JSON.stringify(text);
  let fd = null;
  try {
    fd = fsImpl.openSync(tmp, 'wx', 0o600);
    fsImpl.writeSync(fd, payload);
    fsImpl.fsyncSync(fd);
    fsImpl.closeSync(fd);
    fd = null;
    fsImpl.renameSync(tmp, target);
  } catch (err) {
    if (fd != null) {
      try { fsImpl.closeSync(fd); } catch { /* close is best effort on the way out */ }
    }
    try { fsImpl.unlinkSync(tmp); } catch { /* tmp may not exist */ }
    throw err?.code === 'persist_failed' ? err : persistFailed(err, label);
  }
  try {
    const dfd = fsImpl.openSync(dir, 'r');
    try { fsImpl.fsyncSync(dfd); } finally { fsImpl.closeSync(dfd); }
  } catch { /* directory fsync is best effort */ }
}
