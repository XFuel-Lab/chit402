/**
 * Library-only test snapshot seam. Not re-exported from the package entry
 * and not reachable through package.json "exports", so it is not public
 * API, and the CLI has no flag for it.
 *
 * Tests import this module from dist/internal/test-seam.js and put a
 * snapshot under TEST_SNAPSHOT on the options object passed to
 * checkReceiptInput or verifyReceipt. The snapshot replaces the bundled
 * issuer history, version windows and legacy allowlist for that call only.
 * The symbol is created here (not Symbol.for), so only code that imports
 * this module can name it.
 */
import type { IssuerHistoryDocument } from '../issuer-history.js';
import type { VersionWindows } from '../version-windows.js';
import type { LegacyAllowlist } from '../legacy-allowlist.js';

export const TEST_SNAPSHOT: unique symbol = Symbol('chit402-verify test snapshot');

export interface TestSnapshot {
  /** Replaces the bundled issuer history (document and its exact bytes). */
  issuerHistory?: { document: IssuerHistoryDocument; bytes: string };
  versionWindows?: VersionWindows;
  legacyAllowlist?: LegacyAllowlist;
}

export function readTestSnapshot(options: unknown): TestSnapshot | null {
  if (!options || typeof options !== 'object') return null;
  const value = (options as Record<symbol, unknown>)[TEST_SNAPSHOT];
  return value && typeof value === 'object' ? value as TestSnapshot : null;
}

/** Copy the snapshot (if any) onto an options object built from another one. */
export function carryTestSnapshot<T extends object>(from: unknown, to: T): T {
  const snapshot = readTestSnapshot(from);
  if (snapshot) (to as Record<symbol, unknown>)[TEST_SNAPSHOT] = snapshot;
  return to;
}

/** Build a legacy allowlist for a test snapshot (no digest pin). */
export { parseLegacyAllowlistInternal as parseLegacyAllowlistForTest } from '../legacy-allowlist.js';
