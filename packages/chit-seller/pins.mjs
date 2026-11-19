/**
 * Contract pins and the Base Sepolia RPC list that ship with this package.
 * A caller cannot replace the contract. Token and payee are fixed per seller
 * at construction, not taken from the authorization.
 *
 * TEST ONLY. The aa… and bb… addresses are placeholders, not ChitAnchor
 * addresses. productionPinList() refuses them. Replace them before any release.
 *
 * Chain 84532 bundles three RPCs. A signature needs two distinct readers to agree.
 */

const PLACEHOLDER_AA = 'aa'.repeat(20);
const PLACEHOLDER_BB = 'bb'.repeat(20);

let testPinsOn = false;

/** Tests opt in. Production signing leaves this off, so placeholder pins are refused. */
export function setTestPinSigning(on) {
  testPinsOn = on === true;
}

export function testPinSigning() {
  return testPinsOn;
}

export function isPlaceholderAddress(address) {
  const hex = String(address ?? '').toLowerCase().replace(/^0x/, '');
  return hex === PLACEHOLDER_AA || hex === PLACEHOLDER_BB;
}

export const PINNED_CONTRACTS = Object.freeze([
  Object.freeze({
    chainId: 84532,
    address: PLACEHOLDER_AA,
    genesisHourStart: 1800000000,
    retireHour: 1800036000,
    testOnly: true,
  }),
  Object.freeze({
    chainId: 84532,
    address: PLACEHOLDER_BB,
    genesisHourStart: 1800036000,
    testOnly: true,
  }),
  // Cross-chain fixture. 84532 is already pinned for this hour, so a second
  // 84532 pin would be ambiguous. Sepolia, not Base mainnet.
  Object.freeze({
    chainId: 11155111,
    address: PLACEHOLDER_AA,
    genesisHourStart: 1800000000,
    retireHour: 1800036000,
    testOnly: true,
  }),
]);

/** Production refuses the placeholder pins. Null until real addresses are pinned. */
export function productionPinList() {
  const real = PINNED_CONTRACTS.filter((pin) => pin.testOnly !== true && !isPlaceholderAddress(pin.address));
  if (real.length === 0 || real.length !== PINNED_CONTRACTS.length) return null;
  return real;
}

export const BUNDLED_RPC_URLS = Object.freeze({
  84532: Object.freeze([
    'https://sepolia.base.org',
    'https://base-sepolia-rpc.publicnode.com',
    'https://base-sepolia.drpc.org',
  ]),
});

export const MIN_READERS_84532 = 3;
export const READER_QUORUM = 2;
