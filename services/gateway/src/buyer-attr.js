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
