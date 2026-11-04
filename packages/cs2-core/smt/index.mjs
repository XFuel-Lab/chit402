/**
 * Chit Simple v13 state SMT and slot rules 1–7.
 *
 * Slot keys are imported from the line module. This file does not define
 * the slot-key preimage. Tree size and indexes stop at 2^53 − 1, an
 * implementation limit, not a wire field.
 */

export { MAX_SMT_ENTRIES, acceptSize, indexBytes } from './size.mjs';
export { REASONS } from './reasons.mjs';
export {
  DEPTH,
  PROOF_BITMAP_BYTES,
  blankHash,
  createTree,
  emptyRoot,
  entryCount,
  getLeaf,
  hasLeaf,
  prove,
  putLeaf,
  rootBytes,
  treeFromLeaves,
  verifyProof,
} from './tree.mjs';
export {
  BOOK_CREATE_TYPE,
  CROSS_TYPE,
  PAYTO_CONTROL_TYPE,
  REVOKE_BY_KEY_TYPE,
  REVOKE_TYPE,
  WALLET_JOIN_TYPE,
  WALLET_LEAVE_TYPE,
  WALLET_STOP_TYPE,
  DOMAIN_TYPE,
  DOMAIN_NAME,
  DOMAIN_VERSION,
  bookCreateDigest,
  contractForHour,
  crossDigest,
  domainSeparator,
  payToControlDigest,
  revokeByKeyDigest,
  revokeDigest,
  formatKeyHash,
  parseKeyHash,
  sellerKeyHash,
  verifyKeyPossession,
  verifyKeyRevoke,
  verifySellerSig,
  walletJoinDigest,
  walletLeaveDigest,
  walletStopDigest,
} from './sig.mjs';
export {
  HISTORY_VERSION,
  KEY_STATUS_UNPROVEN,
  MAX_RECORDS,
  REC_BOOK,
  REC_JOIN,
  REC_LEAVE,
  REC_REGISTER,
  REC_REVOKE,
  REC_STOP,
  admit,
  admitKeyRevoke,
  assess,
  decodeHistory,
  detectEquivocation,
  emptyHistory,
  encodeHistory,
  extendsHistory,
  faultLine,
  keyStatus,
  payToEntryBytes,
  verifyAdmission,
  verifyKeyStatus,
  verifySlot,
  revokeAcross,
} from './history.mjs';
export {
  HOUR_SECONDS,
  PAD_ENTRIES,
  drawEpoch,
  padTo1024,
  placeHistory,
  redrawDummies,
} from './epoch.mjs';

export const SCHEMA = 'chit402.cs2.smt.v1';

/**
 * Cited from SIMPLE §S5. m7.out is not in this repository.
 * 480 is that citation's max, not a verifier cap. An independent count
 * of random 1,024-key trees saw a 544-byte proof.
 */
export const CITED_PROOF_BYTES = Object.freeze({
  source: 'SIMPLE §S5',
  m7_out: 'not in this repository',
  entries: 1024,
  mean: 363,
  maxLow: 448,
  maxHigh: 480,
  observedTail: 544,
});
