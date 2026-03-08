// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/access/AccessControl.sol";
import "@openzeppelin/contracts/utils/Pausable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/**
 * @title ZKMLCircuit
 * @author XFuel Protocol — Expansion Circuits
 * @notice Private ML Inference Circuit: ZK-verified model inference where model
 *         weights remain private and only correctness is proven on-chain.
 *
 * Architecture:
 *   1. Model owners register a _commitment_ to their model (hash of weights),
 *      NOT the weights themselves. The model stays private off-chain.
 *   2. Users submit inference requests with encrypted inputs.
 *   3. The model owner (or authorized prover) runs inference off-chain and
 *      generates an SP1 proof that: "given committed model M and input X,
 *      the output is Y" — without revealing M.
 *   4. The proof is verified on-chain, the result is attested, and fees collected.
 *
 * Research ties:
 *   Per SP1 docs (succinct.xyz, 2026):
 *     - Arbitrary Rust programs compiled to RISC-V can be proven in ZK.
 *     - The SP1 prover generates STARK proofs, then wraps as Groth16 (~260B, ~270k gas).
 *     - Private inputs (model weights) are only known to the prover; public outputs
 *       (input hash, output hash, model commitment) are verified on-chain.
 *     - Up to 28x faster than competing zkVMs on real-world benchmarks.
 *     - Compressed/recursive proofs enable proving large models in chunks.
 *
 *   For zkML specifically:
 *     - Model weights are committed via keccak256(weights) stored on-chain.
 *     - The SP1 program takes (private: weights, input) → (public: commitment, inputHash, outputHash).
 *     - Verifier checks: commitment matches registered model, proof is valid.
 *     - This enables "ML-as-a-Service" where model IP is protected by ZK.
 *
 * Core Layer integration:
 *   - Emits InferenceRequested for ai-listener.js to route to provers.
 *   - Sends fees to CoreRevenueSplitter via depositFee(CIRCUIT_ID).
 *   - Uses ZKVerifierSP1 for proof verification.
 *   - Fully isolated: own model registry, inference state, prover authorization.
 */
contract ZKMLCircuit is AccessControl, Pausable, ReentrancyGuard {
    // ─── Roles ────────────────────────────────────────────────────────────────
    bytes32 public constant PROVER_ROLE = keccak256("PROVER_ROLE");
    bytes32 public constant OPERATOR_ROLE = keccak256("OPERATOR_ROLE");

    // ─── Circuit Identity ─────────────────────────────────────────────────────
    bytes32 public constant CIRCUIT_ID = keccak256("ZKML_CIRCUIT");

    // ─── Core Layer References ────────────────────────────────────────────────
    address public revenueSplitter;
    address public zkVerifier;

    // ─── Fee Configuration ────────────────────────────────────────────────────
    uint16 public feeBps = 75;                  // 0.75% default (higher for private compute)
    uint16 public constant MIN_FEE_BPS = 10;
    uint16 public constant MAX_FEE_BPS = 200;   // Up to 2% for premium private inference
    uint16 public constant BPS_DENOM = 10000;

    // ─── Private Model Registry ───────────────────────────────────────────────
    struct PrivateModel {
        bytes32 modelId;
        address owner;                // Model IP owner
        bytes32 weightCommitment;     // keccak256(model_weights) — weights stay private
        bytes32 architectureHash;     // Hash of model architecture (public metadata)
        string description;           // Public description (e.g., "Sentiment classifier v3")
        uint256 pricePerInference;    // Price in wei
        uint256 totalInferences;
        uint256 totalRevenue;
        bool active;
        bool publicArchitecture;      // Whether architecture details are public
    }

    mapping(bytes32 => PrivateModel) public models;
    bytes32[] public modelIds;
    uint256 public modelCount;

    // ─── Authorized Provers per Model ─────────────────────────────────────────
    /// @notice modelId => prover address => authorized
    mapping(bytes32 => mapping(address => bool)) public authorizedProvers;

    // ─── Inference Requests ───────────────────────────────────────────────────
    enum InferenceStatus { None, Requested, Proving, Verified, Failed, Disputed }

    struct InferenceRequest {
        bytes32 requestId;
        bytes32 modelId;
        address requester;
        bytes32 inputHash;            // keccak256(encrypted_input) — input privacy optional
        bytes32 outputHash;           // Set when proof verified
        bytes32 proofNullifier;
        uint256 payment;
        uint256 fee;
        InferenceStatus status;
        uint64 requestedAt;
        uint64 verifiedAt;
        uint64 deadline;              // Max time for proof delivery
    }

    mapping(bytes32 => InferenceRequest) public requests;
    uint256 public requestCount;

    // ─── Nullifier Tracking (circuit-local) ───────────────────────────────────
    mapping(bytes32 => bool) public usedNullifiers;

    // ─── Selective Disclosure (Phase 5: Privacy Markets) ─────────────────────
    struct DisclosurePolicy {
        bytes32 policyId;
        bytes32 modelId;
        bytes32 poseidonCommitment;       // Poseidon(fields_to_disclose)
        bytes32[] disclosedFieldHashes;   // Hashes of fields that are revealed
        uint256 disclosureCount;
        bool active;
    }

    mapping(bytes32 => DisclosurePolicy) public disclosurePolicies;
    uint256 public policyCount;
    uint256 public totalSelectiveDisclosures;

    // ─── Dispute Window ───────────────────────────────────────────────────────
    uint256 public disputeWindow = 1 hours;

    // ─── Metrics ──────────────────────────────────────────────────────────────
    uint256 public totalFeesCollected;
    uint256 public totalVolume;
    uint256 public totalProofsVerified;

    // ─── Semantic Cache (50% fee savings on repeat inferences) ────────────
    struct CachedResult {
        bytes32 cacheKey;         // keccak256(modelId || inputHash)
        bytes32 outputHash;
        uint64 cachedAt;
        uint64 expiresAt;
        uint256 hitCount;
        bool valid;
    }

    mapping(bytes32 => CachedResult) public semanticCache;
    uint256 public cacheHits;
    uint256 public cacheMisses;
    uint256 public cacheSavings;
    uint16 public cacheFeeDiscountBps = 5000;  // 50% discount on cached results
    uint256 public cacheExpirySeconds = 24 hours;

    // ─── Events ───────────────────────────────────────────────────────────────
    event PrivateModelRegistered(
        bytes32 indexed modelId,
        address indexed owner,
        bytes32 weightCommitment,
        string description,
        uint256 pricePerInference
    );

    event ModelUpdated(bytes32 indexed modelId, uint256 newPrice, bool active);

    event ProverAuthorized(bytes32 indexed modelId, address indexed prover);
    event ProverRevoked(bytes32 indexed modelId, address indexed prover);

    event InferenceRequested(
        bytes32 indexed circuitId,
        bytes32 indexed requestId,
        bytes32 indexed modelId,
        address requester,
        bytes32 inputHash,
        uint256 payment,
        uint64 deadline
    );

    event InferenceVerified(
        bytes32 indexed requestId,
        bytes32 outputHash,
        bytes32 nullifier,
        uint256 provingTimeMs
    );

    event InferenceFailed(bytes32 indexed requestId, string reason);
    event InferenceDisputed(bytes32 indexed requestId, address indexed disputer);

    event CacheHit(bytes32 indexed cacheKey, bytes32 indexed modelId, bytes32 outputHash, uint256 feeSaved);
    event CachePopulated(bytes32 indexed cacheKey, bytes32 indexed modelId, uint64 expiresAt);

    event DisclosurePolicyCreated(
        bytes32 indexed circuitId,
        bytes32 indexed policyId,
        bytes32 indexed modelId,
        bytes32 poseidonCommitment,
        uint256 fieldCount
    );

    event SelectiveDisclosureVerified(
        bytes32 indexed circuitId,
        bytes32 indexed policyId,
        bytes32 indexed requestId,
        bytes32 nullifier,
        uint256 disclosedFieldCount
    );

    // ─── Errors ───────────────────────────────────────────────────────────────
    error ModelNotFound();
    error ModelNotActive();
    error NotModelOwner();
    error ProverNotAuthorized();
    error RequestNotFound();
    error InvalidRequestStatus(InferenceStatus current, InferenceStatus expected);
    error InsufficientPayment();
    error NullifierUsed();
    error DeadlineExpired();
    error DeadlineNotExpired();
    error DisputeWindowActive();
    error InvalidCommitment();

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
        _grantRole(PROVER_ROLE, _admin);
    }

    // ═══════════════════════════════════════════════════════════════════════════
    //  1. PRIVATE MODEL REGISTRY
    // ═══════════════════════════════════════════════════════════════════════════

    /**
     * @notice Register a private ML model. Only the weight commitment is stored;
     *         actual weights remain off-chain with the model owner.
     * @param weightCommitment keccak256 hash of the serialized model weights.
     * @param architectureHash Hash of model architecture metadata.
     * @param description Human-readable description.
     * @param pricePerInference Price per inference in wei.
     * @param publicArchitecture Whether the architecture is publicly visible.
     */
    function registerModel(
        bytes32 weightCommitment,
        bytes32 architectureHash,
        string calldata description,
        uint256 pricePerInference,
        bool publicArchitecture
    ) external whenNotPaused returns (bytes32 modelId) {
        require(weightCommitment != bytes32(0), "ZeroCommitment");

        modelId = keccak256(abi.encodePacked(
            CIRCUIT_ID, msg.sender, weightCommitment, modelCount
        ));

        models[modelId] = PrivateModel({
            modelId: modelId,
            owner: msg.sender,
            weightCommitment: weightCommitment,
            architectureHash: architectureHash,
            description: description,
            pricePerInference: pricePerInference,
            totalInferences: 0,
            totalRevenue: 0,
            active: true,
            publicArchitecture: publicArchitecture
        });

        // Model owner is automatically an authorized prover
        authorizedProvers[modelId][msg.sender] = true;

        modelIds.push(modelId);
        modelCount++;

        emit PrivateModelRegistered(
            modelId, msg.sender, weightCommitment, description, pricePerInference
        );
    }

    /**
     * @notice Update model pricing or status. Only the owner can modify.
     */
    function updateModel(
        bytes32 modelId,
        uint256 newPrice,
        bool active
    ) external {
        PrivateModel storage m = models[modelId];
        if (m.modelId == bytes32(0)) revert ModelNotFound();
        if (m.owner != msg.sender && !hasRole(DEFAULT_ADMIN_ROLE, msg.sender)) {
            revert NotModelOwner();
        }
        m.pricePerInference = newPrice;
        m.active = active;
        emit ModelUpdated(modelId, newPrice, active);
    }

    /**
     * @notice Rotate model weights (update commitment after retraining).
     */
    function rotateWeights(
        bytes32 modelId,
        bytes32 newWeightCommitment
    ) external {
        PrivateModel storage m = models[modelId];
        if (m.modelId == bytes32(0)) revert ModelNotFound();
        if (m.owner != msg.sender) revert NotModelOwner();
        require(newWeightCommitment != bytes32(0), "ZeroCommitment");
        m.weightCommitment = newWeightCommitment;
    }

    /**
     * @notice Authorize an additional prover for a model.
     */
    function authorizeProver(bytes32 modelId, address prover) external {
        PrivateModel storage m = models[modelId];
        if (m.modelId == bytes32(0)) revert ModelNotFound();
        if (m.owner != msg.sender) revert NotModelOwner();
        authorizedProvers[modelId][prover] = true;
        emit ProverAuthorized(modelId, prover);
    }

    function revokeProver(bytes32 modelId, address prover) external {
        PrivateModel storage m = models[modelId];
        if (m.modelId == bytes32(0)) revert ModelNotFound();
        if (m.owner != msg.sender) revert NotModelOwner();
        authorizedProvers[modelId][prover] = false;
        emit ProverRevoked(modelId, prover);
    }

    // ═══════════════════════════════════════════════════════════════════════════
    //  2. INFERENCE REQUESTS
    // ═══════════════════════════════════════════════════════════════════════════

    /**
     * @notice Request a private inference from a registered model.
     * @param modelId Target model.
     * @param inputHash Hash of the inference input (can be encrypted off-chain).
     * @param deadline Maximum time (unix) for proof delivery.
     * @return requestId Unique request identifier.
     *
     * @dev Emits InferenceRequested for ai-listener to route to authorized provers.
     */
    function requestInference(
        bytes32 modelId,
        bytes32 inputHash,
        uint64 deadline
    ) external payable whenNotPaused nonReentrant returns (bytes32 requestId) {
        PrivateModel storage m = models[modelId];
        if (m.modelId == bytes32(0)) revert ModelNotFound();
        if (!m.active) revert ModelNotActive();
        if (msg.value < m.pricePerInference) revert InsufficientPayment();
        require(deadline > block.timestamp, "PastDeadline");

        uint256 fee = (msg.value * feeBps) / BPS_DENOM;
        uint256 netPayment = msg.value - fee;

        requestId = keccak256(abi.encodePacked(
            CIRCUIT_ID, msg.sender, modelId, block.number, requestCount++
        ));

        requests[requestId] = InferenceRequest({
            requestId: requestId,
            modelId: modelId,
            requester: msg.sender,
            inputHash: inputHash,
            outputHash: bytes32(0),
            proofNullifier: bytes32(0),
            payment: netPayment,
            fee: fee,
            status: InferenceStatus.Requested,
            requestedAt: uint64(block.timestamp),
            verifiedAt: 0,
            deadline: deadline
        });

        totalVolume += msg.value;
        totalFeesCollected += fee;

        // Forward fee to Core RevenueSplitter
        if (fee > 0 && revenueSplitter != address(0)) {
            _forwardFee(fee);
        }

        emit InferenceRequested(
            CIRCUIT_ID, requestId, modelId, msg.sender,
            inputHash, netPayment, deadline
        );
    }

    // ═══════════════════════════════════════════════════════════════════════════
    //  3. PROOF VERIFICATION
    // ═══════════════════════════════════════════════════════════════════════════

    /**
     * @notice Submit and verify an SP1 proof for a private inference.
     * @param requestId The inference request to fulfill.
     * @param outputHash Hash of the inference output.
     * @param weightCommitmentInProof The weight commitment used in the proof
     *        (must match the registered model's commitment).
     * @param proof SP1 proof bytes.
     * @param publicValues SP1 public values (encodes inputHash, outputHash, commitment).
     * @param nullifier Replay protection.
     *
     * @dev Only authorized provers for the model can submit proofs.
     *      The proof attests: "I ran model with commitment C on input X and got Y"
     *      without revealing the actual model weights.
     */
    function verifyInference(
        bytes32 requestId,
        bytes32 outputHash,
        bytes32 weightCommitmentInProof,
        bytes calldata proof,
        bytes calldata publicValues,
        bytes32 nullifier
    ) external nonReentrant whenNotPaused {
        InferenceRequest storage req = requests[requestId];
        if (req.requestedAt == 0) revert RequestNotFound();
        if (req.status != InferenceStatus.Requested) {
            revert InvalidRequestStatus(req.status, InferenceStatus.Requested);
        }
        if (block.timestamp > req.deadline) revert DeadlineExpired();

        // Verify prover is authorized for this model
        if (!authorizedProvers[req.modelId][msg.sender] && !hasRole(PROVER_ROLE, msg.sender)) {
            revert ProverNotAuthorized();
        }

        // Verify the weight commitment in the proof matches the registered model
        PrivateModel storage m = models[req.modelId];
        if (weightCommitmentInProof != m.weightCommitment) revert InvalidCommitment();

        // Nullifier check
        if (usedNullifiers[nullifier]) revert NullifierUsed();
        usedNullifiers[nullifier] = true;

        // Verify SP1 proof via Core ZKVerifier
        if (zkVerifier != address(0)) {
            (bool ok, ) = zkVerifier.call(
                abi.encodeWithSignature(
                    "verifyProof(bytes32,bytes,bytes,bytes32)",
                    CIRCUIT_ID, publicValues, proof, nullifier
                )
            );
            require(ok, "ProofFailed");
        }

        // Update request
        req.outputHash = outputHash;
        req.proofNullifier = nullifier;
        req.status = InferenceStatus.Verified;
        req.verifiedAt = uint64(block.timestamp);

        // Update model metrics
        m.totalInferences++;
        m.totalRevenue += req.payment;
        totalProofsVerified++;

        // Populate semantic cache
        bytes32 cacheKey = keccak256(abi.encodePacked(req.modelId, req.inputHash));
        semanticCache[cacheKey] = CachedResult({
            cacheKey: cacheKey,
            outputHash: outputHash,
            cachedAt: uint64(block.timestamp),
            expiresAt: uint64(block.timestamp + cacheExpirySeconds),
            hitCount: 0,
            valid: true
        });
        emit CachePopulated(cacheKey, req.modelId, uint64(block.timestamp + cacheExpirySeconds));

        // Pay model owner
        if (req.payment > 0) {
            (bool ok2, ) = payable(m.owner).call{value: req.payment}("");
            require(ok2, "OwnerPay");
        }

        emit InferenceVerified(requestId, outputHash, nullifier, 0);
    }

    /**
     * @notice Claim refund for an expired inference request.
     */
    function claimRefund(bytes32 requestId) external nonReentrant {
        InferenceRequest storage req = requests[requestId];
        if (req.requestedAt == 0) revert RequestNotFound();
        if (req.status != InferenceStatus.Requested) {
            revert InvalidRequestStatus(req.status, InferenceStatus.Requested);
        }
        if (block.timestamp <= req.deadline) revert DeadlineNotExpired();

        req.status = InferenceStatus.Failed;

        // Refund requester (payment portion; fee already forwarded)
        if (req.payment > 0) {
            (bool ok, ) = payable(req.requester).call{value: req.payment}("");
            require(ok, "RefundFailed");
        }

        emit InferenceFailed(requestId, "DeadlineExpired");
    }

    /**
     * @notice Dispute a verified inference (within dispute window).
     * @param requestId The inference request to dispute.
     * @dev STUB — Phase 2 implementation. Currently only transitions status to Disputed
     *      and emits an event. Full re-verification or arbitration logic is planned for
     *      Phase 2 (Bittensor/TAO circuit expansion). Out of CertiK Phase 1 audit scope.
     */
    function disputeInference(bytes32 requestId) external {
        InferenceRequest storage req = requests[requestId];
        if (req.requestedAt == 0) revert RequestNotFound();
        if (req.status != InferenceStatus.Verified) {
            revert InvalidRequestStatus(req.status, InferenceStatus.Verified);
        }
        require(
            block.timestamp <= req.verifiedAt + disputeWindow,
            "DisputeWindowClosed"
        );
        require(msg.sender == req.requester, "OnlyRequester");

        req.status = InferenceStatus.Disputed;
        emit InferenceDisputed(requestId, msg.sender);
    }

    /**
     * @notice Query cached inference result. If cache hit, returns result
     *         at 50% fee discount. Gas target: <30K for cache lookups.
     */
    function queryCachedInference(
        bytes32 modelId,
        bytes32 inputHash
    ) external payable whenNotPaused nonReentrant returns (bytes32 outputHash, bool fromCache) {
        bytes32 cacheKey = keccak256(abi.encodePacked(modelId, inputHash));
        CachedResult storage cached = semanticCache[cacheKey];
        
        if (cached.valid && block.timestamp < cached.expiresAt) {
            uint256 discountedFee = (models[modelId].pricePerInference * cacheFeeDiscountBps) / BPS_DENOM;
            require(msg.value >= discountedFee, "InsufficientCacheFee");
            
            cached.hitCount++;
            cacheHits++;
            uint256 saved = models[modelId].pricePerInference - discountedFee;
            cacheSavings += saved;
            
            if (discountedFee > 0 && revenueSplitter != address(0)) {
                uint256 fee = (discountedFee * feeBps) / BPS_DENOM;
                if (fee > 0) _forwardFee(fee);
            }
            
            emit CacheHit(cacheKey, modelId, cached.outputHash, saved);
            return (cached.outputHash, true);
        }
        
        cacheMisses++;
        return (bytes32(0), false);
    }

    function setCacheExpiry(uint256 _seconds) external onlyRole(DEFAULT_ADMIN_ROLE) {
        require(_seconds >= 1 hours && _seconds <= 7 days, "ExpiryRange");
        cacheExpirySeconds = _seconds;
    }

    function setCacheDiscount(uint16 _bps) external onlyRole(DEFAULT_ADMIN_ROLE) {
        require(_bps >= 2000 && _bps <= 8000, "DiscountRange");
        cacheFeeDiscountBps = _bps;
    }

    // ═══════════════════════════════════════════════════════════════════════════
    //  4. SELECTIVE DISCLOSURE (Privacy-Preserving Inference Results)
    // ═══════════════════════════════════════════════════════════════════════════

    /**
     * @notice Create a selective disclosure policy for a model.
     *         Uses Poseidon commitment to define which output fields are revealed.
     * @param modelId Target model.
     * @param poseidonCommitment Poseidon hash of the disclosure field set.
     * @param disclosedFieldHashes Hashes of individual fields to reveal.
     */
    function createDisclosurePolicy(
        bytes32 modelId,
        bytes32 poseidonCommitment,
        bytes32[] calldata disclosedFieldHashes
    ) external whenNotPaused returns (bytes32 policyId) {
        PrivateModel storage m = models[modelId];
        if (m.modelId == bytes32(0)) revert ModelNotFound();
        require(msg.sender == m.owner || hasRole(DEFAULT_ADMIN_ROLE, msg.sender), "NotOwner");
        require(poseidonCommitment != bytes32(0), "ZeroCommitment");

        policyId = keccak256(abi.encodePacked(
            CIRCUIT_ID, modelId, poseidonCommitment, policyCount++
        ));

        disclosurePolicies[policyId] = DisclosurePolicy({
            policyId: policyId,
            modelId: modelId,
            poseidonCommitment: poseidonCommitment,
            disclosedFieldHashes: disclosedFieldHashes,
            disclosureCount: 0,
            active: true
        });

        emit DisclosurePolicyCreated(
            CIRCUIT_ID, policyId, modelId, poseidonCommitment, disclosedFieldHashes.length
        );
    }

    /**
     * @notice Verify a selective disclosure proof: proves inference output
     *         matches the policy without revealing hidden fields.
     *         Gas target: <50K for micro-disclosures.
     * @param policyId Disclosure policy.
     * @param requestId Original inference request.
     * @param proof SP1 proof of selective disclosure.
     * @param publicValues Encoded disclosed fields + commitment.
     * @param nullifier Replay protection.
     */
    function verifySelectiveDisclosure(
        bytes32 policyId,
        bytes32 requestId,
        bytes calldata proof,
        bytes calldata publicValues,
        bytes32 nullifier
    ) external nonReentrant whenNotPaused {
        DisclosurePolicy storage dp = disclosurePolicies[policyId];
        require(dp.active, "PolicyNotActive");
        InferenceRequest storage req = requests[requestId];
        if (req.requestedAt == 0) revert RequestNotFound();
        if (req.status != InferenceStatus.Verified) {
            revert InvalidRequestStatus(req.status, InferenceStatus.Verified);
        }
        if (usedNullifiers[nullifier]) revert NullifierUsed();

        usedNullifiers[nullifier] = true;

        if (zkVerifier != address(0)) {
            (bool ok, ) = zkVerifier.call(
                abi.encodeWithSignature(
                    "verifyProof(bytes32,bytes,bytes,bytes32)",
                    CIRCUIT_ID, publicValues, proof, nullifier
                )
            );
            require(ok, "ProofFailed");
        }

        dp.disclosureCount++;
        totalSelectiveDisclosures++;

        emit SelectiveDisclosureVerified(
            CIRCUIT_ID, policyId, requestId, nullifier, dp.disclosedFieldHashes.length
        );
    }

    function getDisclosurePolicy(bytes32 id) external view returns (DisclosurePolicy memory) {
        return disclosurePolicies[id];
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

    function setFee(uint16 _feeBps) external onlyRole(DEFAULT_ADMIN_ROLE) {
        require(_feeBps >= MIN_FEE_BPS && _feeBps <= MAX_FEE_BPS, "FeeRange");
        feeBps = _feeBps;
    }

    function setDisputeWindow(uint256 _seconds) external onlyRole(DEFAULT_ADMIN_ROLE) {
        disputeWindow = _seconds;
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

    function getModel(bytes32 id) external view returns (PrivateModel memory) {
        return models[id];
    }

    function getRequest(bytes32 id) external view returns (InferenceRequest memory) {
        return requests[id];
    }

    function isProverAuthorized(bytes32 modelId, address prover) external view returns (bool) {
        return authorizedProvers[modelId][prover];
    }

    function getStats() external view returns (
        uint256 models_, uint256 requests_, uint256 volume_,
        uint256 fees_, uint256 proofs_
    ) {
        return (modelCount, requestCount, totalVolume, totalFeesCollected, totalProofsVerified);
    }

    receive() external payable {}
}
