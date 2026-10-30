/**
 * Chit Simple v13 seller tooling.
 * Signs sigma for one matching payment, and signs the EIP-712 payTo
 * registration record. This package does not read the live gateway's
 * number-only finality helper and does not talk to a production host
 * unless the caller passes a reader.
 */

export { REASONS, refuse } from './reasons.mjs';
export { createOnceStore } from './store.mjs';
export { isLowS } from './low-s.mjs';
export {
  readCanonicalPayment,
  createRpcReader,
} from './chain.mjs';
export {
  matchAuthorization,
  requireObservedTriple,
} from './match.mjs';
export {
  DOMAIN_NAME,
  DOMAIN_VERSION,
  DOMAIN_FIELDS,
  DOMAIN_TYPE,
  PAYTO_CONTROL,
  PAYTO_CONTROL_TYPE,
  REVOKE,
  REVOKE_TYPE,
  REVOKE_BY_KEY,
  REVOKE_BY_KEY_TYPE,
  BOOK_ACTION,
  BOOK_ACTION_TYPE,
  STATEMENT_RECORD,
  STATEMENT_RECORD_TYPE,
  CHIT_TYPES,
  chitDomain,
} from './typed-data.mjs';
export { HOUR_SECONDS, contractForHour } from './pinned-contract.mjs';
export {
  EOA_SIGNATURE_BYTES,
  SIGNATURE_LENGTH_PREFIX_BYTES,
  encodeSignatureField,
  readSignatureField,
} from './signature-field.mjs';
export {
  hashTypedData,
  hashChit,
  chitDomainSeparator,
  sellerKeyHash,
  revokeRecordId,
  payToControlDigest,
  signPayToControl,
  verifyPayToControl,
  signRevoke,
  verifyRevoke,
  signRevokeByKey,
  verifyRevokeByKey,
} from './eip712.mjs';
export {
  signSigma,
  verifySigma,
  createSeller,
  compressP256,
} from './sigma.mjs';
