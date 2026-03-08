import { type Abi } from 'viem';

export const ADDRESSES = {
  splitter: (import.meta.env.VITE_SPLITTER_ADDRESS || '') as `0x${string}`,
  verifier: (import.meta.env.VITE_VERIFIER_ADDRESS || '') as `0x${string}`,
  governance: (import.meta.env.VITE_GOVERNANCE_ADDRESS || '') as `0x${string}`,
  thetaInference: (import.meta.env.VITE_THETA_INFERENCE_ADDRESS || '') as `0x${string}`,
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
