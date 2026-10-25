/**
 * Host-only receipt-failure append, for host commands that run beside the
 * gateway (scripts/sign-quarantine-list-production.mjs).
 *
 * The gateway owns RECEIPT_FAILURES_FILE: it creates it, reads it at startup
 * and rotates it. A host command must not do any of that, because it can run
 * as another user (a file or directory it creates or rotates is then owned by
 * that user and the gateway's own appends fail silently), and because the
 * gateway's startup read and recursive mkdir misbehave on a pathological path
 * (a character device never ends, a FIFO blocks, procfs can loop).
 *
 * So this appends exactly one line, and only when RECEIPT_FAILURES_FILE names
 * an existing regular file:
 * - the path is checked with lstat: a symlink, directory, FIFO, socket,
 *   character or block device, or a missing file writes nothing;
 * - nothing under /proc, /dev or /sys (by path and by the real parent);
 * - opened O_WRONLY | O_APPEND | O_NOFOLLOW | O_NONBLOCK, never O_CREAT, and
 *   the open file must still be that regular file (same device and inode);
 * - no read, no mkdir, no rotation, no fsync; one write.
 * The row is the one the gateway writes (escrowAlertRow), so a gateway reload
 * counts it. Any failure is swallowed: it returns false and never throws.
 */
import fs from 'node:fs';
import path from 'node:path';
import { escrowAlertRow } from './receipt-failures.js';

const SPECIAL_ROOTS = ['/proc', '/dev', '/sys'];

function underSpecialRoot(p) {
  return SPECIAL_ROOTS.some((root) => p === root || p.startsWith(`${root}/`));
}

/**
 * @param {{ path: string, reason: string }} refusal
 * @param {{ file?: string, now?: () => number }} [opts]
 * @returns {boolean} true only when the whole line was appended
 */
export function appendHostEscrowRefusal({ path: pathName, reason } = {}, { file = process.env.RECEIPT_FAILURES_FILE, now = Date.now } = {}) {
  let fd = null;
  try {
    if (typeof file !== 'string' || file.trim() === '') return false;
    const target = path.resolve(file.trim());
    if (underSpecialRoot(target)) return false;
    const parent = fs.realpathSync(path.dirname(target));
    if (underSpecialRoot(parent)) return false;
    const real = path.join(parent, path.basename(target));
    const before = fs.lstatSync(real);
    if (!before.isFile()) return false;
    const row = escrowAlertRow({ path: pathName, reason, time: new Date(now()).toISOString() });
    if (!row) return false;
    const line = Buffer.from(`${JSON.stringify(row)}\n`, 'utf8');
    const { O_WRONLY, O_APPEND, O_NOFOLLOW = 0, O_NONBLOCK = 0 } = fs.constants;
    fd = fs.openSync(real, O_WRONLY | O_APPEND | O_NOFOLLOW | O_NONBLOCK);
    const after = fs.fstatSync(fd);
    if (!after.isFile() || after.dev !== before.dev || after.ino !== before.ino) return false;
    return fs.writeSync(fd, line) === line.length;
  } catch {
    return false;
  } finally {
    if (fd !== null) {
      try { fs.closeSync(fd); } catch { /* nothing to do */ }
    }
  }
}
