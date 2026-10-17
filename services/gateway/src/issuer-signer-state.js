/**
 * Process-wide issuer signer slot.
 * Kept in its own module so issuer-key and the signer implementations
 * can share it without an import cycle.
 */

/** @type {null | { kind: 'env'|'kms', kid: string, publicJwk: { kty: string, crv: string, x: string, y: string }, sign: (input: Buffer) => Promise<Buffer> }} */
let signer = null;

export function peekIssuerSigner() {
  return signer;
}

export function setIssuerSigner(next) {
  signer = next || null;
  return signer;
}

export function resetIssuerSigner() {
  signer = null;
}
