/**
 * Single-writer lock for the durable receipt log directory.
 *
 * The process opens `<dir>/receipt-log.lock` and keeps that descriptor open
 * for its whole life. An exclusive flock(2) is taken on the open file
 * description by running util-linux `flock` once against the inherited
 * descriptor. The lock belongs to the open file description, so it stays
 * held after that helper exits and is released by the kernel only when this
 * process closes the descriptor or dies. There is no pid file and no
 * reclaim: a second process on the same host gets `log_locked`.
 *
 * Same host only. flock does not cross machines, and a restored or copied
 * log directory on another machine never sees this lock. Cross-host
 * separation is the signing domain salt plus the boot checks, not this file.
 *
 * Descriptors opened by Node carry O_CLOEXEC, so other child processes do
 * not inherit the lock.
 */
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

export const RECEIPT_LOG_LOCK_FILE = 'receipt-log.lock';
const CONFLICT_EXIT = 75;

/** realpath(dir) -> { fd, file } for locks this process holds. */
const held = new Map();

function lockKey(dir) {
  try {
    return fs.realpathSync(dir);
  } catch {
    return path.resolve(dir);
  }
}

/**
 * Take, or reuse, the exclusive lock for `dir`.
 * @param {string} dir
 * @param {{ flockBin?: string }} [opts]
 * @returns {{ held: true, file: string, reused: boolean } | { held: false, reason: 'log_locked' | 'log_lock_unavailable', file: string }}
 */
export function acquireReceiptLogLock(dir, { flockBin = 'flock' } = {}) {
  fs.mkdirSync(dir, { recursive: true });
  const key = lockKey(dir);
  const file = path.join(key, RECEIPT_LOG_LOCK_FILE);
  const existing = held.get(key);
  if (existing) return { held: true, file: existing.file, reused: true };
  let fd;
  try {
    fd = fs.openSync(file, fs.constants.O_RDWR | fs.constants.O_CREAT, 0o600);
  } catch {
    return { held: false, reason: 'log_lock_unavailable', file };
  }
  const run = spawnSync(flockBin, ['--exclusive', '--nonblock', '--conflict-exit-code', String(CONFLICT_EXIT), '3'], {
    stdio: ['ignore', 'ignore', 'ignore', fd],
    timeout: 5000,
  });
  if (run.status === 0) {
    held.set(key, { fd, file });
    return { held: true, file, reused: false };
  }
  try {
    fs.closeSync(fd);
  } catch {
    // The descriptor is ours and unlocked; nothing else to release.
  }
  if (run.status === CONFLICT_EXIT) return { held: false, reason: 'log_locked', file };
  return { held: false, reason: 'log_lock_unavailable', file };
}

/** True when this process holds the lock for `dir`. */
export function holdsReceiptLogLock(dir) {
  if (!dir) return false;
  return held.has(lockKey(dir));
}

/** Test helper: release every lock this process holds. */
export function _releaseReceiptLogLocksForTest() {
  for (const { fd } of held.values()) {
    try {
      fs.closeSync(fd);
    } catch {
      // Already closed.
    }
  }
  held.clear();
}
