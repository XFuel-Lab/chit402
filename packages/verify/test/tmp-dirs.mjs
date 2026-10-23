// Temporary directories for tests, removed when the test file finishes,
// whether its tests pass or fail (node:test `after` on the file's root, and
// process exit as a fallback).
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after } from 'node:test';

const dirs = new Set();

/** Remove every directory made by tempDir so far. */
export function cleanupTempDirs() {
  for (const d of dirs) {
    try { rmSync(d, { recursive: true, force: true }); } catch { /* already gone */ }
  }
  dirs.clear();
}

after(cleanupTempDirs);
process.once('exit', cleanupTempDirs);

/** mkdtemp under the OS temp dir, removed when the test file finishes. */
export function tempDir(prefix) {
  const d = mkdtempSync(join(tmpdir(), prefix));
  dirs.add(d);
  return d;
}
