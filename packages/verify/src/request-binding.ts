/**
 * Recompute request_digest from the published RFC 8785 preimage.
 * The preimage is the exact UTF-8 string. This function does not rebuild it.
 * Gateway field order is body_sha256, idempotency_key, method, nonce, path.
 */
import { createHash } from 'node:crypto';

export type RequestBindingStatus = 'REQUEST_UNBOUND' | 'request_digest_mismatch' | 'recomputed';

export function requestDigestOfPreimage(preimageUtf8: string): string {
  return createHash('sha256').update(preimageUtf8, 'utf8').digest('hex');
}

export function verifyRequestDigest(
  digest: string,
  preimageUtf8: string,
): { ok: boolean; reason: RequestBindingStatus } {
  if (typeof digest !== 'string' || !/^[0-9a-f]{64}$/.test(digest)) {
    return { ok: false, reason: 'REQUEST_UNBOUND' };
  }
  if (typeof preimageUtf8 !== 'string' || preimageUtf8 === '') {
    return { ok: false, reason: 'REQUEST_UNBOUND' };
  }
  if (requestDigestOfPreimage(preimageUtf8) !== digest) {
    return { ok: false, reason: 'request_digest_mismatch' };
  }
  return { ok: true, reason: 'recomputed' };
}
