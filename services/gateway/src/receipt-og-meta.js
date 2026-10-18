/**
 * Per-receipt Open Graph title/description/image URLs (no receipt.js import — avoids cycles).
 */
import { isCanonicalCompactEs256 } from './jws-canonical.js';

/** Known USDC contracts. Dollar labels are allowed only for the contract on that chain. */
export const KNOWN_USDC_BY_CHAIN = {
  base: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
  'base-sepolia': '0x036CbD53842c5426634e7929541eC2318f3dCF7e',
  solana: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
  'solana-devnet': 'Gh9ZwEmdLJ8DscKNTkTqPbNwLNNBjuSzaG9Vp2KGtKJr',
};

/** True when `asset` is the USDC contract for `chain`. Solana mints are case-sensitive. */
export function isKnownUsdcAsset(chain, asset) {
  const expected = KNOWN_USDC_BY_CHAIN[chain];
  if (!expected || asset == null || asset === '') return false;
  const raw = String(asset);
  if (chain === 'solana' || chain === 'solana-devnet') return raw === expected;
  return raw.toLowerCase() === expected.toLowerCase();
}

/** 6+4 short form. Does not change case. */
export function shortForm(value, head = 6, tail = 4) {
  const s = String(value ?? '');
  if (s.length <= head + tail + 1) return s;
  return `${s.slice(0, head)}…${s.slice(-tail)}`;
}

/** Cap a single line. The ellipsis counts toward `max`. */
export function capText(value, max) {
  const s = String(value ?? '');
  if (!Number.isFinite(max) || max < 1) return '';
  if (s.length <= max) return s;
  if (max === 1) return '…';
  return `${s.slice(0, max - 1)}…`;
}

function ogAssetLabel(asset, paymentRef) {
  const network = networkFromPaymentRef(paymentRef);
  if (asset == null || asset === '') return 'unsigned';
  if (isKnownUsdcAsset(network, asset)) return 'USDC';
  const raw = String(asset);
  if (raw.toUpperCase() === 'USDC') return 'USDC';
  return shortForm(raw);
}

/** Share-card amount from signed values: dollars only for a known USDC asset. */
function shareAmountLabel(grossAmount, rail, assetLabel) {
  if (rail === 'unmetered') return 'UNMETERED';
  if (grossAmount == null || grossAmount === '') return 'unsigned';
  if (assetLabel === 'unsigned') return `${String(grossAmount)} (asset not signed)`;
  if (assetLabel === 'USDC') return formatUsdcShareAmount(grossAmount, rail);
  if (assetLabel === 'XNO' && /^[0-9]+$/.test(String(grossAmount))) {
    const d = String(grossAmount).replace(/^0+(?=\d)/, '').padStart(31, '0');
    const int = d.slice(0, -30).replace(/^0+(?=\d)/, '');
    const frac = d.slice(-30).replace(/0+$/, '');
    return `${frac ? `${int}.${frac}` : int} XNO`;
  }
  if (grossAmount == null || grossAmount === '') return 'unsigned';
  return `${String(grossAmount)} ${assetLabel}`;
}

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
  if (network === 'solana') return 'Solana';
  if (network === 'solana-devnet') return 'Solana Devnet';
  if (network === 'base') return 'Base';
  if (network === 'base-sepolia') return 'Base Sepolia';
  if (network) return String(network);
  return 'unsigned';
}

export function receiptOgRailLabel(view) {
  const p = view?.payment;
  if (!p) return null;
  if (p.rail === 'unmetered') return 'UNMETERED';
  const asset = ogAssetLabel(p.asset, p.ref);
  if (p.rail === 'usdc' || String(p.rail).startsWith('solana')) {
    const net = settlementNetworkLabel(p.ref);
    return asset === 'unsigned' ? `${net} (asset not signed)` : `${net} ${asset}`;
  }
  return p.rail ? String(p.rail).toUpperCase() : 'unsigned';
}

export function receiptOgCollectionLabel(view) {
  const p = view?.payment;
  if (!p) return null;
  if (p.rail === 'unmetered') return 'not charged';
  if (p.rail === 'reported') return 'reported';
  // Collection is shown only when a signed settlement ref exists.
  if (p.collected && p.ref) return 'collected';
  return 'collection not signed';
}

export function receiptOgEvidenceLabel(receipt) {
  if (!receipt || typeof receipt !== 'object') return null;
  if (receipt.evidence === 'foreign_ingest' || receipt.foreign_x402 || receipt.source === 'foreign_ingest') {
    return 'third-party';
  }
  if (receipt.source === 'openrouter_broadcast' || receipt.evidence === 'openrouter_reported' || receipt.kind === 'openrouter_broadcast') {
    return receipt.verified_with === 'openrouter_generation_api' ? 'verified with openrouter' : 'unverified';
  }
  return null;
}

/** Absolute URL for GET /receipt/:id/og.png (same host as verify_url). */
export function buildReceiptOgImageUrl(receipt) {
  const self = receipt?.links?.self || receipt?.verify_url;
  if (!self || typeof self !== 'string') return null;
  return `${self.replace(/\/$/, '')}/og.png`;
}

const SIGNED_OG_KEYS = ['rail', 'ref', 'asset', 'gross_amount'];
// Receipt-slot typs, as the library's ISSUER_JWS_TYP.receipt.
const RECEIPT_SLOT_TYPS = ['chit402-receipt+jwt', 'JWT'];

function receiptSlotClaims(jws) {
  if (typeof jws !== 'string' || !isCanonicalCompactEs256(jws)) return null;
  const parts = jws.split('.');
  if (parts.length !== 3) return null;
  try {
    const header = JSON.parse(Buffer.from(parts[0], 'base64url').toString('utf8'));
    if (!header || typeof header !== 'object' || Array.isArray(header)) return null;
    if (header.crit !== undefined || header.b64 !== undefined) return null;
    if (!RECEIPT_SLOT_TYPS.includes(header.typ)) return null;
    const claims = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
    if (!claims || typeof claims !== 'object' || Array.isArray(claims)) return null;
    if (claims.schema != null && claims.schema !== 'chit402.foreign_payout.v1') return null;
    return claims;
  } catch {
    return null;
  }
}

/** Signed payment fields used on the share card (null when unsigned). */
function signedOgPayment(receipt) {
  const out = Object.fromEntries(SIGNED_OG_KEYS.map((k) => [k, null]));
  // Receipt-slot rules: another issuer document's JWS (book-seq, tree head,
  // x402...) or one with crit/b64 is not read.
  const claims = receiptSlotClaims(receipt?.issuer_signature?.jws);
  if (!claims) return out;
  const pay = claims.payment && typeof claims.payment === 'object' ? claims.payment : {};
  for (const k of SIGNED_OG_KEYS) out[k] = pay[k] ?? null;
  return out;
}

/**
 * Open Graph title + description + image for a public receipt.
 * @param {object} receipt — buildReceipt() or foreign ingest snapshot
 * @param {object} [mergedView] — output of displayReceiptView(receipt)
 */
export function buildReceiptOgMeta(receipt, mergedView = null) {
  const view = mergedView || receipt;
  const outerPay = view.payment || {};
  // Rail, ref, asset and amount shown only as signed by the issuer; never the outer copy.
  const sp = signedOgPayment(receipt);
  const p = { ...outerPay, ...sp };
  const signedView = { ...view, payment: view.payment ? p : view.payment };
  const amountLabel = shareAmountLabel(sp.gross_amount, sp.rail, ogAssetLabel(sp.asset, sp.ref));
  const shortId = shortReceiptIdForShare(receipt.task_id || view.task_id);

  const title = p.rail === 'unmetered'
    ? `Chit receipt · UNMETERED · ${shortId}`
    : `${amountLabel} · ${shortId}`;

  const descParts = [
    receiptOgRailLabel(signedView),
    receiptOgCollectionLabel(signedView),
    receiptOgEvidenceLabel(receipt),
  ].filter(Boolean);

  const description = descParts.length
    ? descParts.join(' · ')
    : 'Signed receipt · verify_url';

  const imageUrl = buildReceiptOgImageUrl(receipt);

  return { title, description, imageUrl };
}
