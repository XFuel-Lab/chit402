/**
 * Broadcast class and backoff used by the hourly close.
 *
 * These are the bodies of anchorBackoffMs and classifyAnchorSendError in
 * services/gateway/src/receipt-merkle.js. The close path does not import
 * that module: importing it builds the live gateway. The offline suite
 * pins these bodies to that file so the two cannot drift.
 */

export const ANCHOR_RETRY_MS = 60_000;

export function anchorBackoffMs(attempts) {
  const n = Math.max(0, Math.min(Number(attempts) || 0, 6));
  if (n <= 0) return 0;
  return Math.min(60 * 60 * 1000, ANCHOR_RETRY_MS * (2 ** (n - 1)));
}

export function classifyAnchorSendError(err) {
  const msg = String(err?.message || err || '').toLowerCase();
  if (/already known|nonce too low/.test(msg)) return 'known';
  if (/broadcast_rejected|underpriced|replacement transaction underpriced|insufficient funds|intrinsic gas|exceeds block gas|invalid sender|execution reverted|nonce has already been used|transaction underpriced|dropped/.test(msg)) {
    return 'permanent';
  }
  return 'transient';
}
