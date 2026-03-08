// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/access/AccessControl.sol";
import "@openzeppelin/contracts/utils/Pausable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/**
 * @title NearAgents
 * @author XFuel Protocol — Expansion Circuit
 * @notice Usability-focused autonomous AI agent circuit with chain-abstraction
 *         awareness, intent-based task execution, and ZK-verified agent actions.
 *
 * Architecture (inspired by NEAR AI Agent Framework, generalized for EVM):
 *   1. Agent Registry     — Register autonomous agents with capability profiles.
 *   2. Intent Submission   — Users submit natural-language intents with budgets.
 *   3. Agent Bidding       — Agents bid on intents; best bid selected by solver.
 *   4. Execution & Proof   — Agent executes intent; SP1 proves correct execution.
 *   5. Settlement          — Payment released; reputation updated.
 *
 * Research ties:
 *   Per NEAR (near.org, docs.near.org, 2026):
 *     - Shade Agents: TEE-based autonomous agents with persistent key management.
 *       Agents generate keys in TEEs, register via code hash verification + attestation.
 *       Non-custodial: no single entity controls private keys.
 *     - Chain Signatures: MPC-based cross-chain signing secured by NEAR validators
 *       + Eigenlayer restakers. Supports BTC, ETH, Cosmos, DOGE, XRP.
 *     - NEAR AI Agent Market (Feb 2026): decentralized marketplace where agents
 *       bid on tasks, execute, receive NEAR payment. Expands Intents from
 *       capital markets to generic natural-language intents.
 *     - Chain Abstraction: eliminates blockchain complexity — AI interacts with
 *       multi-chain assets as a single system. Omnibridge for trustless transfers.
 *     - Multichain Gas Relayer: pay gas with NEAR/NEP-141 across any chain.
 *
 *   For XFuel integration:
 *     - Agents registered on-chain with capability commitments (ZK-private skills).
 *     - Intents are chain-abstracted: users specify outcomes, not execution paths.
 *     - SP1 proves: "Agent A executed intent I correctly, producing result R"
 *       without revealing the agent's proprietary strategy or model weights.
 *     - Reputation scores updated per settlement (quality-weighted).
 *     - Fees flow to CoreRevenueSplitter (protocol) + agent (performance).
 *
 * Core Layer integration:
 *   - Emits IntentSubmitted / IntentSettled for ai-listener.js coordination.
 *   - Sends protocol fees to CoreRevenueSplitter via depositFee(CIRCUIT_ID).
 *   - Uses ZKVerifierSP1 for execution proof verification.
 *   - Fully isolated: own agent registry, intent state, reputation tracking.
 */
contract NearAgents is AccessControl, Pausable, ReentrancyGuard {
    bytes32 public constant SOLVER_ROLE = keccak256("SOLVER_ROLE");
    bytes32 public constant OPERATOR_ROLE = keccak256("OPERATOR_ROLE");
    bytes32 public constant CIRCUIT_ID = keccak256("NEAR_AGENTS_CIRCUIT");

    address public revenueSplitter;
    address public zkVerifier;

    uint16 public protocolFeeBps = 50;         // 0.5% protocol fee on intent payment
    uint16 public constant MAX_FEE = 200;      // 2% max
    uint16 public constant BPS_DENOM = 10000;

    // ─── Agent Registry ───────────────────────────────────────────────────
    struct Agent {
        bytes32 agentId;
        address owner;
        bytes32 capabilityHash;       // keccak256(capability_manifest) — private skills
        bytes32 attestationHash;      // TEE attestation or code hash for verification
        string agentType;             // "llm", "trading", "data", "code", "physical"
        uint256 reputation;           // Cumulative quality score (0+)
        uint256 tasksCompleted;
        uint256 totalEarned;
        bool active;
        uint64 registeredAt;
    }

    mapping(bytes32 => Agent) public agents;
    uint256 public agentCount;

    // ─── Intents ──────────────────────────────────────────────────────────
    enum IntentStatus { Open, Assigned, Executed, Settled, Cancelled, Disputed }

    struct Intent {
        bytes32 intentId;
        address requester;
        bytes32 intentHash;           // keccak256(natural_language_intent + params)
        bytes32 constraintHash;       // keccak256(output_constraints)
        uint256 budget;               // Max payment for this intent
        uint256 bidCount;
        IntentStatus status;
        uint64 createdAt;
        uint64 deadline;
    }

    mapping(bytes32 => Intent) public intents;
    uint256 public intentCount;

    // ─── Bids ─────────────────────────────────────────────────────────────
    struct Bid {
        bytes32 bidId;
        bytes32 intentId;
        bytes32 agentId;
        uint256 price;                // Agent's asking price
        bytes32 approachHash;         // keccak256(execution_plan) — private
        uint64 submittedAt;
    }

    mapping(bytes32 => Bid) public bids;
    mapping(bytes32 => bytes32[]) public intentBids;  // intentId → bidIds
    uint256 public bidCount;

    // ─── Assignments & Settlements ────────────────────────────────────────
    struct Assignment {
        bytes32 intentId;
        bytes32 agentId;
        bytes32 bidId;
        uint256 agreedPrice;
        bytes32 resultHash;           // keccak256(execution_result)
        bytes32 proofNullifier;
        uint256 qualityScore;
        bool settled;
        uint64 assignedAt;
        uint64 settledAt;
    }

    mapping(bytes32 => Assignment) public assignments;   // intentId → assignment

    // ─── Nullifier Tracking ───────────────────────────────────────────────
    mapping(bytes32 => bool) public usedNullifiers;

    // ─── Metrics ──────────────────────────────────────────────────────────
    uint256 public totalVolume;
    uint256 public totalFeesCollected;
    uint256 public totalSettlements;

    // ─── Events ───────────────────────────────────────────────────────────
    event AgentRegistered(bytes32 indexed circuitId, bytes32 indexed agentId, address owner, string agentType, bytes32 capabilityHash);
    event IntentSubmitted(bytes32 indexed circuitId, bytes32 indexed intentId, address requester, bytes32 intentHash, uint256 budget);
    event BidPlaced(bytes32 indexed intentId, bytes32 bidId, bytes32 agentId, uint256 price);
    event IntentAssigned(bytes32 indexed intentId, bytes32 agentId, bytes32 bidId, uint256 agreedPrice);
    event IntentSettled(bytes32 indexed circuitId, bytes32 indexed intentId, bytes32 agentId, bytes32 resultHash, uint256 qualityScore, bytes32 nullifier);
    event AgentReputationUpdated(bytes32 indexed agentId, uint256 newReputation, uint256 tasksCompleted);
    event IntentCancelled(bytes32 indexed intentId);

    error AgentNotFound();
    error IntentNotFound();
    error InvalidStatus();
    error NullifierUsed();
    error DeadlinePassed();
    error InsufficientBudget();
    error NotRequester();
    error BidTooHigh();

    constructor(address _admin, address _revenueSplitter, address _zkVerifier) {
        require(_admin != address(0), "ZeroAdmin");
        revenueSplitter = _revenueSplitter;
        zkVerifier = _zkVerifier;
        _grantRole(DEFAULT_ADMIN_ROLE, _admin);
        _grantRole(SOLVER_ROLE, _admin);
        _grantRole(OPERATOR_ROLE, _admin);
    }

    // ═══════════════════════════════════════════════════════════════════════
    //  1. AGENT REGISTRY
    // ═══════════════════════════════════════════════════════════════════════

    function registerAgent(
        bytes32 capabilityHash,
        bytes32 attestationHash,
        string calldata agentType
    ) external whenNotPaused returns (bytes32 agentId) {
        require(capabilityHash != bytes32(0), "ZeroCapability");

        agentId = keccak256(abi.encodePacked(CIRCUIT_ID, msg.sender, agentCount));

        agents[agentId] = Agent({
            agentId: agentId,
            owner: msg.sender,
            capabilityHash: capabilityHash,
            attestationHash: attestationHash,
            agentType: agentType,
            reputation: 0,
            tasksCompleted: 0,
            totalEarned: 0,
            active: true,
            registeredAt: uint64(block.timestamp)
        });

        agentCount++;
        emit AgentRegistered(CIRCUIT_ID, agentId, msg.sender, agentType, capabilityHash);
    }

    function deactivateAgent(bytes32 agentId) external {
        Agent storage a = agents[agentId];
        if (a.registeredAt == 0) revert AgentNotFound();
        require(msg.sender == a.owner || hasRole(OPERATOR_ROLE, msg.sender), "NotAuth");
        a.active = false;
    }

    // ═══════════════════════════════════════════════════════════════════════
    //  2. INTENT SUBMISSION
    // ═══════════════════════════════════════════════════════════════════════

    function submitIntent(
        bytes32 intentHash,
        bytes32 constraintHash,
        uint64 deadline
    ) external payable whenNotPaused nonReentrant returns (bytes32 intentId) {
        require(msg.value > 0, "ZeroBudget");
        require(deadline > block.timestamp, "PastDeadline");

        intentId = keccak256(abi.encodePacked(CIRCUIT_ID, msg.sender, intentCount));

        intents[intentId] = Intent({
            intentId: intentId,
            requester: msg.sender,
            intentHash: intentHash,
            constraintHash: constraintHash,
            budget: msg.value,
            bidCount: 0,
            status: IntentStatus.Open,
            createdAt: uint64(block.timestamp),
            deadline: deadline
        });

        intentCount++;
        totalVolume += msg.value;

        emit IntentSubmitted(CIRCUIT_ID, intentId, msg.sender, intentHash, msg.value);
    }

    function cancelIntent(bytes32 intentId) external nonReentrant {
        Intent storage i = intents[intentId];
        if (i.createdAt == 0) revert IntentNotFound();
        if (msg.sender != i.requester) revert NotRequester();
        if (i.status != IntentStatus.Open) revert InvalidStatus();

        i.status = IntentStatus.Cancelled;

        (bool ok, ) = payable(msg.sender).call{value: i.budget}("");
        require(ok, "RefundFailed");

        emit IntentCancelled(intentId);
    }

    // ═══════════════════════════════════════════════════════════════════════
    //  3. BIDDING
    // ═══════════════════════════════════════════════════════════════════════

    function placeBid(
        bytes32 intentId,
        bytes32 agentId,
        uint256 price,
        bytes32 approachHash
    ) external whenNotPaused returns (bytes32 bidId) {
        Intent storage i = intents[intentId];
        if (i.createdAt == 0) revert IntentNotFound();
        if (i.status != IntentStatus.Open) revert InvalidStatus();
        if (block.timestamp > i.deadline) revert DeadlinePassed();
        if (price > i.budget) revert BidTooHigh();

        Agent storage a = agents[agentId];
        if (a.registeredAt == 0) revert AgentNotFound();
        require(msg.sender == a.owner, "NotAgentOwner");

        bidId = keccak256(abi.encodePacked(CIRCUIT_ID, intentId, agentId, bidCount));

        bids[bidId] = Bid({
            bidId: bidId,
            intentId: intentId,
            agentId: agentId,
            price: price,
            approachHash: approachHash,
            submittedAt: uint64(block.timestamp)
        });

        intentBids[intentId].push(bidId);
        i.bidCount++;
        bidCount++;

        emit BidPlaced(intentId, bidId, agentId, price);
    }

    // ═══════════════════════════════════════════════════════════════════════
    //  4. ASSIGNMENT (SOLVER)
    // ═══════════════════════════════════════════════════════════════════════

    function assignIntent(
        bytes32 intentId,
        bytes32 bidId
    ) external onlyRole(SOLVER_ROLE) {
        Intent storage i = intents[intentId];
        if (i.createdAt == 0) revert IntentNotFound();
        if (i.status != IntentStatus.Open) revert InvalidStatus();

        Bid storage b = bids[bidId];
        require(b.intentId == intentId, "BidMismatch");

        i.status = IntentStatus.Assigned;

        assignments[intentId] = Assignment({
            intentId: intentId,
            agentId: b.agentId,
            bidId: bidId,
            agreedPrice: b.price,
            resultHash: bytes32(0),
            proofNullifier: bytes32(0),
            qualityScore: 0,
            settled: false,
            assignedAt: uint64(block.timestamp),
            settledAt: 0
        });

        emit IntentAssigned(intentId, b.agentId, bidId, b.price);
    }

    // ═══════════════════════════════════════════════════════════════════════
    //  5. SETTLEMENT (ZK-VERIFIED)
    // ═══════════════════════════════════════════════════════════════════════

    function settleIntent(
        bytes32 intentId,
        bytes32 resultHash,
        uint256 qualityScore,
        bytes calldata proof,
        bytes calldata publicValues,
        bytes32 nullifier
    ) external onlyRole(SOLVER_ROLE) nonReentrant whenNotPaused {
        Intent storage i = intents[intentId];
        if (i.createdAt == 0) revert IntentNotFound();
        if (i.status != IntentStatus.Assigned) revert InvalidStatus();
        if (usedNullifiers[nullifier]) revert NullifierUsed();

        usedNullifiers[nullifier] = true;

        // Verify SP1 proof
        if (zkVerifier != address(0)) {
            (bool ok, ) = zkVerifier.call(
                abi.encodeWithSignature(
                    "verifyProof(bytes32,bytes,bytes,bytes32)",
                    CIRCUIT_ID, publicValues, proof, nullifier
                )
            );
            require(ok, "ProofFailed");
        }

        Assignment storage asgn = assignments[intentId];
        require(!asgn.settled, "AlreadySettled");

        asgn.resultHash = resultHash;
        asgn.proofNullifier = nullifier;
        asgn.qualityScore = qualityScore;
        asgn.settled = true;
        asgn.settledAt = uint64(block.timestamp);

        i.status = IntentStatus.Settled;

        // Calculate fees and payment
        uint256 fee = (asgn.agreedPrice * protocolFeeBps) / BPS_DENOM;
        uint256 agentPayment = asgn.agreedPrice - fee;
        uint256 refund = i.budget - asgn.agreedPrice;

        // Update agent reputation
        Agent storage agent = agents[asgn.agentId];
        agent.reputation += qualityScore;
        agent.tasksCompleted++;
        agent.totalEarned += agentPayment;

        totalFeesCollected += fee;
        totalSettlements++;

        // Forward protocol fee
        if (fee > 0) _forwardFee(fee);

        // Pay agent
        (bool ok1, ) = payable(agent.owner).call{value: agentPayment}("");
        require(ok1, "AgentPayFailed");

        // Refund excess to requester
        if (refund > 0) {
            (bool ok2, ) = payable(i.requester).call{value: refund}("");
            require(ok2, "RefundFailed");
        }

        emit IntentSettled(CIRCUIT_ID, intentId, asgn.agentId, resultHash, qualityScore, nullifier);
        emit AgentReputationUpdated(asgn.agentId, agent.reputation, agent.tasksCompleted);
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

    function setProtocolFee(uint16 _bps) external onlyRole(DEFAULT_ADMIN_ROLE) {
        require(_bps <= MAX_FEE, "FeeTooHigh");
        protocolFeeBps = _bps;
    }

    function setRevenueSplitter(address _rs) external onlyRole(DEFAULT_ADMIN_ROLE) { revenueSplitter = _rs; }
    function setZKVerifier(address _zk) external onlyRole(DEFAULT_ADMIN_ROLE) { zkVerifier = _zk; }
    function pause() external onlyRole(DEFAULT_ADMIN_ROLE) { _pause(); }
    function unpause() external onlyRole(DEFAULT_ADMIN_ROLE) { _unpause(); }

    // ─── Views ────────────────────────────────────────────────────────────

    function getAgent(bytes32 id) external view returns (Agent memory) { return agents[id]; }
    function getIntent(bytes32 id) external view returns (Intent memory) { return intents[id]; }
    function getBid(bytes32 id) external view returns (Bid memory) { return bids[id]; }
    function getAssignment(bytes32 id) external view returns (Assignment memory) { return assignments[id]; }
    function getIntentBidCount(bytes32 intentId) external view returns (uint256) { return intentBids[intentId].length; }

    function getStats() external view returns (
        uint256 agents_, uint256 intents_, uint256 bids_,
        uint256 volume_, uint256 fees_, uint256 settlements_
    ) {
        return (agentCount, intentCount, bidCount, totalVolume, totalFeesCollected, totalSettlements);
    }

    receive() external payable {}
}
