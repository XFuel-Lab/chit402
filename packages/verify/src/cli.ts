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
import { verifyReceipt, verifyBinding, type XFuelReceipt } from './index.js';

const HELP = `
xfuel-verify — Offline verification for XFuel receipts

Usage:
  xfuel-verify <receipt.json>           Verify binding locally
  xfuel-verify <receipt.json> --check-nullifier
                                        Also verify nullifier on-chain
  xfuel-verify - < receipt.json         Read from stdin
  xfuel-verify --help                   Show this help

Options:
  --check-nullifier   Query Base RPC for nullifier anchor (requires network)
  --rpc <url>         Custom RPC URL (default: https://mainnet.base.org)
  --json              Output JSON instead of human-readable
  --quiet             Only output errors

Exit codes:
  0 = verified
  1 = verification failed
  2 = partial verification (binding ok, nullifier not checked)
  3 = input error

Examples:
  # Local binding verification (no network)
  xfuel-verify my-receipt.json

  # Full verification including on-chain nullifier
  xfuel-verify my-receipt.json --check-nullifier

  # Pipe from curl
  curl -s https://api.xfuel.app/receipt/task-123?format=json | xfuel-verify -
`;

function parseArgs(args: string[]): {
  file: string | null;
  checkNullifier: boolean;
  rpcUrl: string | null;
  json: boolean;
  quiet: boolean;
  help: boolean;
} {
  const result = {
    file: null as string | null,
    checkNullifier: false,
    rpcUrl: null as string | null,
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
    } else if (arg === '--rpc' && args[i + 1]) {
      result.rpcUrl = args[++i];
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

  const result = await verifyReceipt(receipt, {
    checkNullifier: args.checkNullifier,
    rpcUrl: args.rpcUrl || undefined,
  });

  if (args.json) {
    console.log(JSON.stringify(result, null, 2));
  } else if (!args.quiet || result.overall === 'failed') {
    console.log('');
    console.log(`  XFuel Receipt Verification`);
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
