import { test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'crypto';
import { generateCdpJwt, resolveFacilitatorBearer, isCdpHost } from '../src/cdp-jwt.js';
import {
  defaultFacilitatorUrlForNetwork,
  DEFAULT_FACILITATOR_URL,
  CDP_FACILITATOR_URL,
  PAYAI_FACILITATOR_URL,
} from '../src/x402-facilitator.js';

/** Fresh Ed25519 keypair → CDP-shaped 64-byte secret (seed || public). */
function makeCdpSecretPair() {
  const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');
  const privDer = privateKey.export({ type: 'pkcs8', format: 'der' });
  const pubDer = publicKey.export({ type: 'spki', format: 'der' });
  // PKCS8 Ed25519: last 32 bytes are the seed; SPKI: last 32 bytes are public.
  const seed = privDer.subarray(privDer.length - 32);
  const pub = pubDer.subarray(pubDer.length - 32);
  const secret = Buffer.concat([seed, pub]).toString('base64');
  return { secret, publicKey };
}

test('defaultFacilitatorUrlForNetwork: base → CDP, sepolia → x402.org', () => {
  assert.equal(defaultFacilitatorUrlForNetwork('base'), CDP_FACILITATOR_URL);
  assert.equal(defaultFacilitatorUrlForNetwork('eip155:8453'), CDP_FACILITATOR_URL);
  assert.equal(defaultFacilitatorUrlForNetwork('base-sepolia'), DEFAULT_FACILITATOR_URL);
  assert.equal(defaultFacilitatorUrlForNetwork(''), DEFAULT_FACILITATOR_URL);
});

test('generateCdpJwt: EdDSA JWT verifies with matching public key', () => {
  const { secret, publicKey } = makeCdpSecretPair();
  const apiKeyId = 'test-key-id';
  const jwt = generateCdpJwt({
    apiKeyId,
    apiKeySecret: secret,
    requestMethod: 'POST',
    requestHost: 'api.cdp.coinbase.com',
    requestPath: '/platform/v2/x402/verify',
  });
  const parts = jwt.split('.');
  assert.equal(parts.length, 3);
  const header = JSON.parse(Buffer.from(parts[0], 'base64url').toString('utf8'));
  assert.equal(header.alg, 'EdDSA');
  assert.equal(header.kid, apiKeyId);
  const claims = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
  assert.equal(claims.sub, apiKeyId);
  assert.equal(claims.iss, 'cdp');
  assert.equal(claims.uri, 'POST api.cdp.coinbase.com/platform/v2/x402/verify');
  const ok = crypto.verify(
    null,
    Buffer.from(`${parts[0]}.${parts[1]}`, 'utf8'),
    publicKey,
    Buffer.from(parts[2], 'base64url'),
  );
  assert.equal(ok, true);
});

test('generateCdpJwt: rejects wrong-length secrets', () => {
  assert.throws(
    () => generateCdpJwt({
      apiKeyId: 'x',
      apiKeySecret: Buffer.from('short').toString('base64'),
      requestMethod: 'POST',
      requestHost: 'h',
      requestPath: '/p',
    }),
    /64-byte/,
  );
});

test('resolveFacilitatorBearer: prefers CDP JWT over static apiKey', async () => {
  const { secret } = makeCdpSecretPair();
  const prevId = process.env.CDP_API_KEY_ID;
  const prevSecret = process.env.CDP_API_KEY_SECRET;
  process.env.CDP_API_KEY_ID = 'env-key';
  process.env.CDP_API_KEY_SECRET = secret;
  try {
    const bearer = await resolveFacilitatorBearer({
      apiKey: 'static-should-not-win',
      method: 'POST',
      url: 'https://api.cdp.coinbase.com/platform/v2/x402/settle',
    });
    assert.ok(bearer && bearer.split('.').length === 3);
    assert.notEqual(bearer, 'static-should-not-win');
  } finally {
    if (prevId === undefined) delete process.env.CDP_API_KEY_ID;
    else process.env.CDP_API_KEY_ID = prevId;
    if (prevSecret === undefined) delete process.env.CDP_API_KEY_SECRET;
    else process.env.CDP_API_KEY_SECRET = prevSecret;
  }
});

test('resolveFacilitatorBearer: falls back to static apiKey', async () => {
  const prevId = process.env.CDP_API_KEY_ID;
  const prevSecret = process.env.CDP_API_KEY_SECRET;
  delete process.env.CDP_API_KEY_ID;
  delete process.env.CDP_API_KEY_SECRET;
  try {
    const bearer = await resolveFacilitatorBearer({
      apiKey: 'static-bearer',
      method: 'POST',
      url: 'https://example.com/verify',
    });
    assert.equal(bearer, 'static-bearer');
    const none = await resolveFacilitatorBearer({
      apiKey: null,
      method: 'POST',
      url: 'https://example.com/verify',
    });
    assert.equal(none, null);
  } finally {
    if (prevId === undefined) delete process.env.CDP_API_KEY_ID;
    else process.env.CDP_API_KEY_ID = prevId;
    if (prevSecret === undefined) delete process.env.CDP_API_KEY_SECRET;
    else process.env.CDP_API_KEY_SECRET = prevSecret;
  }
});

// ══════════════════════════════════════════════════════════════════════════════
// isCdpHost tests (2026-08-23 bugfix: CDP JWT only for CDP hosts)
// ══════════════════════════════════════════════════════════════════════════════

test('isCdpHost: recognizes CDP hosts', () => {
  assert.equal(isCdpHost('api.cdp.coinbase.com'), true, 'api.cdp.coinbase.com');
  assert.equal(isCdpHost('API.CDP.COINBASE.COM'), true, 'case-insensitive');
  assert.equal(isCdpHost('staging.cdp.coinbase.com'), true, 'subdomain of cdp.coinbase.com');
  assert.equal(isCdpHost('test.staging.cdp.coinbase.com'), true, 'deep subdomain');
});

test('isCdpHost: rejects non-CDP hosts', () => {
  assert.equal(isCdpHost('x402.dexter.cash'), false, 'Dexter is not CDP');
  assert.equal(isCdpHost('facilitator.payai.network'), false, 'PayAI is not CDP');
  assert.equal(isCdpHost('x402.org'), false, 'x402.org is not CDP');
  assert.equal(isCdpHost('coinbase.com'), false, 'coinbase.com without cdp subdomain');
  assert.equal(isCdpHost('fakecdp.coinbase.com'), false, 'fakecdp is not cdp');
  assert.equal(isCdpHost(null), false, 'null');
  assert.equal(isCdpHost(''), false, 'empty string');
  assert.equal(isCdpHost(undefined), false, 'undefined');
});

test('resolveFacilitatorBearer: CDP URL gets JWT when keys exist', async () => {
  const { secret } = makeCdpSecretPair();
  const prevId = process.env.CDP_API_KEY_ID;
  const prevSecret = process.env.CDP_API_KEY_SECRET;
  process.env.CDP_API_KEY_ID = 'test-key';
  process.env.CDP_API_KEY_SECRET = secret;
  try {
    const bearer = await resolveFacilitatorBearer({
      method: 'POST',
      url: CDP_FACILITATOR_URL + '/verify',
    });
    // Should be a JWT (three dot-separated parts)
    assert.ok(bearer, 'bearer is truthy');
    assert.equal(bearer.split('.').length, 3, 'bearer is a JWT');
  } finally {
    if (prevId === undefined) delete process.env.CDP_API_KEY_ID;
    else process.env.CDP_API_KEY_ID = prevId;
    if (prevSecret === undefined) delete process.env.CDP_API_KEY_SECRET;
    else process.env.CDP_API_KEY_SECRET = prevSecret;
  }
});

test('resolveFacilitatorBearer: Dexter URL gets no JWT even when CDP keys exist', async () => {
  const { secret } = makeCdpSecretPair();
  const prevId = process.env.CDP_API_KEY_ID;
  const prevSecret = process.env.CDP_API_KEY_SECRET;
  process.env.CDP_API_KEY_ID = 'test-key';
  process.env.CDP_API_KEY_SECRET = secret;
  try {
    const bearer = await resolveFacilitatorBearer({
      method: 'POST',
      url: 'https://x402.dexter.cash/verify',
    });
    // Should be null — no JWT for non-CDP hosts
    assert.equal(bearer, null, 'no JWT for Dexter');
  } finally {
    if (prevId === undefined) delete process.env.CDP_API_KEY_ID;
    else process.env.CDP_API_KEY_ID = prevId;
    if (prevSecret === undefined) delete process.env.CDP_API_KEY_SECRET;
    else process.env.CDP_API_KEY_SECRET = prevSecret;
  }
});

test('resolveFacilitatorBearer: PayAI URL gets no JWT even when CDP keys exist', async () => {
  const { secret } = makeCdpSecretPair();
  const prevId = process.env.CDP_API_KEY_ID;
  const prevSecret = process.env.CDP_API_KEY_SECRET;
  process.env.CDP_API_KEY_ID = 'test-key';
  process.env.CDP_API_KEY_SECRET = secret;
  try {
    const bearer = await resolveFacilitatorBearer({
      method: 'POST',
      url: PAYAI_FACILITATOR_URL + '/verify',
    });
    // Should be null — no JWT for non-CDP hosts
    assert.equal(bearer, null, 'no JWT for PayAI');
  } finally {
    if (prevId === undefined) delete process.env.CDP_API_KEY_ID;
    else process.env.CDP_API_KEY_ID = prevId;
    if (prevSecret === undefined) delete process.env.CDP_API_KEY_SECRET;
    else process.env.CDP_API_KEY_SECRET = prevSecret;
  }
});

test('resolveFacilitatorBearer: Dexter URL uses explicit apiKey', async () => {
  const { secret } = makeCdpSecretPair();
  const prevId = process.env.CDP_API_KEY_ID;
  const prevSecret = process.env.CDP_API_KEY_SECRET;
  process.env.CDP_API_KEY_ID = 'test-key';
  process.env.CDP_API_KEY_SECRET = secret;
  try {
    const bearer = await resolveFacilitatorBearer({
      apiKey: 'dexter-api-key-123',
      method: 'POST',
      url: 'https://x402.dexter.cash/verify',
    });
    // Should use the explicit apiKey, not mint a CDP JWT
    assert.equal(bearer, 'dexter-api-key-123', 'uses explicit apiKey for non-CDP');
  } finally {
    if (prevId === undefined) delete process.env.CDP_API_KEY_ID;
    else process.env.CDP_API_KEY_ID = prevId;
    if (prevSecret === undefined) delete process.env.CDP_API_KEY_SECRET;
    else process.env.CDP_API_KEY_SECRET = prevSecret;
  }
});
