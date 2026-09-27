#!/usr/bin/env node
/**
 * verify-receipt.mjs — Offline XFuel receipt verification
 *
 * Verifies an XFuel receipt HMAC signature without hitting the API.
 * Use this when XFuel is unavailable or you want independent verification.
 *
 * Usage:
 *   node verify-receipt.mjs <receipt.json> <secret>
 *   node verify-receipt.mjs <receipt.json> <primary-secret> <co-signer-secret>
 *
 * Exit codes:
 *   0 — receipt is valid (verified by at least one key)
 *   1 — receipt is invalid or no signature found
 *
 * See docs/VERIFY_ALGORITHM.md for the full specification.
 * For on-chain payer match (Base/Solana): scripts/verify-receipt-payer.mjs
 */

import { createHmac, timingSafeEqual } from 'node:crypto';
import { readFileSync } from 'node:fs';

/**
 * HMAC payload version. <= 7 uses the historical fee-split list.
 * 8 matches services/gateway/src/receipt.js canonicalFieldsV8.
 * @param {object} r
 * @returns {number}
 */
function canonicalPayloadVersion(r) {
  const stamped = r?.hmac_attestation?.payload_version
    ?? r?.signature?.payload_version
    ?? r?.co_attestation?.payload_version
    ?? r?.co_signature?.payload_version;
  if (stamped != null && stamped !== '') return Number(stamped);
  if (r?.issuer_signature?.payload_version != null) return Number(r.issuer_signature.payload_version);
  if (r?.payment?.accounting || (r?.payment && Object.prototype.hasOwnProperty.call(r.payment, 'settled_amount'))) {
    return 8;
  }
  return 7;
}

/**
 * Build the canonical signed payload.
 * v8 is identical to receipt.js. v7 stays on the historical public field list
 * so receipts already signed at payload_version <= 7 still verify.
 * @param {object} r - receipt object
 * @returns {string}
 */
function canonicalPayload(r) {
  if (canonicalPayloadVersion(r) >= 8) {
    const b = r.payment?.accounting?.internal_breakdown;
    return JSON.stringify([
      r.task_id ?? null,
      r.payment?.rail ?? null,
      r.payment?.ref ?? null,
      r.payment?.gross_amount ?? null,
      r.payment?.settled_amount ?? null,
      b?.route_margin_bps ?? null,
      b?.route_margin_amount ?? null,
      b?.receipt_floor_amount ?? null,
      b?.provider_cogs_amount ?? null,
      b?.tier2_proof_amount ?? null,
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
    r.task_id,
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
 * Verify an HMAC signature on a receipt.
 * @param {object} receipt
 * @param {string} secret
 * @param {string} [sigField='signature'] — 'signature' or 'co_signature'
 * @returns {{ valid: boolean, expected?: string, computed?: string, reason?: string }}
 */
function verifySingle(receipt, secret, sigField = 'signature') {
  if (!secret || typeof secret !== 'string') {
    return { valid: false, reason: 'no_verify_key' };
  }
  const sigObj = receipt?.[sigField];
  const sig = sigObj?.value;
  if (!sig) {
    return { valid: false, reason: 'no_signature' };
  }

  const expected = sig.replace(/^sha256=/, '');
  const computed = createHmac('sha256', secret)
    .update(canonicalPayload(receipt))
    .digest('hex');

  const a = Buffer.from(expected.toLowerCase());
  const b = Buffer.from(computed.toLowerCase());
  const valid = a.length === b.length && timingSafeEqual(a, b);

  return { valid, expected, computed, role: sigObj?.role || sigField };
}

/**
 * Verify against multiple secrets, either signature field.
 * @param {object} receipt
 * @param {string[]} secrets
 * @returns {{ valid: boolean, validatedBy?: string, role?: string, reason?: string }}
 */
function verifyMulti(receipt, secrets) {
  const fields = ['signature', 'co_signature'].filter(f => receipt?.[f]?.value);
  if (fields.length === 0) {
    return { valid: false, reason: 'no_signature' };
  }
  for (const secret of secrets) {
    if (!secret) continue;
    for (const field of fields) {
      const result = verifySingle(receipt, secret, field);
      if (result.valid) {
        return { valid: true, validatedBy: field, role: result.role };
      }
    }
  }
  return { valid: false, reason: 'all_keys_failed' };
}

// ─── CLI entry point ─────────────────────────────────────────────────────────

const args = process.argv.slice(2);
if (args.length < 2) {
  console.error(`
XFuel Receipt Verifier — offline HMAC verification

Usage:
  node verify-receipt.mjs <receipt.json> <secret>
  node verify-receipt.mjs <receipt.json> <primary> <co-signer>

Arguments:
  receipt.json   Path to a JSON file containing the receipt
  secret(s)      One or more HMAC secrets to try

Exit codes:
  0  Valid (verified by at least one key)
  1  Invalid or no signature found

See docs/VERIFY_ALGORITHM.md for the full specification.
`);
  process.exit(1);
}

const [receiptPath, ...secrets] = args;

let receipt;
try {
  receipt = JSON.parse(readFileSync(receiptPath, 'utf8'));
} catch (err) {
  console.error(`Error reading receipt: ${err.message}`);
  process.exit(1);
}

console.log(`Task ID: ${receipt.task_id}`);
console.log(`Payment: ${receipt.payment?.rail} ${receipt.payment?.gross_amount} → ${receipt.payment?.ref || 'none'}`);
console.log(`Model:   ${receipt.route?.model || 'unknown'}`);
console.log(`Output:  ${receipt.output?.hash?.slice(0, 20) || 'none'}...`);
console.log();

const result = verifyMulti(receipt, secrets);

if (result.valid) {
  console.log(`✓ VALID — verified by ${result.validatedBy} (${result.role})`);
  process.exit(0);
} else {
  console.log(`✗ INVALID — ${result.reason}`);
  if (result.reason === 'all_keys_failed') {
    console.log('  None of the provided secrets matched any signature.');
  }
  process.exit(1);
}
