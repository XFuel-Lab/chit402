/**
 * Signed refusal document (chit402.refusal.v1).
 *
 * A policy or cap refusal is not a payment receipt. This document is a
 * separate ES256 JWS from the same issuer key, so a verifier can check it
 * against /.well-known/jwks.json. Payment receipt payload versions are
 * unchanged.
 *
 * What the signature proves: the issuer refused, at this anchor, for this
 * refusal_code, and joined that decision to the named policy_blocked book
 * row. charged is false.
 *
 * What it does not prove: a payment, a settlement, a balance change, that
 * the block still stands after a reorg, that the rule was the right rule,
 * or that amount_requested would have been the settled price. UNAVAILABLE
 * means the issuer had no block. verify_url is not inside the signature.
 */
import crypto from 'crypto';
import { signJws, verifyJwsWithJwks, getIssuerPublicKeyJwk, getJwks } from './issuer-key.js';
import { withPublicPreimages } from './receipt-preimage.js';
import { REFUSAL_CANONICAL_FIELDS, sealCanonicalObject } from './canonical-preimage.js';
import { currentHistoryPin } from './issuer-history.js';

export const REFUSAL_SCHEMA = 'chit402.refusal.v1';
/** Versions a verifier accepts. Version 1 has no history pin. */
export const REFUSAL_PAYLOAD_VERSIONS = Object.freeze([1, 2]);
/** New refusals. Version 1 still verifies. */
export const REFUSAL_PAYLOAD_VERSION = 2;
export const REFUSAL_JWT_TYP = 'chit402-refusal+jwt';

export const REFUSAL_PROVES = [
  'The issuer signed that it refused this spend.',
  'refusal_code is the code the issuer recorded.',
  'nonce identifies this refusal document.',
  'chain_id and anchor are the Base observation at refusal time. status UNAVAILABLE means the issuer had no block.',
  'When status is observed, block_number and block_hash are that block. state_root is copied only when the RPC returned one; otherwise it is null.',
  'book_row.seq, task_id, and row_hash name the policy_blocked row this refusal joins.',
  'charged is false and amount_charged is 0. This refusal took no USDC.',
];

export const REFUSAL_DOES_NOT_PROVE = [
  'It does not prove a payment, a settlement, or a balance change.',
  'It does not prove the refused spend would have landed in that block.',
  'It does not prove a later reorg left the block hash or state root in place.',
  'UNAVAILABLE means the issuer did not have a block. It does not mean the chain was empty.',
  'It does not prove the policy rule was the right rule. It proves the issuer refused under that code.',
  'It does not prove amount_requested would have been the settled price.',
  'It is not a payment receipt. A payment verifier must not treat it as proof of spend.',
  'verify_url is not inside the signature.',
];

function esc(value) {
  return String(value ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function textOrNull(value) {
  if (value == null) return null;
  const text = String(value).trim();
  return text ? text : null;
}

/**
 * Stable anchor claims. state_root stays null when the observation did not
 * include one. UNAVAILABLE is explicit; missing fields are not invented.
 * @param {object|null|undefined} anchor
 */
export function refusalAnchorClaims(anchor) {
  const observed = anchor?.status === 'observed';
  const stateRoot = observed && typeof anchor.state_root === 'string' && /^0x[0-9a-fA-F]{64}$/.test(anchor.state_root)
    ? anchor.state_root
    : null;
  const chainId = observed && Number.isInteger(anchor.chain_id) ? anchor.chain_id : null;
  return {
    status: observed ? 'observed' : 'UNAVAILABLE',
    rail: 'base',
    chain_id: chainId,
    block_number: observed && anchor.block_number != null ? String(anchor.block_number) : null,
    block_hash: observed && anchor.block_hash ? String(anchor.block_hash) : null,
    state_root: stateRoot,
    observed_at: anchor?.observed_at || null,
    reason: observed ? null : (anchor?.reason || 'no_observation'),
  };
}

/**
 * Sign a refusal for a policy_blocked row that already has seq and row_hash.
 * @param {object} row
 */
export function issueRefusalReceipt(row) {
  const anchor = refusalAnchorClaims(row?.anchor);
  const refusalId = `rfs-${crypto.randomBytes(8).toString('hex')}`;
  const nonce = crypto.randomBytes(16).toString('hex');
  const amount = textOrNull(row?.amount_requested);
  const claims = {
    schema: REFUSAL_SCHEMA,
    payload_version: REFUSAL_PAYLOAD_VERSION,
    kind: 'refusal',
    refusal_id: refusalId,
    nonce,
    issued_at: row?.collected_at || row?.recorded_at || new Date().toISOString(),
    refusal_code: String(row?.policy_code || 'policy_blocked'),
    reason: row?.reason != null ? String(row.reason) : null,
    agent_id: Number(row.agent_id),
    book_id: Number(row.agent_id),
    task_id: String(row.task_id),
    intent_id: row?.intent_id || null,
    attempt_index: row?.attempt_index != null ? Number(row.attempt_index) : null,
    amount_requested: amount,
    asset: amount != null ? 'USDC' : null,
    model: row?.model || null,
    hub: row?.hub || null,
    policy_key: row?.policy_key || null,
    spent_atomic: row?.spent_atomic != null ? String(row.spent_atomic) : null,
    cap_atomic: row?.cap_atomic != null ? String(row.cap_atomic) : null,
    period_start: row?.period_start || null,
    chain_id: anchor.chain_id,
    anchor,
    book_row: {
      task_id: String(row.task_id),
      seq: Number(row.seq),
      prev_hash: row.prev_hash || null,
      row_hash: row.row_hash,
      event: 'policy_blocked',
    },
    charged: false,
    amount_charged: '0',
    issuer_history: currentHistoryPin(),
  };
  const sealed = sealCanonicalObject(claims, REFUSAL_CANONICAL_FIELDS);
  const { jws, kid } = signJws(sealed.claims, { typ: REFUSAL_JWT_TYP });
  return {
    ...sealed.claims,
    issuer_signature: {
      alg: 'ES256',
      typ: REFUSAL_JWT_TYP,
      payload_version: REFUSAL_PAYLOAD_VERSION,
      jws,
      kid,
      issuer_jwk: getIssuerPublicKeyJwk(),
      hash_alg: sealed.hash_alg,
      payload_hash: sealed.payload_hash,
      canonical_preimage: sealed.preimage,
    },
    canonical_preimage: sealed.preimage,
    verify_url: null,
  };
}

export function refusalVerifyUrl(baseUrl, refusalId) {
  const base = baseUrl ? String(baseUrl).replace(/\/$/, '') : '';
  return `${base}/refusal/${encodeURIComponent(String(refusalId))}`;
}

/** Copy with an absolute verify_url. The URL is not part of the signature. */
export function presentRefusal(doc, baseUrl) {
  if (!doc || typeof doc !== 'object' || !doc.refusal_id) return null;
  return withPublicPreimages({
    ...doc,
    verify_url: refusalVerifyUrl(baseUrl, doc.refusal_id),
  }, { baseUrl });
}

/**
 * Attach the public refusal to a response body.
 * When `error` is an object, refusal_id and verify_url are added there.
 * When `error` is a string, those fields stay beside it.
 * @param {object} body
 * @param {object|null|undefined} entry ledger row
 * @param {string} [baseUrl]
 */
export function withRefusal(body, entry, baseUrl = '') {
  const refusal = presentRefusal(entry?.refusal, baseUrl);
  if (!refusal) return body;
  const next = { ...body, refusal };
  if (body?.error && typeof body.error === 'object') {
    next.error = {
      ...body.error,
      refusal_id: refusal.refusal_id,
      verify_url: refusal.verify_url,
    };
  } else {
    next.refusal_id = refusal.refusal_id;
    next.verify_url = refusal.verify_url;
  }
  return next;
}

function same(left, right) {
  return left === right;
}

function anchorSame(outer, signed) {
  if (!outer || !signed || typeof outer !== 'object' || typeof signed !== 'object') return false;
  return same(outer.status, signed.status)
    && same(outer.rail, signed.rail)
    && same(outer.chain_id, signed.chain_id)
    && same(outer.block_number, signed.block_number)
    && same(outer.block_hash, signed.block_hash)
    && same(outer.state_root, signed.state_root);
}

function jwsPayloadSchema(jws) {
  if (!jws || typeof jws !== 'string') return null;
  const payloadB64 = jws.split('.')[1];
  if (!payloadB64) return null;
  try {
    const payload = JSON.parse(Buffer.from(payloadB64, 'base64url').toString('utf8'));
    return typeof payload?.schema === 'string' ? payload.schema : null;
  } catch {
    return null;
  }
}

function bookRowSame(outer, signed) {
  if (!outer || !signed || typeof outer !== 'object' || typeof signed !== 'object') return false;
  return same(outer.task_id, signed.task_id)
    && Number(outer.seq) === Number(signed.seq)
    && same(outer.prev_hash || null, signed.prev_hash || null)
    && same(outer.row_hash, signed.row_hash)
    && same(outer.event, signed.event);
}

/**
 * Verify a refusal document against a JWKS. Default JWKS is this process's
 * issuer key. Changing refusal_code or nonce on the outer document fails.
 * Rewriting those fields inside the JWS payload fails the signature.
 * @param {object} doc
 * @param {{ keys: object[] }|null} [jwks]
 */
export function verifyRefusalReceipt(doc, jwks = null) {
  if (!doc || typeof doc !== 'object') {
    return { checked: false, valid: false, reason: 'not_a_refusal' };
  }
  const sig = doc.issuer_signature;
  if (!sig?.jws) return { checked: false, valid: false, reason: 'no_signature' };
  const peeked = jwsPayloadSchema(sig.jws);
  if (doc.schema !== REFUSAL_SCHEMA && peeked !== REFUSAL_SCHEMA) {
    return { checked: false, valid: false, reason: 'not_a_refusal' };
  }
  const result = verifyJwsWithJwks(sig.jws, jwks || getJwks());
  if (!result.valid) {
    return { checked: true, valid: false, reason: result.reason || 'signature_invalid', kid: sig.kid || null };
  }
  const payload = result.payload || {};
  if (payload.schema !== REFUSAL_SCHEMA || (doc.schema != null && doc.schema !== payload.schema)) {
    return { checked: true, valid: false, reason: 'schema_mismatch', payload };
  }
  const version = Number(payload.payload_version);
  if (!REFUSAL_PAYLOAD_VERSIONS.includes(version) || Number(doc.payload_version) !== version) {
    return { checked: true, valid: false, reason: 'payload_version_mismatch', payload };
  }
  if (version >= 2) {
    const pin = payload.issuer_history;
    if (!pin || typeof pin.hash !== 'string' || pin.version == null || pin.seq == null) {
      return { checked: true, valid: false, reason: 'issuer_history_pin_missing', payload };
    }
    if (typeof payload.payload_hash !== 'string' || !/^[0-9a-f]{64}$/.test(payload.payload_hash)) {
      return { checked: true, valid: false, reason: 'payload_hash_missing', payload };
    }
    if (typeof doc.canonical_preimage === 'string') {
      const digest = crypto.createHash('sha256').update(doc.canonical_preimage, 'utf8').digest('hex');
      if (digest !== payload.payload_hash) {
        return { checked: true, valid: false, reason: 'payload_hash_mismatch', payload };
      }
    }
  }
  if (payload.kind !== 'refusal') {
    return { checked: true, valid: false, reason: 'kind_mismatch', payload };
  }
  if (payload.charged !== false || payload.amount_charged !== '0'
    || doc.charged !== false || doc.amount_charged !== '0') {
    return { checked: true, valid: false, reason: 'charged_not_zero', payload };
  }
  if (!same(doc.refusal_code, payload.refusal_code)) {
    return { checked: true, valid: false, reason: 'refusal_code_mismatch', payload };
  }
  if (!same(doc.nonce, payload.nonce)) {
    return { checked: true, valid: false, reason: 'nonce_mismatch', payload };
  }
  if (!same(doc.refusal_id, payload.refusal_id)) {
    return { checked: true, valid: false, reason: 'refusal_id_mismatch', payload };
  }
  if (!same(doc.chain_id ?? null, payload.chain_id ?? null)) {
    return { checked: true, valid: false, reason: 'chain_id_mismatch', payload };
  }
  if (!same(doc.task_id, payload.task_id) || Number(doc.agent_id) !== Number(payload.agent_id)
    || Number(doc.book_id) !== Number(payload.book_id)) {
    return { checked: true, valid: false, reason: 'identity_mismatch', payload };
  }
  if (!same(doc.issued_at, payload.issued_at)) {
    return { checked: true, valid: false, reason: 'issued_at_mismatch', payload };
  }
  if (!same(doc.amount_requested ?? null, payload.amount_requested ?? null)) {
    return { checked: true, valid: false, reason: 'amount_mismatch', payload };
  }
  if (!anchorSame(doc.anchor, payload.anchor)) {
    return { checked: true, valid: false, reason: 'anchor_mismatch', payload };
  }
  if (!bookRowSame(doc.book_row, payload.book_row)) {
    return { checked: true, valid: false, reason: 'book_row_mismatch', payload };
  }
  return {
    checked: true,
    valid: true,
    payload,
    kid: result.kid || sig.kid || null,
    refusal_id: payload.refusal_id,
    refusal_code: payload.refusal_code,
    nonce: payload.nonce,
  };
}

function anchorLine(anchor) {
  if (!anchor) return '—';
  if (anchor.status !== 'observed') return `UNAVAILABLE (${anchor.reason || 'no block'})`;
  const root = anchor.state_root ? ` state_root ${anchor.state_root}` : ' state_root null';
  return `base ${anchor.chain_id} #${anchor.block_number} ${anchor.block_hash}${root}`;
}

export function renderRefusalHtml(doc) {
  const proves = REFUSAL_PROVES.map((line) => `<li>${esc(line)}</li>`).join('');
  const limits = REFUSAL_DOES_NOT_PROVE.map((line) => `<li>${esc(line)}</li>`).join('');
  const anchor = doc?.anchor;
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <title>Refusal ${esc(doc?.refusal_id || '')}</title>
  <meta name="robots" content="noindex">
  <style>
    body { font: 15px/1.45 ui-sans-serif, system-ui, sans-serif; margin: 32px auto; max-width: 720px; color: #1c1917; }
    code { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 13px; word-break: break-all; }
    h1 { font-size: 22px; margin-bottom: 4px; }
    .muted { color: #57534e; }
    dt { margin-top: 10px; font-size: 12px; letter-spacing: .04em; text-transform: uppercase; color: #78716c; }
    dd { margin: 2px 0 0; }
  </style>
</head>
<body>
  <p class="muted">chit402.refusal.v1 · payload version ${esc(doc?.payload_version ?? REFUSAL_PAYLOAD_VERSION)} · no USDC charged</p>
  <h1>Refusal ${esc(doc?.refusal_code || '')}</h1>
  <p>The issuer signed that it refused this spend. This is not a payment receipt.</p>
  <dl>
    <dt>Refusal id</dt><dd><code>${esc(doc?.refusal_id)}</code></dd>
    <dt>Nonce</dt><dd><code>${esc(doc?.nonce)}</code></dd>
    <dt>Issued</dt><dd><code>${esc(doc?.issued_at)}</code></dd>
    <dt>Agent / book</dt><dd><code>${esc(doc?.agent_id)}</code></dd>
    <dt>Book row</dt><dd><code>seq ${esc(doc?.book_row?.seq)} · ${esc(doc?.book_row?.task_id)}</code></dd>
    <dt>Amount requested</dt><dd><code>${esc(doc?.amount_requested ?? 'null')}</code> charged <code>0</code></dd>
    <dt>Chain</dt><dd><code>${esc(anchorLine(anchor))}</code></dd>
    <dt>Reason</dt><dd>${esc(doc?.reason || '')}</dd>
  </dl>
  <h2>What this proves</h2>
  <ul>${proves}</ul>
  <h2>What this does not prove</h2>
  <ul>${limits}</ul>
  <p class="muted">Verify the ES256 JWS against <a href="/.well-known/jwks.json">/.well-known/jwks.json</a>. <code>xfuel-verify</code> accepts this schema.</p>
</body>
</html>`;
}

export function renderRefusalNotFound(id) {
  return `<!DOCTYPE html>
<html lang="en">
<head><meta charset="utf-8"><title>Refusal not found</title></head>
<body>
  <h1>Refusal not found</h1>
  <p>No signed refusal is stored for <code>${esc(id)}</code>.</p>
</body>
</html>`;
}
