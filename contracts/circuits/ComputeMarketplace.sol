// SPDX-License-Identifier: MIT
pragma solidity ^0.8.22;

import "@openzeppelin/contracts/access/AccessControl.sol";
import "@openzeppelin/contracts/utils/Pausable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "../core/SP1ProofHooks.sol";
import "../interfaces/ICrossChainMailbox.sol";

/**
 * @title ComputeMarketplace
 * @author XFuel Protocol — Priority Circuits (Phase 2)
 * @notice Compute Marketplace Circuit: Routes GPU bids via reverse auction,
 *         verifies task completions via SP1 proofs, settles via CoreRevenueSplitter.
 *
 * Prover: CosmWasm (COSMWASM_ARK_BN254) — Akash is Cosmos-native, so the primary
 * prover is the CosmWasm ark-bn254 verifier. EVM settlements use SP1ProofHooks
 * as a bridge verification layer.
 *
 * Research ties:
 *   Per Akash Network docs (2026):
 *     - SDL v2.0: YAML-based GPU specs (nvidia h100/a100/rtx-4090, AMD mi300x)
 *     - Reverse auction: MsgCreateDeployment → providers bid → MsgCreateLease
 *     - Escrow-based payments: per-block settlement, auto-close on overdraw
 *     - Take rates: 4% AKT / 20% USDC (network-level)
 *     - AEP-78: CosmWasm support (wasmd v0.61.6+, max 800KB, 100M gas limit)
 *     - IBC channels for cross-chain AKT/USDC transfers
 *   Per SP1 docs (v6 Hypercube, Feb 2026):
 *     - Groth16: ~260 bytes, ~270K gas on EVM
 *     - CosmWasm verification via ark-bn254 pairing: ~250K gas equivalent
 *   Per Hyperlane docs:
 *     - EVM↔Cosmos routing via dispatch/handle pattern
 *
 * Gas targets:
 *   - submitTask: <120K (no proof verification)
 *   - settleTask: <350K (SP1ProofHooks.verifySP1 + state updates)
 *   - completeBid: <200K (escrow management + events)
 *
 * Security:
 *   - Nullifiers in TaskCompleted and SettlementRequested events
 *   - Replay protection via usedNullifiers mapping
 *   - Circuit breaker: auto-pause at >5% failure rate window
 */
contract ComputeMarketplace is AccessControl, Pausable, ReentrancyGuard {
    using SP1ProofHooks for address;

    bytes32 public constant RELAYER_ROLE = keccak256("RELAYER_ROLE");
    bytes32 public constant OPERATOR_ROLE = keccak256("OPERATOR_ROLE");
    bytes32 public constant CIRCUIT_ID = keccak256("COMPUTE_MARKETPLACE_CIRCUIT");

    // ─── Core Layer References ────────────────────────────────────────────────
    address public revenueSplitter;
    address public zkVerifier;
    address public sp1Gateway;
    bytes32 public programVKey;

    // ─── Cross-Chain ──────────────────────────────────────────────────────────
    ICrossChainMailbox public mailbox;
    mapping(uint32 => bool) public supportedDomains;
    mapping(uint32 => bytes32) public trustedRemotes;

    // ─── Fee Configuration ────────────────────────────────────────────────────
    uint16 public feeBps = 50;
    uint16 public constant MIN_FEE_BPS = 10;
    uint16 public constant MAX_FEE_BPS = 100;
    uint16 public constant BPS_DENOM = 10000;

    // ─── GPU Spec Catalog ─────────────────────────────────────────────────────
    struct GPUSpec {
        bytes32 specId;
        string vendor;
        string model;
        uint256 vramMB;
        uint256 cudaCores;
        uint256 basePrice;
        bool available;
    }

    mapping(bytes32 => GPUSpec) public gpuSpecs;
    bytes32[] public specIds;
    uint256 public specCount;

    // ─── Task Registry ────────────────────────────────────────────────────────
    enum TaskStatus { None, Open, Bidding, Assigned, Computing, Completed, Settled, Cancelled, Disputed }

    struct Task {
        bytes32 taskId;
        address requester;
        bytes32 specId;
        bytes32 sdlHash;
        uint256 maxPrice;
        uint256 escrow;
        uint256 duration;
        TaskStatus status;
        uint64 createdAt;
        uint64 settledAt;
        bytes32 winningBidId;
        bytes32 completionNullifier;
    }

    mapping(bytes32 => Task) public tasks;
    uint256 public taskCount;

    // ─── Bid Book (Reverse Auction) ───────────────────────────────────────────
    struct Bid {
        bytes32 bidId;
        bytes32 taskId;
        address provider;
        uint256 price;
        uint256 deposit;
        bool active;
        uint64 submittedAt;
    }

    mapping(bytes32 => Bid) public bids;
    mapping(bytes32 => bytes32[]) public taskBids;
    uint256 public bidCount;
    uint256 public constant MIN_BID_DEPOSIT = 0.01 ether;

    // ─── Settlement Tracking ──────────────────────────────────────────────────
    struct Settlement {
        bytes32 taskId;
        bytes32 outputHash;
        address provider;
        uint96 providerPayout;
        uint64 settledAt;
    }

    mapping(bytes32 => Settlement) public settlements;
    uint256 public settlementCount;

    // ─── Nullifier Tracking ───────────────────────────────────────────────────
    mapping(bytes32 => bool) public usedNullifiers;

    // ─── Circuit Breaker ──────────────────────────────────────────────────────
    uint256 public failureWindowStart;
    uint256 public failuresInWindow;
    uint256 public settlementsInWindow;
    uint256 public constant FAILURE_WINDOW = 1 hours;
    uint256 public constant MAX_FAILURE_RATE_BPS = 500;

    // ─── Metrics ──────────────────────────────────────────────────────────────
    uint256 public totalFeesCollected;
    uint256 public totalVolume;
    uint256 public totalSettled;
    uint256 public totalFailed;
    uint256 public activeTasks;

    // ─── Events ───────────────────────────────────────────────────────────────
    event TaskRouted(
        bytes32 indexed circuitId,
        bytes32 indexed taskId,
        address indexed requester,
        bytes32 specId,
        uint256 maxPrice,
        uint256 escrow,
        uint256 duration
    );

    event BidSubmitted(
        bytes32 indexed taskId,
        bytes32 indexed bidId,
        address indexed provider,
        uint256 price,
        uint256 deposit
    );

    event BidAccepted(
        bytes32 indexed taskId,
        bytes32 indexed bidId,
        address indexed provider
    );

    event TaskCompleted(
        bytes32 indexed taskId,
        bytes32 indexed nullifier,
        bytes32 outputHash,
        address provider,
        uint256 latencyMs
    );

    event SettlementRequested(
        bytes32 indexed taskId,
        bytes32 indexed nullifier,
        uint256 providerPayout,
        uint256 protocolFee
    );

    event IntentSubmitted(
        bytes32 indexed circuitId,
        bytes32 indexed taskId,
        string intentType,
        bytes payload
    );

    event CrossChainSettlement(
        bytes32 indexed taskId,
        uint32 destDomain,
        bytes32 messageId
    );

    event TaskCancelled(bytes32 indexed taskId, uint256 refund);
    event CircuitBreakerTriggered(uint256 failureRate, uint256 window);

    // ─── Errors ───────────────────────────────────────────────────────────────
    error SpecNotFound();
    error TaskNotFound();
    error InvalidTaskStatus(TaskStatus current);
    error NotRequester();
    error BidTooHigh();
    error BidDepositTooLow();
    error BidNotFound();
    error NullifierUsed(bytes32 nullifier);
    error CircuitBreakerActive();
    error InsufficientEscrow();
    error NoMailbox();
    error UnsupportedDomain(uint32 domain);

    // ─── Constructor ──────────────────────────────────────────────────────────
    constructor(
        address _admin,
        address _revenueSplitter,
        address _zkVerifier,
        address _sp1Gateway
    ) {
        require(_admin != address(0), "ZeroAdmin");
        revenueSplitter = _revenueSplitter;
        zkVerifier = _zkVerifier;
        sp1Gateway = _sp1Gateway;

        _grantRole(DEFAULT_ADMIN_ROLE, _admin);
        _grantRole(OPERATOR_ROLE, _admin);
        _grantRole(RELAYER_ROLE, _admin);

        failureWindowStart = block.timestamp;
    }

    // ═══════════════════════════════════════════════════════════════════════════
    //  GPU SPEC CATALOG
    // ═══════════════════════════════════════════════════════════════════════════

    function registerGPUSpec(
        string calldata vendor,
        string calldata model,
        uint256 vramMB,
        uint256 cudaCores,
        uint256 basePrice
    ) external onlyRole(OPERATOR_ROLE) returns (bytes32 specId) {
        specId = keccak256(abi.encodePacked(vendor, model, specCount));

        gpuSpecs[specId] = GPUSpec({
            specId: specId,
            vendor: vendor,
            model: model,
            vramMB: vramMB,
            cudaCores: cudaCores,
            basePrice: basePrice,
            available: true
        });

        specIds.push(specId);
        specCount++;
    }

    // ═══════════════════════════════════════════════════════════════════════════
    //  TASK SUBMISSION (Event-Driven)
    // ═══════════════════════════════════════════════════════════════════════════

    function submitTask(
        bytes32 specId,
        bytes32 sdlHash,
        uint256 maxPrice,
        uint256 duration
    ) external payable whenNotPaused nonReentrant returns (bytes32 taskId) {
        if (gpuSpecs[specId].specId == bytes32(0)) revert SpecNotFound();
        require(msg.value >= maxPrice * duration, "InsufficientEscrow");
        require(duration > 0, "ZeroDuration");

        uint256 fee = (msg.value * feeBps) / BPS_DENOM;
        uint256 netEscrow = msg.value - fee;

        taskId = keccak256(abi.encodePacked(
            CIRCUIT_ID, msg.sender, specId, block.number, taskCount++
        ));

        tasks[taskId] = Task({
            taskId: taskId,
            requester: msg.sender,
            specId: specId,
            sdlHash: sdlHash,
            maxPrice: maxPrice,
            escrow: netEscrow,
            duration: duration,
            status: TaskStatus.Open,
            createdAt: uint64(block.timestamp),
            settledAt: 0,
            winningBidId: bytes32(0),
            completionNullifier: bytes32(0)
        });

        totalVolume += msg.value;
        totalFeesCollected += fee;
        activeTasks++;

        if (fee > 0) _forwardFee(fee);

        emit TaskRouted(CIRCUIT_ID, taskId, msg.sender, specId, maxPrice, netEscrow, duration);
        emit IntentSubmitted(CIRCUIT_ID, taskId, "compute_bid", abi.encode(specId, sdlHash, maxPrice));
    }

    // ═══════════════════════════════════════════════════════════════════════════
    //  REVERSE AUCTION BIDDING
    // ═══════════════════════════════════════════════════════════════════════════

    function placeBid(
        bytes32 taskId,
        uint256 price
    ) external payable whenNotPaused nonReentrant returns (bytes32 bidId) {
        Task storage t = tasks[taskId];
        if (t.createdAt == 0) revert TaskNotFound();
        if (t.status != TaskStatus.Open && t.status != TaskStatus.Bidding)
            revert InvalidTaskStatus(t.status);
        if (price > t.maxPrice) revert BidTooHigh();
        if (msg.value < MIN_BID_DEPOSIT) revert BidDepositTooLow();

        bidId = keccak256(abi.encodePacked(CIRCUIT_ID, msg.sender, taskId, bidCount++));

        bids[bidId] = Bid({
            bidId: bidId,
            taskId: taskId,
            provider: msg.sender,
            price: price,
            deposit: msg.value,
            active: true,
            submittedAt: uint64(block.timestamp)
        });

        taskBids[taskId].push(bidId);
        if (t.status == TaskStatus.Open) t.status = TaskStatus.Bidding;

        emit BidSubmitted(taskId, bidId, msg.sender, price, msg.value);
    }

    function acceptBid(bytes32 bidId) external nonReentrant whenNotPaused returns (bytes32) {
        Bid storage b = bids[bidId];
        if (!b.active) revert BidNotFound();

        Task storage t = tasks[b.taskId];
        if (t.requester != msg.sender) revert NotRequester();
        if (t.status != TaskStatus.Bidding && t.status != TaskStatus.Open)
            revert InvalidTaskStatus(t.status);

        t.status = TaskStatus.Assigned;
        t.winningBidId = bidId;
        b.active = false;

        if (b.deposit > 0) {
            (bool ok, ) = payable(b.provider).call{value: b.deposit}("");
            require(ok, "DepositReturn");
        }

        bytes32[] storage bidList = taskBids[b.taskId];
        for (uint256 i = 0; i < bidList.length; i++) {
            if (bidList[i] != bidId) {
                Bid storage loser = bids[bidList[i]];
                if (loser.active && loser.deposit > 0) {
                    loser.active = false;
                    (bool ok2, ) = payable(loser.provider).call{value: loser.deposit}("");
                    require(ok2, "LoserRefund");
                }
            }
        }

        emit BidAccepted(b.taskId, bidId, b.provider);
        return b.taskId;
    }

    // ═══════════════════════════════════════════════════════════════════════════
    //  TASK COMPLETION + ZK SETTLEMENT
    // ═══════════════════════════════════════════════════════════════════════════

    /**
     * @notice Complete a task with ZK proof of compute delivery, then settle payment.
     * @param taskId The task to settle.
     * @param outputHash Hash of compute output.
     * @param proof SP1 Groth16 proof bytes (~260 bytes).
     * @param publicValues ABI-encoded public values from the SP1 program.
     * @param nullifier Replay protection nullifier.
     * @param latencyMs Actual compute latency in milliseconds.
     *
     * @dev Gas target: <350K total (SP1 verify ~270K + state ~80K).
     *      In mock mode (sp1Gateway == 0), proof verification is skipped.
     *      Nullifier prevents replay: keccak256(taskId, sender, nonce, block).
     */
    function settleTask(
        bytes32 taskId,
        bytes32 outputHash,
        bytes calldata proof,
        bytes calldata publicValues,
        bytes32 nullifier,
        uint256 latencyMs
    ) external onlyRole(RELAYER_ROLE) nonReentrant whenNotPaused {
        _checkCircuitBreaker();

        Task storage t = tasks[taskId];
        if (t.createdAt == 0) revert TaskNotFound();
        if (t.status != TaskStatus.Assigned && t.status != TaskStatus.Computing)
            revert InvalidTaskStatus(t.status);
        if (usedNullifiers[nullifier]) revert NullifierUsed(nullifier);

        usedNullifiers[nullifier] = true;

        sp1Gateway.verifySP1(programVKey, publicValues, proof);

        Bid storage winBid = bids[t.winningBidId];
        uint256 providerPayout = winBid.price * t.duration;
        if (providerPayout > t.escrow) providerPayout = t.escrow;

        uint256 refund = t.escrow - providerPayout;

        t.status = TaskStatus.Settled;
        t.settledAt = uint64(block.timestamp);
        t.completionNullifier = nullifier;
        activeTasks--;
        totalSettled++;

        settlements[nullifier] = Settlement({
            taskId: taskId,
            outputHash: outputHash,
            provider: winBid.provider,
            providerPayout: uint96(providerPayout),
            settledAt: uint64(block.timestamp)
        });
        settlementCount++;

        _updateMetrics(true);

        if (providerPayout > 0) {
            (bool ok, ) = payable(winBid.provider).call{value: providerPayout}("");
            require(ok, "ProviderPay");
        }

        if (refund > 0) {
            (bool ok2, ) = payable(t.requester).call{value: refund}("");
            require(ok2, "Refund");
        }

        emit TaskCompleted(taskId, nullifier, outputHash, winBid.provider, latencyMs);
        emit SettlementRequested(taskId, nullifier, providerPayout, 0);
    }

    /**
     * @notice Settle a task and relay the result cross-chain via Hyperlane.
     */
    function settleAndRelayCrossChain(
        bytes32 taskId,
        bytes32 outputHash,
        bytes calldata proof,
        bytes calldata publicValues,
        bytes32 nullifier,
        uint256 latencyMs,
        uint32 destDomain
    ) external payable onlyRole(RELAYER_ROLE) nonReentrant whenNotPaused {
        if (address(mailbox) == address(0)) revert NoMailbox();
        if (!supportedDomains[destDomain]) revert UnsupportedDomain(destDomain);

        _checkCircuitBreaker();

        Task storage t = tasks[taskId];
        if (t.createdAt == 0) revert TaskNotFound();
        if (t.status != TaskStatus.Assigned && t.status != TaskStatus.Computing)
            revert InvalidTaskStatus(t.status);
        if (usedNullifiers[nullifier]) revert NullifierUsed(nullifier);

        usedNullifiers[nullifier] = true;
        sp1Gateway.verifySP1(programVKey, publicValues, proof);

        t.status = TaskStatus.Settled;
        t.settledAt = uint64(block.timestamp);
        t.completionNullifier = nullifier;
        activeTasks--;
        totalSettled++;
        _updateMetrics(true);

        bytes memory payload = SP1ProofHooks.encodeCrossChainPayload(
            CIRCUIT_ID, nullifier, keccak256(publicValues), msg.sender, block.timestamp
        );

        bytes32 remote = trustedRemotes[destDomain];
        uint256 bridgeFee = mailbox.quoteDispatch(destDomain, remote, payload);
        require(msg.value >= bridgeFee, "InsufficientBridgeFee");

        bytes32 messageId = mailbox.dispatch{value: bridgeFee}(destDomain, remote, payload);

        if (msg.value > bridgeFee) {
            (bool ok, ) = payable(msg.sender).call{value: msg.value - bridgeFee}("");
            require(ok, "RefundExcess");
        }

        emit CrossChainSettlement(taskId, destDomain, messageId);
        emit TaskCompleted(taskId, nullifier, outputHash, address(0), latencyMs);
    }

    function cancelTask(bytes32 taskId) external nonReentrant {
        Task storage t = tasks[taskId];
        if (t.createdAt == 0) revert TaskNotFound();
        if (t.requester != msg.sender) revert NotRequester();
        if (t.status != TaskStatus.Open && t.status != TaskStatus.Bidding)
            revert InvalidTaskStatus(t.status);

        t.status = TaskStatus.Cancelled;
        activeTasks--;

        bytes32[] storage bidList = taskBids[taskId];
        for (uint256 i = 0; i < bidList.length; i++) {
            Bid storage b = bids[bidList[i]];
            if (b.active && b.deposit > 0) {
                b.active = false;
                (bool ok, ) = payable(b.provider).call{value: b.deposit}("");
                require(ok, "BidRefund");
            }
        }

        uint256 refund = t.escrow;
        t.escrow = 0;
        if (refund > 0) {
            (bool ok2, ) = payable(t.requester).call{value: refund}("");
            require(ok2, "EscrowRefund");
        }

        emit TaskCancelled(taskId, refund);
    }

    // ─── Internal ─────────────────────────────────────────────────────────────

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

    function _updateMetrics(bool success) internal {
        if (block.timestamp > failureWindowStart + FAILURE_WINDOW) {
            failureWindowStart = block.timestamp;
            failuresInWindow = 0;
            settlementsInWindow = 0;
        }
        settlementsInWindow++;
        if (!success) {
            failuresInWindow++;
            _evaluateCircuitBreaker();
        }
    }

    function _checkCircuitBreaker() internal view {
        if (
            settlementsInWindow > 20 &&
            failuresInWindow * 10000 / settlementsInWindow > MAX_FAILURE_RATE_BPS
        ) {
            revert CircuitBreakerActive();
        }
    }

    function _evaluateCircuitBreaker() internal {
        if (
            settlementsInWindow > 20 &&
            failuresInWindow * 10000 / settlementsInWindow > MAX_FAILURE_RATE_BPS
        ) {
            _pause();
            emit CircuitBreakerTriggered(
                failuresInWindow * 10000 / settlementsInWindow,
                settlementsInWindow
            );
        }
    }

    // ─── Admin ────────────────────────────────────────────────────────────────

    function setFee(uint16 _feeBps) external onlyRole(DEFAULT_ADMIN_ROLE) {
        require(_feeBps >= MIN_FEE_BPS && _feeBps <= MAX_FEE_BPS, "FeeRange");
        feeBps = _feeBps;
    }

    function setProgramVKey(bytes32 _vkey) external onlyRole(DEFAULT_ADMIN_ROLE) {
        programVKey = _vkey;
    }

    function setRevenueSplitter(address _rs) external onlyRole(DEFAULT_ADMIN_ROLE) {
        revenueSplitter = _rs;
    }

    function setZKVerifier(address _zk) external onlyRole(DEFAULT_ADMIN_ROLE) {
        zkVerifier = _zk;
    }

    function setSP1Gateway(address _gw) external onlyRole(DEFAULT_ADMIN_ROLE) {
        sp1Gateway = _gw;
    }

    function setMailbox(address _mb) external onlyRole(DEFAULT_ADMIN_ROLE) {
        mailbox = ICrossChainMailbox(_mb);
    }

    function configureDomain(uint32 domain, bytes32 remote, bool supported) external onlyRole(DEFAULT_ADMIN_ROLE) {
        supportedDomains[domain] = supported;
        trustedRemotes[domain] = remote;
    }

    function pause() external onlyRole(OPERATOR_ROLE) { _pause(); }
    function unpause() external onlyRole(OPERATOR_ROLE) { _unpause(); }

    // ─── Views ────────────────────────────────────────────────────────────────

    function getTask(bytes32 id) external view returns (Task memory) { return tasks[id]; }
    function getBid(bytes32 id) external view returns (Bid memory) { return bids[id]; }
    function getSettlement(bytes32 nullifier) external view returns (Settlement memory) { return settlements[nullifier]; }
    function getTaskBidCount(bytes32 taskId) external view returns (uint256) { return taskBids[taskId].length; }
    function isNullifierUsed(bytes32 n) external view returns (bool) { return usedNullifiers[n]; }

    function getStats() external view returns (
        uint256 tasks_, uint256 bids_, uint256 settled_,
        uint256 failed_, uint256 active_,
        uint256 volume_, uint256 fees_
    ) {
        return (taskCount, bidCount, totalSettled,
                totalFailed, activeTasks,
                totalVolume, totalFeesCollected);
    }

    receive() external payable {}
}
