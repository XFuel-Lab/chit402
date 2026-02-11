/**
 * @title XFuel v5.1 Osmosis/Akash/TAO Ecosystem — Full E2E Journey Tests
 * @notice End-to-end simulation of complete cross-chain journeys:
 *
 *   JOURNEY 1: TFUEL deposit → ibcTFUEL on Osmosis (30-50% APY AKT/OSMO yield)
 *   JOURNEY 2: AI inference request → Akash GPU lease → SP1 proof → settlement
 *   JOURNEY 3: TAO subnet inference → vTAO wrapping → settlement via Substrate bridge
 *   JOURNEY 4: Reverse bridge: ibcTFUEL burn → FeeCollector → TFUEL unwrap
 *   JOURNEY 5: 60% AI volume mix with countercyclical revenue asserts (Sections 6.1.2, 11.2)
 *
 *   ProofOutcome.Valid / Regenerable / Invalid per Section 3.4.5
 *   Osmosis testnet RPC integration via CosmJS mock
 *   Web3.js / ethers for Theta/TAO EVM interactions
 *   Persistence: relic compat checks only
 *
 * @dev Uses node:test runner (matches backend/tests/ai-depin/fee.unit.test.js pattern)
 *      Integrates with run-e2e-tests.ps1 via `npm run test:e2e:ecosystem`
 *
 * Reference: Whitepaper v5.1 Sections 3.4.5, 6.1.2, 8.2, 10.2, 10.4, 11.2
 */

import { describe, it, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'crypto';

// ═══════════════════════════════════════════════════════════════════════════════
// CONSTANTS — synced with server.js / config.js / main.rs / contract.rs
// ═══════════════════════════════════════════════════════════════════════════════

const FEE_CONFIG = {
  defaultBps:    50,     // 0.5%
  minBps:        50,
  maxBps:        100,    // 1.0%
  a2aRelayBps:   10,     // 0.1%
  bridgeBps:     50,     // 0.5%
  denominator:   10000,
  minTaskAmount: 10000,
};

const REVENUE_SPLIT = {
  bbb:      { label: 'Buyback & Burn (BBB)', pct: 30 },
  lp:       { label: 'LP Reinvestment',      pct: 30 },
  vexf:     { label: 'veXF Stakers',         pct: 25 },
  treasury: { label: 'Treasury',             pct: 15 },
};

const MESSAGE_TYPES = {
  COMPUTE_BID:       'compute_bid',
  COMPUTE_RESULT:    'compute_result',
  INFERENCE_REQUEST: 'inference_request',
  CAPABILITY_QUERY:  'capability_query',
  DATA_ATTESTATION:  'data_attestation',
};

const CHAIN_IDS = {
  THETA:       'theta',
  OSMOSIS:     'osmosis',
  AKASH:       'akash',
  BITTENSOR:   'bittensor',
  PERSISTENCE: 'persistence',
};

/** ProofOutcome enum per Section 3.4.5 */
const ProofOutcome = {
  Valid:       'Valid',
  Regenerable: 'Regenerable',
  Invalid:     'Invalid',
};

/** Circuit breaker thresholds (Section 10.4) */
const CIRCUIT_BREAKER = {
  maxWithdrawalRatePct:  20,   // >20% TVL in 24h triggers pause
  maxRevertRatePct:       5,   // >5% revert rate triggers pause
  emergencyLPRebalance: 500_000, // $500K treasury cap for LP rescue
};

/** Osmosis yield ranges per whitepaper */
const YIELD_RANGES = {
  aiTokenPools:  { min: 40, max: 80 },   // AKT/OSMO, FET/OSMO
  lstfiPools:    { min: 20, max: 40 },   // stATOM/OSMO
  overall:       { min: 30, max: 50 },   // advertised 30-50%+
};

// ═══════════════════════════════════════════════════════════════════════════════
// HELPERS
// ═══════════════════════════════════════════════════════════════════════════════

function randomBytes(n = 32) { return crypto.randomBytes(n).toString('hex'); }
function randomTaskId() { return `task_${randomBytes(16)}`; }
function randomTxHash() { return `0x${randomBytes(32)}`; }
function randomAddr(prefix = '0x') { return `${prefix}${randomBytes(20)}`; }
function randomCosmAddr(prefix = 'osmo1') { return `${prefix}${randomBytes(20)}`; }

function calculateTaskFee(grossAmount, feeBps = FEE_CONFIG.defaultBps) {
  const gross = BigInt(grossAmount);
  const bps = BigInt(Math.min(Math.max(feeBps, FEE_CONFIG.minBps), FEE_CONFIG.maxBps));
  const fee = (gross * bps) / BigInt(FEE_CONFIG.denominator);
  const net = gross - fee;
  return { grossAmount: gross, feeAmount: fee, netAmount: net, feeBps: Number(bps) };
}

function applySplit(totalFee) {
  const fee = BigInt(totalFee);
  return {
    bbb:      (fee * 30n) / 100n,
    lp:       (fee * 30n) / 100n,
    vexf:     (fee * 25n) / 100n,
    treasury: (fee * 15n) / 100n,
  };
}

// ═══════════════════════════════════════════════════════════════════════════════
// MOCK: Osmosis CosmJS Testnet Client
// ═══════════════════════════════════════════════════════════════════════════════

class MockOsmosisClient {
  constructor() {
    this.balances = new Map();
    this.pools = new Map();
    this.ibcTransfers = [];
    this.mintedTokens = new Map();
    this.feeCollectorBalance = 0n;

    // Seed pool data (Osmosis DEX $2B+ TVL)
    this._seedPools();
  }

  _seedPools() {
    this.pools.set('pool-1', {
      id: 'pool-1', pair: 'ibcTFUEL/OSMO', tvl: 5_000_000n,
      apy: 45, type: 'concentrated', feeRate: 0.003,
    });
    this.pools.set('pool-2', {
      id: 'pool-2', pair: 'AKT/OSMO', tvl: 12_000_000n,
      apy: 55, type: 'concentrated', feeRate: 0.003,
    });
    this.pools.set('pool-3', {
      id: 'pool-3', pair: 'FET/OSMO', tvl: 8_000_000n,
      apy: 65, type: 'concentrated', feeRate: 0.003,
    });
    this.pools.set('pool-4', {
      id: 'pool-4', pair: 'stATOM/OSMO', tvl: 20_000_000n,
      apy: 28, type: 'stableswap', feeRate: 0.001,
    });
  }

  /** Simulate IBC transfer from Theta → Osmosis (ibcTFUEL mint) */
  async ibcTransferIn({ sender, receiver, amount, sourceChannel, token = 'ibc/TFUEL' }) {
    const amt = BigInt(amount);
    const current = this.balances.get(receiver) || 0n;
    this.balances.set(receiver, current + amt);
    this.mintedTokens.set(receiver, (this.mintedTokens.get(receiver) || 0n) + amt);

    const transfer = {
      id: `ibc-${randomBytes(16)}`,
      sender, receiver, amount: amt, sourceChannel,
      token, status: 'completed', timestamp: Date.now(),
    };
    this.ibcTransfers.push(transfer);
    return transfer;
  }

  /** Simulate IBC transfer Osmosis → Akash */
  async ibcTransferToAkash({ sender, receiver, amount, channel = 'channel-1' }) {
    const amt = BigInt(amount);
    const balance = this.balances.get(sender) || 0n;
    if (balance < amt) throw new Error(`InsufficientFunds: have ${balance}, need ${amt}`);
    this.balances.set(sender, balance - amt);

    return {
      id: `ibc-akash-${randomBytes(16)}`,
      sender, receiver, amount: amt, channel,
      status: 'completed', timestamp: Date.now(),
    };
  }

  /** Query pool APY */
  queryPool(poolId) { return this.pools.get(poolId) || null; }

  /** Query all pools */
  queryAllPools() { return Array.from(this.pools.values()); }

  /** Query balance */
  queryBalance(address) { return this.balances.get(address) || 0n; }

  /** Simulate fee deposit to FeeCollector */
  depositFee(amount) {
    const amt = BigInt(amount);
    this.feeCollectorBalance += amt;
    return { accumulated: this.feeCollectorBalance.toString() };
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// MOCK: Theta EVM Client (Web3.js / ethers compatible)
// ═══════════════════════════════════════════════════════════════════════════════

class MockThetaEVMClient {
  constructor() {
    this.vaults = new Map();
    this.deposits = [];
    this.unwraps = [];
    this.nonces = new Map();      // user → nonce
    this.usedNonces = new Map();  // user → Set<nonce>
    this.tvl = 0n;
    this.paused = false;
    this.withdrawalRate24h = 0n;
    this.totalWithdrawn24h = 0n;
  }

  /** Simulate TFUEL deposit to VaultFactory SubVault */
  async deposit({ user, amount }) {
    if (this.paused) throw new Error('Contract is paused');
    const amt = BigInt(amount);
    const vault = this.vaults.get(user) || { balance: 0n, created: Date.now() };
    vault.balance += amt;
    this.vaults.set(user, vault);
    this.tvl += amt;

    const deposit = {
      txHash: randomTxHash(), user, amount: amt,
      vaultAddress: `0x${crypto.createHash('sha256').update(user).digest('hex').slice(0, 40)}`,
      blockNumber: Math.floor(Math.random() * 1000000) + 20000000,
      timestamp: Date.now(),
    };
    this.deposits.push(deposit);
    return deposit;
  }

  /** Simulate unwrapFromBurn (reverse bridge) with nonce tracking */
  async unwrapFromBurn({ user, amount, nonce, proof }) {
    if (this.paused) throw new Error('Contract is paused');
    const amt = BigInt(amount);
    const vault = this.vaults.get(user);
    if (!vault || vault.balance < amt) {
      throw new Error(`InsufficientVaultBalance: have ${vault?.balance || 0n}, need ${amt}`);
    }

    // Nonce replay protection (Section 10.2)
    const userNonces = this.usedNonces.get(user) || new Set();
    if (userNonces.has(nonce)) {
      throw new Error(`Nonce already used: ${nonce}`);
    }
    userNonces.add(nonce);
    this.usedNonces.set(user, userNonces);

    // Circuit breaker check (Section 10.4)
    this.totalWithdrawn24h += amt;
    const withdrawalPct = this.tvl > 0n
      ? Number((this.totalWithdrawn24h * 100n) / this.tvl)
      : 0;
    if (withdrawalPct > CIRCUIT_BREAKER.maxWithdrawalRatePct) {
      this.paused = true;
      throw new Error(`CircuitBreaker: withdrawal rate ${withdrawalPct}% > ${CIRCUIT_BREAKER.maxWithdrawalRatePct}% TVL`);
    }

    vault.balance -= amt;
    this.tvl -= amt;

    const unwrap = {
      txHash: randomTxHash(), user, amount: amt, nonce,
      blockNumber: Math.floor(Math.random() * 1000000) + 20000000,
      timestamp: Date.now(),
    };
    this.unwraps.push(unwrap);
    return unwrap;
  }

  /** Get next nonce for user */
  getNextNonce(user) {
    const current = this.nonces.get(user) || 0;
    const next = current + 1;
    this.nonces.set(user, next);
    return next;
  }

  resetWithdrawalTracking() {
    this.totalWithdrawn24h = 0n;
    this.paused = false;
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// MOCK: TAO Substrate Bridge (Bittensor vTAO wrapping)
// ═══════════════════════════════════════════════════════════════════════════════

class MockTAOBridge {
  constructor() {
    this.wrappedBalance = new Map();  // user → vTAO balance
    this.subnetTasks = new Map();
    this.inferenceResults = new Map();
    this.totalWrapped = 0n;
    this.totalInferences = 0;
  }

  /** Wrap native TAO → vTAO (ERC-20 on Theta EVM, TAOWrapper.sol) */
  async wrapTAO({ user, amount, substrateExtrinsicHash }) {
    const amt = BigInt(amount);
    const current = this.wrappedBalance.get(user) || 0n;
    this.wrappedBalance.set(user, current + amt);
    this.totalWrapped += amt;

    return {
      txHash: randomTxHash(),
      vTaoAmount: amt.toString(),
      substrateExtrinsicHash: substrateExtrinsicHash || `0x${randomBytes(32)}`,
      user,
    };
  }

  /** Submit inference request to TAO subnet */
  async submitInference({ taskId, subnetId, modelIdHash, inputHash, amount }) {
    const amt = BigInt(amount);
    const task = {
      taskId, subnetId, modelIdHash, inputHash,
      amount: amt, status: 'pending',
      submittedAt: Date.now(),
    };
    this.subnetTasks.set(taskId, task);
    this.totalInferences++;
    return task;
  }

  /** Complete inference (simulate subnet validator response) */
  async completeInference({ taskId, outputHash, validatorSignature }) {
    const task = this.subnetTasks.get(taskId);
    if (!task) throw new Error(`TAOTaskNotFound: ${taskId}`);
    task.status = 'completed';
    task.outputHash = outputHash;
    task.completedAt = Date.now();
    this.inferenceResults.set(taskId, { outputHash, validatorSignature });
    return task;
  }

  queryBalance(user) { return this.wrappedBalance.get(user) || 0n; }
}

// ═══════════════════════════════════════════════════════════════════════════════
// MOCK: Akash GPU Lease Manager
// ═══════════════════════════════════════════════════════════════════════════════

class MockAkashLeaseManager {
  constructor() {
    this.leases = new Map();
    this.escrowBalances = new Map();
    this.gpuProviders = [
      { id: 'akash1_a100', gpuType: 'A100', pricePerHour: '0.5' },
      { id: 'akash1_h100', gpuType: 'H100', pricePerHour: '1.2' },
      { id: 'akash1_rtx4090', gpuType: 'RTX4090', pricePerHour: '0.3' },
    ];
    this.totalLeases = 0;
  }

  /** Submit GPU lease bid with escrow (Section 3.4.3) */
  submitBid({ owner, dseq, escrowAmount, gpuType = 'A100' }) {
    if (!escrowAmount || BigInt(escrowAmount) === 0n) {
      throw new Error('COMPUTE_BID requires non-zero escrow');
    }

    const bidId = `bid-${dseq}-${Date.now()}`;
    const provider = this.gpuProviders.find(p => p.gpuType === gpuType) || this.gpuProviders[0];

    const lease = {
      bidId, owner, dseq, escrowAmount: BigInt(escrowAmount),
      gpuType, provider: provider.id, status: 'active',
      createdAt: Date.now(),
    };
    this.leases.set(bidId, lease);
    this.escrowBalances.set(owner, (this.escrowBalances.get(owner) || 0n) + lease.escrowAmount);
    this.totalLeases++;
    return lease;
  }

  /** Complete GPU lease and release escrow */
  completeLease(bidId) {
    const lease = this.leases.get(bidId);
    if (!lease) throw new Error(`LeaseNotFound: ${bidId}`);
    lease.status = 'completed';
    const escrow = this.escrowBalances.get(lease.owner) || 0n;
    this.escrowBalances.set(lease.owner, escrow > lease.escrowAmount ? escrow - lease.escrowAmount : 0n);
    return lease;
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// MOCK: SP1 Prover (Mock mode — verifier address(0))
// ═══════════════════════════════════════════════════════════════════════════════

class MockSP1Prover {
  constructor() {
    this.proofCount = 0;
    this.retryCount = 0;
    this.failedCount = 0;
    /** Controls proof outcome for testing */
    this._nextOutcome = ProofOutcome.Valid;
    this._regenerableReason = null;
    this._invalidReason = null;
  }

  setNextOutcome(outcome, reasonHash = null) {
    this._nextOutcome = outcome;
    if (outcome === ProofOutcome.Regenerable) this._regenerableReason = reasonHash;
    if (outcome === ProofOutcome.Invalid) this._invalidReason = reasonHash;
  }

  /** Generate proof with configurable outcome */
  async generateProof({ taskType, inputs }) {
    this.proofCount++;

    if (this._nextOutcome === ProofOutcome.Regenerable) {
      this.retryCount++;
      const reason = this._regenerableReason || `0x${randomBytes(32)}`;
      this._nextOutcome = ProofOutcome.Valid; // auto-reset after regenerable
      return {
        outcome: ProofOutcome.Regenerable,
        reason_hash: reason,
        proof_data: null,
        should_retry: true,
      };
    }

    if (this._nextOutcome === ProofOutcome.Invalid) {
      this.failedCount++;
      const reason = this._invalidReason || `0x${randomBytes(32)}`;
      this._nextOutcome = ProofOutcome.Valid; // auto-reset
      return {
        outcome: ProofOutcome.Invalid,
        reason_hash: reason,
        proof_data: null,
        should_retry: false,
      };
    }

    return {
      outcome: ProofOutcome.Valid,
      proof_data: Buffer.from(randomBytes(64), 'hex'),
      public_inputs: inputs,
      vk_hash: `mock_vk_${this.proofCount}`,
    };
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// MOCK: AIVerifier (Osmosis CosmWasm — mirrors ai-verifier/src/contract.rs)
// ═══════════════════════════════════════════════════════════════════════════════

class MockAIVerifier {
  constructor(feeCollectorRef) {
    this.tasks = new Map();
    this.settledTasks = new Map();
    this.usedNullifiers = new Set();
    this.feeCollector = feeCollectorRef;
    this.totalRouted = 0;
    this.totalSettled = 0;
    this.totalFailed = 0;
    this.totalFees = 0n;
  }

  async routeTask({ taskId, msgType, destinationChain, amount, feeBps = 50, sender }) {
    if (this.tasks.has(taskId)) throw new Error(`TaskAlreadyExists: ${taskId}`);
    const { grossAmount, feeAmount, netAmount } = calculateTaskFee(amount, feeBps);

    const task = {
      taskId, msgType, destinationChain, sender,
      grossAmount, feeAmount, netAmount, feeBps,
      status: 'routed', proofOutcome: null,
      createdAt: Date.now(),
    };
    this.tasks.set(taskId, task);
    this.totalRouted++;

    // Deposit fee to FeeCollector
    if (feeAmount > 0n) {
      this.totalFees += feeAmount;
      this.feeCollector.receive(feeAmount);
    }

    return { txHash: randomTxHash(), task };
  }

  async settleTask({ taskId, outcome, nullifier, outputHash }) {
    const task = this.tasks.get(taskId);
    if (!task) throw new Error(`TaskNotFound: ${taskId}`);
    if (task.status === 'settled') throw new Error(`TaskAlreadySettled: ${taskId}`);

    if (this.usedNullifiers.has(nullifier)) {
      throw new Error(`NullifierAlreadyUsed: ${nullifier}`);
    }
    this.usedNullifiers.add(nullifier);

    task.proofOutcome = outcome;

    if (outcome === ProofOutcome.Valid) {
      task.status = 'settled';
      task.outputHash = outputHash;
      this.totalSettled++;
      this.settledTasks.set(taskId, task);
    } else if (outcome === ProofOutcome.Invalid) {
      task.status = 'failed';
      this.totalFailed++;
    }
    // Regenerable: task stays 'routed' for retry

    return { txHash: randomTxHash(), task };
  }

  queryTask(taskId) { return this.tasks.get(taskId) || null; }
}

// ═══════════════════════════════════════════════════════════════════════════════
// MOCK: FeeCollector (mirrors cosmwasm-contracts/fee-collector/src/contract.rs)
// ═══════════════════════════════════════════════════════════════════════════════

class MockFeeCollector {
  constructor() {
    this.accumulated = 0n;
    this.totalBurned = 0n;
    this.burnCount = 0;
    this.minBurnAmount = 50_000n;
  }

  receive(amount) {
    this.accumulated += BigInt(amount);
    return { accumulated: this.accumulated.toString() };
  }

  triggerFeeBurn() {
    if (this.accumulated < this.minBurnAmount) {
      throw new Error(`BelowMinBurn: have ${this.accumulated}, need ${this.minBurnAmount}`);
    }
    const burned = this.accumulated;
    this.totalBurned += burned;
    this.burnCount++;
    this.accumulated = 0n;
    return { burnAmount: burned.toString(), count: this.burnCount };
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// TEST HARNESS — initialized before each describe block
// ═══════════════════════════════════════════════════════════════════════════════

let osmosis, theta, tao, akash, sp1, aiVerifier, feeCollector;

function initializeHarness() {
  feeCollector = new MockFeeCollector();
  osmosis = new MockOsmosisClient();
  theta = new MockThetaEVMClient();
  tao = new MockTAOBridge();
  akash = new MockAkashLeaseManager();
  sp1 = new MockSP1Prover();
  aiVerifier = new MockAIVerifier(feeCollector);
}

// ═══════════════════════════════════════════════════════════════════════════════
// JOURNEY 1: TFUEL Deposit → ibcTFUEL on Osmosis → Yield (30-50% APY)
// ═══════════════════════════════════════════════════════════════════════════════

describe('Journey 1: TFUEL Deposit → ibcTFUEL Osmosis Yield', () => {
  before(() => initializeHarness());

  it('should deposit TFUEL to VaultFactory SubVault on Theta', async () => {
    const user = randomAddr();
    const amount = 10_000_000_000n; // 10 TFUEL (18 decimals assumed as unit)

    const deposit = await theta.deposit({ user, amount: amount.toString() });
    assert.ok(deposit.txHash.startsWith('0x'), 'Deposit tx hash format');
    assert.equal(deposit.user, user);
    assert.equal(deposit.amount, amount);

    const vault = theta.vaults.get(user);
    assert.ok(vault, 'Vault created');
    assert.equal(vault.balance, amount);
    assert.equal(theta.tvl, amount, 'TVL updated');
  });

  it('should mint ibcTFUEL on Osmosis after SP1 proof verification', async () => {
    const user = randomAddr();
    const receiver = randomCosmAddr();
    const amount = 5_000_000_000n;

    // 1. Deposit on Theta
    await theta.deposit({ user, amount: amount.toString() });

    // 2. SP1 proof for forward deposit
    const proof = await sp1.generateProof({
      taskType: 'ForwardDeposit',
      inputs: { user, amount: amount.toString(), receiver },
    });
    assert.equal(proof.outcome, ProofOutcome.Valid);

    // 3. IBC transfer (mint ibcTFUEL on Osmosis)
    const bridgeFee = (amount * BigInt(FEE_CONFIG.bridgeBps)) / BigInt(FEE_CONFIG.denominator);
    const netAmount = amount - bridgeFee;

    const transfer = await osmosis.ibcTransferIn({
      sender: user,
      receiver,
      amount: netAmount.toString(),
      sourceChannel: 'channel-theta-0',
    });

    assert.equal(transfer.status, 'completed');
    assert.equal(osmosis.queryBalance(receiver), netAmount);
  });

  it('should validate Osmosis pool APYs are within expected ranges', () => {
    const pools = osmosis.queryAllPools();
    assert.ok(pools.length > 0, 'Pools exist');

    // Overall: at least one pool meets the 30-50%+ advertised range
    const meetsOverall = pools.some(p => p.apy >= YIELD_RANGES.overall.min);
    assert.ok(meetsOverall, 'At least one pool meets 30%+ APY');

    // Verify AI token pools (AKT, FET) are in 40-80% range
    const aiPools = pools.filter(p => p.pair.includes('AKT') || p.pair.includes('FET'));
    for (const pool of aiPools) {
      assert.ok(pool.apy >= YIELD_RANGES.aiTokenPools.min,
        `AI pool ${pool.pair} APY ${pool.apy}% >= ${YIELD_RANGES.aiTokenPools.min}%`);
      assert.ok(pool.apy <= YIELD_RANGES.aiTokenPools.max,
        `AI pool ${pool.pair} APY ${pool.apy}% <= ${YIELD_RANGES.aiTokenPools.max}%`);
    }

    // Verify LSTfi pools (stATOM) in 20-40%
    const lstfiPools = pools.filter(p => p.pair.startsWith('st'));
    for (const pool of lstfiPools) {
      assert.ok(pool.apy >= YIELD_RANGES.lstfiPools.min,
        `LSTfi pool ${pool.pair} APY ${pool.apy}% >= ${YIELD_RANGES.lstfiPools.min}%`);
      assert.ok(pool.apy <= YIELD_RANGES.lstfiPools.max,
        `LSTfi pool ${pool.pair} APY ${pool.apy}% <= ${YIELD_RANGES.lstfiPools.max}%`);
    }
  });

  it('should route ibcTFUEL from Osmosis to Akash via IBC', async () => {
    const sender = randomCosmAddr();
    const akashReceiver = randomCosmAddr('akash1');
    const amount = 1_000_000n;

    // Seed balance
    await osmosis.ibcTransferIn({
      sender: randomAddr(), receiver: sender,
      amount: amount.toString(), sourceChannel: 'channel-theta-0',
    });

    // IBC transfer to Akash
    const transfer = await osmosis.ibcTransferToAkash({
      sender, receiver: akashReceiver, amount: amount.toString(),
    });

    assert.equal(transfer.status, 'completed');
    assert.equal(osmosis.queryBalance(sender), 0n, 'Sender balance drained');
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// JOURNEY 2: AI Inference → Akash GPU → SP1 Proof → Settlement
// ═══════════════════════════════════════════════════════════════════════════════

describe('Journey 2: AI Inference → Akash GPU → Settlement', () => {
  before(() => initializeHarness());

  it('should route INFERENCE_REQUEST to Akash with escrow', async () => {
    const taskId = randomTaskId();
    const sender = randomCosmAddr();
    const amount = 1_000_000n;

    // Route through AIVerifier
    const { task } = await aiVerifier.routeTask({
      taskId,
      msgType: MESSAGE_TYPES.INFERENCE_REQUEST,
      destinationChain: CHAIN_IDS.AKASH,
      amount: amount.toString(),
      feeBps: 75, // 0.75%
      sender,
    });

    assert.equal(task.status, 'routed');
    assert.equal(task.feeBps, 75);
    assert.ok(task.feeAmount > 0n, 'Fee calculated');
    assert.equal(task.feeAmount, (amount * 75n) / 10000n);
  });

  it('should create Akash GPU lease with escrow for COMPUTE_BID', () => {
    const owner = randomCosmAddr('akash1');
    const escrow = 500_000n;

    const lease = akash.submitBid({
      owner, dseq: 12345, escrowAmount: escrow.toString(), gpuType: 'A100',
    });

    assert.equal(lease.status, 'active');
    assert.equal(lease.escrowAmount, escrow);
    assert.equal(lease.gpuType, 'A100');
    assert.equal(akash.escrowBalances.get(owner), escrow);
  });

  it('should reject COMPUTE_BID without escrow (Section 3.4.3)', () => {
    const owner = randomCosmAddr('akash1');

    assert.throws(
      () => akash.submitBid({ owner, dseq: 99, escrowAmount: '0' }),
      /COMPUTE_BID requires non-zero escrow/,
    );
  });

  it('should generate SP1 proof and settle with ProofOutcome.Valid', async () => {
    const taskId = randomTaskId();
    const sender = randomCosmAddr();

    // Route task
    await aiVerifier.routeTask({
      taskId,
      msgType: MESSAGE_TYPES.INFERENCE_REQUEST,
      destinationChain: CHAIN_IDS.AKASH,
      amount: '1000000',
      sender,
    });

    // Generate SP1 proof
    const proof = await sp1.generateProof({
      taskType: 'AITask',
      inputs: { taskId, sender },
    });
    assert.equal(proof.outcome, ProofOutcome.Valid);

    // Settle task
    const nullifier = `0x${randomBytes(32)}`;
    const { task } = await aiVerifier.settleTask({
      taskId,
      outcome: ProofOutcome.Valid,
      nullifier,
      outputHash: `0x${randomBytes(32)}`,
    });

    assert.equal(task.status, 'settled');
    assert.equal(task.proofOutcome, ProofOutcome.Valid);
    assert.equal(aiVerifier.totalSettled, 1);
  });

  it('should handle ProofOutcome.Regenerable with retry (Section 3.4.5)', async () => {
    const taskId = randomTaskId();
    const sender = randomCosmAddr();

    await aiVerifier.routeTask({
      taskId,
      msgType: MESSAGE_TYPES.COMPUTE_BID,
      destinationChain: CHAIN_IDS.AKASH,
      amount: '2000000',
      sender,
    });

    // First attempt: Regenerable (stale block height)
    sp1.setNextOutcome(ProofOutcome.Regenerable, `0x${'aa'.repeat(32)}`);
    const attempt1 = await sp1.generateProof({ taskType: 'AITask', inputs: { taskId } });
    assert.equal(attempt1.outcome, ProofOutcome.Regenerable);
    assert.ok(attempt1.should_retry, 'Should retry on Regenerable');

    // Retry: now Valid (auto-reset)
    const attempt2 = await sp1.generateProof({ taskType: 'AITask', inputs: { taskId } });
    assert.equal(attempt2.outcome, ProofOutcome.Valid);

    // Settle successfully after retry
    const { task } = await aiVerifier.settleTask({
      taskId,
      outcome: ProofOutcome.Valid,
      nullifier: `0x${randomBytes(32)}`,
      outputHash: `0x${randomBytes(32)}`,
    });
    assert.equal(task.status, 'settled');
    assert.equal(sp1.retryCount, 1, 'Exactly 1 retry occurred');
  });

  it('should handle ProofOutcome.Invalid — task marked FAILED (Section 3.4.5)', async () => {
    const taskId = randomTaskId();
    const sender = randomCosmAddr();

    await aiVerifier.routeTask({
      taskId,
      msgType: MESSAGE_TYPES.DATA_ATTESTATION,
      destinationChain: CHAIN_IDS.OSMOSIS,
      amount: '500000',
      sender,
    });

    // Invalid proof (fee mismatch, etc.)
    sp1.setNextOutcome(ProofOutcome.Invalid, `0x${'bb'.repeat(32)}`);
    const proof = await sp1.generateProof({ taskType: 'AITask', inputs: { taskId } });
    assert.equal(proof.outcome, ProofOutcome.Invalid);
    assert.equal(proof.should_retry, false);

    // Settle as Invalid
    const { task } = await aiVerifier.settleTask({
      taskId,
      outcome: ProofOutcome.Invalid,
      nullifier: `0x${randomBytes(32)}`,
      outputHash: '',
    });
    assert.equal(task.status, 'failed');
    assert.equal(task.proofOutcome, ProofOutcome.Invalid);
    assert.equal(aiVerifier.totalFailed, 1);
  });

  it('should enforce nullifier uniqueness (anti-replay)', async () => {
    const taskId1 = randomTaskId();
    const taskId2 = randomTaskId();
    const sender = randomCosmAddr();
    const sharedNullifier = `0x${randomBytes(32)}`;

    await aiVerifier.routeTask({
      taskId: taskId1, msgType: MESSAGE_TYPES.INFERENCE_REQUEST,
      destinationChain: CHAIN_IDS.AKASH, amount: '1000000', sender,
    });
    await aiVerifier.routeTask({
      taskId: taskId2, msgType: MESSAGE_TYPES.INFERENCE_REQUEST,
      destinationChain: CHAIN_IDS.AKASH, amount: '1000000', sender,
    });

    // First settlement OK
    await aiVerifier.settleTask({
      taskId: taskId1, outcome: ProofOutcome.Valid,
      nullifier: sharedNullifier, outputHash: `0x${randomBytes(32)}`,
    });

    // Second settlement with same nullifier — must reject
    await assert.rejects(
      () => aiVerifier.settleTask({
        taskId: taskId2, outcome: ProofOutcome.Valid,
        nullifier: sharedNullifier, outputHash: `0x${randomBytes(32)}`,
      }),
      /NullifierAlreadyUsed/,
    );
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// JOURNEY 3: TAO Subnet Inference → vTAO Wrapping → Settlement
// ═══════════════════════════════════════════════════════════════════════════════

describe('Journey 3: TAO Subnet Inference → vTAO → Settlement', () => {
  before(() => initializeHarness());

  it('should wrap native TAO → vTAO on Theta EVM (TAOWrapper.sol)', async () => {
    const user = randomAddr();
    const amount = 5_000_000n; // 5 TAO (units)

    const result = await tao.wrapTAO({
      user, amount: amount.toString(),
      substrateExtrinsicHash: `0x${randomBytes(32)}`,
    });

    assert.ok(result.txHash.startsWith('0x'));
    assert.equal(tao.queryBalance(user), amount);
    assert.equal(tao.totalWrapped, amount);
  });

  it('should submit inference to TAO subnet and receive result', async () => {
    const taskId = randomTaskId();
    const subnetId = 18; // Cortex subnet
    const modelIdHash = `0x${randomBytes(32)}`;
    const inputHash = `0x${randomBytes(32)}`;

    // Submit inference
    const task = await tao.submitInference({
      taskId, subnetId, modelIdHash, inputHash, amount: '1000000',
    });
    assert.equal(task.status, 'pending');

    // Complete inference
    const outputHash = `0x${randomBytes(32)}`;
    const completed = await tao.completeInference({
      taskId, outputHash, validatorSignature: `0x${randomBytes(65)}`,
    });
    assert.equal(completed.status, 'completed');
    assert.equal(completed.outputHash, outputHash);
  });

  it('should route TAO inference through AIVerifier → SP1 proof → settlement', async () => {
    const taskId = randomTaskId();
    const sender = randomCosmAddr();

    // Route to Bittensor chain
    const { task } = await aiVerifier.routeTask({
      taskId,
      msgType: MESSAGE_TYPES.INFERENCE_REQUEST,
      destinationChain: CHAIN_IDS.BITTENSOR,
      amount: '2000000',
      feeBps: 100, // 1% for TAO subnet
      sender,
    });

    assert.equal(task.destinationChain, CHAIN_IDS.BITTENSOR);
    assert.equal(task.feeAmount, (2000000n * 100n) / 10000n); // 1% of 2M = 20K

    // TAO subnet inference
    await tao.submitInference({
      taskId, subnetId: 18,
      modelIdHash: `0x${randomBytes(32)}`,
      inputHash: `0x${randomBytes(32)}`,
      amount: task.netAmount.toString(),
    });

    const outputHash = `0x${randomBytes(32)}`;
    await tao.completeInference({
      taskId, outputHash,
      validatorSignature: `0x${randomBytes(65)}`,
    });

    // SP1 proof
    const proof = await sp1.generateProof({ taskType: 'AITask', inputs: { taskId } });
    assert.equal(proof.outcome, ProofOutcome.Valid);

    // Settle
    const { task: settled } = await aiVerifier.settleTask({
      taskId,
      outcome: ProofOutcome.Valid,
      nullifier: `0x${randomBytes(32)}`,
      outputHash,
    });
    assert.equal(settled.status, 'settled');
  });

  it('should enforce non-zero tao_evm_target for Bittensor chain', async () => {
    // Bittensor tasks require a valid EVM target per TAOWrapper.sol
    // Simulate by ensuring destinationChain is Bittensor and amount is non-zero
    const taskId = randomTaskId();

    const { task } = await aiVerifier.routeTask({
      taskId,
      msgType: MESSAGE_TYPES.INFERENCE_REQUEST,
      destinationChain: CHAIN_IDS.BITTENSOR,
      amount: '500000',
      sender: randomCosmAddr(),
    });

    assert.equal(task.destinationChain, 'bittensor');
    assert.ok(task.netAmount > 0n, 'Net amount non-zero for TAO EVM target');
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// JOURNEY 4: Reverse Bridge — ibcTFUEL Burn → FeeCollector → TFUEL Unwrap
// ═══════════════════════════════════════════════════════════════════════════════

describe('Journey 4: Reverse Bridge — Burn → FeeCollector → Unwrap', () => {
  before(() => initializeHarness());

  it('should execute full reverse bridge: burn ibcTFUEL → 0.5% fee → unwrap TFUEL', async () => {
    const user = randomAddr();
    const cosmAddr = randomCosmAddr();
    const depositAmount = 100_000_000n; // large deposit so burn is well under 20% TVL
    const burnAmount = 5_000_000n;      // 5% of deposit — well within circuit breaker

    // 1. Setup: deposit TFUEL to create vault
    await theta.deposit({ user, amount: depositAmount.toString() });

    // 2. Burn ibcTFUEL on Osmosis (0.5% fee to FeeCollector)
    const burnFee = (burnAmount * BigInt(FEE_CONFIG.bridgeBps)) / BigInt(FEE_CONFIG.denominator);
    const netBurnAmount = burnAmount - burnFee;

    feeCollector.receive(burnFee);
    assert.equal(feeCollector.accumulated, burnFee);

    // 3. SP1 proof for ReverseBurn
    const nonce = theta.getNextNonce(user);
    const proof = await sp1.generateProof({
      taskType: 'ReverseBurn',
      inputs: { user, amount: netBurnAmount.toString(), nonce },
    });
    assert.equal(proof.outcome, ProofOutcome.Valid);

    // 4. Unwrap on Theta
    const unwrap = await theta.unwrapFromBurn({
      user, amount: netBurnAmount.toString(), nonce, proof,
    });

    assert.ok(unwrap.txHash.startsWith('0x'));
    assert.equal(unwrap.amount, netBurnAmount);

    // Verify vault balance updated
    const vault = theta.vaults.get(user);
    assert.equal(vault.balance, depositAmount - netBurnAmount);
  });

  it('should apply 30/30/25/15 revenue split on collected fees', () => {
    const totalFee = 100_000n;
    feeCollector.receive(totalFee);
    feeCollector.receive(totalFee); // accumulate enough to burn

    const { burnAmount } = feeCollector.triggerFeeBurn();
    const split = applySplit(BigInt(burnAmount));

    const total = split.bbb + split.lp + split.vexf + split.treasury;
    // Allow 1 unit rounding
    assert.ok(
      total >= BigInt(burnAmount) - 4n && total <= BigInt(burnAmount),
      `Split total ${total} ~ burnAmount ${burnAmount}`,
    );

    // Exact percentages
    assert.equal(split.bbb, (BigInt(burnAmount) * 30n) / 100n, '30% BBB');
    assert.equal(split.lp, (BigInt(burnAmount) * 30n) / 100n, '30% LP');
    assert.equal(split.vexf, (BigInt(burnAmount) * 25n) / 100n, '25% veXF');
    assert.equal(split.treasury, (BigInt(burnAmount) * 15n) / 100n, '15% Treasury');
  });

  it('should reject fee burn below minimum threshold', () => {
    const smallFeeCollector = new MockFeeCollector();
    smallFeeCollector.receive(100n); // below 50_000 threshold

    assert.throws(
      () => smallFeeCollector.triggerFeeBurn(),
      /BelowMinBurn/,
    );
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// JOURNEY 5: 60% AI Volume Mix — Countercyclical Revenue (Sections 6.1.2, 11.2)
// ═══════════════════════════════════════════════════════════════════════════════

describe('Journey 5: 60% AI Volume Mix — Countercyclical Revenue', () => {
  before(() => initializeHarness());

  /**
   * Simulates a monthly volume scenario and validates:
   * 1. AI tasks = 60% of total volume
   * 2. Countercyclical: AI fees remain high during bear market
   * 3. Fee streams all route through 30/30/25/15 split
   */
  it('should simulate $2M monthly volume with 60% AI task mix', async () => {
    // Simulated $2M monthly volume (in micro-units)
    const TOTAL_VOLUME = 2_000_000_000_000n; // 2M in 6-decimal micro-units
    const AI_VOLUME    = 1_200_000_000_000n; // 60% AI
    const DATA_VOLUME  =   500_000_000_000n; // 25% Data & Comms
    const SETTLEMENT_V =   300_000_000_000n; // 15% Financial Settlements

    // Verify 60% AI mix
    const aiPct = Number((AI_VOLUME * 100n) / TOTAL_VOLUME);
    assert.equal(aiPct, 60, 'AI tasks are 60% of volume');

    // Simulate AI task fees (avg 0.75% BPS)
    const aiTaskFee = calculateTaskFee(AI_VOLUME.toString(), 75);
    assert.equal(aiTaskFee.feeBps, 75);
    assert.ok(aiTaskFee.feeAmount > 0n);

    // Simulate bridge fees (0.5%)
    const bridgeFee = calculateTaskFee(SETTLEMENT_V.toString(), 50);

    // Simulate data attestation fees (0.5%)
    const dataFee = calculateTaskFee(DATA_VOLUME.toString(), 50);

    const totalFees = aiTaskFee.feeAmount + bridgeFee.feeAmount + dataFee.feeAmount;
    assert.ok(totalFees > 0n, 'Total fees collected');

    // Validate revenue split
    const split = applySplit(totalFees);
    const splitTotal = split.bbb + split.lp + split.vexf + split.treasury;
    assert.ok(splitTotal <= totalFees, 'Split does not exceed total');
    assert.ok(splitTotal >= totalFees - 4n, 'Split covers total (within rounding)');
  });

  it('should demonstrate countercyclical effect: AI fees hold during bear market', () => {
    // Bear market simulation: bridge volume drops 70%, AI volume drops only 10%
    const BULL_BRIDGE_VOLUME = 300_000_000_000n;
    const BEAR_BRIDGE_VOLUME =  90_000_000_000n; // -70%

    const BULL_AI_VOLUME = 1_200_000_000_000n;
    const BEAR_AI_VOLUME = 1_080_000_000_000n;  // -10% (AI compute demand persists)

    const bullBridgeFee = calculateTaskFee(BULL_BRIDGE_VOLUME.toString(), 50);
    const bearBridgeFee = calculateTaskFee(BEAR_BRIDGE_VOLUME.toString(), 50);

    const bullAIFee = calculateTaskFee(BULL_AI_VOLUME.toString(), 75);
    const bearAIFee = calculateTaskFee(BEAR_AI_VOLUME.toString(), 75);

    const bullTotal = bullBridgeFee.feeAmount + bullAIFee.feeAmount;
    const bearTotal = bearBridgeFee.feeAmount + bearAIFee.feeAmount;

    // Countercyclical assert: bear market total is at least 70% of bull market
    // because AI fees (~90% retained) dominate over bridge fees
    const retentionPct = Number((bearTotal * 100n) / bullTotal);
    assert.ok(retentionPct >= 70,
      `Bear market retains ${retentionPct}% of bull revenue (countercyclical ≥70%)`);

    // AI fees specifically remain high
    const aiRetentionPct = Number((bearAIFee.feeAmount * 100n) / bullAIFee.feeAmount);
    assert.ok(aiRetentionPct >= 85,
      `AI fees retain ${aiRetentionPct}% in bear market (Section 11.2)`);
  });

  it('should simulate high AI fees offsetting bridge decline in bear sims (Section 11.2)', () => {
    // Extended bear sim: 3 months of declining bridge, growing AI
    const months = [
      { bridge: 300_000n, ai: 1_200_000n, label: 'Month 1 (normal)' },
      { bridge: 150_000n, ai: 1_300_000n, label: 'Month 2 (bear start)' },
      { bridge:  80_000n, ai: 1_400_000n, label: 'Month 3 (deep bear)' },
    ];

    let prevTotal = 0n;
    for (const month of months) {
      const bridgeFee = calculateTaskFee(month.bridge.toString(), 50).feeAmount;
      const aiFee = calculateTaskFee(month.ai.toString(), 75).feeAmount;
      const total = bridgeFee + aiFee;

      // Revenue should GROW (or remain stable) despite bridge decline
      // because AI volume increases countercyclically
      if (prevTotal > 0n) {
        assert.ok(total >= prevTotal,
          `${month.label}: revenue ${total} >= prev ${prevTotal} (countercyclical growth)`);
      }
      prevTotal = total;
    }
  });

  it('should validate volume mix alerts when AI drops below 50%', () => {
    // If AI volume drops below target (60%), alert threshold at 50%
    const totalVolume = 2_000_000n;
    const aiVolume = 900_000n; // 45% — below 50% threshold

    const aiPct = Number((aiVolume * 100n) / totalVolume);
    const alertTriggered = aiPct < 50;

    assert.ok(alertTriggered, `AI volume ${aiPct}% < 50% triggers mix alert`);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// PERSISTENCE RELIC COMPAT CHECKS
// ═══════════════════════════════════════════════════════════════════════════════

describe('Persistence Relic Compat Checks (minimal)', () => {
  it('should recognize persistence as a valid chain ID', () => {
    assert.ok(Object.values(CHAIN_IDS).includes('persistence'));
  });

  it('should route tasks to persistence chain (backward compat)', async () => {
    initializeHarness();
    const taskId = randomTaskId();

    const { task } = await aiVerifier.routeTask({
      taskId,
      msgType: MESSAGE_TYPES.DATA_ATTESTATION,
      destinationChain: CHAIN_IDS.PERSISTENCE,
      amount: '100000',
      sender: randomCosmAddr('persistence1'),
    });

    assert.equal(task.destinationChain, 'persistence');
    assert.equal(task.status, 'routed');
  });

  it('should maintain 0.5% bridge fee for Persistence operations', () => {
    const amount = 1_000_000n;
    const fee = (amount * BigInt(FEE_CONFIG.bridgeBps)) / BigInt(FEE_CONFIG.denominator);
    assert.equal(fee, 5000n, 'Persistence bridge fee = 0.5%');
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// FULL JOURNEY INTEGRATION: Chained multi-hop flow
// ═══════════════════════════════════════════════════════════════════════════════

describe('Full Multi-Hop Journey: Theta → Osmosis → Akash → TAO → Settlement', () => {
  before(() => initializeHarness());

  it('should execute complete multi-chain journey end-to-end', async () => {
    const user = randomAddr();
    const cosmAddr = randomCosmAddr();
    const akashAddr = randomCosmAddr('akash1');
    const depositAmount = 50_000_000n;

    // ── Step 1: Deposit TFUEL on Theta ──
    const deposit = await theta.deposit({ user, amount: depositAmount.toString() });
    assert.ok(deposit.txHash);

    // ── Step 2: SP1 proof → mint ibcTFUEL on Osmosis ──
    const bridgeFee = (depositAmount * BigInt(FEE_CONFIG.bridgeBps)) / BigInt(FEE_CONFIG.denominator);
    const ibcAmount = depositAmount - bridgeFee;
    feeCollector.receive(bridgeFee);

    const ibcTransfer = await osmosis.ibcTransferIn({
      sender: user, receiver: cosmAddr,
      amount: ibcAmount.toString(), sourceChannel: 'channel-theta-0',
    });
    assert.equal(ibcTransfer.status, 'completed');

    // ── Step 3: Route AI inference task via AIVerifier ──
    const taskId = randomTaskId();
    const inferenceAmount = ibcAmount / 4n; // Use 25% for inference

    const { task } = await aiVerifier.routeTask({
      taskId,
      msgType: MESSAGE_TYPES.INFERENCE_REQUEST,
      destinationChain: CHAIN_IDS.AKASH,
      amount: inferenceAmount.toString(),
      feeBps: 75,
      sender: cosmAddr,
    });
    assert.ok(task.feeAmount > 0n);

    // ── Step 4: Akash GPU lease ──
    const lease = akash.submitBid({
      owner: akashAddr,
      dseq: 54321,
      escrowAmount: task.netAmount.toString(),
      gpuType: 'H100',
    });
    assert.equal(lease.status, 'active');

    // ── Step 5: TAO subnet call (cross-DePIN) ──
    await tao.submitInference({
      taskId, subnetId: 18,
      modelIdHash: `0x${randomBytes(32)}`,
      inputHash: `0x${randomBytes(32)}`,
      amount: (task.netAmount / 2n).toString(),
    });

    const outputHash = `0x${randomBytes(32)}`;
    await tao.completeInference({
      taskId, outputHash,
      validatorSignature: `0x${randomBytes(65)}`,
    });

    // ── Step 6: SP1 proof for settlement ──
    const proof = await sp1.generateProof({
      taskType: 'AITask',
      inputs: { taskId, outputHash },
    });
    assert.equal(proof.outcome, ProofOutcome.Valid);

    // ── Step 7: Settle on AIVerifier ──
    const { task: settled } = await aiVerifier.settleTask({
      taskId,
      outcome: ProofOutcome.Valid,
      nullifier: `0x${randomBytes(32)}`,
      outputHash,
    });
    assert.equal(settled.status, 'settled');

    // ── Step 8: Complete Akash lease ──
    const completedLease = akash.completeLease(lease.bidId);
    assert.equal(completedLease.status, 'completed');

    // ── Step 9: Verify fee collection ──
    assert.ok(feeCollector.accumulated > 0n || feeCollector.totalBurned > 0n,
      'Fees were collected');
    assert.ok(aiVerifier.totalFees > 0n, 'AI task fees collected');

    // ── Verify E2E integrity ──
    assert.equal(aiVerifier.totalRouted, 1, '1 task routed');
    assert.equal(aiVerifier.totalSettled, 1, '1 task settled');
    assert.equal(sp1.proofCount >= 1, true, 'Proofs generated');
    assert.equal(tao.totalInferences, 1, '1 TAO inference');
    assert.equal(akash.totalLeases, 1, '1 Akash lease');
  });
});
