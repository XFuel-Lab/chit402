#!/usr/bin/env node
/**
 * xfuel-verify CLI — Offline receipt verification.
 *
 * Usage:
 *   xfuel-verify receipt.json
 *   xfuel-verify receipt.json --check-nullifier
 *   xfuel-verify receipt.json --rpc https://mainnet.base.org
 *   cat receipt.json | xfuel-verify -
 *
 * Exit codes:
 *   0 = verified
 *   1 = verification failed
 *   2 = partial (binding ok, nullifier not checked or pending)
 *   3 = input error
 */

import { readFileSync } from 'node:fs';
import { verifyReceipt, verifyBinding, type XFuelReceipt, type Jwks } from './index.js';

const HELP = `
xfuel-verify — Offline verification for Chit402 receipts

Usage:
  xfuel-verify <receipt.json>           Verify binding locally
  xfuel-verify <receipt.json> --jwks-file <jwks.json>
                                        Verify issuer signature with JWKS
  xfuel-verify <receipt.json> --check-nullifier
                                        Also verify nullifier on-chain
  xfuel-verify - < receipt.json         Read from stdin
  xfuel-verify --help                   Show this help

Options:
  --jwks-file <path>  JWKS file for issuer signature verification (no network)
  --check-nullifier   Query Base RPC for nullifier anchor (requires network)
  --check-payer       Query Base or Solana RPC to confirm payer_wallet on-chain
  --solana-rpc <url>  Solana RPC URL (default: https://api.mainnet-beta.solana.com or SOLANA_RPC_URL)
  --rpc <url>         Custom RPC URL (default: https://mainnet.base.org)
  --json              Output JSON instead of human-readable
  --quiet             Only output errors

Exit codes:
  0 = verified
  1 = verification failed
  2 = partial verification (binding ok, nullifier not checked)
  3 = input error

Network behavior:
  By default, no network requests are made. Network is only used when:
  - --check-nullifier is passed (queries Base RPC for on-chain anchor)
  - --check-payer is passed (queries Base or Solana RPC for USDC settlement)

  JWKS must be provided as a local file (--jwks-file) for legacy receipts without
  issuer_signature.issuer_jwk. The CLI does not automatically fetch JWKS from a URL.
  Pinned receipts (issuer_jwk present) verify offline without --jwks-file.

  Solana payer verify uses SOLANA_RPC_URL when set, else the public mainnet RPC.

Examples:
  # Local binding verification (no network)
  xfuel-verify my-receipt.json

  # Verify issuer signature with JWKS file
  xfuel-verify my-receipt.json --jwks-file issuer-jwks.json

  # Full verification including on-chain nullifier
  xfuel-verify my-receipt.json --jwks-file issuer-jwks.json --check-nullifier

  # Pipe from curl
  curl -s https://api.chit402.com/receipt/task-123?format=json | xfuel-verify -
`;

function parseArgs(args: string[]): {
  file: string | null;
  jwksFile: string | null;
  checkNullifier: boolean;
  checkPayer: boolean;
  rpcUrl: string | null;
  solanaRpcUrl: string | null;
  json: boolean;
  quiet: boolean;
  help: boolean;
} {
  const result = {
    file: null as string | null,
    jwksFile: null as string | null,
    checkNullifier: false,
    checkPayer: false,
    rpcUrl: null as string | null,
    solanaRpcUrl: null as string | null,
    json: false,
    quiet: false,
    help: false,
  };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--help' || arg === '-h') {
      result.help = true;
    } else if (arg === '--check-nullifier') {
      result.checkNullifier = true;
    } else if (arg === '--check-payer') {
      result.checkPayer = true;
    } else if (arg === '--jwks-file' && args[i + 1]) {
      result.jwksFile = args[++i];
    } else if (arg === '--rpc' && args[i + 1]) {
      result.rpcUrl = args[++i];
    } else if (arg === '--solana-rpc' && args[i + 1]) {
      result.solanaRpcUrl = args[++i];
    } else if (arg === '--json') {
      result.json = true;
    } else if (arg === '--quiet' || arg === '-q') {
      result.quiet = true;
    } else if (!arg.startsWith('-')) {
      result.file = arg;
    }
  }

  return result;
}

function readReceipt(file: string): XFuelReceipt {
  let content: string;
  if (file === '-') {
    content = readFileSync(0, 'utf8');
  } else {
    content = readFileSync(file, 'utf8');
  }
  return JSON.parse(content) as XFuelReceipt;
}

function formatAmount(units: string | null): string {
  if (!units) return '—';
  const n = Number(units);
  if (!Number.isFinite(n)) return units;
  const usd = n / 1e6;
  return `$${usd.toFixed(usd >= 0.01 ? 2 : 6)} (${units} units)`;
}

async function main(): Promise<number> {
  const args = parseArgs(process.argv.slice(2));

  if (args.help || !args.file) {
    console.log(HELP);
    return args.help ? 0 : 3;
  }

  let receipt: XFuelReceipt;
  try {
    receipt = readReceipt(args.file);
  } catch (err) {
    console.error(`Error reading receipt: ${err instanceof Error ? err.message : String(err)}`);
    return 3;
  }

  if (!receipt.task_id) {
    console.error('Invalid receipt: missing task_id');
    return 3;
  }

  // Load JWKS if provided
  let jwks: Jwks | undefined;
  if (args.jwksFile) {
    try {
      const jwksContent = readFileSync(args.jwksFile, 'utf8');
      jwks = JSON.parse(jwksContent) as Jwks;
    } catch (err) {
      console.error(`Error reading JWKS file: ${err instanceof Error ? err.message : String(err)}`);
      return 3;
    }
  }

  const result = await verifyReceipt(receipt, {
    jwks,
    checkNullifier: args.checkNullifier,
    checkPayer: args.checkPayer,
    rpcUrl: args.rpcUrl || undefined,
    solanaRpcUrl: args.solanaRpcUrl || undefined,
  });

  if (args.json) {
    console.log(JSON.stringify(result, null, 2));
  } else if (!args.quiet || result.overall === 'failed') {
    console.log('');
    console.log(`  Chit402 Receipt Verification`);
    console.log(`  ─────────────────────────────────────────────────`);
    console.log(`  Receipt ID:    ${result.receipt_id}`);
    console.log(`  Hub:           ${result.hub || '—'}`);
    console.log(`  Model:         ${result.model || '—'}`);
    console.log(`  Amount:        ${formatAmount(result.amount_usdc)}`);
    console.log(`  TX:            ${result.tx || '—'}`);
    console.log(`  Output Hash:   ${result.output_hash ? result.output_hash.slice(0, 18) + '…' : '—'}`);
    console.log('');
    console.log(`  Binding`);
    console.log(`  ─────────────────────────────────────────────────`);
    if (result.binding.expected) {
      console.log(`  Expected:      ${result.binding.expected.slice(0, 18)}…`);
      console.log(`  Recomputed:    ${result.binding.recomputed?.slice(0, 18)}…`);
      console.log(`  Match:         ${result.binding.matches ? '✓ YES' : '✗ NO'}`);
      console.log(`  Covers:        ${result.binding.covers.join(', ')}`);
    } else {
      console.log(`  Status:        No binding (${result.binding.reason})`);
    }
    console.log('');
    console.log(`  Issuer Signature`);
    console.log(`  ─────────────────────────────────────────────────`);
    if (result.issuer_signature.checked) {
      console.log(`  Kid:           ${result.issuer_signature.kid || '—'}`);
      console.log(`  Valid:         ${result.issuer_signature.valid ? '✓ YES' : '✗ NO'}`);
      if (!result.issuer_signature.valid && result.issuer_signature.reason) {
        console.log(`  Reason:        ${result.issuer_signature.reason}`);
      }
    } else {
      console.log(`  Status:        ${result.issuer_signature.reason || 'Not checked'}`);
      if (receipt.issuer_signature && !args.jwksFile) {
        const hasPin = receipt.issuer_signature.issuer_jwk && receipt.issuer_signature.jws;
        console.log(hasPin
          ? `                 (pinned issuer_jwk on receipt — signature verified offline)`
          : `                 (receipt has signature — pass --jwks-file to verify)`);
      }
    }
    console.log('');
    console.log(`  Payer (on-chain)`);
    console.log(`  ─────────────────────────────────────────────────`);
    if (result.payer.checked) {
      console.log(`  Rail:          ${result.payer.rail || '—'}`);
      console.log(`  Valid:         ${result.payer.valid ? '✓ YES' : '✗ NO'}`);
      if (!result.payer.valid && result.payer.reason) {
        console.log(`  Reason:        ${result.payer.reason}`);
      }
    } else {
      console.log(`  Status:        ${result.payer.reason || 'Not checked'}`);
      if (receipt.caller_binding?.payer_wallet && receipt.payment?.ref && !args.checkPayer) {
        console.log(`                 (pass --check-payer to verify on-chain)`);
      }
    }
    console.log('');
    console.log(`  Nullifier`);
    console.log(`  ─────────────────────────────────────────────────`);
    if (result.nullifier.nullifier) {
      console.log(`  Value:         ${result.nullifier.nullifier.slice(0, 18)}…`);
      if (args.checkNullifier) {
        console.log(`  On-chain:      ${result.nullifier.anchored ? '✓ ANCHORED' : '✗ NOT FOUND'}`);
      } else {
        console.log(`  On-chain:      (not checked — use --check-nullifier)`);
      }
    } else {
      console.log(`  Status:        No nullifier (Tier-1 receipt)`);
    }
    console.log('');
    console.log(`  Overall: ${result.overall.toUpperCase()}`);
    if (result.errors.length > 0) {
      console.log(`  Errors:  ${result.errors.join(', ')}`);
    }
    console.log('');
  }

  switch (result.overall) {
    case 'verified':
      return 0;
    case 'failed':
      return 1;
    case 'partial':
      return 2;
    default:
      return 1;
  }
}

main()
  .then((code) => process.exit(code))
  .catch((err) => {
    console.error('Unexpected error:', err);
    process.exit(3);
  });
