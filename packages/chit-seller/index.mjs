/**
 * Chit Simple v13 seller tooling.
 * Signs sigma for one matching payment, and signs the EIP-712 payTo
 * registration record. This package does not read the live gateway's
 * number-only finality helper and does not talk to a production host
 * unless the caller passes readers. Chain 84532 uses the bundled RPC list
 * and signs only when two readers agree. The number-only finality helper
 * is not used.
 */

export { REASONS, refuse } from './reasons.mjs';
export { isLowS } from './low-s.mjs';
export {
  readCanonicalPayment,
  readAgreedPayment,
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
  TIME_UNIT,
  HOUR_SECONDS,
  expiryAllows,
  ALG_REGISTRY,
  LAUNCH_ALGS,
  KEY_ALG_P256,
  KEY_ALG_SECP256K1,
  canonicalKey,
  keyHash,
  tombstoned,
} from './typed-data.mjs';
export { contractForHour } from './pinned-contract.mjs';
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
  verifySigma,
  createSeller,
  compressP256,
} from './sigma.mjs';
