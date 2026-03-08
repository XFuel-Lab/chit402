// SPDX-License-Identifier: MIT
pragma solidity ^0.8.22;

import "@openzeppelin/contracts/access/AccessControl.sol";
import "@openzeppelin/contracts/utils/Pausable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "../core/SP1ProofHooks.sol";
import "../interfaces/IBittensorStaking.sol";
import "../interfaces/ICrossChainMailbox.sol";

/**
 * @title InferenceRouter
 * @author XFuel Protocol — Priority Circuits (Phase 2)
 * @notice Inference Router Circuit: Routes ML inference requests, attests results
 *         via SP1 proofs, and uses dTAO precompiles for stake-weighted selection.
 *
 * Prover: EVM (EVM_GROTH16) — Bittensor is EVM-native (Chain ID 964).
 *
 * Research ties:
 *   Per Bittensor EVM docs (2026):
 *     - Chain ID 964, Solidity ≤0.8.24 (Cancun), block gas limit 75M
 *     - Staking V2 precompile at 0x805: addStake, getStake, getTotalHotkeyStake
 *     - Subnet precompile at 0x803: registerNetwork, get/set difficulty/weights
 *     - Neuron precompile at 0x804: setWeights, burnedRegister, serveAxon
 *     - CRITICAL: Must use low-level .call() for precompile interaction
 *     - Unit conversion: msg.value (1e18) → RAO (1e9) for precompiles
 *     - Hyperlane deployed on Bittensor EVM for Warp Routes + ICAs
 *   Per SP1 docs (v6 Hypercube):
 *     - Groth16: ~260 bytes, ~270K gas. PLONK: ~868 bytes, ~300K gas.
 *     - SP1VerifierGateway at 0x397A5f... on major EVM chains
 *
 * Gas targets:
 *   - submitInference: <120K (no proof verification)
 *   - settleInference: <350K (SP1 verify ~270K + state + stake check ~80K)
 *   - routeWithStake: <200K (precompile query + routing logic)
 *
 * Security:
 *   - Nullifiers in InferenceAttested and SettlementCompleted events
 *   - dTAO stake-gating: validators must meet minStake per subnet
 *   - Circuit breaker: auto-pause at >5% failure rate
 */
contract InferenceRouter is AccessControl, Pausable, ReentrancyGuard {
    using SP1ProofHooks for address;

    bytes32 public constant RELAYER_ROLE = keccak256("RELAYER_ROLE");
    bytes32 public constant OPERATOR_ROLE = keccak256("OPERATOR_ROLE");
    bytes32 public constant VALIDATOR_ROLE = keccak256("VALIDATOR_ROLE");
    bytes32 public constant CIRCUIT_ID = keccak256("INFERENCE_ROUTER_CIRCUIT");

    // ─── Core Layer References ────────────────────────────────────────────────
    address public revenueSplitter;
    address public zkVerifier;
    address public sp1Gateway;
    bytes32 public programVKey;

    // ─── dTAO Staking (Bittensor Precompiles) ─────────────────────────────────
    address public constant STAKING_PRECOMPILE = 0x0000000000000000000000000000000000000805;
    address public constant SUBNET_PRECOMPILE = 0x0000000000000000000000000000000000000803;
    address public constant NEURON_PRECOMPILE = 0x0000000000000000000000000000000000000804;

    uint256 public minStakeForInference;
    bool public stakeCheckEnabled;

    // ─── Cross-Chain ──────────────────────────────────────────────────────────
    ICrossChainMailbox public mailbox;
    mapping(uint32 => bool) public supportedDomains;
    mapping(uint32 => bytes32) public trustedRemotes;

    // ─── Fee Configuration ────────────────────────────────────────────────────
    uint16 public feeBps = 50;
    uint16 public constant MIN_FEE_BPS = 10;
    uint16 public constant MAX_FEE_BPS = 100;
    uint16 public constant BPS_DENOM = 10000;

    // ─── Subnet Registry ──────────────────────────────────────────────────────
    struct Subnet {
        uint16 netuid;
        string name;
        string modelType;
        uint256 minStake;
        uint256 totalInferences;
        uint256 avgLatencyMs;
        bool active;
    }

    mapping(uint16 => Subnet) public subnets;
    uint16[] public subnetIds;
    uint256 public subnetCount;

    // ─── Validator Registry ───────────────────────────────────────────────────
    struct Validator {
        address evmAddress;
        bytes32 hotkey;
        uint16 primarySubnet;
        uint256 totalStake;
        uint256 inferenceCount;
        uint256 reputation;
        bool active;
    }

    mapping(address => Validator) public validators;
    uint256 public validatorCount;

    // ─── Inference Request Lifecycle ──────────────────────────────────────────
    enum InferenceStatus { None, Submitted, Routed, Attested, Settled, Failed }

    struct InferenceRequest {
        bytes32 requestId;
        address requester;
        uint16 targetSubnet;
        bytes32 inputHash;
        bytes32 modelHash;
        uint256 payment;
        uint256 fee;
        InferenceStatus status;
        address assignedValidator;
        bytes32 outputHash;
        uint256 latencyMs;
        uint64 submittedAt;
        uint64 settledAt;
        bytes32 proofNullifier;
    }

    mapping(bytes32 => InferenceRequest) public requests;
    uint256 public requestCount;

    // ─── Nullifier Tracking ───────────────────────────────────────────────────
    mapping(bytes32 => bool) public usedNullifiers;

    // ─── Circuit Breaker ──────────────────────────────────────────────────────
    uint256 public failureWindowStart;
    uint256 public failuresInWindow;
    uint256 public verificationsInWindow;
    uint256 public constant FAILURE_WINDOW = 1 hours;
    uint256 public constant MAX_FAILURE_RATE_BPS = 500;

    // ─── Metrics ──────────────────────────────────────────────────────────────
    uint256 public totalFeesCollected;
    uint256 public totalVolume;
    uint256 public totalInferences;
    uint256 public totalSettled;
    uint256 public totalFailed;
    uint256 public avgLatencyMs;

    // ─── Events ───────────────────────────────────────────────────────────────
    event TaskRouted(
        bytes32 indexed circuitId,
        bytes32 indexed requestId,
        address indexed requester,
        uint16 targetSubnet,
        bytes32 inputHash,
        uint256 payment,
        uint256 fee
    );

    event InferenceAssigned(
        bytes32 indexed requestId,
        address indexed validator,
        bytes32 hotkey,
        uint256 validatorStake
    );

    event InferenceAttested(
        bytes32 indexed requestId,
        bytes32 indexed nullifier,
        bytes32 outputHash,
        address validator,
        uint256 latencyMs
    );

    event SettlementCompleted(
        bytes32 indexed requestId,
        bytes32 indexed nullifier,
        uint256 validatorPayout,
        uint256 protocolFee
    );

    event IntentSubmitted(
        bytes32 indexed circuitId,
        bytes32 indexed requestId,
        string intentType,
        bytes payload
    );

    event SubnetRegistered(uint16 indexed netuid, string name, string modelType);
    event ValidatorRegistered(address indexed evmAddress, bytes32 hotkey, uint16 subnet);
    event StakeCheckUpdated(bool enabled, uint256 minStake);
    event CircuitBreakerTriggered(uint256 failureRate, uint256 window);

    // ─── Errors ───────────────────────────────────────────────────────────────
    error SubnetNotFound(uint16 netuid);
    error SubnetNotActive(uint16 netuid);
    error RequestNotFound();
    error InvalidRequestStatus(InferenceStatus current);
    error ValidatorNotRegistered();
    error ValidatorNotActive();
    error InsufficientStake(uint256 actual, uint256 required);
    error StakeQueryFailed();
    error NullifierUsed(bytes32 nullifier);
    error CircuitBreakerActive();
    error InsufficientPayment();

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
        _grantRole(VALIDATOR_ROLE, _admin);

        failureWindowStart = block.timestamp;
    }

    // ═══════════════════════════════════════════════════════════════════════════
    //  SUBNET REGISTRY
    // ═══════════════════════════════════════════════════════════════════════════

    function registerSubnet(
        uint16 netuid,
        string calldata name,
        string calldata modelType,
        uint256 minStake
    ) external onlyRole(OPERATOR_ROLE) {
        subnets[netuid] = Subnet({
            netuid: netuid,
            name: name,
            modelType: modelType,
            minStake: minStake,
            totalInferences: 0,
            avgLatencyMs: 0,
            active: true
        });
        subnetIds.push(netuid);
        subnetCount++;

        emit SubnetRegistered(netuid, name, modelType);
    }

    // ═══════════════════════════════════════════════════════════════════════════
    //  VALIDATOR REGISTRATION WITH dTAO STAKE CHECK
    // ═══════════════════════════════════════════════════════════════════════════

    /**
     * @notice Register as an inference validator with dTAO stake verification.
     * @param hotkey Bittensor hotkey (bytes32) for stake lookup via precompile 0x805.
     * @param primarySubnet Primary subnet this validator serves.
     *
     * @dev On Bittensor EVM (964), queries the staking precompile to verify stake.
     *      On other chains, stake check is skipped unless mock precompile configured.
     *      CRITICAL: Uses low-level .call() per Bittensor EVM docs.
     */
    function registerValidator(
        bytes32 hotkey,
        uint16 primarySubnet
    ) external whenNotPaused nonReentrant {
        Subnet storage s = subnets[primarySubnet];
        if (s.netuid == 0 && primarySubnet != 0) revert SubnetNotFound(primarySubnet);

        uint256 stake = 0;
        if (stakeCheckEnabled) {
            stake = _queryStake(hotkey, msg.sender, primarySubnet);
            if (stake < s.minStake) revert InsufficientStake(stake, s.minStake);
        }

        validators[msg.sender] = Validator({
            evmAddress: msg.sender,
            hotkey: hotkey,
            primarySubnet: primarySubnet,
            totalStake: stake,
            inferenceCount: 0,
            reputation: 5000, // 50% start
            active: true
        });
        validatorCount++;

        _grantRole(VALIDATOR_ROLE, msg.sender);
        emit ValidatorRegistered(msg.sender, hotkey, primarySubnet);
    }

    // ═══════════════════════════════════════════════════════════════════════════
    //  INFERENCE SUBMISSION
    // ═══════════════════════════════════════════════════════════════════════════

    function submitInference(
        uint16 targetSubnet,
        bytes32 inputHash,
        bytes32 modelHash
    ) external payable whenNotPaused nonReentrant returns (bytes32 requestId) {
        Subnet storage s = subnets[targetSubnet];
        if (!s.active) revert SubnetNotActive(targetSubnet);
        require(msg.value > 0, "ZeroPayment");

        uint256 fee = (msg.value * feeBps) / BPS_DENOM;
        uint256 netPayment = msg.value - fee;

        requestId = keccak256(abi.encodePacked(
            CIRCUIT_ID, msg.sender, targetSubnet, block.number, requestCount++
        ));

        requests[requestId] = InferenceRequest({
            requestId: requestId,
            requester: msg.sender,
            targetSubnet: targetSubnet,
            inputHash: inputHash,
            modelHash: modelHash,
            payment: netPayment,
            fee: fee,
            status: InferenceStatus.Submitted,
            assignedValidator: address(0),
            outputHash: bytes32(0),
            latencyMs: 0,
            submittedAt: uint64(block.timestamp),
            settledAt: 0,
            proofNullifier: bytes32(0)
        });

        totalVolume += msg.value;
        totalFeesCollected += fee;
        totalInferences++;

        if (fee > 0) _forwardFee(fee);

        emit TaskRouted(CIRCUIT_ID, requestId, msg.sender, targetSubnet, inputHash, netPayment, fee);
        emit IntentSubmitted(CIRCUIT_ID, requestId, "inference_request",
            abi.encode(targetSubnet, inputHash, modelHash));
    }

    // ═══════════════════════════════════════════════════════════════════════════
    //  INFERENCE ROUTING WITH STAKE-WEIGHTED SELECTION
    // ═══════════════════════════════════════════════════════════════════════════

    /**
     * @notice Assign an inference request to a validator with dTAO stake verification.
     * @param requestId The inference request to assign.
     * @param validator The validator to assign (must have sufficient stake on subnet).
     *
     * @dev Queries staking precompile 0x805 to verify validator stake on target subnet.
     *      Gas: ~80K for precompile query + state update.
     */
    function assignInference(
        bytes32 requestId,
        address validator
    ) external onlyRole(RELAYER_ROLE) {
        InferenceRequest storage r = requests[requestId];
        if (r.submittedAt == 0) revert RequestNotFound();
        if (r.status != InferenceStatus.Submitted) revert InvalidRequestStatus(r.status);

        Validator storage v = validators[validator];
        if (!v.active) revert ValidatorNotActive();

        if (stakeCheckEnabled) {
            uint256 currentStake = _queryStake(v.hotkey, validator, r.targetSubnet);
            v.totalStake = currentStake;
            Subnet storage s = subnets[r.targetSubnet];
            if (currentStake < s.minStake) revert InsufficientStake(currentStake, s.minStake);
        }

        r.assignedValidator = validator;
        r.status = InferenceStatus.Routed;

        emit InferenceAssigned(requestId, validator, v.hotkey, v.totalStake);
    }

    // ═══════════════════════════════════════════════════════════════════════════
    //  INFERENCE ATTESTATION + ZK SETTLEMENT
    // ═══════════════════════════════════════════════════════════════════════════

    /**
     * @notice Attest inference result and settle with SP1 proof.
     * @param requestId The completed inference request.
     * @param outputHash Hash of the inference output.
     * @param proof SP1 Groth16 proof bytes (~260 bytes).
     * @param publicValues ABI-encoded public values.
     * @param nullifier Replay protection nullifier.
     * @param latencyMs Actual inference latency.
     *
     * @dev Gas target: <350K total (SP1 ~270K + state ~80K).
     */
    function settleInference(
        bytes32 requestId,
        bytes32 outputHash,
        bytes calldata proof,
        bytes calldata publicValues,
        bytes32 nullifier,
        uint256 latencyMs
    ) external onlyRole(RELAYER_ROLE) nonReentrant whenNotPaused {
        _checkCircuitBreaker();

        InferenceRequest storage r = requests[requestId];
        if (r.submittedAt == 0) revert RequestNotFound();
        if (r.status != InferenceStatus.Routed) revert InvalidRequestStatus(r.status);
        if (usedNullifiers[nullifier]) revert NullifierUsed(nullifier);

        usedNullifiers[nullifier] = true;

        sp1Gateway.verifySP1(programVKey, publicValues, proof);

        r.outputHash = outputHash;
        r.latencyMs = latencyMs;
        r.status = InferenceStatus.Settled;
        r.settledAt = uint64(block.timestamp);
        r.proofNullifier = nullifier;
        totalSettled++;

        _updateLatency(r.targetSubnet, latencyMs);
        _updateMetrics(true);

        // Pay validator
        uint256 payout = r.payment;
        if (payout > 0 && r.assignedValidator != address(0)) {
            (bool ok, ) = payable(r.assignedValidator).call{value: payout}("");
            require(ok, "ValidatorPay");
        }

        // Update validator stats
        Validator storage v = validators[r.assignedValidator];
        v.inferenceCount++;
        v.reputation = _clampReputation(v.reputation + 10);

        emit InferenceAttested(requestId, nullifier, outputHash, r.assignedValidator, latencyMs);
        emit SettlementCompleted(requestId, nullifier, payout, r.fee);
    }

    /**
     * @notice Settle inference and relay cross-chain via Hyperlane.
     */
    function settleAndRelay(
        bytes32 requestId,
        bytes32 outputHash,
        bytes calldata proof,
        bytes calldata publicValues,
        bytes32 nullifier,
        uint256 latencyMs,
        uint32 destDomain
    ) external payable onlyRole(RELAYER_ROLE) nonReentrant whenNotPaused {
        _checkCircuitBreaker();

        InferenceRequest storage r = requests[requestId];
        if (r.submittedAt == 0) revert RequestNotFound();
        if (r.status != InferenceStatus.Routed) revert InvalidRequestStatus(r.status);
        if (usedNullifiers[nullifier]) revert NullifierUsed(nullifier);

        usedNullifiers[nullifier] = true;
        sp1Gateway.verifySP1(programVKey, publicValues, proof);

        r.status = InferenceStatus.Settled;
        r.settledAt = uint64(block.timestamp);
        r.proofNullifier = nullifier;
        r.outputHash = outputHash;
        totalSettled++;
        _updateMetrics(true);

        if (address(mailbox) != address(0) && supportedDomains[destDomain]) {
            bytes memory payload = SP1ProofHooks.encodeCrossChainPayload(
                CIRCUIT_ID, nullifier, keccak256(publicValues), msg.sender, block.timestamp
            );
            bytes32 remote = trustedRemotes[destDomain];
            uint256 bridgeFee = mailbox.quoteDispatch(destDomain, remote, payload);
            require(msg.value >= bridgeFee, "InsufficientBridgeFee");
            mailbox.dispatch{value: bridgeFee}(destDomain, remote, payload);
        }

        emit InferenceAttested(requestId, nullifier, outputHash, r.assignedValidator, latencyMs);
    }

    function failInference(
        bytes32 requestId,
        string calldata reason
    ) external onlyRole(RELAYER_ROLE) {
        InferenceRequest storage r = requests[requestId];
        if (r.submittedAt == 0) revert RequestNotFound();

        r.status = InferenceStatus.Failed;
        totalFailed++;
        _updateMetrics(false);

        if (r.payment > 0) {
            (bool ok, ) = payable(r.requester).call{value: r.payment}("");
            require(ok, "Refund");
        }

        if (r.assignedValidator != address(0)) {
            Validator storage v = validators[r.assignedValidator];
            v.reputation = _clampReputation(
                v.reputation > 100 ? v.reputation - 100 : 0
            );
        }
    }

    // ─── dTAO Precompile Queries ──────────────────────────────────────────────

    /**
     * @dev Query stake via Bittensor staking precompile (0x805).
     *      Uses low-level .call() per Bittensor EVM docs — direct interface
     *      calls don't route to the runtime precompile.
     */
    function _queryStake(
        bytes32 hotkey,
        address validator,
        uint16 netuid
    ) internal view returns (uint256) {
        bytes32 coldkey = bytes32(uint256(uint160(validator)));

        bytes memory data = abi.encodeWithSelector(
            IBittensorStaking.getStake.selector, hotkey, coldkey, netuid
        );
        (bool success, bytes memory result) = STAKING_PRECOMPILE.staticcall(data);

        if (!success || result.length < 32) return 0;
        return abi.decode(result, (uint256));
    }

    /**
     * @notice Query total hotkey stake across all subnets.
     */
    function queryTotalStake(bytes32 hotkey) external view returns (uint256) {
        bytes memory data = abi.encodeWithSelector(
            bytes4(keccak256("getTotalHotkeyStake(bytes32)")), hotkey
        );
        (bool success, bytes memory result) = STAKING_PRECOMPILE.staticcall(data);
        if (!success || result.length < 32) return 0;
        return abi.decode(result, (uint256));
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

    function _updateLatency(uint16 netuid, uint256 latency) internal {
        Subnet storage s = subnets[netuid];
        s.totalInferences++;
        if (s.avgLatencyMs == 0) {
            s.avgLatencyMs = latency;
        } else {
            s.avgLatencyMs = (s.avgLatencyMs * 9 + latency) / 10;
        }
        if (avgLatencyMs == 0) {
            avgLatencyMs = latency;
        } else {
            avgLatencyMs = (avgLatencyMs * 9 + latency) / 10;
        }
    }

    function _clampReputation(uint256 rep) internal pure returns (uint256) {
        return rep > 10000 ? 10000 : rep;
    }

    function _updateMetrics(bool success) internal {
        if (block.timestamp > failureWindowStart + FAILURE_WINDOW) {
            failureWindowStart = block.timestamp;
            failuresInWindow = 0;
            verificationsInWindow = 0;
        }
        verificationsInWindow++;
        if (!success) {
            failuresInWindow++;
            _evaluateCircuitBreaker();
        }
    }

    function _checkCircuitBreaker() internal view {
        if (
            verificationsInWindow > 20 &&
            failuresInWindow * 10000 / verificationsInWindow > MAX_FAILURE_RATE_BPS
        ) {
            revert CircuitBreakerActive();
        }
    }

    function _evaluateCircuitBreaker() internal {
        if (
            verificationsInWindow > 20 &&
            failuresInWindow * 10000 / verificationsInWindow > MAX_FAILURE_RATE_BPS
        ) {
            _pause();
            emit CircuitBreakerTriggered(
                failuresInWindow * 10000 / verificationsInWindow,
                verificationsInWindow
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

    function setStakeCheck(uint256 _minStake, bool _enabled) external onlyRole(DEFAULT_ADMIN_ROLE) {
        minStakeForInference = _minStake;
        stakeCheckEnabled = _enabled;
        emit StakeCheckUpdated(_enabled, _minStake);
    }

    function setRevenueSplitter(address _rs) external onlyRole(DEFAULT_ADMIN_ROLE) { revenueSplitter = _rs; }
    function setZKVerifier(address _zk) external onlyRole(DEFAULT_ADMIN_ROLE) { zkVerifier = _zk; }
    function setSP1Gateway(address _gw) external onlyRole(DEFAULT_ADMIN_ROLE) { sp1Gateway = _gw; }
    function setMailbox(address _mb) external onlyRole(DEFAULT_ADMIN_ROLE) { mailbox = ICrossChainMailbox(_mb); }

    function configureDomain(uint32 domain, bytes32 remote, bool supported) external onlyRole(DEFAULT_ADMIN_ROLE) {
        supportedDomains[domain] = supported;
        trustedRemotes[domain] = remote;
    }

    function pause() external onlyRole(OPERATOR_ROLE) { _pause(); }
    function unpause() external onlyRole(OPERATOR_ROLE) { _unpause(); }

    // ─── Views ────────────────────────────────────────────────────────────────

    function getRequest(bytes32 id) external view returns (InferenceRequest memory) { return requests[id]; }
    function getValidator(address addr) external view returns (Validator memory) { return validators[addr]; }
    function getSubnet(uint16 netuid) external view returns (Subnet memory) { return subnets[netuid]; }
    function isNullifierUsed(bytes32 n) external view returns (bool) { return usedNullifiers[n]; }

    function getStats() external view returns (
        uint256 requests_, uint256 settled_, uint256 failed_,
        uint256 inferences_, uint256 latency_,
        uint256 validators_, uint256 volume_, uint256 fees_
    ) {
        return (requestCount, totalSettled, totalFailed,
                totalInferences, avgLatencyMs,
                validatorCount, totalVolume, totalFeesCollected);
    }

    receive() external payable {}
}
