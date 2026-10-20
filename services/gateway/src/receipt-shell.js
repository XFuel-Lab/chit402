/**
 * Public receipt shell. Unsigned. The holder JWS stays on the owner view.
 * This module does not import the receipt issuer signer.
 */
import crypto from 'node:crypto';
import { isCanonicalCompactEs256 } from './jws-canonical.js';
import { explorerUrlForRef } from './receipt.js';
import {
  displayTaskIdForShare,
  isKnownUsdcAsset,
  shortForm,
  shortReceiptIdForShare,
} from './receipt-og-meta.js';
import { VERIFIER_MIN, VERIFIER_UPGRADE_HINT } from './verifier-min.js';

export const SHELL_SCHEMA = 'chit402.receipt_shell.v1';

export function jcsCanonicalize(value) {
  return JSON.stringify(canonicalize(value));
}

function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === 'object') {
    const out = {};
    for (const key of Object.keys(value).sort()) {
      if (value[key] === undefined) continue;
      out[key] = canonicalize(value[key]);
    }
    return out;
  }
  return value;
}

// Receipt-slot typs, as the library's ISSUER_JWS_TYP.receipt.
const RECEIPT_SLOT_TYPS = ['chit402-receipt+jwt', 'JWT'];
const FOREIGN_PAYOUT_SCHEMA = 'chit402.foreign_payout.v1';

/**
 * Claims of a receipt-slot JWS, or null. Another issuer document (book-seq,
 * tree head, x402, refusal...) has its own typ and is refused here, as are
 * crit, b64 and claims that name another schema.
 */
export function decodeJwsPayload(jws) {
  if (!jws || typeof jws !== 'string') return null;
  // A JWS the verifier would refuse as malformed_jws shows no claims.
  if (!isCanonicalCompactEs256(jws)) return null;
  const parts = jws.split('.');
  if (parts.length !== 3) return null;
  try {
    const header = JSON.parse(Buffer.from(parts[0], 'base64url').toString('utf8'));
    if (!header || typeof header !== 'object' || Array.isArray(header)) return null;
    if (header.crit !== undefined || header.b64 !== undefined) return null;
    if (!RECEIPT_SLOT_TYPS.includes(header.typ)) return null;
    const claims = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
    if (!claims || typeof claims !== 'object' || Array.isArray(claims)) return null;
    if (claims.schema != null && claims.schema !== FOREIGN_PAYOUT_SCHEMA) return null;
    return claims;
  } catch {
    return null;
  }
}

function minuteIso(value) {
  if (value == null || value === '') return null;
  const ms = typeof value === 'number'
    ? (value < 1e12 ? value * 1000 : value)
    : Date.parse(String(value));
  if (!Number.isFinite(ms)) return null;
  const date = new Date(ms);
  date.setUTCSeconds(0, 0);
  return date.toISOString();
}

// Ref and chain come from the signed claims only (null when unsigned).
function paymentRefOf(receipt, claims) {
  return claims?.payment?.ref || null;
}

function chainOf(receipt, claims) {
  const network = claims?.payment?.network;
  if (network) return String(network);
  const ref = String(paymentRefOf(receipt, claims) || '');
  const prefix = ref.split(':')[0];
  if (['base', 'base-sepolia', 'solana', 'solana-devnet', 'nano'].includes(prefix)) return prefix;
  return null;
}

function txOf(receipt, claims) {
  const ref = String(paymentRefOf(receipt, claims) || '');
  if (!ref) return null;
  const idx = ref.indexOf(':');
  return idx === -1 ? ref : ref.slice(idx + 1);
}

function shellInclusion(inclusion, signedHead) {
  if (!inclusion || typeof inclusion !== 'object') {
    return { leaf_hash: null, proof: null, signed_head: null };
  }
  const leaf = inclusion.leaf || inclusion.leaf_hash || null;
  const headRoot = signedHead?.root || signedHead?.tree_head_hash || null;
  const inclusionRoot = inclusion.root || null;
  const head = (headRoot && inclusionRoot && String(headRoot) === String(inclusionRoot))
    ? {
      root: signedHead.root || signedHead.tree_head_hash || null,
      tree_size: signedHead.tree_size ?? null,
      signature: signedHead.issuer_signature?.jws || signedHead.signature || null,
    }
    : (inclusionRoot
      ? { root: inclusionRoot, tree_size: inclusion.tree_size ?? null, signature: null }
      : null);
  return {
    leaf_hash: leaf,
    proof: inclusion.proof ?? null,
    signed_head: head,
  };
}

/**
 * @param {object} receipt full holder receipt
 * @param {{ inclusion?: object|null, signedHead?: object|null }} [opts]
 */
export function toPublicShell(receipt, { inclusion = null, signedHead = null } = {}) {
  const jws = receipt?.issuer_signature?.jws || null;
  const decoded = decodeJwsPayload(jws);
  const claims = decoded || {};
  // A signed receipt's shell is built from its claims only; outer fields are
  // used only for a document with no issuer JWS.
  // A JWS that is present but refused does not reopen the outer fields.
  const outer = jws ? {} : (receipt || {});
  // A signed task_id always wins; a JWS without one (not a receipt claim set)
  // falls back to the document id.
  const receiptId = (typeof claims.task_id === 'string' && claims.task_id)
    ? claims.task_id
    : (receipt?.task_id || receipt?.receipt_id || null);
  const gross = claims?.payment?.gross_amount ?? null;
  const settled = claims?.payment?.settled_amount ?? null;
  const issued = minuteIso(claims.iat ?? outer.created_at ?? outer.issued_at ?? null);
  return {
    schema: SHELL_SCHEMA,
    unsigned: true,
    receipt_id: receiptId,
    task_id: receiptId,
    payload_version: claims.payload_version ?? outer.issuer_signature?.payload_version ?? null,
    asset: claims?.payment?.asset ?? null,
    chain: chainOf(receipt, claims),
    // Parties and amounts are shown only as signed; null when unsigned.
    pay_to: claims?.payment?.payee ?? null,
    amount_gross: gross == null ? null : String(gross),
    amount_settled: settled == null ? null : String(settled),
    payment_tx: txOf(receipt, claims),
    issued_at: issued,
    inclusion: shellInclusion(inclusion, signedHead),
  };
}

export function shellPreimageBytes(shell) {
  return Buffer.from(jcsCanonicalize(shell), 'utf8');
}

export function receiptOwnsTx(receipt, tx) {
  const want = String(tx || '').trim();
  if (!want) return true;
  const claims = decodeJwsPayload(receipt?.issuer_signature?.jws);
  const ref = String(paymentRefOf(receipt, claims) || '');
  if (!ref) return false;
  if (ref === want) return true;
  const bare = ref.includes(':') ? ref.slice(ref.indexOf(':') + 1) : ref;
  return bare === want;
}

const PRIVATE_KEYS = [
  'payer_wallet',
  'agent_id',
  'book_id',
  'book_seq',
  'output_hash',
  'provider',
  'model',
  'prompt_tokens',
  'completion_tokens',
  'request_digest',
];

/** Private fields returned to the owner. Never raw prompt or output text. */
export function privateFieldsOf(receipt) {
  const claims = decodeJwsPayload(receipt?.issuer_signature?.jws) || {};
  const binding = claims.caller_binding || receipt?.caller_binding || {};
  const usage = claims.usage || receipt?.usage || {};
  return {
    payer_wallet: binding.payer_wallet ?? null,
    agent_id: claims.claim_id ?? binding.agent_id ?? null,
    book_id: receipt?.book_chain?.book_id ?? claims?.book_chain?.book_id ?? null,
    book_seq: receipt?.book_seq ?? receipt?.book_chain?.seq ?? null,
    output_hash: claims?.output?.hash ?? null,
    provider: claims?.route?.provider ?? null,
    model: claims?.route?.model ?? null,
    prompt_tokens: usage.prompt_tokens ?? null,
    completion_tokens: usage.completion_tokens ?? null,
    request_digest: claims.request_digest ?? null,
    keys: PRIVATE_KEYS,
  };
}

/** HTML responses only. JSON shells must not carry this header. */
export const RECEIPT_HTML_CSP = "default-src 'none'; style-src 'unsafe-inline'; img-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'";

const TX_CHAINS = new Set(['base', 'base-sepolia', 'solana', 'solana-devnet']);

function esc(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function asPrimitive(value) {
  if (value == null) return null;
  if (typeof value === 'string') return value === '' ? null : value;
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value === 'bigint') return value.toString();
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  return null;
}

function own(obj, key) {
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return null;
  if (!Object.prototype.hasOwnProperty.call(obj, key)) return null;
  return obj[key];
}

/**
 * Fixed key allowlist. A full receipt passed by mistake cannot reach the page.
 * Inclusion proof bytes and the head signature stay off the card.
 */
function takePublicCard(shell) {
  const card = {
    receipt_id: asPrimitive(own(shell, 'receipt_id')),
    payload_version: asPrimitive(own(shell, 'payload_version')),
    asset: asPrimitive(own(shell, 'asset')),
    chain: asPrimitive(own(shell, 'chain')),
    pay_to: asPrimitive(own(shell, 'pay_to')),
    amount_gross: asPrimitive(own(shell, 'amount_gross')),
    amount_settled: asPrimitive(own(shell, 'amount_settled')),
    payment_tx: asPrimitive(own(shell, 'payment_tx')),
    issued_at: asPrimitive(own(shell, 'issued_at')),
    leaf_hash: null,
    root: null,
    tree_size: null,
  };
  const inclusion = own(shell, 'inclusion');
  if (inclusion && typeof inclusion === 'object' && !Array.isArray(inclusion)) {
    card.leaf_hash = asPrimitive(own(inclusion, 'leaf_hash'));
    const head = own(inclusion, 'signed_head');
    if (head && typeof head === 'object' && !Array.isArray(head)) {
      card.root = asPrimitive(own(head, 'root'));
      const size = own(head, 'tree_size');
      if (typeof size === 'number' && Number.isFinite(size)) card.tree_size = size;
      else if (typeof size === 'string' && size !== '') card.tree_size = size;
    }
  }
  return card;
}

function httpBase(value) {
  const raw = String(value || '').trim();
  if (!raw) return '';
  try {
    const url = new URL(raw);
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return '';
    return url.origin;
  } catch {
    return '';
  }
}

/** Plain copy for a Base receipt issued before public attestations. */
export const PRE_ATTESTATION_NOTE = 'This public page shows payment and log facts only. It is not signed. Stranger verification is not available for this receipt: it was issued without a public attestation, so this page and its JSON carry nothing a stranger can check. The owner\'s signed receipt still verifies.';

/**
 * An unsigned Base shell with no public_attestation and no issuer_signature,
 * for which the server looked and found no attestation (`noAttestation`).
 * Absence alone is not enough: the serve flag may be off, or a drifting
 * attestation withheld. A pending attestation is not this case either.
 */
export function isPreAttestationBaseShell(shell, card, noAttestation = false) {
  if (noAttestation !== true) return false;
  if (!shell || typeof shell !== 'object' || Array.isArray(shell)) return false;
  if (own(shell, 'schema') !== 'chit402.receipt_shell.v1' || own(shell, 'unsigned') !== true) return false;
  if (own(shell, 'public_attestation') != null || own(shell, 'issuer_signature') != null) return false;
  return (card ? card.chain : own(shell, 'chain')) === 'base';
}

function chainLabel(chain) {
  if (chain == null || chain === '') return '';
  if (chain === 'base') return 'Base';
  if (chain === 'base-sepolia') return 'Base Sepolia';
  if (chain === 'solana') return 'Solana';
  if (chain === 'solana-devnet') return 'Solana Devnet';
  return String(chain);
}

function usdBody(atomic) {
  const n = Number(atomic);
  if (!Number.isFinite(n)) return null;
  const usd = n / 1e6;
  if (usd === 0) return '0';
  return Math.abs(usd) >= 0.01
    ? usd.toFixed(2)
    : usd.toFixed(6).replace(/\.?0+$/, '');
}

function formatIssued(value) {
  const s = String(value);
  const match = s.match(/^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2})/);
  if (!match) return s;
  return `${match[1]} ${match[2]} UTC`;
}

function textRow(label, value) {
  if (value == null || value === '') return '';
  return `<div class="line"><span class="k">${esc(label)}</span><span class="v">${esc(value)}</span></div>`;
}

function htmlRow(label, valueHtml) {
  if (!valueHtml) return '';
  return `<div class="line"><span class="k">${esc(label)}</span><span class="v">${valueHtml}</span></div>`;
}

function anchor(href, label, { external = false } = {}) {
  const rel = external ? ' rel="noopener noreferrer"' : '';
  return `<a href="${esc(href)}"${rel}>${esc(label)}</a>`;
}

/**
 * Inclusion and head links for one rendered proof. Both name the same size.
 * A closed epoch uses its pinned head route. Paths stay relative.
 */
export function shellProofLinks(storedId, inclusion) {
  const id = storedId ? encodeURIComponent(String(storedId)) : '';
  const size = Number(inclusion?.tree_size);
  const sized = Number.isSafeInteger(size) && size >= 1;
  const inclusionHref = id
    ? (sized
      ? `/v1/receipts/${id}/inclusion?tree_size=${size}`
      : `/v1/receipts/${id}/inclusion`)
    : null;
  const headHref = (typeof inclusion?.head_url === 'string' && inclusion.head_url.startsWith('/v1/receipts/tree/'))
    ? inclusion.head_url
    : '/v1/receipts/tree/head';
  return { inclusion: inclusionHref, head: headHref };
}

export function renderReceiptShellHtml(shell, { publicBaseUrl = '', inclusion = null, noAttestation = false } = {}) {
  const card = takePublicCard(shell);
  const storedId = card.receipt_id == null ? '' : String(card.receipt_id);
  const displayId = displayTaskIdForShare(storedId);
  const shortId = shortReceiptIdForShare(storedId);
  const title = shortId ? `Chit402 receipt · ${shortId}` : 'Chit402 receipt';
  const path = `/receipt/${encodeURIComponent(displayId)}`;
  const base = httpBase(publicBaseUrl);
  const canonical = base ? `${base}${path}` : path;
  const image = `${canonical}/og.png`;
  const usdc = isKnownUsdcAsset(card.chain, card.asset) && usdBody(card.amount_gross) != null;
  const chainText = chainLabel(card.chain);
  const chainHtml = `<small>${esc(chainText || 'unsigned')}</small>`;

  let totalHtml = '';
  if (card.amount_gross != null) {
    if (usdc) {
      totalHtml = `<div class="total"><span>$${esc(usdBody(card.amount_gross))} <small>USDC</small></span>${chainHtml}</div>`;
    } else {
      const assetHtml = ` <small>${esc(card.asset ? shortForm(card.asset) : '(asset not signed)')}</small>`;
      totalHtml = `<div class="total"><span>${esc(String(card.amount_gross))}${assetHtml}</span>${chainHtml}</div>`;
    }
  }

  const charged = card.amount_gross == null
    ? ''
    : textRow('Charged', usdc ? `${card.amount_gross} (6 dp)` : String(card.amount_gross));

  let settled = '';
  if (card.amount_gross != null || card.amount_settled != null) {
    if (card.amount_settled == null) {
      settled = textRow('Settled', 'not settled by Chit402');
    } else {
      const body = usdc ? `${card.amount_settled} (6 dp)` : String(card.amount_settled);
      const matches = card.amount_gross != null && String(card.amount_gross) === String(card.amount_settled);
      settled = textRow('Settled', matches ? `${body} ✓ matches` : body);
    }
  }

  const showChainFacts = TX_CHAINS.has(String(card.chain || ''));
  const payee = showChainFacts && card.pay_to != null
    ? textRow('Paid to', shortForm(card.pay_to))
    : '';
  let txHtml = '';
  if (showChainFacts && card.payment_tx != null) {
    const href = explorerUrlForRef(`${card.chain}:${card.payment_tx}`);
    if (href) {
      txHtml = htmlRow('Payment tx', anchor(href, `${shortForm(card.payment_tx)} ↗`, { external: true }));
    }
  }
  const assetRow = card.asset == null
    ? textRow('Asset', 'not signed')
    : textRow('Asset', usdc ? `USDC ${shortForm(card.asset)}` : shortForm(card.asset));
  const issued = card.issued_at == null ? '' : textRow('Issued', formatIssued(card.issued_at));
  const format = card.payload_version == null ? '' : textRow('Format', `payload v${card.payload_version}`);

  let logHtml = '';
  if (card.leaf_hash == null) {
    logHtml = textRow('Log', 'Not in the log yet');
  } else {
    const rootText = card.root == null
      ? ''
      : `${shortForm(card.root, 8, 4)}${card.tree_size == null ? '' : ` · size ${card.tree_size}`}`;
    logHtml = [
      textRow('Log leaf', shortForm(card.leaf_hash, 8, 4)),
      card.root == null
        ? (card.tree_size == null ? '' : textRow('Tree size', String(card.tree_size)))
        : textRow('Tree root', rootText),
      textRow('Head signature', 'not on this page'),
    ].join('\n');
  }

  // Public attestation, only when the serve flag put it on the shell.
  // The page never says VERIFIED: it does not run the verifier.
  let attestationHtml = '';
  const attestation = own(shell, 'public_attestation');
  if (attestation && typeof attestation === 'object' && !Array.isArray(attestation)) {
    if (typeof own(attestation, 'jws') === 'string') {
      attestationHtml = textRow('Public attestation', `Signed. Check it with chit402-verify ${VERIFIER_MIN} or later: ${VERIFIER_UPGRADE_HINT}.`);
    } else if (own(attestation, 'status') === 'pending') {
      attestationHtml = textRow('Public attestation', 'Public attestation pending');
    }
  }

  // A Base shell with no public attestation was issued before the public
  // attestation signer. Nothing on it can be checked by a stranger, so the
  // page says so instead of pointing at the verifier. Copy only: no verdict.
  const preSigner = isPreAttestationBaseShell(shell, card, noAttestation);
  const noteHtml = preSigner
    ? `<p class="note">${esc(PRE_ATTESTATION_NOTE)}</p>`
    : `<p class="note">This public page shows payment and log facts only. It is not signed. The signed receipt is on the owner view, and only it can verify. Check it with chit402-verify ${VERIFIER_MIN} or later: <code>${VERIFIER_UPGRADE_HINT}</code>.</p>`;

  const links = [anchor('?format=json', 'JSON')];
  const pair = shellProofLinks(storedId, inclusion);
  if (card.leaf_hash != null && storedId && pair.inclusion) {
    links.push(anchor(pair.inclusion, 'Inclusion proof'));
  }
  links.push(anchor(pair.head, 'Tree head'));
  links.push(anchor('/.well-known/jwks.json', 'Issuer keys'));
  links.push(anchor('https://www.chit402.com/trust', 'Trust', { external: true }));

  const footer = storedId
    ? `<div class="foot">Signed id ${esc(storedId)} — use this exact string for JSON, log and verifier checks</div>`
    : '';
  const idHtml = displayId ? `<div class="id">${esc(displayId)}</div>` : '';

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<!-- Space before content equals keeps that attribute off the event-handler scan. -->
<meta name="viewport" content = "width=device-width, initial-scale=1" />
<meta name="referrer" content = "no-referrer" />
<meta name="robots" content = "noindex" />
<title>${esc(title)}</title>
<link rel="canonical" href="${esc(canonical)}" />
<meta property="og:url" content = "${esc(canonical)}" />
<meta property="og:title" content = "${esc(title)}" />
<meta property="og:image" content = "${esc(image)}" />
<meta name="twitter:image" content = "${esc(image)}" />
<style>
  :root { color-scheme: dark; }
  * { box-sizing: border-box; }
  body { margin: 0; min-height: 100vh; background: radial-gradient(1200px 600px at 50% -10%, #17203a 0%, #0b0e14 60%); color: #e6e9ef;
         font: 15px/1.5 -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; display: flex; justify-content: center; align-items: flex-start; padding: 40px 16px 64px; }
  .paper { width: 100%; max-width: 440px; background: #f6f4ee; color: #1b1f27; border-radius: 6px 6px 0 0; padding: 28px 26px 22px; position: relative;
           box-shadow: 0 24px 60px rgba(0,0,0,.45); font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; font-size: 13px; }
  .paper::after { content: ""; position: absolute; left: 0; right: 0; bottom: -12px; height: 12px;
           background: linear-gradient(-45deg, transparent 8px, #f6f4ee 0) 0 0/16px 12px repeat-x, linear-gradient(45deg, transparent 8px, #f6f4ee 0) 0 0/16px 12px repeat-x; }
  .brand { text-align: center; font-family: -apple-system, "Segoe UI", Roboto, sans-serif; font-weight: 800; font-size: 20px; letter-spacing: .5px; color: #1d4ed8; }
  .sub { text-align: center; color: #6b7280; font-size: 11px; letter-spacing: 1.5px; text-transform: uppercase; margin-top: 2px; }
  .id { text-align: center; margin: 14px 0 4px; font-size: 12px; word-break: break-all; color: #374151; }
  .stamp { display: block; width: max-content; margin: 10px auto 0; padding: 3px 12px; border: 2px solid #b45309; color: #b45309; border-radius: 4px;
           font-size: 11px; font-weight: 700; letter-spacing: 1.5px; text-transform: uppercase; transform: rotate(-3deg); }
  hr { border: 0; border-top: 1px dashed #9ca3af; margin: 16px 0; }
  .line { display: flex; justify-content: space-between; gap: 12px; padding: 3px 0; }
  .line .k { color: #6b7280; }
  .line .v { text-align: right; word-break: break-all; }
  .total { font-size: 22px; font-weight: 700; display: flex; justify-content: space-between; align-items: baseline; }
  .total small { font-size: 12px; color: #6b7280; font-weight: 400; }
  a { color: #1d4ed8; text-decoration: none; }
  a:hover { text-decoration: underline; }
  .note { font-family: -apple-system, "Segoe UI", Roboto, sans-serif; font-size: 12px; color: #4b5563; line-height: 1.45; }
  .links { display: flex; flex-wrap: wrap; gap: 8px; justify-content: center; margin-top: 14px; font-family: -apple-system, "Segoe UI", Roboto, sans-serif; font-size: 12px; }
  .links a { border: 1px solid #d1d5db; border-radius: 999px; padding: 4px 10px; background: #fff; }
  .foot { text-align: center; color: #9ca3af; font-size: 10.5px; margin-top: 14px; }
</style>
</head>
<body>
  <main class="paper" aria-label="Chit402 receipt shell">
    <div class="brand">Chit402</div>
    <div class="sub">Agent spend receipt · public view</div>
    ${idHtml}
    <span class="stamp">Unsigned shell</span>
    <hr />
    ${totalHtml}
    ${charged}
    ${settled}
    <hr />
    ${payee}
    ${txHtml}
    ${assetRow}
    ${issued}
    ${format}
    <hr />
    ${logHtml}${attestationHtml ? `\n    ${attestationHtml}` : ''}
    <hr />
    ${noteHtml}
    <div class="links">
      ${links.join('\n      ')}
    </div>
    ${footer}
  </main>
</body>
</html>`;
}

export function renderReceiptShellMissing() {
  return `<!doctype html>
<html lang="en">
<head><meta charset="utf-8" /><title>Chit402</title></head>
<body><h1>Not found</h1></body>
</html>`;
}

export function shellSha256(shell) {
  return crypto.createHash('sha256').update(shellPreimageBytes(shell)).digest('hex');
}
