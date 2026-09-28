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
import {
  verifyReceipt,
  DEFAULT_TRUSTED_ISSUER_KIDS,
  type XFuelReceipt,
  type Jwks,
} from './index.js';

const HELP = `
xfuel-verify — Offline verification for Chit402 receipts

Usage:
  xfuel-verify <receipt.json>           Verify binding locally
  xfuel-verify <receipt.json> --jwks-file <jwks.json>
                                        Verify issuer signature with a JWKS file
  xfuel-verify <receipt.json> --fetch-jwks
                                        Fetch JWKS from an allowlisted issuer jwks_uri
  xfuel-verify <receipt.json> --check-payer
                                        Confirm payer, payee, asset, and amount on-chain
  xfuel-verify - < receipt.json         Read from stdin
  xfuel-verify --help                   Show this help

Options:
  --jwks-file <path>  JWKS file. Keys are trusted and matched by kid (no network)
  --jwks-url <url>    Fetch this https JWKS and trust it (explicit; any host)
  --fetch-jwks        Fetch receipt verification.jwks_uri when the host is allowlisted
                      (default allowlist: api.chit402.com)
  --trusted-kid <kid> Replace the default offline pin with this RFC 7638 kid
                      (repeatable). Default pin: ${DEFAULT_TRUSTED_ISSUER_KIDS[0]}
  --no-trusted-kid    Do not use the default offline pin (JWKS only)
  --check-nullifier   Query Base RPC for nullifier anchor (requires network)
  --check-payer       Query Base or Solana RPC. Base confirms payer, payee, asset, amount
  --solana-rpc <url>  Solana RPC URL (default: https://api.mainnet-beta.solana.com or SOLANA_RPC_URL)
  --rpc <url>         Custom RPC URL (default: https://mainnet.base.org)
  --json              Output JSON instead of human-readable
  --quiet             Only output errors

Exit codes:
  0 = verified
  1 = verification failed
  2 = partial verification
  3 = input error

Trust:
  A signature counts only when the verifying key is trusted. Trust is a JWKS
  entry matched by kid (file, --jwks-url, or --fetch-jwks), or an embedded
  issuer_jwk whose RFC 7638 thumbprint equals a pinned trusted kid. The
  embedded key alone is not a trust root. Untrusted keys report "key untrusted".

  Amount, payer, payee, and tx are read from verified signed claims. A mismatch
  with the unsigned outer payment / caller_binding copy is a failure.

Network behavior:
  By default, no network requests are made. Network is only used when:
  - --fetch-jwks or --jwks-url is passed
  - --check-nullifier is passed (queries Base RPC for on-chain anchor)
  - --check-payer is passed (queries Base or Solana RPC for USDC settlement)

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
  jwksUrl: string | null;
  fetchJwks: boolean;
  trustedKids: string[] | null;
  noTrustedKid: boolean;
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
    jwksUrl: null as string | null,
    fetchJwks: false,
    trustedKids: null as string[] | null,
    noTrustedKid: false,
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
    } else if (arg === '--jwks-url' && args[i + 1]) {
      result.jwksUrl = args[++i];
    } else if (arg === '--fetch-jwks') {
      result.fetchJwks = true;
    } else if (arg === '--trusted-kid' && args[i + 1]) {
      result.trustedKids = result.trustedKids || [];
      result.trustedKids.push(args[++i]);
    } else if (arg === '--no-trusted-kid') {
      result.noTrustedKid = true;
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

  const trustedKids = args.noTrustedKid
    ? []
    : (args.trustedKids ?? undefined);

  const result = await verifyReceipt(receipt, {
    jwks,
    jwksUri: args.jwksUrl || undefined,
    fetchJwks: args.fetchJwks,
    trustedKids,
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
    console.log(`  Amount:        ${result.issuer_signature.valid ? formatAmount(result.amount_usdc) : '— (not verified)'}`);
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
      console.log(`  Status:        ${result.binding.reason || 'No payment-binding commitment'}`);
    }
    console.log('');
    console.log(`  Issuer Signature`);
    console.log(`  ─────────────────────────────────────────────────`);
    if (result.issuer_signature.checked) {
      console.log(`  Kid:           ${result.issuer_signature.kid || '—'}`);
      console.log(`  Valid:         ${result.issuer_signature.valid ? '✓ YES' : '✗ NO'}`);
      console.log(`  Key trusted:   ${result.issuer_signature.key_trusted ? '✓ YES' : '✗ NO'}${result.issuer_signature.trust ? ` (${result.issuer_signature.trust})` : ''}`);
      if (!result.issuer_signature.valid && result.issuer_signature.reason) {
        console.log(`  Reason:        ${result.issuer_signature.reason}`);
      }
    } else {
      console.log(`  Status:        ${result.issuer_signature.reason || 'Not checked'}`);
      if (receipt.issuer_signature && !args.jwksFile && !args.fetchJwks && !args.jwksUrl) {
        console.log(`                 (pass --jwks-file, --fetch-jwks, or rely on the default trusted kid)`);
      }
    }
    console.log('');
    console.log(`  Payer (on-chain)`);
    console.log(`  ─────────────────────────────────────────────────`);
    if (result.payer.checked) {
      console.log(`  Rail:          ${result.payer.rail || '—'}`);
      console.log(`  Payer:         ${result.payer.payer_wallet || '—'}`);
      console.log(`  Payee:         ${result.payer.payee || '—'}`);
      console.log(`  Asset:         ${result.payer.asset || '—'}`);
      console.log(`  Amount:        ${formatAmount(result.payer.amount || null)}`);
      console.log(`  Valid:         ${result.payer.valid ? '✓ YES' : '✗ NO'}`);
      if (!result.payer.valid && result.payer.reason) {
        console.log(`  Reason:        ${result.payer.reason}`);
      }
    } else {
      console.log(`  Status:        ${result.payer.reason || 'Not checked'}`);
      if (result.issuer_signature.valid && result.payer.payer_wallet && result.tx && !args.checkPayer) {
        console.log(`                 (pass --check-payer to verify payer, payee, asset, and amount on-chain)`);
      }
    }
    if (result.claim_mismatches.length > 0) {
      console.log('');
      console.log(`  Outer / signed mismatches`);
      console.log(`  ─────────────────────────────────────────────────`);
      for (const mismatch of result.claim_mismatches) {
        console.log(`  ${mismatch.field}: outer ${mismatch.outer} ≠ signed ${mismatch.signed}`);
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
