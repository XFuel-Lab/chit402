/**
 * Contract pins and the Base Sepolia RPC list that ship with this package.
 * A caller cannot replace the contract. Token and payee are fixed per seller
 * at construction, not taken from the authorization.
 *
 * Chain 84532 bundles three RPCs. A signature needs two of them to agree.
 */

export const PINNED_CONTRACTS = Object.freeze([
  Object.freeze({
    chainId: 84532,
    address: 'aa'.repeat(20),
    genesisHourStart: 1800000000,
    retireHour: 1800036000,
  }),
  Object.freeze({
    chainId: 84532,
    address: 'bb'.repeat(20),
    genesisHourStart: 1800036000,
  }),
]);

export const BUNDLED_RPC_URLS = Object.freeze({
  84532: Object.freeze([
    'https://sepolia.base.org',
    'https://base-sepolia-rpc.publicnode.com',
    'https://base-sepolia.drpc.org',
  ]),
});

export const MIN_READERS_84532 = 3;
export const READER_QUORUM = 2;
