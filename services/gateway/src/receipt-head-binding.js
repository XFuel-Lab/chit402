/**
 * Receipt payload v9 binds the transparency-log head and the clock tolerance
 * inside the issuer JWS. v8 and earlier omit the pair and keep their current
 * verification path.
 *
 * Callers must pass claims from a JWS that has already verified. This module
 * does not treat an unsigned outer `tree_head_hash` or `tolerance` as the
 * source of those values. An outer copy that disagrees with the verified
 * claims fails the check.
 *
 * Lockstep with `packages/verify` (`head-binding.ts`) and `packages/sdk`
 * (`readSignedHeadBinding`).
 */

import { clockToleranceClaim } from './receipt-anchor-clock.js';
import { computeJwkThumbprint, getIssuerKid } from './issuer-key.js';

/** Production api.chit402.com issuer kid. An embedded key is not a trust root by itself. */
const PRODUCTION_TRUSTED_ISSUER_KID = 'IvFpmC-vPhkY_v0vidsrWVT9uzlE5XWKZgAEOeJTq1Q';

export const HEAD_BINDING_PAYLOAD_VERSION = 9;

/**
 * Embedded issuer key, only when its thumbprint is a pinned kid.
 * A receipt that carries its own key does not get to choose the head binding.
 * @param {object|null|undefined} receipt
 * @returns {object|null}
 */
export function trustedHeadBindingJwk(receipt) {
  const jwk = receipt?.issuer_signature?.issuer_jwk;
  if (!jwk || jwk.kty !== 'EC' || jwk.crv !== 'P-256' || !jwk.x || !jwk.y) return null;
  let thumb;
  try {
    thumb = computeJwkThumbprint(jwk);
  } catch {
    return null;
  }
  const kids = new Set([PRODUCTION_TRUSTED_ISSUER_KID]);
  try {
    const kid = getIssuerKid();
    if (kid) kids.add(kid);
  } catch {
    // Process key unavailable. The production pin still applies.
  }
  return kids.has(thumb) ? jwk : null;
}

export function clockToleranceBinding() {
  return clockToleranceClaim();
}

export function headBindingClaims(treeHeadHash) {
  return {
    tree_head_hash: treeHeadHash == null || treeHeadHash === '' ? null : String(treeHeadHash),
    tolerance: clockToleranceBinding(),
  };
}

/**
 * @param {object|null|undefined} claims verified JWS claims
 * @returns {'not_present_legacy'|'missing'|'ok'}
 */
export function headBindingVerdict(claims) {
  if (!claims || typeof claims !== 'object') return 'not_present_legacy';
  const version = Number(claims.payload_version);
  if (!Number.isFinite(version) || version < HEAD_BINDING_PAYLOAD_VERSION) {
    return 'not_present_legacy';
  }
  if (!Object.prototype.hasOwnProperty.call(claims, 'tree_head_hash')) return 'missing';
  if (!Object.prototype.hasOwnProperty.call(claims, 'tolerance')) return 'missing';
  return 'ok';
}

/**
 * The pair, from verified claims only.
 * @param {object|null|undefined} claims
 */
export function signedHeadBinding(claims) {
  const verdict = headBindingVerdict(claims);
  if (verdict !== 'ok') {
    return { verdict, tree_head_hash: null, tolerance: null };
  }
  const hash = claims.tree_head_hash;
  return {
    verdict,
    tree_head_hash: hash == null || hash === '' ? null : String(hash),
    tolerance: claims.tolerance ?? null,
  };
}

/**
 * Field name when the unsigned outer copy disagrees with verified claims.
 * Absent outer keys are not a disagreement. v8 claims are not compared.
 * @param {object|null|undefined} receipt
 * @param {object|null|undefined} claims verified JWS claims
 * @returns {'tree_head_hash'|'tolerance'|null}
 */
export function outerHeadDisagrees(receipt, claims) {
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

/**
 * Verify the issuer JWS, then read the pair only from those claims.
 * `verifyJws(jws)` returns `{ valid, payload, reason }`.
 * @param {object} receipt
 * @param {(jws: string) => { valid?: boolean, payload?: object, reason?: string }} verifyJws
 */
export function verifyReceiptHeadBinding(receipt, verifyJws) {
  const jws = receipt?.issuer_signature?.jws;
  const stamped = Number(receipt?.issuer_signature?.payload_version);
  if (!jws) {
    if (Number.isFinite(stamped) && stamped >= HEAD_BINDING_PAYLOAD_VERSION) {
      return {
        checked: true,
        ok: false,
        legacy: false,
        reason: 'head_binding_missing',
        binding: null,
      };
    }
    return { checked: false, ok: true, legacy: true, reason: 'no_jws', binding: null };
  }
  const verified = typeof verifyJws === 'function' ? verifyJws(jws) : { valid: false, reason: 'no_verifier' };
  if (!verified?.valid) {
    return {
      checked: true,
      ok: false,
      legacy: false,
      reason: verified?.reason || 'signature_invalid',
      binding: null,
    };
  }
  const claims = verified.payload || null;
  const verdict = headBindingVerdict(claims);
  if (verdict === 'missing') {
    return { checked: true, ok: false, legacy: false, reason: 'head_binding_missing', binding: null };
  }
  if (verdict === 'not_present_legacy') {
    return { checked: true, ok: true, legacy: true, reason: null, binding: null, claims };
  }
  const disagree = outerHeadDisagrees(receipt, claims);
  const binding = signedHeadBinding(claims);
  if (disagree) {
    return {
      checked: true,
      ok: false,
      legacy: false,
      reason: 'head_binding_mismatch',
      field: disagree,
      binding,
      claims,
    };
  }
  return { checked: true, ok: true, legacy: false, reason: null, binding, claims };
}
