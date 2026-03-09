/**
 * XFuel Protocol — Typed contract helpers for Phase 6 protocol contracts.
 *
 * Usage:
 *   import { getCoreRevenueSplitter, getZKVerifierSP1 } from '@/utils/protocolContracts'
 *   const splitter = getCoreRevenueSplitter(provider)
 *   const stats = await splitter.getStats()
 *
 * Addresses are loaded from VITE_* environment variables (see src/config/thetaConfig.ts).
 * Returns null when the contract address is not configured — callers should handle this
 * gracefully (show a "not yet deployed" state rather than crashing).
 */
import { ethers } from 'ethers'
import { PROTOCOL_CONTRACTS } from '@/config/thetaConfig'

// ─── ABIs ───────────────────────────────────────────────────────────────────

export const CORE_REVENUE_SPLITTER_ABI = [
  // Read
  'function getStats() external view returns (uint256 collected, uint256 distributed, uint256 distributionCount, bool isPaused)',
  'function getSplit() external view returns (uint256 bbb, uint256 get_, uint256 staker, uint256 treasury)',
  'function pendingBalance() external view returns (uint256)',
  'function feeToStakeBps() external view returns (uint256)',
  'function getStakeRouteCount() external view returns (uint256)',
  'function getStakeRoute(uint256 index) external view returns (address pool, uint32 chainId, string memory label, uint256 weightBps, bool active)',
  'function grantPoolBalance() external view returns (uint256)',
  // Write
  'function depositFee(bytes32 circuitId) external payable',
  'function distribute() external',
  // Events
  'event FeeDeposited(address indexed from, bytes32 indexed circuitId, uint256 amount)',
  'event Distributed(uint256 bbbAmount, uint256 getAmount, uint256 stakerAmount, uint256 treasuryAmount)',
  'event StakeRouted(address indexed pool, uint32 indexed chainId, uint256 amount)',
]

export const ZK_VERIFIER_SP1_ABI = [
  // Read
  'function getStats() external view returns (uint256 verified, uint256 failed, uint256 totalComposedCalls, bool isMock, uint256 circuitCount)',
  'function getExtendedStats() external view returns (uint256 verified, uint256 failed, uint256 totalComposedCalls, bool isMock, uint256 circuitCount, uint256 totalRelayed)',
  'function isNullifierUsed(bytes32 nullifier) external view returns (bool)',
  // Write
  'function verifyProof(bytes32 circuitId, bytes32 programVKey, bytes calldata publicValues, bytes calldata proofBytes, bytes32 nullifier) external returns (bool)',
  // Events
  'event ProofVerified(address indexed prover, bytes32 indexed circuitId, bytes32 nullifier)',
  'event ProofFailed(address indexed prover, bytes32 indexed circuitId)',
]

export const THETA_INFERENCE_CIRCUIT_ABI = [
  // Read
  'function getStats() external view returns (uint256 totalIntents, uint256 settledIntents, uint256 totalFees, uint256 totalRevenue)',
  'function getIntent(bytes32 intentId) external view returns (address user, bytes32 serviceId, uint256 netPayment, uint8 status, uint256 createdAt)',
  // Write (user-facing)
  'function submitIntent(bytes32 serviceId, bytes32 inputHash) external payable returns (bytes32 intentId)',
  // Write (relayer)
  'function completeIntent(bytes32 intentId, bytes32 outputHash, bytes32 modelHash, uint256 latencyMs) external',
  'function settleIntent(bytes32 intentId, bytes calldata proof, bytes calldata publicValues, bytes32 nullifier) external',
  // Events
  'event InferenceIntentSubmitted(bytes32 indexed intentId, address indexed user, bytes32 serviceId, uint256 payment)',
  'event IntentSettled(bytes32 indexed intentId, address indexed user, bytes32 outputHash)',
]

export const A2A_CIRCUIT_ABI = [
  // Read
  'function getAgentInfo(address agent) external view returns (uint256 reputation, uint256 stake, bool active)',
  'function priorityRouting(address agent) external view returns (bool)',
  // Write
  'function registerAgent(uint256 stakeAmount) external',
  'function updateReputation(address agent, uint256 newRep) external',
  // Events
  'event AgentRegistered(address indexed agent, uint256 stake)',
  'event ReputationUpdated(address indexed agent, uint256 oldRep, uint256 newRep)',
]

// ─── Contract Getters ───────────────────────────────────────────────────────

type ProviderOrSigner = ethers.Provider | ethers.Signer

function getContract<T extends ethers.Contract>(
  address: string,
  abi: string[],
  providerOrSigner: ProviderOrSigner
): T | null {
  if (!address) return null
  try {
    return new ethers.Contract(address, abi, providerOrSigner) as T
  } catch {
    return null
  }
}

export const getCoreRevenueSplitter = (p: ProviderOrSigner) =>
  getContract(PROTOCOL_CONTRACTS.CoreRevenueSplitter, CORE_REVENUE_SPLITTER_ABI, p)

export const getZKVerifierSP1 = (p: ProviderOrSigner) =>
  getContract(PROTOCOL_CONTRACTS.ZKVerifierSP1, ZK_VERIFIER_SP1_ABI, p)

export const getThetaInferenceCircuit = (p: ProviderOrSigner) =>
  getContract(PROTOCOL_CONTRACTS.ThetaInferenceCircuit, THETA_INFERENCE_CIRCUIT_ABI, p)

export const getA2ACircuit = (p: ProviderOrSigner) =>
  getContract(PROTOCOL_CONTRACTS.A2ACircuit, A2A_CIRCUIT_ABI, p)

// ─── Live Stats Fetchers ────────────────────────────────────────────────────

export interface SplitterStats {
  collected: bigint
  distributed: bigint
  distributionCount: bigint
  isPaused: boolean
  pendingBalance: bigint
  split: { bbb: bigint; get_: bigint; staker: bigint; treasury: bigint }
}

export async function fetchSplitterStats(provider: ethers.Provider): Promise<SplitterStats | null> {
  const contract = getCoreRevenueSplitter(provider)
  if (!contract) return null
  try {
    const [stats, split, pending] = await Promise.all([
      contract['getStats'](),
      contract['getSplit'](),
      contract['pendingBalance'](),
    ])
    return {
      collected: stats.collected,
      distributed: stats.distributed,
      distributionCount: stats.distributionCount,
      isPaused: stats.isPaused,
      pendingBalance: pending,
      split: { bbb: split.bbb, get_: split.get_, staker: split.staker, treasury: split.treasury },
    }
  } catch {
    return null
  }
}

export interface ZKVerifierStats {
  verified: bigint
  failed: bigint
  totalComposedCalls: bigint
  isMock: boolean
  circuitCount: bigint
}

export async function fetchZKVerifierStats(provider: ethers.Provider): Promise<ZKVerifierStats | null> {
  const contract = getZKVerifierSP1(provider)
  if (!contract) return null
  try {
    const stats = await contract['getStats']()
    return {
      verified: stats.verified,
      failed: stats.failed,
      totalComposedCalls: stats.totalComposedCalls,
      isMock: stats.isMock,
      circuitCount: stats.circuitCount,
    }
  } catch {
    return null
  }
}

export interface InferenceStats {
  totalIntents: bigint
  settledIntents: bigint
  totalFees: bigint
  totalRevenue: bigint
}

export async function fetchInferenceStats(provider: ethers.Provider): Promise<InferenceStats | null> {
  const contract = getThetaInferenceCircuit(provider)
  if (!contract) return null
  try {
    const stats = await contract['getStats']()
    return {
      totalIntents: stats.totalIntents,
      settledIntents: stats.settledIntents,
      totalFees: stats.totalFees,
      totalRevenue: stats.totalRevenue,
    }
  } catch {
    return null
  }
}
