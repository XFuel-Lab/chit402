/**
 * chit402.public.v1 — a derived public statement.
 *
 * PUBLIC_VERIFIED is not VERIFIED. The payer, the agent, the book, and the
 * content are not in the record. payment_tx is not in the record, so the
 * payment check is "not_checked" and a green result still says so.
 *
 * v10 and v11 bind leaf_hash by the issuer signature (issuer_asserted).
 * The leaf is accepted only when that hash sits under a head whose issuer
 * JWS verifies. A null leaf is PUBLIC_SIGNED_NOT_IN_LOG and is not green.
 * Trust for the record's kid is judged at public_signed_at.
 */
import { createHash } from 'node:crypto';
import { verifyMerkleInclusion } from './anchor-witness.js';
import {
  DEFAULT_TRUSTED_ISSUER_KIDS,
  isPinnedTrustedJwk,
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

interface JwksLike {
  keys?: Es256Jwk[];
}

export interface VerifyPublicRecordInput {
  jwks?: JwksLike | null;
  trustedKids?: readonly string[] | null;
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

function candidateKeys(
  kid: string,
  jwks: JwksLike | null | undefined,
  history: IssuerHistoryDocument | null | undefined,
): Es256Jwk[] {
  const found: Es256Jwk[] = [];
  for (const key of jwks?.keys || []) {
    if (!kid || key.kid === kid) found.push(key);
  }
  const entry = (history?.entries || []).find((row) => row.kid === kid);
  if (entry?.jwk) found.push(entry.jwk);
  return found;
}

function keyIsTrusted(
  jwk: Es256Jwk,
  kid: string,
  jwks: JwksLike | null | undefined,
  trustedKids: readonly string[],
  historyTrusted: boolean,
): boolean {
  const inJwks = (jwks?.keys || []).some((key) => key.kid === kid && key.x === jwk.x && key.y === jwk.y);
  if (inJwks) return true;
  if (historyTrusted) return true;
  return isPinnedTrustedJwk(jwk, trustedKids);
}

interface HeadOk {
  ok: true;
  root: string;
  treeSize: number;
}

function verifySignedHead(
  head: Record<string, unknown> | null | undefined,
  trust: { jwks?: JwksLike | null; trustedKids: readonly string[]; history?: IssuerHistoryDocument | null },
): HeadOk | { ok: false } {
  const sig = head?.issuer_signature;
  const jws = sig && typeof sig === 'object' ? (sig as { jws?: unknown }).jws : null;
  if (!head || typeof jws !== 'string' || jws.split('.').length !== 3) return { ok: false };
  const header = readCompactHeader(jws);
  if (!header || header.alg !== 'ES256' || typeof header.kid !== 'string') return { ok: false };
  const historyTrusted = !!trust.history && verifyIssuerHistoryDocument(trust.history, {
    jwks: trust.jwks?.keys ? { keys: trust.jwks.keys } : undefined,
    trustedKids: trust.trustedKids,
  }).valid;
  const keys = candidateKeys(header.kid, trust.jwks, trust.history);
  let payload: Record<string, unknown> | null = null;
  for (const jwk of keys) {
    if (!keyIsTrusted(jwk, header.kid, trust.jwks, trust.trustedKids, historyTrusted)) continue;
    const verified = verifyIssuerJws(jws, jwk);
    if (verified.valid && verified.payload) {
      payload = verified.payload;
      break;
    }
  }
  if (!payload) return { ok: false };
  const signedRoot = typeof payload.root === 'string' ? payload.root.replace(/^0x/, '').toLowerCase() : '';
  if (!/^[0-9a-f]{64}$/.test(signedRoot)) return { ok: false };
  if (!isJsonInteger(payload.tree_size) || payload.tree_size < 1) return { ok: false };
  const outerRoot = typeof head.root === 'string' ? head.root.replace(/^0x/, '').toLowerCase() : signedRoot;
  const outerSize = head.tree_size == null ? payload.tree_size : head.tree_size;
  if (outerRoot !== signedRoot) return { ok: false };
  if (!isJsonInteger(outerSize) || outerSize !== payload.tree_size) return { ok: false };
  return { ok: true, root: signedRoot, treeSize: payload.tree_size };
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
  let historyTrusted = false;
  if (input.history) {
    const historyOk = verifyIssuerHistoryDocument(input.history, {
      jwks: input.jwks?.keys ? { keys: input.jwks.keys } : undefined,
      trustedKids,
    });
    if (!historyOk.valid) {
      checks.key = 'untrusted';
      return failed(1, historyOk.reason || 'issuer_history_invalid', checks);
    }
    const window = issuerKeyWindow(input.history, kid, payload.public_signed_at);
    if (!window.ok) {
      checks.key = 'untrusted';
      return failed(1, window.reason || 'kid_window', checks);
    }
    historyTrusted = true;
  }

  const keys = candidateKeys(kid, input.jwks, input.history);
  let signatureOk = false;
  let trusted = false;
  for (const jwk of keys) {
    const verified = verifyIssuerJws(jws, jwk);
    if (!verified.valid) continue;
    signatureOk = true;
    if (keyIsTrusted(jwk, kid, input.jwks, trustedKids, historyTrusted)) trusted = true;
    if (trusted) break;
  }
  checks.signature = signatureOk ? 'ok' : 'failed';
  checks.key = trusted ? 'ok' : 'untrusted';
  if (!signatureOk) return failed(1, 'signature_invalid', checks);
  if (!trusted) return failed(1, 'key untrusted', checks);

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

  const head = verifySignedHead(input.head, {
    jwks: input.jwks,
    trustedKids,
    history: input.history,
  });
  if (!head.ok) return failed(2, 'head_unavailable', checks);

  if (!inclusionAgrees(leaf, input.inclusion, head)) {
    checks.inclusion = 'failed';
    return failed(1, 'inclusion_mismatch', checks);
  }
  checks.inclusion = 'ok';

  const leafBinding = 'issuer_asserted' as const;
  return {
    exitCode: 0,
    verdict: 'PUBLIC_VERIFIED',
    reason: null,
    scope: 'public',
    leaf_binding: leafBinding,
    checks,
    not_checked: PUBLIC_NOT_CHECKED,
    headline: PUBLIC_VERIFIED_HEADLINE,
  };
}

export function publicRecordJson(result: PublicRecordResult): Record<string, unknown> {
  return {
    verdict: result.verdict,
    scope: result.scope,
    leaf_binding: result.leaf_binding,
    reason: result.reason,
    checks: result.checks,
    not_checked: result.not_checked,
  };
}
