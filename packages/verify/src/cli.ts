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
 *   0 = VERIFIED (every check passed)
 *   1 = INVALID
 *   2 = COULD_NOT_CHECK
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
import {
  compareShellToJws,
  decodeJwsPayload,
  holderDocumentFromOwnerView,
  INCLUDED_SHELL_LINE,
  isReceiptShell,
  openV11Commitment,
  shellHolderVerdict,
} from './shell.js';
import { type ReceiptLane } from './receipt-lane.js';
import { verifyPublishedPreimages } from './preimage.js';
import {
  checkReceiptIssuerHistory,
  historyUrlFromReceipt,
  readIssuerHistoryPin,
  resolveIssuerHistory,
  type IssuerHistoryDocument,
  type ResolvedIssuerHistory,
} from './issuer-history.js';
import { BASE_RPC_URL } from './base-payer.js';
import { SOLANA_RPC_URL } from './solana-payer.js';
import { buildVerifyVerdict, humanVerdictLines, overallLine, type CheckState, type VerifyVerdict } from './verdict.js';
import { verifyCanonicalPreimageBytes } from './canonical-preimage.js';
import { readOpenFile } from './v11-receipt.js';
import {
  classifyReceiptDocument,
  classifyShellDocument,
  formatSupportedReceiptVersions,
} from './receipt-version.js';
import { readIssuerPinClaim, type AssessIssuerPinInput, type IssuerPinRef } from './issuer-pin.js';
import { HEAD_TRUST_MESSAGES, LEGACY_HEAD_UNPINNED_SIGNER, verifyTreeHeadTrust } from './anchor-trust.js';
import {
  isPublicRecordAttempt,
  publicRecordJson,
  readCompactPayload,
  verifyPublicRecord,
  type PublicRecordResult,
} from './public-record.js';
import type { CarryHead, CarryInclusion } from './carry-forward.js';

const HELP = `
chit402-verify — verify a Chit402 receipt

Usage:
  chit402-verify <id|url|receipt.json>
  chit402-verify - < receipt.json
  chit402-verify <receipt.json> --issuer-history <history.json>
  chit402-verify <receipt.json> --json

Exit codes:
  0  VERIFIED           every check passed
                         A chit402.public.v1 record prints PUBLIC_VERIFIED
                         (scope public). That is not a full-receipt VERIFIED.
  1  INVALID            tamper, bad signature, revoked key, NOT_IN_LOG
  2  COULD_NOT_CHECK    log or anchor was not checked

Flags:
  --issuer-history <file>   History that prefix-extends the bundled snapshot
  --json                    Print the verdict JSON
  --help
  --version

${formatSupportedReceiptVersions()}
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
  strict: boolean;
  noPreimage: boolean;
  issuerPinFile: string | null;
  issuerPinCommit: string | null;
  issuerPinSha256: string | null;
  issuerPinSigFile: string | null;
  issuerWitnessesFile: string | null;
  issuerPriorPinFile: string | null;
  issuerPriorCommit: string | null;
  issuerPriorSha256: string | null;
  issuerControlFile: string | null;
  version: boolean;
  anchorWalletsFile: string | null;
  acceptShell: boolean;
  jwsFile: string | null;
  salt: string | null;
  open: string[];
  url: string | null;
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
    strict: false,
    noPreimage: false,
    issuerPinFile: null as string | null,
    issuerPinCommit: null as string | null,
    issuerPinSha256: null as string | null,
    issuerPinSigFile: null as string | null,
    issuerWitnessesFile: null as string | null,
    issuerPriorPinFile: null as string | null,
    issuerPriorCommit: null as string | null,
    issuerPriorSha256: null as string | null,
    issuerControlFile: null as string | null,
    version: false,
    anchorWalletsFile: null as string | null,
    acceptShell: false,
    jwsFile: null as string | null,
    salt: null as string | null,
    open: [] as string[],
    url: null as string | null,
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
    } else if (arg === '--issuer-history' && args[i + 1]) {
      result.issuerHistoryFile = args[++i];
    } else if (arg === '--salt' && args[i + 1]) {
      result.salt = args[++i];
    } else if (arg === '--open' && args[i + 1]) {
      result.open.push(args[++i]);
    } else if (arg === '--canonical-preimage' && args[i + 1]) {
      result.canonicalPreimageFile = args[++i];
    } else if (arg === '--anchor-wallets-file' && args[i + 1]) {
      result.anchorWalletsFile = args[++i];
    } else if (arg === '--no-preimage') {
      result.noPreimage = true;
    } else if (arg === '--jws' && args[i + 1]) {
      result.jwsFile = args[++i];
    } else if (arg === '--url' && args[i + 1]) {
      result.url = args[++i];
    } else if (arg === '--issuer-pin' && args[i + 1]) {
      result.issuerPinFile = args[++i];
    } else if (arg === '--issuer-pin-commit' && args[i + 1]) {
      result.issuerPinCommit = args[++i];
    } else if (arg === '--issuer-pin-sha256' && args[i + 1]) {
      result.issuerPinSha256 = args[++i];
    } else if (arg === '--issuer-pin-sig' && args[i + 1]) {
      result.issuerPinSigFile = args[++i];
    } else if (arg === '--issuer-witnesses' && args[i + 1]) {
      result.issuerWitnessesFile = args[++i];
    } else if (arg === '--issuer-prior-pin' && args[i + 1]) {
      result.issuerPriorPinFile = args[++i];
    } else if (arg === '--issuer-prior-commit' && args[i + 1]) {
      result.issuerPriorCommit = args[++i];
    } else if (arg === '--issuer-prior-sha256' && args[i + 1]) {
      result.issuerPriorSha256 = args[++i];
    } else if (arg === '--issuer-control' && args[i + 1]) {
      result.issuerControlFile = args[++i];
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

function printAnchor(result: AnchorWitnessResult, json: boolean, quiet: boolean, overallLabel?: string): void {
  if (json) {
    console.log(JSON.stringify(result, null, 2));
    return;
  }
  if (quiet && result.overall !== 'failed' && result.overall !== 'not_in_log') return;
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
  if (result.issuer_pin?.checked) {
    console.log(`  Issuer pin:    ${result.issuer_pin.ok ? '✓ YES' : '✗ NO'}${result.issuer_pin.code ? ` (${result.issuer_pin.code})` : ''}`);
  }
  console.log(`  Base:          ${result.base.checked ? mark(result.base.valid) : (result.base.reason || 'not checked')}`);
  if (result.base.from) console.log(`  Base from:     ${result.base.from}`);
  if (result.base.tx) console.log(`  Base tx:       ${result.base.tx}`);
  if (result.base.chain_id != null) console.log(`  Chain id:      ${result.base.chain_id}`);
  if (result.base.reason && !result.base.valid) console.log(`  Base reason:   ${result.base.reason}`);
  console.log('');
  if (result.overall !== 'failed' && result.overall !== 'not_in_log') {
    console.log('  What this proves');
    console.log('  ─────────────────────────────────────────────────');
    for (const line of result.proves) console.log(`  ${line}`);
    console.log('');
  }
  console.log('  What this does not prove');
  console.log('  ─────────────────────────────────────────────────');
  for (const line of result.does_not_prove) console.log(`  ${line}`);
  console.log('');
  if (result.overall === 'pending') {
    console.log(`  Anchored size: ${result.inclusion.anchored_tree_size ?? '—'}`);
    console.log(`  Live size:     ${result.inclusion.live_tree_size ?? '—'}`);
  }
  console.log(`  Overall: ${overallLabel || result.overall.toUpperCase()}`);
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

const REMOVED_040: Record<string, string> = {
  '--strict': 'removed in 0.4: a skipped key window is no longer a separate result',
  '--no-issuer-history': 'removed in 0.4: the history check is always on',
  '--accept-no-key-window': 'removed in 0.4: VERIFIED_NO_KEY_WINDOW is retired',
  '--accept-shell': 'removed in 0.4: a shell is not a verified payment',
};

function removedFlag(argv: string[]): string | null {
  for (const arg of argv) {
    if (REMOVED_040[arg]) return REMOVED_040[arg];
  }
  return null;
}

async function resolvedHistory(
  args: { issuerHistoryFile: string | null },
  receipt: { verification?: { jwks_uri?: string }; verify_url?: string },
  jwks: Jwks | undefined,
  trustedKids: readonly string[],
): Promise<ResolvedIssuerHistory> {
  const fileBytes = args.issuerHistoryFile ? readFileSync(args.issuerHistoryFile, 'utf8') : null;
  return resolveIssuerHistory({
    fileBytes,
    receipt,
    jwks,
    trustedKids,
  });
}

function historyOptions(resolved: ResolvedIssuerHistory): {
  issuerHistory: IssuerHistoryDocument | null;
  issuerHistoryBytes: string | null;
  fetchIssuerHistory: false;
  skipIssuerHistory: false;
  strictIssuerHistory: false;
  labelSkippedKeyWindow: false;
} {
  return {
    issuerHistory: resolved.document,
    issuerHistoryBytes: resolved.bytes,
    fetchIssuerHistory: false,
    skipIssuerHistory: false,
    strictIssuerHistory: false,
    labelSkippedKeyWindow: false,
  };
}

function printVerdict(
  json: boolean,
  verdict: VerifyVerdict,
  legacy: Record<string, unknown> | null,
  legacyOverall?: string | null,
): number {
  const line = overallLine(verdict, legacyOverall);
  if (json) {
    const overall = line === 'NOT_IN_LOG'
      ? 'not_in_log'
      : line === 'VERIFIED_CARRIED_FORWARD'
        ? 'verified_carried_forward'
        : line === 'PENDING'
          ? 'pending'
          : line === 'PARTIAL'
            ? 'partial'
            : line === 'VERIFIED'
              ? 'verified'
              : line === 'COULD_NOT_CHECK'
                ? 'could_not_check'
                : 'failed';
    console.log(JSON.stringify({ ...(legacy || {}), ...verdict, overall }, null, 2));
  } else {
    console.log(`  Overall: ${line}`);
    console.log(`  ${verdict.message}`);
    if (verdict.history.source === 'bundled' && verdict.history.as_of) {
      console.log(`  Issuer history: as of ${verdict.history.as_of}`);
    }
    if (verdict.next_step) console.log(`  Next: ${verdict.next_step}`);
  }
  return verdict.exit_code;
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

const LOG_FETCH_MS = 8000;

function inclusionHeadUrl(
  origin: string,
  inclusion: { head_url?: string; tree_size?: number | null; anchored_tree_size?: number | null },
): string | null {
  if (typeof inclusion.head_url === 'string' && inclusion.head_url.length > 0) {
    try {
      return new URL(inclusion.head_url, origin).toString();
    } catch {
      return null;
    }
  }
  const size = inclusion.anchored_tree_size ?? inclusion.tree_size;
  if (size == null) return null;
  return `${origin}/v1/receipts/tree/head?tree_size=${encodeURIComponent(String(size))}`;
}

type FreshLog = {
  logInclusion: CheckState;
  anchor: CheckState;
  logReason: string | null;
  log: VerifyVerdict['log'];
};

function missedLog(reason = 'log_unreachable'): FreshLog {
  return {
    logInclusion: 'could_not_check',
    anchor: 'could_not_check',
    logReason: reason,
    log: null,
  };
}

/**
 * A 404 `{ error: "not_in_tree" }` is unsigned. NOT_IN_LOG also needs the
 * log's signed head, and that signature has to verify. A head with no
 * signature leaves the check unfinished.
 */
async function absenceAgainstSignedHead(
  origin: string,
  history: IssuerHistoryDocument | null,
): Promise<{ kind: 'not_in_log' } | { kind: 'unchecked' } | { kind: 'bad_head'; reason: string }> {
  try {
    const res = await fetch(`${origin}/v1/receipts/tree/head`, {
      headers: { accept: 'application/json' },
      signal: AbortSignal.timeout(LOG_FETCH_MS),
    });
    if (!res.ok) return { kind: 'unchecked' };
    const head = await res.json() as AnchorHead;
    const trust = verifyTreeHeadTrust(head, {
      trustedKids: DEFAULT_TRUSTED_ISSUER_KIDS,
      issuerHistory: history,
    });
    if (trust.ok) return { kind: 'not_in_log' };
    if (!trust.reason || trust.reason === 'head_signature_missing') return { kind: 'unchecked' };
    return { kind: 'bad_head', reason: trust.reason };
  } catch {
    return { kind: 'unchecked' };
  }
}

function hardLogReason(result: AnchorWitnessResult): string | null {
  if (result.head_signature?.checked && result.head_signature.valid === false && result.head_signature.reason) {
    return result.head_signature.reason;
  }
  const inclusionReason = result.inclusion?.reason;
  if (
    result.inclusion
    && result.inclusion.valid === false
    && inclusionReason
    && inclusionReason !== 'pending_anchor'
    && inclusionReason !== 'not_in_tree'
  ) {
    return inclusionReason;
  }
  const mismatch = (result.errors || []).find((err) => (
    /mismatch|head_signature|head_claims|head_key|inclusion_failed|bad_root|no_leaf/.test(err)
  ));
  return mismatch ? mismatch.replace(/^(solana|base):/, '') : null;
}

/** Shell absence check. A 200 proof is not verified here: there is no signed receipt. */
async function publicShellAbsence(
  receipt: { verify_url?: string; task_id?: string | null },
  history: IssuerHistoryDocument | null,
): Promise<boolean> {
  try {
    const origin = new URL(String(receipt.verify_url)).origin;
    const task = receipt.task_id;
    if (!task) return false;
    const res = await fetch(`${origin}/v1/receipts/${encodeURIComponent(String(task))}/inclusion`, {
      headers: { accept: 'application/json' },
      signal: AbortSignal.timeout(LOG_FETCH_MS),
    });
    if (res.status !== 404) return false;
    const body = await res.json().catch(() => ({})) as { error?: string; reason?: string };
    if (body.error !== 'not_in_tree' && body.reason !== 'not_in_tree') return false;
    const absence = await absenceAgainstSignedHead(origin, history);
    return absence.kind === 'not_in_log';
  } catch {
    return false;
  }
}

async function freshPublicLog(
  receipt: { verify_url?: string; task_id?: string | null },
  history: IssuerHistoryDocument | null = null,
): Promise<FreshLog> {
  const missed = missedLog();
  try {
    const origin = new URL(String(receipt.verify_url)).origin;
    const task = receipt.task_id;
    if (!task) return missed;
    const res = await fetch(`${origin}/v1/receipts/${encodeURIComponent(String(task))}/inclusion`, {
      headers: { accept: 'application/json' },
      signal: AbortSignal.timeout(LOG_FETCH_MS),
    });
    if (res.status === 404) {
      const body = await res.json().catch(() => ({})) as { error?: string; reason?: string };
      if (body.error !== 'not_in_tree' && body.reason !== 'not_in_tree') return missed;
      const absence = await absenceAgainstSignedHead(origin, history);
      if (absence.kind === 'not_in_log') {
        return { logInclusion: 'fail', anchor: 'pass', logReason: 'not_in_log', log: null };
      }
      if (absence.kind === 'bad_head') {
        return { logInclusion: 'fail', anchor: 'fail', logReason: absence.reason, log: null };
      }
      return missed;
    }
    if (!res.ok) return missed;
    const inclusion = await res.json() as AnchorInclusion & {
      head_url?: string;
      anchored_tree_size?: number;
    };
    const headUrl = inclusionHeadUrl(origin, inclusion);
    if (!headUrl) return missed;
    const headRes = await fetch(headUrl, {
      headers: { accept: 'application/json' },
      signal: AbortSignal.timeout(LOG_FETCH_MS),
    });
    if (!headRes.ok) return missed;
    const head = await headRes.json() as AnchorHead;
    const result = await verifyAnchoredRoot({
      receipt: receipt as AnchorReceipt,
      inclusion,
      head,
      baseRpcUrl: process.env.BASE_RPC_URL || BASE_RPC_URL,
      solanaRpcUrl: process.env.SOLANA_RPC_URL || SOLANA_RPC_URL,
      checkNewestAnchor: false,
      issuerHistory: history,
      trustedKids: DEFAULT_TRUSTED_ISSUER_KIDS,
    });
    if (result.overall === 'verified') {
      return {
        logInclusion: 'pass',
        anchor: 'pass',
        logReason: null,
        log: {
          leaf_index: inclusion.leaf_index ?? null,
          tree_size: inclusion.tree_size ?? null,
          root: result.root,
          anchors: {
            base: result.base.tx,
            solana: result.solana.signature,
          },
        },
      };
    }
    if (result.overall === 'not_in_log') {
      return { logInclusion: 'fail', anchor: 'pass', logReason: 'not_in_log', log: null };
    }
    if (result.overall === 'pending') return missedLog('pending_anchor');
    const hard = hardLogReason(result);
    if (result.overall === 'failed' && hard) {
      const anchorFail = /head_|anchor|mismatch/.test(hard);
      const inclusionFail = result.inclusion?.valid === false || /inclusion|leaf|root|no_leaf|bad_root/.test(hard);
      return {
        logInclusion: inclusionFail ? 'fail' : 'could_not_check',
        anchor: anchorFail || !inclusionFail ? 'fail' : 'pass',
        logReason: hard,
        log: null,
      };
    }
    return missed;
  } catch {
    return missed;
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
  jwks: Jwks | undefined,
  trustedKids: readonly string[],
): Promise<ResolvedIssuerHistory> {
  return resolvedHistory(args, receipt, jwks, trustedKids);
}

async function loadAnchorWalletDocument(
  args: ReturnType<typeof parseArgs>,
  receipt: { verification?: { jwks_uri?: string }; verify_url?: string },
): Promise<Record<string, unknown> | null> {
  if (args.anchorWalletsFile) {
    return JSON.parse(readFileSync(args.anchorWalletsFile, 'utf8')) as Record<string, unknown>;
  }
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

function emitVersionFailure(
  args: { json: boolean },
  errors: string[],
): number {
  const reason = errors[0] || 'unsupported_version';
  const unsupported = reason === 'unsupported_version';
  const verdict = buildVerifyVerdict({
    version: packageVersion(),
    errors,
    signatureChecked: !unsupported,
    signatureValid: unsupported ? null : false,
    historyMissing: unsupported,
    logInclusion: 'unclaimed',
    anchor: 'unclaimed',
  });
  if (!args.json) console.log(reason);
  return printVerdict(args.json, verdict, {
    errors,
    issuer_signature: { valid: false, checked: !unsupported, key_trusted: false, reason },
    amount_usdc: null,
    tx: null,
    payer: { checked: false, valid: false },
  }, unsupported ? 'could_not_check' : 'failed');
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
  const anchorGate = classifyReceiptDocument(receipt);
  if (!anchorGate.ok) return emitVersionFailure(args, anchorGate.errors);
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
  let resolved: ResolvedIssuerHistory;
  let anchorWalletDocument: Record<string, unknown> | null = null;
  try {
    resolved = await loadAnchorIssuerHistory(
      args,
      receipt as { verification?: { jwks_uri?: string }; verify_url?: string },
      loaded.jwks,
      trustedKids,
    );
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
  let issuerPin: AssessIssuerPinInput | undefined;
  const pinClaim = readIssuerPinClaim(receipt).claimed || readIssuerPinClaim(head).claimed;
  const pinRequested = Boolean(args.issuerPinFile) || pinClaim;
  if (pinRequested) {
    try {
      const claimRef = readIssuerPinClaim(receipt).ref || readIssuerPinClaim(head).ref;
      const ref: IssuerPinRef | null = (args.issuerPinCommit || args.issuerPinSha256 || claimRef)
        ? {
          commit: args.issuerPinCommit || claimRef?.commit || '',
          path: claimRef?.path || 'docs/well-known/issuer-key.json',
          sha256: (args.issuerPinSha256 || claimRef?.sha256 || '').toLowerCase(),
        }
        : null;
      let witnesses: unknown;
      if (args.issuerWitnessesFile) witnesses = JSON.parse(readFileSync(args.issuerWitnessesFile, 'utf8'));
      const priorRef: IssuerPinRef | null = args.issuerPriorPinFile
        ? {
          commit: args.issuerPriorCommit || '',
          path: 'docs/well-known/issuer-key.json',
          sha256: (args.issuerPriorSha256 || '').toLowerCase(),
        }
        : null;
      issuerPin = {
        pinBytes: args.issuerPinFile ? readFileSync(args.issuerPinFile, 'utf8') : null,
        sigBytes: args.issuerPinSigFile ? readFileSync(args.issuerPinSigFile, 'utf8') : null,
        ref,
        witnesses,
        priorPinBytes: args.issuerPriorPinFile ? readFileSync(args.issuerPriorPinFile, 'utf8') : null,
        priorRef,
        controlJws: args.issuerControlFile ? readFileSync(args.issuerControlFile, 'utf8').trim() : null,
        required: true,
      };
    } catch (err) {
      console.error(`Error reading issuer pin: ${err instanceof Error ? err.message : String(err)}`);
      return 3;
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
    issuerPin,
    jwks: loaded.jwks,
    trustedKids,
    issuerHistory: resolved.document,
    strictIssuerHistory: false,
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
    ...historyOptions(resolved),
    canonicalPreimage,
    head,
  });
  // Inclusion was already checked above. Passing it again re-derives the leaf
  // from book_chain.row_hash only, which rejects a receipt that stores row_hash
  // at the top level. Log mode still requires the receipt itself. A missing or
  // stripped issuer signature, a partial check, or a signed-versus-outer
  // mismatch fails the combined result. An inclusion match is not VERIFIED.
  const issuerSig = (receipt as { issuer_signature?: { jws?: string; value?: string } }).issuer_signature;
  const signaturePresent = Boolean(issuerSig?.jws || issuerSig?.value);
  const historyMiss = verified.issuer_history.reason === 'kid_not_in_history' || resolved.document == null;
  const historyOnly = historyMiss
    && verified.claim_mismatches.length === 0
    && verified.errors.every((err) => /issuer history|kid_not_in_history/.test(err));
  const receiptVerified = signaturePresent
    && verified.issuer_signature.valid === true
    && (verified.overall === 'verified' || verified.overall === 'verified_carried_forward' || historyOnly)
    && verified.claim_mismatches.length === 0;
  const receiptFailed = !receiptVerified;
  const receiptErrors = [...verified.errors];
  if (!signaturePresent) {
    receiptErrors.push(verified.issuer_signature.reason || 'receipt_signature_missing');
  } else if (verified.issuer_signature.valid !== true && verified.issuer_signature.reason) {
    receiptErrors.push(verified.issuer_signature.reason);
  } else if (verified.overall === 'partial') {
    receiptErrors.push(verified.issuer_signature.reason || 'receipt_check_partial');
  }
  const errors = receiptFailed
    ? [...result.errors, ...receiptErrors.filter((err) => !result.errors.includes(err))]
    : result.errors;
  const logMiss = result.overall === 'not_in_log';
  const anchorOverall = logMiss
    ? 'not_in_log' as const
    : receiptFailed
      ? 'failed' as const
      : result.overall;
  const combined = {
    ...result,
    errors,
    overall: anchorOverall,
    receipt_lane: verified.receipt_lane,
    receipt_check: {
      overall: result.overall === 'pending' && !receiptFailed ? 'pending' as const : verified.overall,
      verified_scope: verified.verified_scope,
      claim_mismatches: verified.claim_mismatches,
      unsigned_fields: verified.unsigned_fields,
      errors: verified.errors,
    },
  };
  const logState = anchorLogState(result);
  const verdict = buildVerifyVerdict({
    version: packageVersion(),
    receiptId: verified.receipt_id,
    displayId: displayIdOf(receipt),
    payloadVersion: verified.receipt_version ?? null,
    historySource: resolved.source,
    historyHead: resolved.headHash,
    historyCount: resolved.entryCount,
    historyAsOf: resolved.asOf,
    signatureValid: signaturePresent && verified.issuer_signature.valid === true,
    signatureChecked: true,
    historyChecked: verified.issuer_history.checked,
    historyOk: verified.issuer_history.ok,
    historyReason: resolved.invalid ? (resolved.reason || verified.issuer_history.reason) : verified.issuer_history.reason,
    historyMissing: resolved.document == null && !resolved.invalid,
    bindingExpected: !!verified.binding.expected,
    bindingMatches: verified.binding.matches,
    claimMismatches: verified.claim_mismatches.length,
    payerChecked: verified.payer.checked,
    payerValid: verified.payer.valid,
    errors: errors,
    logInclusion: logState.logInclusion,
    anchor: logState.anchor,
    logReason: logState.logReason,
    log: {
      leaf_index: inclusion.leaf_index ?? null,
      tree_size: inclusion.tree_size ?? null,
      root: result.root,
      anchors: {
        base: result.base.tx,
        solana: result.solana.signature,
      },
    },
  });
  if (args.json) {
    return printVerdict(true, verdict, combined as unknown as Record<string, unknown>, anchorOverall);
  }
  printAnchor(combined, false, args.quiet, overallLine(verdict, anchorOverall));
  if (!args.quiet || receiptFailed || verdict.result !== 'verified') {
    const anchorPending = result.overall === 'pending';
    const receiptLabel = anchorPending && !receiptFailed
      ? 'PENDING'
      : overallLine(verdict, verified.overall);
    console.log(`  Receipt checks: ${receiptLabel} (signed claims only)`);
    if (verified.claim_mismatches.length > 0) {
      for (const mismatch of verified.claim_mismatches) {
        console.log(`  ${mismatch.field}: outer ${mismatch.outer} ≠ signed ${mismatch.signed}`);
      }
    }
    if (!(anchorPending && !receiptFailed)) printUnsigned(verified.unsigned_fields);
    console.log('');
  }
  if (!args.quiet) printLane(verified.receipt_lane);
  console.log(`  ${verdict.message}`);
  if (verdict.history.source === 'bundled' && verdict.history.as_of) {
    console.log(`  Issuer history: as of ${verdict.history.as_of}`);
  }
  return verdict.exit_code;
}

function anchorLogState(result: AnchorWitnessResult): {
  logInclusion: CheckState | 'unclaimed';
  anchor: CheckState | 'unclaimed';
  logReason: string | null;
} {
  if (result.overall === 'not_in_log') {
    return { logInclusion: 'fail', anchor: 'pass', logReason: 'not_in_log' };
  }
  if (result.overall === 'pending' || result.overall === 'partial') {
    return {
      logInclusion: result.inclusion.valid ? 'pass' : 'could_not_check',
      anchor: 'could_not_check',
      logReason: result.overall === 'pending' ? 'pending_anchor' : (result.errors[0] || 'partial'),
    };
  }
  if (result.inclusion && result.inclusion.valid === false) {
    return {
      logInclusion: 'fail',
      anchor: 'fail',
      logReason: result.errors[0] || result.inclusion.reason || 'log_inclusion',
    };
  }
  if (result.overall === 'failed') {
    return { logInclusion: 'pass', anchor: 'fail', logReason: result.errors[0] || 'anchor' };
  }
  if (result.overall === 'verified') return { logInclusion: 'pass', anchor: 'pass', logReason: null };
  return { logInclusion: 'could_not_check', anchor: 'could_not_check', logReason: 'log_unreachable' };
}

function displayIdOf(receipt: { task_id?: string; display_id?: string; receipt_id?: string }): string | null {
  if (typeof receipt.display_id === 'string' && receipt.display_id) return receipt.display_id;
  const id = receipt.task_id || receipt.receipt_id || '';
  const short = id.match(/^(chit-[0-9a-f]{8})/i);
  return short ? short[1] : (id || null);
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
    resolved: ResolvedIssuerHistory;
    canonicalPreimage: string | null;
  },
): Promise<number> {
  const trustedKids = args.trustedKids ?? DEFAULT_TRUSTED_ISSUER_KIDS;
  const refusalGate = classifyReceiptDocument(doc);
  if (!refusalGate.ok) return emitVersionFailure(args, refusalGate.errors);
  const result = verifyRefusal(doc, {
    jwks: args.jwks,
    trustedKids,
  });
  if (!result.valid && (result.errors[0] === 'unsupported_version' || result.reason === 'unsupported_version' || result.reason === 'payload_version_mismatch')) {
    return emitVersionFailure(args, result.errors.length ? result.errors : [result.reason || 'unsupported_version']);
  }
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
  const history = await checkReceiptIssuerHistory(doc as unknown as { verification?: { jwks_uri?: string }; verify_url?: string; created_at?: unknown }, {
    document: args.resolved.document,
    documentBytes: args.resolved.bytes,
    fetchHistory: false,
    strict: false,
    jwks: args.jwks,
    trustedKids,
    issuedAt: (doc as { issued_at?: string }).issued_at ?? null,
    kid: result.kid ?? doc.issuer_signature?.kid ?? null,
    pin,
    requirePin: result.valid && Number(result.payload_version) >= 2 && args.resolved.document != null,
  });
  const historyFailed = history.checked && !history.ok && history.reason !== 'kid_not_in_history';
  const failed = !result.valid || !preimages.ok || historyFailed || canonicalFailed;
  const verdict = buildVerifyVerdict({
    version: packageVersion(),
    receiptId: result.refusal_id || doc.refusal_id || null,
    displayId: result.refusal_id || doc.refusal_id || null,
    payloadVersion: result.payload_version ?? null,
    historySource: args.resolved.source,
    historyHead: args.resolved.headHash,
    historyCount: args.resolved.entryCount,
    historyAsOf: args.resolved.asOf,
    signatureValid: result.valid,
    signatureChecked: true,
    historyChecked: history.checked,
    historyOk: history.ok,
    historyReason: history.reason || args.resolved.reason,
    historyMissing: args.resolved.document == null,
    errors: [...result.errors, ...preimages.errors],
    logInclusion: 'unclaimed',
    anchor: 'unclaimed',
  });
  const overall = verdict.result === 'verified' ? 'verified' : verdict.result === 'could_not_check' ? 'could_not_check' : 'failed';
  if (args.json) {
    return printVerdict(true, verdict, { ...result, preimages, issuer_history: history, overall }, overall);
  } else if (!args.quiet || failed || verdict.result !== 'verified') {
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
    if (!failed) {
      console.log('  What this proves');
      console.log('  ─────────────────────────────────────────────────');
      for (const line of result.proves) console.log(`  ${line}`);
      console.log('');
    }
    console.log('  What this does not prove');
    console.log('  ─────────────────────────────────────────────────');
    for (const line of result.does_not_prove) console.log(`  ${line}`);
    console.log('');
    console.log(`  Overall: ${overallLine(verdict, overall)}`);
    console.log(`  ${verdict.message}`);
    if (!preimages.ok) console.log(`  Preimages:     ${preimages.errors.join('; ')}`);
    if (history.warning) console.log(`  Issuer history: ${history.warning}`);
    if (historyFailed && history.reason) console.log(`  Issuer history: ${history.reason}`);
    console.log('');
  }
  return verdict.exit_code;
}

async function legacyMain(): Promise<number> {
  const removed = removedFlag(process.argv.slice(2));
  if (removed) {
    console.error(removed);
    return 1;
  }
  const args = parseArgs(process.argv.slice(2));
  if (args.version) {
    console.log(`@xfuel/verify ${packageVersion()}`);
    console.log(formatSupportedReceiptVersions());
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

  if (args.url && !args.jwsFile) {
    try {
      const response = await fetch(args.url);
      await response.arrayBuffer();
    } catch {
      // A failed fetch is still not a pass.
    }
    console.log('owner_proof_required');
    console.log('  Overall: OWNER_PROOF_REQUIRED');
    return 1;
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

  // A shell plus a holder is not anchor mode. Inclusion is checked with the
  // holder. Anchor mode would verify the unsigned shell and skip the key.
  if (anchorMode && !args.jwsFile && !args.acceptShell) return runAnchor(args);

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

  if (isReceiptShell(receipt) || args.acceptShell || args.jwsFile) {
    if (!isReceiptShell(receipt)) {
      console.error('Invalid shell: schema is not chit402.receipt_shell.v1');
      return 3;
    }
    if (!args.jwsFile) {
      const shellGate = classifyShellDocument(receipt);
      if (!shellGate.ok) return emitVersionFailure(args, shellGate.errors);
      console.log(INCLUDED_SHELL_LINE);
      console.log('  Overall: INCLUDED_SHELL');
      return args.acceptShell ? 0 : 1;
    }
    let holder: Record<string, unknown>;
    try {
      const text = readFileSync(args.jwsFile, 'utf8');
      let parsed: Record<string, unknown> | string = text;
      try {
        parsed = JSON.parse(text) as Record<string, unknown>;
      } catch {
        parsed = text;
      }
      holder = holderDocumentFromOwnerView(parsed);
    } catch (err) {
      console.error(`Error reading JWS: ${err instanceof Error ? err.message : String(err)}`);
      return 3;
    }
    const shellDoc = receipt as unknown as Record<string, unknown>;
    const holderGate = classifyReceiptDocument(holder);
    if (!holderGate.ok) return emitVersionFailure(args, holderGate.errors);
    const compared = compareShellToJws(shellDoc, holder);
    if (!compared.ok) {
      console.log('shell_jws_mismatch');
      if (compared.field) console.log(`  Field:         ${compared.field}`);
      console.log('  Overall: FAILED');
      return 1;
    }
    let jwks: Jwks | undefined;
    if (args.jwksFile) {
      try {
        jwks = JSON.parse(readFileSync(args.jwksFile, 'utf8')) as Jwks;
      } catch (err) {
        console.error(`Error reading JWKS file: ${err instanceof Error ? err.message : String(err)}`);
        return 3;
      }
    }
    let inclusion = offlineWitness?.inclusion ?? null;
    let head = offlineWitness?.head ?? null;
    try {
      if (args.inclusionFile) inclusion = readJson(args.inclusionFile) as AnchorInclusion;
      if (args.headFile) head = readJson(args.headFile) as AnchorHead;
    } catch (err) {
      console.error(`Error reading inclusion: ${err instanceof Error ? err.message : String(err)}`);
      return 3;
    }
    const trustedKids = args.noTrustedKid
      ? []
      : (args.trustedKids ?? [...DEFAULT_TRUSTED_ISSUER_KIDS]);
    let shellResolved: ResolvedIssuerHistory;
    try {
      shellResolved = await resolvedHistory(args, holder as { verification?: { jwks_uri?: string }; verify_url?: string }, jwks, trustedKids);
    } catch (err) {
      console.error(`Error reading issuer history: ${err instanceof Error ? err.message : String(err)}`);
      return 3;
    }
    const result = await verifyReceipt(holder as unknown as XFuelReceipt, {
      jwks,
      jwksUri: args.jwksUrl || undefined,
      fetchJwks: args.fetchJwks,
      trustedKids,
      checkPayer: args.checkPayer,
      rpcUrl: args.rpcUrl || undefined,
      solanaRpcUrl: args.solanaRpcUrl || undefined,
      requirePreimages: false,
      ...historyOptions(shellResolved),
      salt: args.salt,
      head: head ?? undefined,
      inclusion: inclusion ?? undefined,
    });
    const inclusionErrors = result.errors.filter((err) => /inclusion|leaf|row_hash|bad_root|tree_size|tree_head|no_leaf/.test(err));
    const shellLeaf = (shellDoc.inclusion && typeof shellDoc.inclusion === 'object')
      ? (shellDoc.inclusion as { leaf_hash?: unknown }).leaf_hash
      : null;
    const provedLeaf = inclusion && typeof (inclusion as { leaf?: unknown }).leaf === 'string'
      ? (inclusion as { leaf: string }).leaf
      : null;
    // A head the user wrote by hand ({root, tree_size}) is not a log. The
    // inclusion only counts against a head that carries an issuer JWS;
    // verifyReceipt() checks that JWS against the same trust set.
    const headSig = head && typeof head === 'object'
      ? (head as { issuer_signature?: { jws?: unknown } }).issuer_signature
      : null;
    const headSigned = !!headSig && typeof headSig.jws === 'string' && headSig.jws.split('.').length === 3;
    const verdict = shellHolderVerdict({
      signatureValid: result.issuer_signature.valid === true,
      keyTrusted: result.issuer_signature.key_trusted === true,
      signatureReason: result.issuer_signature.reason || (result.issuer_signature.key_trusted ? null : 'key untrusted'),
      inclusionSupplied: inclusion != null,
      inclusionOk: inclusion != null && inclusionErrors.length === 0,
      inclusionReason: inclusion == null ? 'inclusion_missing' : (inclusionErrors[0] || null),
      headSigned,
      paymentRef: result.tx,
      bindingExpected: !!result.binding.expected,
      bindingMatches: result.binding.matches === true,
      shellLeaf: shellLeaf == null ? null : String(shellLeaf),
      provedLeaf,
    });
    const coveringMiss = result.issuer_history.reason === 'kid_not_in_history' || shellResolved.document == null;
    const receiptOk = result.issuer_signature.valid === true
      && result.claim_mismatches.length === 0
      && (result.overall === 'verified' || result.overall === 'verified_carried_forward' || coveringMiss);
    if (!verdict.verified || !receiptOk) {
      const reason = verdict.reason || result.errors[0] || 'failed';
      console.log(reason);
      console.log('  Overall: FAILED');
      return 1;
    }
    if (coveringMiss || (result.issuer_history.checked && !result.issuer_history.ok)) {
      if (coveringMiss) {
        console.log('  Overall: COULD_NOT_CHECK');
        console.log('  No issuer history covers this key.');
        console.log('  Next: Pass --issuer-history with a snapshot that includes this kid.');
        return 2;
      }
      console.log(result.issuer_history.reason || 'key_window');
      console.log('  Overall: INVALID');
      return 1;
    }
    if (args.checkPayer && !result.payer.valid) {
      console.log(result.payer.reason || 'payment_unchecked');
      console.log('  Overall: FAILED');
      return 1;
    }
    const issuer = holder.issuer_signature as { jws?: string } | undefined;
    if (args.salt) {
      const opened = openV11Commitment({
        payload: decodeJwsPayload(issuer?.jws),
        saltHex: args.salt || '',
        body: Buffer.alloc(0),
      });
      if (!opened.ok) {
        console.log(opened.reason || 'commitment_mismatch');
        console.log('  Overall: FAILED');
        return 1;
      }
    }
    console.log('  Overall: VERIFIED');
    console.log('  Every check passed.');
    return 0;
  }

  if (typeof receipt.issuer_signature?.jws === 'string') {
    const receiptGate = classifyReceiptDocument(receipt);
    if (!receiptGate.ok) return emitVersionFailure(args, receiptGate.errors);
  }

  const v11 = (receipt as XFuelReceipt & { v?: number }).v === 11 || (receipt.issuer_signature?.jws
    ? (() => {
      try {
        const part = String(receipt.issuer_signature.jws).split('.')[1];
        const payload = JSON.parse(Buffer.from(part, 'base64url').toString('utf8')) as { v?: number };
        return payload?.v === 11;
      } catch {
        return false;
      }
    })()
    : false);
  if (!receipt.task_id && !v11) {
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

  let resolved: ResolvedIssuerHistory;
  try {
    resolved = await resolvedHistory(args, receipt, jwks, trustedKids);
  } catch (err) {
    console.error(`Error reading issuer history: ${err instanceof Error ? err.message : String(err)}`);
    return 3;
  }

  if (isRefusalDocument(receipt as unknown)) {
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
      resolved,
      canonicalPreimage,
    });
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

  let open: { output?: Buffer; accounting?: string; routing?: string; refusal?: string } | undefined;
  if (args.open.length > 0) {
    open = {};
    try {
      for (const spec of args.open) {
        const opened = readOpenFile(spec);
        if (opened.kind === 'output') open.output = opened.bytes;
        else open[opened.kind] = opened.text;
      }
    } catch (err) {
      console.error(err instanceof Error ? err.message : String(err));
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
    ...historyOptions(resolved),
    canonicalPreimage,
    salt: args.salt,
    open,
    head: offlineWitness?.head ?? undefined,
    inclusion: offlineWitness?.inclusion ?? undefined,
    carry,
  });

  const hadLog = Boolean(offlineWitness?.inclusion || offlineWitness?.head);
  let logInclusion: CheckState | 'unclaimed' = 'unclaimed';
  let anchorState: CheckState | 'unclaimed' = 'unclaimed';
  let logReason: string | null = null;
  const carried = result.overall === 'verified_carried_forward';
  const headErrors = result.errors.filter((err) => /head_signature|head_claims|tree_head_mismatch|tree_size_mismatch|inclusion|not_in_tree|bad_root|no_leaf/.test(err));
  if (hadLog || headErrors.length) {
    if (headErrors.some((err) => err.includes('not_in_tree')) && headErrors.length === 1) {
      logInclusion = 'fail';
      anchorState = 'pass';
      logReason = 'not_in_log';
    } else if (headErrors.length) {
      logInclusion = headErrors.some((err) => /inclusion|not_in_tree|bad_root|no_leaf/.test(err)) ? 'fail' : 'pass';
      anchorState = 'fail';
      logReason = headErrors[0];
    } else {
      logInclusion = 'pass';
      anchorState = 'pass';
    }
  } else if (!carried && typeof receipt.verify_url === 'string' && historyHostAllowed(receipt.verify_url)) {
    const fresh = await freshPublicLog(receipt, resolved.document);
    logInclusion = fresh.logInclusion;
    anchorState = fresh.anchor;
    logReason = fresh.logReason;
  }
  const receiptVerdict = buildVerifyVerdict({
    version: packageVersion(),
    receiptId: result.receipt_id,
    displayId: displayIdOf(receipt),
    payloadVersion: result.receipt_version ?? null,
    historySource: resolved.source,
    historyHead: resolved.headHash,
    historyCount: resolved.entryCount,
    historyAsOf: resolved.asOf,
    signatureValid: result.issuer_signature.valid === true || carried,
    signatureChecked: result.issuer_signature.checked || carried,
    historyChecked: result.issuer_history.checked || carried,
    historyOk: carried ? true : result.issuer_history.ok,
    historyReason: carried ? null : (resolved.invalid ? (resolved.reason || result.issuer_history.reason) : result.issuer_history.reason),
    historyMissing: carried ? false : (resolved.document == null && !resolved.invalid),
    bindingExpected: !!result.binding.expected,
    bindingMatches: result.binding.matches,
    claimMismatches: result.claim_mismatches.length,
    payerChecked: result.payer.checked,
    payerValid: result.payer.valid,
    errors: result.errors,
    logInclusion,
    anchor: anchorState,
    logReason,
    log: null,
  });

  if (args.json) {
    return printVerdict(true, receiptVerdict, result as unknown as Record<string, unknown>, result.overall);
  } else if (!args.quiet || result.overall === 'failed' || receiptVerdict.result !== 'verified') {
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
    console.log(`  Overall: ${overallLine(receiptVerdict, result.overall)}`);
    console.log(`  ${receiptVerdict.message}`);
    if (receiptVerdict.history.source === 'bundled' && receiptVerdict.history.as_of) {
      console.log(`  Issuer history: as of ${receiptVerdict.history.as_of}`);
    }
    if (receiptVerdict.next_step) console.log(`  Next: ${receiptVerdict.next_step}`);
    if (result.errors.length > 0) {
      console.log(`  Errors:  ${result.errors.join(', ')}`);
    }
    console.log('');
  }

  return receiptVerdict.exit_code;
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

const RECEIPT_ID_RE = /^(chit|xfuel)-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function removedFlagMessage(argv: string[]): string | null {
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--') break;
    if (!arg.startsWith('-') || arg === '-') continue;
    if (REMOVED_040[arg]) return REMOVED_040[arg];
    if (arg === '--issuer-history') {
      const value = argv[i + 1];
      if (!value || value.startsWith('-')) return 'removed in 0.4: --issuer-history needs a file';
      i += 1;
      continue;
    }
    if (arg === '--json' || arg === '--help' || arg === '-h' || arg === '--version' || arg === '-V') continue;
    const name = arg.includes('=') ? arg.slice(0, arg.indexOf('=')) : arg;
    return `removed in 0.4: ${name} is not a verifier flag`;
  }
  return null;
}

function parseLocked(argv: string[]): {
  json: boolean;
  help: boolean;
  version: boolean;
  issuerHistoryFile: string | null;
  positionals: string[];
} {
  const parsed = {
    json: false,
    help: false,
    version: false,
    issuerHistoryFile: null as string | null,
    positionals: [] as string[],
  };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--json') parsed.json = true;
    else if (arg === '--help' || arg === '-h') parsed.help = true;
    else if (arg === '--version' || arg === '-V') parsed.version = true;
    else if (arg === '--issuer-history' && argv[i + 1]) {
      parsed.issuerHistoryFile = argv[++i];
    } else if (!arg.startsWith('-') || arg === '-') {
      parsed.positionals.push(arg);
    }
  }
  return parsed;
}

function printLocked(verdict: VerifyVerdict, json: boolean): number {
  if (json) {
    console.log(JSON.stringify(verdict, null, 2));
    return verdict.exit_code;
  }
  for (const line of humanVerdictLines(verdict)) console.log(line);
  return verdict.exit_code;
}

function lockedError(json: boolean, status: 1 | 2, message: string, reason: string): number {
  if (!json) {
    console.error(message);
    return status;
  }
  const failed = status === 1;
  const verdict = buildVerifyVerdict({
    version: packageVersion(),
    errors: failed ? [reason] : [],
    signatureChecked: failed,
    signatureValid: failed ? false : null,
    logInclusion: 'could_not_check',
    anchor: 'could_not_check',
    logReason: failed ? null : reason,
  });
  console.log(JSON.stringify({
    ...verdict,
    result: failed ? 'invalid' : 'could_not_check',
    exit_code: status,
    reason,
    message,
    next_step: failed ? null : verdict.next_step,
  }, null, 2));
  return status;
}

function receiptJsonUrl(raw: string): string {
  const url = new URL(raw);
  if (!url.pathname.endsWith('.json')) url.searchParams.set('format', 'json');
  return url.toString();
}

type LoadedReceipt = {
  receipt: XFuelReceipt;
  /** Origin of a remote id or URL. Null for a file or stdin. */
  origin: string | null;
};

async function loadReceiptTarget(target: string): Promise<LoadedReceipt> {
  if (target === '-') {
    return { receipt: JSON.parse(readFileSync(0, 'utf8')) as XFuelReceipt, origin: null };
  }
  let url: string | null = null;
  if (/^https?:\/\//i.test(target)) url = receiptJsonUrl(target);
  else if (RECEIPT_ID_RE.test(target)) url = `https://api.chit402.com/receipt/${target}?format=json`;
  if (url) {
    let res: Response;
    try {
      res = await fetch(url, {
        headers: { accept: 'application/json' },
        signal: AbortSignal.timeout(LOG_FETCH_MS),
      });
    } catch (err) {
      const wrapped = new Error(err instanceof Error ? err.message : String(err));
      (wrapped as { code?: string }).code = 'REMOTE';
      throw wrapped;
    }
    if (!res.ok) {
      const err = new Error(`fetch ${res.status}`);
      (err as { code?: string }).code = 'REMOTE';
      throw err;
    }
    const text = await res.text();
    try {
      return { receipt: JSON.parse(text) as XFuelReceipt, origin: new URL(url).origin };
    } catch {
      const err = new Error('receipt response was not JSON');
      (err as { code?: string }).code = 'REMOTE';
      throw err;
    }
  }
  return { receipt: JSON.parse(readFileSync(target, 'utf8')) as XFuelReceipt, origin: null };
}

function inputFailure(err: unknown, target: string): { status: 1 | 2; message: string; reason: string } {
  const code = err && typeof err === 'object' && 'code' in err ? String((err as { code?: string }).code) : '';
  const message = err instanceof Error ? err.message : String(err);
  const remote = code === 'REMOTE' || code === 'FETCH' || /fetch failed|fetch \d+|timeout|aborted|network|ENOTFOUND|ECONNREFUSED|EAI_AGAIN/i.test(message);
  if (remote) {
    return { status: 2, message: 'The receipt could not be fetched.', reason: 'receipt_unavailable' };
  }
  if (code === 'ENOENT' || message.includes('ENOENT')) {
    return { status: 1, message: `Error reading receipt: ${target}`, reason: 'unreadable' };
  }
  return { status: 1, message: `Error reading receipt: ${message}`, reason: 'unreadable' };
}

function shellInclusionAbsent(receipt: XFuelReceipt): boolean {
  const inclusion = (receipt as { inclusion?: unknown }).inclusion;
  if (inclusion == null) return true;
  if (typeof inclusion !== 'object') return false;
  const row = inclusion as { error?: unknown; leaf_hash?: unknown; leaf?: unknown; proof?: unknown; signed_head?: unknown };
  if (row.error === 'not_in_tree') return true;
  const leaf = row.leaf_hash ?? row.leaf ?? null;
  const head = row.signed_head;
  const headAbsent = head == null || (
    typeof head === 'object'
    && (head as { root?: unknown }).root == null
    && (head as { signature?: unknown }).signature == null
  );
  return leaf == null && row.proof == null && headAbsent;
}

function shellLogReceipt(
  receipt: XFuelReceipt,
  origin: string | null,
): { verify_url: string; task_id: string } | null {
  const task = receipt.task_id || (receipt as { receipt_id?: string | null }).receipt_id || null;
  if (!task || !RECEIPT_ID_RE.test(String(task))) return null;
  let host = origin;
  if (!host && typeof receipt.verify_url === 'string') {
    try { host = new URL(receipt.verify_url).origin; } catch { host = null; }
  }
  if (!host) host = 'https://api.chit402.com';
  const verifyUrl = `${host}/receipt/${encodeURIComponent(String(task))}`;
  if (!historyHostAllowed(verifyUrl)) return null;
  return { verify_url: verifyUrl, task_id: String(task) };
}

interface PublicPeek {
  text: string;
  origin: string | null;
  receiptId: string | null;
  fullJws: string | null;
}

function compactPublicText(text: string): string | null {
  const trimmed = text.trim();
  if (!trimmed) return null;
  if (!trimmed.startsWith('{')) return trimmed;
  try {
    const doc = JSON.parse(trimmed) as { jws?: unknown; issuer_signature?: { jws?: unknown } };
    if (typeof doc.jws === 'string') return doc.jws;
    if (typeof doc.issuer_signature?.jws === 'string') return doc.issuer_signature.jws;
  } catch {
    return null;
  }
  return null;
}

function publicReceiptId(text: string): string | null {
  const compact = compactPublicText(text);
  if (!compact) return null;
  const payload = readCompactPayload(compact);
  return payload && typeof payload.receipt_id === 'string' ? payload.receipt_id : null;
}

function jwsFromReceiptDoc(doc: unknown): string | null {
  if (!doc || typeof doc !== 'object') return null;
  const sig = (doc as { issuer_signature?: { jws?: unknown } }).issuer_signature;
  return sig && typeof sig.jws === 'string' ? sig.jws : null;
}

function taskIdFromReceiptDoc(doc: unknown): string | null {
  if (!doc || typeof doc !== 'object') return null;
  const row = doc as { task_id?: unknown; receipt_id?: unknown };
  if (typeof row.task_id === 'string' && row.task_id) return row.task_id;
  if (typeof row.receipt_id === 'string' && row.receipt_id) return row.receipt_id;
  return null;
}

async function fetchBody(url: string): Promise<{ ok: boolean; text: string } | null> {
  try {
    const res = await publicFetch(url, 'application/jose, application/json');
    return { ok: res.ok, text: await res.text() };
  } catch {
    return null;
  }
}

/** Public fetches do not follow redirects. A hop to another host is not fetched. */
function publicFetch(url: string, accept: string): Promise<Response> {
  return fetch(url, {
    headers: { accept },
    redirect: 'error',
    signal: AbortSignal.timeout(LOG_FETCH_MS),
  });
}

/**
 * A public record, its inclusion, and its head all come from one receipt URL.
 * A bare receipt id is left to the receipt path. A file is public only when
 * the bytes are a public record; there is then no URL to fetch.
 */
async function peekPublicRecord(target: string): Promise<PublicPeek | { unavailable: true } | null> {
  if (target === '-' || RECEIPT_ID_RE.test(target)) return null;
  if (/^https?:\/\//i.test(target)) {
    let parsed: URL;
    try { parsed = new URL(target); } catch { return null; }
    if (!historyHostAllowed(target)) return null;
    const origin = parsed.origin;
    const publicUrl = parsed.pathname.endsWith('/public');
    const fetched = await fetchBody(publicUrl ? target : receiptJsonUrl(target));
    if (!fetched) return publicUrl ? { unavailable: true } : null;
    if (!fetched.ok) return publicUrl ? { unavailable: true } : null;
    if (isPublicRecordAttempt(fetched.text)) {
      return {
        text: fetched.text,
        origin,
        receiptId: publicReceiptId(fetched.text),
        fullJws: null,
      };
    }
    if (publicUrl) return { unavailable: true };
    let doc: unknown;
    try { doc = JSON.parse(fetched.text) as unknown; } catch { return null; }
    const id = taskIdFromReceiptDoc(doc);
    if (!id) return null;
    const recordUrl = `${origin}/receipt/${encodeURIComponent(id)}/public`;
    if (!historyHostAllowed(recordUrl)) return null;
    const record = await fetchBody(recordUrl);
    if (!record?.ok || !isPublicRecordAttempt(record.text)) return null;
    return {
      text: record.text,
      origin,
      receiptId: publicReceiptId(record.text) || id,
      fullJws: jwsFromReceiptDoc(doc),
    };
  }
  let text: string;
  try { text = readFileSync(target, 'utf8'); } catch { return null; }
  if (!isPublicRecordAttempt(text)) return null;
  return { text, origin: null, receiptId: publicReceiptId(text), fullJws: null };
}

async function fetchPublicLog(origin: string, receiptId: string, wantFull: boolean): Promise<{
  inclusion: Record<string, unknown> | null;
  head: Record<string, unknown> | null;
  fullJws: string | null;
}> {
  const out: {
    inclusion: Record<string, unknown> | null;
    head: Record<string, unknown> | null;
    fullJws: string | null;
  } = { inclusion: null, head: null, fullJws: null };
  const base = `${origin}/receipt/${encodeURIComponent(receiptId)}`;
  if (!historyHostAllowed(base)) return out;
  try {
    const incRes = await publicFetch(
      `${origin}/v1/receipts/${encodeURIComponent(receiptId)}/inclusion`,
      'application/json',
    );
    if (incRes.ok) {
      const inclusion = await incRes.json() as { head_url?: string; tree_size?: number | null; anchored_tree_size?: number | null };
      out.inclusion = inclusion as Record<string, unknown>;
      const headUrl = inclusionHeadUrl(origin, inclusion);
      if (headUrl && historyHostAllowed(headUrl)) {
        const headRes = await publicFetch(headUrl, 'application/json');
        if (headRes.ok) out.head = await headRes.json() as Record<string, unknown>;
      }
    }
  } catch {
    // A missed log is head_unavailable after the signature is trusted.
  }
  if (!wantFull) return out;
  try {
    const rec = await publicFetch(`${base}?format=json`, 'application/json');
    if (rec.ok) out.fullJws = jwsFromReceiptDoc(await rec.json());
  } catch {
    // The full receipt is checked only when this URL returns one.
  }
  return out;
}

function printPublic(result: PublicRecordResult, json: boolean): number {
  const code = result.exitCode === 0 ? 0 : result.exitCode === 2 ? 2 : 1;
  if (json) {
    const body = publicRecordJson(result, packageVersion());
    console.log(JSON.stringify({ ...body, exit_code: code }, null, 2));
    return code;
  }
  if (result.exitCode === 0) {
    console.log('PUBLIC_VERIFIED');
    if (result.headline) console.log(result.headline);
    console.log('Payment: not checked');
    console.log(`Leaf binding: ${result.leaf_binding}`);
    return 0;
  }
  console.log(result.verdict);
  if (result.reason) console.log(result.reason);
  if (code === 2) console.log('NOT found invalid');
  return code;
}

async function runPublicLocked(
  args: { json: boolean; issuerHistoryFile: string | null },
  peeked: PublicPeek,
): Promise<number> {
  const trustedKids = [...DEFAULT_TRUSTED_ISSUER_KIDS];
  let fileBytes: string | null = null;
  if (args.issuerHistoryFile) {
    try {
      fileBytes = readFileSync(args.issuerHistoryFile, 'utf8');
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return lockedError(args.json, 1, `Error reading issuer history: ${message}`, 'unreadable');
    }
  }
  let resolved;
  try {
    resolved = await resolveIssuerHistory({
      fileBytes,
      receipt: peeked.origin && peeked.receiptId
        ? { verify_url: `${peeked.origin}/receipt/${encodeURIComponent(peeked.receiptId)}` }
        : {},
      trustedKids,
      timeoutMs: LOG_FETCH_MS,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return lockedError(args.json, 1, `Error reading issuer history: ${message}`, 'unreadable');
  }
  if (resolved.invalid) {
    return lockedError(args.json, 1, resolved.reason || 'issuer_history_invalid', resolved.reason || 'issuer_history_invalid');
  }
  let inclusion: Record<string, unknown> | null = null;
  let head: Record<string, unknown> | null = null;
  let fullJws = peeked.fullJws;
  if (peeked.origin && peeked.receiptId) {
    const log = await fetchPublicLog(peeked.origin, peeked.receiptId, fullJws == null);
    inclusion = log.inclusion;
    head = log.head;
    if (fullJws == null) fullJws = log.fullJws;
  }
  const result = verifyPublicRecord(peeked.text, {
    trustedKids,
    history: resolved.document,
    inclusion,
    head,
    fullJws,
  });
  return printPublic(result, args.json);
}

async function main(): Promise<number> {
  const argv = process.argv.slice(2);
  const jsonEarly = argv.includes('--json');
  const removed = removedFlagMessage(argv);
  if (removed) return lockedError(jsonEarly, 1, removed, 'removed_flag');

  const args = parseLocked(argv);
  if (args.version) {
    console.log(`chit402-verify ${packageVersion()}`);
    console.log(formatSupportedReceiptVersions());
    return 0;
  }
  if (args.help) {
    console.log(HELP);
    return 0;
  }
  if (args.positionals.length === 0) {
    console.log(HELP);
    return 1;
  }
  if (args.positionals.length !== 1) {
    return lockedError(args.json, 1, 'removed in 0.4: pass one receipt id, url, or file', 'removed_flag');
  }

  const peeked = await peekPublicRecord(args.positionals[0]);
  if (peeked && 'unavailable' in peeked) {
    const verdict = buildVerifyVerdict({
      version: packageVersion(),
      absentReason: 'receipt_unavailable',
    });
    return printLocked({
      ...verdict,
      message: 'The receipt could not be fetched. It was NOT found invalid.',
      next_step: 'Fetch the receipt again, then re-run.',
    }, args.json);
  }
  if (peeked) return runPublicLocked(args, peeked);

  let receipt: XFuelReceipt;
  let receiptOrigin: string | null = null;
  try {
    const loaded = await loadReceiptTarget(args.positionals[0]);
    receipt = loaded.receipt;
    receiptOrigin = loaded.origin;
  } catch (err) {
    const failure = inputFailure(err, args.positionals[0]);
    if (failure.status === 2) {
      const verdict = buildVerifyVerdict({
        version: packageVersion(),
        absentReason: failure.reason,
      });
      return printLocked({
        ...verdict,
        message: `${failure.message} It was NOT found invalid.`,
        next_step: 'Fetch the receipt again, then re-run.',
      }, args.json);
    }
    return lockedError(args.json, failure.status, failure.message, failure.reason);
  }

  const trustedKids = [...DEFAULT_TRUSTED_ISSUER_KIDS];
  let fileBytes: string | null = null;
  if (args.issuerHistoryFile) {
    try {
      fileBytes = readFileSync(args.issuerHistoryFile, 'utf8');
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return lockedError(args.json, 1, `Error reading issuer history: ${message}`, 'unreadable');
    }
  }

  let resolved: ResolvedIssuerHistory;
  try {
    resolved = await resolveIssuerHistory({
      fileBytes,
      receipt,
      trustedKids,
      timeoutMs: LOG_FETCH_MS,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return lockedError(args.json, 1, `Error reading issuer history: ${message}`, 'unreadable');
  }

  if (isRefusalDocument(receipt as unknown)) {
    const result = verifyRefusal(receipt as unknown as RefusalDocument, { trustedKids });
    const verdict = buildVerifyVerdict({
      version: packageVersion(),
      receiptId: result.refusal_id || null,
      displayId: result.refusal_id || null,
      payloadVersion: result.payload_version ?? null,
      historySource: resolved.source,
      historyHead: resolved.headHash,
      historyCount: resolved.entryCount,
      historyAsOf: resolved.asOf,
      signatureValid: result.valid,
      signatureChecked: true,
      historyChecked: !resolved.invalid && resolved.document != null,
      historyOk: !resolved.invalid && resolved.document != null,
      historyReason: resolved.reason,
      historyMissing: resolved.document == null && !resolved.invalid,
      errors: result.errors,
      logInclusion: 'unclaimed',
      anchor: 'unclaimed',
    });
    return printLocked(verdict, args.json);
  }

  const unsigned = typeof receipt.issuer_signature?.jws !== 'string' || receipt.issuer_signature.jws.length === 0;
  if (unsigned || isReceiptShell(receipt)) {
    let logInclusion: CheckState | 'unclaimed' = 'unclaimed';
    let anchorState: CheckState | 'unclaimed' = 'unclaimed';
    let logReason: string | null = 'signed_receipt_unavailable';
    if (shellInclusionAbsent(receipt)) {
      const logReceipt = shellLogReceipt(receipt, receiptOrigin);
      if (logReceipt && await publicShellAbsence(logReceipt, resolved.document)) {
        logInclusion = 'fail';
        anchorState = 'pass';
        logReason = 'not_in_log';
      }
    }
    const notInLog = logReason === 'not_in_log';
    const verdict = buildVerifyVerdict({
      version: packageVersion(),
      receiptId: receipt.task_id || null,
      displayId: displayIdOf(receipt),
      payloadVersion: null,
      historySource: resolved.source,
      historyHead: resolved.headHash,
      historyCount: resolved.entryCount,
      historyAsOf: resolved.asOf,
      signatureChecked: false,
      historyReason: notInLog ? null : 'signed_receipt_unavailable',
      historyMissing: false,
      errors: [],
      logInclusion,
      anchor: anchorState,
      logReason: notInLog ? 'not_in_log' : null,
    });
    return printLocked(verdict, args.json);
  }

  const result = await verifyReceipt(receipt, {
    trustedKids,
    requirePreimages: true,
    ...historyOptions(resolved),
  });

  const unsupported = (result.errors || []).includes('unsupported_version');
  let logInclusion: CheckState | 'unclaimed' = 'unclaimed';
  let anchorState: CheckState | 'unclaimed' = 'unclaimed';
  let logReason: string | null = null;
  let log: VerifyVerdict['log'] = null;
  const signatureOk = result.issuer_signature.valid === true && !resolved.invalid && !unsupported;
  const logHostOk = typeof receipt.verify_url === 'string' && historyHostAllowed(receipt.verify_url);
  if (signatureOk && result.issuer_history.ok && logHostOk) {
    const fresh = await freshPublicLog(receipt, resolved.document);
    logInclusion = fresh.logInclusion;
    anchorState = fresh.anchor;
    logReason = fresh.logReason;
    log = fresh.log;
  }

  const verdict = buildVerifyVerdict({
    version: packageVersion(),
    receiptId: result.receipt_id,
    displayId: displayIdOf(receipt),
    payloadVersion: result.receipt_version ?? null,
    historySource: resolved.source,
    historyHead: resolved.headHash,
    historyCount: resolved.entryCount,
    historyAsOf: resolved.asOf,
    signatureValid: unsupported ? null : result.issuer_signature.valid === true,
    signatureChecked: unsupported ? false : Boolean(result.issuer_signature.checked),
    historyChecked: unsupported ? false : (resolved.invalid || result.issuer_history.checked),
    historyOk: unsupported ? false : (resolved.invalid ? false : result.issuer_history.ok),
    historyReason: resolved.invalid ? (resolved.reason || result.issuer_history.reason) : result.issuer_history.reason,
    historyMissing: unsupported ? true : (resolved.document == null && !resolved.invalid),
    bindingExpected: !!result.binding.expected,
    bindingMatches: result.binding.matches,
    claimMismatches: result.claim_mismatches.length,
    payerChecked: result.payer.checked,
    payerValid: result.payer.valid,
    errors: result.errors,
    logInclusion,
    anchor: anchorState,
    logReason,
    log,
  });
  return printLocked(verdict, args.json);
}


main()
  .then((code) => finish(code))
  .catch((err) => {
    console.error('Unexpected error:', err);
    return finish(1);
  });
