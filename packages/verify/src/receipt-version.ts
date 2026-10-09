/**
 * Exact-type allowlist for receipt versions.
 *
 * The signed JWS payload is the only version that counts. `Number()` and
 * `parseInt` are not used: strings, booleans, arrays, null, and non-integers
 * are unsupported. JSON `11.0` and `1.1e1` are the number 11 after parse.
 *
 * `hmac_attestation.payload_version` is the HMAC field-list version (5 or 8).
 * It is not a copy of the JWS payload version. chit-1ebc5616 is signed
 * payload_version 6 with HMAC 8. That pair still verifies.
 */

export const LEGACY_PAYLOAD_VERSIONS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10] as const;
export const ISSUER_ROOT_PAYLOAD_VERSION = 11;
export const V11_VERSION = 11;
export const UNVERSIONED_OUTER_VERSIONS = [4, 5] as const;
export const REFUSAL_EXACT_VERSIONS = [1, 2, 3] as const;

export const SUPPORTED_RECEIPT_VERSIONS = {
  v: [V11_VERSION],
  payload_version: [...LEGACY_PAYLOAD_VERSIONS, ISSUER_ROOT_PAYLOAD_VERSION],
  refusal_payload_version: [...REFUSAL_EXACT_VERSIONS],
  legacy_unversioned_outer: [...UNVERSIONED_OUTER_VERSIONS],
} as const;

export const VERIFIER_MIN = '0.3.5';
export const UNSUPPORTED_VERSION = 'unsupported_version';
export const VERSION_MISMATCH = 'version_mismatch';
export const INVALID_JWS = 'invalid_jws';
export const UPGRADE_HINT = 'this receipt requires a verifier newer than @xfuel/verify 0.3.5';

/** Named claims on the Sep 4–5 object JWS (payload v4/v5), without a signed version. */
const UNVERSIONED_TOP = new Set([
  'task_id',
  'iss',
  'iat',
  'payment',
  'provider_cogs',
  'route',
  'output',
  'binding',
  'caller_binding',
]);
const UNVERSIONED_PAYMENT = new Set([
  'rail',
  'ref',
  'gross_amount',
  'net_amount',
  'fee_amount',
  'protocol_fee_bps',
  'platform_fee',
  'platform_fee_bps',
  'fee_bps',
]);
const UNVERSIONED_COGS = new Set(['actual']);
const UNVERSIONED_ROUTE = new Set(['model', 'model_commitment', 'provider']);
const UNVERSIONED_OUTPUT = new Set(['hash']);
const UNVERSIONED_BINDING = new Set(['expected_commitment']);
const UNVERSIONED_CALLER = new Set(['payer_wallet', 'agent_pubkey', 'api_key_hash']);

export type VersionReason = typeof UNSUPPORTED_VERSION | typeof VERSION_MISMATCH | typeof INVALID_JWS;

export type ReceiptVersionDecision =
  | { ok: true; family: 'unsigned' }
  | { ok: true; family: 'v11'; version: 11; version_source: 'signed' }
  | { ok: true; family: 'legacy'; version: number; version_source: 'signed' | 'inferred' }
  | { ok: false; reason: VersionReason; errors: string[] };

function hasOwn(obj: object, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(obj, key);
}

export function isPlainObject(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

/** JSON number that is a whole integer. Rejects strings, booleans, arrays, and floats. */
export function isJsonInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value);
}

function fail(reason: VersionReason, extra: string[] = []): ReceiptVersionDecision {
  const errors = reason === UNSUPPORTED_VERSION
    ? [UNSUPPORTED_VERSION, ...extra, UPGRADE_HINT]
    : [reason, ...extra];
  return { ok: false, reason, errors };
}

function subset(value: unknown, allowed: Set<string>): boolean {
  if (value == null) return true;
  if (!isPlainObject(value)) return false;
  return Object.keys(value).every((key) => allowed.has(key));
}

/** True when every claim key belongs to the v4/v5 object, before v6 fields existed. */
export function claimsAreUnversionedV4V5(claims: Record<string, unknown>): boolean {
  if (!Object.keys(claims).every((key) => UNVERSIONED_TOP.has(key))) return false;
  if (!subset(claims.payment, UNVERSIONED_PAYMENT)) return false;
  if (!subset(claims.provider_cogs, UNVERSIONED_COGS)) return false;
  if (!subset(claims.route, UNVERSIONED_ROUTE)) return false;
  if (isPlainObject(claims.route) && claims.route.model_commitment != null && isPlainObject(claims.route.model_commitment)) {
    if (!subset(claims.route.model_commitment, new Set(['commitment']))) return false;
  }
  if (!subset(claims.output, UNVERSIONED_OUTPUT)) return false;
  if (!subset(claims.binding, UNVERSIONED_BINDING)) return false;
  if (!subset(claims.caller_binding, UNVERSIONED_CALLER)) return false;
  return true;
}

function stamped(container: unknown): { present: boolean; value: unknown } {
  if (!isPlainObject(container) || !hasOwn(container, 'payload_version')) {
    return { present: false, value: undefined };
  }
  if (container.payload_version == null) return { present: false, value: undefined };
  return { present: true, value: container.payload_version };
}

/**
 * Outer payload_version slots that may name a v4/v5 receipt whose JWS
 * itself has no version. They must all be the same integer, 4 or 5.
 */
export function unversionedOuterVersion(receipt: Record<string, unknown>): number | null {
  const slots = [
    stamped(receipt.issuer_signature),
    stamped(receipt.hmac_attestation),
    stamped(receipt.signature),
  ].filter((slot) => slot.present);
  if (slots.length === 0) return null;
  const first = slots[0].value;
  if (!isJsonInteger(first) || (first !== 4 && first !== 5)) return null;
  for (const slot of slots) {
    if (!Object.is(slot.value, first)) return null;
  }
  return first;
}

function outerV(receipt: Record<string, unknown>): { present: boolean; value: unknown } {
  if (!hasOwn(receipt, 'v') || receipt.v == null) return { present: false, value: undefined };
  return { present: true, value: receipt.v };
}

function versionsAgree(signed: unknown, outer: { present: boolean; value: unknown }): boolean {
  if (!outer.present) return true;
  if (typeof signed !== typeof outer.value) return false;
  return Object.is(signed, outer.value);
}

/**
 * Signed `v: 11` agrees with an outer `issuer_signature.payload_version` of
 * the number 11. That is the gateway's non-enumerable v11 stamp. Any other
 * value or type is a mismatch. A missing stamp agrees.
 */
function v11PayloadStampAgrees(outer: { present: boolean; value: unknown }): boolean {
  if (!outer.present) return true;
  return typeof outer.value === 'number' && outer.value === 11;
}

export function readSignedClaims(jws: unknown):
  | { ok: true; claims: Record<string, unknown> }
  | { ok: false; reason: typeof INVALID_JWS | typeof UNSUPPORTED_VERSION } {
  if (typeof jws !== 'string' || jws.length === 0) return { ok: false, reason: INVALID_JWS };
  const parts = jws.split('.');
  if (parts.length < 2 || !parts[1]) return { ok: false, reason: INVALID_JWS };
  let text: string;
  try {
    text = Buffer.from(parts[1], 'base64url').toString('utf8');
  } catch {
    return { ok: false, reason: INVALID_JWS };
  }
  if (!text) return { ok: false, reason: INVALID_JWS };
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return { ok: false, reason: INVALID_JWS };
  }
  if (!isPlainObject(parsed)) return { ok: false, reason: UNSUPPORTED_VERSION };
  return { ok: true, claims: parsed };
}

/**
 * Allowlist on the signed claims. `outer` is the receipt document.
 * Pass null to ignore outer copies (builders, claims-only checks).
 */
export function classifySignedClaims(
  claims: unknown,
  outer: Record<string, unknown> | null,
): ReceiptVersionDecision {
  if (!isPlainObject(claims)) return fail(UNSUPPORTED_VERSION);
  const hasV = hasOwn(claims, 'v');
  const hasPv = hasOwn(claims, 'payload_version');
  const outerDoc = outer && isPlainObject(outer) ? outer : null;
  const outerVersion = outerDoc ? stamped(outerDoc.issuer_signature) : { present: false, value: undefined };
  const topV = outerDoc ? outerV(outerDoc) : { present: false, value: undefined };

  if (hasV && hasPv) {
    const extra = typeof claims.v === 'number' && claims.v === 11 ? ['v11_disallowed_field'] : [];
    return fail(UNSUPPORTED_VERSION, extra);
  }

  if (hasV) {
    if (!(typeof claims.v === 'number' && claims.v === 11)) return fail(UNSUPPORTED_VERSION);
    if (outerDoc && !versionsAgree(11, topV)) return fail(VERSION_MISMATCH);
    if (outerDoc && !v11PayloadStampAgrees(outerVersion)) return fail(VERSION_MISMATCH);
    return { ok: true, family: 'v11', version: 11, version_source: 'signed' };
  }

  if (hasPv) {
    const version = claims.payload_version;
    const issuerRoot = hasOwn(claims, 'issuer_root')
      && claims.issuer_root != null
      && typeof claims.issuer_root === 'object';
    const legacy = isJsonInteger(version) && (LEGACY_PAYLOAD_VERSIONS as readonly number[]).includes(version);
    const root = isJsonInteger(version) && version === ISSUER_ROOT_PAYLOAD_VERSION && issuerRoot;
    if (!legacy && !root) return fail(UNSUPPORTED_VERSION);
    if (outerDoc && !versionsAgree(version, outerVersion)) return fail(VERSION_MISMATCH);
    if (outerDoc && topV.present) return fail(VERSION_MISMATCH);
    return { ok: true, family: 'legacy', version: version as number, version_source: 'signed' };
  }

  if (!claimsAreUnversionedV4V5(claims)) return fail(UNSUPPORTED_VERSION);
  if (!outerDoc) return fail(UNSUPPORTED_VERSION);
  if (topV.present) return fail(VERSION_MISMATCH);
  const inferred = unversionedOuterVersion(outerDoc);
  if (inferred == null) return fail(UNSUPPORTED_VERSION);
  return { ok: true, family: 'legacy', version: inferred, version_source: 'inferred' };
}

/** True when the signed claims are on the allowlist. Outer copies are not checked. */
export function signedClaimsOnAllowlist(claims: unknown): boolean {
  const decision = classifySignedClaims(claims, null);
  return decision.ok === true;
}

export function classifyReceiptDocument(receipt: unknown): ReceiptVersionDecision {
  if (!isPlainObject(receipt)) return fail(UNSUPPORTED_VERSION);
  const signature = receipt.issuer_signature;
  const jws = isPlainObject(signature) ? signature.jws : undefined;
  if (typeof jws !== 'string' || jws.length === 0) {
    return { ok: true, family: 'unsigned' };
  }
  const read = readSignedClaims(jws);
  if (!read.ok) {
    return read.reason === UNSUPPORTED_VERSION ? fail(UNSUPPORTED_VERSION) : fail(INVALID_JWS);
  }
  return classifySignedClaims(read.claims, receipt);
}

/**
 * Public shell with no holder JWS. Exact types. Unknown versions are not
 * INCLUDED_SHELL. null payload_version is not a version.
 */
export function classifyShellDocument(shell: unknown): { ok: true } | { ok: false; reason: VersionReason; errors: string[] } {
  if (!isPlainObject(shell)) return fail(UNSUPPORTED_VERSION);
  const hasV = hasOwn(shell, 'v') && shell.v != null;
  const hasPv = hasOwn(shell, 'payload_version') && shell.payload_version != null;
  if (hasV) {
    if (!(typeof shell.v === 'number' && shell.v === 11)) return fail(UNSUPPORTED_VERSION);
    if (hasPv && !(typeof shell.payload_version === 'number' && shell.payload_version === 11)) {
      return fail(VERSION_MISMATCH);
    }
    return { ok: true };
  }
  if (!hasPv) return fail(UNSUPPORTED_VERSION);
  const version = shell.payload_version;
  if (!isJsonInteger(version)) return fail(UNSUPPORTED_VERSION);
  if ((LEGACY_PAYLOAD_VERSIONS as readonly number[]).includes(version)) return { ok: true };
  const root = version === 11 && shell.issuer_root != null && typeof shell.issuer_root === 'object';
  if (root) return { ok: true };
  return fail(UNSUPPORTED_VERSION);
}

export function formatSupportedReceiptVersions(): string {
  return [
    'Supported receipt versions (signed payload, exact JSON numbers):',
    `  v: ${SUPPORTED_RECEIPT_VERSIONS.v.join(', ')}`,
    `  payload_version: ${LEGACY_PAYLOAD_VERSIONS.join(', ')}, and 11 only with a signed issuer_root`,
    `  refusal payload_version: ${REFUSAL_EXACT_VERSIONS.join(', ')}`,
    '  unversioned JWS: outer version 4 or 5 and no field introduced at v6 or later (version_source: inferred)',
    'Unknown versions fail closed: unsupported_version, exit 1.',
    `Receipts issued after 2026-10-08 require @xfuel/verify >= ${VERIFIER_MIN}.`,
    'Older verifiers may print VERIFIED for formats they do not understand.',
  ].join('\n');
}

/** Legacy refusal versions. Exact integers. v11 refusals use the v: 11 rule. */
export function refusalPayloadVersion(claims: unknown):
  | { ok: true; version: 1 | 2 | 3 }
  | { ok: false; reason: typeof UNSUPPORTED_VERSION } {
  if (!isPlainObject(claims)) return { ok: false, reason: UNSUPPORTED_VERSION };
  if (hasOwn(claims, 'v')) {
    if (typeof claims.v === 'number' && claims.v === 11 && !hasOwn(claims, 'payload_version')) {
      return { ok: false, reason: UNSUPPORTED_VERSION };
    }
    return { ok: false, reason: UNSUPPORTED_VERSION };
  }
  const version = claims.payload_version;
  if (!isJsonInteger(version) || !(REFUSAL_EXACT_VERSIONS as readonly number[]).includes(version)) {
    return { ok: false, reason: UNSUPPORTED_VERSION };
  }
  return { ok: true, version: version as 1 | 2 | 3 };
}
