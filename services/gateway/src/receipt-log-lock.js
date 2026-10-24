/**
 * Single-writer lock for the durable receipt log directory.
 *
 * The process opens `<dir>/receipt-log.lock` (O_NOFOLLOW, regular file only)
 * and keeps that descriptor open for its whole life. An exclusive flock(2)
 * is taken on the open file description by running util-linux flock, by
 * absolute path (/usr/bin/flock, never from PATH), once against the
 * inherited descriptor. A second open of the same file must then fail a
 * non-blocking flock, which proves the lock is real. The lock belongs to the
 * open file description, so it stays held after the helper exits and is
 * released by the kernel only when this process closes the descriptor or
 * dies. There is no pid file and no reclaim: a second process on the same
 * host gets `log_locked`.
 *
 * The locked descriptor's (dev, ino) must still be the file at the lock
 * path. That is checked after the lock is taken and again before every
 * journal write (verifyReceiptLogLock). If the lock file was deleted or
 * renamed while held, the check fails and the writer stops (`log_lock_lost`).
 *
 * It covers one directory on one host. flock does not cross machines, and a
 * copied or restored directory, on this host or another, has its own lock.
 *
 * Descriptors opened by Node carry O_CLOEXEC, so other child processes do
 * not inherit the lock.
 */
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

export const RECEIPT_LOG_LOCK_FILE = 'receipt-log.lock';
export const FLOCK_BIN = '/usr/bin/flock';
const CONFLICT_EXIT = 75;
const O_NOFOLLOW = fs.constants.O_NOFOLLOW ?? 0;

/** realpath(dir) -> { fd, file, dev, ino } for locks this process holds. */
const held = new Map();

function lockKey(dir) {
  try {
    return fs.realpathSync(dir);
  } catch {
    return path.resolve(dir);
  }
}

function closeQuietly(fd) {
  if (fd == null) return;
  try {
    fs.closeSync(fd);
  } catch {
    // Already closed.
  }
}

function runFlock(flockBin, fd) {
  const run = spawnSync(flockBin, ['--exclusive', '--nonblock', '--conflict-exit-code', String(CONFLICT_EXIT), '3'], {
    stdio: ['ignore', 'ignore', 'ignore', fd],
    timeout: 5000,
  });
  return {
    status: run.status,
    cause: {
      error: run.error?.code || null,
      status: run.status,
      signal: run.signal || null,
      timed_out: run.error?.code === 'ETIMEDOUT',
    },
  };
}

function unavailable(file, cause) {
  return { held: false, reason: 'log_lock_unavailable', file, cause };
}

/** Same (dev, ino) as the file now at `file`, which must be a regular file. */
function sameInode(fd, file) {
  let a;
  let b;
  try {
    a = fs.fstatSync(fd);
    b = fs.lstatSync(file);
  } catch {
    return false;
  }
  return b.isFile() && a.dev === b.dev && a.ino === b.ino;
}

/**
 * Take, or reuse, the exclusive lock for `dir`.
 * @param {string} dir
 * @param {{ flockBin?: string }} [opts] flockBin must be an absolute path (tests only)
 * @returns {{ held: true, file: string, reused: boolean }
 *   | { held: false, reason: 'log_locked' | 'log_lock_unavailable' | 'log_lock_lost', file: string, cause?: object }}
 */
export function acquireReceiptLogLock(dir, { flockBin = FLOCK_BIN } = {}) {
  fs.mkdirSync(dir, { recursive: true });
  const key = lockKey(dir);
  const file = path.join(key, RECEIPT_LOG_LOCK_FILE);
  const existing = held.get(key);
  if (existing) {
    if (!sameInode(existing.fd, existing.file)) return { held: false, reason: 'log_lock_lost', file };
    return { held: true, file: existing.file, reused: true };
  }
  if (typeof flockBin !== 'string' || !path.isAbsolute(flockBin)) return unavailable(file, { error: 'flock_not_absolute' });
  try {
    const st = fs.lstatSync(file);
    if (!st.isFile()) return unavailable(file, { error: st.isSymbolicLink() ? 'lock_symlink' : 'lock_not_regular_file' });
  } catch (err) {
    if (err?.code !== 'ENOENT') return unavailable(file, { error: err?.code || 'lock_stat' });
  }
  let fd;
  try {
    fd = fs.openSync(file, fs.constants.O_RDWR | fs.constants.O_CREAT | O_NOFOLLOW, 0o600);
  } catch (err) {
    return unavailable(file, { error: err?.code === 'ELOOP' ? 'lock_symlink' : (err?.code || 'lock_open') });
  }
  if (!fs.fstatSync(fd).isFile()) {
    closeQuietly(fd);
    return unavailable(file, { error: 'lock_not_regular_file' });
  }
  const first = runFlock(flockBin, fd);
  if (first.status !== 0) {
    closeQuietly(fd);
    if (first.status === CONFLICT_EXIT) return { held: false, reason: 'log_locked', file };
    return unavailable(file, first.cause);
  }
  // Probe: a second open file description must now be refused.
  let probeFd = null;
  let probe;
  try {
    probeFd = fs.openSync(file, fs.constants.O_RDONLY | O_NOFOLLOW);
    probe = runFlock(flockBin, probeFd);
  } catch (err) {
    probe = { status: null, cause: { error: err?.code || 'probe_open' } };
  } finally {
    closeQuietly(probeFd);
  }
  if (probe.status !== CONFLICT_EXIT) {
    closeQuietly(fd);
    return unavailable(file, { error: 'lock_probe_failed', probe: probe.cause });
  }
  if (!sameInode(fd, file)) {
    closeQuietly(fd);
    return unavailable(file, { error: 'lock_inode_changed' });
  }
  const st = fs.fstatSync(fd);
  held.set(key, { fd, file, dev: st.dev, ino: st.ino });
  return { held: true, file, reused: false };
}

/**
 * Whether this process still holds a live lock for `dir`.
 * @returns {{ ok: true } | { ok: false, reason: 'log_lock_missing' | 'log_lock_lost' }}
 */
export function verifyReceiptLogLock(dir) {
  if (!dir) return { ok: false, reason: 'log_lock_missing' };
  const entry = held.get(lockKey(dir));
  if (!entry) return { ok: false, reason: 'log_lock_missing' };
  if (!sameInode(entry.fd, entry.file)) return { ok: false, reason: 'log_lock_lost' };
  return { ok: true };
}

/** True when this process holds the lock for `dir` and it is still the file at the lock path. */
export function holdsReceiptLogLock(dir) {
  return verifyReceiptLogLock(dir).ok;
}

/** Test helper: release every lock this process holds. */
export function _releaseReceiptLogLocksForTest() {
  for (const { fd } of held.values()) closeQuietly(fd);
  held.clear();
}
