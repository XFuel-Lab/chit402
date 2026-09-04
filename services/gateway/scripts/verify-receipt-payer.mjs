#!/usr/bin/env node
/**
 * verify-receipt-payer.mjs — Offline payer binding verification
 *
 * Confirms caller_binding.payer_wallet against payment.ref on-chain:
 *   - Base: USDC Transfer sender (EIP-3009 transferWithAuthorization)
 *   - Solana: USDC SPL transfer authority (x402 exact-svm)
 *
 * Usage:
 *   node verify-receipt-payer.mjs <receipt.json>
 *   node verify-receipt-payer.mjs <receipt.json> --solana-rpc <url>
 *
 * Requires issuer_signature.jws (or top-level payment + caller_binding).
 * See docs/VERIFY_ALGORITHM.md §11.
 */

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const verifyPkg = path.resolve(__dirname, '../../../packages/verify/dist/index.js');

const {
  verifyPayerBinding,
  receiptPayerClaimsFromEnvelope,
} = await import(verifyPkg);

function parseArgs(argv) {
  const args = { file: null, solanaRpc: null, baseRpc: null, json: false };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--json') args.json = true;
    else if (arg === '--solana-rpc' && argv[i + 1]) args.solanaRpc = argv[++i];
    else if (arg === '--rpc' && argv[i + 1]) args.baseRpc = argv[++i];
    else if (!arg.startsWith('-')) args.file = arg;
  }
  return args;
}

const args = parseArgs(process.argv.slice(2));
if (!args.file) {
  console.error(`
Chit402 Payer Verifier — offline on-chain payer match

Usage:
  node verify-receipt-payer.mjs <receipt.json>
  node verify-receipt-payer.mjs <receipt.json> --solana-rpc <url>
  node verify-receipt-payer.mjs <receipt.json> --rpc <base-rpc-url>

Environment:
  SOLANA_RPC_URL  Default Solana RPC (mainnet-beta)
  BASE_RPC_URL    Default Base RPC (mainnet.base.org)

Exit codes:
  0  payer_wallet matches on-chain settlement
  1  mismatch or verification error
  2  input error

See docs/VERIFY_ALGORITHM.md §11.
`);
  process.exit(2);
}

let receipt;
try {
  receipt = JSON.parse(readFileSync(args.file, 'utf8'));
} catch (err) {
  console.error(`Error reading receipt: ${err.message}`);
  process.exit(2);
}

const claims = receiptPayerClaimsFromEnvelope(receipt);
const result = await verifyPayerBinding(claims, {
  rpcUrl: args.baseRpc || undefined,
  solanaRpcUrl: args.solanaRpc || undefined,
});

if (args.json) {
  console.log(JSON.stringify({ claims, result }, null, 2));
} else {
  console.log(`Payment ref:  ${claims.payment?.ref || 'none'}`);
  console.log(`Payer wallet: ${claims.caller_binding?.payer_wallet || 'none'}`);
  console.log(`Gross amount: ${claims.payment?.gross_amount || 'none'}`);
  console.log(`Rail:         ${result.rail}`);
  if (result.valid) {
    console.log('✓ PAYER MATCH — on-chain settlement confirms stamped payer_wallet');
  } else {
    console.log(`✗ PAYER MISMATCH — ${result.reason || 'verification failed'}`);
  }
}

process.exit(result.valid ? 0 : 1);
