/**
 * Per-receipt Open Graph title/description/image URLs (no receipt.js import — avoids cycles).
 */

/** Display task id with chit- prefix for share copy. */
export function displayTaskIdForShare(taskId) {
  if (!taskId || typeof taskId !== 'string') return '';
  return taskId.startsWith('xfuel-') ? `chit-${taskId.slice(6)}` : taskId;
}

/** Short id for og:title (e.g. chit-1ebc5616…). */
export function shortReceiptIdForShare(taskId) {
  const display = displayTaskIdForShare(taskId);
  const uuidHead = display.match(/^chit-([0-9a-f]{8})/i);
  if (uuidHead) return `chit-${uuidHead[1]}…`;
  if (display.length <= 22) return display;
  return `${display.slice(0, 20)}…`;
}

/** Atomic USDC string → "1.00 USDC" / "0.002 USDC". */
export function formatUsdcShareAmount(grossAmount, rail) {
  if (rail === 'unmetered') return 'UNMETERED';
  const n = Number(grossAmount);
  if (!Number.isFinite(n)) return 'USDC';
  const usd = n / 1e6;
  if (usd === 0) return '0 USDC';
  const body = Math.abs(usd) >= 0.01
    ? usd.toFixed(2)
    : usd.toFixed(6).replace(/\.?0+$/, '');
  return `${body} USDC`;
}

function networkFromPaymentRef(paymentRef) {
  if (!paymentRef || typeof paymentRef !== 'string') return null;
  const idx = paymentRef.indexOf(':');
  if (idx <= 0) return null;
  return paymentRef.slice(0, idx);
}

function settlementNetworkLabel(paymentRef) {
  const network = networkFromPaymentRef(paymentRef);
  if (network === 'solana' || network === 'solana-devnet') return 'Solana';
  if (network === 'base' || network === 'base-sepolia') return 'Base';
  if (network) return String(network);
  return 'Base';
}

export function receiptOgRailLabel(view) {
  const p = view?.payment;
  if (!p) return null;
  if (p.rail === 'unmetered') return 'UNMETERED';
  const asset = (p.asset || 'USDC').toUpperCase();
  if (p.rail === 'usdc' || String(p.rail).startsWith('solana')) {
    return `${settlementNetworkLabel(p.ref)} ${asset}`;
  }
  return String(p.rail || '').toUpperCase() || null;
}

export function receiptOgCollectionLabel(view) {
  const p = view?.payment;
  if (!p) return null;
  if (p.rail === 'unmetered') return 'not charged';
  if (p.rail === 'reported') return 'reported';
  if (p.collected) return 'collected';
  if (p.collects_on === 'next_request') return 'bill pending';
  return 'not collected';
}

export function receiptOgEvidenceLabel(receipt) {
  if (!receipt || typeof receipt !== 'object') return null;
  if (receipt.evidence === 'foreign_ingest' || receipt.foreign_x402 || receipt.source === 'foreign_ingest') {
    return 'third-party';
  }
  if (receipt.source === 'openrouter_broadcast' || receipt.evidence === 'openrouter_reported' || receipt.kind === 'openrouter_broadcast') {
    return 'unverified';
  }
  return null;
}

/** Absolute URL for GET /receipt/:id/og.png (same host as verify_url). */
export function buildReceiptOgImageUrl(receipt) {
  const self = receipt?.links?.self || receipt?.verify_url;
  if (!self || typeof self !== 'string') return null;
  return `${self.replace(/\/$/, '')}/og.png`;
}

/**
 * Open Graph title + description + image for a public receipt.
 * @param {object} receipt — buildReceipt() or foreign ingest snapshot
 * @param {object} [mergedView] — output of mergeReceiptView(receipt)
 */
export function buildReceiptOgMeta(receipt, mergedView = null) {
  const view = mergedView || receipt;
  const p = view.payment || {};
  const amountLabel = formatUsdcShareAmount(p.gross_amount, p.rail);
  const shortId = shortReceiptIdForShare(receipt.task_id || view.task_id);

  const title = p.rail === 'unmetered'
    ? `Chit receipt · UNMETERED · ${shortId}`
    : `${amountLabel} · ${shortId}`;

  const descParts = [
    receiptOgRailLabel(view),
    receiptOgCollectionLabel(view),
    receiptOgEvidenceLabel(receipt),
  ].filter(Boolean);

  const description = descParts.length
    ? descParts.join(' · ')
    : 'Signed receipt · verify_url';

  const imageUrl = buildReceiptOgImageUrl(receipt);

  return { title, description, imageUrl };
}
