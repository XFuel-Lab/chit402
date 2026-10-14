/**
 * chit402.public.v1 — a derived public statement.
 *
 * PUBLIC_VERIFIED is not VERIFIED. The payer, the agent, the book, and the
 * content are not in the record. payment_tx is not in the record, so the
 * payment check is not_checked and a green result still says so.
 *
 * Trust is the pinned kid plus a history document that verifies under that
 * pin. A caller-supplied JWKS is not a trust root. A kid outside that set
 * is `key untrusted`, including when no key material is available to check
 * the signature bytes.
 *
 * v10 and v11 bind leaf_hash by the issuer signature (issuer_asserted).
 * The leaf is accepted only when that hash sits under a head whose issuer
 * JWS verifies. A null leaf is PUBLIC_SIGNED_NOT_IN_LOG and is not green.
 * Trust for the record's kid is judged at public_signed_at.
 */
import { createHash } from 'node:crypto';
import { verifyMerkleInclusion } from './anchor-witness.js';
import { verifyTreeHeadTrust, type TreeHeadDocument } from './anchor-trust.js';
import {
  DEFAULT_TRUSTED_ISSUER_KIDS,
  isEs256PublicJwk,
  jwkThumbprint,
  verifyIssuerJws,
  type Es256Jwk,
} from './jws.js';
import {
  issuerKeyWindow,
  verifyIssuerHistoryDocument,
  type IssuerHistoryDocument,
} from './issuer-history.js';

export const PUBLIC_RECORD_SCHEMA = 'chit402.public.v1';
export const PUBLIC_RECORD_TYP = 'chit402.public+jws';

export const PUBLIC_RECORD_ALLOWLIST = [
  'schema',
  'receipt_id',
  'payload_version',
  'full_receipt_sha256',
  'leaf_hash',
  'log_id',
  'asset',
  'chain',
  'pay_to',
  'amount_gross',
  'amount_settled',
  'issued_at',
  'public_signed_at',
  'kid',
] as const;

const ALLOWED = new Set<string>(PUBLIC_RECORD_ALLOWLIST);

/** Receipt versions this record may name. v12 stays unsupported. */
const KNOWN_PAYLOAD_VERSIONS = new Set([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]);

export const PUBLIC_NOT_CHECKED = ['payer', 'agent', 'content', 'usage'] as const;

export const PUBLIC_VERIFIED_HEADLINE = 'PUBLIC_VERIFIED (public copy) — payer, agent and content not checked';

const PRIVATE_NAMES = new Set([
  'payer_wallet',
  'agent_id',
  'claim_id',
  'book_id',
  'book_seq',
  'output_hash',
  'provider',
  'model',
  'prompt_tokens',
  'completion_tokens',
  'request_digest',
  'caller_binding',
  'intent',
  'route',
  'usage',
  'output',
  'payment_tx',
  'task_id',
  'salt',
  'salts',
  'commitments',
]);

export interface PublicRecordChecks {
  signature: 'ok' | 'failed' | 'not_checked';
  key: 'ok' | 'untrusted' | 'failed' | 'not_checked';
  inclusion: 'ok' | 'failed' | 'not_in_log' | 'not_checked';
  payment: 'not_checked';
}

export interface PublicRecordResult {
  exitCode: 0 | 1 | 2 | 3;
  verdict: 'PUBLIC_VERIFIED' | 'FAILED';
  reason: string | null;
  scope: 'public';
  leaf_binding: 'issuer_asserted' | null;
  checks: PublicRecordChecks;
  not_checked: readonly ['payer', 'agent', 'content', 'usage'];
  headline: string | null;
}

export interface VerifyPublicRecordInput {
  /** Pin. The CLI passes the production pin and nothing else. */
  trustedKids?: readonly string[] | null;
  /** Used only after verifyIssuerHistoryDocument accepts it under the pin. */
  history?: IssuerHistoryDocument | null;
  inclusion?: Record<string, unknown> | null;
  head?: Record<string, unknown> | null;
  fullJws?: string | null;
}

function sha256Hex(text: string): string {
  return createHash('sha256').update(Buffer.from(text, 'utf8')).digest('hex');
}

export function fullReceiptSha256(compactJws: string): string {
  return sha256Hex(compactJws);
}

function isJsonInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value);
}

function failed(
  exitCode: 1 | 2 | 3,
  reason: string,
  checks: PublicRecordChecks,
  leaf: 'issuer_asserted' | null = null,
): PublicRecordResult {
  return {
    exitCode,
    verdict: 'FAILED',
    reason,
    scope: 'public',
    leaf_binding: leaf,
    checks,
    not_checked: PUBLIC_NOT_CHECKED,
    headline: null,
  };
}

function baseChecks(): PublicRecordChecks {
  return {
    signature: 'not_checked',
    key: 'not_checked',
    inclusion: 'not_checked',
    payment: 'not_checked',
  };
}

export function readCompactHeader(jws: string): Record<string, unknown> | null {
  const part = String(jws || '').split('.')[0];
  if (!part) return null;
  try {
    const parsed = JSON.parse(Buffer.from(part, 'base64url').toString('utf8')) as unknown;
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : null;
  } catch {
    return null;
  }
}

export function readCompactPayload(jws: string): Record<string, unknown> | null {
  const parts = String(jws || '').split('.');
  if (parts.length !== 3 || !parts[1]) return null;
  try {
    const parsed = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8')) as unknown;
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : null;
  } catch {
    return null;
  }
}

function headerTyp(header: Record<string, unknown> | null): string | null {
  return header && typeof header.typ === 'string' ? header.typ : null;
}

/** True when the file is trying to be a public record, including an unknown version. */
export function isPublicRecordAttempt(text: string): boolean {
  const trimmed = String(text || '').trim();
  if (!trimmed) return false;
  if (trimmed.startsWith('{')) {
    try {
      const doc = JSON.parse(trimmed) as Record<string, unknown>;
      if (!doc || typeof doc !== 'object' || Array.isArray(doc)) return false;
      const schema = typeof doc.schema === 'string' ? doc.schema : '';
      if (schema.startsWith('chit402.public')) return true;
      const embedded = typeof doc.jws === 'string'
        ? doc.jws
        : (doc.issuer_signature && typeof doc.issuer_signature === 'object'
          ? (doc.issuer_signature as { jws?: unknown }).jws
          : null);
      const typ = typeof embedded === 'string' ? headerTyp(readCompactHeader(embedded)) : null;
      return !!typ && typ.startsWith('chit402.public');
    } catch {
      return false;
    }
  }
  const typ = headerTyp(readCompactHeader(trimmed));
  return !!typ && typ.startsWith('chit402.public');
}

function compactFromText(text: string): string | null {
  const trimmed = text.trim();
  if (!trimmed) return null;
  if (!trimmed.startsWith('{')) return trimmed;
  try {
    const doc = JSON.parse(trimmed) as Record<string, unknown>;
    if (typeof doc.jws === 'string') return doc.jws;
    const sig = doc.issuer_signature;
    if (sig && typeof sig === 'object' && typeof (sig as { jws?: unknown }).jws === 'string') {
      return (sig as { jws: string }).jws;
    }
  } catch {
    return null;
  }
  return null;
}

function payloadKeysRejected(payload: Record<string, unknown>): string | null {
  for (const key of Object.keys(payload)) {
    if (PRIVATE_NAMES.has(key) || !ALLOWED.has(key)) return key;
  }
  for (const key of PUBLIC_RECORD_ALLOWLIST) {
    if (!Object.prototype.hasOwnProperty.call(payload, key)) return key;
  }
  return null;
}

function historyKey(doc: IssuerHistoryDocument, kid: string): Es256Jwk | null {
  for (const entry of doc.entries || []) {
    if (!entry?.jwk || !isEs256PublicJwk(entry.jwk)) continue;
    if (entry.kid === kid || jwkThumbprint(entry.jwk) === kid) return entry.jwk;
  }
  return null;
}

interface HeadOk {
  ok: true;
  root: string;
  treeSize: number;
}

function verifySignedHead(
  head: Record<string, unknown> | null | undefined,
  trust: { trustedKids: readonly string[]; history: IssuerHistoryDocument | null },
): HeadOk | { ok: false } {
  if (!head) return { ok: false };
  const trusted = verifyTreeHeadTrust(head as TreeHeadDocument, {
    trustedKids: trust.trustedKids,
    issuerHistory: trust.history,
  });
  if (!trusted.ok || !trusted.payload) return { ok: false };
  const root = typeof trusted.payload.root === 'string'
    ? trusted.payload.root.replace(/^0x/, '').toLowerCase()
    : '';
  if (!/^[0-9a-f]{64}$/.test(root)) return { ok: false };
  if (!isJsonInteger(trusted.payload.tree_size) || trusted.payload.tree_size < 1) return { ok: false };
  return { ok: true, root, treeSize: trusted.payload.tree_size };
}

function inclusionAgrees(
  leafHash: string,
  inclusion: Record<string, unknown> | null | undefined,
  head: HeadOk,
): boolean {
  if (!/^[0-9a-fA-F]{64}$/.test(leafHash)) return false;
  if (!inclusion || !Array.isArray(inclusion.proof)) return false;
  const index = inclusion.leaf_index ?? inclusion.index;
  const size = inclusion.tree_size;
  if (!isJsonInteger(index) || !isJsonInteger(size)) return false;
  if (size !== head.treeSize) return false;
  const root = typeof inclusion.root === 'string'
    ? inclusion.root.replace(/^0x/, '').toLowerCase()
    : head.root;
  if (root !== head.root) return false;
  const leaf = Buffer.from(leafHash, 'hex');
  return verifyMerkleInclusion(
    leaf,
    index,
    size,
    head.root,
    inclusion.proof as { hash: string; position?: string }[],
  );
}

/**
 * Verify one public record. The text is the compact JWS, or a JSON envelope
 * whose `jws` is that compact serialization. The envelope is not the record.
 * Inclusion and head are the bodies fetched from the receipt URL. They are
 * not a second trust input.
 */
export function verifyPublicRecord(text: string, input: VerifyPublicRecordInput = {}): PublicRecordResult {
  const checks = baseChecks();
  const jws = compactFromText(text);
  if (!jws) return failed(3, 'invalid_jws', checks);
  const header = readCompactHeader(jws);
  const payload = readCompactPayload(jws);
  const typ = headerTyp(header);
  const schema = payload && typeof payload.schema === 'string' ? payload.schema : '';
  if (typ !== PUBLIC_RECORD_TYP || schema !== PUBLIC_RECORD_SCHEMA) {
    return failed(2, 'unsupported_version', checks);
  }
  if (!header || header.alg !== 'ES256') {
    checks.signature = 'failed';
    return failed(1, 'unsupported_alg', checks);
  }
  if (!payload || payloadKeysRejected(payload)) {
    checks.signature = 'failed';
    return failed(1, 'public_field_rejected', checks);
  }
  const version = payload.payload_version;
  const versionKnown = version === null || (isJsonInteger(version) && KNOWN_PAYLOAD_VERSIONS.has(version));
  if (!versionKnown) return failed(2, 'unsupported_version', checks);

  const kid = typeof payload.kid === 'string' ? payload.kid : '';
  if (!kid || header.kid !== kid) {
    checks.signature = 'failed';
    checks.key = 'failed';
    return failed(1, 'kid_mismatch', checks);
  }

  const trustedKids = input.trustedKids ?? DEFAULT_TRUSTED_ISSUER_KIDS;
  let history: IssuerHistoryDocument | null = null;
  if (input.history) {
    const historyOk = verifyIssuerHistoryDocument(input.history, { trustedKids });
    if (!historyOk.valid) {
      checks.key = 'untrusted';
      const reason = historyOk.reason === 'signature_invalid' ? 'key untrusted' : (historyOk.reason || 'key untrusted');
      return failed(1, reason, checks);
    }
    history = input.history;
  }

  const jwk = history ? historyKey(history, kid) : null;
  if (!jwk) {
    checks.key = 'untrusted';
    checks.signature = 'not_checked';
    return failed(1, 'key untrusted', checks);
  }
  const window = issuerKeyWindow(history as IssuerHistoryDocument, kid, payload.public_signed_at);
  if (!window.ok) {
    checks.key = 'untrusted';
    return failed(1, window.reason || 'key untrusted', checks);
  }

  const verified = verifyIssuerJws(jws, jwk);
  if (!verified.valid) {
    checks.signature = 'failed';
    checks.key = 'ok';
    return failed(1, verified.reason === 'key untrusted' ? 'key untrusted' : 'signature_invalid', checks);
  }
  checks.signature = 'ok';
  checks.key = 'ok';

  if (input.fullJws != null) {
    const got = sha256Hex(input.fullJws);
    if (got !== payload.full_receipt_sha256) {
      return failed(1, 'public_full_mismatch', checks);
    }
  }

  const leaf = payload.leaf_hash;
  if (leaf == null) {
    checks.inclusion = 'not_in_log';
    return failed(1, 'PUBLIC_SIGNED_NOT_IN_LOG', checks);
  }
  if (typeof leaf !== 'string') {
    checks.inclusion = 'failed';
    return failed(1, 'inclusion_mismatch', checks);
  }

  const head = verifySignedHead(input.head, { trustedKids, history });
  if (!head.ok) return failed(2, 'head_unavailable', checks);

  if (!inclusionAgrees(leaf, input.inclusion, head)) {
    checks.inclusion = 'failed';
    return failed(1, 'inclusion_mismatch', checks);
  }
  checks.inclusion = 'ok';

  return {
    exitCode: 0,
    verdict: 'PUBLIC_VERIFIED',
    reason: null,
    scope: 'public',
    leaf_binding: 'issuer_asserted',
    checks,
    not_checked: PUBLIC_NOT_CHECKED,
    headline: PUBLIC_VERIFIED_HEADLINE,
  };
}

function checkState(value: PublicRecordChecks['signature'] | PublicRecordChecks['key'] | PublicRecordChecks['inclusion']): 'pass' | 'fail' | 'could_not_check' {
  if (value === 'ok') return 'pass';
  if (value === 'not_checked') return 'could_not_check';
  return 'fail';
}

/** 0.4.0 verdict object plus the public-copy fields. Payment stays not_checked and does not demote exit 0. */
export function publicRecordJson(result: PublicRecordResult, version = '0.4.0'): Record<string, unknown> {
  const exit = result.exitCode === 0 ? 0 : result.exitCode === 2 ? 2 : result.exitCode === 3 ? 1 : 1;
  const outcome = result.exitCode === 0 ? 'verified' : result.exitCode === 2 ? 'could_not_check' : 'invalid';
  const inclusion = checkState(result.checks.inclusion);
  return {
    result: outcome,
    exit_code: exit,
    reason: result.reason,
    message: result.headline || result.reason,
    next_step: null,
    scope: 'public',
    verdict: result.verdict,
    leaf_binding: result.leaf_binding,
    not_checked: result.not_checked,
    checks: {
      signature: checkState(result.checks.signature),
      key_window: checkState(result.checks.key),
      payment_binding: 'could_not_check',
      log_inclusion: inclusion,
      anchor: result.exitCode === 0 ? 'pass' : result.exitCode === 2 ? 'could_not_check' : inclusion,
      shape: result.reason === 'unsupported_version' || result.reason === 'public_field_rejected' ? 'fail' : 'pass',
      key: result.checks.key,
      inclusion: result.checks.inclusion,
      payment: 'not_checked',
    },
    history: {
      source: null,
      head_hash: null,
      entry_count: null,
      as_of: null,
    },
    log: null,
    verifier: { name: 'chit402-verify', version },
  };
}
