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

export function publicHealthBody({
  degraded = false,
  lastAnchoredRoot = null,
  lastAnchoredTx = null,
  quarantinedHeads = null,
} = {}) {
  const body = {
    status: degraded ? 'degraded' : 'ok',
    last_anchored_root: lastAnchoredRoot ?? null,
    last_anchored_tx: lastAnchoredTx ?? null,
    free_tier: 'available',
  };
  // Absent when nothing is quarantined, so a clean boot keeps the public shape.
  if (quarantinedHeads && Number(quarantinedHeads.count) > 0) {
    body.quarantined_heads = {
      count: Number(quarantinedHeads.count),
      heads: Array.isArray(quarantinedHeads.heads) ? quarantinedHeads.heads : [],
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
