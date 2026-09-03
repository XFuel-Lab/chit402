/**
 * Issuer ECDSA key management (ES256 / P-256).
 *
 * Receipts carry an issuer_signature (ECDSA) that any agent can verify against
 * the published JWKS without needing a shared secret. This is the public-key
 * signature that complements the HMAC (host-trust) signatures.
 *
 * Key format: ES256 (ECDSA with P-256/secp256r1 and SHA-256)
 *   - Private key: PEM format, base64-encoded in ISSUER_PRIVATE_KEY env var
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

let _privateKey = null;
let _publicKeyJwk = null;
let _kid = null;

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
  if (_privateKey) return { privateKey: _privateKey, publicKeyJwk: _publicKeyJwk, kid: _kid };

  const envKey = process.env.ISSUER_PRIVATE_KEY || null;
  let privateKey;
  let publicKey;

  if (envKey) {
    const pem = Buffer.from(envKey, 'base64').toString('utf8');
    privateKey = crypto.createPrivateKey({ key: pem, format: 'pem' });
    publicKey = crypto.createPublicKey(privateKey);
  } else {
    const pair = generateKeyPair();
    privateKey = pair.privateKey;
    publicKey = pair.publicKey;
  }

  const jwk = publicKey.export({ format: 'jwk' });
  const kid = computeJwkThumbprint(jwk);

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
function computeJwkThumbprint(jwk) {
  const canonical = JSON.stringify({
    crv: jwk.crv,
    kty: jwk.kty,
    x: jwk.x,
    y: jwk.y,
  });
  return crypto.createHash('sha256').update(canonical).digest('base64url');
}

/**
 * Sign a message with the issuer's private key (ES256).
 * Returns the raw signature as base64url (R || S, 64 bytes for P-256).
 */
export function signWithIssuerKey(message) {
  const { privateKey, kid } = initIssuerKey();
  const signature = crypto.sign('sha256', Buffer.from(message, 'utf8'), {
    key: privateKey,
    dsaEncoding: 'ieee-p1363',
  });
  return { value: signature.toString('base64url'), kid };
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
export function getJwks() {
  const { publicKeyJwk } = initIssuerKey();
  return { keys: [publicKeyJwk] };
}

/**
 * Get the issuer's public key JWK (for embedding in receipts if needed).
 */
export function getIssuerPublicKeyJwk() {
  const { publicKeyJwk } = initIssuerKey();
  return publicKeyJwk;
}

/**
 * Get the issuer's key ID (kid).
 */
export function getIssuerKid() {
  const { kid } = initIssuerKey();
  return kid;
}

/**
 * Reset the cached key (for testing only).
 */
export function _resetIssuerKey() {
  _privateKey = null;
  _publicKeyJwk = null;
  _kid = null;
}

export default {
  initIssuerKey,
  signWithIssuerKey,
  verifyWithIssuerKey,
  verifyWithJwk,
  getJwks,
  getIssuerPublicKeyJwk,
  getIssuerKid,
  _resetIssuerKey,
};
