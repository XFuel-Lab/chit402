// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/access/AccessControl.sol";
import "@openzeppelin/contracts/utils/Pausable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "./interfaces/IHyperlaneMailbox.sol";
import "./interfaces/IChainlinkOracle.sol";

/**
 * @title TAOCircuit
 * @author XFuel Protocol — Circuits
 * @notice AI Marketplace Circuit: Generalized cross-chain task routing via Hyperlane,
 *         AMM fee capture, and oracle-backed pricing for any EVM-based AI marketplace.
 *
 * This circuit is designed as a generalized bridge/fee module for AI marketplace
 * integrations. While the reference implementation targets Bittensor EVM, it is
 * ecosystem-agnostic and can connect to any project that supports EVM contracts.
 *
 * Research ties:
 *   Per Bittensor EVM docs (2026): Chain ID 964, TAO as native token, precompiles
 *   at 0x805 (StakingPrecompileV2), SubnetPrecompile, MetagraphPrecompile.
 *   RPC: https://lite.chain.opentensor.ai. Full EVM runtime on Subtensor.
 *
 *   Per Hyperlane docs: IMailbox.dispatch(domain, recipient, body) for cross-chain
 *   messaging. quoteDispatch() for fee estimation. Domain != Chain ID.
 *
 *   Per Chainlink: AggregatorV3 for price feeds as AMM fallback on chains with
 *   thin liquidity. Where unavailable, admin-set prices are used.
 *
 * Core Layer integration:
 *   - Emits TaskRouted for ai-listener.js to detect and route tasks
 *   - Sends fees to CoreRevenueSplitter via depositFee(circuitId)
 *   - Uses SP1ProofHooks for nullifier computation and proof verification
 *   - Registers with ZKVerifierSP1 as a circuit module
 *
 * Isolation:
 *   - No shared state with other circuits
 *   - Own task registry, pricing, and bridge configuration
 *   - Can be paused independently without affecting Core or other circuits
 */
contract TAOCircuit is AccessControl, Pausable, ReentrancyGuard, IMessageRecipient {
    // ─── Roles ────────────────────────────────────────────────────────────────
    bytes32 public constant RELAYER_ROLE = keccak256("RELAYER_ROLE");
    bytes32 public constant OPERATOR_ROLE = keccak256("OPERATOR_ROLE");

    // ─── Circuit Identity ─────────────────────────────────────────────────────
    /// @notice Unique circuit identifier for Core Layer registration.
    bytes32 public constant CIRCUIT_ID = keccak256("TAO_EVM_CIRCUIT");

    // ─── Core Layer References (plug points) ──────────────────────────────────
    address public revenueSplitter;   // CoreRevenueSplitter address
    address public zkVerifier;        // ZKVerifierSP1 address
    address public sp1Gateway;        // SP1 Verifier Gateway (or address(0) for mock)

    // ─── Hyperlane Bridge ─────────────────────────────────────────────────────
    IHyperlaneMailbox public mailbox;
    /// @notice Mapping of chain enum → Hyperlane domain ID
    mapping(uint32 => bool) public supportedDomains;
    /// @notice Mapping of Hyperlane domain → trusted remote contract (bytes32)
    mapping(uint32 => bytes32) public trustedRemotes;

    // ─── Pricing ──────────────────────────────────────────────────────────────
    /// @notice Chainlink oracle for TAO/USD pricing (fallback when AMM thin)
    IChainlinkOracle public priceOracle;
    /// @notice Admin-set price (18 decimals) used if oracle unavailable
    uint256 public adminPrice;
    /// @notice Max staleness for oracle data (default: 1 hour)
    uint256 public oracleStaleThreshold = 1 hours;

    // ─── Fee Configuration ────────────────────────────────────────────────────
    uint16 public feeBps = 50;                  // 0.5% default
    uint16 public constant MIN_FEE_BPS = 10;    // 0.1%
    uint16 public constant MAX_FEE_BPS = 100;   // 1%
    uint16 public constant BPS_DENOM = 10000;

    // ─── Task Registry (isolated state) ───────────────────────────────────────
    enum TaskStatus { None, Pending, Bridged, Settled, Failed }
    enum TaskType { InferenceRequest, ComputeBid, DataAttestation, SubnetQuery }

    struct Task {
        bytes32 taskId;
        TaskType taskType;
        address requester;
        uint256 amount;
        uint256 fee;
        uint32 destDomain;
        bytes32 inputHash;
        bytes32 outputHash;
        uint256 subnetId;
        TaskStatus status;
        uint64 createdAt;
        uint64 settledAt;
        bytes32 bridgeMessageId;
    }

    mapping(bytes32 => Task) public tasks;
    uint256 public taskCount;
    uint256 public totalFeesCollected;
    uint256 public totalVolume;

    // ─── AMM Swap Tracking ────────────────────────────────────────────────────
    uint256 public swapFeesAccumulated;

    // ─── Events (Core Layer listens to these) ─────────────────────────────────
    event TaskRouted(
        bytes32 indexed circuitId,
        bytes32 indexed taskId,
        TaskType taskType,
        address indexed requester,
        uint256 amount,
        uint256 fee,
        uint32 destDomain,
        uint256 subnetId
    );

    event TaskBridged(
        bytes32 indexed taskId,
        bytes32 bridgeMessageId,
        uint32 destDomain
    );

    event TaskSettled(
        bytes32 indexed taskId,
        bytes32 outputHash,
        bytes32 nullifier,
        uint256 settledAmount
    );

    event CrossChainTaskReceived(
        uint32 indexed originDomain,
        bytes32 indexed taskId,
        bytes payload
    );

    event SwapFeeCollected(
        address indexed trader,
        uint256 amount,
        uint256 fee
    );

    event PriceUpdated(uint256 newPrice, string source);

    // ─── Errors ───────────────────────────────────────────────────────────────
    error UnsupportedDomain(uint32 domain);
    error TaskAlreadyExists(bytes32 taskId);
    error TaskNotFound(bytes32 taskId);
    error InvalidTaskStatus(TaskStatus current, TaskStatus expected);
    error InsufficientPayment(uint256 sent, uint256 required);
    error UntrustedRemote(uint32 domain, bytes32 sender);
    error StaleOracleData();
    error InvalidFee();

    // ─── Constructor ──────────────────────────────────────────────────────────
    /**
     * @param _admin Admin address.
     * @param _revenueSplitter CoreRevenueSplitter address.
     * @param _zkVerifier ZKVerifierSP1 address.
     * @param _mailbox Hyperlane Mailbox contract (or address(0) to disable bridging).
     * @param _priceOracle Chainlink TAO/USD oracle (or address(0) for admin pricing).
     */
    constructor(
        address _admin,
        address _revenueSplitter,
        address _zkVerifier,
        address _mailbox,
        address _priceOracle
    ) {
        require(_admin != address(0), "ZeroAdmin");

        revenueSplitter = _revenueSplitter;
        zkVerifier = _zkVerifier;

        if (_mailbox != address(0)) {
            mailbox = IHyperlaneMailbox(_mailbox);
        }
        if (_priceOracle != address(0)) {
            priceOracle = IChainlinkOracle(_priceOracle);
        }

        _grantRole(DEFAULT_ADMIN_ROLE, _admin);
        _grantRole(OPERATOR_ROLE, _admin);
        _grantRole(RELAYER_ROLE, _admin);
    }

    // ─── Task Submission ──────────────────────────────────────────────────────

    /**
     * @notice Submit an AI marketplace task for routing.
     * @param taskType Type of AI task (inference, compute bid, etc.).
     * @param destDomain Hyperlane domain ID for cross-chain routing (0 = local).
     * @param inputHash Hash of the task input data.
     * @param subnetId Target subnet ID (e.g., Bittensor subnet UID, or 0 for auto).
     * @return taskId Unique task identifier.
     *
     * @dev Emits TaskRouted for the Core Layer ai-listener.js to detect.
     *      Fees are deducted and forwarded to CoreRevenueSplitter.
     */
    function submitTask(
        TaskType taskType,
        uint32 destDomain,
        bytes32 inputHash,
        uint256 subnetId
    ) external payable whenNotPaused nonReentrant returns (bytes32 taskId) {
        require(msg.value > 0, "ZeroPayment");

        // Calculate fee
        uint256 fee = (msg.value * feeBps) / BPS_DENOM;
        uint256 netAmount = msg.value - fee;

        // Generate unique task ID
        taskId = keccak256(abi.encodePacked(
            CIRCUIT_ID, msg.sender, block.number, taskCount++
        ));

        // Store task (isolated state)
        if (tasks[taskId].createdAt != 0) revert TaskAlreadyExists(taskId);
        tasks[taskId] = Task({
            taskId: taskId,
            taskType: taskType,
            requester: msg.sender,
            amount: netAmount,
            fee: fee,
            destDomain: destDomain,
            inputHash: inputHash,
            outputHash: bytes32(0),
            subnetId: subnetId,
            status: TaskStatus.Pending,
            createdAt: uint64(block.timestamp),
            settledAt: 0,
            bridgeMessageId: bytes32(0)
        });

        totalVolume += msg.value;
        totalFeesCollected += fee;

        // Forward fee to Core RevenueSplitter
        if (fee > 0 && revenueSplitter != address(0)) {
            (bool ok, ) = revenueSplitter.call{value: fee}(
                abi.encodeWithSignature("depositFee(bytes32)", CIRCUIT_ID)
            );
            if (!ok) {
                // Fallback: plain transfer if depositFee not available
                (bool ok2, ) = payable(revenueSplitter).call{value: fee}("");
                require(ok2, "FeeFwd");
            }
        }

        // Emit for Core Layer ai-listener to detect
        emit TaskRouted(
            CIRCUIT_ID, taskId, taskType, msg.sender,
            netAmount, fee, destDomain, subnetId
        );

        // If cross-chain, bridge via Hyperlane
        if (destDomain != 0 && address(mailbox) != address(0)) {
            _bridgeTask(taskId, destDomain, taskType, netAmount, inputHash, subnetId);
        }

        return taskId;
    }

    // ─── Cross-Chain Bridging ─────────────────────────────────────────────────

    /**
     * @dev Bridge a task to a remote chain via Hyperlane.
     */
    function _bridgeTask(
        bytes32 taskId,
        uint32 destDomain,
        TaskType taskType,
        uint256 amount,
        bytes32 inputHash,
        uint256 subnetId
    ) internal {
        if (!supportedDomains[destDomain]) revert UnsupportedDomain(destDomain);
        bytes32 remote = trustedRemotes[destDomain];
        require(remote != bytes32(0), "NoRemote");

        // Encode task payload for cross-chain delivery
        bytes memory payload = abi.encode(
            taskId, uint8(taskType), msg.sender, amount, inputHash, subnetId
        );

        // Quote Hyperlane fee
        uint256 bridgeFee = mailbox.quoteDispatch(destDomain, remote, payload);
        require(address(this).balance >= bridgeFee, "InsufficientBridgeFee");

        // Dispatch via Hyperlane
        bytes32 messageId = mailbox.dispatch{value: bridgeFee}(
            destDomain, remote, payload
        );

        tasks[taskId].status = TaskStatus.Bridged;
        tasks[taskId].bridgeMessageId = messageId;

        emit TaskBridged(taskId, messageId, destDomain);
    }

    /**
     * @notice Handle incoming cross-chain messages from Hyperlane.
     * @dev Implements IMessageRecipient.handle().
     */
    function handle(
        uint32 origin,
        bytes32 sender,
        bytes calldata body
    ) external override {
        require(msg.sender == address(mailbox), "OnlyMailbox");
        if (trustedRemotes[origin] != sender) revert UntrustedRemote(origin, sender);

        // Decode incoming task
        (
            bytes32 taskId,
            uint8 taskType,
            address requester,
            uint256 amount,
            bytes32 inputHash,
            uint256 subnetId
        ) = abi.decode(body, (bytes32, uint8, address, uint256, bytes32, uint256));

        // Store as local task for processing
        tasks[taskId] = Task({
            taskId: taskId,
            taskType: TaskType(taskType),
            requester: requester,
            amount: amount,
            fee: 0,
            destDomain: 0,
            inputHash: inputHash,
            outputHash: bytes32(0),
            subnetId: subnetId,
            status: TaskStatus.Pending,
            createdAt: uint64(block.timestamp),
            settledAt: 0,
            bridgeMessageId: bytes32(0)
        });

        emit TaskRouted(
            CIRCUIT_ID, taskId, TaskType(taskType), requester,
            amount, 0, 0, subnetId
        );
    }

    // ─── Settlement ───────────────────────────────────────────────────────────

    /**
     * @notice Settle a completed task with ZK proof.
     * @param taskId The task to settle.
     * @param outputHash Hash of the task output/result.
     * @param proof SP1 proof bytes.
     * @param publicValues SP1 public values.
     * @param nullifier Replay protection nullifier.
     *
     * @dev In mock mode (sp1Gateway == address(0)), proof verification is skipped.
     */
    function settleTask(
        bytes32 taskId,
        bytes32 outputHash,
        bytes calldata proof,
        bytes calldata publicValues,
        bytes32 nullifier
    ) external onlyRole(RELAYER_ROLE) nonReentrant whenNotPaused {
        Task storage t = tasks[taskId];
        if (t.createdAt == 0) revert TaskNotFound(taskId);
        if (t.status != TaskStatus.Pending && t.status != TaskStatus.Bridged) {
            revert InvalidTaskStatus(t.status, TaskStatus.Pending);
        }

        // Verify SP1 proof via Core ZKVerifier (if configured)
        if (zkVerifier != address(0)) {
            // Call ZKVerifierSP1.verifyProof(circuitId, publicValues, proof, nullifier)
            (bool ok, ) = zkVerifier.call(
                abi.encodeWithSignature(
                    "verifyProof(bytes32,bytes,bytes,bytes32)",
                    CIRCUIT_ID, publicValues, proof, nullifier
                )
            );
            require(ok, "ProofVerificationFailed");
        }

        t.outputHash = outputHash;
        t.status = TaskStatus.Settled;
        t.settledAt = uint64(block.timestamp);

        emit TaskSettled(taskId, outputHash, nullifier, t.amount);
    }

    // ─── AMM Fee Capture ──────────────────────────────────────────────────────

    /**
     * @notice Capture fees from AMM swaps (e.g., Uniswap V3 fork pool hooks).
     * @dev Called by the AMM pool or a hook contract when a swap involving
     *      circuit-related tokens occurs. Generalizes to any DEX integration.
     * @param trader Address of the trader.
     * @param swapAmount Total swap amount.
     */
    function captureSwapFee(
        address trader,
        uint256 swapAmount
    ) external payable onlyRole(OPERATOR_ROLE) whenNotPaused {
        require(msg.value > 0, "ZeroFee");

        swapFeesAccumulated += msg.value;
        totalFeesCollected += msg.value;

        // Forward to Core RevenueSplitter
        if (revenueSplitter != address(0)) {
            (bool ok, ) = revenueSplitter.call{value: msg.value}(
                abi.encodeWithSignature("depositFee(bytes32)", CIRCUIT_ID)
            );
            if (!ok) {
                (bool ok2, ) = payable(revenueSplitter).call{value: msg.value}("");
                require(ok2, "SwapFeeFwd");
            }
        }

        emit SwapFeeCollected(trader, swapAmount, msg.value);
    }

    // ─── Pricing (Oracle + Fallback) ──────────────────────────────────────────

    /**
     * @notice Get the current TAO/USD price from oracle or admin fallback.
     * @return price Price with 18 decimals.
     * @return source "oracle" or "admin".
     */
    function getPrice() public view returns (uint256 price, string memory source) {
        if (address(priceOracle) != address(0)) {
            try priceOracle.latestRoundData() returns (
                uint80, int256 answer, uint256, uint256 updatedAt, uint80
            ) {
                if (answer > 0 && block.timestamp - updatedAt <= oracleStaleThreshold) {
                    uint8 dec = priceOracle.decimals();
                    // Normalize to 18 decimals
                    return (uint256(answer) * 10**(18 - dec), "oracle");
                }
            } catch {
                // Oracle call failed — fall through to admin price
            }
        }

        // Fallback to admin-set price
        require(adminPrice > 0, "NoPriceAvailable");
        return (adminPrice, "admin");
    }

    // ─── Admin ────────────────────────────────────────────────────────────────

    function setFee(uint16 _feeBps) external onlyRole(DEFAULT_ADMIN_ROLE) {
        if (_feeBps < MIN_FEE_BPS || _feeBps > MAX_FEE_BPS) revert InvalidFee();
        feeBps = _feeBps;
    }

    function setAdminPrice(uint256 _price) external onlyRole(OPERATOR_ROLE) {
        adminPrice = _price;
        emit PriceUpdated(_price, "admin");
    }

    function setOracle(address _oracle) external onlyRole(DEFAULT_ADMIN_ROLE) {
        priceOracle = IChainlinkOracle(_oracle);
    }

    function setOracleStaleThreshold(uint256 _seconds) external onlyRole(DEFAULT_ADMIN_ROLE) {
        oracleStaleThreshold = _seconds;
    }

    function addSupportedDomain(uint32 domain, bytes32 remote) external onlyRole(DEFAULT_ADMIN_ROLE) {
        supportedDomains[domain] = true;
        trustedRemotes[domain] = remote;
    }

    function removeSupportedDomain(uint32 domain) external onlyRole(DEFAULT_ADMIN_ROLE) {
        supportedDomains[domain] = false;
        delete trustedRemotes[domain];
    }

    function setRevenueSplitter(address _rs) external onlyRole(DEFAULT_ADMIN_ROLE) {
        revenueSplitter = _rs;
    }

    function setZKVerifier(address _zk) external onlyRole(DEFAULT_ADMIN_ROLE) {
        zkVerifier = _zk;
    }

    function setMailbox(address _mailbox) external onlyRole(DEFAULT_ADMIN_ROLE) {
        mailbox = IHyperlaneMailbox(_mailbox);
    }

    function pause() external onlyRole(OPERATOR_ROLE) { _pause(); }
    function unpause() external onlyRole(OPERATOR_ROLE) { _unpause(); }

    // ─── Views ────────────────────────────────────────────────────────────────

    function getTask(bytes32 taskId) external view returns (Task memory) {
        return tasks[taskId];
    }

    function getStats() external view returns (
        uint256 count, uint256 volume, uint256 fees, uint256 swapFees
    ) {
        return (taskCount, totalVolume, totalFeesCollected, swapFeesAccumulated);
    }

    // Allow receiving native token for bridge fees and settlements
    receive() external payable {}
}
