/**
 * Public receipt shell. Unsigned. The holder JWS stays on the owner view.
 * This module does not import the receipt issuer signer.
 */
import crypto from 'node:crypto';

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

export function decodeJwsPayload(jws) {
  if (!jws || typeof jws !== 'string') return null;
  const parts = jws.split('.');
  if (parts.length !== 3) return null;
  try {
    return JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
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

function paymentRefOf(receipt, claims) {
  return claims?.payment?.ref || receipt?.payment?.ref || null;
}

function chainOf(receipt, claims) {
  const network = receipt?.payment?.network || receipt?.payment_meta?.network || claims?.payment?.network;
  if (network) return String(network);
  const ref = String(paymentRefOf(receipt, claims) || '');
  const prefix = ref.split(':')[0];
  if (prefix === 'base' || prefix === 'solana') return prefix;
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
  const claims = decodeJwsPayload(jws) || {};
  const receiptId = receipt?.task_id || claims.task_id || receipt?.receipt_id || null;
  const gross = claims?.payment?.gross_amount ?? receipt?.payment?.gross_amount ?? null;
  const settled = claims?.payment?.settled_amount ?? receipt?.payment?.settled_amount ?? null;
  const issued = minuteIso(claims.iat ?? receipt?.created_at ?? receipt?.issued_at ?? null);
  return {
    schema: SHELL_SCHEMA,
    unsigned: true,
    receipt_id: receiptId,
    task_id: receiptId,
    payload_version: claims.payload_version ?? receipt?.issuer_signature?.payload_version ?? null,
    asset: claims?.payment?.asset || receipt?.payment?.asset || 'USDC',
    chain: chainOf(receipt, claims),
    pay_to: claims?.payment?.payee || receipt?.payment?.payee || null,
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

function esc(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

export function renderReceiptShellHtml(shell, { pageUrl = '' } = {}) {
  const id = esc(shell?.receipt_id || '');
  const amount = esc(shell?.amount_gross || '');
  const chain = esc(shell?.chain || '');
  const leaf = esc(shell?.inclusion?.leaf_hash || '');
  const title = `Chit402 · ${id}`;
  const ogImage = pageUrl ? `${String(pageUrl).replace(/\/$/, '')}/og.png` : '';
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<title>${title}</title>
<meta name="robots" content="noindex" />
${ogImage ? `<meta property="og:title" content="${title}" />
<meta property="og:image" content="${esc(ogImage)}" />
<meta name="twitter:image" content="${esc(ogImage)}" />` : ''}
</head>
<body>
  <h1>Receipt shell</h1>
  <p>${id}</p>
  <p>${amount} ${esc(shell?.asset || '')} · ${chain}</p>
  <p>Leaf ${leaf}</p>
  <p>Unsigned shell. The signature requires the owner view.</p>
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
