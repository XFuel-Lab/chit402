import crypto from 'crypto';

/**
 * Coinbase CDP Secret API Key → Bearer JWT (EdDSA / Ed25519).
 * Spec: https://docs.cdp.coinbase.com/api-reference/v2/authentication
 *
 * Secret is base64(32-byte seed || 32-byte public). Used for CDP x402 facilitator
 * auth when CDP_API_KEY_ID + CDP_API_KEY_SECRET are set.
 */

function b64urlJson(obj) {
  return Buffer.from(JSON.stringify(obj), 'utf8').toString('base64url');
}

function ed25519PrivateKeyFromSeed(seed32) {
  // PKCS#8 DER prefix for Ed25519 + 32-byte seed
  const der = Buffer.concat([
    Buffer.from('302e020100300506032b657004220420', 'hex'),
    seed32,
  ]);
  return crypto.createPrivateKey({ key: der, format: 'der', type: 'pkcs8' });
}

/**
 * @param {{ apiKeyId: string, apiKeySecret: string, requestMethod: string, requestHost: string, requestPath: string, expiresIn?: number }} opts
 * @returns {string} JWT
 */
export function generateCdpJwt({
  apiKeyId,
  apiKeySecret,
  requestMethod,
  requestHost,
  requestPath,
  expiresIn = 120,
}) {
  if (!apiKeyId || !apiKeySecret) {
    throw new Error('cdp-jwt: apiKeyId and apiKeySecret required');
  }
  const decoded = Buffer.from(apiKeySecret, 'base64');
  if (decoded.length !== 64) {
    throw new Error(`cdp-jwt: expected 64-byte Ed25519 secret, got ${decoded.length}`);
  }
  const seed = decoded.subarray(0, 32);
  const key = ed25519PrivateKeyFromSeed(seed);

  const now = Math.floor(Date.now() / 1000);
  const header = {
    alg: 'EdDSA',
    typ: 'JWT',
    kid: apiKeyId,
    nonce: crypto.randomBytes(16).toString('hex'),
  };
  const claims = {
    sub: apiKeyId,
    iss: 'cdp',
    aud: ['cdp_service'],
    nbf: now,
    exp: now + expiresIn,
    uri: `${String(requestMethod).toUpperCase()} ${requestHost}${requestPath}`,
  };

  const signingInput = `${b64urlJson(header)}.${b64urlJson(claims)}`;
  const signature = crypto.sign(null, Buffer.from(signingInput, 'utf8'), key);
  return `${signingInput}.${signature.toString('base64url')}`;
}

/**
 * Resolve Authorization bearer for a facilitator request.
 * Preference: CDP JWT (when CDP_API_KEY_ID/SECRET set) → static apiKey → null.
 *
 * @param {{ apiKey?: string|null, method: string, url: string }} opts
 * @returns {Promise<string|null>}
 */
export async function resolveFacilitatorBearer({ apiKey, method, url } = {}) {
  const id = process.env.CDP_API_KEY_ID || null;
  const secret = process.env.CDP_API_KEY_SECRET || null;
  if (id && secret) {
    const u = new URL(url);
    return generateCdpJwt({
      apiKeyId: id,
      apiKeySecret: secret,
      requestMethod: method || 'POST',
      requestHost: u.host,
      requestPath: u.pathname,
    });
  }
  return apiKey || null;
}
