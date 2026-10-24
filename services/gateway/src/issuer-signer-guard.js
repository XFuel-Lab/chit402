/**
 * Input rule shared by every issuer signer (env and KMS).
 *
 * The issuer key signs two kinds of message:
 * - JWS signing inputs (`base64url(header).base64url(payload)`, always `eyJ...`);
 * - EIP-712 preimages `0x19 0x01 || domainSeparator || structHash`, exactly
 *   66 bytes, built only by eip712-p256.js from typed fields.
 *
 * A 0x19 first byte never starts a JWS signing input, so the two message
 * spaces are disjoint by their first byte. This module keeps them apart:
 * - an input that starts with 0x19 is refused unless the call carries the
 *   typed-preimage capability;
 * - a call that carries the capability must pass exactly 66 bytes starting
 *   0x19 0x01;
 * - the capability is handed out once per process. eip712-p256.js claims it
 *   at import, so no other module can obtain it later.
 *
 * There is no digest (prehash) signing mode, and none may be added.
 */

function coded(message, code) {
  const err = new Error(message);
  err.code = code;
  return err;
}

export const TYPED_PREIMAGE_LENGTH = 66;

const CAPABILITY = Object.freeze(Object.create(null));
let claimed = false;

/**
 * One claim per process. The second call throws.
 * @returns {object}
 */
export function claimTypedPreimageCapability() {
  if (claimed) {
    throw coded('typed preimage capability was already claimed', 'issuer_typed_capability_claimed');
  }
  claimed = true;
  return CAPABILITY;
}

/**
 * @param {Buffer} message
 * @returns {boolean}
 */
export function typedPreimageShapeOk(message) {
  return Buffer.isBuffer(message)
    && message.length === TYPED_PREIMAGE_LENGTH
    && message[0] === 0x19
    && message[1] === 0x01;
}

/**
 * Throws `issuer_sign_refused` when the input breaks the rule above.
 * @param {Buffer} message
 * @param {{ typedPreimage?: unknown } | undefined} opts
 * @returns {'typed' | 'jws'}
 */
export function assertSignerInput(message, opts) {
  const typed = opts ? opts.typedPreimage : undefined;
  if (typed !== undefined && typed !== null) {
    if (typed !== CAPABILITY) {
      throw coded('typed preimage capability is not valid', 'issuer_sign_refused');
    }
    if (!typedPreimageShapeOk(message)) {
      throw coded('typed preimage must be 66 bytes starting 0x1901', 'issuer_sign_refused');
    }
    return 'typed';
  }
  if (message.length > 0 && message[0] === 0x19) {
    throw coded('0x19-prefixed input is signed only through the typed path', 'issuer_sign_refused');
  }
  return 'jws';
}
