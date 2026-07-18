/**
 * XFuel SDK — On-chain module.
 *
 * Read helpers + calldata builders for XFuel's core contracts. Aligned to the
 * ACTUAL contract signatures (verified against contracts/core and
 * contracts/circuits), not the aspirational AGENTS.md summaries.
 *
 * Secrets policy: this module defaults to READS + CALLDATA building. It does not
 * require a private key. Signing is performed server-side by the relayer (or you
 * submit the returned calldata out-of-band). `connect(signer)` is provided for
 * advanced callers who explicitly manage their own signer.
 *
 * Requires `ethers` v6 as a peer dependency (only if you import this module):
 *   npm install ethers
 *
 * Import:
 *   import { XFuelOnChain } from 'xfuel-sdk/onchain';
 */
import {
  Contract,
  Interface,
  JsonRpcProvider,
  hexlify,
  randomBytes,
  keccak256,
  toUtf8Bytes,
  solidityPacked,
  concat,
  getBytes,
  computeHmac,
  type Provider,
  type Signer,
} from 'ethers';
import { createSignerPayer, type X402Payer, type X402Accept } from './x402.js';
import type { PaymentBinding, ProofResponse } from './index.js';

// ─── Verified ABI fragments ───────────────────────────────────────────────────

export const ZK_VERIFIER_ABI = [
  'function usedNullifiers(bytes32) view returns (bool)',
  'function verifyProof(bytes32 circuitId, bytes publicValues, bytes proofBytes, bytes32 nullifier) returns (bool)',
  'function relayProofCrossChain(bytes32 circuitId, bytes publicValues, bytes proofBytes, bytes32 nullifier, uint32 destDomain) payable returns (bytes32)',
  'function verifyWithStakeCheck(bytes32 circuitId, bytes publicValues, bytes proofBytes, bytes32 nullifier, bytes32 hotkey, uint16 netuid) returns (bool)',
] as const;

export const A2A_CIRCUIT_ABI = [
  'function registerAgent(bytes32 identityCommitment, string endpoint, bytes32[] capabilities)',
  'function submitBid(bytes32 taskHash, bytes32 capabilityRequired, uint64 deadline) payable returns (bytes32)',
  'function acceptBid(bytes32 bidId, uint256 price)',
  'function settleBid(bytes32 bidId, bytes32 resultHash, bytes proof, bytes publicValues, bytes32 nullifier)',
  'function settleBidFairExchange(bytes32 bidId, bytes32 resultHash, uint8 v, bytes32 r, bytes32 s)',
  'function formSwarm(bytes32 objectiveHash, uint16 maxMembers) payable returns (bytes32)',
  'function joinSwarm(bytes32 swarmId)',
  'function settleSwarmAgent(bytes32 swarmId, address agent, uint256 amount, bytes proof, bytes publicValues, bytes32 nullifier)',
  'function dissolveSwarm(bytes32 swarmId)',
  'function forceDissolveSwarm(bytes32 swarmId)',
  // Reads
  'function swarms(bytes32) view returns (bytes32 swarmId, address coordinator, bytes32 objectiveHash, uint256 escrowPool, uint256 settledAmount, uint16 memberCount, uint16 maxMembers, uint8 phase, uint64 formedAt, uint64 settledAt, bytes32 settlementNullifier)',
  'function swarmMembers(bytes32, address) view returns (bool)',
  'function MAX_SWARM_SIZE() view returns (uint16)',
  'function swarmFeeBps() view returns (uint16)',
] as const;

/** A2ACircuit SwarmPhase enum, indexed by the on-chain uint8 value. */
export const SWARM_PHASES = ['Forming', 'Active', 'Settling', 'Dissolved'] as const;
export type SwarmPhase = (typeof SWARM_PHASES)[number];

/** Decoded on-chain swarm state (from the `swarms` mapping). */
export interface SwarmInfo {
  swarmId: string;
  coordinator: string;
  objectiveHash: string;
  escrowPool: bigint;
  settledAmount: bigint;
  memberCount: number;
  maxMembers: number;
  phase: SwarmPhase;
  phaseIndex: number;
  formedAt: number;
  settledAt: number;
  settlementNullifier: string;
  /** Escrow still available to settle/refund (escrowPool − settledAmount). */
  remainingEscrow: bigint;
  /** True once the swarm has no coordinator (i.e. never formed). */
  exists: boolean;
}

export const MODEL_REGISTRY_ABI = [
  'function registerModel(bytes32 modelId, bytes32 commitment, uint8 scheme, string arch, string quant, string metadataURI) returns (uint256)',
  'function retireVersion(bytes32 modelId, uint256 version)',
  'function latestVersion(bytes32 modelId) view returns (uint256)',
  'function versionCount(bytes32 modelId) view returns (uint256)',
  'function getModel(bytes32 modelId, uint256 version) view returns (tuple(bytes32 commitment, uint8 scheme, string arch, string quant, string metadataURI, uint64 registeredAt, address registrar))',
  'function getLatestModel(bytes32 modelId) view returns (tuple(bytes32 commitment, uint8 scheme, string arch, string quant, string metadataURI, uint64 registeredAt, address registrar))',
  'function isActive(bytes32 modelId, uint256 version) view returns (bool)',
  'function verifyCommitment(bytes32 modelId, uint256 version, bytes32 commitment) view returns (bool)',
  'function lookupCommitment(bytes32 commitment) view returns (bytes32 modelId, uint256 version)',
] as const;

/** PoMA commitment scheme, indexed by the on-chain uint8 value. */
export const COMMITMENT_SCHEMES = ['KECCAK_MERKLE', 'MLE_POLY'] as const;
export type CommitmentScheme = (typeof COMMITMENT_SCHEMES)[number];

/** Decoded on-chain model version (from ModelRegistry). */
export interface ModelInfo {
  commitment: string;
  scheme: number;
  schemeName: CommitmentScheme;
  arch: string;
  quant: string;
  metadataURI: string;
  registeredAt: number;
  registrar: string;
}

export const VE_GOVERNANCE_ABI = [
  'function lock(uint256 amount, uint256 unlockTime)',
  'function createProposal(uint8 pType, bytes32 targetCircuit, string description, bytes executionData) returns (uint256)',
  'function vote(uint256 proposalId, bool support)',
  'function votingPower(address) view returns (uint256)',
] as const;

/** A built transaction request ready to sign/submit out-of-band. */
export interface CallData {
  to: string;
  data: string;
  value?: string;
}

export interface XFuelOnChainOptions {
  /** RPC URL (e.g. a ZAN Theta endpoint). Used if `provider` is not supplied. */
  rpcUrl?: string;
  /** A pre-built ethers Provider. Takes precedence over `rpcUrl`. */
  provider?: Provider;
  zkVerifierAddress?: string;
  a2aCircuitAddress?: string;
  veGovernanceAddress?: string;
  modelRegistryAddress?: string;
  /** ERC-8004 Validation Registry (reads: status/summary/agent validations). */
  erc8004RegistryAddress?: string;
  /** XFuelValidationAdapter (reads: provenance; encode: submitValidation). */
  xfuelValidationAdapterAddress?: string;
  /** ProviderStaking (reads: stake/slash; encode: stake/unstake/withdraw). */
  providerStakingAddress?: string;
}

/** ERC-8004 Validation Registry (pinned; see contracts/interfaces/IERC8004ValidationRegistry.sol). */
export const ERC8004_VALIDATION_REGISTRY_ABI = [
  'function validationResponse(bytes32 requestHash, uint8 response, string responseURI, bytes32 responseHash, string tag) external',
  'function getValidationStatus(bytes32 requestHash) view returns (address validatorAddress, uint256 agentId, uint8 response, bytes32 responseHash, string tag, uint256 lastUpdate)',
  'function getSummary(uint256 agentId, address[] validatorAddresses, string tag) view returns (uint64 count, uint8 averageResponse)',
  'function getAgentValidations(uint256 agentId) view returns (bytes32[] requestHashes)',
  'function getValidatorRequests(address validatorAddress) view returns (bytes32[] requestHashes)',
] as const;

/** XFuelValidationAdapter (contracts/core/XFuelValidationAdapter.sol). */
export const XFUEL_VALIDATION_ADAPTER_ABI = [
  'function submitValidation(bytes32 requestHash, uint256 agentId, uint8 response, string responseURI, bytes32 responseHash, string tag, bytes32 taskIdHash) external',
  'function provenanceOf(bytes32 requestHash) view returns (bytes32 taskIdHash, bool isAnswered)',
  'function validatorAddress() view returns (address)',
] as const;

/** ProviderStaking (contracts/core/ProviderStaking.sol) — Phase 4 T3b economics. */
export const PROVIDER_STAKING_ABI = [
  'function stake(uint256 amount) external',
  'function requestUnstake(uint256 amount) external',
  'function withdraw() external',
  'function stakeOf(address provider) view returns (uint256)',
  'function pendingOf(address provider) view returns (uint256 amount, uint256 unlockAt)',
  'function isActiveProvider(address provider) view returns (bool)',
  'function slashCount(address provider) view returns (uint256)',
  'function minStake() view returns (uint256)',
  'function totalActiveStake() view returns (uint256)',
] as const;

const iZk = new Interface(ZK_VERIFIER_ABI as unknown as string[]);
const iA2A = new Interface(A2A_CIRCUIT_ABI as unknown as string[]);
const iGov = new Interface(VE_GOVERNANCE_ABI as unknown as string[]);
const iModel = new Interface(MODEL_REGISTRY_ABI as unknown as string[]);
const iErc8004 = new Interface(ERC8004_VALIDATION_REGISTRY_ABI as unknown as string[]);
const iAdapter = new Interface(XFUEL_VALIDATION_ADAPTER_ABI as unknown as string[]);
const iStaking = new Interface(PROVIDER_STAKING_ABI as unknown as string[]);

// ─── PoMA — Proof of Model Authenticity helpers ────────────────────────────────
//
// Pure, provider-free helpers mirroring services/gateway/src/model-commitment.js and
// contracts/core/ModelRegistry.sol so an agent can independently compute a model
// commitment and check it against the on-chain registry (anti-downgrade). See
// docs/POMA_SPEC.md for the scheme.

const _LEAF_PREFIX = '0x00';
const _NODE_PREFIX = '0x01';

/** Canonical model slug → stable modelId (keccak256 of the lowercased slug). */
export function modelIdFromSlug(slug: string): string {
  return keccak256(toUtf8Bytes(String(slug).trim().toLowerCase()));
}

/** Domain-separated keccak leaf for a shard buffer. */
export function shardLeaf(buffer: Uint8Array | string): string {
  const bytes = typeof buffer === 'string' ? getBytes(buffer) : buffer;
  return keccak256(concat([_LEAF_PREFIX, bytes]));
}

/** KECCAK_MERKLE root over ordered leaves (odd tail promoted). Matches PoMA scheme id 0. */
export function keccakMerkleRoot(leaves: string[]): string {
  if (!leaves || leaves.length === 0) return '0x' + '0'.repeat(64);
  let level = leaves.slice();
  while (level.length > 1) {
    const next: string[] = [];
    for (let i = 0; i < level.length; i += 2) {
      next.push(i + 1 < level.length ? keccak256(concat([_NODE_PREFIX, level[i], level[i + 1]])) : level[i]);
    }
    level = next;
  }
  return level[0];
}

/**
 * Compute a model commitment from ordered weight shard buffers (KECCAK_MERKLE).
 * @returns `{ modelId, commitment, scheme: 0, shardCount }`
 */
export function computeModelCommitment(params: {
  shards: Array<Uint8Array | string>;
  slug: string;
}): { modelId: string; commitment: string; scheme: number; shardCount: number } {
  if (!params.shards || params.shards.length === 0) {
    throw new Error('computeModelCommitment: at least one shard is required');
  }
  const leaves = params.shards.map(shardLeaf);
  return {
    modelId: modelIdFromSlug(params.slug),
    commitment: keccakMerkleRoot(leaves),
    scheme: 0,
    shardCount: params.shards.length,
  };
}

// ─── PBR — Payment-Bound Receipt helpers ───────────────────────────────────────
//
// Mirror of services/gateway/src/payment-binding.js `computeInferenceBinding` and
// SP1ProofHooks.computeInferenceBindingCommitment. Lets an agent independently re-derive
// the payment-bound commitment (payment + model authenticity + output) on a receipt.

const _ZERO32 = '0x' + '0'.repeat(64);
const _isHex32 = (h?: string) => !!h && /^0x[0-9a-fA-F]{64}$/.test(h);

/**
 * Re-derive the PBR commitment:
 *   keccak256(abi.encodePacked(paymentRefHash, taskIdHash, rail, amount, modelCommitment, outputHash))
 */
export function computeInferenceBinding(params: {
  paymentRef?: string;
  taskId: string;
  rail: string | number;
  amount: string | bigint;
  modelCommitment?: string;
  outputHash?: string;
}): string {
  const rail = typeof params.rail === 'number' ? params.rail : (PAYMENT_RAIL_DISCRIMINANT[params.rail] ?? 0);
  const paymentRefHash = params.paymentRef ? keccak256(toUtf8Bytes(String(params.paymentRef))) : _ZERO32;
  const taskIdHash = keccak256(toUtf8Bytes(String(params.taskId)));
  const model = _isHex32(params.modelCommitment) ? (params.modelCommitment as string) : _ZERO32;
  const output = _isHex32(params.outputHash) ? (params.outputHash as string) : _ZERO32;
  return keccak256(
    solidityPacked(
      ['bytes32', 'bytes32', 'uint8', 'uint256', 'bytes32', 'bytes32'],
      [paymentRefHash, taskIdHash, rail, BigInt(params.amount ?? 0), model, output],
    ),
  );
}

/**
 * Canonical, order-stable payload a receipt signature covers. MUST match
 * `canonicalSignedPayload` in services/gateway/src/receipt.js (same fields + order).
 */
export function canonicalReceiptPayload(receipt: Record<string, unknown>): string {
  const r = receipt as {
    task_id?: string;
    payment?: { rail?: string; ref?: string; net_amount?: string; fee_amount?: string };
    route?: { model?: string; model_commitment?: { commitment?: string } };
    output?: { hash?: string };
    binding?: { expected_commitment?: string };
  };
  return JSON.stringify([
    r.task_id ?? null,
    r.payment?.rail ?? null,
    r.payment?.ref ?? null,
    r.payment?.net_amount ?? null,
    r.payment?.fee_amount ?? null,
    r.route?.model ?? null,
    r.route?.model_commitment?.commitment ?? null,
    r.output?.hash ?? null,
    r.binding?.expected_commitment ?? null,
  ]);
}

// ─── ERC-8004 Validation Registry helpers ───────────────────────────────────────
//
// Mirror of services/gateway/src/erc8004.js `buildValidationRecord`. Turn an XFuel receipt
// into an ERC-8004 verdict (score 0..100 + evidence + tag) an agent can submit or verify.

export interface ValidationVerdict {
  eligible: boolean;
  reason?: string;
  request_hash: string;
  agent_id: string;
  response: number;
  tag: string;
  response_uri: string | null;
  response_hash: string;
  task_id: string | null;
  task_id_hash: string;
  tier: string;
  covers: string[];
  binding_matches: boolean | null;
}

const _REQUEST_HASH_RE = /^0x[0-9a-fA-F]{64}$/;

/**
 * Derive the ERC-8004 verdict for a receipt. Byte-identical to the gateway so an agent can
 * recompute (and cross-check) what XFuel will submit. Score: 0 = failed, 100 = passed; the
 * tag conveys the assurance tier.
 */
export function receiptToValidationVerdict(
  receipt: Record<string, unknown>,
  opts: { requestHash: string; agentId: string | number },
): ValidationVerdict {
  if (!_REQUEST_HASH_RE.test(String(opts.requestHash || ''))) {
    throw new Error('requestHash must be a 0x-prefixed 32-byte hex string');
  }
  const agent = String(opts.agentId ?? '');
  if (!/^\d+$/.test(agent)) throw new Error('agentId must be a non-negative integer');

  const r = receipt as {
    task_id?: string;
    proof_outcome?: string;
    proof?: { tier?: string };
    binding?: { covers?: string[]; matches?: boolean };
    output?: { hash?: string };
    verify_url?: string;
    links?: { self?: string };
  };

  const tier = r.proof?.tier || 'signed';
  const covers = Array.isArray(r.binding?.covers) ? (r.binding!.covers as string[]) : [];
  const bindingMatches = r.binding ? (r.binding.matches ?? null) : null;
  const base = {
    request_hash: opts.requestHash,
    agent_id: agent,
    tier,
    covers,
    binding_matches: bindingMatches,
    task_id: r.task_id || null,
    task_id_hash: r.task_id ? keccak256(toUtf8Bytes(String(r.task_id))) : '0x' + '0'.repeat(64),
    response_uri: r.verify_url || r.links?.self || null,
    response_hash: keccak256(toUtf8Bytes(canonicalReceiptPayload(receipt))),
  };

  const validatable = r.proof_outcome !== 'pending' && !!r.output?.hash;
  if (!validatable) {
    return { ...base, eligible: false, reason: 'task not settled / no delivered output', response: 0, tag: 'xfuel:pending' };
  }
  if (bindingMatches === false) return { ...base, eligible: true, response: 0, tag: 'xfuel:binding-mismatch' };
  if (r.proof_outcome === 'invalid') return { ...base, eligible: true, response: 0, tag: 'xfuel:proof-invalid' };

  const tag = covers.includes('inference') ? `xfuel:${tier}+pbr` : `xfuel:${tier}`;
  return { ...base, eligible: true, response: 100, tag };
}

// ─── Verified Inference — tier selection mirror ─────────────────────────────────
//
// Faithful mirror of services/gateway/src/tier-policy.js so an agent can predict the assurance
// tier BEFORE submitting (and pass `proof_tier` to raise it). Keep in lockstep with the gateway.

export const TIER_ORDER = ['signed', 'settlement', 'inference'] as const;
export type Tier = (typeof TIER_ORDER)[number];
export type Mechanism = 'tee' | 'zk-spotcheck' | 'zk-full';

export interface TierPolicy {
  enabled: boolean;
  tier2Min?: string | bigint;
  tier3Min?: string | bigint;
  defaultMechanism?: Mechanism;
  available?: Partial<Record<'settlement' | Mechanism, boolean>>;
}

export interface TierSelection {
  tier: Tier;
  mechanism: Mechanism | null;
  reason: string;
  floor: Tier;
  requested: Tier | null;
  degraded: boolean;
}

const _tierRank = (t: string) => Math.max(0, TIER_ORDER.indexOf(t as Tier));

export function normalizeRequestedTier(requested?: string | null): { tier: Tier; mechanism: Mechanism | null } | null {
  if (!requested) return null;
  const r = String(requested).toLowerCase().trim();
  if (r === 'signed') return { tier: 'signed', mechanism: null };
  if (r === 'settlement') return { tier: 'settlement', mechanism: null };
  if (r === 'inference') return { tier: 'inference', mechanism: null };
  if (r === 'tee' || r === 't3a') return { tier: 'inference', mechanism: 'tee' };
  if (r === 'zk-spotcheck' || r === 'spotcheck' || r === 't3b') return { tier: 'inference', mechanism: 'zk-spotcheck' };
  if (r === 'zk-full' || r === 'full' || r === 't3c') return { tier: 'inference', mechanism: 'zk-full' };
  return null;
}

function _resolveMechanism(desired: Mechanism | null, available?: TierPolicy['available']): { mechanism: Mechanism | null; degraded: boolean } {
  const avail = available || {};
  const order: Mechanism[] = ['zk-full', 'zk-spotcheck', 'tee'];
  const start = desired ? order.indexOf(desired) : -1;
  const from = start < 0 ? order.length - 1 : start;
  for (let i = from; i < order.length; i++) {
    if (avail[order[i]]) return { mechanism: order[i], degraded: order[i] !== desired };
  }
  return { mechanism: null, degraded: true };
}

/** Predict the assurance tier for a task under a policy. Mirror of the gateway selector. */
export function selectTier(
  task: { amount?: string | bigint; netAmount?: string | bigint; proofTier?: string | null; intent?: { amount?: string | bigint; proofTier?: string | null } },
  policy: TierPolicy,
): TierSelection {
  const p = policy || ({} as TierPolicy);
  const amount = BigInt(task?.intent?.amount ?? task?.amount ?? task?.netAmount ?? 0);
  const requested = normalizeRequestedTier(task?.intent?.proofTier ?? task?.proofTier ?? null);

  if (!p.enabled) {
    const tier: Tier = p.available?.settlement ? 'settlement' : 'signed';
    return { tier, mechanism: null, reason: 'tier engine disabled (legacy)', floor: tier, requested: requested?.tier ?? null, degraded: false };
  }

  const tier2Min = BigInt(p.tier2Min ?? 0);
  const tier3Min = BigInt(p.tier3Min ?? 0);
  let floorTier: Tier = 'signed';
  if (tier3Min > 0n && amount >= tier3Min) floorTier = 'inference';
  else if (tier2Min > 0n && amount >= tier2Min) floorTier = 'settlement';

  let targetTier: Tier = floorTier;
  let targetMechanism: Mechanism | null = floorTier === 'inference' ? (p.defaultMechanism || 'tee') : null;
  if (requested && _tierRank(requested.tier) > _tierRank(targetTier)) {
    targetTier = requested.tier;
    targetMechanism = requested.tier === 'inference' ? (requested.mechanism || p.defaultMechanism || 'tee') : null;
  } else if (requested && requested.tier === 'inference' && targetTier === 'inference' && requested.mechanism) {
    targetMechanism = requested.mechanism;
  }

  let reason = requested && _tierRank(requested.tier) > _tierRank(floorTier) ? 'requested tier above value floor' : 'value-at-risk floor';
  let degraded = false;

  if (targetTier === 'settlement' && !p.available?.settlement) {
    targetTier = 'signed';
    reason = 'settlement unavailable — degraded to signed';
    degraded = true;
  }

  if (targetTier === 'inference') {
    const res = _resolveMechanism(targetMechanism, p.available);
    if (!res.mechanism) {
      targetTier = p.available?.settlement ? 'settlement' : 'signed';
      targetMechanism = null;
      reason = 'no Tier-3 mechanism available — degraded';
      degraded = true;
    } else {
      targetMechanism = res.mechanism;
      if (res.degraded) {
        reason = `mechanism degraded to ${res.mechanism}`;
        degraded = true;
      }
    }
  }

  return { tier: targetTier, mechanism: targetMechanism, reason, floor: floorTier, requested: requested?.tier ?? null, degraded };
}

/** Encode `validationResponse(...)` calldata for the ERC-8004 registry (validator submits directly). */
export function encodeValidationResponse(v: ValidationVerdict): string {
  return iErc8004.encodeFunctionData('validationResponse', [
    v.request_hash, v.response, v.response_uri || '', v.response_hash, v.tag,
  ]);
}

/** Encode `submitValidation(...)` calldata for the XFuelValidationAdapter (SUBMITTER_ROLE). */
export function encodeSubmitValidation(v: ValidationVerdict): string {
  return iAdapter.encodeFunctionData('submitValidation', [
    v.request_hash, v.agent_id, v.response, v.response_uri || '', v.response_hash, v.tag, v.task_id_hash,
  ]);
}

export interface ReceiptSignatureCheck {
  /** Whether a signature was present to check. */
  checked: boolean;
  /** True if the recomputed HMAC matches; null when nothing was checked. */
  valid: boolean | null;
  expected?: string;
  recomputed?: string;
}

/**
 * Verify a receipt's Tier-1 HMAC signature (tamper-evidence over the payment-bound tuple).
 * Requires the shared signing secret (server `RECEIPT_SIGNING_SECRET`).
 */
export function verifyReceiptSignature(
  receipt: Record<string, unknown>,
  secret: string,
): ReceiptSignatureCheck {
  const sig = (receipt as { signature?: { value?: string } }).signature;
  if (!sig?.value) return { checked: false, valid: null };
  const digest = computeHmac('sha256', toUtf8Bytes(secret), toUtf8Bytes(canonicalReceiptPayload(receipt)));
  const recomputed = `sha256=${digest.slice(2)}`; // strip 0x, match "sha256=<hex>"
  return {
    checked: true,
    valid: recomputed.toLowerCase() === String(sig.value).toLowerCase(),
    expected: sig.value,
    recomputed,
  };
}

// ─── Proof verification ───────────────────────────────────────────────────────
//
// Client-side helpers that promote the "prove it" logic from the Agent Playbook
// (Flow 2) into the SDK. `verifyPaymentBinding` re-derives the x402 payment
// commitment; `XFuelOnChain.verifyProof` bundles the structural + binding checks
// and (optionally) an on-chain nullifier read.

/** x402 payment-rail discriminant — byte-for-byte match with the backend + SP1ProofHooks. */
export const PAYMENT_RAIL_DISCRIMINANT: Record<string, number> = { usdc: 1, tfuel: 2 };

/** Result of independently re-deriving an x402 payment-binding commitment. */
export interface PaymentBindingCheck {
  /** Whether a binding was present to check. */
  checked: boolean;
  /** True if the recomputed commitment matches; null when nothing was checked. */
  valid: boolean | null;
  recomputedCommitment?: string;
  expectedCommitment?: string;
  /** When a raw `paymentRef` is supplied: does its hash match the binding's? */
  paymentRefHashMatches?: boolean | null;
}

/**
 * Independently re-derive an x402 payment-binding commitment and compare it to
 * the value the server returned — proving the settlement is cryptographically
 * bound to this exact task. Mirrors `SP1ProofHooks.computePaymentCommitment`:
 *
 *   keccak256(abi.encodePacked(paymentRefHash, taskIdHash, rail, amount))
 *
 * If `paymentRef` is supplied it is hashed and cross-checked against the
 * binding's `payment_ref_hash`; otherwise the binding's own hash is used.
 */
export function verifyPaymentBinding(
  binding: PaymentBinding | null | undefined,
  opts: { paymentRef?: string; taskId: string },
): PaymentBindingCheck {
  if (!binding) return { checked: false, valid: null };

  const rail = PAYMENT_RAIL_DISCRIMINANT[binding.rail] ?? 0;
  const paymentRefHash = opts.paymentRef
    ? keccak256(toUtf8Bytes(String(opts.paymentRef)))
    : binding.payment_ref_hash;
  const taskIdHash = keccak256(toUtf8Bytes(String(opts.taskId)));
  const recomputed = keccak256(
    solidityPacked(
      ['bytes32', 'bytes32', 'uint8', 'uint256'],
      [paymentRefHash, taskIdHash, rail, BigInt(binding.amount ?? 0)],
    ),
  );

  const paymentRefHashMatches = opts.paymentRef
    ? paymentRefHash.toLowerCase() === String(binding.payment_ref_hash).toLowerCase()
    : null;
  const valid =
    recomputed.toLowerCase() === String(binding.commitment).toLowerCase() &&
    paymentRefHashMatches !== false;

  return {
    checked: true,
    valid,
    recomputedCommitment: recomputed,
    expectedCommitment: binding.commitment,
    paymentRefHashMatches,
  };
}

/** Structured result of {@link XFuelOnChain.verifyProof}. */
export interface ProofVerification {
  /** Overall verdict: proof present, outcome valid, and binding (if any) consistent. */
  ok: boolean;
  checks: {
    hasProof: boolean;
    proofOutcomeValid: boolean;
    paymentBinding: PaymentBindingCheck;
    nullifier: { value: string | null; checkedOnChain: boolean; used: boolean | null };
  };
  /** Human-readable reasons for any failed/soft check. */
  reasons: string[];
}

/** Minimal shape verifyProof needs (a `getProof` response, or a compatible subset). */
export type VerifiableProof = Pick<
  ProofResponse,
  'task_id' | 'proof_outcome' | 'sp1_proof' | 'payment_binding'
>;

export class XFuelOnChain {
  readonly provider?: Provider;
  private signer?: Signer;
  readonly zkVerifierAddress?: string;
  readonly a2aCircuitAddress?: string;
  readonly veGovernanceAddress?: string;
  readonly modelRegistryAddress?: string;
  readonly erc8004RegistryAddress?: string;
  readonly xfuelValidationAdapterAddress?: string;
  readonly providerStakingAddress?: string;

  constructor(opts: XFuelOnChainOptions = {}) {
    this.provider = opts.provider ?? (opts.rpcUrl ? new JsonRpcProvider(opts.rpcUrl) : undefined);
    this.zkVerifierAddress = opts.zkVerifierAddress;
    this.a2aCircuitAddress = opts.a2aCircuitAddress;
    this.veGovernanceAddress = opts.veGovernanceAddress;
    this.modelRegistryAddress = opts.modelRegistryAddress;
    this.erc8004RegistryAddress = opts.erc8004RegistryAddress;
    this.xfuelValidationAdapterAddress = opts.xfuelValidationAdapterAddress;
    this.providerStakingAddress = opts.providerStakingAddress;
  }

  /** Attach a signer for advanced callers who manage their own key. */
  connect(signer: Signer): this {
    this.signer = signer;
    return this;
  }

  private requireAddr(addr: string | undefined, name: string): string {
    if (!addr) throw new Error(`${name} address not configured`);
    return addr;
  }

  // ── Reads ────────────────────────────────────────────────────────────────

  /** True if a nullifier has already been spent (replay protection). */
  async isNullifierUsed(nullifier: string): Promise<boolean> {
    if (!this.provider) throw new Error('provider/rpcUrl required for reads');
    const c = new Contract(this.requireAddr(this.zkVerifierAddress, 'zkVerifier'), ZK_VERIFIER_ABI as unknown as string[], this.provider);
    return c.usedNullifiers(nullifier);
  }

  /**
   * Verify a completed task's proof client-side (Agent Playbook Flow 2 as one call):
   *   1. a proof is present and `proof_outcome === 'valid'`;
   *   2. the x402 payment binding (if any) re-derives to the committed value;
   *   3. (optional) the nullifier's on-chain spent state, when `checkNullifier`
   *      is set and a provider + zkVerifier address are configured.
   *
   * The nullifier read is informational (it does not gate `ok`), since the M2M
   * settlement path may record proofs off-chain. `ok` reflects the proof being
   * present + valid and any present binding being consistent.
   *
   * @param proof  a `getProof(taskId)` response (or compatible subset)
   * @param opts   `paymentRef` (from task status) to fully check the binding; `checkNullifier`
   */
  async verifyProof(
    proof: VerifiableProof,
    opts: { paymentRef?: string; checkNullifier?: boolean } = {},
  ): Promise<ProofVerification> {
    const reasons: string[] = [];

    const hasProof = !!proof?.sp1_proof?.proof;
    if (!hasProof) reasons.push('no proof present on the task');

    const proofOutcomeValid = proof?.proof_outcome === 'valid';
    if (!proofOutcomeValid) {
      reasons.push(`proof_outcome is "${proof?.proof_outcome}" (expected "valid")`);
    }

    const paymentBinding = verifyPaymentBinding(proof?.payment_binding, {
      paymentRef: opts.paymentRef,
      taskId: proof?.task_id,
    });
    if (paymentBinding.checked && paymentBinding.valid === false) {
      reasons.push('payment binding commitment does not match');
    }

    const nullifierValue = proof?.sp1_proof?.nullifier ?? null;
    let used: boolean | null = null;
    let checkedOnChain = false;
    if (opts.checkNullifier && nullifierValue) {
      if (!this.provider || !this.zkVerifierAddress) {
        reasons.push('checkNullifier requested but provider/zkVerifierAddress not configured');
      } else {
        used = await this.isNullifierUsed(nullifierValue);
        checkedOnChain = true;
      }
    }

    const ok = hasProof && proofOutcomeValid && paymentBinding.valid !== false;

    return {
      ok,
      checks: {
        hasProof,
        proofOutcomeValid,
        paymentBinding,
        nullifier: { value: nullifierValue, checkedOnChain, used },
      },
      reasons,
    };
  }

  /** veXF voting power for an address. */
  async getVotingPower(address: string): Promise<bigint> {
    if (!this.provider) throw new Error('provider/rpcUrl required for reads');
    const c = new Contract(this.requireAddr(this.veGovernanceAddress, 'veGovernance'), VE_GOVERNANCE_ABI as unknown as string[], this.provider);
    return c.votingPower(address);
  }

  // ── Reads (ModelRegistry / PoMA) ───────────────────────────────────────────

  private modelRegistry(): Contract {
    if (!this.provider) throw new Error('provider/rpcUrl required for reads');
    return new Contract(this.requireAddr(this.modelRegistryAddress, 'modelRegistry'), MODEL_REGISTRY_ABI as unknown as string[], this.provider);
  }

  private static decodeModel(v: {
    commitment: string; scheme: bigint | number; arch: string; quant: string;
    metadataURI: string; registeredAt: bigint | number; registrar: string;
  }): ModelInfo {
    const scheme = Number(v.scheme);
    return {
      commitment: v.commitment,
      scheme,
      schemeName: COMMITMENT_SCHEMES[scheme] ?? 'KECCAK_MERKLE',
      arch: v.arch,
      quant: v.quant,
      metadataURI: v.metadataURI,
      registeredAt: Number(v.registeredAt),
      registrar: v.registrar,
    };
  }

  /** Latest (highest) version index for a model, or 0 if unknown. Accepts a modelId or a slug. */
  async latestModelVersion(modelIdOrSlug: string): Promise<number> {
    const modelId = modelIdOrSlug.startsWith('0x') && modelIdOrSlug.length === 66 ? modelIdOrSlug : modelIdFromSlug(modelIdOrSlug);
    return Number(await this.modelRegistry().latestVersion(modelId));
  }

  /** Read a specific model version. Accepts a modelId or a slug. */
  async getModel(modelIdOrSlug: string, version: number): Promise<ModelInfo> {
    const modelId = modelIdOrSlug.startsWith('0x') && modelIdOrSlug.length === 66 ? modelIdOrSlug : modelIdFromSlug(modelIdOrSlug);
    return XFuelOnChain.decodeModel(await this.modelRegistry().getModel(modelId, version));
  }

  /** Read the latest version of a model. Accepts a modelId or a slug. */
  async getLatestModel(modelIdOrSlug: string): Promise<ModelInfo> {
    const modelId = modelIdOrSlug.startsWith('0x') && modelIdOrSlug.length === 66 ? modelIdOrSlug : modelIdFromSlug(modelIdOrSlug);
    return XFuelOnChain.decodeModel(await this.modelRegistry().getLatestModel(modelId));
  }

  /**
   * Verify a claimed commitment matches a registered, active model version (anti-downgrade).
   * Accepts a modelId or a slug.
   */
  async verifyModelCommitment(modelIdOrSlug: string, version: number, commitment: string): Promise<boolean> {
    const modelId = modelIdOrSlug.startsWith('0x') && modelIdOrSlug.length === 66 ? modelIdOrSlug : modelIdFromSlug(modelIdOrSlug);
    return this.modelRegistry().verifyCommitment(modelId, version, commitment);
  }

  /** Reverse lookup: which (modelId, version) a commitment belongs to (zero/0 if none). */
  async lookupModelCommitment(commitment: string): Promise<{ modelId: string; version: number }> {
    const r = await this.modelRegistry().lookupCommitment(commitment);
    return { modelId: r.modelId ?? r[0], version: Number(r.version ?? r[1]) };
  }

  /** Build calldata to register a model version (REGISTRAR_ROLE; normally the protocol Safe/relayer). */
  encodeRegisterModel(
    modelIdOrSlug: string, commitment: string, scheme: number, arch: string, quant: string, metadataURI: string,
  ): CallData {
    const modelId = modelIdOrSlug.startsWith('0x') && modelIdOrSlug.length === 66 ? modelIdOrSlug : modelIdFromSlug(modelIdOrSlug);
    return { to: this.requireAddr(this.modelRegistryAddress, 'modelRegistry'), data: iModel.encodeFunctionData('registerModel', [modelId, commitment, scheme, arch, quant, metadataURI]) };
  }

  // ── ERC-8004 Validation Registry (reads + calldata) ───────────────────────

  private erc8004Registry(): Contract {
    if (!this.provider) throw new Error('provider/rpcUrl required for reads');
    return new Contract(this.requireAddr(this.erc8004RegistryAddress, 'erc8004Registry'), ERC8004_VALIDATION_REGISTRY_ABI as unknown as string[], this.provider);
  }

  /** Read a single ERC-8004 validation record. */
  async getValidationStatus(requestHash: string): Promise<{
    validatorAddress: string; agentId: bigint; response: number; responseHash: string; tag: string; lastUpdate: bigint;
  }> {
    const r = await this.erc8004Registry().getValidationStatus(requestHash);
    return {
      validatorAddress: r.validatorAddress ?? r[0],
      agentId: BigInt(r.agentId ?? r[1]),
      response: Number(r.response ?? r[2]),
      responseHash: r.responseHash ?? r[3],
      tag: r.tag ?? r[4],
      lastUpdate: BigInt(r.lastUpdate ?? r[5]),
    };
  }

  /** Aggregate ERC-8004 stats for an agent (count + average score 0..100). */
  async getValidationSummary(
    agentId: string | number | bigint, validatorAddresses: string[] = [], tag = '',
  ): Promise<{ count: bigint; averageResponse: number }> {
    const r = await this.erc8004Registry().getSummary(agentId, validatorAddresses, tag);
    return { count: BigInt(r.count ?? r[0]), averageResponse: Number(r.averageResponse ?? r[1]) };
  }

  /** All ERC-8004 request hashes recorded for an agent. */
  async getAgentValidations(agentId: string | number | bigint): Promise<string[]> {
    return this.erc8004Registry().getAgentValidations(agentId);
  }

  /** XFuel-adapter provenance for a request: which XFuel task backed the verdict. */
  async validationProvenance(requestHash: string): Promise<{ taskIdHash: string; isAnswered: boolean }> {
    if (!this.provider) throw new Error('provider/rpcUrl required for reads');
    const c = new Contract(this.requireAddr(this.xfuelValidationAdapterAddress, 'xfuelValidationAdapter'), XFUEL_VALIDATION_ADAPTER_ABI as unknown as string[], this.provider);
    const r = await c.provenanceOf(requestHash);
    return { taskIdHash: r.taskIdHash ?? r[0], isAnswered: Boolean(r.isAnswered ?? r[1]) };
  }

  /** Calldata: XFuel (validator) answers a request directly on the ERC-8004 registry. */
  encodeValidationResponse(v: ValidationVerdict): CallData {
    return { to: this.requireAddr(this.erc8004RegistryAddress, 'erc8004Registry'), data: encodeValidationResponse(v) };
  }

  /** Calldata: push an XFuel verdict via the adapter (SUBMITTER_ROLE). */
  encodeSubmitValidation(v: ValidationVerdict): CallData {
    return { to: this.requireAddr(this.xfuelValidationAdapterAddress, 'xfuelValidationAdapter'), data: encodeSubmitValidation(v) };
  }

  // ── ProviderStaking (reads + calldata) ────────────────────────────────────

  private staking(): Contract {
    if (!this.provider) throw new Error('provider/rpcUrl required for reads');
    return new Contract(this.requireAddr(this.providerStakingAddress, 'providerStaking'), PROVIDER_STAKING_ABI as unknown as string[], this.provider);
  }

  /** Active (slashable) stake for a provider. */
  async getProviderStake(provider: string): Promise<bigint> {
    return BigInt(await this.staking().stakeOf(provider));
  }

  /** Provider status: stake, active flag, slash count, minStake, and pending unbonding. */
  async getProviderStatus(provider: string): Promise<{
    stake: bigint; isActive: boolean; slashCount: bigint; minStake: bigint; pending: bigint; unlockAt: bigint;
  }> {
    const c = this.staking();
    const [stake, isActive, slashes, minStake, pending] = await Promise.all([
      c.stakeOf(provider), c.isActiveProvider(provider), c.slashCount(provider), c.minStake(), c.pendingOf(provider),
    ]);
    return {
      stake: BigInt(stake),
      isActive: Boolean(isActive),
      slashCount: BigInt(slashes),
      minStake: BigInt(minStake),
      pending: BigInt(pending.amount ?? pending[0]),
      unlockAt: BigInt(pending.unlockAt ?? pending[1]),
    };
  }

  /** Calldata: stake `amount` (approve the stake token first). */
  encodeStake(amount: string | bigint): CallData {
    return { to: this.requireAddr(this.providerStakingAddress, 'providerStaking'), data: iStaking.encodeFunctionData('stake', [amount]) };
  }

  /** Calldata: begin unbonding `amount`. */
  encodeRequestUnstake(amount: string | bigint): CallData {
    return { to: this.requireAddr(this.providerStakingAddress, 'providerStaking'), data: iStaking.encodeFunctionData('requestUnstake', [amount]) };
  }

  /** Calldata: withdraw matured unbonding funds. */
  encodeWithdrawStake(): CallData {
    return { to: this.requireAddr(this.providerStakingAddress, 'providerStaking'), data: iStaking.encodeFunctionData('withdraw', []) };
  }

  // ── Calldata builders (A2A) ───────────────────────────────────────────────

  encodeRegisterAgent(identityCommitment: string, endpoint: string, capabilities: string[]): CallData {
    return { to: this.requireAddr(this.a2aCircuitAddress, 'a2aCircuit'), data: iA2A.encodeFunctionData('registerAgent', [identityCommitment, endpoint, capabilities]) };
  }

  encodeSubmitBid(taskHash: string, capabilityRequired: string, deadline: number | bigint, escrowWei: string): CallData {
    return { to: this.requireAddr(this.a2aCircuitAddress, 'a2aCircuit'), data: iA2A.encodeFunctionData('submitBid', [taskHash, capabilityRequired, deadline]), value: escrowWei };
  }

  encodeAcceptBid(bidId: string, priceWei: string): CallData {
    return { to: this.requireAddr(this.a2aCircuitAddress, 'a2aCircuit'), data: iA2A.encodeFunctionData('acceptBid', [bidId, priceWei]) };
  }

  /** Note: settleBid requires BOTH proof and publicValues (5 args). */
  encodeSettleBid(bidId: string, resultHash: string, proof: string, publicValues: string, nullifier: string): CallData {
    return { to: this.requireAddr(this.a2aCircuitAddress, 'a2aCircuit'), data: iA2A.encodeFunctionData('settleBid', [bidId, resultHash, proof, publicValues, nullifier]) };
  }

  encodeSettleBidFairExchange(bidId: string, resultHash: string, v: number, r: string, s: string): CallData {
    return { to: this.requireAddr(this.a2aCircuitAddress, 'a2aCircuit'), data: iA2A.encodeFunctionData('settleBidFairExchange', [bidId, resultHash, v, r, s]) };
  }

  encodeFormSwarm(objectiveHash: string, maxMembers: number, escrowWei: string): CallData {
    return { to: this.requireAddr(this.a2aCircuitAddress, 'a2aCircuit'), data: iA2A.encodeFunctionData('formSwarm', [objectiveHash, maxMembers]), value: escrowWei };
  }

  encodeJoinSwarm(swarmId: string): CallData {
    return { to: this.requireAddr(this.a2aCircuitAddress, 'a2aCircuit'), data: iA2A.encodeFunctionData('joinSwarm', [swarmId]) };
  }

  /**
   * Settle one swarm member's payout from the escrow pool with a ZK proof.
   * On-chain this is RELAYER_ROLE-gated, so it is normally submitted by the
   * server relayer; the builder is provided for relayer/admin tooling.
   */
  encodeSettleSwarmAgent(swarmId: string, agent: string, amountWei: string, proof: string, publicValues: string, nullifier: string): CallData {
    return { to: this.requireAddr(this.a2aCircuitAddress, 'a2aCircuit'), data: iA2A.encodeFunctionData('settleSwarmAgent', [swarmId, agent, amountWei, proof, publicValues, nullifier]) };
  }

  /** Coordinator (or admin) dissolves a swarm; remaining escrow refunds to coordinator (minus fee). */
  encodeDissolveSwarm(swarmId: string): CallData {
    return { to: this.requireAddr(this.a2aCircuitAddress, 'a2aCircuit'), data: iA2A.encodeFunctionData('dissolveSwarm', [swarmId]) };
  }

  /** Any member force-dissolves a timed-out swarm after `swarmTimeoutDuration`. Refund goes to coordinator. */
  encodeForceDissolveSwarm(swarmId: string): CallData {
    return { to: this.requireAddr(this.a2aCircuitAddress, 'a2aCircuit'), data: iA2A.encodeFunctionData('forceDissolveSwarm', [swarmId]) };
  }

  // ── Reads (A2A swarms) ─────────────────────────────────────────────────────

  /** Fetch decoded on-chain swarm state. Requires a provider/rpcUrl. */
  async getSwarm(swarmId: string): Promise<SwarmInfo> {
    if (!this.provider) throw new Error('provider/rpcUrl required for reads');
    const c = new Contract(this.requireAddr(this.a2aCircuitAddress, 'a2aCircuit'), A2A_CIRCUIT_ABI as unknown as string[], this.provider);
    const s = await c.swarms(swarmId);
    const escrowPool = BigInt(s.escrowPool);
    const settledAmount = BigInt(s.settledAmount);
    const phaseIndex = Number(s.phase);
    return {
      swarmId: s.swarmId,
      coordinator: s.coordinator,
      objectiveHash: s.objectiveHash,
      escrowPool,
      settledAmount,
      memberCount: Number(s.memberCount),
      maxMembers: Number(s.maxMembers),
      phase: SWARM_PHASES[phaseIndex] ?? 'Forming',
      phaseIndex,
      formedAt: Number(s.formedAt),
      settledAt: Number(s.settledAt),
      settlementNullifier: s.settlementNullifier,
      remainingEscrow: escrowPool - settledAmount,
      exists: Number(s.formedAt) > 0,
    };
  }

  /** True if `agent` is a member of `swarmId`. Requires a provider/rpcUrl. */
  async isSwarmMember(swarmId: string, agent: string): Promise<boolean> {
    if (!this.provider) throw new Error('provider/rpcUrl required for reads');
    const c = new Contract(this.requireAddr(this.a2aCircuitAddress, 'a2aCircuit'), A2A_CIRCUIT_ABI as unknown as string[], this.provider);
    return c.swarmMembers(swarmId, agent);
  }

  // ── Calldata builders (ZK verifier / cross-chain) ─────────────────────────

  encodeRelayProofCrossChain(circuitId: string, publicValues: string, proofBytes: string, nullifier: string, destDomain: number, feeWei = '0'): CallData {
    return { to: this.requireAddr(this.zkVerifierAddress, 'zkVerifier'), data: iZk.encodeFunctionData('relayProofCrossChain', [circuitId, publicValues, proofBytes, nullifier, destDomain]), value: feeWei };
  }

  // ── Calldata builders (governance) ────────────────────────────────────────

  encodeLock(amountWei: string, unlockTime: number | bigint): CallData {
    return { to: this.requireAddr(this.veGovernanceAddress, 'veGovernance'), data: iGov.encodeFunctionData('lock', [amountWei, unlockTime]) };
  }

  encodeCreateProposal(pType: number, targetCircuit: string, description: string, executionData: string): CallData {
    return { to: this.requireAddr(this.veGovernanceAddress, 'veGovernance'), data: iGov.encodeFunctionData('createProposal', [pType, targetCircuit, description, executionData]) };
  }

  encodeVote(proposalId: number | bigint, support: boolean): CallData {
    return { to: this.requireAddr(this.veGovernanceAddress, 'veGovernance'), data: iGov.encodeFunctionData('vote', [proposalId, support]) };
  }

  // ── Optional: send with an attached signer (advanced) ─────────────────────

  /** Send a built CallData using the attached signer. Throws if no signer. */
  async send(call: CallData) {
    if (!this.signer) throw new Error('no signer attached; call connect(signer) or submit calldata out-of-band');
    return this.signer.sendTransaction({ to: call.to, data: call.data, value: call.value ? BigInt(call.value) : undefined });
  }
}

// ─── x402 payer: USDC EIP-3009 transferWithAuthorization (Base) ───────────────
//
// Production payer for XFuel's default USDC/x402 rail. Signs an EIP-3009
// `transferWithAuthorization` over USDC with YOUR ethers Signer and envelopes it
// into the X-PAYMENT header (via createSignerPayer). The private key stays in the
// signer you pass — this module never persists or transmits it.
//
//   import { Wallet } from 'ethers';
//   import { createEip3009Payer } from 'xfuel-sdk/onchain';
//   const payer = createEip3009Payer(new Wallet(process.env.PK));
//   await client.submitTaskWithPayment({ ...params, payment: { rail: 'usdc' } }, payer);
//
// The `authorization` blob the facilitator receives is:
//   { type:'eip3009-transferWithAuthorization', domain, message, signature }
// where `message` = { from, to, value, validAfter, validBefore, nonce } and the
// facilitator submits it via USDC.transferWithAuthorization(...).

/** Known Base USDC deployments for the EIP-712 domain (override via options). */
export const USDC_NETWORKS: Record<
  string,
  { chainId: number; usdc: string; name: string; version: string }
> = {
  base: {
    chainId: 8453,
    usdc: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
    name: 'USD Coin',
    version: '2',
  },
  'base-sepolia': {
    chainId: 84532,
    usdc: '0x036CbD53842c5426634e7929541eC2318f3dCF7e',
    name: 'USDC',
    version: '2',
  },
};

export interface Eip3009PayerOptions {
  /** Override the USDC token address (EIP-712 verifyingContract). */
  usdcAddress?: string;
  /** Override the EIP-712 domain name (default per network). */
  domainName?: string;
  /** Override the EIP-712 domain version (default '2'). */
  domainVersion?: string;
  /** Override the chainId (default per network). */
  chainId?: number;
  /** Authorization validity window in seconds from now (default 3600). */
  validForSeconds?: number;
  /** Override the `from` address (default = signer address). */
  from?: string;
}

const EIP3009_TYPES = {
  TransferWithAuthorization: [
    { name: 'from', type: 'address' },
    { name: 'to', type: 'address' },
    { name: 'value', type: 'uint256' },
    { name: 'validAfter', type: 'uint256' },
    { name: 'validBefore', type: 'uint256' },
    { name: 'nonce', type: 'bytes32' },
  ],
} as const;

/**
 * Build an x402 payer that signs USDC EIP-3009 `transferWithAuthorization` on Base.
 * Pass any ethers v6 `Signer` (e.g. `new Wallet(pk)` or a browser signer). The SDK
 * never sees your key — signing happens inside the signer you provide.
 *
 * @param signer  ethers v6 Signer with `signTypedData` + `getAddress`
 * @param opts    domain/network overrides (see Eip3009PayerOptions)
 */
export function createEip3009Payer(signer: Signer, opts: Eip3009PayerOptions = {}): X402Payer {
  if (!signer || typeof signer.signTypedData !== 'function' || typeof signer.getAddress !== 'function') {
    throw new Error('createEip3009Payer requires an ethers v6 Signer (signTypedData + getAddress)');
  }
  return createSignerPayer(async (accept: X402Accept) => {
    const net = USDC_NETWORKS[accept.network];
    const chainId = opts.chainId ?? net?.chainId;
    const verifyingContract = opts.usdcAddress ?? net?.usdc;
    const name = opts.domainName ?? net?.name ?? 'USD Coin';
    const version = opts.domainVersion ?? net?.version ?? '2';
    if (!chainId || !verifyingContract) {
      throw new Error(
        `createEip3009Payer: unsupported network "${accept.network}" — pass chainId + usdcAddress for non-Base rails`,
      );
    }
    if (!accept.payTo) throw new Error('createEip3009Payer: challenge is missing payTo');

    const from = opts.from ?? (await signer.getAddress());
    const now = Math.floor(Date.now() / 1000);
    const message = {
      from,
      to: accept.payTo,
      value: accept.maxAmountRequired,
      validAfter: 0,
      validBefore: now + (opts.validForSeconds ?? 3600),
      // EIP-3009 nonce (random bytes32) — distinct from the x402 challenge nonce.
      nonce: hexlify(randomBytes(32)),
    };
    const domain = { name, version, chainId, verifyingContract };
    const signature = await signer.signTypedData(domain, EIP3009_TYPES as unknown as Record<string, Array<{ name: string; type: string }>>, message);

    return {
      type: 'eip3009-transferWithAuthorization',
      domain,
      message,
      signature,
    };
  });
}

export default XFuelOnChain;
