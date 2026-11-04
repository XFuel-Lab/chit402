/**
 * Shared Chit Simple v13 EIP-712 domain, type strings, and keyHash.
 * Sellers, the builder, and the verifier import this module.
 */

export {
  DOMAIN_NAME,
  DOMAIN_VERSION,
  PAYTO_CONTROL,
  REVOKE,
  REVOKE_BY_KEY,
  BOOK_ACTION,
  STATEMENT_RECORD,
  DOMAIN_FIELDS,
  PAYTO_CONTROL_FIELDS,
  REVOKE_FIELDS,
  REVOKE_BY_KEY_FIELDS,
  BOOK_ACTION_FIELDS,
  STATEMENT_RECORD_FIELDS,
  DOMAIN_TYPE,
  PAYTO_CONTROL_TYPE,
  REVOKE_TYPE,
  REVOKE_BY_KEY_TYPE,
  BOOK_ACTION_TYPE,
  STATEMENT_RECORD_TYPE,
  CHIT_TYPES,
  chitDomain,
} from './domain.mjs';

export { TIME_UNIT, HOUR_SECONDS, expiryAllows } from './time.mjs';
export {
  ALG_REGISTRY,
  LAUNCH_ALGS,
  KEY_ALG_P256,
  KEY_ALG_SECP256K1,
  canonicalKey,
} from './registry.mjs';
export { keyHash, parseKeyHash, formatKeyHash, tombstoned, DENIED_KEY_HASHES, deniedKeyHash } from './key-hash.mjs';
export { possessionPreimage, verifyPossession } from './possession.mjs';
export { checkSigma } from './sigma-range.mjs';
export {
  KIND_PAYTO,
  KIND_KEY,
  KIND_CHANNEL,
  EXIT_UNPROVEN,
  SLOT_DOMAIN,
  KEY_STATUS_ACTIVE,
  KEY_STATUS_UNPROVEN,
  KEY_STATUS_INVALID,
  KEY_STATUS_REVOKED,
  keySlotKey,
  checkTombstone,
  tombstoneCovers,
  checkAdmission,
  deriveKeySlotKey,
  readKeyLeaf,
  keyStatus,
} from './slots.mjs';
