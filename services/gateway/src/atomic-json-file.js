/**
 * One JSON snapshot, written so a crash cannot leave the target half-written.
 * The temp file is opened with mode 0o600 (umask can only narrow that) in the
 * same directory, fsync'd, then renamed over the target. A directory fsync
 * after the rename is best effort. Any error closes and unlinks the temp
 * file, then throws persist_failed. The label is the store name only.
 */
import fs from 'node:fs';
import path from 'node:path';
import { persistFailed } from './persist-error.js';

/**
 * @param {string} target
 * @param {unknown} value
 * @param {{ fs?: typeof fs, label?: string }} [opts]
 */
export function writeAtomicJson(target, value, { fs: fsImpl = fs, label = 'atomic-json: save failed' } = {}) {
  const dir = path.dirname(target);
  const tmp = `${target}.tmp-${process.pid}`;
  let fd = null;
  try {
    fd = fsImpl.openSync(tmp, 'wx', 0o600);
    fsImpl.writeSync(fd, JSON.stringify(value));
    fsImpl.fsyncSync(fd);
    fsImpl.closeSync(fd);
    fd = null;
    fsImpl.renameSync(tmp, target);
  } catch (err) {
    if (fd != null) {
      try { fsImpl.closeSync(fd); } catch { /* close the temp fd */ }
    }
    try { fsImpl.unlinkSync(tmp); } catch { /* temp already gone */ }
    throw err?.code === 'persist_failed' ? err : persistFailed(err, label);
  }
  try {
    const dfd = fsImpl.openSync(dir, 'r');
    try { fsImpl.fsyncSync(dfd); } finally { fsImpl.closeSync(dfd); }
  } catch { /* directory fsync is best effort */ }
}
