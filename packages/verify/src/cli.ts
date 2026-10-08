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

import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import {
  verifyReceipt,
  verifyRefusal,
  isRefusalDocument,
  loadIssuerJwks,
  DEFAULT_TRUSTED_ISSUER_KIDS,
  DEFAULT_TRUSTED_JWKS_HOSTS,
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
import { type EpochRecord } from './epoch.js';
import { jwkThumbprint, readJwsHeader, verifyIssuerJws, type Es256Jwk } from './jws.js';
import { type ReceiptLane } from './receipt-lane.js';
import { verifyPublishedPreimages } from './preimage.js';
import { checkReceiptIssuerHistory, historyUrlFromReceipt, readIssuerHistoryPin, type IssuerHistoryDocument } from './issuer-history.js';
import { verifyCanonicalPreimageBytes } from './canonical-preimage.js';
import { HEAD_TRUST_MESSAGES, LEGACY_HEAD_UNPINNED_SIGNER } from './anchor-trust.js';
import type { CarryHead, CarryInclusion } from './carry-forward.js';

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
  --version           Print @xfuel/verify version and exit
  --rpc               With a receipt, an inclusion proof, and a tree head: check the
                      leaf, then the Solana memo and the Base calldata for that root.
                      The tree head must carry a valid ES256 issuer signature, and
                      the anchor wallets must match the signed head.
                      A v2 head also needs the signed epoch record.
                      A tree-head file with --rpc enters this mode.
                      The same files without --rpc check the head signature and the
                      index/size-bound inclusion offline. They do not call chain RPC.
  --epoch-record <f>  Signed epoch record JSON. Skips the network fetch.
  --epoch-url <url>   GET this epoch record. Default: the receipt verify_url
                      origin plus /v1/receipts/tree/epoch
  --inclusion <file>  Inclusion proof JSON (chit402.inclusion.v1)
  --head <file>       Signed tree head JSON (chit402.tree_head.v1 or v2)
  --anchor-wallets-file <path>
                      Signed chit402.anchor_wallets.v1 document. Wallets in a
                      verified document are added to the package pin. A head
                      that names any other wallet fails.
  --carry-old-head <file>
  --carry-old-inclusion <file>
  --carry-head <file>
  --carry-inclusion <file>
                      Earlier signed head, its inclusion proof, the current
                      signed head, and the current inclusion proof. Repeat
                      --carry-inclusion for each current index of the leaf.
                      The issued time and epoch are the earlier head's signed
                      claims. The logged time, epoch, and leaf index are the
                      current head's signed claims. A receipt in the current
                      epoch does not use these flags.
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

  Amount, payer, payee, and tx are read from verified signed claims. Every
  signed field is compared with the outer receipt at the same path. A mismatch
  fails. Outer fields the signature does not cover are printed as UNVERIFIED.
  The outer document schema is not a copy of the JWS schema. Log mode (a
  receipt, an inclusion proof, and a tree head) runs these receipt checks too.

Network behavior:
  JWKS, nullifiers, and anchors are not fetched unless you pass a flag.
  Issuer history is fetched by default when the receipt names a history URL
  and neither --issuer-history-file nor --no-issuer-history is set. A payload
  v10 receipt fails (exit 1) when that fetch cannot run. Offline mode is
  --issuer-history-file <snapshot>, or --no-issuer-history to skip the window.
  Other network uses:
  - --fetch-jwks or --jwks-url
  - --check-nullifier (Base RPC)
  - --check-payer (Base or Solana RPC)
  - --rpc with a receipt, an inclusion proof, and a tree head
  - a v2 head, which fetches GET /v1/receipts/tree/epoch unless --epoch-record

  Solana payer verify uses SOLANA_RPC_URL when set, else the public mainnet RPC.

Anchored root:
  xfuel-verify receipt.json inclusion.json head.json --rpc
  xfuel-verify receipt.json --inclusion inclusion.json --head head.json --rpc https://mainnet.base.org

  Also runs the single-receipt checks (issuer signature and signed-versus-outer
  comparison). Those must pass before Overall can be VERIFIED. Then it checks
  the tree head's ES256 issuer signature (production pin, issuer
  history, or JWKS, same rules as a receipt). The signed root, size, epoch,
  and anchors must match the head. Then it checks Merkle inclusion, requires
  the Solana memo and fee payer, and requires the Base calldata and sender.
  The sender and fee payer must be on the issuer anchor-wallet list (the
  package pin, plus a verified /.well-known/anchor-wallets.json or
  issuer-history anchor_wallets list). The on-chain issuer-root registry and
  the DNS anchor are not read. Prints what this proves and what it does not
  prove. Exit 0 when the receipt checks pass and both chains match, 2 when the
  leaf is included but an anchor is still pending, or when the leaf is past
  the anchored tree (PENDING, not a tamper failure), and the receipt checks
  did not fail, 1 when a check fails. With --rpc, the head root must equal
  the newest Solana anchor memo from the signed fee payer.

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
  # Skip the issuer-history fetch. A v10 receipt otherwise needs that network call.
  xfuel-verify my-receipt.json --no-issuer-history

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
  epochRecordFile: string | null;
  epochUrl: string | null;
  carryOldHeadFile: string | null;
  carryOldInclusionFile: string | null;
  carryHeadFile: string | null;
  carryInclusionFiles: string[];
  positionals: string[];
  json: boolean;
  quiet: boolean;
  help: boolean;
  strictIssuerHistory: boolean;
  issuerHistoryFile: string | null;
  canonicalPreimageFile: string | null;
  noIssuerHistory: boolean;
  noPreimage: boolean;
  version: boolean;
  anchorWalletsFile: string | null;
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
    epochRecordFile: null as string | null,
    epochUrl: null as string | null,
    carryOldHeadFile: null as string | null,
    carryOldInclusionFile: null as string | null,
    carryHeadFile: null as string | null,
    carryInclusionFiles: [] as string[],
    positionals: [] as string[],
    json: false,
    quiet: false,
    help: false,
    strictIssuerHistory: false,
    issuerHistoryFile: null as string | null,
    canonicalPreimageFile: null as string | null,
    noIssuerHistory: false,
    noPreimage: false,
    version: false,
    anchorWalletsFile: null as string | null,
  };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--version' || arg === '-V') {
      result.version = true;
    } else if (arg === '--help' || arg === '-h') {
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
    } else if (arg === '--epoch-record' && args[i + 1]) {
      result.epochRecordFile = args[++i];
    } else if (arg === '--epoch-url' && args[i + 1]) {
      result.epochUrl = args[++i];
    } else if (arg === '--carry-old-head' && args[i + 1]) {
      result.carryOldHeadFile = args[++i];
    } else if (arg === '--carry-old-inclusion' && args[i + 1]) {
      result.carryOldInclusionFile = args[++i];
    } else if (arg === '--carry-head' && args[i + 1]) {
      result.carryHeadFile = args[++i];
    } else if (arg === '--carry-inclusion' && args[i + 1]) {
      result.carryInclusionFiles.push(args[++i]);
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
    } else if (arg === '--anchor-wallets-file' && args[i + 1]) {
      result.anchorWalletsFile = args[++i];
    } else if (arg === '--no-preimage') {
      result.noPreimage = true;
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

function headStatus(file: string): string | null {
  try {
    const doc = readJson(file) as { status?: unknown };
    return typeof doc?.status === 'string' ? doc.status : null;
  } catch {
    return null;
  }
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
  console.log(`  Head signature:${result.head_signature.valid ? ' ✓ YES' : ' ✗ NO'}${result.head_signature.trust ? ` (${result.head_signature.trust})` : ''}`);
  if (result.head_signature.kid) console.log(`  Head kid:      ${result.head_signature.kid}`);
  if (result.head_signature.message) console.log(`  Head reason:   ${result.head_signature.message}`);
  const unlogged = result.inclusion.unlogged_reason ? ` unlogged:${result.inclusion.unlogged_reason}` : '';
  if (result.overall === 'pending') {
    console.log(`  Inclusion:     PENDING${result.inclusion.reason ? ` (${result.inclusion.reason})` : ''}`);
  } else {
    console.log(`  Inclusion:     ${mark(result.inclusion.valid)}${result.inclusion.reason ? ` (${result.inclusion.reason})` : ''}${unlogged}`);
  }
  console.log(`  Leaf source:   ${result.inclusion.leaf_source}`);
  console.log(`  Solana:        ${result.solana.checked ? mark(result.solana.valid) : (result.solana.reason || 'not checked')}`);
  if (result.solana.signature) console.log(`  Signature:     ${result.solana.signature}`);
  if (result.solana.slot != null) console.log(`  Slot:          ${result.solana.slot}`);
  if (result.solana.cluster) console.log(`  Cluster:       ${result.solana.cluster}`);
  if (result.solana.fee_payer) console.log(`  Fee payer:     ${result.solana.fee_payer}`);
  if (result.solana.memo) console.log(`  Memo:          ${result.solana.memo}`);
  if (result.solana.reason && !result.solana.valid) console.log(`  Solana reason: ${result.solana.reason}`);
  console.log(`  Base:          ${result.base.checked ? mark(result.base.valid) : (result.base.reason || 'not checked')}`);
  if (result.base.from) console.log(`  Base from:     ${result.base.from}`);
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
  if (result.overall === 'pending') {
    console.log(`  Anchored size: ${result.inclusion.anchored_tree_size ?? '—'}`);
    console.log(`  Live size:     ${result.inclusion.live_tree_size ?? '—'}`);
  }
  console.log(`  Overall: ${result.overall.toUpperCase()}`);
  if (result.errors.length > 0) console.log(`  Errors:  ${result.errors.join(', ')}`);
  if (result.errors.includes(LEGACY_HEAD_UNPINNED_SIGNER)) {
    console.log(`  ${HEAD_TRUST_MESSAGES[LEGACY_HEAD_UNPINNED_SIGNER]}`);
  }
  console.log('');
}

function headNeedsEpochRecord(head: AnchorHead): boolean {
  const schema = (head as { schema?: string }).schema;
  const version = (head as { payload_version?: number }).payload_version;
  return head.epoch != null || schema === 'chit402.tree_head.v2' || version === 2;
}

function epochUrlFromReceipt(receipt: { verify_url?: string | null }): string | null {
  const raw = receipt?.verify_url;
  if (!raw) return null;
  try {
    return `${new URL(raw).origin}/v1/receipts/tree/epoch`;
  } catch {
    return null;
  }
}

async function loadEpochRecord(
  args: ReturnType<typeof parseArgs>,
  receipt: { verify_url?: string | null },
): Promise<EpochRecord | null> {
  if (args.epochRecordFile) {
    return JSON.parse(readFileSync(args.epochRecordFile, 'utf8')) as EpochRecord;
  }
  const url = args.epochUrl || epochUrlFromReceipt(receipt);
  if (!url) return null;
  const res = await fetch(url);
  if (!res.ok) return null;
  const body = await res.json() as EpochRecord & { issuer_signature?: { jws?: string } };
  if (!body?.issuer_signature?.jws) return null;
  return body;
}

function epochSignatureOk(record: EpochRecord, jws: string, jwks?: Jwks, trustedKids?: readonly string[]): boolean {
  const sig = record.issuer_signature;
  const embedded = sig && 'issuer_jwk' in sig
    ? (sig as { issuer_jwk?: Es256Jwk }).issuer_jwk
    : undefined;
  const kid = readJwsHeader(jws)?.kid;
  const keys: Es256Jwk[] = [];
  for (const key of jwks?.keys || []) {
    if (!key || (key as Es256Jwk).kty !== 'EC') continue;
    const jwk = key as Es256Jwk;
    if (kid && jwk.kid !== kid) continue;
    keys.push(jwk);
  }
  if (embedded && trustedKids?.includes(jwkThumbprint(embedded))) keys.push(embedded);
  for (const key of keys) {
    const verified = verifyIssuerJws(jws, key);
    if (!verified.valid || !verified.payload) continue;
    const payload = verified.payload;
    if (JSON.stringify(payload.epochs ?? null) !== JSON.stringify(record.epochs ?? null)) return false;
    if (JSON.stringify(payload.orphans ?? []) !== JSON.stringify(record.orphans ?? [])) return false;
    const payloadUnlogged = payload.unlogged === undefined ? null : payload.unlogged;
    const recordUnlogged = record.unlogged === undefined ? null : record.unlogged;
    if (JSON.stringify(payloadUnlogged) !== JSON.stringify(recordUnlogged)) return false;
    return true;
  }
  return false;
}

function packageVersion(): string {
  const require = createRequire(__filename);
  const pkg = require('../package.json') as { version?: string };
  return pkg.version || '0.0.0';
}

function looksLikeTreeHead(value: unknown): boolean {
  if (!value || typeof value !== 'object') return false;
  const doc = value as { schema?: unknown; status?: unknown; anchors?: unknown; root?: unknown; task_id?: unknown };
  if (doc.status === 'not_yet_published') return true;
  if (typeof doc.schema === 'string' && doc.schema.startsWith('chit402.tree_head.')) return true;
  return Boolean(doc.anchors && doc.root && !doc.task_id);
}

function readOfflineWitness(args: ReturnType<typeof parseArgs>): {
  head: AnchorHead | null;
  inclusion: AnchorInclusion | null;
} {
  let head: AnchorHead | null = null;
  let inclusion: AnchorInclusion | null = null;
  for (const file of args.positionals.slice(1)) {
    let doc: unknown;
    try {
      doc = readJson(file);
    } catch (err) {
      throw new Error(`Error reading ${file}: ${err instanceof Error ? err.message : String(err)}`);
    }
    const row = doc as { proof?: unknown; leaf_index?: unknown };
    if (looksLikeTreeHead(doc)) head = doc as AnchorHead;
    else if (doc && typeof doc === 'object' && (Array.isArray(row.proof) || row.leaf_index != null)) {
      inclusion = doc as AnchorInclusion;
    }
  }
  return { head, inclusion };
}

function fileLooksLikeHead(file: string | null): boolean {
  if (!file) return false;
  try {
    return looksLikeTreeHead(readJson(file));
  } catch {
    return false;
  }
}

function historyHostAllowed(url: string): boolean {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return false;
    if (parsed.protocol === 'http:' && parsed.hostname !== '127.0.0.1' && parsed.hostname !== 'localhost') return false;
    if (parsed.protocol === 'https:') {
      return DEFAULT_TRUSTED_JWKS_HOSTS.some((host) => host.toLowerCase() === parsed.hostname.toLowerCase());
    }
    return true;
  } catch {
    return false;
  }
}

async function loadAnchorIssuerHistory(
  args: ReturnType<typeof parseArgs>,
  receipt: { verification?: { jwks_uri?: string }; verify_url?: string },
): Promise<IssuerHistoryDocument | null> {
  if (args.issuerHistoryFile) {
    return JSON.parse(readFileSync(args.issuerHistoryFile, 'utf8')) as IssuerHistoryDocument;
  }
  if (args.noIssuerHistory) return null;
  const url = historyUrlFromReceipt(receipt);
  if (!url || !historyHostAllowed(url)) return null;
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(4000) });
    if (!res.ok) return null;
    return await res.json() as IssuerHistoryDocument;
  } catch {
    return null;
  }
}

async function loadAnchorWalletDocument(
  args: ReturnType<typeof parseArgs>,
  receipt: { verification?: { jwks_uri?: string }; verify_url?: string },
): Promise<Record<string, unknown> | null> {
  if (args.anchorWalletsFile) {
    return JSON.parse(readFileSync(args.anchorWalletsFile, 'utf8')) as Record<string, unknown>;
  }
  if (args.noIssuerHistory) return null;
  const historyUrl = historyUrlFromReceipt(receipt);
  const epochOrigin = (() => {
    if (!args.epochUrl) return null;
    try { return new URL(args.epochUrl).origin; } catch { return null; }
  })();
  const origin = epochOrigin || (historyUrl ? new URL(historyUrl).origin : null);
  if (!origin) return null;
  const url = `${origin}/.well-known/anchor-wallets.json`;
  if (!historyHostAllowed(url)) return null;
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(4000) });
    if (res.status === 404) return null;
    if (!res.ok) return null;
    return await res.json() as Record<string, unknown>;
  } catch {
    return null;
  }
}

async function runAnchor(args: ReturnType<typeof parseArgs>): Promise<number> {
  const receiptPath = args.file;
  const inclusionPath = args.inclusionFile || args.positionals[1] || null;
  const headPath = args.headFile || (args.inclusionFile ? null : args.positionals[2]) || null;
  const headCandidates = [args.headFile, headPath, ...args.positionals];
  if (headCandidates.some((file) => file && headStatus(file) === 'not_yet_published')) {
    console.error('Tree head is not_yet_published.');
    return 3;
  }
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
  let fileJwks: Jwks | undefined;
  if (args.jwksFile) {
    try {
      fileJwks = JSON.parse(readFileSync(args.jwksFile, 'utf8')) as Jwks;
    } catch (err) {
      console.error(`Error reading JWKS file: ${err instanceof Error ? err.message : String(err)}`);
      return 3;
    }
  }
  const loaded = await loadIssuerJwks(receipt as { verification?: { jwks_uri?: string }; issuer_signature?: { jws?: string } }, {
    jwks: fileJwks,
    jwksUri: args.jwksUrl || undefined,
    fetchJwks: args.fetchJwks,
  });
  const trustedKids = args.noTrustedKid
    ? []
    : (args.trustedKids ?? [...DEFAULT_TRUSTED_ISSUER_KIDS]);
  let issuerHistory: IssuerHistoryDocument | null = null;
  let anchorWalletDocument: Record<string, unknown> | null = null;
  try {
    issuerHistory = await loadAnchorIssuerHistory(args, receipt as { verification?: { jwks_uri?: string }; verify_url?: string });
    anchorWalletDocument = await loadAnchorWalletDocument(args, receipt as { verification?: { jwks_uri?: string }; verify_url?: string });
  } catch (err) {
    console.error(`Error reading issuer trust files: ${err instanceof Error ? err.message : String(err)}`);
    return 3;
  }
  let epochRecord: EpochRecord | null = null;
  let verifyEpochSignature: ((jws: string) => boolean) | undefined;
  if (headNeedsEpochRecord(head)) {
    try {
      epochRecord = await loadEpochRecord(args, receipt as { verify_url?: string | null });
    } catch {
      epochRecord = null;
    }
    if (epochRecord?.issuer_signature?.jws) {
      verifyEpochSignature = (jws) => epochSignatureOk(epochRecord as EpochRecord, jws, loaded.jwks, trustedKids);
    }
  }
  const result = await verifyAnchoredRoot({
    receipt,
    inclusion,
    head,
    baseRpcUrl: args.rpcUrl || undefined,
    solanaRpcUrl: args.solanaRpcUrl || undefined,
    checkNewestAnchor: args.sawRpc,
    epochRecord,
    verifyEpochSignature,
    jwks: loaded.jwks,
    trustedKids,
    issuerHistory,
    strictIssuerHistory: args.strictIssuerHistory,
    anchorWalletDocument: anchorWalletDocument as {
      schema?: string;
      base?: unknown;
      solana?: unknown;
      issuer_signature?: { jws?: string };
    } | null,
  });
  let canonicalPreimage: string | null = null;
  if (args.canonicalPreimageFile) {
    canonicalPreimage = readFileSync(args.canonicalPreimageFile, 'utf8');
  }
  const historyBytes = args.issuerHistoryFile ? readFileSync(args.issuerHistoryFile, 'utf8') : null;
  const verified = await verifyReceipt(receipt as unknown as XFuelReceipt, {
    jwks: loaded.jwks,
    jwksUri: args.jwksUrl || undefined,
    fetchJwks: args.fetchJwks,
    trustedKids,
    checkNullifier: args.checkNullifier,
    checkPayer: args.checkPayer,
    rpcUrl: args.rpcUrl || undefined,
    solanaRpcUrl: args.solanaRpcUrl || undefined,
    requirePreimages: !args.noPreimage,
    issuerHistory: args.issuerHistoryFile ? issuerHistory : null,
    issuerHistoryBytes: historyBytes,
    fetchIssuerHistory: !args.noIssuerHistory && !args.issuerHistoryFile,
    strictIssuerHistory: args.strictIssuerHistory,
    skipIssuerHistory: args.noIssuerHistory,
    canonicalPreimage,
    head,
  });
  // Inclusion was already checked above. Passing it again re-derives the leaf
  // from book_chain.row_hash only, which rejects a receipt that stores row_hash
  // at the top level. Signature and signed-versus-outer comparison are the
  // receipt checks log mode adds. A signed receipt that fails those, or any
  // other single-receipt check, cannot be VERIFIED.
  const issuerSig = (receipt as { issuer_signature?: { jws?: string; value?: string } }).issuer_signature;
  const signedReceipt = Boolean(issuerSig?.jws || issuerSig?.value);
  const receiptFailed = verified.claim_mismatches.length > 0
    || (signedReceipt && verified.overall === 'failed');
  const errors = receiptFailed
    ? [...result.errors, ...verified.errors.filter((err) => !result.errors.includes(err))]
    : result.errors;
  const combined = {
    ...result,
    errors,
    overall: receiptFailed ? 'failed' as const : result.overall,
    receipt_lane: verified.receipt_lane,
    receipt_check: {
      overall: verified.overall,
      verified_scope: verified.verified_scope,
      claim_mismatches: verified.claim_mismatches,
      unsigned_fields: verified.unsigned_fields,
      errors: verified.errors,
    },
  };
  if (args.json) {
    console.log(JSON.stringify(combined, null, 2));
  } else {
    printAnchor(combined, false, args.quiet);
    if (!args.quiet || receiptFailed) {
      const receiptLabel = result.overall === 'pending' ? 'PENDING' : verified.overall.toUpperCase();
      console.log(`  Receipt checks: ${receiptLabel} (signed claims only)`);
      if (verified.claim_mismatches.length > 0) {
        for (const mismatch of verified.claim_mismatches) {
          console.log(`  ${mismatch.field}: outer ${mismatch.outer} ≠ signed ${mismatch.signed}`);
        }
      }
      printUnsigned(verified.unsigned_fields);
      console.log('');
    }
    if (!args.quiet) printLane(verified.receipt_lane);
  }
  if (combined.overall === 'verified') return 0;
  if (combined.overall === 'partial' || combined.overall === 'pending') return 2;
  return 1;
}

function printUnsigned(fields: string[]): void {
  console.log('  Scope:         signed claims only. Unsigned fields are UNVERIFIED.');
  if (fields.length === 0) return;
  console.log(`  Unsigned fields (${fields.length})`);
  console.log('  ─────────────────────────────────────────────────');
  for (const field of fields) console.log(`  UNVERIFIED     ${field}`);
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
    ? { checked: false, ok: true, unreachable: false, warning: null, reason: null, kid: result.kid ?? null, document: null, loaded: false }
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
  if (args.version) {
    console.log(`@xfuel/verify ${packageVersion()}`);
    return 0;
  }
  let anchorMode = args.anchorFlag
    || Boolean(args.inclusionFile || args.headFile)
    || (args.positionals.length >= 3 && args.sawRpc);
  if (!anchorMode && args.sawRpc && args.positionals.some((file) => fileLooksLikeHead(file))) {
    anchorMode = true;
  }

  if (args.help) {
    console.log(HELP);
    return 0;
  }
  let offlineWitness: ReturnType<typeof readOfflineWitness> | null = null;
  if (!anchorMode) {
    try {
      offlineWitness = readOfflineWitness(args);
    } catch (err) {
      console.error(err instanceof Error ? err.message : String(err));
      return 3;
    }
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

  const carryAsked = args.carryOldHeadFile || args.carryOldInclusionFile
    || args.carryHeadFile || args.carryInclusionFiles.length > 0;
  let carry: {
    oldHead: CarryHead;
    oldInclusion: CarryInclusion;
    currentHead: CarryHead;
    currentInclusions: CarryInclusion[];
  } | null = null;
  if (carryAsked) {
    try {
      carry = {
        oldHead: args.carryOldHeadFile ? readJson(args.carryOldHeadFile) as CarryHead : {},
        oldInclusion: args.carryOldInclusionFile ? readJson(args.carryOldInclusionFile) as CarryInclusion : { error: 'not_in_tree' },
        currentHead: args.carryHeadFile ? readJson(args.carryHeadFile) as CarryHead : {},
        currentInclusions: args.carryInclusionFiles.length > 0
          ? args.carryInclusionFiles.map((file) => readJson(file) as CarryInclusion)
          : [{ error: 'not_in_tree' }],
      };
    } catch (err) {
      console.error(`Error reading carry-forward files: ${err instanceof Error ? err.message : String(err)}`);
      return 3;
    }
  }

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
    head: offlineWitness?.head ?? undefined,
    inclusion: offlineWitness?.inclusion ?? undefined,
    carry,
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
    printUnsigned(result.unsigned_fields);
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
    if (result.carry_forward?.status === 'VERIFIED_CARRIED_FORWARD') {
      const carried = result.carry_forward;
      console.log(`  Log`);
      console.log(`  ─────────────────────────────────────────────────`);
      console.log(`  Status:        ${carried.status}`);
      console.log(`  Issued at:     ${carried.issued_at}`);
      console.log(`  Issued epoch:  ${carried.issued_epoch}`);
      console.log(`  Logged at:     ${carried.logged_at}`);
      console.log(`  Logged epoch:  ${carried.logged_epoch}`);
      console.log(`  Leaf index:    ${carried.leaf_index}`);
      console.log('');
    }
    console.log(`  Overall: ${result.overall.toUpperCase()}`);
    if (result.errors.length > 0) {
      console.log(`  Errors:  ${result.errors.join(', ')}`);
    }
    console.log('');
  }

  switch (result.overall) {
    case 'verified':
    case 'verified_carried_forward':
      return 0;
    case 'failed':
      return 1;
    case 'partial':
      return 2;
    default:
      return 1;
  }
}

/**
 * Node's fetch keeps its undici agent on this symbol after the first request.
 * There is no public handle for that pool. Closing it lets the loop drain.
 */
const UNDICI_GLOBAL_DISPATCHER = Symbol.for('undici.globalDispatcher.1');

type FetchDispatcher = {
  close?: () => Promise<void> | void;
  destroy?: () => Promise<void> | void;
};

function fetchDispatcher(): FetchDispatcher | undefined {
  const bag = globalThis as unknown as Record<symbol, FetchDispatcher | undefined>;
  return bag[UNDICI_GLOBAL_DISPATCHER];
}

/**
 * process.exit() while a fetch keep-alive socket is already CLOSING aborts
 * on Windows: Assertion failed: !(handle->flags & UV_HANDLE_CLOSING)
 * (src/win/async.c). Set the code and close the pool so the loop can drain.
 */
async function finish(code: number): Promise<void> {
  process.exitCode = code;
  const dispatcher = fetchDispatcher();
  if (!dispatcher) return;
  try {
    const closing = dispatcher.close?.();
    if (closing) await closing;
  } catch {
    try {
      await dispatcher.destroy?.();
    } catch {
      // The verification result is already the exit code.
    }
  }
}

main()
  .then((code) => finish(code))
  .catch((err) => {
    console.error('Unexpected error:', err);
    return finish(3);
  });
