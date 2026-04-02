import { type Abi } from 'viem';

export const ADDRESSES = {
  splitter: (import.meta.env.VITE_SPLITTER_ADDRESS || '') as `0x${string}`,
  verifier: (import.meta.env.VITE_VERIFIER_ADDRESS || '') as `0x${string}`,
  governance: (import.meta.env.VITE_GOVERNANCE_ADDRESS || '') as `0x${string}`,
  thetaInference: (import.meta.env.VITE_THETA_INFERENCE_ADDRESS || '') as `0x${string}`,
  believerRound: (import.meta.env.VITE_BELIEVER_ROUND_ADDRESS || '') as `0x${string}`,
  angelRound: (import.meta.env.VITE_ANGEL_ROUND_ADDRESS || '') as `0x${string}`,
  angelEscrow: (import.meta.env.VITE_ANGEL_ESCROW_ADDRESS || '') as `0x${string}`,
};

export function isDeployed(addr: string): addr is `0x${string}` {
  return !!addr && addr !== '0x' && addr.length === 42;
}

export const SPLITTER_ABI = [
  { type: 'function', name: 'totalDeposited', inputs: [], outputs: [{ type: 'uint256' }], stateMutability: 'view' },
  { type: 'function', name: 'totalDistributed', inputs: [], outputs: [{ type: 'uint256' }], stateMutability: 'view' },
  { type: 'function', name: 'distributionCount', inputs: [], outputs: [{ type: 'uint256' }], stateMutability: 'view' },
  { type: 'function', name: 'bbbSplit', inputs: [], outputs: [{ type: 'uint256' }], stateMutability: 'view' },
  { type: 'function', name: 'getSplits', inputs: [], outputs: [{ type: 'uint256' }, { type: 'uint256' }, { type: 'uint256' }, { type: 'uint256' }], stateMutability: 'view' },
  { type: 'function', name: 'depositFee', inputs: [{ type: 'bytes32', name: 'circuitId' }], outputs: [], stateMutability: 'payable' },
  { type: 'function', name: 'distribute', inputs: [], outputs: [], stateMutability: 'nonpayable' },
] as const satisfies Abi;

export const VERIFIER_ABI = [
  { type: 'function', name: 'getExtendedStats', inputs: [], outputs: [{ type: 'uint256' }, { type: 'uint256' }, { type: 'uint256' }, { type: 'uint256' }, { type: 'uint256' }, { type: 'uint256' }], stateMutability: 'view' },
  { type: 'function', name: 'getRollupStats', inputs: [], outputs: [{ type: 'uint256' }, { type: 'uint256' }, { type: 'uint256' }], stateMutability: 'view' },
  { type: 'function', name: 'circuitCount', inputs: [], outputs: [{ type: 'uint256' }], stateMutability: 'view' },
] as const satisfies Abi;

export const GOVERNANCE_ABI = [
  { type: 'function', name: 'totalLocked', inputs: [], outputs: [{ type: 'uint256' }], stateMutability: 'view' },
  { type: 'function', name: 'proposalCount', inputs: [], outputs: [{ type: 'uint256' }], stateMutability: 'view' },
  { type: 'function', name: 'locks', inputs: [{ type: 'address' }], outputs: [{ type: 'uint256', name: 'amount' }, { type: 'uint256', name: 'unlockTime' }, { type: 'uint256', name: 'veXFBalance' }], stateMutability: 'view' },
  { type: 'function', name: 'lock', inputs: [{ type: 'uint256', name: 'amount' }, { type: 'uint256', name: 'duration' }], outputs: [], stateMutability: 'nonpayable' },
  { type: 'function', name: 'unlock', inputs: [], outputs: [], stateMutability: 'nonpayable' },
  { type: 'function', name: 'proposals', inputs: [{ type: 'uint256' }], outputs: [{ type: 'address', name: 'proposer' }, { type: 'string', name: 'description' }, { type: 'uint256', name: 'forVotes' }, { type: 'uint256', name: 'againstVotes' }, { type: 'uint256', name: 'endTime' }, { type: 'bool', name: 'executed' }], stateMutability: 'view' },
  { type: 'function', name: 'vote', inputs: [{ type: 'uint256', name: 'proposalId' }, { type: 'bool', name: 'support' }], outputs: [], stateMutability: 'nonpayable' },
  { type: 'function', name: 'createProposal', inputs: [{ type: 'string', name: 'description' }, { type: 'address[]', name: 'targets' }, { type: 'bytes[]', name: 'calldatas' }], outputs: [], stateMutability: 'nonpayable' },
] as const satisfies Abi;

export const THETA_INFERENCE_ABI = [
  { type: 'function', name: 'serviceCount', inputs: [], outputs: [{ type: 'uint256' }], stateMutability: 'view' },
  { type: 'function', name: 'intentCount', inputs: [], outputs: [{ type: 'uint256' }], stateMutability: 'view' },
  { type: 'function', name: 'settledCount', inputs: [], outputs: [{ type: 'uint256' }], stateMutability: 'view' },
] as const satisfies Abi;

export const THETA_MAINNET_ID = 361;
export const THETA_TESTNET_ID = 365;
export const BITTENSOR_ID = 964;

/** BelieverRound.sol — commit / commitWithLock / views */
export const BELIEVER_ROUND_ABI = [
  { type: 'function', name: 'commit', inputs: [], outputs: [], stateMutability: 'payable' },
  {
    type: 'function',
    name: 'commitWithLock',
    inputs: [{ name: 'lockTier', type: 'uint8' }],
    outputs: [],
    stateMutability: 'payable',
  },
  {
    type: 'function',
    name: 'getStats',
    inputs: [],
    outputs: [
      { name: 'committed_', type: 'uint256' },
      { name: 'believers_', type: 'uint256' },
      { name: 'allocated_', type: 'uint256' },
      { name: 'claimed_', type: 'uint256' },
      { name: 'hardCap_', type: 'uint256' },
      { name: 'status_', type: 'uint8' },
      { name: 'phase_', type: 'uint8' },
    ],
    stateMutability: 'view',
  },
  { type: 'function', name: 'totalXFReserved', inputs: [], outputs: [{ type: 'uint256' }], stateMutability: 'view' },
  { type: 'function', name: 'minCommitment', inputs: [], outputs: [{ type: 'uint256' }], stateMutability: 'view' },
  { type: 'function', name: 'xfAllocationCap', inputs: [], outputs: [{ type: 'uint256' }], stateMutability: 'view' },
  { type: 'function', name: 'tokenPriceNumerator', inputs: [], outputs: [{ type: 'uint256' }], stateMutability: 'view' },
  { type: 'function', name: 'tokenPriceDenominator', inputs: [], outputs: [{ type: 'uint256' }], stateMutability: 'view' },
  { type: 'function', name: 'status', inputs: [], outputs: [{ type: 'uint8' }], stateMutability: 'view' },
  { type: 'function', name: 'roundOpenedAt', inputs: [], outputs: [{ type: 'uint256' }], stateMutability: 'view' },
  {
    type: 'function',
    name: 'commitments',
    inputs: [{ name: 'who', type: 'address' }],
    outputs: [
      { name: 'amount', type: 'uint256' },
      { name: 'tokenAllocation', type: 'uint256' },
      { name: 'tokensClaimed', type: 'uint256' },
      { name: 'committedAt', type: 'uint64' },
      { name: 'lockTier', type: 'uint8' },
      { name: 'refunded', type: 'bool' },
    ],
    stateMutability: 'view',
  },
  { type: 'function', name: 'requestRefund', inputs: [], outputs: [], stateMutability: 'nonpayable' },
] as const satisfies Abi;

/** AngelRound.sol — pre-TGE treasury round; no refunds */
export const ANGEL_ROUND_ABI = [
  { type: 'function', name: 'commit', inputs: [], outputs: [], stateMutability: 'payable' },
  {
    type: 'function',
    name: 'getStats',
    inputs: [],
    outputs: [
      { name: 'committed_', type: 'uint256' },
      { name: 'angels_', type: 'uint256' },
      { name: 'allocated_', type: 'uint256' },
      { name: 'claimed_', type: 'uint256' },
      { name: 'hardCap_', type: 'uint256' },
      { name: 'status_', type: 'uint8' },
      { name: 'phase_', type: 'uint8' },
      { name: 'treasuryWithdrawn_', type: 'uint256' },
      { name: 'xfReserved_', type: 'uint256' },
    ],
    stateMutability: 'view',
  },
  { type: 'function', name: 'minCommitment', inputs: [], outputs: [{ type: 'uint256' }], stateMutability: 'view' },
  { type: 'function', name: 'hardCap', inputs: [], outputs: [{ type: 'uint256' }], stateMutability: 'view' },
  { type: 'function', name: 'tokenPriceNumerator', inputs: [], outputs: [{ type: 'uint256' }], stateMutability: 'view' },
  { type: 'function', name: 'tokenPriceDenominator', inputs: [], outputs: [{ type: 'uint256' }], stateMutability: 'view' },
  { type: 'function', name: 'xfAllocationCap', inputs: [], outputs: [{ type: 'uint256' }], stateMutability: 'view' },
] as const satisfies Abi;

/** AngelEscrow.sol — multisig escrow admin */
export const ANGEL_ESCROW_ABI = [
  { type: 'function', name: 'deposit', inputs: [], outputs: [], stateMutability: 'payable' },
  { type: 'function', name: 'getBalance', inputs: [], outputs: [{ type: 'uint256' }], stateMutability: 'view' },
  { type: 'function', name: 'totalRaised', inputs: [], outputs: [{ type: 'uint256' }], stateMutability: 'view' },
  { type: 'function', name: 'threshold', inputs: [], outputs: [{ type: 'uint256' }], stateMutability: 'view' },
  { type: 'function', name: 'treasury', inputs: [], outputs: [{ type: 'address' }], stateMutability: 'view' },
  { type: 'function', name: 'signerCount', inputs: [], outputs: [{ type: 'uint256' }], stateMutability: 'view' },
  { type: 'function', name: 'signers', inputs: [{ type: 'uint256' }], outputs: [{ type: 'address' }], stateMutability: 'view' },
  { type: 'function', name: 'bucketCaps', inputs: [{ type: 'uint256' }], outputs: [{ type: 'uint256' }], stateMutability: 'view' },
  { type: 'function', name: 'releasedFromBucket', inputs: [{ type: 'uint8' }], outputs: [{ type: 'uint256' }], stateMutability: 'view' },
  { type: 'function', name: 'outstandingObligations', inputs: [], outputs: [{ type: 'uint256' }], stateMutability: 'view' },
  { type: 'function', name: 'VERSION', inputs: [], outputs: [{ type: 'string' }], stateMutability: 'view' },
  { type: 'function', name: 'paused', inputs: [], outputs: [{ type: 'bool' }], stateMutability: 'view' },
  { type: 'function', name: 'releaseFromBucket', inputs: [{ name: 'bucket', type: 'uint8' }, { name: 'recipient', type: 'address' }, { name: 'amount', type: 'uint256' }], outputs: [{ type: 'bool' }], stateMutability: 'nonpayable' },
  { type: 'function', name: 'setBucketCap', inputs: [{ name: 'bucket', type: 'uint8' }, { name: 'newCap', type: 'uint256' }], outputs: [{ type: 'bool' }], stateMutability: 'nonpayable' },
  { type: 'function', name: 'refundExcessToTreasury', inputs: [], outputs: [{ type: 'bool' }], stateMutability: 'nonpayable' },
  { type: 'function', name: 'pause', inputs: [], outputs: [{ type: 'bool' }], stateMutability: 'nonpayable' },
  { type: 'function', name: 'unpause', inputs: [], outputs: [{ type: 'bool' }], stateMutability: 'nonpayable' },
  { type: 'event', name: 'DepositReceived', inputs: [{ name: 'sender', type: 'address', indexed: true }, { name: 'amount', type: 'uint256' }, { name: 'newBalance', type: 'uint256' }, { name: 'totalRaised', type: 'uint256' }] },
  { type: 'event', name: 'BucketReleased', inputs: [{ name: 'bucket', type: 'uint8', indexed: true }, { name: 'recipient', type: 'address', indexed: true }, { name: 'amount', type: 'uint256' }] },
  { type: 'event', name: 'ActionApproved', inputs: [{ name: 'actionHash', type: 'bytes32', indexed: true }, { name: 'signer', type: 'address', indexed: true }, { name: 'approvalCount', type: 'uint256' }] },
] as const satisfies Abi;
