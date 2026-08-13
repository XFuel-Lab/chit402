import crypto from 'crypto';

/**
 * Buyer attribution helpers for Private Spend + buyer-scoped stats.
 * Never store raw API keys on tasks — only a SHA-256 hex digest.
 */

/** @param {string|null|undefined} apiKey */
export function hashApiKey(apiKey) {
  if (!apiKey || typeof apiKey !== 'string') return null;
  const trimmed = apiKey.trim();
  if (!trimmed) return null;
  return crypto.createHash('sha256').update(trimmed, 'utf8').digest('hex');
}

/**
 * Extract buyer API key from Express-like request (X-API-Key or Bearer).
 * @param {{ headers?: Record<string, string|string[]|undefined> }} req
 */
export function apiKeyFromReq(req) {
  const h = req?.headers || {};
  const raw = h['x-api-key'] || h['X-API-Key'];
  if (raw) return String(Array.isArray(raw) ? raw[0] : raw).trim() || null;
  const auth = h.authorization || h.Authorization;
  if (auth && typeof auth === 'string' && /^Bearer\s+/i.test(auth)) {
    return auth.replace(/^Bearer\s+/i, '').trim() || null;
  }
  return null;
}

/** @param {{ headers?: Record<string, string|string[]|undefined> }} req */
export function apiKeyHashFromReq(req) {
  return hashApiKey(apiKeyFromReq(req));
}

/**
 * A per-tenant prompt-cache namespace to send upstream.
 *
 * Why this exists: every XFuel buyer is multiplexed through one provider API
 * key, so from the provider's side we are a single account and their
 * per-account cache isolation collapses to none between our tenants. CacheProbe
 * (SAGAI '26) measured this exact architecture on OpenRouter and found
 * cross-account cache sharing as high as 100% on some upstreams, with prompts
 * recoverable by timing. The mitigation is to partition the upstream cache per
 * buyer.
 *
 * Derived by hashing again rather than forwarding `apiKeyHash` directly: that
 * digest is a stable buyer identifier we use internally, and a provider should
 * not receive a value that correlates across our own records.
 *
 * @param {string|null} apiKeyHash from `apiKeyHashFromReq`
 * @returns {string|null} opaque namespace, or null for an unattributed caller
 */
export function cacheNamespace(apiKeyHash) {
  if (!apiKeyHash || typeof apiKeyHash !== 'string') return null;
  return crypto.createHash('sha256')
    .update(`xfuel-cache-ns:${apiKeyHash}`, 'utf8')
    .digest('hex')
    .slice(0, 32);
}
