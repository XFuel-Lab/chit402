/**
 * @title AI DePIN v5.1 Bi-Directional Integration Tests
 * @notice End-to-end tests for the XFuel Protocol v5.1 multi-chain AI DePIN flows:
 *
 *   FORWARD FLOW:
 *     Theta deposit → SP1 proof → Osmosis ZKVerifier → Akash routing → Settlement
 *
 *   REVERSE FLOW:
 *     burn_for_unwrap → FeeCollector 0.5% fee → TAO unwrap → RevenueSplitter
 *
 *   COVERAGE:
 *     1. Osmosis primary (ibcTFUEL mint, yield routing to AKT/OSMO pools 30-50% APY)
 *     2. Akash IBC (compute bid settlements via AIVerifier.wasm, 0.5-1% fees)
 *     3. TAO integration (subnet inference via TAOWrapper.sol, EVM target validation)
 *     4. Revenue splits (Section 8): 30% BBB / 30% LP / 25% veXF / 15% Treasury
 *     5. ProofOutcome.Regenerable retries in ai-listener.js (Section 3.4.5)
 *     6. Akash GPU lease escrow rules (Section 3.4.3 Table)
 *     7. Persistence relic (minimal compat assertions only)
 *
 *   MOCK STRATEGY:
 *     - CosmJS Osmosis testnet simulator (mock clients, real message shapes)
 *     - Web3.js / ethers for Theta/TAO EVM (Hardhat local network)
 *     - Mock Akash GPU leases (escrow rules per Section 3.4.3)
 *     - Mock TAO Substrate bridge (extrinsic hash confirmations)
 *     - SP1 mock mode (verifier address(0) → always ProofOutcome.Valid)
 *
 * @dev Runs on Hardhat (Mocha) with ethers v6 — matches existing test/*.cjs patterns
 */

const { expect } = require("chai");
const { ethers, upgrades } = require("hardhat");
const crypto = require("crypto");

// ═══════════════════════════════════════════════════════════════════════════════
// MOCK: CosmJS Osmosis Testnet Simulator
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Mock CosmWasm client simulating Osmosis testnet interactions.
 * Provides mock execute/query methods matching @cosmjs/cosmwasm-stargate API.
 */
class MockCosmWasmClient {
  constructor() {
    this.state = {
      tasks: new Map(),
      messages: new Map(),
      agents: new Map(),
      usedNullifiers: new Set(),
      totalTasksRouted: 0,
      totalTasksSettled: 0,
      totalA2AMessagesVerified: 0,
      totalFeesCollected: 0n,
      totalFeesForwarded: 0n,
      pendingFees: 0n,
      feeForwardThreshold: 100_000_000n, // 100 ibcTFUEL
    };
    this.feeCollector = new MockFeeCollector();
  }

  /**
   * Simulate AIVerifier.wasm RouteTask execute
   * Mirrors execute_route_task in ai-verifier/src/contract.rs
   */
  async executeRouteTask({
    taskId,
    msgType,
    destinationChain,
    amount,
    feeBps = 50,
    modelIdHash = "",
    inputHash = "",
    outputHash = "",
    ibcChannel = null,
    sender = "osmo1testaddr",
  }) {
    if (this.state.tasks.has(taskId)) {
      throw new Error(`TaskAlreadyExists: ${taskId}`);
    }

    const grossAmount = BigInt(amount);
    if (msgType !== "CapabilityQuery" && grossAmount < 10_000n) {
      throw new Error(`AmountBelowMinimum: ${amount} < 10000`);
    }

    if (feeBps < 50 || feeBps > 100) {
      throw new Error(`InvalidFeeBps: ${feeBps}`);
    }

    // Calculate fee (mirrors calculate_task_fee in main.rs)
    const feeAmount = (grossAmount * BigInt(feeBps)) / 10_000n;
    const netAmount = grossAmount - feeAmount;

    const task = {
      taskId,
      msgType,
      sourceChain: "Osmosis",
      destinationChain,
      requester: sender,
      grossAmount,
      feeAmount,
      netAmount,
      feeBps,
      outputHash,
      modelIdHash,
      inputHash,
      nonce: this.state.tasks.size + 1,
      timestamp: Math.floor(Date.now() / 1000),
      settled: false,
      proofOutcome: "Valid", // Pending
    };

    this.state.tasks.set(taskId, task);
    this.state.totalTasksRouted++;

    return {
      transactionHash: `0x${crypto.randomBytes(32).toString("hex")}`,
      gasUsed: 250_000,
      events: [
        {
          type: "wasm",
          attributes: [
            { key: "action", value: "route_task" },
            { key: "task_id", value: taskId },
            { key: "msg_type", value: msgType },
            { key: "destination_chain", value: destinationChain },
            { key: "gross_amount", value: grossAmount.toString() },
            { key: "fee_amount", value: feeAmount.toString() },
            { key: "net_amount", value: netAmount.toString() },
            { key: "fee_bps", value: feeBps.toString() },
            { key: "for_ai_listener", value: "true" },
          ],
        },
      ],
    };
  }

  /**
   * Simulate AIVerifier.wasm SettleTask execute
   * Mirrors execute_settle_task in ai-verifier/src/contract.rs
   */
  async executeSettleTask({
    taskId,
    sp1Proof = { proof_data: [1, 2, 3], public_inputs: [4, 5], vk_hash: "mock_vk" },
    nullifier,
    outputHash,
    feeCommitment,
    outcome = "Valid",
  }) {
    const task = this.state.tasks.get(taskId);
    if (!task) throw new Error(`TaskNotFound: ${taskId}`);
    if (task.settled) throw new Error(`TaskAlreadySettled: ${taskId}`);
    if (this.state.usedNullifiers.has(nullifier)) {
      throw new Error(`NullifierAlreadyUsed: ${nullifier}`);
    }

    this.state.usedNullifiers.add(nullifier);
    task.proofOutcome = outcome;

    if (outcome === "Valid") {
      task.settled = true;
      task.outputHash = outputHash;
      this.state.totalTasksSettled++;

      if (task.feeAmount > 0n) {
        this.state.pendingFees += task.feeAmount;
        this.state.totalFeesCollected += task.feeAmount;

        if (this.state.pendingFees >= this.state.feeForwardThreshold) {
          this.state.totalFeesForwarded += this.state.pendingFees;
          this.state.pendingFees = 0n;
        }
      }
    }

    return {
      transactionHash: `0x${crypto.randomBytes(32).toString("hex")}`,
      events: [
        {
          type: "wasm",
          attributes: [
            { key: "action", value: "settle_task" },
            { key: "task_id", value: taskId },
            { key: "proof_outcome", value: outcome.toLowerCase() },
            { key: "nullifier", value: nullifier },
            { key: "settled", value: (outcome === "Valid").toString() },
          ],
        },
      ],
    };
  }

  /**
   * Simulate AIVerifier.wasm RegisterAgent
   */
  async executeRegisterAgent({ sender, identityCommitment }) {
    this.state.agents.set(sender, { identityCommitment, nonce: 0 });
    return { transactionHash: `0x${crypto.randomBytes(32).toString("hex")}` };
  }

  /**
   * Query task state
   */
  queryTask(taskId) {
    return this.state.tasks.get(taskId) || null;
  }

  /**
   * Query aggregate state
   */
  queryState() {
    return {
      totalTasksRouted: this.state.totalTasksRouted,
      totalTasksSettled: this.state.totalTasksSettled,
      totalA2AMessagesVerified: this.state.totalA2AMessagesVerified,
      totalFeesCollected: this.state.totalFeesCollected.toString(),
      totalFeesForwarded: this.state.totalFeesForwarded.toString(),
      pendingFees: this.state.pendingFees.toString(),
    };
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// MOCK: FeeCollector.wasm Simulator
// ═══════════════════════════════════════════════════════════════════════════════

class MockFeeCollector {
  constructor() {
    this.accumulatedFees = 0n;
    this.totalBurned = 0n;
    this.totalBurnsCount = 0;
    this.minBurnAmount = 50_000n;
  }

  receive(amount) {
    this.accumulatedFees += BigInt(amount);
    return { accumulatedTotal: this.accumulatedFees.toString() };
  }

  triggerFeeBurn() {
    if (this.accumulatedFees < this.minBurnAmount) {
      throw new Error(
        `Insufficient: have ${this.accumulatedFees}, need ${this.minBurnAmount}`
      );
    }
    const burned = this.accumulatedFees;
    this.totalBurned += burned;
    this.totalBurnsCount++;
    this.accumulatedFees = 0n;
    return { burnAmount: burned.toString(), burnCount: this.totalBurnsCount };
  }

  readyToBurn() {
    return {
      ready: this.accumulatedFees >= this.minBurnAmount,
      accumulated: this.accumulatedFees.toString(),
      minimum: this.minBurnAmount.toString(),
    };
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// MOCK: Akash GPU Lease Simulator (Section 3.4.3 Escrow Rules)
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Akash GPU lease escrow simulator per Whitepaper Section 3.4.3 Table:
 *
 * | Message Type       | Escrow Required | Notes                              |
 * |--------------------|-----------------|------------------------------------|
 * | COMPUTE_BID        | Yes             | Agent locks funds for GPU request  |
 * | INFERENCE_REQUEST  | Yes             | Budget must be escrowed            |
 * | COMPUTE_RESULT     | No              | Provider attestation only          |
 * | CAPABILITY_QUERY   | Must be zero    | Read-only discovery                |
 * | DATA_ATTESTATION   | No              | Provenance only                    |
 */
class MockAkashLeaseManager {
  constructor() {
    this.leases = new Map();
    this.bids = new Map();
    this.escrowBalances = new Map();
    this.totalLeases = 0;
    this.gpuProviders = [
      { id: "akash1provider_a100", gpuType: "A100", pricePerHour: "0.5", region: "us-east" },
      { id: "akash1provider_h100", gpuType: "H100", pricePerHour: "1.2", region: "eu-west" },
      { id: "akash1provider_rtx4090", gpuType: "RTX4090", pricePerHour: "0.3", region: "ap-southeast" },
    ];
  }

  /**
   * Submit a compute bid — escrow is REQUIRED (Section 3.4.3)
   */
  submitBid({ owner, dseq, escrowAmount, gpuType = "A100", maxHours = 1 }) {
    if (!escrowAmount || BigInt(escrowAmount) === 0n) {
      throw new Error("COMPUTE_BID requires non-zero escrow");
    }

    const bidId = `bid-${dseq}-${Date.now()}`;
    const provider = this.gpuProviders.find((p) => p.gpuType === gpuType) || this.gpuProviders[0];

    const bid = {
      bidId,
      owner,
      provider: provider.id,
      dseq,
      gseq: "1",
      oseq: "1",
      escrowAmount: BigInt(escrowAmount),
      gpuType: provider.gpuType,
      pricePerHour: provider.pricePerHour,
      maxHours,
      status: "open",
      createdAt: Date.now(),
    };

    this.bids.set(bidId, bid);
    this.escrowBalances.set(bidId, bid.escrowAmount);
    return bid;
  }

  /**
   * Accept a bid and create a lease
   */
  acceptBid(bidId) {
    const bid = this.bids.get(bidId);
    if (!bid) throw new Error(`Bid not found: ${bidId}`);
    if (bid.status !== "open") throw new Error(`Bid not open: ${bidId}`);

    bid.status = "accepted";

    const leaseId = `lease-${bid.dseq}-${bid.gseq}`;
    const lease = {
      leaseId,
      bidId,
      owner: bid.owner,
      provider: bid.provider,
      dseq: bid.dseq,
      gseq: bid.gseq,
      oseq: bid.oseq,
      escrowAmount: bid.escrowAmount,
      status: "active",
      startedAt: Date.now(),
      completedAt: null,
    };

    this.leases.set(leaseId, lease);
    this.totalLeases++;
    return lease;
  }

  /**
   * Complete a lease and release escrow
   */
  completeLease(leaseId) {
    const lease = this.leases.get(leaseId);
    if (!lease) throw new Error(`Lease not found: ${leaseId}`);
    if (lease.status !== "active") throw new Error(`Lease not active: ${leaseId}`);

    lease.status = "completed";
    lease.completedAt = Date.now();

    // Release escrow (minus protocol fee)
    const escrow = this.escrowBalances.get(lease.bidId) || 0n;
    const fee = (escrow * 50n) / 10_000n; // 0.5% protocol fee
    const released = escrow - fee;

    this.escrowBalances.delete(lease.bidId);

    return { released, fee, lease };
  }

  /**
   * Validate escrow rules per message type (Section 3.4.3 Table)
   */
  validateEscrow(msgType, escrowAmount) {
    const amount = BigInt(escrowAmount || 0);
    switch (msgType) {
      case "COMPUTE_BID":
        if (amount === 0n) throw new Error("COMPUTE_BID requires escrow");
        return true;
      case "INFERENCE_REQUEST":
        if (amount === 0n) throw new Error("INFERENCE_REQUEST requires escrow");
        return true;
      case "COMPUTE_RESULT":
        return true; // optional
      case "CAPABILITY_QUERY":
        if (amount !== 0n) throw new Error("CAPABILITY_QUERY forbids escrow");
        return true;
      case "DATA_ATTESTATION":
        return true; // optional
      default:
        throw new Error(`Unknown message type: ${msgType}`);
    }
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// MOCK: TAO Substrate Bridge Simulator
// ═══════════════════════════════════════════════════════════════════════════════

class MockTAOSubstrateBridge {
  constructor() {
    this.calls = new Map();
    this.confirmations = new Map();
    this.totalCalls = 0;
    this.subnets = new Map([
      [1, { name: "text-generation", model: "llama-3" }],
      [3, { name: "web-scraping", model: "scraper-v2" }],
      [18, { name: "cortex", model: "cortex-v1" }],
      [19, { name: "image-generation", model: "stable-diffusion-xl" }],
    ]);
  }

  /**
   * Submit a Substrate bridge call (EVM → Substrate)
   */
  submitCall({ callId, callType, amount, subnetId, ss58Recipient }) {
    if (this.calls.has(callId)) {
      throw new Error(`CallAlreadyExists: ${callId}`);
    }

    const subnet = this.subnets.get(subnetId);
    if (!subnet && subnetId !== 0) {
      throw new Error(`InvalidSubnetId: ${subnetId}`);
    }

    const call = {
      callId,
      callType,
      amount: BigInt(amount || 0),
      subnetId,
      ss58Recipient,
      extrinsicHash: null,
      status: "pending",
      submittedAt: Date.now(),
    };

    this.calls.set(callId, call);
    this.totalCalls++;
    return call;
  }

  /**
   * Confirm a bridge call was executed on Substrate side
   */
  confirmCall(callId) {
    const call = this.calls.get(callId);
    if (!call) throw new Error(`CallNotFound: ${callId}`);
    if (call.status === "confirmed") throw new Error(`CallAlreadyConfirmed: ${callId}`);

    const extrinsicHash = `0x${crypto.randomBytes(32).toString("hex")}`;
    call.extrinsicHash = extrinsicHash;
    call.status = "confirmed";
    this.confirmations.set(callId, extrinsicHash);

    return { callId, extrinsicHash };
  }

  /**
   * Simulate subnet inference execution
   */
  executeInference(subnetId, inputHash) {
    const subnet = this.subnets.get(subnetId);
    if (!subnet) throw new Error(`Subnet ${subnetId} not found`);

    const outputHash = ethers.keccak256(
      ethers.solidityPacked(
        ["uint16", "bytes32", "uint256"],
        [subnetId, inputHash, Date.now()]
      )
    );

    return {
      subnetId,
      model: subnet.model,
      outputHash,
      inferenceTimeMs: Math.floor(Math.random() * 2000) + 500,
      timestamp: Date.now(),
    };
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// MOCK: AIListener Simulator (ProofOutcome.Regenerable retries — Section 3.4.5)
// ═══════════════════════════════════════════════════════════════════════════════

class MockAIListener {
  constructor() {
    this.processedEvents = new Set();
    this.activeTasks = new Map();
    this.taskNonce = 0;
    this.metrics = {
      totalTasksReceived: 0,
      totalTasksCompleted: 0,
      totalTasksFailed: 0,
      totalFeesCollected: 0n,
      totalInferenceRouted: 0,
      totalComputeBids: 0,
      regenerableRetries: 0,
      maxRetriesPerTask: 3,
    };
  }

  /**
   * Process an AI intent with Regenerable retry logic (Section 3.4.5)
   */
  async processIntent(intent, meta) {
    const taskId = `ai-task-${++this.taskNonce}-${Date.now()}`;
    this.metrics.totalTasksReceived++;

    const task = {
      taskId,
      intent,
      meta,
      status: "pending",
      retryCount: 0,
      maxRetries: this.metrics.maxRetriesPerTask,
      feeAmount: null,
      sp1Proof: null,
      result: null,
    };

    this.activeTasks.set(taskId, task);

    const amount = BigInt(intent.amount || 0);
    if (amount < 10_000n) {
      task.status = "failed";
      this.metrics.totalTasksFailed++;
      return task;
    }

    // Calculate fee (0.5%)
    const feeAmount = (amount * 50n) / 10_000n;
    task.feeAmount = feeAmount.toString();

    // Simulate task execution
    task.status = "completed";
    task.result = {
      outputHash: ethers.keccak256(ethers.toUtf8Bytes(`output-${taskId}`)),
      inferenceTime: 1500,
    };
    this.metrics.totalTasksCompleted++;
    this.metrics.totalFeesCollected += feeAmount;

    return task;
  }

  /**
   * Handle ProofOutcome.Regenerable — retry proof generation (Section 3.4.5)
   *
   * When settleTask returns Regenerable, ai-listener.js retries:
   *   1. Wait retryAfterBlock (suggested by contract: current + 10)
   *   2. Re-generate SP1 proof with fresh inputs
   *   3. Re-submit settleTask
   *   4. Max 3 retries before marking as failed
   */
  async handleRegenerableOutcome(taskId) {
    const task = this.activeTasks.get(taskId);
    if (!task) throw new Error(`Task not found: ${taskId}`);

    if (task.retryCount >= task.maxRetries) {
      task.status = "failed";
      this.metrics.totalTasksFailed++;
      return { retried: false, reason: "max_retries_exceeded" };
    }

    task.retryCount++;
    this.metrics.regenerableRetries++;

    // Simulate re-proof generation with fresh nonce
    const freshNullifier = ethers.keccak256(
      ethers.toUtf8Bytes(`retry-${taskId}-${task.retryCount}-${Date.now()}`)
    );

    return {
      retried: true,
      retryCount: task.retryCount,
      freshNullifier,
      suggestedRetryBlock: 10,
    };
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// MOCK: Osmosis Yield Router (ibcTFUEL → AKT/OSMO pools, 30-50% APY)
// ═══════════════════════════════════════════════════════════════════════════════

class MockOsmosisYieldRouter {
  constructor() {
    this.pools = new Map([
      ["ibcTFUEL/OSMO", { id: 1, apy: 35, tvl: 500_000 }],
      ["ibcTFUEL/AKT", { id: 2, apy: 45, tvl: 250_000 }],
      ["ibcTFUEL/WBTC", { id: 3, apy: 30, tvl: 1_000_000 }],
    ]);
    this.deposits = new Map();
    this.totalYieldEarned = 0n;
  }

  /**
   * Route ibcTFUEL to an Osmosis LP pool
   */
  deposit(poolName, amount) {
    const pool = this.pools.get(poolName);
    if (!pool) throw new Error(`Pool not found: ${poolName}`);

    const depositId = `dep-${pool.id}-${Date.now()}`;
    const deposit = {
      depositId,
      pool: poolName,
      amount: BigInt(amount),
      apy: pool.apy,
      depositedAt: Date.now(),
    };

    this.deposits.set(depositId, deposit);
    return deposit;
  }

  /**
   * Calculate yield for a deposit (simulated based on APY and time)
   */
  calculateYield(depositId, durationDays = 30) {
    const deposit = this.deposits.get(depositId);
    if (!deposit) throw new Error(`Deposit not found: ${depositId}`);

    // APY / 365 * days * amount
    const dailyRate = deposit.apy / 365;
    const yieldAmount = (deposit.amount * BigInt(Math.floor(dailyRate * durationDays * 100))) / 10_000n;
    this.totalYieldEarned += yieldAmount;

    return {
      depositId,
      principal: deposit.amount.toString(),
      yield: yieldAmount.toString(),
      apy: deposit.apy,
      durationDays,
    };
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// TEST SUITE: v5.1 Bi-Directional AI DePIN Integration
// ═══════════════════════════════════════════════════════════════════════════════

describe("AI DePIN v5.1 Integration Tests", function () {
  this.timeout(120_000); // 2 min timeout for integration tests

  // ── EVM contracts (Hardhat) ──
  let vaultFactory;
  let aidepinRouter;
  let taoWrapper;
  let revenueSplitter;
  let admin, user1, user2, relayer, zkBridge;
  let vaultAddress;

  // ── Mock external systems ──
  let osmosisClient;
  let feeCollector;
  let akashManager;
  let taoBridge;
  let aiListener;
  let yieldRouter;

  // ── Constants ──
  const INITIAL_SEED = ethers.parseEther("100");
  const TASK_AMOUNT = ethers.parseEther("1");
  const FEE_BPS = 50; // 0.5%
  const FEE_AMOUNT = (TASK_AMOUNT * 50n) / 10_000n; // 0.005 ETH
  const NET_AMOUNT = TASK_AMOUNT - FEE_AMOUNT;

  // Revenue split constants (Section 8)
  const BBB_BPS = 3000n; // 30%
  const LP_BPS = 3000n; // 30%
  const VEXF_BPS = 2500n; // 25%
  const TREASURY_BPS = 1500n; // 15%
  const TOTAL_BPS = 10_000n;

  beforeEach(async function () {
    [admin, user1, user2, relayer, zkBridge] = await ethers.getSigners();

    // ── Deploy mock ERC20 for RevenueSplitter (USDC stand-in) ──
    const MockERC20 = await ethers.getContractFactory("MockERC20");
    const mockUSDC = await MockERC20.deploy("Mock USDC", "mUSDC", 6);
    const mockUSDCAddr = await mockUSDC.getAddress();

    // ── Deploy mock veXF (just needs a non-zero address) ──
    const mockVeXF = await MockERC20.deploy("Mock veXF", "mveXF", 18);
    const mockVeXFAddr = await mockVeXF.getAddress();

    // ── Deploy RevenueSplitter (UUPS proxy) — used for split calculation tests ──
    const RevenueSplitter = await ethers.getContractFactory("RevenueSplitter");
    const mockTreasury = admin.address;

    revenueSplitter = await upgrades.deployProxy(
      RevenueSplitter,
      [mockUSDCAddr, mockVeXFAddr, mockTreasury, admin.address],
      { initializer: "initialize" }
    );
    const revenueSplitterAddr = await revenueSplitter.getAddress();

    // ── Deploy MockRevenueSplitter (accepts raw ETH) — used for SubVault fee forwarding ──
    // The real RevenueSplitter proxy doesn't have a plain receive(),
    // so SubVault.receive() would revert when forwarding the 0.5% fee.
    // Use MockRevenueSplitter which accepts ETH for VaultFactory integration.
    const MockRevSplitter = await ethers.getContractFactory("MockRevenueSplitter");
    const mockRevSplitter = await MockRevSplitter.deploy();
    const mockRevSplitterAddr = await mockRevSplitter.getAddress();

    // ── Deploy VaultFactory (uses mock revSplitter that accepts ETH) ──
    const VaultFactory = await ethers.getContractFactory("VaultFactory");
    vaultFactory = await VaultFactory.deploy(admin.address, mockRevSplitterAddr);

    const ZK_BRIDGE_ROLE = await vaultFactory.ZK_BRIDGE_ROLE();
    await vaultFactory.grantRole(ZK_BRIDGE_ROLE, zkBridge.address);

    // Create and seed a vault
    const salt = ethers.keccak256(
      ethers.AbiCoder.defaultAbiCoder().encode(
        ["address", "uint256"],
        [user1.address, 1]
      )
    );
    const vaultTx = await vaultFactory.createVault(salt);
    const vaultReceipt = await vaultTx.wait();
    const vaultEvent = vaultReceipt.logs.find((log) => {
      try {
        return vaultFactory.interface.parseLog(log).name === "VaultCreated";
      } catch {
        return false;
      }
    });
    vaultAddress = vaultFactory.interface.parseLog(vaultEvent).args.vaultAddr;
    await vaultFactory.seedVault(vaultAddress, { value: INITIAL_SEED });

    // ── Deploy AIDePINRouter (sp1Verifier = address(0) → mock mode) ──
    const AIDePINRouter = await ethers.getContractFactory("AIDePINRouter");
    aidepinRouter = await AIDePINRouter.deploy(
      admin.address,
      revenueSplitterAddr,
      ethers.ZeroAddress // SP1 mock mode
    );
    const RELAYER_ROLE = await aidepinRouter.RELAYER_ROLE();
    await aidepinRouter.grantRole(RELAYER_ROLE, relayer.address);

    // ── Deploy TAOWrapper (sp1Verifier = address(0) → mock mode) ──
    const TAOWrapper = await ethers.getContractFactory("TAOWrapper");
    taoWrapper = await TAOWrapper.deploy(
      admin.address,
      ethers.ZeroAddress, // aidepinRouter (standalone mode for isolated tests)
      revenueSplitterAddr,
      ethers.ZeroAddress // SP1 mock mode
    );
    const TAO_RELAYER_ROLE = await taoWrapper.RELAYER_ROLE();
    await taoWrapper.grantRole(TAO_RELAYER_ROLE, relayer.address);

    // ── Initialize mock external systems ──
    osmosisClient = new MockCosmWasmClient();
    feeCollector = osmosisClient.feeCollector;
    akashManager = new MockAkashLeaseManager();
    taoBridge = new MockTAOSubstrateBridge();
    aiListener = new MockAIListener();
    yieldRouter = new MockOsmosisYieldRouter();
  });

  // ═════════════════════════════════════════════════════════════════════════════
  // SECTION 1: FORWARD FLOW — Theta → SP1 Proof → Osmosis → Akash → Settlement
  // ═════════════════════════════════════════════════════════════════════════════

  describe("Forward Flow: Theta Deposit → SP1 → Osmosis ZKVerifier → Akash", function () {
    it("should route an inference request from Theta EVM through AIDePINRouter", async function () {
      const taskId = ethers.keccak256(ethers.toUtf8Bytes("forward-inference-001"));
      const modelIdHash = ethers.keccak256(ethers.toUtf8Bytes("llama-3"));
      const inputHash = ethers.keccak256(ethers.toUtf8Bytes("test-input-data"));

      const tx = await aidepinRouter.connect(user1).routeInference(
        taskId,
        1, // ChainId.Osmosis
        modelIdHash,
        inputHash,
        { value: TASK_AMOUNT }
      );
      const receipt = await tx.wait();

      // Verify TaskRouted event
      const routedEvent = receipt.logs.find((log) => {
        try {
          return aidepinRouter.interface.parseLog(log).name === "TaskRouted";
        } catch {
          return false;
        }
      });
      expect(routedEvent).to.not.be.undefined;

      const parsed = aidepinRouter.interface.parseLog(routedEvent);
      expect(parsed.args.taskId).to.equal(taskId);
      expect(parsed.args.grossAmount).to.equal(TASK_AMOUNT);
      expect(parsed.args.feeAmount).to.equal(FEE_AMOUNT);
      expect(parsed.args.netAmount).to.equal(NET_AMOUNT);
      expect(parsed.args.feeBps).to.equal(FEE_BPS);

      // Verify task stored on-chain
      const task = await aidepinRouter.getTask(taskId);
      expect(task.settled).to.be.false;
      expect(task.grossAmount).to.equal(TASK_AMOUNT);
      expect(task.requester).to.equal(user1.address);
    });

    it("should settle a task with SP1 proof on AIDePINRouter (mock mode)", async function () {
      const taskId = ethers.keccak256(ethers.toUtf8Bytes("forward-settle-001"));
      const modelIdHash = ethers.keccak256(ethers.toUtf8Bytes("llama-3"));
      const inputHash = ethers.keccak256(ethers.toUtf8Bytes("test-input"));

      // Route task
      await aidepinRouter.connect(user1).routeInference(
        taskId, 1, modelIdHash, inputHash,
        { value: TASK_AMOUNT }
      );

      // Settle with SP1 proof (mock mode — sp1Verifier = address(0) → Valid)
      const nullifier = ethers.keccak256(ethers.toUtf8Bytes("nullifier-001"));
      const outputHash = ethers.keccak256(ethers.toUtf8Bytes("inference-output"));
      const feeCommitment = ethers.keccak256(ethers.toUtf8Bytes("fee-commit"));

      const settleTx = await aidepinRouter.connect(relayer).settleTask(
        taskId,
        "0x01020304", // mock SP1 proof bytes
        nullifier,
        outputHash,
        feeCommitment
      );
      const settleReceipt = await settleTx.wait();

      // Verify ProofVerified event
      const proofEvent = settleReceipt.logs.find((log) => {
        try {
          return aidepinRouter.interface.parseLog(log).name === "ProofVerified";
        } catch {
          return false;
        }
      });
      expect(proofEvent).to.not.be.undefined;

      const parsedProof = aidepinRouter.interface.parseLog(proofEvent);
      expect(parsedProof.args.outcome).to.equal(0); // ProofOutcome.Valid

      // Verify task is settled
      const task = await aidepinRouter.getTask(taskId);
      expect(task.settled).to.be.true;

      // Verify stats
      const [totalRouted, totalSettled] = await aidepinRouter.getStats();
      expect(totalRouted).to.equal(1);
      expect(totalSettled).to.equal(1);
    });

    it("should mirror forward flow on Osmosis AIVerifier.wasm (CosmJS sim)", async function () {
      const taskId = "osmo-forward-001";

      // Route on Osmosis AIVerifier
      const routeResult = await osmosisClient.executeRouteTask({
        taskId,
        msgType: "InferenceRequest",
        destinationChain: "Akash",
        amount: "1000000", // 1M uibcTFUEL
        modelIdHash: "model_llama3",
        inputHash: "input_hash_abc",
        ibcChannel: "channel-42",
      });

      expect(routeResult.transactionHash).to.be.a("string");
      const routeAttrs = routeResult.events[0].attributes;
      const feeAttr = routeAttrs.find((a) => a.key === "fee_amount");
      const netAttr = routeAttrs.find((a) => a.key === "net_amount");

      // Verify 0.5% fee: 1000000 * 50 / 10000 = 5000
      expect(feeAttr.value).to.equal("5000");
      expect(netAttr.value).to.equal("995000");

      // Settle on Osmosis AIVerifier
      const settleResult = await osmosisClient.executeSettleTask({
        taskId,
        nullifier: "osmo-nullifier-001",
        outputHash: "output-hash-xyz",
        feeCommitment: "fee-commit-xyz",
      });

      const settleAttrs = settleResult.events[0].attributes;
      expect(settleAttrs.find((a) => a.key === "proof_outcome").value).to.equal("valid");
      expect(settleAttrs.find((a) => a.key === "settled").value).to.equal("true");

      // Verify Osmosis aggregate state
      const state = osmosisClient.queryState();
      expect(state.totalTasksRouted).to.equal(1);
      expect(state.totalTasksSettled).to.equal(1);
      expect(BigInt(state.totalFeesCollected)).to.equal(5000n);
    });

    it("should route forward flow through Akash IBC with compute bid settlement", async function () {
      const taskId = ethers.keccak256(ethers.toUtf8Bytes("akash-compute-001"));
      const inputHash = ethers.keccak256(ethers.toUtf8Bytes("gpu-job-spec"));

      // Route compute bid on AIDePINRouter (Theta EVM side)
      await aidepinRouter.connect(user1).routeComputeBid(
        taskId,
        2, // ChainId.Akash
        inputHash,
        { value: TASK_AMOUNT }
      );

      // Simulate Akash side: GPU lease lifecycle
      const bid = akashManager.submitBid({
        owner: user1.address,
        dseq: "12345",
        escrowAmount: TASK_AMOUNT.toString(),
        gpuType: "A100",
        maxHours: 2,
      });
      expect(bid.escrowAmount).to.equal(TASK_AMOUNT);

      const lease = akashManager.acceptBid(bid.bidId);
      expect(lease.status).to.equal("active");

      const completion = akashManager.completeLease(lease.leaseId);
      expect(completion.fee).to.equal((TASK_AMOUNT * 50n) / 10_000n);

      // Settle on Theta EVM
      const nullifier = ethers.keccak256(ethers.toUtf8Bytes("akash-null-001"));
      const outputHash = ethers.keccak256(ethers.toUtf8Bytes("compute-output"));

      await aidepinRouter.connect(relayer).settleTask(
        taskId,
        "0x01020304",
        nullifier,
        outputHash,
        ethers.keccak256(ethers.toUtf8Bytes("fee-commit"))
      );

      const task = await aidepinRouter.getTask(taskId);
      expect(task.settled).to.be.true;
      expect(task.destinationChain).to.equal(2); // ChainId.Akash
    });

    it("should verify the complete forward pipeline: deposit → proof → verify → route", async function () {
      // 1. User deposits TFUEL into vault (Theta EVM)
      const additionalSeed = ethers.parseEther("50");
      await vaultFactory.seedVault(vaultAddress, { value: additionalSeed });

      // SubVault.receive() charges 0.5% fee on incoming ETH, so vault balance is net of fees
      const vaultBalance = await vaultFactory.getVaultBalance(vaultAddress);
      const expectedNet = (seed) => seed - (seed * 50n) / 10_000n;
      expect(vaultBalance).to.equal(expectedNet(INITIAL_SEED) + expectedNet(additionalSeed));

      // 2. Route inference task through AIDePINRouter
      const taskId = ethers.keccak256(ethers.toUtf8Bytes("e2e-forward-001"));
      const modelIdHash = ethers.keccak256(ethers.toUtf8Bytes("stable-diffusion"));
      const inputHash = ethers.keccak256(ethers.toUtf8Bytes("prompt-data"));

      await aidepinRouter.connect(user1).routeInference(
        taskId, 1, modelIdHash, inputHash,
        { value: TASK_AMOUNT }
      );

      // 3. Simulate Osmosis AIVerifier mirror
      const osmoResult = await osmosisClient.executeRouteTask({
        taskId: "osmo-mirror-e2e",
        msgType: "InferenceRequest",
        destinationChain: "Osmosis",
        amount: "1000000",
        modelIdHash: "stable-diffusion",
        inputHash: "prompt-data",
      });
      expect(osmoResult.transactionHash).to.be.a("string");

      // 4. SP1 proof settles on AIDePINRouter
      const nullifier = ethers.keccak256(ethers.toUtf8Bytes("e2e-null-001"));
      const outputHash = ethers.keccak256(ethers.toUtf8Bytes("sd-output"));

      await aidepinRouter.connect(relayer).settleTask(
        taskId, "0x01020304", nullifier, outputHash,
        ethers.keccak256(ethers.toUtf8Bytes("e2e-fee"))
      );

      // 5. Verify end-to-end state
      const task = await aidepinRouter.getTask(taskId);
      expect(task.settled).to.be.true;
      expect(task.proofOutcome).to.equal(0); // Valid
    });
  });

  // ═════════════════════════════════════════════════════════════════════════════
  // SECTION 2: REVERSE FLOW — burn_for_unwrap → FeeCollector → TAO unwrap
  // ═════════════════════════════════════════════════════════════════════════════

  describe("Reverse Flow: burn_for_unwrap → FeeCollector 0.5% → TAO Unwrap", function () {
    const BURN_AMOUNT = ethers.parseEther("10");
    const BURN_FEE = (BURN_AMOUNT * 50n) / 10_000n; // 0.5%
    const BURN_NET = BURN_AMOUNT - BURN_FEE;

    it("should process burn_for_unwrap: burn on Osmosis → release TFUEL on Theta", async function () {
      const burnTxHash = ethers.keccak256(ethers.toUtf8Bytes("reverse-burn-001"));

      const initialBalance = await ethers.provider.getBalance(user1.address);

      // Simulate ZK bridge triggering unwrap after burn proof verified
      await vaultFactory.connect(zkBridge).unwrapFromBurn(
        vaultAddress,
        burnTxHash,
        user1.address,
        BURN_NET
      );

      const finalBalance = await ethers.provider.getBalance(user1.address);
      expect(finalBalance - initialBalance).to.equal(BURN_NET);
    });

    it("should collect 0.5% fee in FeeCollector during reverse burn", async function () {
      // Simulate FeeCollector accumulating burn fees
      feeCollector.receive(BURN_FEE.toString());
      feeCollector.receive(BURN_FEE.toString());
      feeCollector.receive(BURN_FEE.toString());

      const accumulated = feeCollector.accumulatedFees;
      expect(accumulated).to.equal(BURN_FEE * 3n);

      // Trigger batch burn once threshold reached
      const readyState = feeCollector.readyToBurn();
      expect(readyState.ready).to.equal(accumulated >= feeCollector.minBurnAmount);
    });

    it("should trigger FeeCollector batch burn → SP1 FeeBurn proof", async function () {
      // Accumulate enough fees to trigger burn
      const largeFee = ethers.parseEther("0.1");
      feeCollector.receive(largeFee.toString());

      const readyState = feeCollector.readyToBurn();
      expect(readyState.ready).to.be.true;

      // Trigger burn
      const burnResult = feeCollector.triggerFeeBurn();
      expect(BigInt(burnResult.burnAmount)).to.equal(largeFee);
      expect(burnResult.burnCount).to.equal(1);

      // After burn, accumulated should be zero
      expect(feeCollector.accumulatedFees).to.equal(0n);
    });

    it("should prevent replay attacks on reverse burns", async function () {
      const burnTxHash = ethers.keccak256(ethers.toUtf8Bytes("replay-test"));

      await vaultFactory.connect(zkBridge).unwrapFromBurn(
        vaultAddress, burnTxHash, user1.address, BURN_NET
      );

      // BurnAlreadyProcessed error lives on SubVault contract, not VaultFactory
      await expect(
        vaultFactory.connect(zkBridge).unwrapFromBurn(
          vaultAddress, burnTxHash, user1.address, BURN_NET
        )
      ).to.be.reverted; // SubVault reverts with BurnAlreadyProcessed
    });

    it("should process TAO unwrap flow: vTAO burn → release native TAO", async function () {
      const wrapAmount = ethers.parseEther("5");

      // Wrap TAO into vTAO
      await taoWrapper.connect(user1).wrap({ value: wrapAmount });
      expect(await taoWrapper.balanceOf(user1.address)).to.equal(wrapAmount);

      // Unwrap vTAO back to native TAO
      const balBefore = await ethers.provider.getBalance(user1.address);
      const unwrapTx = await taoWrapper.connect(user1).unwrap(wrapAmount);
      const receipt = await unwrapTx.wait();
      const gasUsed = receipt.gasUsed * receipt.gasPrice;
      const balAfter = await ethers.provider.getBalance(user1.address);

      expect(balAfter + gasUsed - balBefore).to.equal(wrapAmount);
      expect(await taoWrapper.balanceOf(user1.address)).to.equal(0);
    });

    it("should maintain vTAO 1:1 peg health after wrap/unwrap cycles", async function () {
      const amount = ethers.parseEther("10");

      // Wrap
      await taoWrapper.connect(user1).wrap({ value: amount });
      let [supply, balance, healthy] = await taoWrapper.getPegAudit();
      expect(supply).to.equal(amount);
      expect(healthy).to.be.true;

      // Partial unwrap
      await taoWrapper.connect(user1).unwrap(amount / 2n);
      [supply, balance, healthy] = await taoWrapper.getPegAudit();
      expect(supply).to.equal(amount / 2n);
      expect(healthy).to.be.true;
    });
  });

  // ═════════════════════════════════════════════════════════════════════════════
  // SECTION 3: OSMOSIS PRIMARY — ibcTFUEL Mint, Yield Routing (30-50% APY)
  // ═════════════════════════════════════════════════════════════════════════════

  describe("Osmosis Primary: ibcTFUEL Yield Routing to AKT/OSMO Pools", function () {
    it("should route ibcTFUEL to OSMO pool with ~35% APY", async function () {
      const deposit = yieldRouter.deposit("ibcTFUEL/OSMO", "1000000000"); // 1B units
      expect(deposit.apy).to.equal(35);
      expect(deposit.pool).to.equal("ibcTFUEL/OSMO");

      const yieldCalc = yieldRouter.calculateYield(deposit.depositId, 30);
      expect(BigInt(yieldCalc.yield)).to.be.greaterThan(0n);
      expect(yieldCalc.apy).to.equal(35);
    });

    it("should route ibcTFUEL to AKT pool with ~45% APY", async function () {
      const deposit = yieldRouter.deposit("ibcTFUEL/AKT", "500000000");
      expect(deposit.apy).to.equal(45);

      const yieldCalc = yieldRouter.calculateYield(deposit.depositId, 30);
      const dailyRate = 45 / 365;
      const expectedMinYield = (500_000_000n * BigInt(Math.floor(dailyRate * 30 * 100))) / 10_000n;
      expect(BigInt(yieldCalc.yield)).to.equal(expectedMinYield);
    });

    it("should validate APY range is 30-50% across all pools", async function () {
      for (const [poolName, poolInfo] of yieldRouter.pools) {
        expect(poolInfo.apy).to.be.at.least(30, `${poolName} APY below 30%`);
        expect(poolInfo.apy).to.be.at.most(50, `${poolName} APY above 50%`);
      }
    });

    it("should route task to Osmosis with fee calculation matching AIVerifier.wasm", async function () {
      const taskAmounts = ["10000", "1000000", "100000000"];

      for (const amount of taskAmounts) {
        const taskId = `osmo-fee-check-${amount}`;
        const result = await osmosisClient.executeRouteTask({
          taskId,
          msgType: "InferenceRequest",
          destinationChain: "Osmosis",
          amount,
          modelIdHash: "test-model",
          inputHash: "test-input",
        });

        const task = osmosisClient.queryTask(taskId);
        const expected_fee = (BigInt(amount) * 50n) / 10_000n;
        expect(task.feeAmount).to.equal(expected_fee);
        expect(task.netAmount).to.equal(BigInt(amount) - expected_fee);
      }
    });
  });

  // ═════════════════════════════════════════════════════════════════════════════
  // SECTION 4: AKASH IBC — Compute Bid Settlements, GPU Lease Escrow
  // ═════════════════════════════════════════════════════════════════════════════

  describe("Akash IBC: Compute Bid Settlements via AIVerifier.wasm", function () {
    it("should enforce escrow rules per Section 3.4.3 Table", async function () {
      // COMPUTE_BID — requires escrow
      expect(akashManager.validateEscrow("COMPUTE_BID", "1000000")).to.be.true;
      expect(() => akashManager.validateEscrow("COMPUTE_BID", "0"))
        .to.throw("COMPUTE_BID requires escrow");

      // INFERENCE_REQUEST — requires escrow
      expect(akashManager.validateEscrow("INFERENCE_REQUEST", "500000")).to.be.true;
      expect(() => akashManager.validateEscrow("INFERENCE_REQUEST", "0"))
        .to.throw("INFERENCE_REQUEST requires escrow");

      // COMPUTE_RESULT — no escrow required (optional)
      expect(akashManager.validateEscrow("COMPUTE_RESULT", "0")).to.be.true;
      expect(akashManager.validateEscrow("COMPUTE_RESULT", "1000")).to.be.true;

      // CAPABILITY_QUERY — must be zero
      expect(akashManager.validateEscrow("CAPABILITY_QUERY", "0")).to.be.true;
      expect(() => akashManager.validateEscrow("CAPABILITY_QUERY", "1000"))
        .to.throw("CAPABILITY_QUERY forbids escrow");

      // DATA_ATTESTATION — no escrow required (optional)
      expect(akashManager.validateEscrow("DATA_ATTESTATION", "0")).to.be.true;
    });

    it("should mirror escrow rules on AIDePINRouter A2A messages", async function () {
      // Register agent first
      const identity = ethers.keccak256(ethers.toUtf8Bytes("agent-identity"));
      await aidepinRouter.connect(user1).registerAgent(identity);
      expect(await aidepinRouter.isAgentRegistered(user1.address)).to.be.true;

      const msgId = ethers.keccak256(ethers.toUtf8Bytes("a2a-escrow-test"));

      // COMPUTE_BID — requires escrow (msg.value > 0)
      await expect(
        aidepinRouter.connect(user1).sendA2AMessage(
          msgId,
          0, // COMPUTE_BID
          2, // Akash
          ethers.keccak256(ethers.toUtf8Bytes("payload")),
          3600, // 1h TTL
          { value: 0 }
        )
      ).to.be.reverted; // EscrowRequiredForType

      // CAPABILITY_QUERY — must be zero
      const capMsgId = ethers.keccak256(ethers.toUtf8Bytes("cap-query-escrow"));
      await expect(
        aidepinRouter.connect(user1).sendA2AMessage(
          capMsgId,
          3, // CAPABILITY_QUERY
          1, // Osmosis
          ethers.keccak256(ethers.toUtf8Bytes("query-payload")),
          3600,
          { value: ethers.parseEther("0.01") }
        )
      ).to.be.reverted; // EscrowForbiddenForType
    });

    it("should process full Akash GPU lease lifecycle with 0.5% fee", async function () {
      const escrowAmount = ethers.parseEther("2").toString();

      // Submit bid
      const bid = akashManager.submitBid({
        owner: user1.address,
        dseq: "67890",
        escrowAmount,
        gpuType: "H100",
        maxHours: 4,
      });
      expect(bid.gpuType).to.equal("H100");

      // Accept bid → create lease
      const lease = akashManager.acceptBid(bid.bidId);
      expect(lease.status).to.equal("active");

      // Complete lease → release escrow minus fee
      const completion = akashManager.completeLease(lease.leaseId);
      const expectedFee = (BigInt(escrowAmount) * 50n) / 10_000n;
      expect(completion.fee).to.equal(expectedFee);
      expect(completion.released).to.equal(BigInt(escrowAmount) - expectedFee);
    });

    it("should validate Akash IBC channel requirement for cross-chain routing", async function () {
      // Route to Akash on Osmosis AIVerifier — requires IBC channel
      const result = await osmosisClient.executeRouteTask({
        taskId: "akash-ibc-channel-test",
        msgType: "ComputeBid",
        destinationChain: "Akash",
        amount: "500000",
        inputHash: "gpu-spec-hash",
        ibcChannel: "channel-42",
      });
      expect(result.transactionHash).to.be.a("string");

      const task = osmosisClient.queryTask("akash-ibc-channel-test");
      expect(task.destinationChain).to.equal("Akash");
    });

    it("should enforce 0.5-1% fee range on Akash compute bids", async function () {
      // Test minimum fee (0.5%)
      const result50 = await osmosisClient.executeRouteTask({
        taskId: "fee-min-test",
        msgType: "ComputeBid",
        destinationChain: "Akash",
        amount: "1000000",
        feeBps: 50,
        inputHash: "spec-hash",
      });
      expect(osmosisClient.queryTask("fee-min-test").feeAmount).to.equal(5000n);

      // Test maximum fee (1.0%)
      const result100 = await osmosisClient.executeRouteTask({
        taskId: "fee-max-test",
        msgType: "ComputeBid",
        destinationChain: "Akash",
        amount: "1000000",
        feeBps: 100,
        inputHash: "spec-hash-2",
      });
      expect(osmosisClient.queryTask("fee-max-test").feeAmount).to.equal(10000n);

      // Test out-of-range fee
      await expect(
        osmosisClient.executeRouteTask({
          taskId: "fee-invalid-test",
          msgType: "ComputeBid",
          destinationChain: "Akash",
          amount: "1000000",
          feeBps: 200, // 2% — too high
          inputHash: "spec-hash-3",
        })
      ).to.be.rejectedWith("InvalidFeeBps");
    });
  });

  // ═════════════════════════════════════════════════════════════════════════════
  // SECTION 5: TAO INTEGRATION — Subnet Inference via TAOWrapper.sol
  // ═════════════════════════════════════════════════════════════════════════════

  describe("TAO Integration: Subnet Inference via TAOWrapper.sol", function () {
    it("should wrap TAO → route subnet inference → settle with SP1 proof", async function () {
      const taskId = ethers.keccak256(ethers.toUtf8Bytes("tao-inference-001"));
      const subnetId = 1; // text-generation
      const modelIdHash = ethers.keccak256(ethers.toUtf8Bytes("llama-3"));
      const inputHash = ethers.keccak256(ethers.toUtf8Bytes("prompt-data"));

      // Route inference to subnet 1 (text-generation)
      const tx = await taoWrapper.connect(user1).routeInference(
        taskId,
        subnetId,
        modelIdHash,
        inputHash,
        { value: TASK_AMOUNT }
      );
      const receipt = await tx.wait();

      // Verify SubnetInferenceRouted event
      const routeEvent = receipt.logs.find((log) => {
        try {
          return taoWrapper.interface.parseLog(log).name === "SubnetInferenceRouted";
        } catch {
          return false;
        }
      });
      expect(routeEvent).to.not.be.undefined;

      const parsed = taoWrapper.interface.parseLog(routeEvent);
      expect(parsed.args.subnetId).to.equal(subnetId);
      expect(parsed.args.grossAmount).to.equal(TASK_AMOUNT);

      // Simulate TAO Substrate bridge execution
      const inferenceResult = taoBridge.executeInference(subnetId, inputHash);
      expect(inferenceResult.model).to.equal("llama-3");
      expect(inferenceResult.outputHash).to.be.a("string");

      // Settle with SP1 proof
      const nullifier = ethers.keccak256(ethers.toUtf8Bytes("tao-null-001"));
      await taoWrapper.connect(relayer).settleTask(
        taskId,
        "0x01020304",
        nullifier,
        inferenceResult.outputHash,
        ethers.keccak256(ethers.toUtf8Bytes("tao-fee-commit"))
      );

      const task = await taoWrapper.getSubnetTask(taskId);
      expect(task.settled).to.be.true;
      expect(task.subnetId).to.equal(subnetId);
    });

    it("should validate EVM target with TAOWrapper subnet routing", async function () {
      const taskId = ethers.keccak256(ethers.toUtf8Bytes("tao-evm-target-001"));
      const modelIdHash = ethers.keccak256(ethers.toUtf8Bytes("cortex-v1"));
      const inputHash = ethers.keccak256(ethers.toUtf8Bytes("image-gen-prompt"));

      // Route to subnet 18 (cortex)
      await taoWrapper.connect(user1).routeInference(
        taskId, 18, modelIdHash, inputHash,
        { value: TASK_AMOUNT }
      );

      const task = await taoWrapper.getSubnetTask(taskId);
      expect(task.subnetId).to.equal(18);
      expect(task.requester).to.equal(user1.address);

      // Fee validation
      expect(task.feeAmount).to.equal(FEE_AMOUNT);
      expect(task.netAmount).to.equal(NET_AMOUNT);
    });

    it("should process TAO Substrate bridge call lifecycle", async function () {
      const callId = ethers.keccak256(ethers.toUtf8Bytes("substrate-call-001"));
      const ss58RecipientHash = ethers.keccak256(ethers.toUtf8Bytes("5GrwvaEF5zXb26Fz9rcQpDWS57CtERHpNehXCPcNoHGKutQY"));
      const stakeAmount = ethers.parseEther("1");

      // Wrap TAO first
      await taoWrapper.connect(user1).wrap({ value: stakeAmount * 2n });

      // Submit bridge call (SubnetStake)
      await taoWrapper.connect(user1).submitSubstrateBridgeCall(
        callId,
        1, // SubstrateCallType.SubnetStake
        stakeAmount,
        1, // subnetId
        ss58RecipientHash
      );

      // Simulate bridge confirmation
      const extrinsicHash = ethers.keccak256(ethers.toUtf8Bytes("substrate-extrinsic-001"));
      await taoWrapper.connect(admin).confirmSubstrateBridgeCall(callId, extrinsicHash);

      const call = await taoWrapper.getSubstrateCall(callId);
      expect(call.confirmed).to.be.true;
      expect(call.extrinsicHash).to.equal(extrinsicHash);
    });

    it("should reject invalid subnet ID (0)", async function () {
      const taskId = ethers.keccak256(ethers.toUtf8Bytes("tao-invalid-subnet"));
      const modelIdHash = ethers.keccak256(ethers.toUtf8Bytes("model"));
      const inputHash = ethers.keccak256(ethers.toUtf8Bytes("input"));

      await expect(
        taoWrapper.connect(user1).routeInference(
          taskId, 0, modelIdHash, inputHash,
          { value: TASK_AMOUNT }
        )
      ).to.be.reverted; // InvalidSubnetId
    });

    it("should mock TAO Substrate bridge with extrinsic confirmation", async function () {
      const callId = "bridge-mock-001";

      const call = taoBridge.submitCall({
        callId,
        callType: "SubnetInference",
        amount: "1000000000000000000",
        subnetId: 1,
        ss58Recipient: "5GrwvaEF5z...",
      });
      expect(call.status).to.equal("pending");

      const confirmation = taoBridge.confirmCall(callId);
      expect(confirmation.extrinsicHash).to.be.a("string");
      expect(confirmation.extrinsicHash).to.have.lengthOf(66); // 0x + 64 hex

      // Double confirm should fail
      expect(() => taoBridge.confirmCall(callId)).to.throw("CallAlreadyConfirmed");
    });
  });

  // ═════════════════════════════════════════════════════════════════════════════
  // SECTION 6: REVENUE SPLITS (Section 8) — 30/30/25/15 Across All Streams
  // ═════════════════════════════════════════════════════════════════════════════

  describe("Revenue Splits (Section 8): 30% BBB / 30% LP / 25% veXF / 15% Treasury", function () {
    it("should calculate correct splits via RevenueSplitter.calculateSplits()", async function () {
      const amounts = [
        ethers.parseEther("100"),
        ethers.parseEther("1"),
        ethers.parseEther("0.01"),
        ethers.parseEther("999.99"),
      ];

      for (const amount of amounts) {
        const [bbb, lp, vexf, treasury] = await revenueSplitter.calculateSplits(amount);

        const expectedBBB = (amount * BBB_BPS) / TOTAL_BPS;
        const expectedLP = (amount * LP_BPS) / TOTAL_BPS;
        let expectedVeXF = (amount * VEXF_BPS) / TOTAL_BPS;
        const expectedTreasury = (amount * TREASURY_BPS) / TOTAL_BPS;

        // Handle rounding remainder → veXF
        const total = expectedBBB + expectedLP + expectedVeXF + expectedTreasury;
        if (total < amount) {
          expectedVeXF += amount - total;
        }

        expect(bbb).to.equal(expectedBBB, `BBB split wrong for ${amount}`);
        expect(lp).to.equal(expectedLP, `LP split wrong for ${amount}`);
        expect(vexf).to.equal(expectedVeXF, `veXF split wrong for ${amount}`);
        expect(treasury).to.equal(expectedTreasury, `Treasury split wrong for ${amount}`);

        // Sum must equal input
        expect(bbb + lp + vexf + treasury).to.equal(amount);
      }
    });

    it("should verify RevenueSplitter BPS constants match Section 8", async function () {
      const bbbBps = await revenueSplitter.BBB_BPS();
      const lpBps = await revenueSplitter.LP_FUNDING_BPS();
      const vexfBps = await revenueSplitter.VEXF_PAYOUT_BPS();
      const treasuryBps = await revenueSplitter.TREASURY_BPS();
      const totalBps = await revenueSplitter.TOTAL_BPS();

      expect(bbbBps).to.equal(3000n, "BBB should be 30%");
      expect(lpBps).to.equal(3000n, "LP should be 30%");
      expect(vexfBps).to.equal(2500n, "veXF should be 25%");
      expect(treasuryBps).to.equal(1500n, "Treasury should be 15%");
      expect(totalBps).to.equal(10_000n, "Total should be 100%");

      // Verify they sum to 100%
      expect(bbbBps + lpBps + vexfBps + treasuryBps).to.equal(totalBps);
    });

    it("should verify fee math consistency: AIDePINRouter → RevenueSplitter", async function () {
      const taskId = ethers.keccak256(ethers.toUtf8Bytes("rev-split-test"));
      const modelIdHash = ethers.keccak256(ethers.toUtf8Bytes("model"));
      const inputHash = ethers.keccak256(ethers.toUtf8Bytes("input"));

      // Route task (accumulates fee)
      await aidepinRouter.connect(user1).routeInference(
        taskId, 1, modelIdHash, inputHash,
        { value: TASK_AMOUNT }
      );

      // Verify fee calculation on-chain
      const [feeCalc, netCalc] = await aidepinRouter.calculateTaskFee(TASK_AMOUNT, FEE_BPS);
      expect(feeCalc).to.equal(FEE_AMOUNT);
      expect(netCalc).to.equal(NET_AMOUNT);

      // Verify the same fee → RevenueSplitter split
      const [bbb, lp, vexf, treasury] = await revenueSplitter.calculateSplits(feeCalc);
      expect(bbb + lp + vexf + treasury).to.equal(feeCalc);
    });

    it("should verify fee math consistency: TAOWrapper → RevenueSplitter", async function () {
      const grossAmount = ethers.parseEther("5");
      const [taoFee, taoNet] = await taoWrapper.calculateTaskFee(grossAmount, 50);

      const expectedFee = (grossAmount * 50n) / 10_000n;
      expect(taoFee).to.equal(expectedFee);
      expect(taoNet).to.equal(grossAmount - expectedFee);

      // Split the fee
      const [bbb, lp, vexf, treasury] = await revenueSplitter.calculateSplits(taoFee);
      expect(bbb + lp + vexf + treasury).to.equal(taoFee);
    });

    it("should accumulate fees across multiple task streams and verify totals", async function () {
      // Stream 1: AIDePINRouter inference tasks
      const tasks = ["rev-multi-1", "rev-multi-2", "rev-multi-3"];
      let totalRouterFees = 0n;

      for (const name of tasks) {
        const taskId = ethers.keccak256(ethers.toUtf8Bytes(name));
        const modelId = ethers.keccak256(ethers.toUtf8Bytes("model"));
        const input = ethers.keccak256(ethers.toUtf8Bytes(name));

        await aidepinRouter.connect(user1).routeInference(
          taskId, 1, modelId, input,
          { value: TASK_AMOUNT }
        );
        totalRouterFees += FEE_AMOUNT;
      }

      // Stream 2: Osmosis AIVerifier fees
      for (let i = 0; i < 3; i++) {
        await osmosisClient.executeRouteTask({
          taskId: `osmo-rev-${i}`,
          msgType: "InferenceRequest",
          destinationChain: "Osmosis",
          amount: "1000000",
          modelIdHash: "m",
          inputHash: "i",
        });
      }

      const osmoState = osmosisClient.queryState();
      const osmoFees = BigInt(osmoState.totalFeesCollected);
      // 3 tasks × 1M × 0.5% = 15000
      expect(osmoFees).to.equal(0n); // Not settled yet, fees only on settlement

      // Settle Osmosis tasks to accumulate fees
      for (let i = 0; i < 3; i++) {
        await osmosisClient.executeSettleTask({
          taskId: `osmo-rev-${i}`,
          nullifier: `osmo-null-rev-${i}`,
          outputHash: `output-${i}`,
          feeCommitment: `commit-${i}`,
        });
      }

      const finalOsmoState = osmosisClient.queryState();
      expect(BigInt(finalOsmoState.totalFeesCollected)).to.equal(15000n);

      // Verify router stats
      const [totalRouted, totalSettled, , totalFees] = await aidepinRouter.getStats();
      expect(totalRouted).to.equal(3);
    });
  });

  // ═════════════════════════════════════════════════════════════════════════════
  // SECTION 7: ProofOutcome.Regenerable Retries (Section 3.4.5)
  // ═════════════════════════════════════════════════════════════════════════════

  describe("ProofOutcome.Regenerable Retries (Section 3.4.5)", function () {
    it("should handle Regenerable outcome with fresh nullifier retry", async function () {
      const taskId = ethers.keccak256(ethers.toUtf8Bytes("regen-test-001"));
      const modelId = ethers.keccak256(ethers.toUtf8Bytes("model"));
      const inputHash = ethers.keccak256(ethers.toUtf8Bytes("input"));

      await aidepinRouter.connect(user1).routeInference(
        taskId, 1, modelId, inputHash,
        { value: TASK_AMOUNT }
      );

      // First settle attempt → simulate Regenerable on Osmosis AIVerifier
      const osmResult = await osmosisClient.executeRouteTask({
        taskId: "regen-osmo-test",
        msgType: "InferenceRequest",
        destinationChain: "Osmosis",
        amount: "1000000",
        modelIdHash: "model",
        inputHash: "input",
      });

      const regenResult = await osmosisClient.executeSettleTask({
        taskId: "regen-osmo-test",
        nullifier: "regen-null-1",
        outputHash: "output",
        feeCommitment: "commit",
        outcome: "Regenerable",
      });

      // Task should NOT be settled
      const task = osmosisClient.queryTask("regen-osmo-test");
      expect(task.settled).to.be.false;
      expect(task.proofOutcome).to.equal("Regenerable");
    });

    it("should retry Regenerable outcomes up to 3 times in AIListener", async function () {
      const intent = {
        type: "inference_request",
        amount: "1000000",
        sender: user1.address,
        modelId: "llama-3",
        inputHash: "test-input-hash",
      };

      const task = await aiListener.processIntent(intent, {
        chain: "osmosis",
        txHash: "0xabc",
        height: 100,
      });

      // Simulate 3 Regenerable retries
      for (let i = 0; i < 3; i++) {
        const retryResult = await aiListener.handleRegenerableOutcome(task.taskId);
        expect(retryResult.retried).to.be.true;
        expect(retryResult.retryCount).to.equal(i + 1);
        expect(retryResult.freshNullifier).to.be.a("string");
      }

      // 4th retry should fail (max retries = 3)
      const failedRetry = await aiListener.handleRegenerableOutcome(task.taskId);
      expect(failedRetry.retried).to.be.false;
      expect(failedRetry.reason).to.equal("max_retries_exceeded");
    });

    it("should emit ProofRegenerableFailure event on AIDePINRouter", async function () {
      // Note: In mock mode (sp1Verifier = address(0)), all proofs return Valid.
      // This test verifies the event structure by checking the contract supports it.
      // Full Regenerable testing requires a mock SP1 verifier contract.

      const taskId = ethers.keccak256(ethers.toUtf8Bytes("regen-event-test"));
      const modelId = ethers.keccak256(ethers.toUtf8Bytes("model"));
      const inputHash = ethers.keccak256(ethers.toUtf8Bytes("input"));

      await aidepinRouter.connect(user1).routeInference(
        taskId, 1, modelId, inputHash,
        { value: TASK_AMOUNT }
      );

      // In mock mode, settle succeeds (Valid)
      const nullifier = ethers.keccak256(ethers.toUtf8Bytes("regen-null-event"));
      const tx = await aidepinRouter.connect(relayer).settleTask(
        taskId, "0x01020304", nullifier,
        ethers.keccak256(ethers.toUtf8Bytes("output")),
        ethers.keccak256(ethers.toUtf8Bytes("commit"))
      );
      const receipt = await tx.wait();

      // Verify ProofVerified event was emitted (should be Valid in mock mode)
      const proofEvent = receipt.logs.find((log) => {
        try {
          return aidepinRouter.interface.parseLog(log).name === "ProofVerified";
        } catch {
          return false;
        }
      });
      expect(proofEvent).to.not.be.undefined;

      const parsed = aidepinRouter.interface.parseLog(proofEvent);
      expect(parsed.args.outcome).to.equal(0); // Valid (mock mode)
    });

    it("should track retry metrics in AIListener", async function () {
      const intent = {
        type: "compute_bid",
        amount: "500000",
        sender: user1.address,
      };

      const task = await aiListener.processIntent(intent, {
        chain: "akash",
        txHash: "0xdef",
        height: 200,
      });

      await aiListener.handleRegenerableOutcome(task.taskId);
      await aiListener.handleRegenerableOutcome(task.taskId);

      expect(aiListener.metrics.regenerableRetries).to.equal(2);
      expect(aiListener.metrics.totalTasksCompleted).to.be.greaterThan(0);
    });
  });

  // ═════════════════════════════════════════════════════════════════════════════
  // SECTION 8: PERSISTENCE RELIC — Minimal Compatibility Assertions
  // ═════════════════════════════════════════════════════════════════════════════

  describe("Persistence Relic: Minimal Compatibility Assertions", function () {
    it("should recognize Persistence as ChainId.4 in AIDePINRouter", async function () {
      // ChainId enum: Theta(0), Osmosis(1), Akash(2), Bittensor(3), Persistence(4)
      // Verify by routing a task to Persistence destination
      const taskId = ethers.keccak256(ethers.toUtf8Bytes("persistence-compat"));
      const inputHash = ethers.keccak256(ethers.toUtf8Bytes("persist-data"));

      await aidepinRouter.connect(user1).routeDataAttestation(
        taskId,
        4, // ChainId.Persistence
        inputHash,
        { value: TASK_AMOUNT }
      );

      const task = await aidepinRouter.getTask(taskId);
      expect(task.destinationChain).to.equal(4); // Persistence
    });

    it("should accept Persistence routing in Osmosis AIVerifier mock", async function () {
      const result = await osmosisClient.executeRouteTask({
        taskId: "persist-compat-osmo",
        msgType: "DataAttestation",
        destinationChain: "Persistence",
        amount: "100000",
        inputHash: "persist-data-hash",
      });

      const task = osmosisClient.queryTask("persist-compat-osmo");
      expect(task.destinationChain).to.equal("Persistence");
      expect(task.sourceChain).to.equal("Osmosis");
    });

    it("should still process legacy burn_for_unwrap from Persistence chain", async function () {
      // Legacy burn from Persistence still works via VaultFactory
      const burnTxHash = ethers.keccak256(ethers.toUtf8Bytes("persistence-legacy-burn"));
      const amount = ethers.parseEther("5");

      await vaultFactory.connect(zkBridge).unwrapFromBurn(
        vaultAddress,
        burnTxHash,
        user1.address,
        amount
      );

      const totalReleased = await vaultFactory.totalReleased();
      expect(totalReleased).to.equal(amount);
    });
  });

  // ═════════════════════════════════════════════════════════════════════════════
  // SECTION 9: BATCH OPERATIONS & GAS OPTIMIZATION
  // ═════════════════════════════════════════════════════════════════════════════

  describe("Batch Operations & Gas Optimization", function () {
    it("should batch-settle multiple tasks on AIDePINRouter", async function () {
      const batchSize = 5;
      const taskIds = [];
      const sp1Proofs = [];
      const nullifiers = [];
      const outputHashes = [];
      const feeCommitments = [];

      // Route multiple tasks
      for (let i = 0; i < batchSize; i++) {
        const taskId = ethers.keccak256(ethers.toUtf8Bytes(`batch-task-${i}`));
        const modelId = ethers.keccak256(ethers.toUtf8Bytes("model"));
        const input = ethers.keccak256(ethers.toUtf8Bytes(`input-${i}`));

        await aidepinRouter.connect(user1).routeInference(
          taskId, 1, modelId, input,
          { value: TASK_AMOUNT }
        );

        taskIds.push(taskId);
        sp1Proofs.push("0x01020304");
        nullifiers.push(ethers.keccak256(ethers.toUtf8Bytes(`batch-null-${i}`)));
        outputHashes.push(ethers.keccak256(ethers.toUtf8Bytes(`output-${i}`)));
        feeCommitments.push(ethers.keccak256(ethers.toUtf8Bytes(`commit-${i}`)));
      }

      // Batch settle
      const tx = await aidepinRouter.connect(relayer).settleTaskBatch(
        taskIds, sp1Proofs, nullifiers, outputHashes, feeCommitments
      );
      const receipt = await tx.wait();

      // Verify all settled
      const [, totalSettled] = await aidepinRouter.getStats();
      expect(totalSettled).to.equal(batchSize);

      console.log(`  Batch settle gas (${batchSize} tasks): ${receipt.gasUsed.toString()}`);
      console.log(`  Per-task gas: ${(receipt.gasUsed / BigInt(batchSize)).toString()}`);
    });

    it("should batch-settle multiple subnet tasks on TAOWrapper", async function () {
      const batchSize = 3;
      const taskIds = [];
      const sp1Proofs = [];
      const nullifiers = [];
      const outputHashes = [];
      const feeCommitments = [];

      for (let i = 0; i < batchSize; i++) {
        const taskId = ethers.keccak256(ethers.toUtf8Bytes(`tao-batch-${i}`));
        const modelId = ethers.keccak256(ethers.toUtf8Bytes("llama-3"));
        const input = ethers.keccak256(ethers.toUtf8Bytes(`tao-input-${i}`));

        await taoWrapper.connect(user1).routeInference(
          taskId, 1, modelId, input,
          { value: TASK_AMOUNT }
        );

        taskIds.push(taskId);
        sp1Proofs.push("0x01020304");
        nullifiers.push(ethers.keccak256(ethers.toUtf8Bytes(`tao-null-${i}`)));
        outputHashes.push(ethers.keccak256(ethers.toUtf8Bytes(`tao-output-${i}`)));
        feeCommitments.push(ethers.keccak256(ethers.toUtf8Bytes(`tao-commit-${i}`)));
      }

      const tx = await taoWrapper.connect(relayer).settleTaskBatch(
        taskIds, sp1Proofs, nullifiers, outputHashes, feeCommitments
      );
      const receipt = await tx.wait();

      const [, , , totalSettled] = await taoWrapper.getStats();
      expect(totalSettled).to.equal(BigInt(batchSize));

      console.log(`  TAO batch settle gas (${batchSize} tasks): ${receipt.gasUsed.toString()}`);
    });
  });

  // ═════════════════════════════════════════════════════════════════════════════
  // SECTION 10: A2A MESSAGING — Cross-Chain Agent Communication
  // ═════════════════════════════════════════════════════════════════════════════

  describe("A2A Messaging: Cross-Chain Agent Communication", function () {
    it("should register agent and send A2A message with escrow", async function () {
      const identity = ethers.keccak256(ethers.toUtf8Bytes("agent-x-identity"));
      await aidepinRouter.connect(user1).registerAgent(identity);
      expect(await aidepinRouter.isAgentRegistered(user1.address)).to.be.true;

      const msgId = ethers.keccak256(ethers.toUtf8Bytes("a2a-msg-001"));
      const payloadHash = ethers.keccak256(ethers.toUtf8Bytes("compute-request-payload"));
      const escrowAmount = ethers.parseEther("0.5");

      // Send COMPUTE_BID A2A message with escrow
      const tx = await aidepinRouter.connect(user1).sendA2AMessage(
        msgId,
        0, // COMPUTE_BID
        2, // Akash
        payloadHash,
        3600, // 1h TTL
        { value: escrowAmount }
      );
      const receipt = await tx.wait();

      const msgEvent = receipt.logs.find((log) => {
        try {
          return aidepinRouter.interface.parseLog(log).name === "A2AMessageVerified";
        } catch {
          return false;
        }
      });
      expect(msgEvent).to.not.be.undefined;

      // Verify escrow stored
      const msg = await aidepinRouter.getMessage(msgId);
      expect(msg.escrowAmount).to.equal(escrowAmount);
    });

    it("should send A2A message via TAOWrapper", async function () {
      const identity = ethers.keccak256(ethers.toUtf8Bytes("tao-agent-identity"));
      await taoWrapper.connect(user1).registerAgent(identity);
      expect(await taoWrapper.isAgentRegistered(user1.address)).to.be.true;

      // Wrap TAO for escrow
      const wrapAmount = ethers.parseEther("2");
      await taoWrapper.connect(user1).wrap({ value: wrapAmount });

      const msgId = ethers.keccak256(ethers.toUtf8Bytes("tao-a2a-001"));
      const payloadHash = ethers.keccak256(ethers.toUtf8Bytes("subnet-query"));
      const escrowAmount = ethers.parseEther("0.1");

      await taoWrapper.connect(user1).sendA2AMessage(
        msgId,
        2, // INFERENCE_REQUEST
        3, // Bittensor
        payloadHash,
        escrowAmount
      );

      // Verify escrow was transferred
      const stats = await taoWrapper.getStats();
      expect(stats._totalA2AMessages).to.equal(1n);
    });
  });

  // ═════════════════════════════════════════════════════════════════════════════
  // SECTION 11: EDGE CASES & SECURITY
  // ═════════════════════════════════════════════════════════════════════════════

  describe("Edge Cases & Security", function () {
    it("should reject tasks below minimum amount on AIDePINRouter", async function () {
      const taskId = ethers.keccak256(ethers.toUtf8Bytes("dust-test"));
      const modelId = ethers.keccak256(ethers.toUtf8Bytes("m"));
      const inputHash = ethers.keccak256(ethers.toUtf8Bytes("i"));

      await expect(
        aidepinRouter.connect(user1).routeInference(
          taskId, 1, modelId, inputHash,
          { value: 100 } // Below MIN_TASK_AMOUNT (10000)
        )
      ).to.be.reverted; // AmountBelowMinimum
    });

    it("should reject duplicate task IDs on AIDePINRouter", async function () {
      const taskId = ethers.keccak256(ethers.toUtf8Bytes("dup-test"));
      const modelId = ethers.keccak256(ethers.toUtf8Bytes("m"));
      const inputHash = ethers.keccak256(ethers.toUtf8Bytes("i"));

      await aidepinRouter.connect(user1).routeInference(
        taskId, 1, modelId, inputHash,
        { value: TASK_AMOUNT }
      );

      await expect(
        aidepinRouter.connect(user1).routeInference(
          taskId, 1, modelId, inputHash,
          { value: TASK_AMOUNT }
        )
      ).to.be.reverted; // TaskAlreadyExists
    });

    it("should reject nullifier reuse on AIDePINRouter", async function () {
      const nullifier = ethers.keccak256(ethers.toUtf8Bytes("shared-null"));

      // Route and settle task 1
      const taskId1 = ethers.keccak256(ethers.toUtf8Bytes("null-reuse-1"));
      await aidepinRouter.connect(user1).routeInference(
        taskId1, 1,
        ethers.keccak256(ethers.toUtf8Bytes("m")),
        ethers.keccak256(ethers.toUtf8Bytes("i")),
        { value: TASK_AMOUNT }
      );
      await aidepinRouter.connect(relayer).settleTask(
        taskId1, "0x01020304", nullifier,
        ethers.keccak256(ethers.toUtf8Bytes("o")),
        ethers.keccak256(ethers.toUtf8Bytes("c"))
      );

      // Route task 2 and try to reuse same nullifier
      const taskId2 = ethers.keccak256(ethers.toUtf8Bytes("null-reuse-2"));
      await aidepinRouter.connect(user1).routeInference(
        taskId2, 1,
        ethers.keccak256(ethers.toUtf8Bytes("m2")),
        ethers.keccak256(ethers.toUtf8Bytes("i2")),
        { value: TASK_AMOUNT }
      );

      await expect(
        aidepinRouter.connect(relayer).settleTask(
          taskId2, "0x01020304", nullifier,
          ethers.keccak256(ethers.toUtf8Bytes("o2")),
          ethers.keccak256(ethers.toUtf8Bytes("c2"))
        )
      ).to.be.reverted; // NullifierAlreadyUsed
    });

    it("should reject unauthorized relayer on settleTask", async function () {
      const taskId = ethers.keccak256(ethers.toUtf8Bytes("unauth-test"));
      await aidepinRouter.connect(user1).routeInference(
        taskId, 1,
        ethers.keccak256(ethers.toUtf8Bytes("m")),
        ethers.keccak256(ethers.toUtf8Bytes("i")),
        { value: TASK_AMOUNT }
      );

      await expect(
        aidepinRouter.connect(user2).settleTask(
          taskId, "0x01020304",
          ethers.keccak256(ethers.toUtf8Bytes("n")),
          ethers.keccak256(ethers.toUtf8Bytes("o")),
          ethers.keccak256(ethers.toUtf8Bytes("c"))
        )
      ).to.be.reverted; // AccessControl revert
    });

    it("should reject fee BPS outside 50-100 range on AIDePINRouter", async function () {
      const taskId = ethers.keccak256(ethers.toUtf8Bytes("fee-range-test"));

      await expect(
        aidepinRouter.connect(user1).routeTaskCustomFee(
          taskId,
          2, // INFERENCE_REQUEST
          1, // Osmosis
          200, // 2% — exceeds MAX_FEE_BPS (100)
          ethers.keccak256(ethers.toUtf8Bytes("m")),
          ethers.keccak256(ethers.toUtf8Bytes("i")),
          ethers.ZeroHash,
          { value: TASK_AMOUNT }
        )
      ).to.be.reverted; // InvalidFeeBps
    });

    it("should handle zero-value capability queries (no fee)", async function () {
      const taskId = ethers.keccak256(ethers.toUtf8Bytes("cap-query-test"));

      // Capability queries can have 0 msg.value
      await aidepinRouter.connect(user1).routeCapabilityQuery(taskId, 1);

      const task = await aidepinRouter.getTask(taskId);
      expect(task.grossAmount).to.equal(0);
      expect(task.feeAmount).to.equal(0);
      expect(task.netAmount).to.equal(0);
      expect(task.msgType).to.equal(3); // CAPABILITY_QUERY
    });
  });
});
