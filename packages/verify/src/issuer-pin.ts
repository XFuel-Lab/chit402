/**
 * Content-addressed issuer public key for a pinned era.
 *
 * The pin is a file at one git commit plus the SHA-256 of that file.
 * This module does not fetch. A caller who fetches must use
 * {@link issuerPinContentUrl}, which returns a URL only for a 40-hex
 * commit and the fixed path. A branch name, HEAD, or main is
 * ISSUER_PIN_MUTABLE_REF and no request is made.
 *
 * Sepolia only (`eip155:84532`). The registration self-signature is not a
 * receipt. Rotation is a chit402.freeze.v1 control event signed by the
 * previous pin key (`purpose: citizen_issuer_key`), not an edited file.
 */
import { createHash, createPublicKey, verify, type KeyObject } from 'node:crypto';
import { isEs256PublicJwk, jwkThumbprint, verifyIssuerJws, type Es256Jwk } from './jws.js';

export const ISSUER_REGISTRATION_CONTEXT = 'chit402-issuer-registration-v1';
export const ISSUER_ROTATION_CONTEXT = 'chit402-issuer-rotation-v1';
export const ISSUER_PIN_VERSION = 1;
export const ISSUER_PIN_SCHEMA = 'chit402.issuer_key_pin.v1';
export const ISSUER_PIN_PATH = 'docs/well-known/issuer-key.json';
export const ISSUER_PIN_CHAIN_ID = 'eip155:84532';
export const CITIZEN_FREEZE_SCHEMA = 'chit402.freeze.v1';
export const CITIZEN_FREEZE_PURPOSE = 'citizen_issuer_key';
export const ISSUER_PIN_REPO = 'XFuel-Lab/chit402';

/**
 * Kid of the Sepolia specimen in docs/well-known/issuer-key.json.
 * A different kid is a rotation and needs the previous pin.
 */
export const PUBLISHED_ISSUER_PIN_KID = 'kATmVjz6J8QvSTS-bS1NUjWaLs35o-PXYurO2blMf-c';

export const ISSUER_PIN_MISMATCH = 'ISSUER_PIN_MISMATCH';
export const ISSUER_PIN_HASH_MISMATCH = 'ISSUER_PIN_HASH_MISMATCH';
export const ISSUER_SELF_SIG_INVALID = 'ISSUER_SELF_SIG_INVALID';
export const ISSUER_PIN_DOWNGRADE = 'ISSUER_PIN_DOWNGRADE';
export const ISSUER_PIN_MUTABLE_REF = 'ISSUER_PIN_MUTABLE_REF';
export const ISSUER_ROTATION_UNCONTROLLED = 'ISSUER_ROTATION_UNCONTROLLED';
export const ISSUER_PIN_CHAIN_REFUSED = 'ISSUER_PIN_CHAIN_REFUSED';

export interface IssuerPinRef {
  commit: string;
  path: string;
  sha256: string;
}

export interface IssuerPinAssessment {
  checked: boolean;
  ok: boolean;
  code: string | null;
}

export interface IssuerKeyPin {
  schema: typeof ISSUER_PIN_SCHEMA;
  version: number;
  chain_id: string;
  created_at: string;
  jwk: Es256Jwk;
  self_signature: string | null;
  control: { jws: string } | null;
}

const COMMIT_SHA = /^[0-9a-f]{40}$/;
const FILE_SHA = /^[0-9a-f]{64}$/;
const CREATED_AT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/;

export function issuerPinFileHash(bytes: string): string {
  return createHash('sha256').update(Buffer.from(bytes, 'utf8')).digest('hex');
}

export function canonicalPublicKey(jwk: Pick<Es256Jwk, 'crv' | 'kty' | 'x' | 'y'>): string {
  return JSON.stringify({ crv: jwk.crv, kty: jwk.kty, x: jwk.x, y: jwk.y });
}

/**
 * Registration preimage. The context, version, kid, created_at, and key
 * are fixed fields, so a signature over another purpose or another key
 * does not verify.
 */
export function registrationPreimage(input: { kid: string; createdAt: string; jwk: Es256Jwk }): string {
  return [
    ISSUER_REGISTRATION_CONTEXT,
    String(ISSUER_PIN_VERSION),
    input.kid,
    input.createdAt,
    canonicalPublicKey(input.jwk),
  ].join('\n');
}

export function rotationStatement(input: {
  priorKid: string;
  nextKid: string;
  pinSha256: string;
  pinCommit: string;
  createdAt: string;
}): string {
  return [
    ISSUER_ROTATION_CONTEXT,
    String(ISSUER_PIN_VERSION),
    input.priorKid,
    input.nextKid,
    input.pinSha256,
    input.pinCommit,
    input.createdAt,
    ISSUER_PIN_CHAIN_ID,
  ].join('\n');
}

export function serializeIssuerPin(doc: IssuerKeyPin): string {
  const body = {
    schema: ISSUER_PIN_SCHEMA,
    version: ISSUER_PIN_VERSION,
    chain_id: doc.chain_id,
    created_at: doc.created_at,
    jwk: {
      kty: doc.jwk.kty,
      crv: doc.jwk.crv,
      x: doc.jwk.x,
      y: doc.jwk.y,
      kid: doc.jwk.kid,
      alg: 'ES256',
      use: 'sig',
    },
    self_signature: doc.self_signature,
    control: doc.control,
  };
  return `${JSON.stringify(body, null, 2)}\n`;
}

/**
 * URL of the pin blob at one commit. A branch, HEAD, or any non-40-hex
 * ref returns ISSUER_PIN_MUTABLE_REF and does not build a URL.
 */
export function issuerPinContentUrl(
  commit: string,
  path = ISSUER_PIN_PATH,
): { ok: true; url: string } | { ok: false; code: typeof ISSUER_PIN_MUTABLE_REF } {
  if (!COMMIT_SHA.test(commit) || path !== ISSUER_PIN_PATH) {
    return { ok: false, code: ISSUER_PIN_MUTABLE_REF };
  }
  return {
    ok: true,
    url: `https://raw.githubusercontent.com/${ISSUER_PIN_REPO}/${commit}/${path}`,
  };
}

export async function loadIssuerPinBytes(
  ref: IssuerPinRef,
  fetchImpl: (url: string) => Promise<Uint8Array>,
): Promise<{ ok: true; bytes: string } | { ok: false; code: string }> {
  const url = issuerPinContentUrl(ref.commit, ref.path);
  if (!url.ok) return { ok: false, code: url.code };
  const buf = await fetchImpl(url.url);
  const bytes = Buffer.from(buf).toString('utf8');
  const expect = ref.sha256.toLowerCase();
  if (!FILE_SHA.test(expect) || issuerPinFileHash(bytes) !== expect) {
    return { ok: false, code: ISSUER_PIN_HASH_MISMATCH };
  }
  return { ok: true, bytes };
}

function singleLine(value: string): boolean {
  return value.length > 0 && !/[\r\n]/.test(value);
}

function publicKeyOf(jwk: Es256Jwk): KeyObject {
  return createPublicKey({
    key: { kty: jwk.kty, crv: jwk.crv, x: jwk.x, y: jwk.y },
    format: 'jwk',
  });
}

function asJwk(value: unknown): Es256Jwk {
  return value as unknown as Es256Jwk;
}

function readRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

export function readIssuerPinClaim(doc: unknown): { claimed: boolean; ref: IssuerPinRef | null } {
  const root = readRecord(doc);
  const pin = readRecord(root?.issuer_key_pin);
  if (!pin) return { claimed: false, ref: null };
  const commit = typeof pin.commit === 'string' ? pin.commit : '';
  const path = typeof pin.path === 'string' ? pin.path : '';
  const sha256 = typeof pin.sha256 === 'string' ? pin.sha256 : '';
  const ref = (commit || path || sha256)
    ? { commit, path: path || ISSUER_PIN_PATH, sha256: sha256.toLowerCase() }
    : null;
  return { claimed: true, ref };
}

function parsePinDocument(bytes: string): { ok: true; pin: IssuerKeyPin } | { ok: false; code: string } {
  let raw: unknown;
  try {
    raw = JSON.parse(bytes);
  } catch {
    return { ok: false, code: ISSUER_PIN_MISMATCH };
  }
  const doc = readRecord(raw);
  if (!doc) return { ok: false, code: ISSUER_PIN_MISMATCH };
  if (doc.schema !== ISSUER_PIN_SCHEMA || doc.version !== ISSUER_PIN_VERSION) {
    return { ok: false, code: ISSUER_PIN_MISMATCH };
  }
  if (doc.chain_id !== ISSUER_PIN_CHAIN_ID) {
    return { ok: false, code: ISSUER_PIN_CHAIN_REFUSED };
  }
  if (typeof doc.created_at !== 'string' || !CREATED_AT.test(doc.created_at)) {
    return { ok: false, code: ISSUER_PIN_MISMATCH };
  }
  const jwk = readRecord(doc.jwk);
  if (!jwk || !isEs256PublicJwk(asJwk(jwk))) return { ok: false, code: ISSUER_PIN_MISMATCH };
  if ('d' in jwk) return { ok: false, code: ISSUER_PIN_MISMATCH };
  const key = asJwk(jwk);
  const kid = jwkThumbprint(key);
  if (!key.kid || key.kid !== kid || !singleLine(kid)) return { ok: false, code: ISSUER_PIN_MISMATCH };
  const signature = doc.self_signature == null ? null : doc.self_signature;
  if (signature != null && typeof signature !== 'string') return { ok: false, code: ISSUER_SELF_SIG_INVALID };
  let control: { jws: string } | null = null;
  if (doc.control != null) {
    const row = readRecord(doc.control);
    if (!row || typeof row.jws !== 'string' || !row.jws) {
      return { ok: false, code: ISSUER_ROTATION_UNCONTROLLED };
    }
    control = { jws: row.jws };
  }
  return {
    ok: true,
    pin: {
      schema: ISSUER_PIN_SCHEMA,
      version: ISSUER_PIN_VERSION,
      chain_id: ISSUER_PIN_CHAIN_ID,
      created_at: doc.created_at,
      jwk: { kty: 'EC', crv: 'P-256', x: key.x, y: key.y, kid, alg: 'ES256', use: 'sig' },
      self_signature: signature,
      control,
    },
  };
}

export function verifyRegistrationSignature(pin: IssuerKeyPin): { ok: boolean; code: string | null } {
  if (pin.self_signature == null || pin.self_signature === '') {
    return { ok: true, code: null };
  }
  const kid = pin.jwk.kid || jwkThumbprint(pin.jwk);
  const message = registrationPreimage({ kid, createdAt: pin.created_at, jwk: pin.jwk });
  try {
    const valid = verify(
      'sha256',
      Buffer.from(message, 'utf8'),
      { key: publicKeyOf(pin.jwk), dsaEncoding: 'ieee-p1363' },
      Buffer.from(pin.self_signature, 'base64url'),
    );
    return valid ? { ok: true, code: null } : { ok: false, code: ISSUER_SELF_SIG_INVALID };
  } catch {
    return { ok: false, code: ISSUER_SELF_SIG_INVALID };
  }
}

function witnessKids(source: unknown): string[] {
  const root = readRecord(source);
  if (!root) return [];
  const out: string[] = [];
  if (typeof root.kid === 'string') out.push(root.kid);
  if (typeof root.issuer_kid === 'string') out.push(root.issuer_kid);
  const lists = [root.witnesses, root.keys];
  for (const list of lists) {
    if (!Array.isArray(list)) continue;
    for (const item of list) {
      const row = readRecord(item);
      if (!row) continue;
      if (typeof row.kid === 'string') out.push(row.kid);
      const jwk = readRecord(row.jwk) || row;
      if (isEs256PublicJwk(asJwk(jwk))) out.push(jwkThumbprint(asJwk(jwk)));
    }
  }
  return out;
}

function receiptKids(receipt: unknown): { kids: string[]; issuerRoot: string | null } {
  const root = readRecord(receipt);
  const kids: string[] = [];
  const sig = readRecord(root?.issuer_signature);
  if (typeof sig?.kid === 'string') kids.push(sig.kid);
  const embedded = readRecord(sig?.issuer_jwk);
  if (embedded && isEs256PublicJwk(asJwk(embedded))) {
    kids.push(jwkThumbprint(asJwk(embedded)));
    if (typeof embedded.kid === 'string') kids.push(embedded.kid);
  }
  const issuerRoot = readRecord(root?.issuer_root);
  const rootKid = typeof issuerRoot?.kid === 'string' ? issuerRoot.kid : null;
  return { kids, issuerRoot: rootKid };
}

export function verifyCitizenRotation(input: {
  prior: IssuerKeyPin;
  next: IssuerKeyPin;
  nextHash: string;
  nextCommit: string;
  controlJws: string | null;
}): { ok: true } | { ok: false; code: string } {
  if (input.prior.jwk.kid === input.next.jwk.kid) return { ok: true };
  if (!input.controlJws) return { ok: false, code: ISSUER_ROTATION_UNCONTROLLED };
  if (!COMMIT_SHA.test(input.nextCommit) || !FILE_SHA.test(input.nextHash)) {
    return { ok: false, code: ISSUER_PIN_MUTABLE_REF };
  }
  const verified = verifyIssuerJws(input.controlJws, input.prior.jwk);
  if (!verified.valid || !verified.payload) return { ok: false, code: ISSUER_ROTATION_UNCONTROLLED };
  const payload = verified.payload;
  if (payload.chain_id != null && payload.chain_id !== ISSUER_PIN_CHAIN_ID) {
    return { ok: false, code: ISSUER_PIN_CHAIN_REFUSED };
  }
  const priorKid = input.prior.jwk.kid || '';
  const nextKid = input.next.jwk.kid || '';
  const statement = rotationStatement({
    priorKid,
    nextKid,
    pinSha256: input.nextHash,
    pinCommit: input.nextCommit,
    createdAt: input.next.created_at,
  });
  if (payload.schema !== CITIZEN_FREEZE_SCHEMA) return { ok: false, code: ISSUER_ROTATION_UNCONTROLLED };
  if (payload.purpose !== CITIZEN_FREEZE_PURPOSE) return { ok: false, code: ISSUER_ROTATION_UNCONTROLLED };
  if (payload.chain_id !== ISSUER_PIN_CHAIN_ID) return { ok: false, code: ISSUER_PIN_CHAIN_REFUSED };
  if (payload.prior_kid !== priorKid || payload.next_kid !== nextKid) {
    return { ok: false, code: ISSUER_ROTATION_UNCONTROLLED };
  }
  if (payload.pin_sha256 !== input.nextHash || payload.pin_commit !== input.nextCommit) {
    return { ok: false, code: ISSUER_ROTATION_UNCONTROLLED };
  }
  if (payload.statement !== statement) return { ok: false, code: ISSUER_ROTATION_UNCONTROLLED };
  return { ok: true };
}

export interface AssessIssuerPinInput {
  receipt?: unknown;
  head?: unknown;
  pinBytes?: string | null;
  sigBytes?: string | null;
  ref?: IssuerPinRef | null;
  witnesses?: unknown;
  priorPinBytes?: string | null;
  priorRef?: IssuerPinRef | null;
  controlJws?: string | null;
  required?: boolean;
  /**
   * When set, a kid other than {@link PUBLISHED_ISSUER_PIN_KID} is a
   * rotation. It fails closed unless the previous pin is supplied.
   */
  anchorToPublished?: boolean;
}

function refOk(ref: IssuerPinRef | null | undefined): { ok: true; ref: IssuerPinRef } | { ok: false; code: string } {
  if (!ref) return { ok: false, code: ISSUER_PIN_DOWNGRADE };
  if (!COMMIT_SHA.test(ref.commit) || ref.path !== ISSUER_PIN_PATH) {
    return { ok: false, code: ISSUER_PIN_MUTABLE_REF };
  }
  if (!FILE_SHA.test(ref.sha256.toLowerCase())) return { ok: false, code: ISSUER_PIN_HASH_MISMATCH };
  return { ok: true, ref: { commit: ref.commit, path: ref.path, sha256: ref.sha256.toLowerCase() } };
}

/**
 * Compare a receipt's issuer key to the pinned file, and to issuer_root
 * and a /api/witnesses document when those sources are present.
 * A receipt or head that claims a pinned era and omits the pin fails closed.
 * No claim and no explicit pin leaves the caller on the previous path.
 */
export function assessIssuerPin(input: AssessIssuerPinInput): IssuerPinAssessment {
  const receiptClaim = readIssuerPinClaim(input.receipt);
  const headClaim = readIssuerPinClaim(input.head);
  const claimed = receiptClaim.claimed || headClaim.claimed;
  const required = input.required === true || claimed;
  if (!required && (input.pinBytes == null || input.pinBytes === '')) {
    return { checked: false, ok: true, code: null };
  }
  if (input.pinBytes == null || input.pinBytes === '') {
    return { checked: true, ok: false, code: ISSUER_PIN_DOWNGRADE };
  }
  const ref = input.ref || receiptClaim.ref || headClaim.ref;
  const checkedRef = refOk(ref);
  if (!checkedRef.ok) return { checked: true, ok: false, code: checkedRef.code };
  if (issuerPinFileHash(input.pinBytes) !== checkedRef.ref.sha256) {
    return { checked: true, ok: false, code: ISSUER_PIN_HASH_MISMATCH };
  }
  const parsed = parsePinDocument(input.pinBytes);
  if (!parsed.ok) return { checked: true, ok: false, code: parsed.code };
  const pin = parsed.pin;
  if (input.sigBytes != null && input.sigBytes.trim() !== '') {
    if (pin.self_signature == null || input.sigBytes.trim() !== pin.self_signature) {
      return { checked: true, ok: false, code: ISSUER_SELF_SIG_INVALID };
    }
  }
  const signature = verifyRegistrationSignature(pin);
  if (!signature.ok) return { checked: true, ok: false, code: signature.code };

  if (input.priorPinBytes != null && input.priorPinBytes !== '') {
    if (input.priorRef) {
      const priorRef = refOk(input.priorRef);
      if (!priorRef.ok) return { checked: true, ok: false, code: priorRef.code };
      if (issuerPinFileHash(input.priorPinBytes) !== priorRef.ref.sha256) {
        return { checked: true, ok: false, code: ISSUER_PIN_HASH_MISMATCH };
      }
    }
    const prior = parsePinDocument(input.priorPinBytes);
    if (!prior.ok) return { checked: true, ok: false, code: prior.code };
    const control = input.controlJws || pin.control?.jws || null;
    const rotation = verifyCitizenRotation({
      prior: prior.pin,
      next: pin,
      nextHash: checkedRef.ref.sha256,
      nextCommit: checkedRef.ref.commit,
      controlJws: control,
    });
    if (!rotation.ok) return { checked: true, ok: false, code: rotation.code };
  } else if (pin.control) {
    return { checked: true, ok: false, code: ISSUER_ROTATION_UNCONTROLLED };
  }

  const pinKid = pin.jwk.kid || jwkThumbprint(pin.jwk);
  if (
    input.anchorToPublished
    && (input.priorPinBytes == null || input.priorPinBytes === '')
    && pinKid !== PUBLISHED_ISSUER_PIN_KID
  ) {
    return { checked: true, ok: false, code: ISSUER_ROTATION_UNCONTROLLED };
  }
  const fromReceipt = receiptKids(input.receipt);
  const fromHead = receiptKids(input.head);
  const compared = [...fromReceipt.kids, ...fromHead.kids];
  if (fromReceipt.issuerRoot) compared.push(fromReceipt.issuerRoot);
  if (fromHead.issuerRoot) compared.push(fromHead.issuerRoot);
  if (input.witnesses !== undefined) compared.push(...witnessKids(input.witnesses));
  if (required && compared.length === 0) {
    return { checked: true, ok: false, code: ISSUER_PIN_MISMATCH };
  }
  for (const kid of compared) {
    if (kid !== pinKid) return { checked: true, ok: false, code: ISSUER_PIN_MISMATCH };
  }
  return { checked: true, ok: true, code: null };
}
