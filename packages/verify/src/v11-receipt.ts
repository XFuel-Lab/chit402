/**
 * v11 receipt checks.
 *
 * Stranger mode: signature, strict field set, 64-hex commitments, payment
 * binding. Holder mode adds `--salt` and `--open`. A malformed salt is
 * rejected and never lowercased or stripped.
 *
 * amount_gross is the quoted price. amount_settled is settled_amount: the
 * amount transferred by the bound payment (>= the quoted price). Issuance
 * binds settled_amount to the payer's signed authorization value, not the
 * server quote.
 *
 * verifyReceiptUpToV10 refuses v >= 11 before that path runs.
 */
import { createHash, createHmac, hkdfSync } from 'node:crypto';
import { readFileSync } from 'node:fs';
import type { ReceiptVerification, VerifyReceiptOptions, XFuelReceipt } from './index.js';
import { decodeJwsPayload } from './payer.js';

export const V11_SIGNED_FIELDS = [
  'v',
  'receipt_id',
  'iss',
  'kid',
  'issued_at',
  'asset',
  'chain',
  'pay_to',
  'amount_gross',
  'amount_settled',
  'payment_tx',
  'payer',
  'book_ref',
  'seq',
  'request_digest',
  'output_commitment',
  'accounting_commitment',
  'routing_commitment',
  'product',
  'proof_tier',
  'covers',
] as const;

export const V11_REFUSAL_FIELDS = [
  'v',
  'refusal_id',
  'iss',
  'kid',
  'issued_at',
  'reason',
  'request_digest',
  'refusal_commitment',
] as const;

const DISALLOWED = new Set([
  'internal_breakdown',
  'provider',
  'model',
  'cap',
  'spent',
  'prompt_tokens',
  'completion_tokens',
  'total_tokens',
  'output_hash',
  'claim_id',
  'book_id',
  'agent_id',
]);

const HEX64 = /^[0-9a-f]{64}$/;

export function hkdfSubkey(saltHex: string, label: string): Buffer {
  return Buffer.from(hkdfSync('sha256', Buffer.from(saltHex, 'hex'), Buffer.alloc(0), Buffer.from(label, 'utf8'), 32));
}

export function commitHmac(subkey: Buffer, message: Buffer | string): string {
  const bytes = Buffer.isBuffer(message) ? message : Buffer.from(message, 'utf8');
  return createHmac('sha256', subkey).update(bytes).digest('hex');
}

/**
 * Distinct rejection reasons. The salt is not lowercased, trimmed, or stripped.
 * @returns null when the salt is 64 lowercase hex chars.
 */
export function v11SaltRejection(salt: string): string | null {
  if (typeof salt !== 'string') return 'salt_length';
  if (salt.startsWith('0x') || salt.startsWith('0X')) return 'salt_prefix';
  if (/[A-F]/.test(salt)) return 'salt_uppercase';
  if (!/^[0-9a-f]{64}$/.test(salt)) return 'salt_length';
  return null;
}

function walkDisallowed(value: unknown, errors: string[]): void {
  if (Array.isArray(value)) {
    for (const item of value) walkDisallowed(item, errors);
    return;
  }
  if (!value || typeof value !== 'object') {
    if (typeof value === 'string' && value.includes('ISSUER_PRIVATE_KEY')) errors.push('v11_disallowed_field');
    return;
  }
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    if (DISALLOWED.has(key) || key === 'salt' || key === 'request_preimage') errors.push('v11_disallowed_field');
    else walkDisallowed(child, errors);
  }
}

function shell(
  receipt: XFuelReceipt,
  errors: string[],
  issuer: ReceiptVerification['issuer_signature'],
  lane: ReceiptVerification['receipt_lane'],
): ReceiptVerification {
  const failed = errors.length > 0 || issuer.valid !== true;
  const payload = issuer.payload || {};
  return {
    receipt_id: String((receipt as { receipt_id?: string }).receipt_id || payload.receipt_id || receipt.task_id || ''),
    binding: {
      verified: issuer.valid === true && !errors.some((e) => e.startsWith('v11_')),
      expected: typeof payload.payment_tx === 'string' ? payload.payment_tx : null,
      recomputed: null,
      matches: issuer.valid === true,
      covers: ['payment'],
      reason: errors[0],
    },
    issuer_signature: issuer,
    payer: {
      checked: false,
      valid: false,
      payer_wallet: typeof payload.payer === 'string' ? payload.payer : null,
      payee: typeof payload.pay_to === 'string' ? payload.pay_to : null,
      asset: typeof payload.asset === 'string' ? payload.asset : null,
      amount: typeof payload.amount_gross === 'string' ? payload.amount_gross : null,
      reason: 'not_checked',
    },
    nullifier: { verified: false, nullifier: null, anchored: null, reason: 'tier1' },
    output_hash: null,
    hub: null,
    model: null,
    amount_usdc: issuer.valid && typeof payload.amount_gross === 'string' ? payload.amount_gross : null,
    tx: issuer.valid && typeof payload.payment_tx === 'string' ? payload.payment_tx : null,
    claim_mismatches: [],
    unsigned_fields: [],
    verified_scope: 'signed_claims',
    claim_id: 'not_present_legacy',
    head_binding: null,
    receipt_lane: lane,
    preimages: { checked: false, ok: true, errors: [], fields: [] },
    issuer_history: {
      checked: false,
      ok: true,
      unreachable: false,
      warning: null,
      reason: null,
      kid: issuer.kid ?? null,
      document: null,
      loaded: false,
    },
    warnings: [],
    overall: failed ? 'failed' : 'verified',
    errors,
  };
}

function payloadOf(receipt: XFuelReceipt): Record<string, unknown> | null {
  if (!receipt?.issuer_signature?.jws) return null;
  return decodeJwsPayload(receipt.issuer_signature.jws);
}

export async function verifyV11Receipt(
  receipt: XFuelReceipt,
  options: VerifyReceiptOptions = {},
): Promise<ReceiptVerification> {
  const errors: string[] = [];
  const { verifyIssuerSignatureWithJwks: verifySig, loadIssuerJwks, receiptLaneFromVerification } = await import('./index.js');
  const loaded = await loadIssuerJwks(receipt, {
    jwks: options.jwks,
    jwksUri: options.jwksUri,
    fetchJwks: options.fetchJwks,
    trustedJwksHosts: options.trustedJwksHosts,
    fetchImpl: options.fetchImpl,
  });
  errors.push(...loaded.errors);
  const issuer = verifySig(receipt, loaded.jwks, { trustedKids: options.trustedKids });
  if (!issuer.valid) errors.push(issuer.reason || 'signature_invalid');
  const payload = (issuer.payload || payloadOf(receipt) || {}) as Record<string, unknown>;
  const refusal = payload.reason === 'cap_exceeded' && payload.refusal_id != null;
  const fields = refusal ? V11_REFUSAL_FIELDS : V11_SIGNED_FIELDS;
  const keys = Object.keys(payload);
  if (keys.some((key) => !fields.includes(key as never))) errors.push('v11_disallowed_field');
  for (const key of fields) {
    if (!Object.prototype.hasOwnProperty.call(payload, key)) errors.push('v11_disallowed_field');
  }
  walkDisallowed(receipt, errors);
  if (!refusal) {
    for (const key of ['output_commitment', 'accounting_commitment', 'routing_commitment', 'request_digest']) {
      if (typeof payload[key] !== 'string' || !HEX64.test(payload[key] as string)) errors.push('commitment_malformed');
    }
    if (typeof payload.book_ref !== 'string' || !/^[0-9a-f]{32}$/.test(payload.book_ref)) errors.push('commitment_malformed');
    if (typeof payload.payer !== 'string' || !payload.payer) errors.push('payment_unbound');
    if (typeof payload.pay_to !== 'string' || !payload.pay_to) errors.push('payment_unbound');
    if (typeof payload.amount_gross !== 'string' || !payload.amount_gross) errors.push('payment_unbound');
    if (typeof payload.payment_tx !== 'string' || !payload.payment_tx) errors.push('payment_unbound');
  } else {
    for (const key of ['request_digest', 'refusal_commitment']) {
      if (typeof payload[key] !== 'string' || !HEX64.test(payload[key] as string)) errors.push('commitment_malformed');
    }
    if (payload.reason !== 'cap_exceeded') errors.push('v11_disallowed_field');
  }
  if (typeof payload.issued_at !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}Z$/.test(payload.issued_at)) {
    errors.push('issued_at_precision');
  }
  if (options.salt != null && options.salt !== '') {
    const saltReason = v11SaltRejection(options.salt);
    if (saltReason) errors.push(saltReason);
    else if (options.open) openHolder(options.salt, payload, options.open, errors);
  }
  const unique = [...new Set(errors)];
  const lane = receiptLaneFromVerification({
    receipt: receipt as never,
    claims: null,
    issuerValid: issuer.valid === true,
    payer: { checked: false, valid: false },
    head: null,
  });
  const signed = issuer.valid ? issuer : { ...issuer, payload: (issuer.payload || payload) as ReceiptVerification['issuer_signature']['payload'] };
  return shell(receipt, unique, signed, lane);
}

function openHolder(
  salt: string,
  payload: Record<string, unknown>,
  open: NonNullable<VerifyReceiptOptions['open']>,
  errors: string[],
): void {
  const check = (label: string, message: Buffer | string, field: string) => {
    const got = commitHmac(hkdfSubkey(salt, label), message);
    if (got !== payload[field]) errors.push('commitment_mismatch');
  };
  if (open.output != null) check('v11/output', open.output, 'output_commitment');
  if (open.accounting != null) check('v11/accounting', canonicalJson(open.accounting), 'accounting_commitment');
  if (open.routing != null) check('v11/routing', canonicalJson(open.routing), 'routing_commitment');
  if (open.refusal != null) check('v11/refusal', canonicalJson(open.refusal), 'refusal_commitment');
}

/** RFC 8785 for the small opening objects the holder supplies. */
function canonicalJson(text: string): string {
  const value = JSON.parse(text) as unknown;
  return jcs(value);
}

function jcs(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map((item) => jcs(item)).join(',')}]`;
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj).sort();
  return `{${keys.map((key) => `${JSON.stringify(key)}:${jcs(obj[key])}`).join(',')}}`;
}

export async function verifyReceiptUpToV10(
  receipt: XFuelReceipt,
  options: VerifyReceiptOptions,
  full: (receipt: XFuelReceipt, options: VerifyReceiptOptions) => Promise<ReceiptVerification>,
): Promise<ReceiptVerification> {
  const decoded = receipt?.issuer_signature?.jws ? decodeJwsPayload(receipt.issuer_signature.jws) : null;
  const version = Number(decoded?.v ?? decoded?.payload_version);
  if (Number.isFinite(version) && version >= 11) {
    const { receiptLaneFromVerification } = await import('./index.js');
    const lane = receiptLaneFromVerification({
      receipt: receipt as never,
      claims: null,
      issuerValid: false,
      payer: { checked: false, valid: false },
      head: null,
    });
    return shell(receipt, ['unsupported_version'], {
      checked: true,
      valid: false,
      key_trusted: false,
      reason: 'unsupported_version',
    }, lane);
  }
  return full(receipt, options);
}

export function readOpenFile(spec: string): { kind: 'output' | 'accounting' | 'routing' | 'refusal'; bytes: Buffer; text: string } {
  const eq = spec.indexOf('=');
  if (eq < 1) throw new Error('--open expects output=<file>, accounting=<file>, routing=<file>, or refusal=<file>');
  const kind = spec.slice(0, eq);
  if (kind !== 'output' && kind !== 'accounting' && kind !== 'routing' && kind !== 'refusal') {
    throw new Error('--open expects output=<file>, accounting=<file>, routing=<file>, or refusal=<file>');
  }
  const file = spec.slice(eq + 1);
  const bytes = readFileSync(file);
  return { kind, bytes, text: bytes.toString('utf8') };
}

export function sha256Hex(bytes: Buffer | string): string {
  return createHash('sha256').update(bytes).digest('hex');
}
