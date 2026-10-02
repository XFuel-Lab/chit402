/**
 * Payload v9 binds `(tree_head_hash, tolerance)` inside the issuer JWS.
 * v8 and earlier omit the pair and keep their current verification path.
 *
 * The pair is read only from claims the caller has already verified.
 * An unsigned outer copy that disagrees fails the check. Lockstep with
 * `services/gateway/src/receipt-head-binding.js`.
 */

export const HEAD_BINDING_PAYLOAD_VERSION = 9;

export type HeadBindingVerdict = 'not_present_legacy' | 'missing' | 'ok';

export interface SignedHeadBinding {
  verdict: HeadBindingVerdict;
  tree_head_hash: string | null;
  tolerance: unknown;
}

export function headBindingVerdict(
  claims: Record<string, unknown> | null | undefined,
): HeadBindingVerdict {
  if (!claims || typeof claims !== 'object') return 'not_present_legacy';
  const version = Number(claims.payload_version);
  if (!Number.isFinite(version) || version < HEAD_BINDING_PAYLOAD_VERSION) {
    return 'not_present_legacy';
  }
  if (!Object.prototype.hasOwnProperty.call(claims, 'tree_head_hash')) return 'missing';
  if (!Object.prototype.hasOwnProperty.call(claims, 'tolerance')) return 'missing';
  return 'ok';
}

/** Pair from verified claims. Does not read the unsigned receipt. */
export function signedHeadBinding(
  claims: Record<string, unknown> | null | undefined,
): SignedHeadBinding {
  const verdict = headBindingVerdict(claims);
  if (verdict !== 'ok' || !claims) {
    return { verdict: verdict === 'ok' ? 'missing' : verdict, tree_head_hash: null, tolerance: null };
  }
  const hash = claims.tree_head_hash;
  return {
    verdict,
    tree_head_hash: hash == null || hash === '' ? null : String(hash),
    tolerance: claims.tolerance ?? null,
  };
}

/** Which unsigned field disagrees, or null. v8 claims are not compared. */
export function outerHeadDisagrees(
  receipt: { tree_head_hash?: unknown; tolerance?: unknown } | null | undefined,
  claims: Record<string, unknown> | null | undefined,
): 'tree_head_hash' | 'tolerance' | null {
  const signed = signedHeadBinding(claims);
  if (signed.verdict !== 'ok' || !receipt || typeof receipt !== 'object') return null;
  if (Object.prototype.hasOwnProperty.call(receipt, 'tree_head_hash')) {
    const outer = receipt.tree_head_hash == null || receipt.tree_head_hash === ''
      ? null
      : String(receipt.tree_head_hash);
    if (outer !== signed.tree_head_hash) return 'tree_head_hash';
  }
  if (Object.prototype.hasOwnProperty.call(receipt, 'tolerance')) {
    if (JSON.stringify(receipt.tolerance ?? null) !== JSON.stringify(signed.tolerance ?? null)) {
      return 'tolerance';
    }
  }
  return null;
}
