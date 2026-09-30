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
 *   node verify-receipt.mjs <receipt.json> <secret> --head head.json --rpc <base-rpc>
 *
 * The anchor clock check reads the anchor transaction's block time and
 * compares it with the head's published_at. Without --rpc that check is
 * skipped, not passed. --solana-rpc checks anchors.solana the same way.
 *
 * Exit codes:
 *   0 — receipt is valid (verified by at least one key) and the clock check
 *       passed or was skipped
 *   1 — receipt is invalid, no signature found, or anchor_clock_drift
 *
 * See docs/VERIFY_ALGORITHM.md for the full specification.
 * For on-chain payer match (Base/Solana): scripts/verify-receipt-payer.mjs
 */

import { createHmac, timingSafeEqual } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  assessInclusion,
  formatAnchorClock,
  verifyAnchorClock,
  receiptTimestampSeconds,
} from '../src/receipt-anchor-clock.js';
import { leafHash, verifyInclusion, verifyTreeHead } from '../src/receipt-merkle.js';

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

const HELP = `
XFuel Receipt Verifier — offline HMAC verification

Usage:
  node verify-receipt.mjs <receipt.json> <secret>
  node verify-receipt.mjs <receipt.json> <primary> <co-signer>
  node verify-receipt.mjs <receipt.json> <secret> --head head.json --rpc <base-rpc>

Arguments:
  receipt.json   Path to a JSON file containing the receipt
  secret(s)      One or more HMAC secrets to try

Options:
  --head <file>       Signed tree head (chit402.tree_head.v1). Also read from
                      receipt.tree_head or receipt.head when present.
  --rpc <url>         Base RPC. Fetches the anchor tx block time. Without this
                      flag the clock check is skipped, not passed.
  --solana-rpc <url>  Solana RPC for anchors.solana. Same skip rule.

Exit codes:
  0  Valid (verified by at least one key) and the clock check passed or was skipped
  1  Invalid, no signature found, or anchor_clock_drift

See docs/VERIFY_ALGORITHM.md for the full specification.
`;

export function parseVerifierArgs(argv) {
  const out = {
    positionals: [],
    headPath: null,
    sawRpc: false,
    rpcUrl: null,
    solanaRpcUrl: null,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--head' && argv[i + 1]) {
      out.headPath = argv[++i];
    } else if (arg === '--rpc') {
      out.sawRpc = true;
      const next = argv[i + 1];
      if (next && !next.startsWith('-')) out.rpcUrl = argv[++i];
      else out.rpcUrl = process.env.BASE_RPC_URL || process.env.SETTLEMENT_RPC_URL || null;
    } else if (arg === '--solana-rpc') {
      out.sawRpc = true;
      const next = argv[i + 1];
      if (next && !next.startsWith('-')) out.solanaRpcUrl = argv[++i];
      else out.solanaRpcUrl = process.env.SOLANA_RPC_URL || null;
    } else if (!arg.startsWith('-')) {
      out.positionals.push(arg);
    }
  }
  return out;
}

function readJson(file) {
  return JSON.parse(readFileSync(file, 'utf8'));
}

function jwksFor(head) {
  const jwk = head?.issuer_signature?.issuer_jwk;
  if (jwk) return { keys: [jwk] };
  return null;
}

async function runCli(argv) {
  const args = parseVerifierArgs(argv);
  if (args.positionals.length < 2) {
    console.error(HELP);
    return 1;
  }
  const [receiptPath, ...secrets] = args.positionals;

  let receipt;
  try {
    receipt = readJson(receiptPath);
  } catch (err) {
    console.error(`Error reading receipt: ${err.message}`);
    return 1;
  }

  let head = receipt.tree_head || receipt.head || null;
  if (args.headPath) {
    try {
      head = readJson(args.headPath);
    } catch (err) {
      console.error(`Error reading tree head: ${err.message}`);
      return 1;
    }
  }

  console.log(`Task ID: ${receipt.task_id}`);
  console.log(`Payment: ${receipt.payment?.rail} ${receipt.payment?.gross_amount} → ${receipt.payment?.ref || 'none'}`);
  console.log(`Model:   ${receipt.route?.model || 'unknown'}`);
  console.log(`Output:  ${receipt.output?.hash?.slice(0, 20) || 'none'}...`);
  console.log();

  const result = verifyMulti(receipt, secrets);
  if (result.valid) {
    console.log(`✓ VALID — verified by ${result.validatedBy} (${result.role})`);
  } else {
    console.log(`✗ INVALID — ${result.reason}`);
    if (result.reason === 'all_keys_failed') {
      console.log('  None of the provided secrets matched any signature.');
    }
  }

  let clockFailed = false;
  if (head || args.sawRpc) {
    const verified = head ? verifyTreeHead(head, jwksFor(head)) : null;
    const inclusion = receipt.inclusion || null;
    const proof = assessInclusion({
      receipt,
      inclusion,
      head,
      verifyInclusion,
      leafHash,
    });
    const clock = await verifyAnchorClock({
      head,
      signedPayload: verified?.valid ? verified.payload : null,
      signatureValid: head ? Boolean(verified?.valid) : true,
      signatureReason: verified?.reason || null,
      enabled: args.sawRpc,
      rpcUrl: args.rpcUrl,
      solanaRpcUrl: args.solanaRpcUrl,
      receiptTs: receiptTimestampSeconds(receipt),
      proven: args.sawRpc ? proof.proven : null,
    });
    console.log(formatAnchorClock(clock));
    clockFailed = clock.status === 'failed';
  }

  if (!result.valid || clockFailed) return 1;
  return 0;
}

const isMain = process.argv[1]
  && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;
if (isMain) {
  runCli(process.argv.slice(2)).then((code) => process.exit(code));
}
