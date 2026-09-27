/**
 * Tier-1 receipt helpers that do not need ethers.
 *
 * HMAC verify lives here so a partner can check tamper-evidence without
 * importing `xfuel-sdk/onchain` (that entry hard-requires the ethers peer).
 * This is operator tamper-evidence, not a third-party settlement proof.
 * Keep the field list in lockstep with `canonicalSignedPayload` in
 * services/gateway/src/receipt.js.
 */

import { createHmac, createPublicKey, verify, KeyObject } from 'node:crypto';

export interface ReceiptSignatureCheck {
  /** Whether a signature was present to check. */
  checked: boolean;
  /** True if the recomputed HMAC matches; null when nothing was checked. */
  valid: boolean | null;
  expected?: string;
  recomputed?: string;
}

type ReceiptPayment = {
  rail?: string;
  ref?: string | null;
  gross_amount?: string | null;
  settled_amount?: string | null;
  net_amount?: string | null;
  fee_amount?: string | null;
  protocol_fee_bps?: number | null;
  fee_bps?: number | null;
  platform_fee?: string | null;
  platform_fee_bps?: number | null;
  accounting?: {
    internal_breakdown?: {
      route_margin_bps?: number | null;
      route_margin_amount?: string | null;
      receipt_floor_amount?: string | null;
      provider_cogs_amount?: string | null;
      tier2_proof_amount?: string | null;
    };
  } | null;
};

type CanonicalReceipt = {
  task_id?: string;
  payload_version?: number;
  payment?: ReceiptPayment;
  provider_cogs?: { actual?: string };
  route?: { model?: string; model_commitment?: { commitment?: string }; provider?: string };
  output?: { hash?: string };
  binding?: { expected_commitment?: string };
  caller_binding?: { payer_wallet?: string | null; agent_pubkey?: string | null; api_key_hash?: string | null };
  issuer_signature?: { payload_version?: number };
  hmac_attestation?: { payload_version?: number };
  signature?: { payload_version?: number; value?: string };
};

/**
 * HMAC payload version. <= 7 keeps the historical fee-split field list.
 * 8 matches the gateway: settled amount + internal accounting, not a 50 bps fee.
 */
export function canonicalPayloadVersion(receipt: Record<string, unknown>): number {
  const r = receipt as CanonicalReceipt;
  const stamped = r.hmac_attestation?.payload_version ?? r.signature?.payload_version;
  if (stamped != null) return Number(stamped);
  if (r.issuer_signature?.payload_version != null) return Number(r.issuer_signature.payload_version);
  if (r.payload_version != null) return Number(r.payload_version);
  const payment = r.payment;
  if (payment?.accounting || (payment && Object.prototype.hasOwnProperty.call(payment, 'settled_amount'))) {
    return 8;
  }
  return 7;
}

/**
 * Canonical, order-stable payload a receipt signature covers.
 * v8 matches `canonicalSignedPayload` in services/gateway/src/receipt.js.
 * v7 and earlier stay on the historical field list so old HMAC signatures verify.
 */
export function canonicalReceiptPayload(receipt: Record<string, unknown>): string {
  const r = receipt as CanonicalReceipt;
  if (canonicalPayloadVersion(receipt) >= 8) {
    const breakdown = r.payment?.accounting?.internal_breakdown;
    return JSON.stringify([
      r.task_id ?? null,
      r.payment?.rail ?? null,
      r.payment?.ref ?? null,
      r.payment?.gross_amount ?? null,
      r.payment?.settled_amount ?? null,
      breakdown?.route_margin_bps ?? null,
      breakdown?.route_margin_amount ?? null,
      breakdown?.receipt_floor_amount ?? null,
      breakdown?.provider_cogs_amount ?? null,
      breakdown?.tier2_proof_amount ?? null,
      r.provider_cogs?.actual ?? null,
      r.route?.model ?? null,
      r.route?.model_commitment?.commitment ?? null,
      r.route?.provider ?? null,
      r.output?.hash ?? null,
      r.binding?.expected_commitment ?? null,
      r.caller_binding?.payer_wallet ?? null,
      r.caller_binding?.agent_pubkey ?? null,
      r.caller_binding?.api_key_hash ?? null,
    ]);
  }
  return JSON.stringify([
    r.task_id ?? null,
    r.payment?.rail ?? null,
    r.payment?.ref ?? null,
    r.payment?.gross_amount ?? null,
    r.payment?.net_amount ?? null,
    r.payment?.fee_amount ?? null,
    r.payment?.protocol_fee_bps ?? r.payment?.fee_bps ?? null,
    r.payment?.platform_fee ?? null,
    r.payment?.platform_fee_bps ?? null,
    r.provider_cogs?.actual ?? null,
    r.route?.model ?? null,
    r.route?.model_commitment?.commitment ?? null,
    r.route?.provider ?? null,
    r.output?.hash ?? null,
    r.binding?.expected_commitment ?? null,
  ]);
}

/**
 * Verify a receipt's Tier-1 HMAC signature (tamper-evidence over the payment-bound tuple).
 * Requires the shared signing secret (server `RECEIPT_SIGNING_SECRET`).
 */
export function verifyReceiptSignature(
  receipt: Record<string, unknown>,
  secret: string,
): ReceiptSignatureCheck {
  const sig = (receipt as { signature?: { value?: string } }).signature;
  if (!sig?.value) return { checked: false, valid: null };
  const digest = createHmac('sha256', secret).update(canonicalReceiptPayload(receipt), 'utf8').digest('hex');
  const recomputed = `sha256=${digest}`;
  return {
    checked: true,
    valid: recomputed.toLowerCase() === String(sig.value).toLowerCase(),
    expected: sig.value,
    recomputed,
  };
}

/** Result of ECDSA signature verification. */
export interface ReceiptEcdsaCheck {
  /** Whether an issuer signature was present to check. */
  checked: boolean;
  /** True if the ECDSA signature is valid. */
  valid: boolean;
  /** Key ID from the signature. */
  kid?: string;
  /** Reason for failure when valid=false. */
  reason?: string;
}

/** JWK public key for ES256 verification. */
export interface Es256Jwk {
  kty: 'EC';
  crv: 'P-256';
  x: string;
  y: string;
  kid?: string;
  alg?: string;
  use?: string;
}

/** JWKS (JSON Web Key Set) structure. */
export interface Jwks {
  keys: Es256Jwk[];
}

/**
 * Verify a receipt's ECDSA issuer signature against a JWK (public key).
 * This is the public-key verification path — no shared secret required.
 *
 * Verification steps:
 *   1. GET /receipt/:taskId?format=json → receipt.issuer_signature
 *   2. GET /.well-known/jwks.json → find key matching issuer_signature.kid
 *   3. ES256 verify canonicalReceiptPayload(receipt) against the signature
 *
 * @param receipt - Receipt JSON with issuer_signature
 * @param jwk - JWK public key { kty: 'EC', crv: 'P-256', x, y }
 */
export function verifyReceiptEcdsa(
  receipt: Record<string, unknown>,
  jwk: Es256Jwk,
): ReceiptEcdsaCheck {
  const sig = (receipt as { issuer_signature?: { value?: string; alg?: string; kid?: string } }).issuer_signature;
  if (!sig || !sig.value) {
    return { checked: false, valid: false, reason: 'no_issuer_signature' };
  }
  if (sig.alg !== 'ES256') {
    return { checked: false, valid: false, reason: `unsupported_alg: ${sig.alg}` };
  }
  if (!jwk || jwk.kty !== 'EC' || jwk.crv !== 'P-256') {
    return { checked: false, valid: false, reason: 'invalid_jwk' };
  }
  if (sig.kid && jwk.kid && sig.kid !== jwk.kid) {
    return { checked: false, valid: false, reason: 'kid_mismatch' };
  }

  try {
    // JWK structure validated above; cast to satisfy Node crypto's expected type
    const jwkInput = { kty: jwk.kty, crv: jwk.crv, x: jwk.x, y: jwk.y } as const;
    const publicKey: KeyObject = createPublicKey({ key: jwkInput, format: 'jwk' });
    const signature = Buffer.from(sig.value, 'base64url');
    const payload = canonicalReceiptPayload(receipt);
    const valid = verify('sha256', Buffer.from(payload, 'utf8'), {
      key: publicKey,
      dsaEncoding: 'ieee-p1363',
    }, signature);
    return { checked: true, valid, kid: sig.kid };
  } catch (err) {
    return { checked: true, valid: false, kid: sig.kid, reason: `verify_error: ${(err as Error).message}` };
  }
}

/**
 * Verify a receipt's ECDSA issuer signature against a JWKS (key set).
 * Finds the matching key by kid and verifies.
 *
 * @param receipt - Receipt JSON with issuer_signature
 * @param jwks - JWKS with keys array
 */
export function verifyReceiptEcdsaWithJwks(
  receipt: Record<string, unknown>,
  jwks: Jwks,
): ReceiptEcdsaCheck {
  const sig = (receipt as { issuer_signature?: { value?: string; kid?: string } }).issuer_signature;
  if (!sig || !sig.value) {
    return { checked: false, valid: false, reason: 'no_issuer_signature' };
  }
  if (!jwks || !Array.isArray(jwks.keys) || jwks.keys.length === 0) {
    return { checked: false, valid: false, reason: 'empty_jwks' };
  }

  // Find matching key by kid, or try all ES256 keys if no kid on signature
  const candidates = sig.kid
    ? jwks.keys.filter(k => k.kid === sig.kid && k.alg === 'ES256')
    : jwks.keys.filter(k => k.alg === 'ES256');

  if (candidates.length === 0) {
    return { checked: false, valid: false, reason: 'no_matching_key' };
  }

  for (const jwk of candidates) {
    const result = verifyReceiptEcdsa(receipt, jwk);
    if (result.valid) {
      return result;
    }
  }
  return { checked: true, valid: false, reason: 'signature_invalid' };
}
