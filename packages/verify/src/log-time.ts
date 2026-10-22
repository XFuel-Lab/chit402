/**
 * Log time for the L5 check (verifier redesign step 3).
 *
 * Log time is the chain time of the earliest anchored signed tree head that
 * covers the receipt's leaf. Heads are probed by size with
 * GET /v1/receipts/tree/head?tree_size=k for k = leaf_index + 1 upward, at
 * most PROBE_CAP sizes. The first head that exists, verifies under a trusted
 * issuer key, and whose Solana anchor memo carries that head's root gives
 * the time (the anchor transaction's blockTime, finalized). When no probed
 * head qualifies, the head the inclusion proof was checked against is used:
 * it is later, so the time can only be later (stricter), never earlier.
 *
 * Not proven here: that the earlier head and the current head are the same
 * log (no consistency proof between them). A later step can add it.
 */
import type { IssuerHistoryDocument } from './issuer-history.js';
import { checkLogTime, windowIdForPayloadVersion, type VersionWindows } from './version-windows.js';
import { verifyTreeHeadTrust } from './anchor-trust.js';
import {
  extractMemos,
  fetchSolanaAnchorTransaction,
  normalizeRoot,
  parseAnchorMemo,
  type SolanaAnchorTx,
} from './anchor-witness.js';

export const LOG_TIME_PROBE_CAP = 8;

export interface LogTimeHead {
  tree_size?: number | string | null;
  root?: string | null;
  anchors?: { solana?: { signature?: string | null } | null } | null;
}

export type LogTimeResult =
  | { ok: true; ms: number; tree_size: number; source: 'earliest_probe' | 'verified_head' }
  | { ok: false; reason: 'log_time_unavailable' };

export interface LogTimeInput {
  origin: string;
  leafIndex: number;
  /** The head the inclusion proof verified against (already trusted and anchored). */
  verifiedHead: LogTimeHead;
  history: IssuerHistoryDocument | null;
  trustedKids: readonly string[];
  solanaRpcUrls: readonly string[];
  getJson: (url: string) => Promise<unknown | null>;
  fetchSolanaTx?: (signature: string, rpcUrl: string) => Promise<SolanaAnchorTx | null>;
  probeCap?: number;
}

async function solanaAnchorTimeMs(head: LogTimeHead, input: LogTimeInput): Promise<number | null> {
  const signature = head.anchors?.solana?.signature;
  const root = normalizeRoot(head.root ?? null);
  if (typeof signature !== 'string' || !signature || !root) return null;
  const fetchTx = input.fetchSolanaTx ?? fetchSolanaAnchorTransaction;
  for (const url of input.solanaRpcUrls) {
    let tx: SolanaAnchorTx | null;
    try {
      tx = await fetchTx(signature, url);
    } catch {
      continue;
    }
    if (!tx) continue;
    if (tx.meta?.err != null) return null;
    const memoRoots = extractMemos(tx).map((m) => parseAnchorMemo(m)?.root ?? null);
    if (!memoRoots.includes(root)) return null;
    const blockTime = (tx as { blockTime?: unknown }).blockTime;
    if (typeof blockTime !== 'number' || !Number.isFinite(blockTime) || blockTime <= 0) return null;
    return blockTime * 1000;
  }
  return null;
}

export async function earliestLogTime(input: LogTimeInput): Promise<LogTimeResult> {
  const cap = input.probeCap ?? LOG_TIME_PROBE_CAP;
  const verifiedSize = Number(input.verifiedHead.tree_size);
  if (!Number.isSafeInteger(input.leafIndex) || input.leafIndex < 0 || !Number.isSafeInteger(verifiedSize)) {
    return { ok: false, reason: 'log_time_unavailable' };
  }
  const last = Math.min(input.leafIndex + cap, verifiedSize - 1);
  for (let size = input.leafIndex + 1; size <= last; size += 1) {
    const url = `${input.origin}/v1/receipts/tree/head?tree_size=${size}`;
    let body: unknown;
    try {
      body = await input.getJson(url);
    } catch {
      continue;
    }
    if (!body || typeof body !== 'object' || 'error' in (body as object)) continue;
    const head = body as LogTimeHead;
    if (Number(head.tree_size) !== size) continue;
    const trust = verifyTreeHeadTrust(head as never, { trustedKids: input.trustedKids, issuerHistory: input.history });
    if (!trust.ok) continue;
    const ms = await solanaAnchorTimeMs(head, input);
    if (ms != null) return { ok: true, ms, tree_size: size, source: 'earliest_probe' };
  }
  const ms = await solanaAnchorTimeMs(input.verifiedHead, input);
  if (ms != null) return { ok: true, ms, tree_size: verifiedSize, source: 'verified_head' };
  return { ok: false, reason: 'log_time_unavailable' };
}

/**
 * L5 decision for a receipt that passed log inclusion. Null when the
 * version window is open (nothing to check) or the log time is inside the
 * window plus the log grace.
 */
export async function logTimeReason(input: Omit<LogTimeInput, 'leafIndex'> & {
  claims: Record<string, unknown>;
  leafIndex: number | null;
  windows: VersionWindows;
}): Promise<'log_time_after_window' | 'log_time_unavailable' | null> {
  const root = input.claims.issuer_root;
  const id = windowIdForPayloadVersion(Number(input.claims.payload_version), root != null && typeof root === 'object');
  const window = id && input.windows.ok ? input.windows.windows.get(id) ?? null : null;
  if (!window || window.not_after === null) return null;
  if (input.leafIndex == null) return 'log_time_unavailable';
  const time = await earliestLogTime({ ...input, leafIndex: input.leafIndex });
  if (!time.ok) return 'log_time_unavailable';
  return checkLogTime(window, time.ms, input.windows) ? null : 'log_time_after_window';
}
