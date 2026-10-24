/**
 * Issuer ECDSA key management (ES256 / P-256).
 *
 * Receipts carry an issuer_signature (ECDSA) that any agent can verify against
 * the published JWKS without needing a shared secret. This is the public-key
 * signature that complements the HMAC (host-trust) signatures.
 *
 * Key format: ES256 (ECDSA with P-256/secp256r1 and SHA-256)
 *   - Private key: PEM format, base64-encoded in the gateway environment
 *     variable ISSUER_PRIVATE_KEY. Production sets it from the host environment.
 *     The loader reads only process.env. There is no second key loader.
 *   - Public key: JWK format in /.well-known/jwks.json
 *   - Key ID (kid): SHA-256 thumbprint of the JWK (RFC 7638)
 *
 * Verify steps (documented in llms.txt):
 *   1. GET /receipt/:taskId?format=json → receipt with issuer_signature
 *   2. GET /.well-known/jwks.json → { keys: [{ kty, crv, x, y, kid, alg, use }] }
 *   3. Match receipt.issuer_signature.kid to JWKS key
 *   4. Verify: ES256(canonicalSignedPayload(receipt)) == issuer_signature.value
 */
import crypto from 'crypto';
import { peekIssuerSigner, resetIssuerSigner } from './issuer-signer-state.js';
import { lowS } from './ecdsa-der.js';
import { isCanonicalCompactEs256, isCanonicalEs256Signature } from './jws-canonical.js';

export { isCanonicalCompactEs256 };

let _privateKey = null;
let _publicKeyJwk = null;
let _kid = null;

/** Published api.chit402.com issuer kid. Production uses this unless ISSUER_KID names another. */
const PRODUCTION_ISSUER_KID = 'IvFpmC-vPhkY_v0vidsrWVT9uzlE5XWKZgAEOeJTq1Q';

function issuerKeyMaterial() {
  const raw = process.env.ISSUER_PRIVATE_KEY;
  if (raw == null) return null;
  const trimmed = String(raw).trim();
  return trimmed || null;
}

/**
 * Production is every NODE_ENV other than test and development. Unset is production.
 * @param {string|undefined|null} [nodeEnv]
 */
export function isProductionIssuerEnv(nodeEnv = process.env.NODE_ENV) {
  const env = nodeEnv == null ? '' : String(nodeEnv).trim();
  return env !== 'test' && env !== 'development';
}

/**
 * Production never mints a temporary key. An empty env value counts as missing.
 * Unset NODE_ENV is production. ISSUER_ROOT_ENABLED, ISSUER_ROOT_ALLOW_SKIP,
 * and ALLOW_EPHEMERAL_ISSUER_KEY do not override this. The ephemeral opt-in
 * applies only when NODE_ENV is test or development, which already mint a
 * key when ISSUER_PRIVATE_KEY is unset.
 */
function assertProductionIssuerKeyPresent(envKey) {
  if (!isProductionIssuerEnv()) return;
  if (!envKey) {
    const err = new Error('production refuses to boot when ISSUER_PRIVATE_KEY is missing or empty');
    err.code = 'issuer_key_missing';
    throw err;
  }
}

function assertIssuerKeyType(privateKey) {
  const curve = privateKey.asymmetricKeyDetails?.namedCurve;
  if (privateKey.asymmetricKeyType !== 'ec' || curve !== 'prime256v1') {
    const err = new Error('issuer signing key must be ES256 (P-256)');
    err.code = 'issuer_key_type';
    throw err;
  }
}

function assertIssuerKid(kid) {
  const explicit = String(process.env.ISSUER_KID || '').trim();
  // Production always asserts a kid. The ephemeral flag does not skip it.
  const configured = explicit || (isProductionIssuerEnv() ? PRODUCTION_ISSUER_KID : '');
  if (configured && kid !== configured) {
    const err = new Error('issuer kid does not match the configured kid');
    err.code = 'issuer_kid_mismatch';
    throw err;
  }
}

/**
 * Generate an ephemeral P-256 key pair (for testing/dev when no key is configured).
 * In production, set ISSUER_PRIVATE_KEY to a stable key.
 */
function generateKeyPair() {
  const { privateKey, publicKey } = crypto.generateKeyPairSync('ec', {
    namedCurve: 'P-256',
  });
  return { privateKey, publicKey };
}

/**
 * Load the issuer key from environment or generate an ephemeral one.
 * Call once at startup; subsequent calls return cached values.
 */
export function initIssuerKey() {
  const signerSetting = String(process.env.ISSUER_SIGNER || '').trim();
  if (signerSetting && signerSetting !== 'env' && signerSetting !== 'kms') {
    const err = new Error('unknown issuer signer');
    err.code = 'issuer_signer_unknown';
    throw err;
  }
  if (signerSetting === 'kms') {
    const err = new Error('issuer signer requires async signing');
    err.code = 'issuer_signer_async_required';
    throw err;
  }
  if (_privateKey) return { privateKey: _privateKey, publicKeyJwk: _publicKeyJwk, kid: _kid };

  const envKey = issuerKeyMaterial();
  assertProductionIssuerKeyPresent(envKey);
  // v11 refuses an ephemeral key. The flag-off path still generates one for local runs.
  if (String(process.env.ISSUER_ROOT_ENABLED || '').trim() === 'true' && !envKey) {
    throw new Error(
      'ISSUER_ROOT_ENABLED=true refuses to start when ISSUER_PRIVATE_KEY is unset. An ephemeral issuer key cannot sign v11 receipts.',
    );
  }
  let privateKey;
  let publicKey;

  if (envKey) {
    const pem = Buffer.from(envKey, 'base64').toString('utf8');
    privateKey = crypto.createPrivateKey({ key: pem, format: 'pem' });
    assertIssuerKeyType(privateKey);
    publicKey = crypto.createPublicKey(privateKey);
  } else {
    const pair = generateKeyPair();
    privateKey = pair.privateKey;
    publicKey = pair.publicKey;
  }

  const jwk = publicKey.export({ format: 'jwk' });
  const kid = computeJwkThumbprint(jwk);
  assertIssuerKid(kid);

  _privateKey = privateKey;
  _publicKeyJwk = {
    kty: jwk.kty,
    crv: jwk.crv,
    x: jwk.x,
    y: jwk.y,
    kid,
    alg: 'ES256',
    use: 'sig',
  };
  _kid = kid;

  return { privateKey: _privateKey, publicKeyJwk: _publicKeyJwk, kid: _kid };
}

/**
 * RFC 7638 JWK thumbprint (SHA-256, base64url).
 * For EC keys: {"crv","kty","x","y"} in lexicographic order.
 */
export function computeJwkThumbprint(jwk) {
  const canonical = JSON.stringify({
    crv: jwk.crv,
    kty: jwk.kty,
    x: jwk.x,
    y: jwk.y,
  });
  return crypto.createHash('sha256').update(canonical).digest('base64url');
}

function assertSyncSignerAllowed() {
  const peeked = peekIssuerSigner();
  if (String(process.env.ISSUER_SIGNER || '').trim() === 'kms' || peeked?.kind === 'kms') {
    const err = new Error('issuer signer requires async signing');
    err.code = 'issuer_signer_async_required';
    throw err;
  }
}

/**
 * Header and payload bytes shared by the sync and async signers.
 * `typ: null` omits typ. A kid override is for offer-receipt did:web ids.
 * `payloadUtf8`, when set, is the exact payload segment (v11 JCS).
 */
export function jwsSigningInput(payload, {
  jku = null,
  typ = 'chit402-receipt+jwt',
  kid,
  payloadUtf8 = null,
} = {}) {
  const header = { alg: 'ES256' };
  if (typ !== null) header.typ = typ || 'chit402-receipt+jwt';
  header.kid = kid;
  if (jku && typeof jku === 'string' && jku.startsWith('http')) header.jku = jku;
  const payloadPart = payloadUtf8 != null
    ? Buffer.from(String(payloadUtf8), 'utf8').toString('base64url')
    : b64urlJson(payload);
  return `${b64urlJson(header)}.${payloadPart}`;
}

function rawSignRemoved() {
  const err = new Error('raw signing with the issuer key is removed; use signJws or signJwsAsync');
  err.code = 'issuer_raw_sign_removed';
  return err;
}

/**
 * Removed. Raw signing over caller bytes is not offered. Kept as an export
 * that always throws so an old import fails loudly instead of signing.
 * @deprecated Use signJws() or signJwsAsync().
 */
export function signWithIssuerKey(_message) {
  throw rawSignRemoved();
}

/** Removed. Always rejects. See signWithIssuerKey. */
export async function signWithIssuerKeyAsync(_message) {
  throw rawSignRemoved();
}

/**
 * Base64url encode a JSON object.
 * @param {object} obj
 * @returns {string}
 */
function b64urlJson(obj) {
  return Buffer.from(JSON.stringify(obj), 'utf8').toString('base64url');
}

/**
 * Sign an object payload as a compact JWS (ES256).
 * 
 * Creates a standard JWS that can be verified by jose, jsonwebtoken, pyjwt, etc.
 * The payload is a JSON object (not an array), making it self-describing.
 * 
 * Header: { alg: 'ES256', typ: 'chit402-receipt+jwt', kid }
 * Payload: object with named claims
 * 
 * @param {object} payload - Object payload (will be JSON serialized)
 * @param {{ jku?: string|null, typ?: string|null, kid?: string|null, payloadUtf8?: string|null }} [opts]
 *   Optional JWKS URL (jku), JWT typ, and key id override.
 *   `typ: null` omits the typ header (x402 offer-receipt artifacts are not chit402 receipts).
 *   `kid` overrides the thumbprint kid (did:web URL for offer-receipt).
 *   `payloadUtf8`, when set, is the exact payload segment (v11 JCS). The default
 *   path still JSON.stringifies `payload`.
 * @returns {{ jws: string, kid: string }} - Compact JWS and key ID
 */
export function signJws(payload, { jku = null, typ = 'chit402-receipt+jwt', kid: kidOverride = null, payloadUtf8 = null } = {}) {
  assertSyncSignerAllowed();
  const { privateKey, kid: thumbKid } = initIssuerKey();
  const kid = kidOverride || thumbKid;
  const signingInput = jwsSigningInput(payload, { jku, typ, kid, payloadUtf8 });
  let signature = crypto.sign('sha256', Buffer.from(signingInput, 'utf8'), {
    key: privateKey,
    dsaEncoding: 'ieee-p1363',
  });
  if (String(process.env.ISSUER_SIGNER_LOW_S || '').trim() === 'true') signature = lowS(signature);
  const jws = `${signingInput}.${signature.toString('base64url')}`;
  return { jws, kid };
}

/**
 * Async JWS. Header and payload bytes match signJws. Receipt signs pass
 * capKind:'receipt'. The cap update finishes before signer.sign is awaited.
 * @param {object} payload
 * `signal` (optional) aborts an outstanding remote sign; the KMS signer honors it.
 * @param {{ jku?: string|null, typ?: string|null, kid?: string|null, payloadUtf8?: string|null, capKind?: string|null, receiptId?: string|null, parkLate?: boolean, signal?: AbortSignal|null }} [opts]
 */
export async function signJwsAsync(payload, {
  jku = null,
  typ = 'chit402-receipt+jwt',
  kid: kidOverride = null,
  payloadUtf8 = null,
  capKind = null,
  receiptId = null,
  parkLate = true,
  signal = null,
} = {}) {
  if (capKind === 'receipt') {
    const { consumeReceiptSlot } = await import('./issuance-cap.js');
    try {
      consumeReceiptSlot();
    } catch (err) {
      if (err?.code === 'issuance_cap' && parkLate !== false) {
        const { noteIssuanceCapLost } = await import('./issuance-cap.js');
        const { lateIssueEnabled, openLateSubmission } = await import('./late-issue.js');
        const { getActiveChallengeStore } = await import('./x402-durable-store.js');
        await noteIssuanceCapLost(receiptId, {
          park() {
            if (!lateIssueEnabled()) return null;
            const store = getActiveChallengeStore();
            if (!store || typeof store.putLate !== 'function') return null;
            const opened = openLateSubmission(store, {
              facilitatorId: 'gateway',
              submittedAt: Date.now(),
              nonce: `cap:${receiptId || 'receipt'}`,
              network: 'base',
              asset: null,
              payee: null,
              challengeAmount: null,
              routeQuote: null,
              expectedSettledAmount: null,
              authKey: receiptId ? `cap|${receiptId}` : null,
              auth: null,
              issueBlock: null,
              requestDigest: null,
              paymentHash: null,
              saltRef: null,
              principal: 'issuance_cap',
              idempotencyKey: null,
              taskId: receiptId || null,
              route: null,
              challengeIssuedAt: Date.now(),
            });
            return opened.ok ? opened.row : null;
          },
        });
      }
      throw err;
    }
  }
  const { initIssuerSigner } = await import('./issuer-signer.js');
  const signer = peekIssuerSigner() || await initIssuerSigner();
  const kid = kidOverride || signer.kid;
  const signingInput = jwsSigningInput(payload, { jku, typ, kid, payloadUtf8 });
  if (signal?.aborted) {
    const err = new Error('issuer sign aborted');
    err.code = 'issuer_sign_aborted';
    throw err;
  }
  const signature = signal
    ? await signer.sign(Buffer.from(signingInput, 'utf8'), { signal })
    : await signer.sign(Buffer.from(signingInput, 'utf8'));
  if (!Buffer.isBuffer(signature) || signature.length !== 64) {
    const err = new Error('issuer sign invalid');
    err.code = 'issuer_sign_invalid';
    throw err;
  }
  return { jws: `${signingInput}.${signature.toString('base64url')}`, kid };
}

/**
 * Verify a compact JWS against a JWK.
 * Parses the JWS, verifies the ES256 signature, returns the payload.
 * 
 * @param {string} jws - Compact JWS (header.payload.signature)
 * @param {object} jwk - JWK with kty: 'EC', crv: 'P-256', x, y
 * @returns {{ valid: boolean, payload?: object, header?: object, reason?: string }}
 */
export function verifyJws(jws, jwk) {
  if (!jws || typeof jws !== 'string') {
    return { valid: false, reason: 'invalid_jws' };
  }
  if (!jwk || jwk.kty !== 'EC' || jwk.crv !== 'P-256') {
    return { valid: false, reason: 'invalid_jwk' };
  }
  
  const parts = jws.split('.');
  if (parts.length !== 3 || !isCanonicalCompactEs256(jws)) {
    return { valid: false, reason: 'malformed_jws' };
  }
  
  const [headerB64, payloadB64, signatureB64] = parts;
  
  let header, payload;
  try {
    header = JSON.parse(Buffer.from(headerB64, 'base64url').toString('utf8'));
    payload = JSON.parse(Buffer.from(payloadB64, 'base64url').toString('utf8'));
  } catch {
    return { valid: false, reason: 'json_parse_error' };
  }
  
  if (header.alg !== 'ES256') {
    return { valid: false, reason: `unsupported_alg: ${header.alg}` };
  }
  
  if (header.kid && jwk.kid && header.kid !== jwk.kid) {
    return { valid: false, reason: 'kid_mismatch' };
  }
  
  try {
    const publicKey = crypto.createPublicKey({ key: jwk, format: 'jwk' });
    const signature = Buffer.from(signatureB64, 'base64url');
    const signingInput = `${headerB64}.${payloadB64}`;
    const valid = crypto.verify('sha256', Buffer.from(signingInput, 'utf8'), {
      key: publicKey,
      dsaEncoding: 'ieee-p1363',
    }, signature);
    
    if (valid) {
      return { valid: true, payload, header };
    }
    return { valid: false, reason: 'signature_invalid' };
  } catch (err) {
    return { valid: false, reason: `verification_error: ${err.message}` };
  }
}

/**
 * Verify a compact JWS against a JWKS (key set).
 * Finds matching key by kid and verifies.
 * 
 * @param {string} jws - Compact JWS
 * @param {{ keys: object[] }} jwks - JWKS with keys array
 * @returns {{ valid: boolean, payload?: object, header?: object, kid?: string, reason?: string }}
 */
export function verifyJwsWithJwks(jws, jwks) {
  if (!jws || typeof jws !== 'string') {
    return { valid: false, reason: 'invalid_jws' };
  }
  if (!jwks || !Array.isArray(jwks.keys) || jwks.keys.length === 0) {
    return { valid: false, reason: 'empty_jwks' };
  }
  
  const parts = jws.split('.');
  if (parts.length !== 3 || !isCanonicalCompactEs256(jws)) {
    return { valid: false, reason: 'malformed_jws' };
  }
  
  let header;
  try {
    header = JSON.parse(Buffer.from(parts[0], 'base64url').toString('utf8'));
  } catch {
    return { valid: false, reason: 'header_parse_error' };
  }
  
  const candidates = header.kid
    ? jwks.keys.filter(k => k.kid === header.kid && k.alg === 'ES256')
    : jwks.keys.filter(k => k.alg === 'ES256');
  
  if (candidates.length === 0) {
    return { valid: false, reason: 'no_matching_key' };
  }
  
  for (const jwk of candidates) {
    const result = verifyJws(jws, jwk);
    if (result.valid) {
      return { ...result, kid: jwk.kid };
    }
  }
  return { valid: false, reason: 'signature_invalid' };
}

/**
 * Verify a signature against the issuer's public key.
 * @param {string} message - The original message
 * @param {string} signatureB64url - Base64url-encoded signature
 * @returns {boolean}
 */
export function verifyWithIssuerKey(message, signatureB64url) {
  const { publicKeyJwk } = initIssuerKey();
  return verifyWithJwk(message, signatureB64url, publicKeyJwk);
}

/**
 * Verify a signature against any ES256 JWK.
 * @param {string} message - The original message
 * @param {string} signatureB64url - Base64url-encoded signature
 * @param {object} jwk - JWK with kty, crv, x, y
 * @returns {boolean}
 */
export function verifyWithJwk(message, signatureB64url, jwk) {
  if (!jwk || jwk.kty !== 'EC' || jwk.crv !== 'P-256') {
    return false;
  }
  // Same canonical rule as the verifier: base64url, exact round-trip, 64 bytes.
  if (!isCanonicalEs256Signature(signatureB64url)) return false;
  try {
    const publicKey = crypto.createPublicKey({ key: jwk, format: 'jwk' });
    const signature = Buffer.from(signatureB64url, 'base64url');
    return crypto.verify('sha256', Buffer.from(message, 'utf8'), {
      key: publicKey,
      dsaEncoding: 'ieee-p1363',
    }, signature);
  } catch {
    return false;
  }
}

/**
 * Get the JWKS document for /.well-known/jwks.json.
 */
function jwkFromSigner(signer) {
  return {
    kty: signer.publicJwk.kty,
    crv: signer.publicJwk.crv,
    x: signer.publicJwk.x,
    y: signer.publicJwk.y,
    kid: signer.kid,
    alg: 'ES256',
    use: 'sig',
  };
}

function activeIssuerMaterial() {
  const peeked = peekIssuerSigner();
  if (peeked) return { kid: peeked.kid, publicKeyJwk: jwkFromSigner(peeked) };
  if (String(process.env.ISSUER_SIGNER || '').trim() === 'kms') {
    const err = new Error('issuer signer is not initialised');
    err.code = 'issuer_signer_uninitialized';
    throw err;
  }
  const loaded = initIssuerKey();
  return { kid: loaded.kid, publicKeyJwk: loaded.publicKeyJwk };
}

export function getJwks() {
  const { publicKeyJwk } = activeIssuerMaterial();
  return { keys: [publicKeyJwk] };
}

/**
 * Get the issuer's public key JWK (for embedding in receipts if needed).
 */
export function getIssuerPublicKeyJwk() {
  return activeIssuerMaterial().publicKeyJwk;
}

/**
 * Get the issuer's key ID (kid).
 */
export function getIssuerKid() {
  return activeIssuerMaterial().kid;
}

/**
 * Reset the cached key (for testing only).
 */
export function _resetIssuerKey() {
  _privateKey = null;
  _publicKeyJwk = null;
  _kid = null;
  resetIssuerSigner();
}

export default {
  initIssuerKey,
  signWithIssuerKey,
  signWithIssuerKeyAsync,
  signJws,
  signJwsAsync,
  verifyWithIssuerKey,
  verifyWithJwk,
  verifyJws,
  verifyJwsWithJwks,
  getJwks,
  getIssuerPublicKeyJwk,
  getIssuerKid,
  _resetIssuerKey,
};
