// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/access/AccessControl.sol";
import "@openzeppelin/contracts/utils/Pausable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/**
 * @title AIDePINRouter
 * @author xFuel Protocol (@XFuelLab)
 * @notice On-chain AI DePIN task router for Phase E of the XFuel Protocol.
 *         Routes AI inference/compute tasks across Osmosis, Akash, and Bittensor (TAO)
 *         chains, verifies SP1 ZK proofs for cross-chain settlement, and collects
 *         0.5-1% protocol fees to the RevenueSplitter (30/30/25/15 split).
 *
 * @dev Architecture overview (Whitepaper v4.5 — Phase E):
 *
 *   ┌──────────────┐    ┌──────────────┐    ┌────────────────┐
 *   │ THETA EDGE   │    │   OSMOSIS    │    │  AKASH / TAO   │
 *   │ (compute     │◄──▶│ (settlement  │◄──▶│ (AI inference, │
 *   │  credits)    │    │  + yields)   │    │  GPU leases)   │
 *   └──────────────┘    └──────────────┘    └────────────────┘
 *          │                    │                    │
 *     ZK-verified A2A     0.5-1% fee          IBC compute bids
 *     task routing        → 30/30/25/15       Substrate bridge
 *
 *   Integrates with:
 *   - ai-listener.js: Backend monitors this contract for TaskRouted events, routes
 *     to Theta Edge Cloud / Akash / TAO, then calls settleTask() with SP1 proof.
 *   - sp1-prover/program/src/main.rs: ProofType::AITask and ProofType::A2AMessage
 *     circuits validate task fee math, output hashes, and nonce replay protection.
 *   - RevenueSplitter.sol: Receives collected fees for 30/30/25/15 distribution.
 *
 *   Uses OpenZeppelin AccessControl, Pausable, and ReentrancyGuard.
 */
contract AIDePINRouter is AccessControl, Pausable, ReentrancyGuard {

    // =========================================================================
    // ROLES
    // =========================================================================

    /// @notice Role for backend relayers that settle tasks with SP1 proofs
    bytes32 public constant RELAYER_ROLE = keccak256("RELAYER_ROLE");

    /// @notice Role for accounts that can pause the router
    bytes32 public constant PAUSER_ROLE = keccak256("PAUSER_ROLE");

    /// @notice Role for accounts that can update configuration
    bytes32 public constant CONFIG_ROLE = keccak256("CONFIG_ROLE");

    // =========================================================================
    // ENUMS — Phase E.3 Message Types (matches main.rs & ai-listener.js)
    // =========================================================================

    /**
     * @notice AI task / A2A message types from Whitepaper v4.5 Phase E.3
     * @dev Must stay in sync with MessageType in sp1-prover/program/src/main.rs
     *      and AI_INTENT_TYPES in backend/theta-bridge/src/ai-listener.js.
     *
     *   | Type              | Description                                                |
     *   |-------------------|------------------------------------------------------------|
     *   | COMPUTE_BID       | Agent requests GPU resources with ZK-verified escrow       |
     *   | COMPUTE_RESULT    | Provider attests job completion with output hash            |
     *   | INFERENCE_REQUEST | Route ML inference to optimal subnet (Theta/Akash/TAO)     |
     *   | CAPABILITY_QUERY  | Agent discovers peer capabilities across chains             |
     *   | DATA_ATTESTATION  | Certify dataset provenance on-chain                        |
     */
    enum MessageType {
        COMPUTE_BID,        // 0
        COMPUTE_RESULT,     // 1
        INFERENCE_REQUEST,  // 2
        CAPABILITY_QUERY,   // 3
        DATA_ATTESTATION    // 4
    }

    /**
     * @notice Supported destination chains for AI DePIN routing
     * @dev Must stay in sync with ChainId in sp1-prover/program/src/main.rs
     */
    enum ChainId {
        Theta,       // 0 — Origin chain (local compute via Edge Cloud)
        Osmosis,     // 1 — Primary Cosmos destination (BTC/AI pools, settlement)
        Akash,       // 2 — GPU compute marketplace (IBC-native)
        Bittensor,   // 3 — TAO AI inference subnets (Substrate + EVM)
        Persistence  // 4 — Backward-compatible LST routing
    }

    /**
     * @notice Outcome of SP1 ZK proof verification
     * @dev Maps to ProofOutcome in sp1-prover/program/src/main.rs
     *      Allows non-fatal proof failures without halting the pipeline.
     *      ai-listener.js retries Regenerable outcomes automatically.
     */
    enum ProofOutcome {
        Valid,        // 0 — Proof accepted, settlement proceeds
        Regenerable,  // 1 — Soft failure, can retry (stale height, timeout)
        Invalid       // 2 — Hard failure, permanently invalid
    }

    // =========================================================================
    // STRUCTS
    // =========================================================================

    /**
     * @notice An AI task routed through the protocol
     * @dev Field layout designed for ai-listener.js compatibility:
     *      ai-listener.js creates tasks with matching fields in _processAIIntent()
     *      and generates SP1 proof requests in _generateTaskProof().
     */
    struct AITask {
        bytes32 taskId;              // SHA-256 of task ID (matches ai-listener.js taskId)
        MessageType msgType;         // Task / message type
        ChainId sourceChain;         // Chain where the task originated
        ChainId destinationChain;    // Chain where settlement occurs
        address requester;           // Address of the requesting agent (Theta EVM)
        uint256 grossAmount;         // Total task value (wei)
        uint256 feeAmount;           // Protocol fee collected (0.5-1%)
        uint256 netAmount;           // Net settlement after fee
        uint16 feeBps;               // Fee rate in basis points (50-100)
        bytes32 outputHash;          // Hash of compute/inference output (for COMPUTE_RESULT)
        bytes32 modelIdHash;         // Hash of ML model identifier (for INFERENCE_REQUEST)
        bytes32 inputHash;           // Hash of task input data
        uint64 nonce;                // Per-agent replay protection
        uint64 timestamp;            // Task submission timestamp
        bool settled;                // Whether the task has been settled via SP1 proof
        ProofOutcome proofOutcome;   // Outcome of the last proof verification
    }

    /**
     * @notice An A2A (Agent-to-Agent) message routed through the protocol
     * @dev Phase E.3: ZK-verifiable agent communications across Theta, Akash, TAO
     */
    struct A2AMessage {
        bytes32 messageId;           // Unique message identifier
        MessageType msgType;         // Message type
        ChainId senderChain;         // Origin chain
        ChainId recipientChain;      // Destination chain
        bytes32 payloadHash;         // SHA-256 of message payload
        uint256 escrowAmount;        // TFUEL/AKT/TAO locked (zero if no escrow)
        uint64 nonce;                // Per-agent replay protection
        uint64 ttl;                  // Time-to-live in seconds (max 86400 = 24h)
        uint64 timestamp;            // Message timestamp
        bool verified;               // Whether SP1 proof has been verified
    }

    // =========================================================================
    // STATE VARIABLES
    // =========================================================================

    /// @notice Address of the RevenueSplitter contract (receives protocol fees)
    address public revenueSplitter;

    /// @notice Minimum fee rate in basis points (0.5% = 50 BPS)
    uint16 public constant MIN_FEE_BPS = 50;

    /// @notice Maximum fee rate in basis points (1.0% = 100 BPS)
    uint16 public constant MAX_FEE_BPS = 100;

    /// @notice Default fee rate for AI tasks (0.5% = 50 BPS)
    uint16 public defaultFeeBps = 50;

    /// @notice A2A message relay fee (0.1% = 10 BPS on escrowed amounts)
    uint16 public constant A2A_RELAY_FEE_BPS = 10;

    /// @notice Minimum task amount to prevent dust (matches ai-listener.js MIN_TASK_AMOUNT)
    uint256 public constant MIN_TASK_AMOUNT = 10000;

    /// @notice Maximum batch size for proof verification (matches main.rs max batch_size)
    uint32 public constant MAX_BATCH_SIZE = 20;

    /// @notice Address of the SP1 verifier contract on Theta
    address public sp1Verifier;

    /// @notice Mapping of task ID → AITask
    mapping(bytes32 => AITask) public tasks;

    /// @notice Mapping of message ID → A2AMessage
    mapping(bytes32 => A2AMessage) public messages;

    /// @notice Used nullifiers for replay protection (nullifier → used)
    mapping(bytes32 => bool) public usedNullifiers;

    /// @notice Per-agent nonce tracking (agent address → last used nonce)
    mapping(address => uint64) public agentNonces;

    /// @notice Registered agent identities (agent address → identity commitment hash)
    mapping(address => bytes32) public registeredAgents;

    /// @notice Total number of tasks routed
    uint256 public totalTasksRouted;

    /// @notice Total number of tasks settled
    uint256 public totalTasksSettled;

    /// @notice Total number of A2A messages verified
    uint256 public totalA2AMessagesVerified;

    /// @notice Total protocol fees collected (in wei)
    uint256 public totalFeesCollected;

    /// @notice Total fees forwarded to RevenueSplitter
    uint256 public totalFeesForwarded;

    /// @notice Accumulated fees pending forwarding to RevenueSplitter
    uint256 public pendingFees;

    /// @notice Fee forwarding threshold (when pendingFees >= threshold, auto-forward)
    uint256 public feeForwardThreshold = 0.1 ether; // 0.1 TFUEL default

    /// @notice Circuit breaker: max tasks per block to prevent spam
    uint256 public maxTasksPerBlock = 50;

    /// @notice Tasks routed in the current block
    uint256 private _currentBlockTaskCount;

    /// @notice Block number for the current task count
    uint256 private _currentBlockNumber;

    // =========================================================================
    // EVENTS — A2A Communications (Phase E.3)
    // =========================================================================

    /**
     * @notice Emitted when an AI task is routed to a destination chain
     * @dev ai-listener.js monitors this event to trigger Theta Edge / Akash / TAO routing
     *      Event format matches the proof request structure in _generateTaskProof()
     */
    event TaskRouted(
        bytes32 indexed taskId,
        MessageType indexed msgType,
        ChainId sourceChain,
        ChainId destinationChain,
        address indexed requester,
        uint256 grossAmount,
        uint256 feeAmount,
        uint256 netAmount,
        uint16 feeBps,
        bytes32 modelIdHash,
        bytes32 inputHash,
        uint64 nonce,
        uint64 timestamp
    );

    /**
     * @notice Emitted when an SP1 ZK proof is verified for a task settlement
     * @dev Backend calls settleTask() after SP1 prover generates AITask proof.
     *      Maps to validate_ai_task() output: (nullifier, fee_commitment, output_hash).
     */
    event ProofVerified(
        bytes32 indexed taskId,
        bytes32 indexed nullifier,
        ProofOutcome outcome,
        bytes32 outputHash,
        bytes32 feeCommitment,
        uint256 feeAmount
    );

    /**
     * @notice Emitted when an A2A message is submitted and verified
     * @dev Phase E.3: Agent-to-agent ZK-verified messaging events
     */
    event A2AMessageVerified(
        bytes32 indexed messageId,
        MessageType indexed msgType,
        ChainId senderChain,
        ChainId recipientChain,
        bytes32 payloadHash,
        uint256 escrowAmount,
        uint64 nonce,
        bytes32 nullifier
    );

    /**
     * @notice Emitted when a proof verification results in a non-fatal failure
     * @dev ProofOutcome.Regenerable triggers ai-listener.js to retry with fresh inputs
     */
    event ProofRegenerableFailure(
        bytes32 indexed taskId,
        bytes32 reasonHash,
        uint256 retryAfterBlock
    );

    /**
     * @notice Emitted when fees are forwarded to RevenueSplitter
     */
    event FeesForwarded(
        address indexed revenueSplitter,
        uint256 amount,
        uint256 totalForwarded
    );

    /**
     * @notice Emitted when an AI agent registers its on-chain identity
     */
    event AgentRegistered(
        address indexed agent,
        bytes32 identityCommitment
    );

    /**
     * @notice Emitted when the SP1 verifier address is updated
     */
    event SP1VerifierUpdated(
        address indexed oldVerifier,
        address indexed newVerifier
    );

    /**
     * @notice Emitted when the RevenueSplitter address is updated
     */
    event RevenueSplitterUpdated(
        address indexed oldSplitter,
        address indexed newSplitter
    );

    // =========================================================================
    // ERRORS
    // =========================================================================

    error ZeroAddress();
    error TaskAlreadyExists(bytes32 taskId);
    error TaskNotFound(bytes32 taskId);
    error TaskAlreadySettled(bytes32 taskId);
    error MessageAlreadyExists(bytes32 messageId);
    error MessageNotFound(bytes32 messageId);
    error MessageAlreadyVerified(bytes32 messageId);
    error NullifierAlreadyUsed(bytes32 nullifier);
    error InvalidFeeBps(uint16 feeBps);
    error AmountBelowMinimum(uint256 amount, uint256 minimum);
    error InvalidProof();
    error InvalidNonce(uint64 expected, uint64 provided);
    error InvalidTTL(uint64 ttl);
    error EscrowRequiredForType(MessageType msgType);
    error EscrowForbiddenForType(MessageType msgType);
    error InvalidOutputHash();
    error InvalidModelIdHash();
    error InvalidInputHash();
    error MaxTasksPerBlockExceeded();
    error FeeForwardFailed();
    error AgentNotRegistered(address agent);

    // =========================================================================
    // CONSTRUCTOR
    // =========================================================================

    /**
     * @notice Initialize the AIDePINRouter
     * @param _admin Admin address (receives DEFAULT_ADMIN_ROLE, PAUSER_ROLE, CONFIG_ROLE)
     * @param _revenueSplitter Address of the RevenueSplitter (30/30/25/15 distribution)
     * @param _sp1Verifier Address of the SP1 proof verifier on Theta
     */
    constructor(
        address _admin,
        address _revenueSplitter,
        address _sp1Verifier
    ) {
        if (_admin == address(0) || _revenueSplitter == address(0)) {
            revert ZeroAddress();
        }

        revenueSplitter = _revenueSplitter;
        sp1Verifier = _sp1Verifier; // Can be address(0) initially for mock mode

        _grantRole(DEFAULT_ADMIN_ROLE, _admin);
        _grantRole(RELAYER_ROLE, _admin);
        _grantRole(PAUSER_ROLE, _admin);
        _grantRole(CONFIG_ROLE, _admin);
    }

    // =========================================================================
    // AGENT REGISTRATION
    // =========================================================================

    /**
     * @notice Register an AI agent's on-chain identity commitment
     * @param identityCommitment Poseidon hash of the agent's identity secret
     * @dev Required for A2A messaging — validate_a2a_message() checks sender_identity.
     *      Agents can update their identity by re-registering.
     */
    function registerAgent(bytes32 identityCommitment) external {
        if (identityCommitment == bytes32(0)) revert InvalidInputHash();

        registeredAgents[msg.sender] = identityCommitment;

        emit AgentRegistered(msg.sender, identityCommitment);
    }

    // =========================================================================
    // AI TASK ROUTING — routeInference / routeComputeBid / routeTask
    // =========================================================================

    /**
     * @notice Route an ML inference request to a destination chain (Theta Edge / Akash / TAO)
     * @param taskId Unique task identifier (SHA-256 hash)
     * @param destinationChain Target chain for inference execution
     * @param modelIdHash Hash of the ML model identifier (e.g., "llama-3")
     * @param inputHash Hash of the inference input data
     * @dev Convenience wrapper for routeTask with INFERENCE_REQUEST type.
     *      ai-listener.js detects the TaskRouted event and forwards to Theta Edge API:
     *        POST /api/v1/inference/run { model_id, input_hash, budget, ... }
     */
    function routeInference(
        bytes32 taskId,
        ChainId destinationChain,
        bytes32 modelIdHash,
        bytes32 inputHash
    ) external payable whenNotPaused nonReentrant {
        if (modelIdHash == bytes32(0)) revert InvalidModelIdHash();
        if (inputHash == bytes32(0)) revert InvalidInputHash();

        _routeTask(
            taskId,
            MessageType.INFERENCE_REQUEST,
            destinationChain,
            modelIdHash,
            inputHash,
            bytes32(0) // No output hash for requests
        );
    }

    /**
     * @notice Route a GPU compute bid to Akash or Theta Edge Cloud
     * @param taskId Unique task identifier
     * @param destinationChain Target chain (typically Akash for GPU leases)
     * @param inputHash Hash of compute job specification
     * @dev Emits TaskRouted event; ai-listener.js routes via:
     *        POST /api/v1/compute/bid { model_id, budget, max_gpu_hours, ... }
     */
    function routeComputeBid(
        bytes32 taskId,
        ChainId destinationChain,
        bytes32 inputHash
    ) external payable whenNotPaused nonReentrant {
        if (inputHash == bytes32(0)) revert InvalidInputHash();

        _routeTask(
            taskId,
            MessageType.COMPUTE_BID,
            destinationChain,
            bytes32(0), // No model ID for compute bids
            inputHash,
            bytes32(0)
        );
    }

    /**
     * @notice Submit a compute result attestation (provider reports job completion)
     * @param taskId Unique task identifier
     * @param destinationChain Settlement chain
     * @param outputHash Hash of the compute/inference output (critical for COMPUTE_RESULT)
     * @param inputHash Hash of the original input (for binding)
     * @dev COMPUTE_RESULT requires a non-zero outputHash per validate_ai_task() constraints.
     */
    function routeComputeResult(
        bytes32 taskId,
        ChainId destinationChain,
        bytes32 outputHash,
        bytes32 inputHash
    ) external payable whenNotPaused nonReentrant {
        if (outputHash == bytes32(0)) revert InvalidOutputHash();

        _routeTask(
            taskId,
            MessageType.COMPUTE_RESULT,
            destinationChain,
            bytes32(0),
            inputHash,
            outputHash
        );
    }

    /**
     * @notice Route a data attestation request (certify dataset provenance)
     * @param taskId Unique task identifier
     * @param destinationChain Settlement chain
     * @param dataHash Hash of the dataset to attest
     * @dev DATA_ATTESTATION requires non-zero input_hash per main.rs constraints.
     */
    function routeDataAttestation(
        bytes32 taskId,
        ChainId destinationChain,
        bytes32 dataHash
    ) external payable whenNotPaused nonReentrant {
        if (dataHash == bytes32(0)) revert InvalidInputHash();

        _routeTask(
            taskId,
            MessageType.DATA_ATTESTATION,
            destinationChain,
            bytes32(0),
            dataHash,
            bytes32(0)
        );
    }

    /**
     * @notice Route a capability query (discover peer agent capabilities)
     * @param taskId Unique task identifier
     * @param destinationChain Chain to query capabilities from
     * @dev Lightweight discovery — minimal constraints, no fee on queries.
     *      msg.value can be 0 for CAPABILITY_QUERY.
     */
    function routeCapabilityQuery(
        bytes32 taskId,
        ChainId destinationChain
    ) external whenNotPaused {
        if (tasks[taskId].timestamp != 0) revert TaskAlreadyExists(taskId);

        _enforceBlockTaskLimit();

        uint64 nonce = ++agentNonces[msg.sender];

        tasks[taskId] = AITask({
            taskId: taskId,
            msgType: MessageType.CAPABILITY_QUERY,
            sourceChain: ChainId.Theta,
            destinationChain: destinationChain,
            requester: msg.sender,
            grossAmount: 0,
            feeAmount: 0,
            netAmount: 0,
            feeBps: 0,
            outputHash: bytes32(0),
            modelIdHash: bytes32(0),
            inputHash: bytes32(0),
            nonce: nonce,
            timestamp: uint64(block.timestamp),
            settled: false,
            proofOutcome: ProofOutcome.Valid
        });

        totalTasksRouted++;

        emit TaskRouted(
            taskId,
            MessageType.CAPABILITY_QUERY,
            ChainId.Theta,
            destinationChain,
            msg.sender,
            0,
            0,
            0,
            0,
            bytes32(0),
            bytes32(0),
            nonce,
            uint64(block.timestamp)
        );
    }

    /**
     * @notice Generic task routing with custom fee BPS
     * @param taskId Unique task identifier
     * @param msgType Task type (COMPUTE_BID, INFERENCE_REQUEST, etc.)
     * @param destinationChain Target chain for execution/settlement
     * @param feeBps Fee rate in basis points (50-100)
     * @param modelIdHash Hash of the ML model identifier
     * @param inputHash Hash of the task input data
     * @param outputHash Hash of compute output (for COMPUTE_RESULT)
     * @dev Advanced routing with custom fee rate. Validates fee_bps range per
     *      calculate_task_fee() in main.rs: must be [50, 100].
     */
    function routeTaskCustomFee(
        bytes32 taskId,
        MessageType msgType,
        ChainId destinationChain,
        uint16 feeBps,
        bytes32 modelIdHash,
        bytes32 inputHash,
        bytes32 outputHash
    ) external payable whenNotPaused nonReentrant {
        if (feeBps < MIN_FEE_BPS || feeBps > MAX_FEE_BPS) {
            revert InvalidFeeBps(feeBps);
        }

        _routeTaskWithFee(
            taskId,
            msgType,
            destinationChain,
            feeBps,
            modelIdHash,
            inputHash,
            outputHash
        );
    }

    // =========================================================================
    // TASK SETTLEMENT — SP1 ZK Proof Verification
    // =========================================================================

    /**
     * @notice Settle a task with an SP1 ZK proof (called by backend relayer)
     * @param taskId The task to settle
     * @param sp1Proof The SP1 proof bytes from the prover
     * @param nullifier Nullifier from the proof (replay protection)
     * @param outputHash Output hash from the proof (for COMPUTE_RESULT binding)
     * @param feeCommitment Fee commitment hash from fee_collector_commitment()
     *
     * @dev Called by ai-listener.js after SP1 proof generation:
     *      1. ai-listener.js detects TaskRouted event
     *      2. Routes task to Theta Edge / Akash / TAO
     *      3. On completion, calls SP1 prover with AITask proof type
     *      4. Prover runs validate_ai_task() → (nullifier, fee_commitment, output_hash)
     *      5. Relayer calls settleTask() with proof artifacts
     *
     *      The SP1 proof validates (from main.rs validate_ai_task):
     *      - Fee calculation: gross × fee_bps / 10000 = fee_amount
     *      - Net amount: gross - fee = net_amount
     *      - Output hash binding (COMPUTE_RESULT)
     *      - Chain-specific routing (IBC channel or TAO EVM target)
     *      - Nonce freshness → nullifier generated
     */
    function settleTask(
        bytes32 taskId,
        bytes calldata sp1Proof,
        bytes32 nullifier,
        bytes32 outputHash,
        bytes32 feeCommitment
    ) external onlyRole(RELAYER_ROLE) nonReentrant {
        AITask storage task = tasks[taskId];
        if (task.timestamp == 0) revert TaskNotFound(taskId);
        if (task.settled) revert TaskAlreadySettled(taskId);
        if (usedNullifiers[nullifier]) revert NullifierAlreadyUsed(nullifier);

        // Verify SP1 proof via the on-chain verifier
        ProofOutcome outcome = _verifySP1Proof(sp1Proof, taskId);

        // Mark nullifier as used regardless of outcome (prevents replays)
        usedNullifiers[nullifier] = true;

        // Update task state
        task.proofOutcome = outcome;

        if (outcome == ProofOutcome.Valid) {
            task.settled = true;
            task.outputHash = outputHash;
            totalTasksSettled++;

            // Forward fees to RevenueSplitter if threshold reached
            if (task.feeAmount > 0) {
                pendingFees += task.feeAmount;
                totalFeesCollected += task.feeAmount;

                if (pendingFees >= feeForwardThreshold) {
                    _forwardFees();
                }
            }

            emit ProofVerified(
                taskId,
                nullifier,
                ProofOutcome.Valid,
                outputHash,
                feeCommitment,
                task.feeAmount
            );
        } else if (outcome == ProofOutcome.Regenerable) {
            // Non-fatal: ai-listener.js will retry proof generation
            bytes32 reasonHash = keccak256(abi.encodePacked("regenerable", taskId, block.number));

            emit ProofRegenerableFailure(
                taskId,
                reasonHash,
                block.number + 10 // Suggest retry after ~10 blocks
            );

            emit ProofVerified(
                taskId,
                nullifier,
                ProofOutcome.Regenerable,
                outputHash,
                feeCommitment,
                task.feeAmount
            );
        } else {
            // Invalid: permanently failed
            emit ProofVerified(
                taskId,
                nullifier,
                ProofOutcome.Invalid,
                outputHash,
                feeCommitment,
                task.feeAmount
            );
        }
    }

    /**
     * @notice Batch-settle multiple tasks with SP1 proofs
     * @param taskIds Array of task IDs
     * @param sp1Proofs Array of SP1 proofs
     * @param nullifiers Array of nullifiers
     * @param outputHashes Array of output hashes
     * @param feeCommitments Array of fee commitments
     * @dev Batch settlement matches UnifiedBatchOutput from main.rs.
     *      Maximum batch size: 20 (MAX_BATCH_SIZE).
     */
    function settleTaskBatch(
        bytes32[] calldata taskIds,
        bytes[] calldata sp1Proofs,
        bytes32[] calldata nullifiers,
        bytes32[] calldata outputHashes,
        bytes32[] calldata feeCommitments
    ) external onlyRole(RELAYER_ROLE) nonReentrant {
        uint256 len = taskIds.length;
        require(len > 0 && len <= MAX_BATCH_SIZE, "Invalid batch size");
        require(
            sp1Proofs.length == len &&
            nullifiers.length == len &&
            outputHashes.length == len &&
            feeCommitments.length == len,
            "Array length mismatch"
        );

        for (uint256 i = 0; i < len; i++) {
            AITask storage task = tasks[taskIds[i]];
            if (task.timestamp == 0) continue; // Skip non-existent
            if (task.settled) continue; // Skip already settled
            if (usedNullifiers[nullifiers[i]]) continue; // Skip used nullifiers

            ProofOutcome outcome = _verifySP1Proof(sp1Proofs[i], taskIds[i]);

            usedNullifiers[nullifiers[i]] = true;
            task.proofOutcome = outcome;

            if (outcome == ProofOutcome.Valid) {
                task.settled = true;
                task.outputHash = outputHashes[i];
                totalTasksSettled++;

                if (task.feeAmount > 0) {
                    pendingFees += task.feeAmount;
                    totalFeesCollected += task.feeAmount;
                }

                emit ProofVerified(
                    taskIds[i],
                    nullifiers[i],
                    ProofOutcome.Valid,
                    outputHashes[i],
                    feeCommitments[i],
                    task.feeAmount
                );
            }
        }

        // Forward accumulated fees after batch
        if (pendingFees >= feeForwardThreshold) {
            _forwardFees();
        }
    }

    // =========================================================================
    // A2A MESSAGE ROUTING — Phase E.3
    // =========================================================================

    /**
     * @notice Submit and route a ZK-verifiable A2A (Agent-to-Agent) message
     * @param messageId Unique message identifier
     * @param msgType Message type (COMPUTE_BID, COMPUTE_RESULT, etc.)
     * @param recipientChain Destination chain
     * @param payloadHash SHA-256 of the message payload
     * @param ttl Time-to-live in seconds (1 to 86400)
     *
     * @dev Validates escrow requirements per A2AMessage constraints in main.rs:
     *      - COMPUTE_BID: Requires non-zero msg.value (escrow)
     *      - INFERENCE_REQUEST: Requires non-zero msg.value (budget escrow)
     *      - COMPUTE_RESULT: No escrow required
     *      - CAPABILITY_QUERY: Must have zero escrow
     *      - DATA_ATTESTATION: No escrow required
     *
     *      Agent must be registered via registerAgent() before sending A2A messages.
     *      A2A relay fee: 0.1% on escrow amounts → FeeCollector/RevenueSplitter.
     */
    function sendA2AMessage(
        bytes32 messageId,
        MessageType msgType,
        ChainId recipientChain,
        bytes32 payloadHash,
        uint64 ttl
    ) external payable whenNotPaused nonReentrant {
        if (messages[messageId].timestamp != 0) revert MessageAlreadyExists(messageId);
        if (registeredAgents[msg.sender] == bytes32(0)) revert AgentNotRegistered(msg.sender);
        if (payloadHash == bytes32(0)) revert InvalidInputHash();
        if (ttl == 0 || ttl > 86400) revert InvalidTTL(ttl);

        // Validate escrow requirements per message type
        _validateEscrowForMsgType(msgType, msg.value);

        // Calculate A2A relay fee (0.1% on escrow)
        uint256 relayFee = 0;
        if (msg.value > 0) {
            relayFee = (msg.value * A2A_RELAY_FEE_BPS) / 10000;
        }

        uint64 nonce = ++agentNonces[msg.sender];

        messages[messageId] = A2AMessage({
            messageId: messageId,
            msgType: msgType,
            senderChain: ChainId.Theta,
            recipientChain: recipientChain,
            payloadHash: payloadHash,
            escrowAmount: msg.value,
            nonce: nonce,
            ttl: ttl,
            timestamp: uint64(block.timestamp),
            verified: false
        });

        // Track relay fee
        if (relayFee > 0) {
            pendingFees += relayFee;
            totalFeesCollected += relayFee;

            if (pendingFees >= feeForwardThreshold) {
                _forwardFees();
            }
        }

        emit A2AMessageVerified(
            messageId,
            msgType,
            ChainId.Theta,
            recipientChain,
            payloadHash,
            msg.value,
            nonce,
            bytes32(0) // Nullifier set after proof verification
        );
    }

    /**
     * @notice Verify an A2A message with an SP1 proof (called by relayer)
     * @param messageId The message to verify
     * @param sp1Proof The SP1 proof bytes
     * @param nullifier Nullifier from validate_a2a_message()
     * @dev Called after ai-listener.js generates A2AMessage proof type.
     *      SP1 validates: sender identity, escrow lock, nonce, TTL, payload hash, IBC channel.
     */
    function verifyA2AMessage(
        bytes32 messageId,
        bytes calldata sp1Proof,
        bytes32 nullifier
    ) external onlyRole(RELAYER_ROLE) nonReentrant {
        A2AMessage storage msg_ = messages[messageId];
        if (msg_.timestamp == 0) revert MessageNotFound(messageId);
        if (msg_.verified) revert MessageAlreadyVerified(messageId);
        if (usedNullifiers[nullifier]) revert NullifierAlreadyUsed(nullifier);

        ProofOutcome outcome = _verifySP1Proof(sp1Proof, messageId);

        usedNullifiers[nullifier] = true;

        if (outcome == ProofOutcome.Valid) {
            msg_.verified = true;
            totalA2AMessagesVerified++;

            emit A2AMessageVerified(
                messageId,
                msg_.msgType,
                msg_.senderChain,
                msg_.recipientChain,
                msg_.payloadHash,
                msg_.escrowAmount,
                msg_.nonce,
                nullifier
            );
        }
    }

    // =========================================================================
    // FEE MANAGEMENT
    // =========================================================================

    /**
     * @notice Manually forward accumulated fees to RevenueSplitter
     * @dev Can be called by anyone. Fees flow to the 30/30/25/15 split:
     *      30% BBB (buyback-burn), 30% LP, 25% veXF, 15% Treasury.
     */
    function forwardFees() external nonReentrant {
        require(pendingFees > 0, "No pending fees");
        _forwardFees();
    }

    // =========================================================================
    // VIEW FUNCTIONS
    // =========================================================================

    /**
     * @notice Get task details
     * @param taskId The task ID to query
     * @return task The full AITask struct
     */
    function getTask(bytes32 taskId) external view returns (AITask memory) {
        return tasks[taskId];
    }

    /**
     * @notice Get A2A message details
     * @param messageId The message ID to query
     * @return message The full A2AMessage struct
     */
    function getMessage(bytes32 messageId) external view returns (A2AMessage memory) {
        return messages[messageId];
    }

    /**
     * @notice Check if an agent is registered
     * @param agent The agent address to check
     * @return True if the agent has a registered identity commitment
     */
    function isAgentRegistered(address agent) external view returns (bool) {
        return registeredAgents[agent] != bytes32(0);
    }

    /**
     * @notice Calculate the fee for a given task amount and BPS
     * @param grossAmount The gross task value
     * @param feeBps Fee rate in basis points
     * @return feeAmount The calculated fee
     * @return netAmount The amount after fee deduction
     * @dev Mirrors calculate_task_fee() in sp1-prover/program/src/main.rs
     */
    function calculateTaskFee(
        uint256 grossAmount,
        uint16 feeBps
    ) external pure returns (uint256 feeAmount, uint256 netAmount) {
        require(feeBps >= MIN_FEE_BPS && feeBps <= MAX_FEE_BPS, "Fee BPS out of range");
        feeAmount = (grossAmount * feeBps) / 10000;
        netAmount = grossAmount - feeAmount;
    }

    /**
     * @notice Get aggregate router statistics
     * @return _totalRouted Total tasks routed
     * @return _totalSettled Total tasks settled with valid proofs
     * @return _totalA2A Total A2A messages verified
     * @return _totalFees Total fees collected (wei)
     * @return _pendingFees Fees pending forwarding
     */
    function getStats() external view returns (
        uint256 _totalRouted,
        uint256 _totalSettled,
        uint256 _totalA2A,
        uint256 _totalFees,
        uint256 _pendingFees
    ) {
        return (
            totalTasksRouted,
            totalTasksSettled,
            totalA2AMessagesVerified,
            totalFeesCollected,
            pendingFees
        );
    }

    // =========================================================================
    // ADMIN FUNCTIONS
    // =========================================================================

    /**
     * @notice Update the RevenueSplitter address
     * @param _newRevenueSplitter New RevenueSplitter address
     */
    function setRevenueSplitter(address _newRevenueSplitter)
        external
        onlyRole(CONFIG_ROLE)
    {
        if (_newRevenueSplitter == address(0)) revert ZeroAddress();
        address old = revenueSplitter;
        revenueSplitter = _newRevenueSplitter;
        emit RevenueSplitterUpdated(old, _newRevenueSplitter);
    }

    /**
     * @notice Update the SP1 verifier address
     * @param _newSP1Verifier New SP1 verifier contract address
     */
    function setSP1Verifier(address _newSP1Verifier)
        external
        onlyRole(CONFIG_ROLE)
    {
        address old = sp1Verifier;
        sp1Verifier = _newSP1Verifier;
        emit SP1VerifierUpdated(old, _newSP1Verifier);
    }

    /**
     * @notice Update the default fee rate
     * @param _feeBps New default fee rate in basis points (50-100)
     */
    function setDefaultFeeBps(uint16 _feeBps) external onlyRole(CONFIG_ROLE) {
        if (_feeBps < MIN_FEE_BPS || _feeBps > MAX_FEE_BPS) {
            revert InvalidFeeBps(_feeBps);
        }
        defaultFeeBps = _feeBps;
    }

    /**
     * @notice Update the fee forwarding threshold
     * @param _threshold New threshold in wei
     */
    function setFeeForwardThreshold(uint256 _threshold)
        external
        onlyRole(CONFIG_ROLE)
    {
        feeForwardThreshold = _threshold;
    }

    /**
     * @notice Update the max tasks per block (circuit breaker)
     * @param _maxTasks New maximum tasks per block
     */
    function setMaxTasksPerBlock(uint256 _maxTasks)
        external
        onlyRole(CONFIG_ROLE)
    {
        maxTasksPerBlock = _maxTasks;
    }

    /**
     * @notice Pause the router (emergency stop)
     */
    function pause() external onlyRole(PAUSER_ROLE) {
        _pause();
    }

    /**
     * @notice Unpause the router
     */
    function unpause() external onlyRole(PAUSER_ROLE) {
        _unpause();
    }

    // =========================================================================
    // INTERNAL FUNCTIONS
    // =========================================================================

    /**
     * @notice Internal task routing with default fee BPS
     */
    function _routeTask(
        bytes32 taskId,
        MessageType msgType,
        ChainId destinationChain,
        bytes32 modelIdHash,
        bytes32 inputHash,
        bytes32 outputHash
    ) internal {
        _routeTaskWithFee(
            taskId,
            msgType,
            destinationChain,
            defaultFeeBps,
            modelIdHash,
            inputHash,
            outputHash
        );
    }

    /**
     * @notice Internal task routing with custom fee BPS
     * @dev Core routing logic. Calculates fee using calculate_task_fee logic
     *      from sp1-prover/program/src/main.rs:
     *        fee_amount = gross × fee_bps / 10000
     *        net_amount = gross - fee_amount
     */
    function _routeTaskWithFee(
        bytes32 taskId,
        MessageType msgType,
        ChainId destinationChain,
        uint16 feeBps,
        bytes32 modelIdHash,
        bytes32 inputHash,
        bytes32 outputHash
    ) internal {
        if (tasks[taskId].timestamp != 0) revert TaskAlreadyExists(taskId);
        if (msg.value < MIN_TASK_AMOUNT) revert AmountBelowMinimum(msg.value, MIN_TASK_AMOUNT);
        if (feeBps < MIN_FEE_BPS || feeBps > MAX_FEE_BPS) revert InvalidFeeBps(feeBps);

        _enforceBlockTaskLimit();

        // Calculate fee — mirrors calculate_task_fee() in main.rs
        uint256 feeAmount = (msg.value * feeBps) / 10000;
        uint256 netAmount = msg.value - feeAmount;

        uint64 nonce = ++agentNonces[msg.sender];

        tasks[taskId] = AITask({
            taskId: taskId,
            msgType: msgType,
            sourceChain: ChainId.Theta,
            destinationChain: destinationChain,
            requester: msg.sender,
            grossAmount: msg.value,
            feeAmount: feeAmount,
            netAmount: netAmount,
            feeBps: feeBps,
            outputHash: outputHash,
            modelIdHash: modelIdHash,
            inputHash: inputHash,
            nonce: nonce,
            timestamp: uint64(block.timestamp),
            settled: false,
            proofOutcome: ProofOutcome.Valid // Pending — will be updated on settlement
        });

        totalTasksRouted++;

        emit TaskRouted(
            taskId,
            msgType,
            ChainId.Theta,
            destinationChain,
            msg.sender,
            msg.value,
            feeAmount,
            netAmount,
            feeBps,
            modelIdHash,
            inputHash,
            nonce,
            uint64(block.timestamp)
        );
    }

    /**
     * @notice Verify an SP1 proof via the on-chain verifier
     * @param sp1Proof The SP1 proof bytes
     * @param contextId Task or message ID for context
     * @return outcome The proof verification outcome
     * @dev If sp1Verifier is address(0), runs in mock mode (always returns Valid).
     *      This supports governance-prep MOCK_MODE from ai-listener.js.
     */
    function _verifySP1Proof(
        bytes calldata sp1Proof,
        bytes32 contextId
    ) internal view returns (ProofOutcome) {
        // Mock mode: if no verifier is set, accept all proofs
        // This mirrors the MOCK_MODE behavior in ai-listener.js and
        // the mock_mode flag in CosmWasm instantiation
        if (sp1Verifier == address(0)) {
            return ProofOutcome.Valid;
        }

        // Production: call the SP1 verifier contract
        // The verifier implements ISP1Verifier.verifyProof(bytes)
        // Returns true for valid proofs, false for invalid
        (bool success, bytes memory result) = sp1Verifier.staticcall(
            abi.encodeWithSignature("verifyProof(bytes)", sp1Proof)
        );

        if (!success || result.length == 0) {
            // Call failed — treat as regenerable (transient network issue)
            return ProofOutcome.Regenerable;
        }

        bool isValid = abi.decode(result, (bool));

        if (isValid) {
            return ProofOutcome.Valid;
        } else {
            return ProofOutcome.Invalid;
        }
    }

    /**
     * @notice Validate escrow requirements per A2A message type
     * @dev Escrow rules from Whitepaper v4.5 Section 3.4.3:
     *      | COMPUTE_BID       | Yes — agent must lock funds           |
     *      | INFERENCE_REQUEST | Yes — budget must be escrowed         |
     *      | COMPUTE_RESULT    | No  — provider attests completion     |
     *      | CAPABILITY_QUERY  | No  — must be zero (read-only)        |
     *      | DATA_ATTESTATION  | No  — provenance only                 |
     */
    function _validateEscrowForMsgType(MessageType msgType, uint256 escrowAmount) internal pure {
        if (msgType == MessageType.COMPUTE_BID) {
            if (escrowAmount == 0) revert EscrowRequiredForType(msgType);
        } else if (msgType == MessageType.INFERENCE_REQUEST) {
            if (escrowAmount == 0) revert EscrowRequiredForType(msgType);
        } else if (msgType == MessageType.CAPABILITY_QUERY) {
            if (escrowAmount != 0) revert EscrowForbiddenForType(msgType);
        }
        // COMPUTE_RESULT and DATA_ATTESTATION: escrow is optional (can be 0)
    }

    /**
     * @notice Forward accumulated fees to RevenueSplitter
     * @dev Sends pendingFees as TFUEL to RevenueSplitter which distributes:
     *      30% BBB, 30% LP, 25% veXF, 15% Treasury
     */
    function _forwardFees() internal {
        uint256 amount = pendingFees;
        pendingFees = 0;
        totalFeesForwarded += amount;

        (bool success, ) = revenueSplitter.call{value: amount}("");
        if (!success) revert FeeForwardFailed();

        emit FeesForwarded(revenueSplitter, amount, totalFeesForwarded);
    }

    /**
     * @notice Enforce per-block task limit (circuit breaker)
     */
    function _enforceBlockTaskLimit() internal {
        if (block.number != _currentBlockNumber) {
            _currentBlockNumber = block.number;
            _currentBlockTaskCount = 0;
        }

        _currentBlockTaskCount++;

        if (_currentBlockTaskCount > maxTasksPerBlock) {
            revert MaxTasksPerBlockExceeded();
        }
    }

    /**
     * @notice Receive TFUEL for fee collection and escrow
     */
    receive() external payable {
        // Contract accepts TFUEL for task routing and A2A escrow
    }
}
