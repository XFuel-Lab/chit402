/**
 * Exact JSON-number receipt versions.
 * Lockstep with packages/verify `signedClaimsOnAllowlist`.
 * `Number()` is not used. A value of 12 is not treated as 11.
 */

export function isJsonInteger(value) {
  return typeof value === 'number' && Number.isInteger(value);
}

export function isV11Claims(payload) {
  return !!payload
    && typeof payload === 'object'
    && !Array.isArray(payload)
    && payload.v === 11
    && typeof payload.v === 'number'
    && !Object.prototype.hasOwnProperty.call(payload, 'payload_version');
}

/** Legacy issuer-root shape: payload_version 11 and a signed issuer_root. */
export function isIssuerRootClaims(payload) {
  return !!payload
    && typeof payload === 'object'
    && isJsonInteger(payload.payload_version)
    && payload.payload_version === 11
    && payload.issuer_root != null
    && typeof payload.issuer_root === 'object';
}

export function isLegacyPayloadVersion(value) {
  return isJsonInteger(value) && value >= 1 && value <= 10;
}
