/**
 * Locked receipt check shared by the chit402-verify CLI and the public
 * receipt-check box. One path: load a receipt, then the 0.4 verdict.
 */

import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import {
  verifyReceipt,
  verifyRefusal,
  isRefusalDocument,
  signedReceiptId,
  DEFAULT_TRUSTED_ISSUER_KIDS,
  DEFAULT_TRUSTED_JWKS_HOSTS,
  type XFuelReceipt,
  type RefusalDocument,
} from './index.js';
import {
  verifyAnchoredRoot,
  isUncheckedAnchorReason,
  type AnchorHead,
  type AnchorInclusion,
  type AnchorReceipt,
  type AnchorWitnessResult,
  anchorRpcUrls,
} from './anchor-witness.js';
import { isReceiptShell } from './shell.js';
import {
  callerHistoryForTrust,
  epochHistoryKeyAllowed,
  loadBundledIssuerHistory,
  resolveIssuerHistory,
  type IssuerHistoryDocument,
  type IssuerHistoryEntry,
  type ResolvedIssuerHistory,
} from './issuer-history.js';
import { BASE_RPC_URL } from './base-payer.js';
import { SOLANA_RPC_URL } from './solana-payer.js';
import { payerCheckOutcome } from './payer.js';
import { type EpochRecord } from './epoch.js';
import { fetchNoRedirect } from './fetch-guard.js';
import { jwkThumbprint, verifyIssuerJws, ISSUER_JWS_TYP, type Es256Jwk } from './jws.js';
import {
  buildVerifyVerdict,
  humanVerdictLines,
  unsignedDocumentVerdict,
  verdictCopy,
  verdictFromVerification,
  type CheckState,
  type VerifyVerdict,
} from './verdict.js';
import { verifyTreeHeadTrust } from './anchor-trust.js';
import { activeVersionWindows } from './version-windows.js';
import { logTimeReason } from './log-time.js';
import { carryTestSnapshot, readTestSnapshot } from './internal/test-seam.js';
import {
  parsePublicAttestation,
  sameReceiptId,
  verifyPublicAttestationTrust,
  type PublicReceiptClaims,
} from './public-attestation.js';
import { truncateAddress, verifyPublicBasePayment } from './public-payment.js';
import { keyForKid, verifyFixedHeadEip712 } from './eip712.js';

export const RECEIPT_ID_RE = /^(chit|xfuel)-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const LOG_FETCH_MS = 8000;

export type ReceiptInputKind = 'json' | 'url' | 'id' | 'stdin' | 'other';

export function packageVersion(): string {
  const require = createRequire(__filename);
  const pkg = require('../package.json') as { version?: string };
  return pkg.version || '0.0.0';
}

export function historyOptions(resolved: ResolvedIssuerHistory): {
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

/**
 * Short form of a task id. Outer `display_id` is unsigned and is not read.
 * Verdicts use the full signed task id instead of this helper.
 */
export function displayIdOf(receipt: { task_id?: string; display_id?: string; receipt_id?: string }): string | null {
  const id = receipt.task_id || receipt.receipt_id || '';
  const short = id.match(/^(chit-[0-9a-f]{8})/i);
  return short ? short[1] : (id || null);
}

export function historyHostAllowed(url: string, opts: { loopback?: boolean } = {}): boolean {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return false;
    // Public box: https to a trusted host only. Loopback http is a CLI/dev convenience.
    if (parsed.protocol === 'http:' && opts.loopback === false) return false;
    if (parsed.username || parsed.password) return false;
    if (parsed.protocol === 'http:' && parsed.hostname !== '127.0.0.1' && parsed.hostname !== 'localhost') return false;
    if (parsed.protocol === 'https:') {
      return DEFAULT_TRUSTED_JWKS_HOSTS.some((host) => host.toLowerCase() === parsed.hostname.toLowerCase());
    }
    return true;
  } catch {
    return false;
  }
}

/** Public box may fetch a receipt URL only from a host the verifier already trusts. */
export function receiptUrlAllowed(raw: string): boolean {
  return historyHostAllowed(raw, { loopback: false });
}

export function classifyReceiptInput(raw: string): ReceiptInputKind {
  const input = String(raw ?? '').trim();
  if (input === '-') return 'stdin';
  if (input.startsWith('{')) return 'json';
  if (/^https?:\/\//i.test(input)) return 'url';
  if (RECEIPT_ID_RE.test(input)) return 'id';
  return 'other';
}

function receiptJsonUrl(raw: string): string {
  const url = new URL(raw);
  if (!url.pathname.endsWith('.json')) url.searchParams.set('format', 'json');
  return url.toString();
}

type LoadedReceipt = {
  receipt: XFuelReceipt;
  origin: string | null;
};

function missedLog(reason = 'log_unreachable'): FreshLog {
  return {
    logInclusion: 'could_not_check',
    anchor: 'could_not_check',
    logReason: reason,
    log: null,
  };
}

type FreshLog = {
  logInclusion: CheckState;
  anchor: CheckState;
  logReason: string | null;
  log: VerifyVerdict['log'];
  /** Set on a pass: the head the inclusion proof verified against, for the L5 log time. */
  verified?: { origin: string; head: AnchorHead; leafIndex: number | null };
  /** Set when the verified head carries an EIP-712 fixed head that does not match it. */
  fixedHeadInvalid?: string;
};

/**
 * EIP-712 fixed head on a verified tree head. Absent (flag off) is null.
 * It must say exactly what the JWS head says, signed by the head's key.
 */
export function fixedHeadOutcome(
  head: AnchorHead,
  history: IssuerHistoryDocument | null,
  trustedKids: readonly string[],
): { ok: true } | { ok: false; reason: string } | null {
  const fixed = (head as { fixed_head?: unknown }).fixed_head;
  if (fixed === undefined || fixed === null) return null;
  const bundledDoc = loadBundledIssuerHistory().document;
  const fixedTrustDoc = history ? callerHistoryForTrust(history, bundledDoc) : null;
  const fixedKeyEntries: IssuerHistoryEntry[] = fixedTrustDoc?.entries || [];
  const headerKid = (head as { issuer_signature?: { kid?: string; jws?: string } }).issuer_signature?.kid
    || kidFromJws((head as { issuer_signature?: { jws?: string } }).issuer_signature?.jws);
  const embedded = (head as { issuer_signature?: { issuer_jwk?: unknown } }).issuer_signature?.issuer_jwk;
  const jwk = keyForKid(headerKid, [embedded, ...fixedKeyEntries.map((entry) => entry?.jwk)]);
  if (!jwk) return { ok: false, reason: 'key' };
  const trust = verifyTreeHeadTrust(head, { trustedKids, issuerHistory: history });
  if (!trust.ok || !trust.payload || typeof trust.kid !== 'string') return { ok: false, reason: 'head_untrusted' };
  return verifyFixedHeadEip712(fixed, { claims: trust.payload as Record<string, unknown>, kid: trust.kid, jwk });
}

function kidFromJws(jws: string | undefined): string | null {
  if (!jws) return null;
  try {
    const header = JSON.parse(Buffer.from(jws.split('.')[0] || '', 'base64url').toString('utf8')) as { kid?: unknown };
    return typeof header.kid === 'string' ? header.kid : null;
  } catch {
    return null;
  }
}

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

/**
 * Absence is judged under the caller's pins, like the inclusion path:
 * undefined is the production default and [] trusts nothing.
 */
async function absenceAgainstSignedHead(
  origin: string,
  history: IssuerHistoryDocument | null,
  trustedKids: readonly string[],
): Promise<{ kind: 'not_in_log' } | { kind: 'unchecked' } | { kind: 'bad_head'; reason: string }> {
  try {
    const res = await fetchNoRedirect(`${origin}/v1/receipts/tree/head`, {
      headers: { accept: 'application/json' },
      signal: AbortSignal.timeout(LOG_FETCH_MS),
    });
    if (!res.ok) return { kind: 'unchecked' };
    const head = await res.json() as AnchorHead;
    const trust = verifyTreeHeadTrust(head, {
      trustedKids,
      issuerHistory: history,
    });
    if (trust.ok) {
      // A fixed head beside it must match too, as on the inclusion path.
      const fixed = fixedHeadOutcome(head, history, trustedKids);
      if (fixed && !fixed.ok) return { kind: 'bad_head', reason: 'fixed_head_invalid' };
      return { kind: 'not_in_log' };
    }
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
    /mismatch|head_signature|head_claims|head_key|inclusion_failed|bad_root|no_leaf|anchor_ref_invalid/.test(err)
  ));
  return mismatch ? mismatch.replace(/^(solana|base):/, '') : null;
}

async function publicShellAbsence(
  receipt: { verify_url?: string; task_id?: string | null },
  history: IssuerHistoryDocument | null,
  trustedKids: readonly string[],
): Promise<boolean> {
  try {
    const origin = new URL(String(receipt.verify_url)).origin;
    const task = receipt.task_id;
    if (!task) return false;
    const res = await fetchNoRedirect(`${origin}/v1/receipts/${encodeURIComponent(String(task))}/inclusion`, {
      headers: { accept: 'application/json' },
      signal: AbortSignal.timeout(LOG_FETCH_MS),
    });
    if (res.status !== 404) return false;
    const body = await res.json().catch(() => ({})) as { error?: string; reason?: string };
    if (body.error !== 'not_in_tree' && body.reason !== 'not_in_tree') return false;
    const absence = await absenceAgainstSignedHead(origin, history, trustedKids);
    return absence.kind === 'not_in_log';
  } catch {
    return false;
  }
}

function sameEpochKey(a: Es256Jwk, b: Es256Jwk): boolean {
  return a.kty === b.kty && a.crv === b.crv && a.x === b.x && a.y === b.y;
}

/**
 * The epoch record is trusted only when its ES256 signature matches the
 * epochs, orphans, and unlogged claims, and the signing key was `active`
 * at the verified head's `published_at`. The epoch JWS `iat` is not that
 * time: a retired key must not backdate it. This history must never revoke
 * the kid. A production pin with no history row for that kid stays the
 * package pin. A revoked or retired history key does not, even when the
 * bytes verify.
 */
export function epochRecordSignatureOk(
  record: EpochRecord,
  jws: string,
  history: IssuerHistoryDocument | null,
  publishedAt: unknown = null,
): boolean {
  let kid: string | null = null;
  try {
    const header = JSON.parse(Buffer.from(jws.split('.')[0] || '', 'base64url').toString('utf8')) as { kid?: unknown };
    kid = typeof header.kid === 'string' ? header.kid : null;
  } catch {
    kid = null;
  }
  const keys: Es256Jwk[] = [];
  const embedded = (record.issuer_signature as { issuer_jwk?: Es256Jwk } | null | undefined)?.issuer_jwk;
  const pin = embedded && DEFAULT_TRUSTED_ISSUER_KIDS.some((id) => id === jwkThumbprint(embedded))
    ? embedded
    : null;
  if (pin) keys.push(pin);
  const bundledDoc = loadBundledIssuerHistory().document;
  const epochTrustDoc = history ? callerHistoryForTrust(history, bundledDoc) : null;
  const epochKeyEntries = epochTrustDoc?.entries || [];
  for (const entry of epochKeyEntries) {
    const jwk = entry?.jwk as Es256Jwk | undefined;
    if (!jwk) continue;
    if (kid && entry.kid !== kid && jwk.kid !== kid) continue;
    if (keys.some((have) => sameEpochKey(have, jwk))) continue;
    keys.push(jwk);
  }
  for (const key of keys) {
    const verified = verifyIssuerJws(jws, key, { expectTyp: ISSUER_JWS_TYP.treeEpoch });
    if (!verified.valid || !verified.payload) continue;
    const payload = verified.payload;
    if (JSON.stringify(payload.epochs ?? null) !== JSON.stringify(record.epochs ?? null)) continue;
    if (JSON.stringify(payload.orphans ?? []) !== JSON.stringify(record.orphans ?? [])) continue;
    const payloadUnlogged = payload.unlogged === undefined ? null : payload.unlogged;
    const recordUnlogged = record.unlogged === undefined ? null : record.unlogged;
    if (JSON.stringify(payloadUnlogged) !== JSON.stringify(recordUnlogged)) continue;
    const signerKid = kid || key.kid || null;
    const at = publishedAt;
    const inHistory = (history?.entries || []).some((row) => (
      signerKid != null && (row.kid === signerKid || row.jwk?.kid === signerKid)
    ));
    if (inHistory) {
      if (!epochHistoryKeyAllowed(history, signerKid, at)) continue;
      const listed = (history?.entries || []).some((row) => (
        row.jwk && sameEpochKey(row.jwk as Es256Jwk, key)
        && (row.kid === signerKid || row.jwk.kid === signerKid)
      ));
      if (!listed) continue;
      return true;
    }
    if (pin && sameEpochKey(key, pin)) return true;
  }
  return false;
}

export async function freshPublicLog(
  receipt: { verify_url?: string; task_id?: string | null },
  history: IssuerHistoryDocument | null = null,
  options: {
    /** Public attestation: prove this signed leaf, not a recomputed one. */
    signedLeaf?: { leaf_hash: string; leaf_index: number; epoch: number } | null;
    trustedKids?: readonly string[];
  } = {},
): Promise<FreshLog> {
  const pins = options.trustedKids ?? DEFAULT_TRUSTED_ISSUER_KIDS;
  const missed = missedLog();
  try {
    const origin = new URL(String(receipt.verify_url)).origin;
    const task = receipt.task_id;
    if (!task) return missed;
    const res = await fetchNoRedirect(`${origin}/v1/receipts/${encodeURIComponent(String(task))}/inclusion`, {
      headers: { accept: 'application/json' },
      signal: AbortSignal.timeout(LOG_FETCH_MS),
    });
    if (res.status === 404) {
      const body = await res.json().catch(() => ({})) as { error?: string; reason?: string };
      if (body.error !== 'not_in_tree' && body.reason !== 'not_in_tree') return missed;
      const absence = await absenceAgainstSignedHead(origin, history, pins);
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
    const headRes = await fetchNoRedirect(headUrl, {
      headers: { accept: 'application/json' },
      signal: AbortSignal.timeout(LOG_FETCH_MS),
    });
    if (!headRes.ok) return missed;
    const head = await headRes.json() as AnchorHead;
    let epochRecord: EpochRecord | null = null;
    const headEpoch = (head as { epoch?: unknown; schema?: string }).epoch;
    const headSchema = (head as { schema?: string }).schema;
    if (headEpoch != null || headSchema === 'chit402.tree_head.v2') {
      try {
        const epochRes = await fetchNoRedirect(`${origin}/v1/receipts/tree/epoch`, {
          headers: { accept: 'application/json' },
          signal: AbortSignal.timeout(LOG_FETCH_MS),
        });
        if (epochRes.ok) {
          const body = await epochRes.json() as EpochRecord;
          if (typeof body?.issuer_signature?.jws === 'string' && body.issuer_signature.jws.length > 0) {
            epochRecord = body;
          }
        }
      } catch {
        epochRecord = null;
      }
    }
    const result = await verifyAnchoredRoot({
      receipt: receipt as AnchorReceipt,
      inclusion,
      head,
      baseRpcUrls: anchorRpcUrls('base'),
      solanaRpcUrls: anchorRpcUrls('solana'),
      checkNewestAnchor: false,
      signedLeaf: options.signedLeaf ?? null,
      issuerHistory: history,
      trustedKids: pins,
      epochRecord,
      verifyEpochSignature: epochRecord
        ? (jws) => {
          const trust = verifyTreeHeadTrust(head, {
            trustedKids: pins,
            issuerHistory: history,
          });
          const signedAt = trust.ok ? (trust.payload?.published_at ?? null) : null;
          return epochRecordSignatureOk(epochRecord as EpochRecord, jws, history, signedAt);
        }
        : undefined,
    });
    // The log answered for another epoch than the one signed. It may be a
    // rollover race; it is not a proof either way.
    if (options.signedLeaf && result.inclusion?.reason === 'log_epoch_mismatch') {
      return missedLog('log_epoch_mismatch');
    }
    if (result.overall === 'verified') {
      const leafIndex = Number(inclusion.leaf_index);
      const fixed = fixedHeadOutcome(head, history, pins);
      return {
        logInclusion: 'pass',
        anchor: 'pass',
        logReason: null,
        verified: { origin, head, leafIndex: Number.isSafeInteger(leafIndex) ? leafIndex : null },
        ...(fixed && !fixed.ok ? { fixedHeadInvalid: fixed.reason } : {}),
        log: {
          ...(fixed && fixed.ok ? { fixed_head: 'verified' as const } : {}),
          leaf_index: inclusion.leaf_index ?? null,
          tree_size: inclusion.tree_size ?? null,
          root: result.root,
          anchors: {
            base: result.base.tx,
            solana: result.solana.signature,
          },
          ...(result.anchor_warnings && result.anchor_warnings.length > 0
            ? {
              warnings: [...result.anchor_warnings],
              partial: true,
              unchecked_anchors: result.anchor_warnings
                .map((code) => code.split(':')[0])
                .filter((chain): chain is 'base' | 'solana' => chain === 'base' || chain === 'solana'),
            }
            : {}),
        },
      };
    }
    if (result.overall === 'not_in_log') {
      return { logInclusion: 'fail', anchor: 'pass', logReason: 'not_in_log', log: null };
    }
    if (result.overall === 'pending') return missedLog('pending_anchor');
    if (result.overall === 'could_not_check') {
      const reason = [result.base.reason, result.solana.reason].find((code) => isUncheckedAnchorReason(code))
        || 'anchor_unreachable';
      return {
        logInclusion: result.inclusion.valid ? 'pass' : 'could_not_check',
        anchor: 'could_not_check',
        logReason: reason,
        log: null,
      };
    }
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
    if (result.overall === 'failed') {
      const definitive = [result.base.reason, result.solana.reason].find((code) => (
        code === 'tx_reverted' || code === 'tx_failed' || code === 'chain_mismatch' || code === 'anchor_ref_invalid'
      ));
      if (definitive) {
        return { logInclusion: 'pass', anchor: 'fail', logReason: definitive, log: null };
      }
    }
    // A reached log whose signed head names no chain anchor is not an
    // unreachable log. `partial` is that case: inclusion held, both anchors pending.
    if (result.overall === 'partial') {
      return {
        logInclusion: result.inclusion.valid ? 'pass' : 'could_not_check',
        anchor: 'could_not_check',
        logReason: 'pending',
        log: null,
      };
    }
    return missed;
  } catch {
    return missed;
  }
}

export interface PublicShellOptions {
  version?: string;
  /** Verified issuer history (bundled, live, or file). Null is could_not_check. */
  history: IssuerHistoryDocument | null;
  historySource?: 'file' | 'live' | 'bundled' | null;
  historyHead?: string | null;
  historyCount?: number | null;
  historyAsOf?: string | null;
  /** History that failed to verify or extend the bundled chain: exit 1. */
  historyInvalidReason?: string | null;
  /** The id the user asked for (URL path or id input). Null for pasted JSON. */
  requestedId?: string | null;
  /** Origin of the log. Loopback only when not public input. */
  origin?: string | null;
  publicInput?: boolean;
  rpcUrl?: string;
  trustedKids?: readonly string[];
}

type PublicChecks = VerifyVerdict['checks'];

function publicVerdict(
  opts: PublicShellOptions,
  result: VerifyVerdict['result'],
  reason: string | null,
  checks: PublicChecks,
  claims: PublicReceiptClaims | null,
  log: VerifyVerdict['log'],
  chainFrom: string | null,
): VerifyVerdict {
  const copy = verdictCopy(reason, result);
  const exit_code: 0 | 1 | 2 = result === 'verified_public' ? 0 : result === 'invalid' ? 1 : 2;
  const id = result === 'verified_public' && claims ? claims.task_id : null;
  return {
    result,
    exit_code,
    reason,
    message: copy.message,
    next_step: copy.next_step,
    receipt_id: id,
    display_id: id,
    payload_version: null,
    checks: { ...checks, payer: 'not_claimed' },
    scope: 'public',
    public: {
      claims: 'amount, payee, tx, log position',
      payer: 'not_claimed',
      chain_from: result === 'verified_public' ? truncateAddress(chainFrom) : null,
      task_id_to_leaf: 'issuer_signature',
    },
    history: {
      source: opts.historySource ?? null,
      head_hash: opts.historyHead ?? null,
      entry_count: opts.historyCount ?? null,
      as_of: opts.historyAsOf ?? null,
    },
    log,
    verifier: { name: 'chit402-verify', version: opts.version || packageVersion() },
  };
}

function shellFieldMismatch(shell: Record<string, unknown>, claims: PublicReceiptClaims): string | null {
  const eqId = (field: string) => {
    const value = shell[field];
    return value == null || sameReceiptId(value, claims.task_id);
  };
  if (!eqId('task_id')) return 'task_id';
  if (!eqId('receipt_id')) return 'receipt_id';
  const pay = claims.payment;
  const txHash = pay.ref.slice('base:'.length);
  const checks: Array<[string, (value: unknown) => boolean]> = [
    ['amount_gross', (v) => String(v) === pay.gross_amount],
    ['amount_settled', (v) => String(v) === pay.settled_amount],
    ['pay_to', (v) => typeof v === 'string' && v.toLowerCase() === pay.payee.toLowerCase()],
    ['payment_tx', (v) => typeof v === 'string' && v.toLowerCase().replace(/^base:/, '') === txHash],
    ['chain', (v) => typeof v === 'string' && ['base', 'eip155:8453'].includes(v.toLowerCase())],
    ['asset', (v) => typeof v === 'string' && (v.toLowerCase() === pay.asset.toLowerCase() || v.toUpperCase() === 'USDC')],
    ['issued_at', (v) => v === claims.issued_at],
  ];
  for (const [field, ok] of checks) {
    const value = shell[field];
    if (value == null) continue;
    if (!ok(value)) return field;
  }
  return null;
}

/**
 * Public attestation path (0.4.6). Returns null when the document carries
 * no `public_attestation`; the caller keeps the 0.4.5 result. A present but
 * malformed or invalid attestation is exit 1. It never falls back to
 * `signed_receipt_unavailable`. A pending attestation is exit 2.
 */
export async function verifyPublicShell(
  shell: Record<string, unknown>,
  opts: PublicShellOptions,
): Promise<VerifyVerdict | null> {
  if (!Object.prototype.hasOwnProperty.call(shell, 'public_attestation')) return null;
  const could: PublicChecks = {
    signature: 'could_not_check',
    key_window: 'could_not_check',
    payment_binding: 'could_not_check',
    log_inclusion: 'could_not_check',
    anchor: 'could_not_check',
    shape: 'could_not_check',
  };
  const att = shell.public_attestation as { status?: unknown; jws?: unknown } | null;
  if (att && typeof att === 'object' && !Array.isArray(att) && att.jws == null && att.status === 'pending'
    && Object.keys(att).length === 1) {
    return publicVerdict(opts, 'could_not_check', 'public_attestation_pending', could, null, null, null);
  }
  const parsed = parsePublicAttestation(att && typeof att === 'object' ? att.jws : null);
  if (!parsed.ok || !parsed.claims) {
    return publicVerdict(opts, 'invalid', 'invalid_jws', { ...could, shape: 'fail' }, null, null, null);
  }
  const claims = parsed.claims;
  const checks: PublicChecks = { ...could, shape: 'pass' };
  if (opts.historyInvalidReason) {
    return publicVerdict(opts, 'invalid', opts.historyInvalidReason, { ...checks, key_window: 'fail' }, null, null, null);
  }
  if (!opts.history) {
    return publicVerdict(opts, 'could_not_check', 'issuer_history_unavailable', checks, null, null, null);
  }
  const trust = verifyPublicAttestationTrust(parsed, opts.history);
  if (!trust.ok) {
    if (trust.check === 'key_window') {
      return publicVerdict(opts, 'invalid', trust.reason, { ...checks, signature: 'pass', key_window: 'fail' }, null, null, null);
    }
    return publicVerdict(opts, 'invalid', trust.reason, { ...checks, signature: 'fail' }, null, null, null);
  }
  checks.signature = 'pass';
  checks.key_window = 'pass';
  if (claims.payment.ref.startsWith('solana:')) {
    return publicVerdict(opts, 'could_not_check', 'public_rail_unsupported', checks, null, null, null);
  }

  // Subject binding: the id asked for, and every outer shell field, must
  // be the signed value. The outer fields are display only.
  if (opts.requestedId != null && !sameReceiptId(opts.requestedId, claims.task_id)) {
    return publicVerdict(opts, 'invalid', 'claim_mismatch', { ...checks, payment_binding: 'fail' }, null, null, null);
  }
  if (shellFieldMismatch(shell, claims)) {
    return publicVerdict(opts, 'invalid', 'claim_mismatch', { ...checks, payment_binding: 'fail' }, null, null, null);
  }
  const shellInclusion = shell.inclusion as { leaf_hash?: unknown } | null | undefined;
  if (shellInclusion && typeof shellInclusion === 'object' && shellInclusion.leaf_hash != null
    && String(shellInclusion.leaf_hash).toLowerCase() !== claims.log.leaf_hash) {
    return publicVerdict(opts, 'invalid', 'leaf_not_bound', { ...checks, log_inclusion: 'fail' }, null, null, null);
  }

  // Fresh log: the proof is for the signed leaf at the signed index.
  let host = opts.origin || null;
  if (!host) host = 'https://api.chit402.com';
  const verifyUrl = `${host}/receipt/${encodeURIComponent(claims.task_id)}`;
  let fresh: FreshLog;
  if (!historyHostAllowed(verifyUrl, { loopback: opts.publicInput !== true })) {
    fresh = missedLog();
  } else {
    fresh = await freshPublicLog(
      { verify_url: verifyUrl, task_id: claims.task_id },
      opts.history,
      { signedLeaf: claims.log, trustedKids: opts.trustedKids },
    );
  }
  checks.log_inclusion = fresh.logInclusion;
  checks.anchor = fresh.anchor;
  if (fresh.logInclusion === 'fail' || fresh.anchor === 'fail') {
    const reason = fresh.logReason === 'not_in_log' ? 'not_in_log' : (fresh.logReason || 'log_inclusion');
    return publicVerdict(opts, 'invalid', reason, checks, null, null, null);
  }
  // A fixed head that does not say what its signed head says is a definite
  // failure here too, as on the full path.
  if (fresh.fixedHeadInvalid) {
    return publicVerdict(opts, 'invalid', 'fixed_head_invalid', { ...checks, log_inclusion: 'fail' }, null, null, null);
  }

  // On chain: exactly one matching Transfer of the signed settled amount.
  const paid = await verifyPublicBasePayment({
    ref: claims.payment.ref,
    asset: claims.payment.asset,
    payee: claims.payment.payee,
    settledAmount: claims.payment.settled_amount,
    rpcUrl: opts.rpcUrl,
  });
  checks.payment_binding = paid.state;
  if (paid.state === 'fail') {
    return publicVerdict(opts, 'invalid', paid.reason || 'transfer_mismatch', checks, null, null, null);
  }
  if (fresh.logInclusion !== 'pass' || fresh.anchor !== 'pass') {
    return publicVerdict(opts, 'could_not_check', fresh.logReason || 'log_unreachable', checks, null, null, null);
  }
  if (paid.state !== 'pass') {
    return publicVerdict(opts, 'could_not_check', paid.reason || 'payer_unchecked', checks, null, null, null);
  }
  return publicVerdict(opts, 'verified_public', null, checks, claims, fresh.log, paid.from);
}

/** The receipt id named by an id or receipt URL input. Null for files and pasted JSON. */
export function receiptIdFromTarget(target: string): string | null {
  const id = /(?:^|\/receipt\/)((?:chit|xfuel)-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})(?:$|[/?#.])/i.exec(target.trim());
  return id ? id[1] : null;
}

async function loadReceiptTarget(target: string, publicInput: boolean): Promise<LoadedReceipt> {
  if (target === '-') {
    if (publicInput) {
      const err = new Error('stdin is not a receipt');
      (err as { code?: string }).code = 'UNREADABLE';
      throw err;
    }
    return { receipt: JSON.parse(readFileSync(0, 'utf8')) as XFuelReceipt, origin: null };
  }
  let url: string | null = null;
  if (/^https?:\/\//i.test(target)) url = receiptJsonUrl(target);
  else if (RECEIPT_ID_RE.test(target)) url = `https://api.chit402.com/receipt/${target}?format=json`;
  if (url) {
    if (publicInput && !receiptUrlAllowed(url)) {
      const err = new Error('receipt host is not fetched');
      (err as { code?: string }).code = 'REMOTE';
      throw err;
    }
    let res: Response;
    try {
      res = await fetch(url, {
        headers: { accept: 'application/json' },
        signal: AbortSignal.timeout(LOG_FETCH_MS),
        // A trusted host must not bounce the public box to another host.
        redirect: publicInput ? 'error' : 'follow',
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
  if (publicInput) {
    const err = new Error('not a receipt');
    (err as { code?: string }).code = 'UNREADABLE';
    throw err;
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
  if (code === 'ENOENT' || message.includes('ENOENT') || code === 'UNREADABLE') {
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
  publicInput = false,
): { verify_url: string; task_id: string } | null {
  const task = receipt.task_id || (receipt as { receipt_id?: string | null }).receipt_id || null;
  if (!task || !RECEIPT_ID_RE.test(String(task))) return null;
  let host = origin;
  if (!host && typeof receipt.verify_url === 'string') {
    try { host = new URL(receipt.verify_url).origin; } catch { host = null; }
  }
  if (!host) host = 'https://api.chit402.com';
  const verifyUrl = `${host}/receipt/${encodeURIComponent(String(task))}`;
  if (!historyHostAllowed(verifyUrl, { loopback: !publicInput })) return null;
  return { verify_url: verifyUrl, task_id: String(task) };
}

export interface CheckReceiptOptions {
  /** Bytes of `--issuer-history`, already read. Omitted uses the CLI default. */
  issuerHistoryBytes?: string | null;
  /**
   * Public box. No filesystem, no stdin. A receipt URL is fetched only when
   * its host is one the verifier already trusts.
   */
  publicInput?: boolean;
  /**
   * Defaults to the production pin. A test may add a throwaway kid. The CLI
   * does not set this.
   */
  trustedKids?: readonly string[];
  /** Default true. Exit 0 requires this check to have passed. */
  checkPayer?: boolean;
  rpcUrl?: string;
  solanaRpcUrl?: string;
}

export interface CheckReceiptOutcome {
  verdict: VerifyVerdict;
  lines: string[];
  /**
   * `lines` — the CLI prints `humanVerdictLines`.
   * `stderr` — local input could not be read. The CLI prints `message` on stderr and exits 1.
   */
  report: 'lines' | 'stderr';
  message?: string;
  reason?: string;
}

function linesOutcome(verdict: VerifyVerdict): CheckReceiptOutcome {
  return { verdict, lines: humanVerdictLines(verdict), report: 'lines' };
}

/**
 * Same check the CLI runs for one id, URL, file, or pasted receipt JSON.
 * `publicInput` accepts only JSON, an id, or an allowed URL.
 */
/** L5 wiring: the decision is in log-time.ts. */
async function logTimeCheck(
  result: Awaited<ReturnType<typeof verifyReceipt>>,
  verified: NonNullable<FreshLog['verified']>,
  history: IssuerHistoryDocument | null,
  trustedKids: readonly string[],
  options: CheckReceiptOptions,
): Promise<'log_time_after_window' | 'log_time_unavailable' | null> {
  // No production-signed windows bundled: L5 does not run.
  const windows = activeVersionWindows(readTestSnapshot(options)?.versionWindows);
  if (!windows) return null;
  return logTimeReason({
    claims: (result.issuer_signature.payload || {}) as Record<string, unknown>,
    windows,
    origin: verified.origin,
    leafIndex: verified.leafIndex,
    verifiedHead: verified.head as never,
    history,
    trustedKids,
    solanaRpcUrls: anchorRpcUrls('solana'),
    getJson: async (url) => {
      const res = await fetchNoRedirect(url, {
        headers: { accept: 'application/json' },
        signal: AbortSignal.timeout(LOG_FETCH_MS),
      });
      return res.json().catch(() => null);
    },
  });
}

export async function checkReceiptInput(raw: string, options: CheckReceiptOptions = {}): Promise<CheckReceiptOutcome> {
  const publicInput = options.publicInput === true;
  const target = publicInput ? String(raw ?? '').trim() : String(raw ?? '');
  let receipt: XFuelReceipt;
  let receiptOrigin: string | null = null;

  try {
    if (publicInput && classifyReceiptInput(target) === 'json') {
      let parsed: unknown;
      try {
        parsed = JSON.parse(target);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        const failure = { status: 1 as const, message: `Error reading receipt: ${message}`, reason: 'unreadable' };
        return {
          verdict: stderrVerdict(failure.reason),
          lines: [],
          report: 'stderr',
          message: failure.message,
          reason: failure.reason,
        };
      }
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        return {
          verdict: stderrVerdict('unreadable'),
          lines: [],
          report: 'stderr',
          message: `Error reading receipt: ${target}`,
          reason: 'unreadable',
        };
      }
      receipt = parsed as XFuelReceipt;
      receiptOrigin = null;
    } else {
      const loaded = await loadReceiptTarget(target, publicInput);
      receipt = loaded.receipt;
      receiptOrigin = loaded.origin;
    }
  } catch (err) {
    const failure = inputFailure(err, target);
    if (failure.status === 2) {
      const verdict = buildVerifyVerdict({
        version: packageVersion(),
        absentReason: failure.reason,
      });
      return linesOutcome(verdict);
    }
    return {
      verdict: stderrVerdict(failure.reason),
      lines: [],
      report: 'stderr',
      message: failure.message,
      reason: failure.reason,
    };
  }

  const trustedKids = options.trustedKids ? [...options.trustedKids] : [...DEFAULT_TRUSTED_ISSUER_KIDS];
  const checkPayer = options.checkPayer !== false;
  let resolved: ResolvedIssuerHistory;
  try {
    // A public shell has no verify_url. When it was fetched from a host,
    // read that host's live history (same host rule as a holder receipt) so
    // an attestation under a key added after the bundled snapshot can check.
    const shellOrigin = receiptOrigin
      && typeof receipt.verify_url !== 'string'
      && Object.prototype.hasOwnProperty.call(receipt, 'public_attestation');
    resolved = await resolveIssuerHistory({
      bundledOverride: readTestSnapshot(options)?.issuerHistory ?? null,
      fileBytes: options.issuerHistoryBytes ?? null,
      receipt: shellOrigin ? { ...receipt, verify_url: `${receiptOrigin}/receipt/` } : receipt,
      trustedKids,
      timeoutMs: LOG_FETCH_MS,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    // The bundled snapshot is a server file. Failing to read it does not
    // mean the pasted receipt is invalid.
    if (publicInput) {
      return linesOutcome(buildVerifyVerdict({
        version: packageVersion(),
        absentReason: 'issuer_history_unavailable',
      }));
    }
    return {
      verdict: stderrVerdict('unreadable'),
      lines: [],
      report: 'stderr',
      message: `Error reading issuer history: ${message}`,
      reason: 'unreadable',
    };
  }

  if (isRefusalDocument(receipt as unknown)) {
    const result = verifyRefusal(receipt as unknown as RefusalDocument, { trustedKids });
    const refusalId = result.valid ? (result.refusal_id || null) : null;
    const verdict = buildVerifyVerdict({
      version: packageVersion(),
      receiptId: refusalId,
      displayId: refusalId,
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
    return linesOutcome(verdict);
  }

  const unsigned = typeof receipt.issuer_signature?.jws !== 'string' || receipt.issuer_signature.jws.length === 0;
  if (unsigned || isReceiptShell(receipt)) {
    const kind = classifyReceiptInput(target);
    const publicResult = await verifyPublicShell(receipt as unknown as Record<string, unknown>, {
      history: resolved.invalid ? null : resolved.document,
      historyInvalidReason: resolved.invalid ? (resolved.reason || 'issuer_history_invalid') : null,
      historySource: resolved.source,
      historyHead: resolved.headHash,
      historyCount: resolved.entryCount,
      historyAsOf: resolved.asOf,
      requestedId: kind === 'url' || kind === 'id' ? receiptIdFromTarget(target) : null,
      origin: receiptOrigin,
      publicInput,
      rpcUrl: options.rpcUrl,
      trustedKids,
    });
    if (publicResult) return linesOutcome(publicResult);
    let logInclusion: CheckState | 'unclaimed' = 'unclaimed';
    let anchorState: CheckState | 'unclaimed' = 'unclaimed';
    let logReason: string | null = 'signed_receipt_unavailable';
    if (shellInclusionAbsent(receipt)) {
      const logReceipt = shellLogReceipt(receipt, receiptOrigin, publicInput);
      if (logReceipt && await publicShellAbsence(logReceipt, resolved.document, trustedKids)) {
        logInclusion = 'fail';
        anchorState = 'pass';
        logReason = 'not_in_log';
      }
    }
    const verdict = unsignedDocumentVerdict({
      version: packageVersion(),
      history: {
        source: resolved.source,
        headHash: resolved.headHash,
        entryCount: resolved.entryCount,
        asOf: resolved.asOf,
      },
      logInclusion,
      anchor: anchorState,
      notInLog: logReason === 'not_in_log',
    });
    return linesOutcome(verdict);
  }

  const result = await verifyReceipt(receipt, carryTestSnapshot(options, {
    trustedKids,
    requirePreimages: true,
    checkPayer,
    rpcUrl: options.rpcUrl || process.env.BASE_RPC_URL || BASE_RPC_URL,
    solanaRpcUrl: options.solanaRpcUrl || process.env.SOLANA_RPC_URL || SOLANA_RPC_URL,
    ...historyOptions(resolved),
  }));

  const unsupported = (result.errors || []).includes('unsupported_version');
  let logInclusion: CheckState | 'unclaimed' = 'unclaimed';
  let anchorState: CheckState | 'unclaimed' = 'unclaimed';
  let logReason: string | null = null;
  let log: VerifyVerdict['log'] = null;
  const signatureOk = result.issuer_signature.valid === true && !resolved.invalid && !unsupported;
  const logHostOk = typeof receipt.verify_url === 'string' && historyHostAllowed(receipt.verify_url, { loopback: !publicInput });
  let fixedHeadInvalid: string | null = null;
  if (signatureOk && result.issuer_history.ok && logHostOk) {
    // Same pins as the receipt signature. The CLI never sets trustedKids, so
    // this is the production pin there.
    const fresh = await freshPublicLog(receipt, resolved.document, { trustedKids });
    fixedHeadInvalid = fresh.fixedHeadInvalid ?? null;
    logInclusion = fresh.logInclusion;
    anchorState = fresh.anchor;
    logReason = fresh.logReason;
    log = fresh.log;
    if (fresh.logInclusion === 'pass' && fresh.verified) {
      const reason = await logTimeCheck(result, fresh.verified, resolved.document, trustedKids, options);
      if (reason) {
        result.issuer_history = {
          ...result.issuer_history,
          checked: true,
          ok: false,
          unreachable: reason === 'log_time_unavailable',
          reason,
        };
      }
    }
  }

  const signedId = result.issuer_signature.valid === true
    ? signedReceiptId(result.issuer_signature.payload)
    : null;
  const verdict = verdictFromVerification(result, {
    version: packageVersion(),
    receiptId: signedId,
    history: {
      source: resolved.source,
      headHash: resolved.headHash,
      entryCount: resolved.entryCount,
      asOf: resolved.asOf,
      invalid: resolved.invalid,
      reason: resolved.reason,
      documentPresent: resolved.document != null,
    },
    payerRequired: checkPayer,
    logInclusion,
    anchor: anchorState,
    logReason,
    log,
    failureReason: result.payer_binding?.checked === true && result.payer_binding.valid === false
      ? 'payer_binding_invalid'
      : (fixedHeadInvalid ? 'fixed_head_invalid' : null),
  });
  if (result.payer_binding) {
    verdict.payer_binding = {
      checked: result.payer_binding.checked,
      valid: result.payer_binding.valid,
      reason: result.payer_binding.valid ? null : result.payer_binding.reason,
    };
  }
  return linesOutcome(verdict);
}

function stderrVerdict(reason: string): VerifyVerdict {
  return buildVerifyVerdict({
    version: packageVersion(),
    errors: [reason],
    signatureChecked: true,
    signatureValid: false,
    logInclusion: 'could_not_check',
    anchor: 'could_not_check',
  });
}
