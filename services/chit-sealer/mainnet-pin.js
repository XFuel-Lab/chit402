/**
 * Live Base mainnet ChitAnchor pin. Values are constants. They are never
 * read from a request body. The operator pin file uses a fixture
 * genesisHourStart. The production issuer-history snapshot is not updated
 * here, and genesisHourStart stays unset there until the first mainnet anchor.
 */

export const MAINNET_CHAIN_ID = 8453;

export const MAINNET_ANCHOR = '0xC16010f028A00A3addb37609c38D010ec1dF93b1';

export const MAINNET_CODE_HASH = '0xbaad531853ab89c65eeddee489d0290f41a623f785ded9855e80aefee9fb087f';

export const MAINNET_CHECKPOINT = '0x7a8D6426e1057535A5442Ba526eC9f317a9d9026';

export const MAINNET_CONTROLLER = '0x1860E5fe0637eff7e09Ed2a1198450019b2038f0';

export const MAINNET_USDC = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913';

export const MAINNET_DOMAIN = '0x20f93e4243618b814c019ba52bbe3412019a48a22a9a21180ac5155af06ca3cd';

export const MAINNET_DEPLOYER = '0x2d051Fd6f21B521b846cFaF35c1A69E76De907a3';

export const MAINNET_DEPLOY_NONCE = 0;

const ZERO = `0x${'0'.repeat(40)}`;

export function normHex(value) {
  return String(value || '').trim().toLowerCase();
}

export function mainnetPin() {
  return {
    chainId: MAINNET_CHAIN_ID,
    address: MAINNET_ANCHOR,
    codeHash: MAINNET_CODE_HASH,
    predecessor: ZERO,
    checkpoint: MAINNET_CHECKPOINT,
    controller: MAINNET_CONTROLLER,
    usdc: MAINNET_USDC,
    domain: MAINNET_DOMAIN,
    deployer: MAINNET_DEPLOYER,
    nonce: MAINNET_DEPLOY_NONCE,
  };
}

function pinError() {
  const err = new Error('v13 pin refused');
  err.code = 'v13_pin_refused';
  return err;
}

/**
 * Refuse any pin that is not the live mainnet row. A Sepolia chain id,
 * a different address, or a different code hash is a refusal.
 * @param {object} pin
 */
export function assertLivePin(pin) {
  if (!pin || typeof pin !== 'object') throw pinError();
  if (Number(pin.chainId) !== 8453) throw pinError();
  if (normHex(pin.address) !== normHex(MAINNET_ANCHOR)) throw pinError();
  if (normHex(pin.codeHash) !== normHex(MAINNET_CODE_HASH)) throw pinError();
  if (normHex(pin.checkpoint) !== normHex(MAINNET_CHECKPOINT)) throw pinError();
  return mainnetPin();
}
