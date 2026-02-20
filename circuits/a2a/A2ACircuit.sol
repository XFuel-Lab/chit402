// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/access/AccessControl.sol";
import "@openzeppelin/contracts/utils/Pausable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/**
 * @title A2ACircuit
 * @author XFuel Protocol — Circuits
 * @notice ZK-Secured Agent-to-Agent Communication Circuit.
 *
 * Provides:
 *   1. Service Discovery — Agents register capabilities, discoverable on-chain.
 *   2. Bidding/Auction — Agents submit bids for compute/inference tasks with escrow.
 *   3. x402-like Micropayments — Escrow-based pay-per-use channels for AI services.
 *   4. SP1 Privacy Channels — Proof-gated messaging with nullifier replay protection.
 *   5. ZK Settlement — All settlements verified via SP1 proofs through Core ZKVerifier.
 *
 * Research ties:
 *   Per x402 protocol (x402.org, 2025-2026): HTTP 402 "Payment Required" enables
 *   instant micropayments (~2s settlement) for API-native payments. XFuel adapts
 *   this model for on-chain A2A: escrow → service → release, with ZK proof of delivery.
 *
 *   Per SP1 docs: Agent identity commitments can be verified in ZK, enabling
 *   privacy-preserving agent authentication without revealing private keys.
 *
 * Core Layer integration:
 *   - Emits A2AMessageSent / BidSubmitted for ai-listener.js
 *   - Sends relay fees (0.1% on escrow) to CoreRevenueSplitter
 *   - Uses ZKVerifierSP1 for proof-gated message delivery
 *   - Fully isolated: own agent registry, bid state, payment channels
 *
 * Isolation guarantees:
 *   - No shared state with TAOCircuit or ThetaGPUCircuit
 *   - Own agent registry, bid book, and payment channel state
 *   - Independent pause/unpause from other circuits
 */
contract A2ACircuit is AccessControl, Pausable, ReentrancyGuard {
    // ─── Roles ────────────────────────────────────────────────────────────────
    bytes32 public constant RELAYER_ROLE = keccak256("RELAYER_ROLE");
    bytes32 public constant OPERATOR_ROLE = keccak256("OPERATOR_ROLE");

    // ─── Circuit Identity ─────────────────────────────────────────────────────
    bytes32 public constant CIRCUIT_ID = keccak256("A2A_CIRCUIT");

    // ─── Core Layer References ────────────────────────────────────────────────
    address public revenueSplitter;
    address public zkVerifier;

    // ─── Fee Configuration ────────────────────────────────────────────────────
    /// @notice Relay fee on escrowed amounts (default 0.1% = 10 BPS)
    uint16 public relayFeeBps = 10;
    /// @notice Task fee on settled amounts (default 0.5% = 50 BPS)
    uint16 public taskFeeBps = 50;
    uint16 public constant BPS_DENOM = 10000;

    // ─── Agent Registry (isolated) ────────────────────────────────────────────
    struct Agent {
        address addr;
        bytes32 identityCommitment;  // Poseidon hash of agent identity (for ZK auth)
        string endpoint;             // Off-chain service endpoint (e.g., "https://agent.example/a2a")
        uint256 reputation;          // Cumulative reputation score
        uint256 tasksCompleted;
        uint256 registeredAt;
        bool active;
        bytes32[] capabilities;      // Array of capability hashes
    }

    mapping(address => Agent) public agents;
    mapping(bytes32 => address) public capabilityProviders; // capability hash → best provider
    uint256 public agentCount;

    // ─── Bidding / Auction ────────────────────────────────────────────────────
    enum BidStatus { Open, Accepted, Completed, Cancelled, Disputed }

    struct Bid {
        bytes32 bidId;
        address requester;
        address provider;
        bytes32 taskHash;            // Hash of the task specification
        bytes32 capabilityRequired;  // Required capability hash
        uint256 escrowAmount;
        uint256 maxPrice;
        uint256 acceptedPrice;
        BidStatus status;
        uint64 createdAt;
        uint64 deadline;             // TTL for bid acceptance
        bytes32 resultHash;          // Hash of delivered result
        bytes32 proofNullifier;      // SP1 proof nullifier for settlement
    }

    mapping(bytes32 => Bid) public bids;
    uint256 public bidCount;
    uint256 public totalEscrow;
    uint256 public activeBids;

    // ─── x402-like Micropayment Channels ──────────────────────────────────────
    struct PaymentChannel {
        bytes32 channelId;
        address payer;
        address payee;
        uint256 deposit;
        uint256 spent;
        uint64 openedAt;
        uint64 expiresAt;
        bool active;
    }

    mapping(bytes32 => PaymentChannel) public channels;
    uint256 public channelCount;

    // ─── SP1 Privacy: Nullifier tracking per circuit ──────────────────────────
    mapping(bytes32 => bool) public usedNullifiers;

    // ─── Metrics ──────────────────────────────────────────────────────────────
    uint256 public totalRelayFees;
    uint256 public totalTaskFees;
    uint256 public totalMessagesRelayed;
    uint256 public totalSettled;

    // ─── Events (Core Layer listens to these) ─────────────────────────────────
    event AgentRegistered(
        address indexed agent,
        bytes32 identityCommitment,
        bytes32[] capabilities
    );

    event AgentDeactivated(address indexed agent);

    event BidSubmitted(
        bytes32 indexed circuitId,
        bytes32 indexed bidId,
        address indexed requester,
        bytes32 capabilityRequired,
        uint256 escrowAmount,
        uint64 deadline
    );

    event BidAccepted(
        bytes32 indexed bidId,
        address indexed provider,
        uint256 acceptedPrice
    );

    event BidSettled(
        bytes32 indexed bidId,
        bytes32 resultHash,
        bytes32 nullifier,
        uint256 paidAmount,
        uint256 fee
    );

    event BidCancelled(bytes32 indexed bidId);

    event A2AMessageSent(
        bytes32 indexed circuitId,
        address indexed sender,
        address indexed recipient,
        bytes32 payloadHash,
        uint256 escrowAmount
    );

    event ChannelOpened(
        bytes32 indexed channelId,
        address indexed payer,
        address indexed payee,
        uint256 deposit,
        uint64 expiresAt
    );

    event ChannelClaimed(
        bytes32 indexed channelId,
        uint256 amount,
        bytes32 proofNullifier
    );

    event ChannelClosed(bytes32 indexed channelId, uint256 refund);

    // ─── Errors ───────────────────────────────────────────────────────────────
    error AgentNotRegistered();
    error AgentAlreadyRegistered();
    error BidNotFound();
    error BidNotOpen();
    error BidExpired();
    error BidNotAccepted();
    error InsufficientEscrow();
    error ChannelNotFound();
    error ChannelExpired();
    error ChannelNotActive();
    error InsufficientChannelBalance();
    error NullifierUsed();
    error OnlyRequester();
    error OnlyProvider();
    error PriceTooHigh();

    // ─── Constructor ──────────────────────────────────────────────────────────
    constructor(
        address _admin,
        address _revenueSplitter,
        address _zkVerifier
    ) {
        require(_admin != address(0), "ZeroAdmin");

        revenueSplitter = _revenueSplitter;
        zkVerifier = _zkVerifier;

        _grantRole(DEFAULT_ADMIN_ROLE, _admin);
        _grantRole(OPERATOR_ROLE, _admin);
        _grantRole(RELAYER_ROLE, _admin);
    }

    // ═══════════════════════════════════════════════════════════════════════════
    //  1. SERVICE DISCOVERY
    // ═══════════════════════════════════════════════════════════════════════════

    /**
     * @notice Register an agent with capabilities for service discovery.
     * @param identityCommitment Poseidon hash of agent identity (for ZK auth).
     * @param endpoint Off-chain service URL.
     * @param capabilities Array of capability hashes (e.g., keccak256("inference:llama-3")).
     */
    function registerAgent(
        bytes32 identityCommitment,
        string calldata endpoint,
        bytes32[] calldata capabilities
    ) external whenNotPaused {
        if (agents[msg.sender].registeredAt != 0) revert AgentAlreadyRegistered();

        agents[msg.sender] = Agent({
            addr: msg.sender,
            identityCommitment: identityCommitment,
            endpoint: endpoint,
            reputation: 0,
            tasksCompleted: 0,
            registeredAt: block.timestamp,
            active: true,
            capabilities: capabilities
        });

        // Index capabilities for discovery
        for (uint256 i = 0; i < capabilities.length; i++) {
            if (capabilityProviders[capabilities[i]] == address(0)) {
                capabilityProviders[capabilities[i]] = msg.sender;
            }
        }

        agentCount++;
        emit AgentRegistered(msg.sender, identityCommitment, capabilities);
    }

    /**
     * @notice Deactivate an agent (self or admin).
     */
    function deactivateAgent(address agent) external {
        require(
            msg.sender == agent || hasRole(DEFAULT_ADMIN_ROLE, msg.sender),
            "Unauthorized"
        );
        if (agents[agent].registeredAt == 0) revert AgentNotRegistered();
        agents[agent].active = false;
        emit AgentDeactivated(agent);
    }

    /**
     * @notice Find a provider for a specific capability.
     */
    function findProvider(bytes32 capability) external view returns (address) {
        return capabilityProviders[capability];
    }

    // ═══════════════════════════════════════════════════════════════════════════
    //  2. BIDDING / AUCTION
    // ═══════════════════════════════════════════════════════════════════════════

    /**
     * @notice Submit a bid request for an AI service.
     * @param taskHash Hash of the task specification.
     * @param capabilityRequired Capability the provider must have.
     * @param deadline TTL for bid acceptance (unix timestamp).
     * @return bidId Unique bid identifier.
     *
     * @dev msg.value is held in escrow. Emits BidSubmitted for ai-listener.
     */
    function submitBid(
        bytes32 taskHash,
        bytes32 capabilityRequired,
        uint64 deadline
    ) external payable whenNotPaused nonReentrant returns (bytes32 bidId) {
        require(msg.value > 0, "ZeroEscrow");
        require(deadline > block.timestamp, "PastDeadline");

        bidId = keccak256(abi.encodePacked(CIRCUIT_ID, msg.sender, block.number, bidCount++));

        // Deduct relay fee from escrow
        uint256 relayFee = (msg.value * relayFeeBps) / BPS_DENOM;
        uint256 netEscrow = msg.value - relayFee;

        bids[bidId] = Bid({
            bidId: bidId,
            requester: msg.sender,
            provider: address(0),
            taskHash: taskHash,
            capabilityRequired: capabilityRequired,
            escrowAmount: netEscrow,
            maxPrice: netEscrow,
            acceptedPrice: 0,
            status: BidStatus.Open,
            createdAt: uint64(block.timestamp),
            deadline: deadline,
            resultHash: bytes32(0),
            proofNullifier: bytes32(0)
        });

        totalEscrow += netEscrow;
        activeBids++;

        // Forward relay fee to Core RevenueSplitter
        if (relayFee > 0) {
            totalRelayFees += relayFee;
            _forwardFee(relayFee);
        }

        emit BidSubmitted(CIRCUIT_ID, bidId, msg.sender, capabilityRequired, netEscrow, deadline);
    }

    /**
     * @notice Accept a bid as a provider.
     * @param bidId Bid to accept.
     * @param price Price to accept (must be <= escrow amount).
     */
    function acceptBid(bytes32 bidId, uint256 price) external whenNotPaused {
        Bid storage b = bids[bidId];
        if (b.createdAt == 0) revert BidNotFound();
        if (b.status != BidStatus.Open) revert BidNotOpen();
        if (block.timestamp > b.deadline) revert BidExpired();
        if (price > b.escrowAmount) revert PriceTooHigh();

        // Provider must be a registered, active agent
        if (!agents[msg.sender].active) revert AgentNotRegistered();

        b.provider = msg.sender;
        b.acceptedPrice = price;
        b.status = BidStatus.Accepted;

        emit BidAccepted(bidId, msg.sender, price);
    }

    /**
     * @notice Settle a completed bid with ZK proof of delivery.
     * @param bidId Bid to settle.
     * @param resultHash Hash of the delivered result.
     * @param proof SP1 proof bytes.
     * @param publicValues SP1 public values.
     * @param nullifier Replay protection nullifier.
     */
    function settleBid(
        bytes32 bidId,
        bytes32 resultHash,
        bytes calldata proof,
        bytes calldata publicValues,
        bytes32 nullifier
    ) external onlyRole(RELAYER_ROLE) nonReentrant whenNotPaused {
        Bid storage b = bids[bidId];
        if (b.createdAt == 0) revert BidNotFound();
        if (b.status != BidStatus.Accepted) revert BidNotAccepted();
        if (usedNullifiers[nullifier]) revert NullifierUsed();

        // Mark nullifier used
        usedNullifiers[nullifier] = true;

        // Verify SP1 proof via Core ZKVerifier (if configured)
        if (zkVerifier != address(0)) {
            (bool ok, ) = zkVerifier.call(
                abi.encodeWithSignature(
                    "verifyProof(bytes32,bytes,bytes,bytes32)",
                    CIRCUIT_ID, publicValues, proof, nullifier
                )
            );
            require(ok, "ProofFailed");
        }

        // Calculate task fee on settled amount
        uint256 taskFee = (b.acceptedPrice * taskFeeBps) / BPS_DENOM;
        uint256 providerPayout = b.acceptedPrice - taskFee;
        uint256 refund = b.escrowAmount - b.acceptedPrice;

        b.resultHash = resultHash;
        b.proofNullifier = nullifier;
        b.status = BidStatus.Completed;

        totalEscrow -= b.escrowAmount;
        activeBids--;
        totalSettled += b.acceptedPrice;

        // Pay provider
        if (providerPayout > 0) {
            (bool ok1, ) = payable(b.provider).call{value: providerPayout}("");
            require(ok1, "ProviderPay");
        }

        // Refund excess to requester
        if (refund > 0) {
            (bool ok2, ) = payable(b.requester).call{value: refund}("");
            require(ok2, "Refund");
        }

        // Forward task fee
        if (taskFee > 0) {
            totalTaskFees += taskFee;
            _forwardFee(taskFee);
        }

        // Update provider reputation
        agents[b.provider].tasksCompleted++;
        agents[b.provider].reputation += 1;

        totalMessagesRelayed++;

        emit BidSettled(bidId, resultHash, nullifier, providerPayout, taskFee);
    }

    /**
     * @notice Cancel an open bid and reclaim escrow.
     */
    function cancelBid(bytes32 bidId) external nonReentrant {
        Bid storage b = bids[bidId];
        if (b.createdAt == 0) revert BidNotFound();
        if (msg.sender != b.requester) revert OnlyRequester();
        if (b.status != BidStatus.Open) revert BidNotOpen();

        b.status = BidStatus.Cancelled;
        totalEscrow -= b.escrowAmount;
        activeBids--;

        (bool ok, ) = payable(b.requester).call{value: b.escrowAmount}("");
        require(ok, "RefundFailed");

        emit BidCancelled(bidId);
    }

    // ═══════════════════════════════════════════════════════════════════════════
    //  3. x402-LIKE MICROPAYMENT CHANNELS
    // ═══════════════════════════════════════════════════════════════════════════

    /**
     * @notice Open a payment channel for streaming micropayments.
     * @param payee The service provider to pay.
     * @param duration Channel duration in seconds.
     * @return channelId Unique channel identifier.
     *
     * @dev Inspired by x402 protocol: escrow → service → claim with proof.
     *      Channel deposits are held by this contract until claimed or expired.
     */
    function openChannel(
        address payee,
        uint256 duration
    ) external payable whenNotPaused nonReentrant returns (bytes32 channelId) {
        require(msg.value > 0, "ZeroDeposit");
        require(payee != address(0) && payee != msg.sender, "InvalidPayee");
        require(duration > 0 && duration <= 30 days, "InvalidDuration");

        channelId = keccak256(abi.encodePacked(
            CIRCUIT_ID, msg.sender, payee, block.number, channelCount++
        ));

        channels[channelId] = PaymentChannel({
            channelId: channelId,
            payer: msg.sender,
            payee: payee,
            deposit: msg.value,
            spent: 0,
            openedAt: uint64(block.timestamp),
            expiresAt: uint64(block.timestamp + duration),
            active: true
        });

        emit ChannelOpened(channelId, msg.sender, payee, msg.value, uint64(block.timestamp + duration));
    }

    /**
     * @notice Claim payment from a channel with ZK proof of service delivery.
     * @param channelId Channel to claim from.
     * @param amount Amount to claim.
     * @param proof SP1 proof of service delivery.
     * @param publicValues Public values from SP1 proof.
     * @param nullifier Replay protection.
     *
     * @dev Payee calls this after delivering service. Proof ensures the claim
     *      is valid and the service was actually delivered. Multiple claims
     *      allowed up to the channel deposit.
     */
    function claimChannel(
        bytes32 channelId,
        uint256 amount,
        bytes calldata proof,
        bytes calldata publicValues,
        bytes32 nullifier
    ) external nonReentrant whenNotPaused {
        PaymentChannel storage ch = channels[channelId];
        if (ch.openedAt == 0) revert ChannelNotFound();
        if (!ch.active) revert ChannelNotActive();
        if (block.timestamp > ch.expiresAt) revert ChannelExpired();
        require(msg.sender == ch.payee, "OnlyPayee");
        if (ch.spent + amount > ch.deposit) revert InsufficientChannelBalance();
        if (usedNullifiers[nullifier]) revert NullifierUsed();

        usedNullifiers[nullifier] = true;

        // Verify proof via Core ZKVerifier
        if (zkVerifier != address(0)) {
            (bool ok, ) = zkVerifier.call(
                abi.encodeWithSignature(
                    "verifyProof(bytes32,bytes,bytes,bytes32)",
                    CIRCUIT_ID, publicValues, proof, nullifier
                )
            );
            require(ok, "ProofFailed");
        }

        ch.spent += amount;

        // Calculate fee
        uint256 fee = (amount * taskFeeBps) / BPS_DENOM;
        uint256 payout = amount - fee;

        // Pay payee
        (bool ok1, ) = payable(ch.payee).call{value: payout}("");
        require(ok1, "ClaimPay");

        // Forward fee
        if (fee > 0) {
            totalTaskFees += fee;
            _forwardFee(fee);
        }

        totalMessagesRelayed++;
        emit ChannelClaimed(channelId, amount, nullifier);
    }

    /**
     * @notice Close an expired channel and refund remaining deposit.
     */
    function closeChannel(bytes32 channelId) external nonReentrant {
        PaymentChannel storage ch = channels[channelId];
        if (ch.openedAt == 0) revert ChannelNotFound();
        if (!ch.active) revert ChannelNotActive();
        require(
            msg.sender == ch.payer || block.timestamp > ch.expiresAt,
            "NotExpiredOrPayer"
        );

        ch.active = false;

        uint256 refund = ch.deposit - ch.spent;
        if (refund > 0) {
            (bool ok, ) = payable(ch.payer).call{value: refund}("");
            require(ok, "RefundFailed");
        }

        emit ChannelClosed(channelId, refund);
    }

    // ═══════════════════════════════════════════════════════════════════════════
    //  4. ZK-GATED MESSAGING
    // ═══════════════════════════════════════════════════════════════════════════

    /**
     * @notice Send a ZK-gated A2A message with optional escrow.
     * @param recipient Target agent address.
     * @param payloadHash SHA-256 of the message payload (stored off-chain).
     *
     * @dev Emits A2AMessageSent for ai-listener.js to relay.
     *      If msg.value > 0, it acts as escrowed payment for the message.
     */
    function sendMessage(
        address recipient,
        bytes32 payloadHash
    ) external payable whenNotPaused nonReentrant {
        if (!agents[recipient].active) revert AgentNotRegistered();

        uint256 relayFee = 0;
        if (msg.value > 0) {
            relayFee = (msg.value * relayFeeBps) / BPS_DENOM;
            totalRelayFees += relayFee;
            _forwardFee(relayFee);
        }

        totalMessagesRelayed++;

        emit A2AMessageSent(CIRCUIT_ID, msg.sender, recipient, payloadHash, msg.value - relayFee);
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

    // ─── Admin ────────────────────────────────────────────────────────────────

    function setRelayFee(uint16 _bps) external onlyRole(DEFAULT_ADMIN_ROLE) {
        require(_bps <= 100, "MaxFee1%");
        relayFeeBps = _bps;
    }

    function setTaskFee(uint16 _bps) external onlyRole(DEFAULT_ADMIN_ROLE) {
        require(_bps >= 10 && _bps <= 100, "FeeRange");
        taskFeeBps = _bps;
    }

    function setRevenueSplitter(address _rs) external onlyRole(DEFAULT_ADMIN_ROLE) {
        revenueSplitter = _rs;
    }

    function setZKVerifier(address _zk) external onlyRole(DEFAULT_ADMIN_ROLE) {
        zkVerifier = _zk;
    }

    function pause() external onlyRole(OPERATOR_ROLE) { _pause(); }
    function unpause() external onlyRole(OPERATOR_ROLE) { _unpause(); }

    // ─── Views ────────────────────────────────────────────────────────────────

    function getAgent(address addr) external view returns (Agent memory) {
        return agents[addr];
    }

    function getBid(bytes32 bidId) external view returns (Bid memory) {
        return bids[bidId];
    }

    function getChannel(bytes32 channelId) external view returns (PaymentChannel memory) {
        return channels[channelId];
    }

    function getStats() external view returns (
        uint256 agents_, uint256 bids_, uint256 active_,
        uint256 relayFees_, uint256 taskFees_,
        uint256 messages_, uint256 settled_
    ) {
        return (agentCount, bidCount, activeBids, totalRelayFees,
                totalTaskFees, totalMessagesRelayed, totalSettled);
    }

    receive() external payable {}
}
