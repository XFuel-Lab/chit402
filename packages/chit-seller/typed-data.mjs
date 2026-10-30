/**
 * EIP-712 domain and type strings for Chit slot records.
 *
 * One domain for every slot-record type and for BookAction / StatementRecord.
 * name "Chit402", version "13", chainId, and verifyingContract set to the
 * ChitAnchor that admits the record. No salt. The contract address is not a
 * struct field. This module is the only place those strings are chosen.
 *
 * validFrom and revokedAt are not signed. The builder writes them from the
 * admission block. A revocation's id is (slot, keyHash).
 */

export const DOMAIN_NAME = 'Chit402';
export const DOMAIN_VERSION = '13';

export const PAYTO_CONTROL = 'PayToControl';
export const REVOKE = 'Revoke';
export const REVOKE_BY_KEY = 'RevokeByKey';
export const BOOK_ACTION = 'BookAction';
export const STATEMENT_RECORD = 'StatementRecord';

export const DOMAIN_FIELDS = Object.freeze([
  Object.freeze({ name: 'name', type: 'string' }),
  Object.freeze({ name: 'version', type: 'string' }),
  Object.freeze({ name: 'chainId', type: 'uint256' }),
  Object.freeze({ name: 'verifyingContract', type: 'address' }),
]);

export const PAYTO_CONTROL_FIELDS = Object.freeze([
  Object.freeze({ name: 'payTo', type: 'address' }),
  Object.freeze({ name: 'keyAlg', type: 'uint8' }),
  Object.freeze({ name: 'key', type: 'bytes' }),
  Object.freeze({ name: 'expiry', type: 'uint64' }),
]);

export const REVOKE_FIELDS = Object.freeze([
  Object.freeze({ name: 'payTo', type: 'address' }),
  Object.freeze({ name: 'keyHash', type: 'bytes32' }),
]);

export const REVOKE_BY_KEY_FIELDS = Object.freeze([
  Object.freeze({ name: 'keyHash', type: 'bytes32' }),
]);

export const BOOK_ACTION_FIELDS = Object.freeze([
  Object.freeze({ name: 'bookId', type: 'bytes32' }),
  Object.freeze({ name: 'eventHash', type: 'bytes32' }),
  Object.freeze({ name: 'kind', type: 'uint8' }),
  Object.freeze({ name: 'seq', type: 'uint64' }),
  Object.freeze({ name: 'expiry', type: 'uint64' }),
]);

export const STATEMENT_RECORD_FIELDS = Object.freeze([
  Object.freeze({ name: 'bookId', type: 'bytes32' }),
  Object.freeze({ name: 'period', type: 'uint64' }),
  Object.freeze({ name: 'version', type: 'uint32' }),
  Object.freeze({ name: 'statementHash', type: 'bytes32' }),
  Object.freeze({ name: 'expiry', type: 'uint64' }),
]);

function typeString(name, fields) {
  return `${name}(${fields.map((field) => `${field.type} ${field.name}`).join(',')})`;
}

export const DOMAIN_TYPE = typeString('EIP712Domain', DOMAIN_FIELDS);
export const PAYTO_CONTROL_TYPE = typeString(PAYTO_CONTROL, PAYTO_CONTROL_FIELDS);
export const REVOKE_TYPE = typeString(REVOKE, REVOKE_FIELDS);
export const REVOKE_BY_KEY_TYPE = typeString(REVOKE_BY_KEY, REVOKE_BY_KEY_FIELDS);
export const BOOK_ACTION_TYPE = typeString(BOOK_ACTION, BOOK_ACTION_FIELDS);
export const STATEMENT_RECORD_TYPE = typeString(STATEMENT_RECORD, STATEMENT_RECORD_FIELDS);

export const CHIT_TYPES = Object.freeze({
  [PAYTO_CONTROL]: PAYTO_CONTROL_FIELDS,
  [REVOKE]: REVOKE_FIELDS,
  [REVOKE_BY_KEY]: REVOKE_BY_KEY_FIELDS,
  [BOOK_ACTION]: BOOK_ACTION_FIELDS,
  [STATEMENT_RECORD]: STATEMENT_RECORD_FIELDS,
});

/**
 * Domain values for one admitting contract. The address is not optional.
 * @param {bigint} chainId
 * @param {string} verifyingContract 20-byte lowercase hex, no prefix
 */
export function chitDomain(chainId, verifyingContract) {
  if (typeof chainId !== 'bigint' || typeof verifyingContract !== 'string' || verifyingContract.length !== 40) {
    return null;
  }
  const values = {
    name: DOMAIN_NAME,
    version: DOMAIN_VERSION,
    chainId,
    verifyingContract,
  };
  const domain = {};
  for (const field of DOMAIN_FIELDS) {
    if (!Object.hasOwn(values, field.name)) return null;
    domain[field.name] = values[field.name];
  }
  return domain;
}
