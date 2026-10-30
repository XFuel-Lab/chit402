/**
 * Synthetic §S1 line used by the vectors. Not a payment and not a signature.
 * chainId 8453 is the §S5 slot-key example. Addresses are repeated bytes.
 */

export const SAMPLE_CHAIN_ID = 8453;

export const SAMPLE = Object.freeze({
  payment: Object.freeze({
    chainId: SAMPLE_CHAIN_ID,
    blockHash: 'ab'.repeat(32),
    blockNumber: 12345678,
    blockTime: 1700000000,
    txIndex: 7,
    localLogIndex: 4,
    txHash: 'cd'.repeat(32),
    token: '22'.repeat(20),
    from: '33'.repeat(20),
    to: '11'.repeat(20),
    value: '1000000',
    method: 1,
    authorizer: '3a'.repeat(20),
    nonce: '44'.repeat(32),
    saltP: '55'.repeat(32),
  }),
  content: Object.freeze({
    uuid: '66'.repeat(16),
    sellerIdHash: '77'.repeat(32),
    sellerKeyId: '88'.repeat(32),
    requestMethod: 2,
    uriDigest: '99'.repeat(32),
    uriPrefix: 'https://example.test/v1',
    contentDigest: 'aa'.repeat(32),
    responseDigest: 'bb'.repeat(32),
    saltC: 'cc'.repeat(32),
  }),
  sigma: Object.freeze({
    alg: 1,
    sigma: `${'00'.repeat(31)}01${'00'.repeat(31)}01`,
  }),
});
