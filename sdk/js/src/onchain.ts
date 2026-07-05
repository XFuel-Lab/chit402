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
}

const iZk = new Interface(ZK_VERIFIER_ABI as unknown as string[]);
const iA2A = new Interface(A2A_CIRCUIT_ABI as unknown as string[]);
const iGov = new Interface(VE_GOVERNANCE_ABI as unknown as string[]);

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

  constructor(opts: XFuelOnChainOptions = {}) {
    this.provider = opts.provider ?? (opts.rpcUrl ? new JsonRpcProvider(opts.rpcUrl) : undefined);
    this.zkVerifierAddress = opts.zkVerifierAddress;
    this.a2aCircuitAddress = opts.a2aCircuitAddress;
    this.veGovernanceAddress = opts.veGovernanceAddress;
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
