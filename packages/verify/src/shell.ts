/**
 * Public receipt shell verdicts.
 * A shell is inclusion and payment facts without the holder signature.
 * INCLUDED_SHELL is never VERIFIED. A gated URL without the holder JWS
 * is owner_proof_required.
 * `--jws` is VERIFIED only when the holder key is trusted, inclusion
 * passed, and the signed payment is present. The key inside the holder
 * is not a trust root.
 */
import crypto from 'node:crypto';

export const SHELL_SCHEMA = 'chit402.receipt_shell.v1';
export const INCLUDED_SHELL_LINE = 'INCLUDED_SHELL: signature requires owner view';

export function isReceiptShell(doc: unknown): doc is Record<string, unknown> {
  return !!doc && typeof doc === 'object' && (doc as { schema?: string }).schema === SHELL_SCHEMA;
}

function jcs(value: unknown): string {
  return JSON.stringify(canonicalize(value));
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(value as Record<string, unknown>).sort()) {
      const child = (value as Record<string, unknown>)[key];
      if (child === undefined) continue;
      out[key] = canonicalize(child);
    }
    return out;
  }
  return value;
}

export function decodeJwsPayload(jws: unknown): Record<string, unknown> | null {
  if (typeof jws !== 'string') return null;
  const parts = jws.split('.');
  if (parts.length !== 3) return null;
  try {
    return JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8')) as Record<string, unknown>;
  } catch {
    return null;
  }
}

function minuteIso(value: unknown): string | null {
  if (value == null || value === '') return null;
  const ms = typeof value === 'number'
    ? (value < 1e12 ? value * 1000 : value)
    : Date.parse(String(value));
  if (!Number.isFinite(ms)) return null;
  const date = new Date(ms);
  date.setUTCSeconds(0, 0);
  return date.toISOString();
}

function paymentOf(claims: Record<string, unknown> | null, receipt: Record<string, unknown>) {
  const payment = (claims?.payment && typeof claims.payment === 'object')
    ? claims.payment as Record<string, unknown>
    : {};
  const outer = (receipt.payment && typeof receipt.payment === 'object')
    ? receipt.payment as Record<string, unknown>
    : {};
  return { ...outer, ...payment };
}

/** Project the public shell from a holder receipt. Leaf proof is not invented. */
export function shellFromHolder(receipt: Record<string, unknown>): Record<string, unknown> {
  const issuer = (receipt.issuer_signature && typeof receipt.issuer_signature === 'object')
    ? receipt.issuer_signature as Record<string, unknown>
    : {};
  const claims = decodeJwsPayload(issuer.jws) || {};
  const payment = paymentOf(claims, receipt);
  const ref = String(payment.ref || '');
  const prefix = ref.includes(':') ? ref.slice(0, ref.indexOf(':')) : '';
  const network = String(payment.network || (receipt.payment_meta as { network?: string } | undefined)?.network || prefix || '');
  const tx = ref.includes(':') ? ref.slice(ref.indexOf(':') + 1) : (ref || null);
  const receiptId = (receipt.task_id || claims.task_id || receipt.receipt_id || null) as string | null;
  const gross = payment.gross_amount ?? null;
  const settled = payment.settled_amount ?? null;
  const inclusion = (receipt.inclusion && typeof receipt.inclusion === 'object')
    ? receipt.inclusion as Record<string, unknown>
    : null;
  return {
    schema: SHELL_SCHEMA,
    unsigned: true,
    receipt_id: receiptId,
    task_id: receiptId,
    payload_version: claims.payload_version ?? issuer.payload_version ?? null,
    asset: payment.asset || 'USDC',
    chain: network || null,
    pay_to: payment.payee ?? null,
    amount_gross: gross == null ? null : String(gross),
    amount_settled: settled == null ? null : String(settled),
    payment_tx: tx,
    issued_at: minuteIso(claims.iat ?? receipt.created_at ?? receipt.issued_at ?? null),
    inclusion: {
      leaf_hash: inclusion?.leaf || inclusion?.leaf_hash || null,
      proof: inclusion?.proof ?? null,
      signed_head: inclusion?.root
        ? { root: inclusion.root, tree_size: inclusion.tree_size ?? null, signature: null }
        : null,
    },
  };
}

const COMPARE_FIELDS = [
  'receipt_id',
  'payload_version',
  'asset',
  'chain',
  'pay_to',
  'amount_gross',
  'amount_settled',
  'payment_tx',
  'issued_at',
] as const;

/**
 * The owner view returns `{ jws, salt, private_fields }`. A saved holder
 * receipt has `issuer_signature`. Either can be the `--jws` file.
 * An `issuer_jwk` on the owner-view body is ignored. Trust is a pinned
 * kid or a JWKS entry, not a key the response carries.
 */
export function holderDocumentFromOwnerView(doc: Record<string, unknown> | string): Record<string, unknown> {
  if (typeof doc === 'string') {
    const compact = doc.trim();
    if (compact.split('.').length === 3) return holderDocumentFromOwnerView({ jws: compact });
    throw new Error('holder is not a receipt or an owner-view response');
  }
  const signature = doc.issuer_signature;
  if (signature && typeof signature === 'object' && typeof (signature as { jws?: unknown }).jws === 'string') {
    return doc;
  }
  const jws = typeof doc.jws === 'string' ? doc.jws : null;
  if (!jws || jws.split('.').length !== 3) {
    throw new Error('owner view is missing the holder JWS');
  }
  const claims = decodeJwsPayload(jws) || {};
  let kid: string | undefined;
  try {
    const header = JSON.parse(Buffer.from(jws.split('.')[0], 'base64url').toString('utf8')) as { kid?: string };
    if (typeof header.kid === 'string') kid = header.kid;
  } catch {
    kid = undefined;
  }
  // Owner view carries this receipt's own book row hash so the leaf
  // task_id|row_hash can be rebuilt. It is not a signed claim; the leaf
  // still has to be in a signed tree head.
  const rowHash = typeof doc.row_hash === 'string' && /^[0-9a-f]{64}$/i.test(doc.row_hash) ? doc.row_hash : null;
  return {
    ...claims,
    task_id: claims.task_id ?? null,
    ...(rowHash ? { book_chain: { row_hash: rowHash } } : {}),
    issuer_signature: {
      jws,
      kid,
      payload_version: claims.payload_version ?? null,
    },
  };
}

export interface ShellHolderCheck {
  signatureValid: boolean;
  keyTrusted: boolean;
  signatureReason?: string | null;
  inclusionSupplied: boolean;
  inclusionOk: boolean;
  inclusionReason?: string | null;
  paymentRef?: string | null;
  bindingExpected?: boolean;
  bindingMatches?: boolean;
  shellLeaf?: string | null;
  provedLeaf?: string | null;
  /** The supplied head carries an issuer JWS (checked by verifyReceipt). */
  headSigned?: boolean;
}

/**
 * VERIFIED requires a trusted issuer key, a passing inclusion proof, and a
 * signed payment. A shell alone, a missing proof, or a key that only
 * verifies because it is embedded in the holder is not VERIFIED.
 */
export function shellHolderVerdict(check: ShellHolderCheck): { verified: boolean; reason: string | null } {
  if (!check.signatureValid || !check.keyTrusted) {
    return { verified: false, reason: check.signatureReason || 'key untrusted' };
  }
  if (!check.inclusionSupplied || !check.inclusionOk) {
    return { verified: false, reason: check.inclusionReason || 'inclusion_missing' };
  }
  const shellLeaf = check.shellLeaf ? String(check.shellLeaf).replace(/^0x/i, '').toLowerCase() : '';
  const proved = check.provedLeaf ? String(check.provedLeaf).replace(/^0x/i, '').toLowerCase() : '';
  if (shellLeaf && proved && shellLeaf !== proved) {
    return { verified: false, reason: 'inclusion_mismatch' };
  }
  if (shellLeaf && !proved) {
    return { verified: false, reason: 'inclusion_mismatch' };
  }
  // A {root, tree_size} written by hand (or a proof's own root) is not a log.
  if (check.headSigned !== true) {
    return { verified: false, reason: 'head_signature_missing' };
  }
  const ref = check.paymentRef ? String(check.paymentRef) : '';
  if (!ref) return { verified: false, reason: 'payment_unchecked' };
  if (check.bindingExpected && !check.bindingMatches) {
    return { verified: false, reason: 'payment_unchecked' };
  }
  return { verified: true, reason: null };
}

/**
 * Expected shell from the signed JWS claims only. Outer holder fields
 * (payment.settled_amount, payment.network, payment_meta, task_id) are
 * not signed and are not used, so they cannot ride along under VERIFIED.
 */
export function signedShellFromHolder(holder: Record<string, unknown> | string): Record<string, unknown> {
  const holderDoc = typeof holder === 'string' ? { issuer_signature: { jws: holder } } : holder;
  const sig = (holderDoc.issuer_signature && typeof holderDoc.issuer_signature === 'object')
    ? holderDoc.issuer_signature as { jws?: unknown }
    : {};
  return shellFromHolder({ issuer_signature: { jws: typeof sig.jws === 'string' ? sig.jws : null } });
}

export function compareShellToJws(shell: Record<string, unknown>, holder: Record<string, unknown> | string): { ok: boolean; field?: string } {
  const holderDoc = typeof holder === 'string' ? { issuer_signature: { jws: holder } } : holder;
  const expected = signedShellFromHolder(holderDoc);
  for (const field of COMPARE_FIELDS) {
    if (String(shell[field] ?? '') !== String(expected[field] ?? '')) {
      return { ok: false, field };
    }
  }
  const shellLeaf = (shell.inclusion as { leaf_hash?: unknown } | undefined)?.leaf_hash ?? null;
  const expectedLeaf = (expected.inclusion as { leaf_hash?: unknown } | undefined)?.leaf_hash ?? null;
  if (shellLeaf && expectedLeaf && String(shellLeaf) !== String(expectedLeaf)) {
    return { ok: false, field: 'inclusion.leaf_hash' };
  }
  return { ok: true };
}

/**
 * v11: body_commitment = HMAC-SHA256(salt, raw body),
 * request_digest = SHA-256 of the JCS object
 * {body_commitment, idempotency_key, method, nonce, path}.
 */
export function openV11Commitment(input: {
  payload: Record<string, unknown> | null;
  saltHex: string;
  body: Buffer | string;
  method?: string;
  path?: string;
  nonce?: string;
  idempotencyKey?: string;
}): { ok: boolean; reason?: string } {
  const payload = input.payload;
  if (!payload || payload.request_digest == null) return { ok: false, reason: 'no_v11_commitment' };
  let salt: Buffer;
  try { salt = Buffer.from(input.saltHex, 'hex'); } catch { return { ok: false, reason: 'bad_salt' }; }
  if (salt.length !== 32) return { ok: false, reason: 'bad_salt' };
  const body = Buffer.isBuffer(input.body) ? input.body : Buffer.from(input.body);
  const bodyCommitment = crypto.createHmac('sha256', salt).update(body).digest('hex');
  const digest = crypto.createHash('sha256').update(jcs({
    body_commitment: bodyCommitment,
    idempotency_key: input.idempotencyKey ?? payload.idempotency_key ?? null,
    method: input.method ?? payload.method ?? null,
    nonce: input.nonce ?? payload.nonce ?? null,
    path: input.path ?? payload.path ?? null,
  })).digest('hex');
  if (digest !== String(payload.request_digest)) return { ok: false, reason: 'commitment_mismatch' };
  return { ok: true };
}
