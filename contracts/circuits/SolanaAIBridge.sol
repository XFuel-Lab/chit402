// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/access/AccessControl.sol";
import "@openzeppelin/contracts/utils/Pausable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/**
 * @title SolanaAIBridge
 * @author XFuel Protocol — Solana Expansion Circuit
 * @notice EVM-side bridge for Solana AI powerhouses: routes GPU compute,
 *         data tasks, and agent intents to Render/io.net/Grass/SendAI via
 *         Wormhole/CCIP cross-chain messaging with ZK-verified settlement.
 *
 * Architecture (EVM anchor for Solana SVM AI ecosystem):
 *   1. Provider Registry  — Register Solana AI providers with capability profiles.
 *   2. Task Submission     — Users submit AI tasks with budgets (GPU, data, agent).
 *   3. Bridge Relay        — Tasks relayed to Solana via Wormhole/CCIP messaging.
 *   4. Result Attestation  — SP1 proves correct computation on Solana side.
 *   5. Settlement          — Payment released on EVM; fees to CoreRevenueSplitter.
 *
 * Research ties:
 *   Per Render Network (render.network, 2026):
 *     - Migrated to Solana for scalability; Burn-Mint Equilibrium token model.
 *     - 5,600 RTX 5090 nodes; enterprise partners (Santander, F1).
 *     - 50-70% cost savings vs centralized cloud.
 *
 *   Per io.net (io.net, 2026):
 *     - Solana-based decentralized GPU network; 1M+ pooled GPUs.
 *     - 750K inferences across ~35K GPUs/CPUs; IO token for payment + staking.
 *     - Partnered with Render Network (300K RNDR incentive allocation).
 *
 *   Per Grass (grass.io, 2026):
 *     - DePIN bandwidth network; 8.5M MAU; 90-100TB/day scraped data.
 *     - ZK provenance rollup on Solana; combats data poisoning.
 *
 *   Per SendAI (sendai.fun, 2026):
 *     - Solana-native AI agent framework; autonomous task execution.
 *
 *   Cross-chain messaging:
 *     - Wormhole: Guardian-attested VAAs for cross-chain messages.
 *     - Chainlink CCIP: SVM2AnyMessage struct for Solana↔EVM messaging.
 *     - Both support arbitrary data + token transfers cross-chain.
 *
 *   For XFuel integration:
 *     - EVM contract acts as anchor; Solana programs execute AI workloads.
 *     - SP1 proves: "Task T was computed by provider P on Solana with result R"
 *       without revealing proprietary model weights or routing logic.
 *     - Bridge messages carry task params + payment attestation.
 *     - Fees flow to CoreRevenueSplitter (protocol) + provider (payment).
 */
contract SolanaAIBridge is AccessControl, Pausable, ReentrancyGuard {
    bytes32 public constant RELAYER_ROLE = keccak256("RELAYER_ROLE");
    bytes32 public constant OPERATOR_ROLE = keccak256("OPERATOR_ROLE");
    bytes32 public constant CIRCUIT_ID = keccak256("SOLANA_AI_BRIDGE_CIRCUIT");

    address public revenueSplitter;
    address public zkVerifier;
    address public wormholeRelayer;

    uint16 public protocolFeeBps = 75;         // 0.75% protocol fee
    uint16 public constant MAX_FEE = 300;      // 3% max
    uint16 public constant BPS_DENOM = 10000;

    // ─── Provider Registry ────────────────────────────────────────────────
    enum ProviderType { GPU, Data, Agent, Hybrid }

    struct SolanaProvider {
        bytes32 providerId;
        address evmOwner;
        bytes32 solanaPubkey;         // Solana program/wallet pubkey (32 bytes)
        ProviderType providerType;
        string platform;              // "render", "ionet", "grass", "sendai"
        bytes32 capabilityHash;
        uint256 reputation;
        uint256 tasksCompleted;
        uint256 totalEarned;
        bool active;
        uint64 registeredAt;
    }

    mapping(bytes32 => SolanaProvider) public providers;
    uint256 public providerCount;

    // ─── Tasks ────────────────────────────────────────────────────────────
    enum TaskStatus { Pending, Bridged, Completed, Settled, Cancelled, Failed }

    struct BridgeTask {
        bytes32 taskId;
        address requester;
        bytes32 providerId;
        bytes32 taskHash;             // keccak256(task_params + model_id)
        bytes32 inputHash;            // keccak256(encrypted_input_data)
        uint256 payment;
        uint16 solanaChainId;         // Wormhole chain ID for Solana (1)
        TaskStatus status;
        uint64 createdAt;
        uint64 deadline;
    }

    mapping(bytes32 => BridgeTask) public tasks;
    uint256 public taskCount;

    // ─── Bridge Messages ──────────────────────────────────────────────────
    struct BridgeMessage {
        bytes32 taskId;
        bytes32 wormholeVAA;          // Wormhole Verified Action Approval
        bytes32 resultHash;
        bytes32 proofNullifier;
        uint256 qualityScore;
        uint64 bridgedAt;
        uint64 settledAt;
    }

    mapping(bytes32 => BridgeMessage) public bridgeMessages;

    // ─── Nullifier Tracking ───────────────────────────────────────────────
    mapping(bytes32 => bool) public usedNullifiers;

    // ─── Metrics ──────────────────────────────────────────────────────────
    uint256 public totalVolume;
    uint256 public totalFeesCollected;
    uint256 public totalBridged;
    uint256 public totalSettled;

    // ─── Events ───────────────────────────────────────────────────────────
    event ProviderRegistered(bytes32 indexed circuitId, bytes32 indexed providerId, address evmOwner, string platform, bytes32 solanaPubkey);
    event TaskSubmitted(bytes32 indexed circuitId, bytes32 indexed taskId, address requester, bytes32 providerId, uint256 payment);
    event TaskBridged(bytes32 indexed taskId, bytes32 wormholeVAA, uint16 solanaChainId);
    event TaskSettled(bytes32 indexed circuitId, bytes32 indexed taskId, bytes32 resultHash, uint256 qualityScore, bytes32 nullifier);
    event TaskCancelled(bytes32 indexed taskId);

    error ProviderNotFound();
    error TaskNotFound();
    error InvalidStatus();
    error NullifierUsed();
    error DeadlinePassed();
    error NotRequester();

    constructor(address _admin, address _revenueSplitter, address _zkVerifier) {
        require(_admin != address(0), "ZeroAdmin");
        revenueSplitter = _revenueSplitter;
        zkVerifier = _zkVerifier;
        _grantRole(DEFAULT_ADMIN_ROLE, _admin);
        _grantRole(RELAYER_ROLE, _admin);
        _grantRole(OPERATOR_ROLE, _admin);
    }

    // ═══════════════════════════════════════════════════════════════════════
    //  1. PROVIDER REGISTRY
    // ═══════════════════════════════════════════════════════════════════════

    function registerProvider(
        bytes32 solanaPubkey,
        ProviderType providerType,
        string calldata platform,
        bytes32 capabilityHash
    ) external whenNotPaused returns (bytes32 providerId) {
        require(solanaPubkey != bytes32(0), "ZeroPubkey");
        require(capabilityHash != bytes32(0), "ZeroCap");

        providerId = keccak256(abi.encodePacked(CIRCUIT_ID, msg.sender, providerCount));

        providers[providerId] = SolanaProvider({
            providerId: providerId,
            evmOwner: msg.sender,
            solanaPubkey: solanaPubkey,
            providerType: providerType,
            platform: platform,
            capabilityHash: capabilityHash,
            reputation: 0,
            tasksCompleted: 0,
            totalEarned: 0,
            active: true,
            registeredAt: uint64(block.timestamp)
        });

        providerCount++;
        emit ProviderRegistered(CIRCUIT_ID, providerId, msg.sender, platform, solanaPubkey);
    }

    // ═══════════════════════════════════════════════════════════════════════
    //  2. TASK SUBMISSION
    // ═══════════════════════════════════════════════════════════════════════

    function submitTask(
        bytes32 providerId,
        bytes32 taskHash,
        bytes32 inputHash,
        uint64 deadline
    ) external payable whenNotPaused nonReentrant returns (bytes32 taskId) {
        require(msg.value > 0, "ZeroPayment");
        SolanaProvider storage p = providers[providerId];
        if (p.registeredAt == 0) revert ProviderNotFound();
        require(p.active, "Inactive");
        require(deadline > block.timestamp, "PastDeadline");

        taskId = keccak256(abi.encodePacked(CIRCUIT_ID, msg.sender, taskCount));

        tasks[taskId] = BridgeTask({
            taskId: taskId,
            requester: msg.sender,
            providerId: providerId,
            taskHash: taskHash,
            inputHash: inputHash,
            payment: msg.value,
            solanaChainId: 1, // Wormhole Solana chain ID
            status: TaskStatus.Pending,
            createdAt: uint64(block.timestamp),
            deadline: deadline
        });

        taskCount++;
        totalVolume += msg.value;

        emit TaskSubmitted(CIRCUIT_ID, taskId, msg.sender, providerId, msg.value);
    }

    // ═══════════════════════════════════════════════════════════════════════
    //  3. BRIDGE RELAY
    // ═══════════════════════════════════════════════════════════════════════

    function bridgeTask(
        bytes32 taskId,
        bytes32 wormholeVAA
    ) external onlyRole(RELAYER_ROLE) {
        BridgeTask storage t = tasks[taskId];
        if (t.createdAt == 0) revert TaskNotFound();
        if (t.status != TaskStatus.Pending) revert InvalidStatus();

        t.status = TaskStatus.Bridged;
        totalBridged++;

        bridgeMessages[taskId] = BridgeMessage({
            taskId: taskId,
            wormholeVAA: wormholeVAA,
            resultHash: bytes32(0),
            proofNullifier: bytes32(0),
            qualityScore: 0,
            bridgedAt: uint64(block.timestamp),
            settledAt: 0
        });

        emit TaskBridged(taskId, wormholeVAA, t.solanaChainId);
    }

    // ═══════════════════════════════════════════════════════════════════════
    //  4. ZK-VERIFIED SETTLEMENT
    // ═══════════════════════════════════════════════════════════════════════

    function settleTask(
        bytes32 taskId,
        bytes32 resultHash,
        uint256 qualityScore,
        bytes calldata proof,
        bytes calldata publicValues,
        bytes32 nullifier
    ) external onlyRole(RELAYER_ROLE) nonReentrant whenNotPaused {
        BridgeTask storage t = tasks[taskId];
        if (t.createdAt == 0) revert TaskNotFound();
        if (t.status != TaskStatus.Bridged) revert InvalidStatus();
        if (usedNullifiers[nullifier]) revert NullifierUsed();

        usedNullifiers[nullifier] = true;

        // Verify SP1 proof of Solana-side computation
        if (zkVerifier != address(0)) {
            (bool ok, ) = zkVerifier.call(
                abi.encodeWithSignature(
                    "verifyProof(bytes32,bytes,bytes,bytes32)",
                    CIRCUIT_ID, publicValues, proof, nullifier
                )
            );
            require(ok, "ProofFailed");
        }

        // Update bridge message
        BridgeMessage storage bm = bridgeMessages[taskId];
        bm.resultHash = resultHash;
        bm.proofNullifier = nullifier;
        bm.qualityScore = qualityScore;
        bm.settledAt = uint64(block.timestamp);

        t.status = TaskStatus.Settled;

        // Calculate fees and payment
        uint256 fee = (t.payment * protocolFeeBps) / BPS_DENOM;
        uint256 providerPayment = t.payment - fee;

        // Update provider stats
        SolanaProvider storage prov = providers[t.providerId];
        prov.reputation += qualityScore;
        prov.tasksCompleted++;
        prov.totalEarned += providerPayment;

        totalFeesCollected += fee;
        totalSettled++;

        if (fee > 0) _forwardFee(fee);

        // Pay provider's EVM address
        (bool ok1, ) = payable(prov.evmOwner).call{value: providerPayment}("");
        require(ok1, "ProvPayFailed");

        emit TaskSettled(CIRCUIT_ID, taskId, resultHash, qualityScore, nullifier);
    }

    function cancelTask(bytes32 taskId) external nonReentrant {
        BridgeTask storage t = tasks[taskId];
        if (t.createdAt == 0) revert TaskNotFound();
        if (msg.sender != t.requester) revert NotRequester();
        if (t.status != TaskStatus.Pending) revert InvalidStatus();

        t.status = TaskStatus.Cancelled;

        (bool ok, ) = payable(msg.sender).call{value: t.payment}("");
        require(ok, "RefundFailed");

        emit TaskCancelled(taskId);
    }

    // ─── Internal ─────────────────────────────────────────────────────────

    function _forwardFee(uint256 amount) internal {
        if (amount == 0 || revenueSplitter == address(0)) return;
        (bool ok, ) = revenueSplitter.call{value: amount}(
            abi.encodeWithSignature("depositFee(bytes32)", CIRCUIT_ID)
        );
        if (!ok) {
            (bool ok2, ) = payable(revenueSplitter).call{value: amount}("");
            require(ok2, "FeeFwd");
        }
    }

    // ─── Admin ────────────────────────────────────────────────────────────

    function setProtocolFee(uint16 _bps) external onlyRole(DEFAULT_ADMIN_ROLE) { require(_bps <= MAX_FEE, "FeeTooHigh"); protocolFeeBps = _bps; }
    function setWormholeRelayer(address _r) external onlyRole(DEFAULT_ADMIN_ROLE) { wormholeRelayer = _r; }
    function setRevenueSplitter(address _rs) external onlyRole(DEFAULT_ADMIN_ROLE) { revenueSplitter = _rs; }
    function setZKVerifier(address _zk) external onlyRole(DEFAULT_ADMIN_ROLE) { zkVerifier = _zk; }
    function pause() external onlyRole(DEFAULT_ADMIN_ROLE) { _pause(); }
    function unpause() external onlyRole(DEFAULT_ADMIN_ROLE) { _unpause(); }

    // ─── Views ────────────────────────────────────────────────────────────

    function getProvider(bytes32 id) external view returns (SolanaProvider memory) { return providers[id]; }
    function getTask(bytes32 id) external view returns (BridgeTask memory) { return tasks[id]; }
    function getBridgeMessage(bytes32 id) external view returns (BridgeMessage memory) { return bridgeMessages[id]; }

    function getStats() external view returns (
        uint256 providers_, uint256 tasks_, uint256 bridged_,
        uint256 settled_, uint256 volume_, uint256 fees_
    ) {
        return (providerCount, taskCount, totalBridged, totalSettled, totalVolume, totalFeesCollected);
    }

    receive() external payable {}
}
