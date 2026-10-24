/**
 * Public copies of /health, /stats, and /stats/door.
 * Exact volume, revenue, fees, payers, mix, tokens, proofs, COGS, floats,
 * uptime, server name, and fee configuration stay on the house owner route.
 */

export function receiptVolumeBucket(count) {
  const n = Number(count);
  const value = Number.isFinite(n) && n > 0 ? n : 0;
  if (value < 100) return '<100 receipts';
  if (value < 1000) return '<1k receipts';
  if (value < 10000) return '<10k receipts';
  return '>=10k receipts';
}

export function publicStatsBody(count) {
  return { receipts: receiptVolumeBucket(count) };
}

export function unacknowledgedQuarantineCount(log) {
  const block = log?.quarantined_heads;
  if (!block) return 0;
  if (Array.isArray(block.heads)) {
    return block.heads.filter((row) => row?.acknowledged !== true).length;
  }
  return Number(block.unacknowledged ?? block.count) || 0;
}

export function healthIsDegraded(log) {
  return (Number(log?.consecutive_failures) > 0)
    || !!log?.last_error
    || unacknowledgedQuarantineCount(log) > 0;
}

function publicCount(value) {
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) return 0;
  return Math.floor(n);
}

const ESCROW_HEALTH_PATHS = ['fixed_head', 'quarantine_sign', 'payer_binding'];
const ESCROW_HEALTH_REASON = /^[a-z][a-z_]{0,39}$/;

function publicEscrowRefusals(counts) {
  if (!counts || typeof counts !== 'object') return null;
  const out = {};
  for (const name of ESCROW_HEALTH_PATHS) {
    const byReason = counts[name];
    if (!byReason || typeof byReason !== 'object') continue;
    for (const [reason, n] of Object.entries(byReason)) {
      const count = publicCount(n);
      if (!ESCROW_HEALTH_REASON.test(reason) || count === 0) continue;
      if (!out[name]) out[name] = {};
      out[name][reason] = count;
    }
  }
  return Object.keys(out).length ? out : null;
}

export function publicHealthBody({
  degraded = false,
  lastAnchoredRoot = null,
  lastAnchoredTx = null,
  quarantinedHeads = null,
  anchorLagS = 0,
  unanchoredLeaves = 0,
  receiptFailures = 0,
  issuanceCap = null,
  escrowRefusals = null,
} = {}) {
  const body = {
    status: degraded ? 'degraded' : 'ok',
    last_anchored_root: lastAnchoredRoot ?? null,
    last_anchored_tx: lastAnchoredTx ?? null,
    free_tier: 'available',
    anchor_lag_s: publicCount(anchorLagS),
    unanchored_leaves: publicCount(unanchoredLeaves),
    receipt_failures: publicCount(receiptFailures),
    issuance: {
      cap: issuanceCap || { hour_used: 0, day_used: 0, state: 'off' },
    },
  };
  // Per-reason escrow refusal counts (fixed heads, quarantine list signing,
  // payer binding). Fixed reason codes and counts only. Absent when none.
  const escrow = publicEscrowRefusals(escrowRefusals);
  if (escrow) body.escrow_refusals = escrow;
  // Absent when nothing is quarantined, so a clean boot keeps the extra list off.
  // An acknowledged head stays in the list. It does not flip status to degraded.
  if (quarantinedHeads && Number(quarantinedHeads.count) > 0) {
    const heads = Array.isArray(quarantinedHeads.heads) ? quarantinedHeads.heads : [];
    body.quarantined_heads = {
      count: Number(quarantinedHeads.count),
      heads: heads.map((row) => ({
        epoch: row.epoch,
        tree_size: row.tree_size,
        prefix_size: row.prefix_size,
        acknowledged: row.acknowledged === true,
      })),
    };
  }
  return body;
}

function esc(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** Coarse public page. The bucket is the only figure. */
export function renderPublicStatsHtml(count) {
  const bucket = receiptVolumeBucket(count);
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Chit</title>
  <meta name="robots" content="noindex" />
</head>
<body>
  <p>Receipt volume: ${esc(bucket)}</p>
</body>
</html>`;
}
