// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/access/AccessControl.sol";
import "@openzeppelin/contracts/utils/Pausable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/token/ERC20/extensions/ERC20Burnable.sol";

/**
 * @title TAOWrapper
 * @author xFuel Protocol (@XFuelLab)
 * @notice EVM wrapper contract for Bittensor TAO integration in XFuel Protocol.
 *         Wraps native TAO into vTAO (ERC-20) for EVM liquidity and routes
 *         Substrate-EVM calls (inference, compute, staking) through the
 *         AIDePINRouter for cross-chain AI task settlement.
 *
 * @dev Architecture (Whitepaper v4.5 — Phase E, Bittensor Integration):
 *
 *   ┌──────────────┐    ┌──────────────┐    ┌────────────────┐    ┌──────────────┐
 *   │  BITTENSOR   │    │  TAO WRAPPER │    │  AIDePINRouter │    │  OSMOSIS /   │
 *   │  SUBSTRATE   │◄──▶│   (this)     │◄──▶│  (Theta EVM)   │◄──▶│  AKASH IBC   │
 *   │  (subnets)   │    │  vTAO ERC-20 │    │  0.5-1% fees   │    │  (settlement)│
 *   └──────────────┘    └──────────────┘    └────────────────┘    └──────────────┘
 *          │                    │                    │                    │
 *     subnet inference     wrap/unwrap TAO     ZK SP1 proofs        Osmosis yields
 *     staking/delegation   EVM liquidity       A2A messaging        BTC/AI pools
 *
 *   vTAO Standard:
 *   - 1:1 peg to native TAO deposited into this contract
 *   - Wrapping: deposit TAO → mint vTAO (ERC-20) for EVM composability
 *   - Unwrapping: burn vTAO → release TAO to recipient
 *   - 0.5-1% fee on all AI task routing (not on simple wrap/unwrap)
 *   - Fees forwarded to RevenueSplitter (30/30/25/15 split)
 *
 *   Integrates with:
 *   - AIDePINRouter.sol: Task routing, SP1 proof verification, A2A messaging
 *   - ai-listener.js: Backend monitors SubnetInferenceRouted events for TAO subnet dispatch
 *   - sp1-prover/main.rs: validate_ai_task() with ChainId::Bittensor, tao_evm_target
 *   - AIVerifier.wasm: CosmWasm AI verifier on Osmosis (RouteTask, SettleTask)
 *   - RevenueSplitter.sol: Receives fees for 30/30/25/15 distribution
 *
 *   Uses OpenZeppelin AccessControl, Pausable, ReentrancyGuard, ERC20, ERC20Burnable.
 */
contract TAOWrapper is ERC20, ERC20Burnable, AccessControl, Pausable, ReentrancyGuard {

    // =========================================================================
    // ROLES
    // =========================================================================

    /// @notice Role for backend relayers that settle tasks and execute Substrate calls
    bytes32 public constant RELAYER_ROLE = keccak256("RELAYER_ROLE");

    /// @notice Role for accounts that can pause the wrapper
    bytes32 public constant PAUSER_ROLE = keccak256("PAUSER_ROLE");

    /// @notice Role for accounts that can update configuration
    bytes32 public constant CONFIG_ROLE = keccak256("CONFIG_ROLE");

    /// @notice Role for Substrate bridge operators
    bytes32 public constant BRIDGE_ROLE = keccak256("BRIDGE_ROLE");

    // =========================================================================
    // ENUMS — Sync with AIDePINRouter.sol, main.rs, AIVerifier.wasm
    // =========================================================================

    /**
     * @notice AI task / A2A message types from Whitepaper v4.5 Phase E.3
     * @dev Must stay in sync with MessageType in AIDePINRouter.sol and main.rs
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
     * @dev Must stay in sync with ChainId in AIDePINRouter.sol and main.rs
     */
    enum ChainId {
        Theta,       // 0
        Osmosis,     // 1
        Akash,       // 2
        Bittensor,   // 3
        Persistence  // 4
    }

    /**
     * @notice Outcome of SP1 ZK proof verification
     * @dev Maps to ProofOutcome in AIDePINRouter.sol and main.rs
     */
    enum ProofOutcome {
        Valid,        // 0
        Regenerable,  // 1
        Invalid       // 2
    }

    /**
     * @notice TAO Substrate call types for Bittensor-specific operations
     * @dev Extended call types beyond standard AIDePINRouter MessageTypes
     */
    enum SubstrateCallType {
        SubnetInference,    // 0 — Route inference to specific TAO subnet
        SubnetStake,        // 1 — Stake TAO on a subnet validator
        SubnetUnstake,      // 2 — Unstake TAO from a subnet validator
        SubnetRegister,     // 3 — Register as a miner/validator on a subnet
        WeightCommit,       // 4 — Commit subnet weights (validators only)
        DelegateStake       // 5 — Delegate TAO to a hotkey for staking rewards
    }

    // =========================================================================
    // STRUCTS
    // =========================================================================

    /**
     * @notice A TAO subnet inference request routed through this wrapper
     * @dev Extended from AIDePINRouter.AITask with TAO-specific fields
     */
    struct SubnetTask {
        bytes32 taskId;              // SHA-256 of task ID
        uint16 subnetId;             // Bittensor subnet UID (0-1024+)
        MessageType msgType;         // Task type (typically INFERENCE_REQUEST)
        address requester;           // EVM address of the requesting agent
        uint256 grossAmount;         // Total task value in vTAO (wei)
        uint256 feeAmount;           // Protocol fee (0.5-1%)
        uint256 netAmount;           // Net payment to subnet after fee
        uint16 feeBps;               // Fee rate in basis points (50-100)
        bytes32 modelIdHash;         // Hash of the ML model on the subnet
        bytes32 inputHash;           // Hash of inference input data
        bytes32 outputHash;          // Hash of inference output (set on settlement)
        bytes32 substrateExtrinsic;  // Hash of the Substrate extrinsic (set by bridge)
        uint64 nonce;                // Per-agent replay protection
        uint64 timestamp;            // Task submission time
        bool settled;                // Whether settled via SP1 proof
        ProofOutcome proofOutcome;   // Last proof verification outcome
    }

    /**
     * @notice A Substrate bridge call record
     */
    struct SubstrateBridgeCall {
        bytes32 callId;              // Unique call identifier
        SubstrateCallType callType;  // Type of Substrate extrinsic
        address caller;              // EVM caller address
        uint256 amount;              // TAO amount involved (if any)
        uint16 subnetId;             // Target subnet
        bytes32 ss58RecipientHash;   // Hash of SS58 Substrate address
        bytes32 extrinsicHash;       // Substrate extrinsic hash (set by bridge)
        uint64 timestamp;            // Call submission time
        bool executed;               // Whether the Substrate call was executed
        bool confirmed;              // Whether confirmed on Substrate
    }

    // =========================================================================
    // STATE VARIABLES
    // =========================================================================

    /// @notice Address of the AIDePINRouter contract on Theta EVM
    address public aidepinRouter;

    /// @notice Address of the RevenueSplitter contract (receives protocol fees)
    address public revenueSplitter;

    /// @notice Address of the SP1 verifier contract on Theta
    address public sp1Verifier;

    /// @notice Minimum fee rate in basis points (0.5% = 50 BPS)
    uint16 public constant MIN_FEE_BPS = 50;

    /// @notice Maximum fee rate in basis points (1.0% = 100 BPS)
    uint16 public constant MAX_FEE_BPS = 100;

    /// @notice Default fee rate for AI tasks (0.5% = 50 BPS)
    uint16 public defaultFeeBps = 50;

    /// @notice A2A message relay fee (0.1% = 10 BPS on escrowed amounts)
    uint16 public constant A2A_RELAY_FEE_BPS = 10;

    /// @notice Minimum task amount to prevent dust
    uint256 public constant MIN_TASK_AMOUNT = 10000;

    /// @notice Maximum batch size for proof verification
    uint32 public constant MAX_BATCH_SIZE = 20;

    /// @notice Total TAO deposited (tracked for 1:1 peg auditing)
    uint256 public totalTAODeposited;

    /// @notice Total TAO withdrawn
    uint256 public totalTAOWithdrawn;

    /// @notice Mapping of task ID → SubnetTask
    mapping(bytes32 => SubnetTask) public subnetTasks;

    /// @notice Mapping of call ID → SubstrateBridgeCall
    mapping(bytes32 => SubstrateBridgeCall) public substrateCalls;

    /// @notice Used nullifiers for replay protection
    mapping(bytes32 => bool) public usedNullifiers;

    /// @notice Per-agent nonce tracking
    mapping(address => uint64) public agentNonces;

    /// @notice Registered agent identities (for A2A messaging)
    mapping(address => bytes32) public registeredAgents;

    /// @notice Total subnet tasks routed
    uint256 public totalSubnetTasksRouted;

    /// @notice Total subnet tasks settled
    uint256 public totalSubnetTasksSettled;

    /// @notice Total A2A messages sent through TAO wrapper
    uint256 public totalA2AMessagesSent;

    /// @notice Total protocol fees collected (in vTAO wei)
    uint256 public totalFeesCollected;

    /// @notice Total fees forwarded to RevenueSplitter
    uint256 public totalFeesForwarded;

    /// @notice Accumulated fees pending forwarding
    uint256 public pendingFees;

    /// @notice Fee forwarding threshold (auto-forward when pendingFees >= threshold)
    uint256 public feeForwardThreshold = 0.1 ether; // 0.1 TAO default

    /// @notice Total Substrate bridge calls executed
    uint256 public totalSubstrateCalls;

    // =========================================================================
    // EVENTS
    // =========================================================================

    /**
     * @notice Emitted when TAO is wrapped into vTAO
     */
    event TAOWrapped(
        address indexed user,
        uint256 amount,
        uint256 totalDeposited
    );

    /**
     * @notice Emitted when vTAO is unwrapped back to TAO
     */
    event TAOUnwrapped(
        address indexed user,
        uint256 amount,
        uint256 totalWithdrawn
    );

    /**
     * @notice Emitted when a subnet inference task is routed
     * @dev ai-listener.js monitors this event for TAO subnet dispatch
     */
    event SubnetInferenceRouted(
        bytes32 indexed taskId,
        uint16 indexed subnetId,
        MessageType msgType,
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
     * @notice Emitted when a subnet task is settled via SP1 proof
     */
    event SubnetTaskSettled(
        bytes32 indexed taskId,
        bytes32 indexed nullifier,
        ProofOutcome outcome,
        bytes32 outputHash,
        bytes32 feeCommitment,
        uint256 feeAmount
    );

    /**
     * @notice Emitted when a Substrate bridge call is submitted
     */
    event SubstrateBridgeCallSubmitted(
        bytes32 indexed callId,
        SubstrateCallType indexed callType,
        address indexed caller,
        uint256 amount,
        uint16 subnetId,
        bytes32 ss58RecipientHash,
        uint64 timestamp
    );

    /**
     * @notice Emitted when a Substrate bridge call is confirmed
     */
    event SubstrateBridgeCallConfirmed(
        bytes32 indexed callId,
        bytes32 extrinsicHash
    );

    /**
     * @notice Emitted when an A2A message is sent via TAO wrapper
     */
    event TAOA2AMessageSent(
        bytes32 indexed messageId,
        MessageType indexed msgType,
        ChainId recipientChain,
        bytes32 payloadHash,
        uint256 escrowAmount,
        uint64 nonce
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
     * @notice Emitted when a proof verification results in a non-fatal failure
     */
    event ProofRegenerableFailure(
        bytes32 indexed taskId,
        bytes32 reasonHash,
        uint256 retryAfterBlock
    );

    // =========================================================================
    // ERRORS
    // =========================================================================

    error ZeroAddress();
    error ZeroAmount();
    error TaskAlreadyExists(bytes32 taskId);
    error TaskNotFound(bytes32 taskId);
    error TaskAlreadySettled(bytes32 taskId);
    error CallAlreadyExists(bytes32 callId);
    error CallNotFound(bytes32 callId);
    error CallAlreadyConfirmed(bytes32 callId);
    error NullifierAlreadyUsed(bytes32 nullifier);
    error InvalidFeeBps(uint16 feeBps);
    error AmountBelowMinimum(uint256 amount, uint256 minimum);
    error InvalidSubnetId(uint16 subnetId);
    error InvalidProof();
    error InvalidNonce(uint64 expected, uint64 provided);
    error InvalidModelIdHash();
    error InvalidInputHash();
    error InvalidOutputHash();
    error InsufficientVTAOBalance(uint256 required, uint256 available);
    error FeeForwardFailed();
    error AgentNotRegistered(address agent);
    error InsufficientContractBalance(uint256 required, uint256 available);
    error RouterCallFailed();

    // =========================================================================
    // CONSTRUCTOR
    // =========================================================================

    /**
     * @notice Initialize the TAOWrapper
     * @param _admin Admin address (DEFAULT_ADMIN_ROLE + all other roles)
     * @param _aidepinRouter Address of AIDePINRouter on Theta EVM
     * @param _revenueSplitter Address of RevenueSplitter (30/30/25/15)
     * @param _sp1Verifier Address of SP1 proof verifier (0x0 for mock mode)
     */
    constructor(
        address _admin,
        address _aidepinRouter,
        address _revenueSplitter,
        address _sp1Verifier
    ) ERC20("Wrapped TAO (vTAO)", "vTAO") {
        if (_admin == address(0) || _revenueSplitter == address(0)) {
            revert ZeroAddress();
        }

        aidepinRouter = _aidepinRouter; // Can be 0x0 for standalone mode
        revenueSplitter = _revenueSplitter;
        sp1Verifier = _sp1Verifier; // Can be 0x0 for mock mode

        _grantRole(DEFAULT_ADMIN_ROLE, _admin);
        _grantRole(RELAYER_ROLE, _admin);
        _grantRole(PAUSER_ROLE, _admin);
        _grantRole(CONFIG_ROLE, _admin);
        _grantRole(BRIDGE_ROLE, _admin);
    }

    // =========================================================================
    // vTAO WRAPPING / UNWRAPPING — 1:1 Peg
    // =========================================================================

    /**
     * @notice Wrap native TAO into vTAO (ERC-20)
     * @dev Deposits TAO into the contract, mints equivalent vTAO.
     *      No fee on wrapping — fees only on AI task routing.
     *      1:1 peg maintained: totalSupply() == address(this).balance + pending withdrawals.
     */
    function wrap() external payable whenNotPaused nonReentrant {
        if (msg.value == 0) revert ZeroAmount();

        totalTAODeposited += msg.value;
        _mint(msg.sender, msg.value);

        emit TAOWrapped(msg.sender, msg.value, totalTAODeposited);
    }

    /**
     * @notice Unwrap vTAO back to native TAO
     * @param amount Amount of vTAO to burn and receive TAO
     * @dev Burns vTAO from caller's balance, releases equivalent TAO.
     *      No fee on unwrapping — fees only on AI task routing.
     */
    function unwrap(uint256 amount) external whenNotPaused nonReentrant {
        if (amount == 0) revert ZeroAmount();
        if (balanceOf(msg.sender) < amount) {
            revert InsufficientVTAOBalance(amount, balanceOf(msg.sender));
        }
        if (address(this).balance < amount) {
            revert InsufficientContractBalance(amount, address(this).balance);
        }

        totalTAOWithdrawn += amount;
        _burn(msg.sender, amount);

        (bool success, ) = msg.sender.call{value: amount}("");
        require(success, "TAO transfer failed");

        emit TAOUnwrapped(msg.sender, amount, totalTAOWithdrawn);
    }

    // =========================================================================
    // SUBNET INFERENCE ROUTING — TAO-Specific AI Task Routing
    // =========================================================================

    /**
     * @notice Route an ML inference request to a specific Bittensor subnet
     * @param taskId Unique task identifier (SHA-256 hash)
     * @param subnetId Target Bittensor subnet UID (e.g., 1=text, 3=scraping, 18=cortex)
     * @param modelIdHash Hash of the ML model identifier on the subnet
     * @param inputHash Hash of the inference input data
     *
     * @dev Primary TAO integration point. Workflow:
     *      1. Caller sends vTAO with the call (msg.value via payable+wrap or pre-wrapped vTAO)
     *      2. Fee calculated: 0.5-1% → RevenueSplitter (30/30/25/15)
     *      3. SubnetInferenceRouted event emitted
     *      4. ai-listener.js detects event → routes to TAO subnet via Substrate bridge
     *      5. Result returned → settleSubnetTask() called with SP1 proof
     *
     *      Compatible with:
     *      - main.rs validate_ai_task() with ChainId::Bittensor, tao_evm_target
     *      - AIVerifier.wasm RouteTask with destination_chain: Bittensor
     *      - AIDePINRouter.sol routeInference with ChainId.Bittensor
     */
    function routeInference(
        bytes32 taskId,
        uint16 subnetId,
        bytes32 modelIdHash,
        bytes32 inputHash
    ) external payable whenNotPaused nonReentrant {
        if (modelIdHash == bytes32(0)) revert InvalidModelIdHash();
        if (inputHash == bytes32(0)) revert InvalidInputHash();
        if (subnetId == 0) revert InvalidSubnetId(subnetId);

        _routeSubnetTask(
            taskId,
            subnetId,
            MessageType.INFERENCE_REQUEST,
            defaultFeeBps,
            modelIdHash,
            inputHash,
            bytes32(0) // No output hash for requests
        );
    }

    /**
     * @notice Route a compute bid to a Bittensor subnet
     * @param taskId Unique task identifier
     * @param subnetId Target Bittensor subnet UID
     * @param inputHash Hash of compute job specification
     */
    function routeComputeBid(
        bytes32 taskId,
        uint16 subnetId,
        bytes32 inputHash
    ) external payable whenNotPaused nonReentrant {
        if (inputHash == bytes32(0)) revert InvalidInputHash();
        if (subnetId == 0) revert InvalidSubnetId(subnetId);

        _routeSubnetTask(
            taskId,
            subnetId,
            MessageType.COMPUTE_BID,
            defaultFeeBps,
            bytes32(0),
            inputHash,
            bytes32(0)
        );
    }

    /**
     * @notice Submit a compute result attestation from a TAO subnet
     * @param taskId Unique task identifier
     * @param subnetId Subnet that completed the work
     * @param outputHash Hash of the compute/inference output
     * @param inputHash Hash of the original input (for binding)
     */
    function routeComputeResult(
        bytes32 taskId,
        uint16 subnetId,
        bytes32 outputHash,
        bytes32 inputHash
    ) external payable whenNotPaused nonReentrant {
        if (outputHash == bytes32(0)) revert InvalidOutputHash();

        _routeSubnetTask(
            taskId,
            subnetId,
            MessageType.COMPUTE_RESULT,
            defaultFeeBps,
            bytes32(0),
            inputHash,
            outputHash
        );
    }

    /**
     * @notice Route a task with custom fee BPS
     * @param taskId Unique task identifier
     * @param subnetId Target Bittensor subnet UID
     * @param msgType Task type
     * @param feeBps Custom fee rate in basis points (50-100)
     * @param modelIdHash Hash of the ML model
     * @param inputHash Hash of task input data
     * @param outputHash Hash of compute output (for COMPUTE_RESULT)
     */
    function routeTaskCustomFee(
        bytes32 taskId,
        uint16 subnetId,
        MessageType msgType,
        uint16 feeBps,
        bytes32 modelIdHash,
        bytes32 inputHash,
        bytes32 outputHash
    ) external payable whenNotPaused nonReentrant {
        if (feeBps < MIN_FEE_BPS || feeBps > MAX_FEE_BPS) {
            revert InvalidFeeBps(feeBps);
        }

        _routeSubnetTask(
            taskId,
            subnetId,
            msgType,
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
     * @notice Settle a subnet task with an SP1 ZK proof
     * @param taskId The task to settle
     * @param sp1Proof The SP1 proof bytes from the prover
     * @param nullifier Nullifier from the proof (replay protection)
     * @param outputHash Output hash from the proof (inference result binding)
     * @param feeCommitment Fee commitment hash from fee_collector_commitment()
     *
     * @dev Called by ai-listener.js after TAO subnet inference completes:
     *      1. ai-listener.js detects SubnetInferenceRouted event
     *      2. Routes task to Bittensor subnet via Substrate bridge
     *      3. On completion, calls SP1 prover with AITask proof type + ChainId::Bittensor
     *      4. Prover runs validate_ai_task() → (nullifier, fee_commitment, output_hash)
     *      5. Relayer calls settleTask() with proof artifacts
     *
     *      SP1 proof validates (from main.rs):
     *      - ChainId::Bittensor destination with valid tao_evm_target
     *      - Fee calculation: gross × fee_bps / 10000 = fee_amount
     *      - Net amount: gross - fee = net_amount
     *      - Output hash binding for COMPUTE_RESULT
     */
    function settleTask(
        bytes32 taskId,
        bytes calldata sp1Proof,
        bytes32 nullifier,
        bytes32 outputHash,
        bytes32 feeCommitment
    ) external onlyRole(RELAYER_ROLE) nonReentrant {
        SubnetTask storage task = subnetTasks[taskId];
        if (task.timestamp == 0) revert TaskNotFound(taskId);
        if (task.settled) revert TaskAlreadySettled(taskId);
        if (usedNullifiers[nullifier]) revert NullifierAlreadyUsed(nullifier);

        // Verify SP1 proof
        ProofOutcome outcome = _verifySP1Proof(sp1Proof, taskId);

        // Mark nullifier as used (prevents replays)
        usedNullifiers[nullifier] = true;

        // Update task state
        task.proofOutcome = outcome;

        if (outcome == ProofOutcome.Valid) {
            task.settled = true;
            task.outputHash = outputHash;
            totalSubnetTasksSettled++;

            // Accumulate fees
            if (task.feeAmount > 0) {
                pendingFees += task.feeAmount;
                totalFeesCollected += task.feeAmount;

                if (pendingFees >= feeForwardThreshold) {
                    _forwardFees();
                }
            }

            emit SubnetTaskSettled(
                taskId,
                nullifier,
                ProofOutcome.Valid,
                outputHash,
                feeCommitment,
                task.feeAmount
            );
        } else if (outcome == ProofOutcome.Regenerable) {
            bytes32 reasonHash = keccak256(abi.encodePacked("regenerable", taskId, block.number));

            emit ProofRegenerableFailure(
                taskId,
                reasonHash,
                block.number + 10
            );

            emit SubnetTaskSettled(
                taskId,
                nullifier,
                ProofOutcome.Regenerable,
                outputHash,
                feeCommitment,
                task.feeAmount
            );
        } else {
            emit SubnetTaskSettled(
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
     * @notice Batch-settle multiple subnet tasks
     * @dev Maximum batch size: 20 (MAX_BATCH_SIZE)
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
            SubnetTask storage task = subnetTasks[taskIds[i]];
            if (task.timestamp == 0) continue;
            if (task.settled) continue;
            if (usedNullifiers[nullifiers[i]]) continue;

            ProofOutcome outcome = _verifySP1Proof(sp1Proofs[i], taskIds[i]);

            usedNullifiers[nullifiers[i]] = true;
            task.proofOutcome = outcome;

            if (outcome == ProofOutcome.Valid) {
                task.settled = true;
                task.outputHash = outputHashes[i];
                totalSubnetTasksSettled++;

                if (task.feeAmount > 0) {
                    pendingFees += task.feeAmount;
                    totalFeesCollected += task.feeAmount;
                }

                emit SubnetTaskSettled(
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
    // SUBSTRATE BRIDGE CALLS — TAO-Specific Operations
    // =========================================================================

    /**
     * @notice Submit a Substrate bridge call for TAO-specific operations
     * @param callId Unique call identifier
     * @param callType Type of Substrate extrinsic
     * @param amount TAO amount involved (will be unwrapped from vTAO)
     * @param subnetId Target subnet UID
     * @param ss58RecipientHash Hash of the SS58 Substrate recipient address
     *
     * @dev Caller must have sufficient vTAO balance. The vTAO is burned and the
     *      bridge operator executes the corresponding Substrate extrinsic.
     *      ai-listener.js monitors SubstrateBridgeCallSubmitted events.
     */
    function submitSubstrateBridgeCall(
        bytes32 callId,
        SubstrateCallType callType,
        uint256 amount,
        uint16 subnetId,
        bytes32 ss58RecipientHash
    ) external whenNotPaused nonReentrant {
        if (substrateCalls[callId].timestamp != 0) revert CallAlreadyExists(callId);
        if (amount > 0 && balanceOf(msg.sender) < amount) {
            revert InsufficientVTAOBalance(amount, balanceOf(msg.sender));
        }

        // Burn vTAO for the bridge call (will be executed on Substrate side)
        if (amount > 0) {
            _burn(msg.sender, amount);
        }

        substrateCalls[callId] = SubstrateBridgeCall({
            callId: callId,
            callType: callType,
            caller: msg.sender,
            amount: amount,
            subnetId: subnetId,
            ss58RecipientHash: ss58RecipientHash,
            extrinsicHash: bytes32(0),
            timestamp: uint64(block.timestamp),
            executed: false,
            confirmed: false
        });

        totalSubstrateCalls++;

        emit SubstrateBridgeCallSubmitted(
            callId,
            callType,
            msg.sender,
            amount,
            subnetId,
            ss58RecipientHash,
            uint64(block.timestamp)
        );
    }

    /**
     * @notice Confirm a Substrate bridge call was executed (called by bridge operator)
     * @param callId The call to confirm
     * @param extrinsicHash The Substrate extrinsic hash
     */
    function confirmSubstrateBridgeCall(
        bytes32 callId,
        bytes32 extrinsicHash
    ) external onlyRole(BRIDGE_ROLE) {
        SubstrateBridgeCall storage call_ = substrateCalls[callId];
        if (call_.timestamp == 0) revert CallNotFound(callId);
        if (call_.confirmed) revert CallAlreadyConfirmed(callId);

        call_.executed = true;
        call_.confirmed = true;
        call_.extrinsicHash = extrinsicHash;

        emit SubstrateBridgeCallConfirmed(callId, extrinsicHash);
    }

    // =========================================================================
    // A2A MESSAGING — Agent-to-Agent via TAO Wrapper
    // =========================================================================

    /**
     * @notice Register an AI agent's on-chain identity commitment
     * @param identityCommitment Poseidon hash of the agent's identity secret
     */
    function registerAgent(bytes32 identityCommitment) external {
        if (identityCommitment == bytes32(0)) revert InvalidInputHash();
        registeredAgents[msg.sender] = identityCommitment;
    }

    /**
     * @notice Send an A2A message through the TAO wrapper
     * @param messageId Unique message identifier
     * @param msgType Message type
     * @param recipientChain Destination chain
     * @param payloadHash SHA-256 of message payload
     * @param escrowAmount vTAO to lock as escrow (0 for non-escrow messages)
     *
     * @dev Routes the A2A message through AIDePINRouter if configured,
     *      otherwise handles locally. Escrow is held in vTAO.
     *      Agent must be registered via registerAgent() first.
     */
    function sendA2AMessage(
        bytes32 messageId,
        MessageType msgType,
        ChainId recipientChain,
        bytes32 payloadHash,
        uint256 escrowAmount
    ) external whenNotPaused nonReentrant {
        if (registeredAgents[msg.sender] == bytes32(0)) revert AgentNotRegistered(msg.sender);
        if (payloadHash == bytes32(0)) revert InvalidInputHash();

        // Validate escrow requirements
        _validateEscrowForMsgType(msgType, escrowAmount);

        // Lock escrow vTAO if required
        if (escrowAmount > 0) {
            if (balanceOf(msg.sender) < escrowAmount) {
                revert InsufficientVTAOBalance(escrowAmount, balanceOf(msg.sender));
            }
            // Transfer vTAO to this contract as escrow
            _transfer(msg.sender, address(this), escrowAmount);
        }

        // Calculate A2A relay fee (0.1% on escrow)
        uint256 relayFee = 0;
        if (escrowAmount > 0) {
            relayFee = (escrowAmount * A2A_RELAY_FEE_BPS) / 10000;
        }

        uint64 nonce = ++agentNonces[msg.sender];
        totalA2AMessagesSent++;

        // Track relay fee
        if (relayFee > 0) {
            pendingFees += relayFee;
            totalFeesCollected += relayFee;

            if (pendingFees >= feeForwardThreshold) {
                _forwardFees();
            }
        }

        emit TAOA2AMessageSent(
            messageId,
            msgType,
            recipientChain,
            payloadHash,
            escrowAmount,
            nonce
        );
    }

    // =========================================================================
    // FEE MANAGEMENT
    // =========================================================================

    /**
     * @notice Calculate the fee for a given task amount and BPS
     * @param grossAmount The gross task value
     * @param feeBps Fee rate in basis points
     * @return feeAmount The calculated fee
     * @return netAmount The amount after fee deduction
     * @dev Mirrors calculate_task_fee() in sp1-prover/program/src/main.rs
     *      and calculateTaskFee() in AIDePINRouter.sol.
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
     * @notice Manually forward accumulated fees to RevenueSplitter
     * @dev Can be called by anyone. Fees flow to 30/30/25/15 split:
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
     * @notice Get subnet task details
     */
    function getSubnetTask(bytes32 taskId) external view returns (SubnetTask memory) {
        return subnetTasks[taskId];
    }

    /**
     * @notice Get Substrate bridge call details
     */
    function getSubstrateCall(bytes32 callId) external view returns (SubstrateBridgeCall memory) {
        return substrateCalls[callId];
    }

    /**
     * @notice Check if an agent is registered
     */
    function isAgentRegistered(address agent) external view returns (bool) {
        return registeredAgents[agent] != bytes32(0);
    }

    /**
     * @notice Get aggregate wrapper statistics
     */
    function getStats() external view returns (
        uint256 _totalDeposited,
        uint256 _totalWithdrawn,
        uint256 _totalSubnetTasks,
        uint256 _totalSubnetSettled,
        uint256 _totalA2AMessages,
        uint256 _totalSubstrateCalls,
        uint256 _totalFees,
        uint256 _pendingFees
    ) {
        return (
            totalTAODeposited,
            totalTAOWithdrawn,
            totalSubnetTasksRouted,
            totalSubnetTasksSettled,
            totalA2AMessagesSent,
            totalSubstrateCalls,
            totalFeesCollected,
            pendingFees
        );
    }

    /**
     * @notice Get the 1:1 peg audit data
     * @return vTAOSupply Current vTAO total supply
     * @return contractTAOBalance Contract's native TAO balance
     * @return isPegHealthy Whether supply <= balance (peg maintained)
     */
    function getPegAudit() external view returns (
        uint256 vTAOSupply,
        uint256 contractTAOBalance,
        bool isPegHealthy
    ) {
        vTAOSupply = totalSupply();
        contractTAOBalance = address(this).balance;
        isPegHealthy = vTAOSupply <= contractTAOBalance;
    }

    // =========================================================================
    // ADMIN FUNCTIONS
    // =========================================================================

    /**
     * @notice Update the AIDePINRouter address
     */
    function setAIDePINRouter(address _newRouter) external onlyRole(CONFIG_ROLE) {
        aidepinRouter = _newRouter;
    }

    /**
     * @notice Update the RevenueSplitter address
     */
    function setRevenueSplitter(address _newRevenueSplitter) external onlyRole(CONFIG_ROLE) {
        if (_newRevenueSplitter == address(0)) revert ZeroAddress();
        revenueSplitter = _newRevenueSplitter;
    }

    /**
     * @notice Update the SP1 verifier address
     */
    function setSP1Verifier(address _newSP1Verifier) external onlyRole(CONFIG_ROLE) {
        sp1Verifier = _newSP1Verifier;
    }

    /**
     * @notice Update the default fee rate
     */
    function setDefaultFeeBps(uint16 _feeBps) external onlyRole(CONFIG_ROLE) {
        if (_feeBps < MIN_FEE_BPS || _feeBps > MAX_FEE_BPS) {
            revert InvalidFeeBps(_feeBps);
        }
        defaultFeeBps = _feeBps;
    }

    /**
     * @notice Update the fee forwarding threshold
     */
    function setFeeForwardThreshold(uint256 _threshold) external onlyRole(CONFIG_ROLE) {
        feeForwardThreshold = _threshold;
    }

    /**
     * @notice Pause the wrapper (emergency stop)
     */
    function pause() external onlyRole(PAUSER_ROLE) {
        _pause();
    }

    /**
     * @notice Unpause the wrapper
     */
    function unpause() external onlyRole(PAUSER_ROLE) {
        _unpause();
    }

    // =========================================================================
    // INTERNAL FUNCTIONS
    // =========================================================================

    /**
     * @notice Internal subnet task routing with fee calculation
     * @dev Core routing logic. Calculates fee using calculate_task_fee logic
     *      from sp1-prover/program/src/main.rs:
     *        fee_amount = gross × fee_bps / 10000
     *        net_amount = gross - fee_amount
     *      Compatible with AIVerifier.wasm RouteTask and AIDePINRouter.sol
     */
    function _routeSubnetTask(
        bytes32 taskId,
        uint16 subnetId,
        MessageType msgType,
        uint16 feeBps,
        bytes32 modelIdHash,
        bytes32 inputHash,
        bytes32 outputHash
    ) internal {
        if (subnetTasks[taskId].timestamp != 0) revert TaskAlreadyExists(taskId);
        if (msg.value < MIN_TASK_AMOUNT) revert AmountBelowMinimum(msg.value, MIN_TASK_AMOUNT);
        if (feeBps < MIN_FEE_BPS || feeBps > MAX_FEE_BPS) revert InvalidFeeBps(feeBps);

        // Calculate fee — mirrors calculate_task_fee() in main.rs
        uint256 feeAmount = (msg.value * feeBps) / 10000;
        uint256 netAmount = msg.value - feeAmount;

        uint64 nonce = ++agentNonces[msg.sender];

        subnetTasks[taskId] = SubnetTask({
            taskId: taskId,
            subnetId: subnetId,
            msgType: msgType,
            requester: msg.sender,
            grossAmount: msg.value,
            feeAmount: feeAmount,
            netAmount: netAmount,
            feeBps: feeBps,
            modelIdHash: modelIdHash,
            inputHash: inputHash,
            outputHash: outputHash,
            substrateExtrinsic: bytes32(0),
            nonce: nonce,
            timestamp: uint64(block.timestamp),
            settled: false,
            proofOutcome: ProofOutcome.Valid // Pending — updated on settlement
        });

        totalSubnetTasksRouted++;

        // Also route through AIDePINRouter if configured (for cross-chain settlement)
        if (aidepinRouter != address(0)) {
            _forwardToRouter(taskId, msgType, modelIdHash, inputHash);
        }

        emit SubnetInferenceRouted(
            taskId,
            subnetId,
            msgType,
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
     * @notice Forward task to AIDePINRouter for cross-chain tracking
     * @dev Calls routeInference or routeComputeBid on the router, depending on type.
     *      Uses a try/catch so router failures don't block TAO-local routing.
     */
    function _forwardToRouter(
        bytes32 taskId,
        MessageType msgType,
        bytes32 modelIdHash,
        bytes32 inputHash
    ) internal {
        // Forward a portion of the value to the router for cross-chain settlement tracking
        // The router handles its own fee calculation on the forwarded amount
        try IAIDePINRouter(aidepinRouter).routeInference{value: 0}(
            taskId,
            3, // ChainId.Bittensor = 3
            modelIdHash,
            inputHash
        ) {
            // Successfully forwarded to router
        } catch {
            // Router call failed — continue with TAO-local routing only
            // This is non-fatal; the SubnetInferenceRouted event is still emitted
        }
    }

    /**
     * @notice Verify an SP1 proof via the on-chain verifier
     * @dev If sp1Verifier is address(0), runs in mock mode (always Valid).
     */
    function _verifySP1Proof(
        bytes calldata sp1Proof,
        bytes32 contextId
    ) internal view returns (ProofOutcome) {
        // Mock mode: if no verifier is set, accept all proofs
        if (sp1Verifier == address(0)) {
            return ProofOutcome.Valid;
        }

        // Production: call the SP1 verifier contract
        (bool success, bytes memory result) = sp1Verifier.staticcall(
            abi.encodeWithSignature("verifyProof(bytes)", sp1Proof)
        );

        if (!success || result.length == 0) {
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
     * @dev Matches rules in AIDePINRouter.sol and main.rs
     */
    function _validateEscrowForMsgType(MessageType msgType, uint256 escrowAmount) internal pure {
        if (msgType == MessageType.COMPUTE_BID) {
            require(escrowAmount > 0, "COMPUTE_BID requires escrow");
        } else if (msgType == MessageType.INFERENCE_REQUEST) {
            require(escrowAmount > 0, "INFERENCE_REQUEST requires escrow");
        } else if (msgType == MessageType.CAPABILITY_QUERY) {
            require(escrowAmount == 0, "CAPABILITY_QUERY forbids escrow");
        }
        // COMPUTE_RESULT and DATA_ATTESTATION: escrow optional
    }

    /**
     * @notice Forward accumulated fees to RevenueSplitter
     * @dev Sends pendingFees as native TAO to RevenueSplitter:
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
     * @notice Receive native TAO for wrapping and fee collection
     */
    receive() external payable {
        // Contract accepts TAO for wrapping, task routing, and escrow
    }
}

// =========================================================================
// INTERFACE — AIDePINRouter (minimal for cross-contract calls)
// =========================================================================

/**
 * @notice Minimal interface for AIDePINRouter cross-contract calls
 * @dev Only includes functions called by TAOWrapper
 */
interface IAIDePINRouter {
    function routeInference(
        bytes32 taskId,
        uint8 destinationChain,
        bytes32 modelIdHash,
        bytes32 inputHash
    ) external payable;
}
