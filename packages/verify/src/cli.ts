#!/usr/bin/env node
/**
 * xfuel-verify CLI — Offline receipt verification.
 *
 * Usage:
 *   xfuel-verify receipt.json
 *   xfuel-verify receipt.json --check-nullifier
 *   xfuel-verify receipt.json --rpc https://mainnet.base.org
 *   xfuel-verify receipt.json inclusion.json head.json --rpc
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
  verifyRefusal,
  isRefusalDocument,
  DEFAULT_TRUSTED_ISSUER_KIDS,
  type XFuelReceipt,
  type Jwks,
  type RefusalDocument,
} from './index.js';
import {
  verifyAnchoredRoot,
  type AnchorHead,
  type AnchorInclusion,
  type AnchorReceipt,
  type AnchorWitnessResult,
} from './anchor-witness.js';
import { type ReceiptLane } from './receipt-lane.js';
import { verifyPublishedPreimages } from './preimage.js';
import { checkReceiptIssuerHistory, readIssuerHistoryPin, type IssuerHistoryDocument } from './issuer-history.js';
import { verifyCanonicalPreimageBytes } from './canonical-preimage.js';
import type { CallerLogCache, LegacyProofInput } from './issuer-root.js';

const HELP = `
xfuel-verify — Offline verification for Chit402 receipts

Usage:
  xfuel-verify <receipt.json>           Verify binding locally
  xfuel-verify <refusal.json>           Verify a chit402.refusal.v1 document
                                        (issuer refused; not a payment)
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
  --rpc <url>         Base RPC URL (default: https://mainnet.base.org)
  --rpc               With a receipt, an inclusion proof, and a tree head: check the
                      leaf, then the Solana memo and the Base calldata for that root
  --inclusion <file>  Inclusion proof JSON (chit402.inclusion.v1)
  --head <file>       Signed tree head JSON (chit402.tree_head.v1)
  --json              Output JSON instead of human-readable
  --quiet             Only output errors
  --strict-issuer-history
                      Fail if the issuer key history cannot be fetched
  --issuer-history-file <path>
                      Read issuer history JSON instead of fetching it
  --canonical-preimage <path>
                      SHA-256 this file and match the signed payload_hash
  --no-issuer-history Do not check the kid's not_before / not_after window
  --no-preimage       Do not require published hash preimages
  --pinned-chain <caip2>
                      Opt in to issuer-root checks. eip155:8453 or eip155:84532.
                      No registry address is pinned in the package.
  --pinned-registry <0x>
                      Registry address for --pinned-chain. Also read from
                      CHIT_PINNED_CHAIN and CHIT_PINNED_REGISTRY.
  --genesis-kid <kid> Genesis kid for --offline. Default is the 0.3.0 pin.
  --registry-rpc <url>
                      Second Base RPC. Sepolia's first RPC is https://sepolia.base.org.
                      mainnet.base.org is a read-only default for eip155:8453.
  --offline           Package trust only, when the kid is the genesis kid.
  --require-dns       DNS timeout or SERVFAIL fails instead of pass_dns_unavailable.
  --require-dnssec    Stub. Fails unless the resolver reports DNSSEC validated.
  --root-cache <file> Unsigned RootCommitted cache. Never upgrades a verdict to pass.
                      The note is "as of block N, caller cache".
  --legacy-proof <file>
                      Inclusion proof for a pre-v11 receipt against the legacy freeze.
  --issuer-domain <domain>
                      DNS name whose _issuer TXT is read. Default chit402.com.

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
  - --rpc is passed with a receipt, an inclusion proof, and a tree head

  Solana payer verify uses SOLANA_RPC_URL when set, else the public mainnet RPC.

Anchored root:
  xfuel-verify receipt.json inclusion.json head.json --rpc
  xfuel-verify receipt.json --inclusion inclusion.json --head head.json --rpc https://mainnet.base.org

  Checks the Merkle inclusion, fetches the Solana transaction and requires the
  SPL Memo to contain the root, and checks the Base calldata the same way.
  Prints what this proves and what it does not prove. Exit 0 when both chains
  match, 2 when the leaf is included but an anchor is still pending, 1 when a
  check fails.

Receipt lane (unsigned, beside book_seq):
  settled_by is observed_transfer when the USDC transfer was checked on Base
  or Solana, and receipt when only the issuer asserts settlement. Unknown is
  null. Ordering is seq + settled_by + (anchor_changed AND not settled).
  Boundary: complete over registry marks, blind to payments the registry
  never joined. freeze is true only when book_seq is set, settled_by is
  receipt, the anchor changed after binding, and the row is not settled. An
  anchor change alone does not freeze, and freeze does not change the
  signature exit code. classification unverifiable_from_registry means the
  binding is past expiry and settled_by, receipt_id, observed_tx_hash, and
  observed_transfer_id are all null. That is not unpaid. local_check, when
  set, is a Base USDC payee and amount a stranger can check. It does not
  claim the row was paid. Design by Turbo on 1F916 (post 6579, comments
  88201, 88403, and 88596).

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
  sawRpc: boolean;
  anchorFlag: boolean;
  inclusionFile: string | null;
  headFile: string | null;
  positionals: string[];
  json: boolean;
  quiet: boolean;
  help: boolean;
  strictIssuerHistory: boolean;
  issuerHistoryFile: string | null;
  canonicalPreimageFile: string | null;
  noIssuerHistory: boolean;
  noPreimage: boolean;
  pinnedChain: string | null;
  pinnedRegistry: string | null;
  genesisKid: string | null;
  registryRpc: string | null;
  registryRpcPrimary: string | null;
  offline: boolean;
  requireDns: boolean;
  requireDnssec: boolean;
  rootCacheFile: string | null;
  legacyProofFile: string | null;
  issuerDomain: string | null;
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
    sawRpc: false,
    anchorFlag: false,
    inclusionFile: null as string | null,
    headFile: null as string | null,
    positionals: [] as string[],
    json: false,
    quiet: false,
    help: false,
    strictIssuerHistory: false,
    issuerHistoryFile: null as string | null,
    canonicalPreimageFile: null as string | null,
    noIssuerHistory: false,
    noPreimage: false,
    pinnedChain: null as string | null,
    pinnedRegistry: null as string | null,
    genesisKid: null as string | null,
    registryRpc: null as string | null,
    registryRpcPrimary: null as string | null,
    offline: false,
    requireDns: false,
    requireDnssec: false,
    rootCacheFile: null as string | null,
    legacyProofFile: null as string | null,
    issuerDomain: null as string | null,
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
    } else if (arg === '--rpc') {
      result.sawRpc = true;
      const next = args[i + 1];
      if (next && /^https?:\/\//i.test(next)) result.rpcUrl = args[++i];
      else result.anchorFlag = true;
    } else if (arg === '--inclusion' && args[i + 1]) {
      result.inclusionFile = args[++i];
    } else if (arg === '--head' && args[i + 1]) {
      result.headFile = args[++i];
    } else if (arg === '--solana-rpc' && args[i + 1]) {
      result.solanaRpcUrl = args[++i];
    } else if (arg === '--strict-issuer-history') {
      result.strictIssuerHistory = true;
    } else if (arg === '--issuer-history-file' && args[i + 1]) {
      result.issuerHistoryFile = args[++i];
    } else if (arg === '--canonical-preimage' && args[i + 1]) {
      result.canonicalPreimageFile = args[++i];
    } else if (arg === '--no-issuer-history') {
      result.noIssuerHistory = true;
    } else if (arg === '--no-preimage') {
      result.noPreimage = true;
    } else if (arg === '--pinned-chain' && args[i + 1]) {
      result.pinnedChain = args[++i];
    } else if (arg === '--pinned-registry' && args[i + 1]) {
      result.pinnedRegistry = args[++i];
    } else if (arg === '--genesis-kid' && args[i + 1]) {
      result.genesisKid = args[++i];
    } else if (arg === '--registry-rpc' && args[i + 1]) {
      result.registryRpc = args[++i];
    } else if (arg === '--registry-rpc-primary' && args[i + 1]) {
      result.registryRpcPrimary = args[++i];
    } else if (arg === '--offline') {
      result.offline = true;
    } else if (arg === '--require-dns') {
      result.requireDns = true;
    } else if (arg === '--require-dnssec') {
      result.requireDnssec = true;
    } else if (arg === '--root-cache' && args[i + 1]) {
      result.rootCacheFile = args[++i];
    } else if (arg === '--legacy-proof' && args[i + 1]) {
      result.legacyProofFile = args[++i];
    } else if (arg === '--issuer-domain' && args[i + 1]) {
      result.issuerDomain = args[++i];
    } else if (arg === '--json') {
      result.json = true;
    } else if (arg === '--quiet' || arg === '-q') {
      result.quiet = true;
    } else if (!arg.startsWith('-')) {
      result.positionals.push(arg);
      if (!result.file) result.file = arg;
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

function readJson(file: string): unknown {
  const content = file === '-' ? readFileSync(0, 'utf8') : readFileSync(file, 'utf8');
  return JSON.parse(content) as unknown;
}

function printLane(lane: ReceiptLane): void {
  const bit = (value: boolean | null) => (value == null ? 'unknown' : (value ? 'true' : 'false'));
  console.log(`  Receipt lane (unsigned)`);
  console.log(`  ─────────────────────────────────────────────────`);
  console.log(`  book_seq:      ${lane.book_seq ?? '—'}`);
  console.log(`  settled_by:    ${lane.settled_by ?? 'null'}`);
  console.log(`  settled:       ${bit(lane.settled)}`);
  console.log(`  anchor_changed_since_binding: ${bit(lane.anchor_changed_since_binding)}`);
  console.log(`  freeze:        ${lane.freeze ? 'YES' : 'no'}`);
  if (lane.reason) console.log(`  reason:        ${lane.reason}`);
  console.log(`  classification:${lane.classification}`);
  console.log(`  ordering:      ${lane.ordering}`);
  console.log(`  boundary:      ${lane.boundary}`);
  if (lane.local_check) {
    console.log(`  local_check:   payee ${lane.local_check.payee} amount ${lane.local_check.amount_atomic} (not a payment)`);
  }
  console.log(`  ${lane.rule}`);
  console.log('');
}

function printAnchor(result: AnchorWitnessResult, json: boolean, quiet: boolean): void {
  if (json) {
    console.log(JSON.stringify(result, null, 2));
    return;
  }
  if (quiet && result.overall !== 'failed') return;
  const mark = (ok: boolean) => (ok ? '✓ YES' : '✗ NO');
  console.log('');
  console.log('  Anchored receipt root');
  console.log('  ─────────────────────────────────────────────────');
  console.log(`  Root:          ${result.root || '—'}`);
  console.log(`  Inclusion:     ${mark(result.inclusion.valid)}${result.inclusion.reason ? ` (${result.inclusion.reason})` : ''}`);
  console.log(`  Leaf source:   ${result.inclusion.leaf_source}`);
  console.log(`  Solana:        ${result.solana.checked ? mark(result.solana.valid) : (result.solana.reason || 'not checked')}`);
  if (result.solana.signature) console.log(`  Signature:     ${result.solana.signature}`);
  if (result.solana.slot != null) console.log(`  Slot:          ${result.solana.slot}`);
  if (result.solana.cluster) console.log(`  Cluster:       ${result.solana.cluster}`);
  if (result.solana.memo) console.log(`  Memo:          ${result.solana.memo}`);
  if (result.solana.reason && !result.solana.valid) console.log(`  Solana reason: ${result.solana.reason}`);
  console.log(`  Base:          ${result.base.checked ? mark(result.base.valid) : (result.base.reason || 'not checked')}`);
  if (result.base.tx) console.log(`  Base tx:       ${result.base.tx}`);
  if (result.base.chain_id != null) console.log(`  Chain id:      ${result.base.chain_id}`);
  if (result.base.reason && !result.base.valid) console.log(`  Base reason:   ${result.base.reason}`);
  console.log('');
  console.log('  What this proves');
  console.log('  ─────────────────────────────────────────────────');
  for (const line of result.proves) console.log(`  ${line}`);
  console.log('');
  console.log('  What this does not prove');
  console.log('  ─────────────────────────────────────────────────');
  for (const line of result.does_not_prove) console.log(`  ${line}`);
  console.log('');
  console.log(`  Overall: ${result.overall.toUpperCase()}`);
  if (result.errors.length > 0) console.log(`  Errors:  ${result.errors.join(', ')}`);
  console.log('');
}

async function runAnchor(args: ReturnType<typeof parseArgs>): Promise<number> {
  const receiptPath = args.file;
  const inclusionPath = args.inclusionFile || args.positionals[1] || null;
  const headPath = args.headFile || (args.inclusionFile ? null : args.positionals[2]) || null;
  if (!receiptPath || !inclusionPath || !headPath) {
    console.error('Anchor check needs a receipt, an inclusion proof, and a tree head.');
    console.error('  xfuel-verify receipt.json inclusion.json head.json --rpc');
    return 3;
  }
  let receipt: AnchorReceipt;
  let inclusion: AnchorInclusion;
  let head: AnchorHead;
  try {
    receipt = readJson(receiptPath) as AnchorReceipt;
    inclusion = readJson(inclusionPath) as AnchorInclusion;
    head = readJson(headPath) as AnchorHead;
  } catch (err) {
    console.error(`Error reading anchor inputs: ${err instanceof Error ? err.message : String(err)}`);
    return 3;
  }
  const result = await verifyAnchoredRoot({
    receipt,
    inclusion,
    head,
    baseRpcUrl: args.rpcUrl || undefined,
    solanaRpcUrl: args.solanaRpcUrl || undefined,
  });
  const verified = await verifyReceipt(receipt as unknown as XFuelReceipt, { head });
  const lane = verified.receipt_lane;
  if (args.json) {
    console.log(JSON.stringify({ ...result, receipt_lane: lane }, null, 2));
  } else {
    printAnchor(result, false, args.quiet);
    if (!args.quiet) printLane(lane);
  }
  if (result.overall === 'verified') return 0;
  if (result.overall === 'partial') return 2;
  return 1;
}

async function runRefusal(
  doc: RefusalDocument,
  args: {
    jwks?: Jwks;
    trustedKids?: readonly string[];
    json: boolean;
    quiet: boolean;
    requirePreimages: boolean;
    issuerHistory: IssuerHistoryDocument | null;
    issuerHistoryBytes: string | null;
    fetchIssuerHistory: boolean;
    strictIssuerHistory: boolean;
    skipIssuerHistory: boolean;
    canonicalPreimage: string | null;
  },
): Promise<number> {
  const trustedKids = args.trustedKids ?? DEFAULT_TRUSTED_ISSUER_KIDS;
  const result = verifyRefusal(doc, {
    jwks: args.jwks,
    trustedKids,
  });
  const preimages = await verifyPublishedPreimages(doc as unknown as Record<string, unknown>, {
    requirePreimages: args.requirePreimages,
  });
  let canonicalFailed = false;
  if (args.canonicalPreimage != null) {
    const canonical = verifyCanonicalPreimageBytes(args.canonicalPreimage, result.payload_hash);
    canonicalFailed = !canonical.ok;
    if (canonicalFailed) preimages.errors.push(`canonical preimage: ${canonical.reason}`);
    if (canonicalFailed) preimages.ok = false;
  }
  const pin = result.valid ? readIssuerHistoryPin({
    issuer_history: result.issuer_history,
  } as Record<string, unknown>) : null;
  const history = args.skipIssuerHistory
    ? { checked: false, ok: true, unreachable: false, warning: null, reason: null, kid: result.kid ?? null }
    : await checkReceiptIssuerHistory(doc as unknown as { verification?: { jwks_uri?: string }; verify_url?: string; created_at?: unknown }, {
      document: args.issuerHistory,
      documentBytes: args.issuerHistoryBytes,
      fetchHistory: args.fetchIssuerHistory,
      strict: args.strictIssuerHistory,
      jwks: args.jwks,
      trustedKids,
      issuedAt: (doc as { issued_at?: string }).issued_at ?? null,
      kid: result.kid ?? doc.issuer_signature?.kid ?? null,
      pin,
      requirePin: result.valid && Number(result.payload_version) >= 2,
    });
  const historyFailed = history.checked && !history.ok;
  const failed = !result.valid || !preimages.ok || historyFailed || canonicalFailed;
  if (args.json) {
    console.log(JSON.stringify({ ...result, preimages, issuer_history: history }, null, 2));
  } else if (!args.quiet || failed) {
    console.log('');
    console.log('  Chit402 Refusal Verification');
    console.log('  ─────────────────────────────────────────────────');
    console.log(`  Schema:        ${result.schema}`);
    console.log(`  Refusal ID:    ${result.refusal_id || doc.refusal_id || '—'}`);
    console.log(`  Code:          ${result.refusal_code || doc.refusal_code || '—'}`);
    console.log(`  Nonce:         ${result.nonce || '—'}`);
    console.log(`  Chain:         ${result.chain_id ?? 'null'}`);
    console.log(`  Charged:       false`);
    console.log('');
    console.log('  Issuer Signature');
    console.log('  ─────────────────────────────────────────────────');
    console.log(`  Valid:         ${result.valid ? '✓ YES' : '✗ NO'}`);
    if (result.kid) console.log(`  Kid:           ${result.kid}`);
    if (!result.valid && result.reason) console.log(`  Reason:        ${result.reason}`);
    console.log('');
    console.log('  What this proves');
    console.log('  ─────────────────────────────────────────────────');
    for (const line of result.proves) console.log(`  ${line}`);
    console.log('');
    console.log('  What this does not prove');
    console.log('  ─────────────────────────────────────────────────');
    for (const line of result.does_not_prove) console.log(`  ${line}`);
    console.log('');
    console.log(`  Overall: ${failed ? 'FAILED' : 'VERIFIED'}`);
    if (!preimages.ok) console.log(`  Preimages:     ${preimages.errors.join('; ')}`);
    if (history.warning) console.log(`  Issuer history: ${history.warning}`);
    if (historyFailed && history.reason) console.log(`  Issuer history: ${history.reason}`);
    console.log('');
  }
  return failed ? 1 : 0;
}

async function main(): Promise<number> {
  const args = parseArgs(process.argv.slice(2));
  const anchorMode = args.anchorFlag
    || Boolean(args.inclusionFile || args.headFile)
    || (args.positionals.length >= 3 && args.sawRpc);

  if (args.help) {
    console.log(HELP);
    return 0;
  }
  if (anchorMode) return runAnchor(args);

  if (!args.file) {
    console.log(HELP);
    return 3;
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
    : (args.trustedKids ?? DEFAULT_TRUSTED_ISSUER_KIDS);

  if (isRefusalDocument(receipt as unknown)) {
    let issuerHistory: IssuerHistoryDocument | null = null;
    let issuerHistoryBytes: string | null = null;
    if (args.issuerHistoryFile) {
      issuerHistoryBytes = readFileSync(args.issuerHistoryFile, 'utf8');
      issuerHistory = JSON.parse(issuerHistoryBytes) as IssuerHistoryDocument;
    }
    let canonicalPreimage: string | null = null;
    if (args.canonicalPreimageFile) {
      canonicalPreimage = readFileSync(args.canonicalPreimageFile, 'utf8');
    }
    return runRefusal(receipt as unknown as RefusalDocument, {
      jwks,
      trustedKids,
      json: args.json,
      quiet: args.quiet,
      requirePreimages: !args.noPreimage,
      issuerHistory,
      issuerHistoryBytes,
      fetchIssuerHistory: !args.noIssuerHistory && !issuerHistory,
      strictIssuerHistory: args.strictIssuerHistory,
      skipIssuerHistory: args.noIssuerHistory,
      canonicalPreimage,
    });
  }

  let issuerHistory: IssuerHistoryDocument | null = null;
  let issuerHistoryBytes: string | null = null;
  if (args.issuerHistoryFile) {
    try {
      issuerHistoryBytes = readFileSync(args.issuerHistoryFile, 'utf8');
      issuerHistory = JSON.parse(issuerHistoryBytes) as IssuerHistoryDocument;
    } catch (err) {
      console.error(`Error reading issuer history: ${err instanceof Error ? err.message : String(err)}`);
      return 3;
    }
  }
  let canonicalPreimage: string | null = null;
  if (args.canonicalPreimageFile) {
    try {
      canonicalPreimage = readFileSync(args.canonicalPreimageFile, 'utf8');
    } catch (err) {
      console.error(`Error reading canonical preimage: ${err instanceof Error ? err.message : String(err)}`);
      return 3;
    }
  }
  let rootCache: CallerLogCache | null = null;
  if (args.rootCacheFile) {
    try {
      rootCache = JSON.parse(readFileSync(args.rootCacheFile, 'utf8')) as CallerLogCache;
    } catch (err) {
      console.error(`Error reading root cache: ${err instanceof Error ? err.message : String(err)}`);
      return 3;
    }
  }
  let legacyProof: LegacyProofInput | null = null;
  if (args.legacyProofFile) {
    try {
      legacyProof = JSON.parse(readFileSync(args.legacyProofFile, 'utf8')) as LegacyProofInput;
    } catch (err) {
      console.error(`Error reading legacy proof: ${err instanceof Error ? err.message : String(err)}`);
      return 3;
    }
  }
  const rootRequested = args.offline || args.requireDns || args.requireDnssec
    || !!args.pinnedChain || !!args.pinnedRegistry || !!args.registryRpc
    || !!args.registryRpcPrimary || !!args.rootCacheFile || !!args.legacyProofFile
    || !!args.genesisKid || !!args.issuerDomain
    || !!process.env.CHIT_PINNED_CHAIN || !!process.env.CHIT_PINNED_REGISTRY;

  const result = await verifyReceipt(receipt, {
    jwks,
    jwksUri: args.jwksUrl || undefined,
    fetchJwks: args.fetchJwks,
    trustedKids,
    checkNullifier: args.checkNullifier,
    checkPayer: args.checkPayer,
    rpcUrl: args.rpcUrl || undefined,
    solanaRpcUrl: args.solanaRpcUrl || undefined,
    requirePreimages: !args.noPreimage,
    issuerHistory,
    issuerHistoryBytes,
    fetchIssuerHistory: !args.noIssuerHistory && !issuerHistory,
    strictIssuerHistory: args.strictIssuerHistory,
    skipIssuerHistory: args.noIssuerHistory,
    canonicalPreimage,
    issuerRoot: rootRequested ? {
      pin: args.pinnedChain || args.pinnedRegistry
        ? {
          chain: args.pinnedChain || '',
          registry: args.pinnedRegistry || '',
          genesis_kid: args.genesisKid || undefined,
        }
        : undefined,
      offline: args.offline,
      requireDns: args.requireDns,
      requireDnssec: args.requireDnssec,
      primaryRpc: args.registryRpcPrimary,
      secondaryRpc: args.registryRpc,
      cache: rootCache,
      legacyProof,
      domain: args.issuerDomain || undefined,
    } : undefined,
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
    printLane(result.receipt_lane);
    if (result.preimages.checked) {
      console.log(`  Preimages:     ${result.preimages.ok ? '✓ MATCH' : '✗ ' + result.preimages.errors.join('; ')}`);
    }
    if (result.issuer_history.checked) {
      console.log(`  Issuer history: ${result.issuer_history.ok ? '✓ kid in window' : '✗ ' + (result.issuer_history.reason || 'failed')}`);
    } else if (result.issuer_history.warning) {
      console.log(`  Issuer history: ${result.issuer_history.warning}`);
    }
    if (result.issuer_root) {
      const yellow = result.issuer_root.display === 'yellow';
      const label = `Issuer root:    ${result.issuer_root.verdict}${yellow ? ' (yellow)' : ''}`;
      console.log(yellow && process.stdout.isTTY ? `\x1b[33m  ${label}\x1b[0m` : `  ${label}`);
      if (result.issuer_root.reason) console.log(`  Root reason:   ${result.issuer_root.reason}`);
      if (result.issuer_root.note) console.log(`  Root note:     ${result.issuer_root.note}`);
      if (result.issuer_root.warnings.length) {
        console.log(`  Root warnings: ${result.issuer_root.warnings.join(', ')}`);
      }
    }
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
