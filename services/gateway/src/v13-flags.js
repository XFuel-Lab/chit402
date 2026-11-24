/**
 * v13 house-receipt flags. Each one defaults to unset/false.
 * An unknown value is refused. Nothing here reads a secret.
 *
 * The host role that later runs the sealer needs kms:Sign and
 * kms:GetPublicKey on the key named by CHIT_CHECKPOINT_KMS_KEY_ID
 * in CHIT_CHECKPOINT_KMS_REGION, and nothing else on that key
 * (no ScheduleKeyDeletion, CreateKey, PutKeyPolicy, or Decrypt).
 * This module does not attach that policy and does not read the key id.
 *
 * Names only. Values stay on the host:
 * CHIT_V13_STORE_PATH — durable chit-store directory passed to openStore.
 * CHIT_V13_BIND_DIR — authorization-binding directory, mode 700 or tighter.
 * CHIT_V13_ENV_FILE — optional operator env file, mode 600 or tighter when set.
 * CHIT_V13_HOUSE_BOOK_ID — house book id. The token is the one already on
 * that book in the opened store. It is not read from the request.
 * CHIT_V13_HOUSE_TOKEN_FILE — path of the house book file, mode 600 or
 * tighter. The token is not an environment value.
 * CHIT_CHECKPOINT_MAX_FEE_PER_GAS and CHIT_CHECKPOINT_KMS_TIMEOUT_MS are read
 * by the checkpoint signer. This module does not read their values.
 * CHIT_CHECKPOINT_AWS_CREDENTIALS_FILE — path of the checkpoint credentials
 * file, mode 600 or tighter. The access key is not an environment value.
 * CHIT_CHECKPOINT_AWS_PROFILE — profile name inside that file. This module
 * does not read either name.
 */

import { assertLivePin, mainnetPin, normHex, MAINNET_CHECKPOINT } from '../../chit-sealer/mainnet-pin.js';

export const V13_ISSUANCE_FLAG = 'CHIT_V13_ISSUANCE';
export const V13_SEALER_FLAG = 'CHIT_V13_MAINNET_SEALER';
export const V13_STORE_FLAG = 'CHIT_V13_STORE';

const KMS_ENV_NAMES = Object.freeze([
  'CHIT_CHECKPOINT_KMS_KEY_ID',
  'CHIT_CHECKPOINT_KMS_REGION',
  'CHIT_CHECKPOINT_ADDRESS',
]);

function flagError() {
  const err = new Error('v13 flag is invalid');
  err.code = 'v13_flag_invalid';
  return err;
}

function bootError() {
  const err = new Error('v13 boot refused');
  err.code = 'v13_boot_refused';
  return err;
}

function sourceOf(env) {
  if (env == null) return {};
  if (typeof env !== 'object') throw flagError();
  return env;
}

/**
 * Closed boolean. Unset, empty, and false are off. Only true is on.
 * Any other value is refused.
 * @param {object} env
 * @param {string} name
 */
export function readClosedFlag(env, name) {
  const source = sourceOf(env);
  if (!Object.prototype.hasOwnProperty.call(source, name)) return false;
  const raw = source[name];
  if (raw === true || raw === 'true') return true;
  if (raw == null || raw === false || raw === 'false' || raw === '') return false;
  throw flagError();
}

export function issuanceEnabled(env) {
  return readClosedFlag(env, V13_ISSUANCE_FLAG) === true;
}

export function mainnetSealerEnabled(env) {
  return readClosedFlag(env, V13_SEALER_FLAG) === true;
}

export function storeEnabled(env) {
  return readClosedFlag(env, V13_STORE_FLAG) === true;
}

export function v13Flags(env) {
  return {
    issuance: issuanceEnabled(env),
    mainnetSealer: mainnetSealerEnabled(env),
    store: storeEnabled(env),
  };
}

function present(env, name) {
  const raw = env[name];
  return raw != null && String(raw).trim() !== '';
}

/**
 * Flags off returns without reading pin values into a response.
 * Any flag on refuses a config that is missing the KMS env names or
 * whose checkpoint address is not the live pin.
 * @param {object} [env]
 * @param {object} [pin]
 */
export function assertV13Boot(env = {}, pin = mainnetPin()) {
  const flags = v13Flags(env);
  if (!flags.issuance && !flags.mainnetSealer && !flags.store) return flags;
  const source = sourceOf(env);
  for (let i = 0; i < KMS_ENV_NAMES.length; i += 1) {
    if (!present(source, KMS_ENV_NAMES[i])) throw bootError();
  }
  if (normHex(source.CHIT_CHECKPOINT_ADDRESS) !== normHex(MAINNET_CHECKPOINT)) throw bootError();
  assertLivePin(pin);
  if (flags.issuance && (!flags.store || !flags.mainnetSealer)) throw bootError();
  return flags;
}
