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
  DEFAULT_TRUSTED_ISSUER_KIDS,
  DEFAULT_TRUSTED_JWKS_HOSTS,
  type XFuelReceipt,
  type RefusalDocument,
} from './index.js';
import {
  verifyAnchoredRoot,
  type AnchorHead,
  type AnchorInclusion,
  type AnchorReceipt,
  type AnchorWitnessResult,
} from './anchor-witness.js';
import { isReceiptShell } from './shell.js';
import {
  epochHistoryKeyAllowed,
  resolveIssuerHistory,
  type IssuerHistoryDocument,
  type ResolvedIssuerHistory,
} from './issuer-history.js';
import { BASE_RPC_URL } from './base-payer.js';
import { SOLANA_RPC_URL } from './solana-payer.js';
import { payerCheckOutcome } from './payer.js';
import { type EpochRecord } from './epoch.js';
import { jwkThumbprint, verifyIssuerJws, type Es256Jwk } from './jws.js';
import {
  buildVerifyVerdict,
  humanVerdictLines,
  type CheckState,
  type VerifyVerdict,
} from './verdict.js';
import { verifyTreeHeadTrust } from './anchor-trust.js';

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

export function displayIdOf(receipt: { task_id?: string; display_id?: string; receipt_id?: string }): string | null {
  if (typeof receipt.display_id === 'string' && receipt.display_id) return receipt.display_id;
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
};

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

function sameEpochKey(a: Es256Jwk, b: Es256Jwk): boolean {
  return a.kty === b.kty && a.crv === b.crv && a.x === b.x && a.y === b.y;
}

/**
 * The epoch record is trusted only when its ES256 signature matches the
 * epochs, orphans, and unlogged claims, and the signing key was `active`
 * at `publishedAt` (or the JWS `iat`) and this history never revokes it.
 * A production pin with no history row for that kid stays the package pin.
 * A revoked or retired history key does not, even when the bytes verify.
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
  for (const entry of history?.entries || []) {
    const jwk = entry?.jwk as Es256Jwk | undefined;
    if (!jwk) continue;
    if (kid && entry.kid !== kid && jwk.kid !== kid) continue;
    if (keys.some((have) => sameEpochKey(have, jwk))) continue;
    keys.push(jwk);
  }
  for (const key of keys) {
    const verified = verifyIssuerJws(jws, key);
    if (!verified.valid || !verified.payload) continue;
    const payload = verified.payload;
    if (JSON.stringify(payload.epochs ?? null) !== JSON.stringify(record.epochs ?? null)) continue;
    if (JSON.stringify(payload.orphans ?? []) !== JSON.stringify(record.orphans ?? [])) continue;
    const payloadUnlogged = payload.unlogged === undefined ? null : payload.unlogged;
    const recordUnlogged = record.unlogged === undefined ? null : record.unlogged;
    if (JSON.stringify(payloadUnlogged) !== JSON.stringify(recordUnlogged)) continue;
    const signerKid = kid || key.kid || null;
    const at = payload.iat != null ? payload.iat : publishedAt;
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
    let epochRecord: EpochRecord | null = null;
    const headEpoch = (head as { epoch?: unknown; schema?: string }).epoch;
    const headSchema = (head as { schema?: string }).schema;
    if (headEpoch != null || headSchema === 'chit402.tree_head.v2') {
      try {
        const epochRes = await fetch(`${origin}/v1/receipts/tree/epoch`, {
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
      baseRpcUrl: process.env.BASE_RPC_URL || BASE_RPC_URL,
      solanaRpcUrl: process.env.SOLANA_RPC_URL || SOLANA_RPC_URL,
      checkNewestAnchor: false,
      issuerHistory: history,
      trustedKids: DEFAULT_TRUSTED_ISSUER_KIDS,
      epochRecord,
      verifyEpochSignature: epochRecord
        ? (jws) => epochRecordSignatureOk(
          epochRecord as EpochRecord,
          jws,
          history,
          (head as { published_at?: unknown }).published_at ?? null,
        )
        : undefined,
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
    resolved = await resolveIssuerHistory({
      fileBytes: options.issuerHistoryBytes ?? null,
      receipt,
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
    return linesOutcome(verdict);
  }

  const unsigned = typeof receipt.issuer_signature?.jws !== 'string' || receipt.issuer_signature.jws.length === 0;
  if (unsigned || isReceiptShell(receipt)) {
    let logInclusion: CheckState | 'unclaimed' = 'unclaimed';
    let anchorState: CheckState | 'unclaimed' = 'unclaimed';
    let logReason: string | null = 'signed_receipt_unavailable';
    if (shellInclusionAbsent(receipt)) {
      const logReceipt = shellLogReceipt(receipt, receiptOrigin, publicInput);
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
    return linesOutcome(verdict);
  }

  const result = await verifyReceipt(receipt, {
    trustedKids,
    requirePreimages: true,
    checkPayer,
    rpcUrl: options.rpcUrl || process.env.BASE_RPC_URL || BASE_RPC_URL,
    solanaRpcUrl: options.solanaRpcUrl || process.env.SOLANA_RPC_URL || SOLANA_RPC_URL,
    ...historyOptions(resolved),
  });

  const unsupported = (result.errors || []).includes('unsupported_version');
  let logInclusion: CheckState | 'unclaimed' = 'unclaimed';
  let anchorState: CheckState | 'unclaimed' = 'unclaimed';
  let logReason: string | null = null;
  let log: VerifyVerdict['log'] = null;
  const signatureOk = result.issuer_signature.valid === true && !resolved.invalid && !unsupported;
  const logHostOk = typeof receipt.verify_url === 'string' && historyHostAllowed(receipt.verify_url, { loopback: !publicInput });
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
    payerRequired: checkPayer,
    payerOutcome: checkPayer ? (result.payer.outcome ?? payerCheckOutcome(result.payer)) : null,
    errors: result.errors,
    logInclusion,
    anchor: anchorState,
    logReason,
    log,
  });
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
