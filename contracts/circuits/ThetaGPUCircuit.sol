// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/access/AccessControl.sol";
import "@openzeppelin/contracts/utils/Pausable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/**
 * @title ThetaGPUCircuit
 * @author XFuel Protocol — Circuits
 * @notice Edge Compute Routing Circuit for GPU inference via Theta EdgeCloud and
 *         generalized edge/cloud compute providers.
 *
 * Provides:
 *   1. Model Registry — On-chain catalog of available AI models with pricing.
 *   2. Job Lifecycle — Submit → Route → Execute → Attest → Settle.
 *   3. TFUEL Fee Management — Pay-per-inference with configurable fees.
 *   4. Provider Staking — Edge nodes stake collateral for quality-of-service.
 *   5. Subchain-Ready — Can deploy on a dedicated Theta subchain for isolation.
 *
 * Research ties:
 *   Per Theta EdgeCloud docs (2026):
 *     - Client RPC APIs: GetStatus, SetPrice, GetDeployments, GetJobs.
 *     - On-demand model inference: serverless GPU, dynamic routing, pay-as-you-go.
 *     - SDK: thetalabs/theta-edgecloud for deployment automation.
 *     - Models: FLUX.1, Llama 3.1, Whisper, Stable Diffusion.
 *     - Intelligent scheduling optimizes model placement across hybrid cloud-edge.
 *
 *   Per Theta Metachain docs:
 *     - TFUEL as gas token on all subchains.
 *     - 1,000 wTHETA + 20,000 TFUEL per subchain validator.
 *     - 1-2s finality per subchain.
 *
 * Core Layer integration:
 *   - Emits GPUJobRouted for ai-listener.js to detect and route to EdgeCloud.
 *   - Sends fees to CoreRevenueSplitter via depositFee(CIRCUIT_ID).
 *   - Uses ZKVerifierSP1 for settlement proof verification.
 *
 * Isolation:
 *   - Own model registry, job state, and provider staking.
 *   - No shared state with TAOCircuit or A2ACircuit.
 *   - Deployable on dedicated Theta subchain (subchain-ready architecture).
 */
contract ThetaGPUCircuit is AccessControl, Pausable, ReentrancyGuard {
    // ─── Roles ────────────────────────────────────────────────────────────────
    bytes32 public constant RELAYER_ROLE = keccak256("RELAYER_ROLE");
    bytes32 public constant OPERATOR_ROLE = keccak256("OPERATOR_ROLE");
    bytes32 public constant PROVIDER_ROLE = keccak256("PROVIDER_ROLE");

    // ─── Circuit Identity ─────────────────────────────────────────────────────
    bytes32 public constant CIRCUIT_ID = keccak256("THETA_GPU_CIRCUIT");

    // ─── Core Layer References ────────────────────────────────────────────────
    address public revenueSplitter;
    address public zkVerifier;

    // ─── Fee Configuration ────────────────────────────────────────────────────
    uint16 public feeBps = 50;                  // 0.5% default task fee
    uint16 public constant MIN_FEE_BPS = 10;    // 0.1%
    uint16 public constant MAX_FEE_BPS = 100;   // 1%
    uint16 public constant BPS_DENOM = 10000;

    // ─── Model Registry (isolated state) ──────────────────────────────────────
    struct Model {
        bytes32 modelId;
        string name;                 // Human-readable (e.g., "Llama 3.1 70B")
        string category;             // "text", "image", "audio", "code", "multimodal"
        uint256 pricePerInference;   // Cost in wei (TFUEL) per inference
        uint256 minCollateral;       // Min provider stake to serve this model
        bool active;
        uint256 totalInferences;
        uint256 avgLatencyMs;        // Rolling average latency
    }

    mapping(bytes32 => Model) public models;
    bytes32[] public modelIds;
    uint256 public modelCount;

    // ─── Provider Registry ────────────────────────────────────────────────────
    struct Provider {
        address addr;
        string endpoint;              // EdgeCloud node endpoint
        uint256 staked;               // Collateral staked
        uint256 jobsCompleted;
        uint256 jobsFailed;
        uint256 reputation;           // Score 0-10000 (BPS)
        bool active;
        bytes32[] supportedModels;    // Models this provider can serve
    }

    mapping(address => Provider) public providers;
    uint256 public providerCount;
    uint256 public totalStaked;

    // ─── Job Lifecycle ────────────────────────────────────────────────────────
    enum JobStatus { None, Submitted, Routed, Executing, Completed, Failed, Settled }

    struct Job {
        bytes32 jobId;
        bytes32 modelId;
        address requester;
        address provider;            // Assigned provider (after routing)
        uint256 payment;             // Amount paid by requester
        uint256 fee;                 // Protocol fee
        bytes32 inputHash;           // Hash of inference input
        bytes32 outputHash;          // Hash of inference output (set on completion)
        JobStatus status;
        uint64 submittedAt;
        uint64 routedAt;
        uint64 completedAt;
        uint64 settledAt;
        uint256 latencyMs;           // Actual inference latency
        bytes32 proofNullifier;      // SP1 proof nullifier
    }

    mapping(bytes32 => Job) public jobs;
    uint256 public jobCount;

    // ─── Metrics ──────────────────────────────────────────────────────────────
    uint256 public totalFeesCollected;
    uint256 public totalVolume;
    uint256 public totalInferences;
    uint256 public avgLatencyMs;

    // ─── Subchain Configuration ───────────────────────────────────────────────
    /// @notice If deployed on a Theta subchain, this stores the subchain ID.
    uint256 public subchainId;
    /// @notice Main chain bridge contract address (for cross-subchain settlement).
    address public mainChainBridge;

    // ─── Events (Core Layer listens to these) ─────────────────────────────────
    event ModelRegistered(
        bytes32 indexed modelId,
        string name,
        string category,
        uint256 pricePerInference
    );

    event ModelUpdated(bytes32 indexed modelId, uint256 newPrice, bool active);

    event ProviderRegistered(
        address indexed provider,
        string endpoint,
        uint256 staked
    );

    event ProviderSlashed(address indexed provider, uint256 amount, string reason);

    event GPUJobRouted(
        bytes32 indexed circuitId,
        bytes32 indexed jobId,
        bytes32 indexed modelId,
        address requester,
        uint256 payment,
        uint256 fee
    );

    event JobAssigned(
        bytes32 indexed jobId,
        address indexed provider
    );

    event JobCompleted(
        bytes32 indexed jobId,
        bytes32 outputHash,
        uint256 latencyMs
    );

    event JobSettled(
        bytes32 indexed jobId,
        bytes32 nullifier,
        uint256 providerPayout,
        uint256 fee
    );

    event JobFailed(bytes32 indexed jobId, string reason);

    // ─── Errors ───────────────────────────────────────────────────────────────
    error ModelNotFound();
    error ModelNotActive();
    error ProviderNotRegistered();
    error ProviderNotActive();
    error InsufficientStake();
    error JobNotFound();
    error InvalidJobStatus(JobStatus current, JobStatus expected);
    error InsufficientPayment();
    error NullifierUsed();

    // ─── Constructor ──────────────────────────────────────────────────────────
    /**
     * @param _admin Admin address.
     * @param _revenueSplitter CoreRevenueSplitter address.
     * @param _zkVerifier ZKVerifierSP1 address.
     */
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
        _grantRole(PROVIDER_ROLE, _admin);
    }

    // ═══════════════════════════════════════════════════════════════════════════
    //  1. MODEL REGISTRY
    // ═══════════════════════════════════════════════════════════════════════════

    /**
     * @notice Register a new AI model in the catalog.
     * @param name Human-readable model name (e.g., "Llama 3.1 70B").
     * @param category Model category (e.g., "text", "image").
     * @param pricePerInference Price per inference in wei (TFUEL).
     * @param minCollateral Minimum provider stake to serve this model.
     */
    function registerModel(
        string calldata name,
        string calldata category,
        uint256 pricePerInference,
        uint256 minCollateral
    ) external onlyRole(OPERATOR_ROLE) returns (bytes32 modelId) {
        modelId = keccak256(abi.encodePacked(name, category, modelCount));

        models[modelId] = Model({
            modelId: modelId,
            name: name,
            category: category,
            pricePerInference: pricePerInference,
            minCollateral: minCollateral,
            active: true,
            totalInferences: 0,
            avgLatencyMs: 0
        });

        modelIds.push(modelId);
        modelCount++;

        emit ModelRegistered(modelId, name, category, pricePerInference);
    }

    /**
     * @notice Update model pricing and status.
     */
    function updateModel(
        bytes32 modelId,
        uint256 newPrice,
        bool active
    ) external onlyRole(OPERATOR_ROLE) {
        if (models[modelId].modelId == bytes32(0)) revert ModelNotFound();
        models[modelId].pricePerInference = newPrice;
        models[modelId].active = active;
        emit ModelUpdated(modelId, newPrice, active);
    }

    // ═══════════════════════════════════════════════════════════════════════════
    //  2. PROVIDER REGISTRY + STAKING
    // ═══════════════════════════════════════════════════════════════════════════

    /**
     * @notice Register as a GPU compute provider with collateral stake.
     * @param endpoint EdgeCloud node endpoint (e.g., "https://edgecloud.theta.tv/node/xyz").
     * @param supportedModels Array of model IDs this provider can serve.
     */
    function registerProvider(
        string calldata endpoint,
        bytes32[] calldata supportedModels
    ) external payable whenNotPaused {
        require(msg.value > 0, "ZeroStake");
        require(providers[msg.sender].staked == 0, "AlreadyRegistered");

        providers[msg.sender] = Provider({
            addr: msg.sender,
            endpoint: endpoint,
            staked: msg.value,
            jobsCompleted: 0,
            jobsFailed: 0,
            reputation: 5000, // Start at 50%
            active: true,
            supportedModels: supportedModels
        });

        totalStaked += msg.value;
        providerCount++;
        _grantRole(PROVIDER_ROLE, msg.sender);

        emit ProviderRegistered(msg.sender, endpoint, msg.value);
    }

    /**
     * @notice Increase provider stake.
     */
    function addStake() external payable {
        require(providers[msg.sender].staked > 0, "NotRegistered");
        providers[msg.sender].staked += msg.value;
        totalStaked += msg.value;
    }

    /**
     * @notice Slash a provider's stake (operator only, for failed jobs or misbehavior).
     * @param provider Provider to slash.
     * @param amount Amount to slash.
     * @param reason Human-readable reason.
     */
    function slashProvider(
        address provider,
        uint256 amount,
        string calldata reason
    ) external onlyRole(OPERATOR_ROLE) {
        Provider storage p = providers[provider];
        if (p.staked == 0) revert ProviderNotRegistered();
        require(amount <= p.staked, "SlashExceedsStake");

        p.staked -= amount;
        totalStaked -= amount;

        // Slashed funds go to treasury via RevenueSplitter
        if (revenueSplitter != address(0)) {
            (bool ok, ) = revenueSplitter.call{value: amount}(
                abi.encodeWithSignature("depositFee(bytes32)", CIRCUIT_ID)
            );
            if (!ok) {
                (bool ok2, ) = payable(revenueSplitter).call{value: amount}("");
                require(ok2, "SlashFwd");
            }
        }

        emit ProviderSlashed(provider, amount, reason);
    }

    // ═══════════════════════════════════════════════════════════════════════════
    //  3. JOB LIFECYCLE
    // ═══════════════════════════════════════════════════════════════════════════

    /**
     * @notice Submit a GPU inference job.
     * @param modelId Target model from the registry.
     * @param inputHash Hash of the inference input.
     * @return jobId Unique job identifier.
     *
     * @dev Payment must be >= model's pricePerInference. Fee is deducted and
     *      forwarded to CoreRevenueSplitter. Emits GPUJobRouted for ai-listener.
     */
    function submitJob(
        bytes32 modelId,
        bytes32 inputHash
    ) external payable whenNotPaused nonReentrant returns (bytes32 jobId) {
        Model storage m = models[modelId];
        if (m.modelId == bytes32(0)) revert ModelNotFound();
        if (!m.active) revert ModelNotActive();
        if (msg.value < m.pricePerInference) revert InsufficientPayment();

        // Calculate fee
        uint256 fee = (msg.value * feeBps) / BPS_DENOM;
        uint256 netPayment = msg.value - fee;

        jobId = keccak256(abi.encodePacked(
            CIRCUIT_ID, msg.sender, modelId, block.number, jobCount++
        ));

        jobs[jobId] = Job({
            jobId: jobId,
            modelId: modelId,
            requester: msg.sender,
            provider: address(0),
            payment: netPayment,
            fee: fee,
            inputHash: inputHash,
            outputHash: bytes32(0),
            status: JobStatus.Submitted,
            submittedAt: uint64(block.timestamp),
            routedAt: 0,
            completedAt: 0,
            settledAt: 0,
            latencyMs: 0,
            proofNullifier: bytes32(0)
        });

        totalVolume += msg.value;
        totalFeesCollected += fee;

        // Forward fee to Core RevenueSplitter
        if (fee > 0 && revenueSplitter != address(0)) {
            (bool ok, ) = revenueSplitter.call{value: fee}(
                abi.encodeWithSignature("depositFee(bytes32)", CIRCUIT_ID)
            );
            if (!ok) {
                (bool ok2, ) = payable(revenueSplitter).call{value: fee}("");
                require(ok2, "FeeFwd");
            }
        }

        // Emit for Core Layer ai-listener to detect and route to EdgeCloud
        emit GPUJobRouted(CIRCUIT_ID, jobId, modelId, msg.sender, netPayment, fee);
    }

    /**
     * @notice Assign a job to a specific provider (relayer/operator only).
     * @param jobId Job to assign.
     * @param provider Provider address.
     *
     * @dev The ai-listener.js backend calls this after selecting the best
     *      provider via EdgeCloud API (GetStatus, intelligent scheduling).
     */
    function assignJob(
        bytes32 jobId,
        address provider
    ) external onlyRole(RELAYER_ROLE) {
        Job storage j = jobs[jobId];
        if (j.submittedAt == 0) revert JobNotFound();
        if (j.status != JobStatus.Submitted) {
            revert InvalidJobStatus(j.status, JobStatus.Submitted);
        }

        Provider storage p = providers[provider];
        if (!p.active) revert ProviderNotActive();

        // Verify provider has sufficient stake for this model
        Model storage m = models[j.modelId];
        if (p.staked < m.minCollateral) revert InsufficientStake();

        j.provider = provider;
        j.status = JobStatus.Routed;
        j.routedAt = uint64(block.timestamp);

        emit JobAssigned(jobId, provider);
    }

    /**
     * @notice Report job completion with output hash and latency.
     * @param jobId Completed job.
     * @param outputHash Hash of inference output.
     * @param latencyMs Actual inference latency in milliseconds.
     */
    function completeJob(
        bytes32 jobId,
        bytes32 outputHash,
        uint256 latencyMs
    ) external onlyRole(RELAYER_ROLE) {
        Job storage j = jobs[jobId];
        if (j.submittedAt == 0) revert JobNotFound();
        if (j.status != JobStatus.Routed) {
            revert InvalidJobStatus(j.status, JobStatus.Routed);
        }

        j.outputHash = outputHash;
        j.latencyMs = latencyMs;
        j.status = JobStatus.Completed;
        j.completedAt = uint64(block.timestamp);

        // Update model metrics
        Model storage m = models[j.modelId];
        m.totalInferences++;
        totalInferences++;

        // Rolling average latency
        if (m.avgLatencyMs == 0) {
            m.avgLatencyMs = latencyMs;
        } else {
            m.avgLatencyMs = (m.avgLatencyMs * 9 + latencyMs) / 10;
        }

        // Global average
        if (avgLatencyMs == 0) {
            avgLatencyMs = latencyMs;
        } else {
            avgLatencyMs = (avgLatencyMs * 9 + latencyMs) / 10;
        }

        emit JobCompleted(jobId, outputHash, latencyMs);
    }

    /**
     * @notice Settle a completed job with ZK proof, paying the provider.
     * @param jobId Job to settle.
     * @param proof SP1 proof bytes.
     * @param publicValues SP1 public values.
     * @param nullifier Replay protection nullifier.
     */
    function settleJob(
        bytes32 jobId,
        bytes calldata proof,
        bytes calldata publicValues,
        bytes32 nullifier
    ) external onlyRole(RELAYER_ROLE) nonReentrant whenNotPaused {
        Job storage j = jobs[jobId];
        if (j.submittedAt == 0) revert JobNotFound();
        if (j.status != JobStatus.Completed) {
            revert InvalidJobStatus(j.status, JobStatus.Completed);
        }

        // Nullifier check (circuit-local)
        mapping(bytes32 => bool) storage nullifiers = _getNullifierStorage();
        if (nullifiers[nullifier]) revert NullifierUsed();
        nullifiers[nullifier] = true;

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

        j.status = JobStatus.Settled;
        j.settledAt = uint64(block.timestamp);
        j.proofNullifier = nullifier;

        // Pay provider
        uint256 payout = j.payment;
        if (payout > 0 && j.provider != address(0)) {
            (bool ok2, ) = payable(j.provider).call{value: payout}("");
            require(ok2, "ProviderPay");
        }

        // Update provider stats
        providers[j.provider].jobsCompleted++;
        providers[j.provider].reputation = _clampReputation(
            providers[j.provider].reputation + 10 // +0.1% per successful job
        );

        emit JobSettled(jobId, nullifier, payout, j.fee);
    }

    /**
     * @notice Mark a job as failed (timeout or provider error).
     * @param jobId Failed job.
     * @param reason Failure reason.
     */
    function failJob(
        bytes32 jobId,
        string calldata reason
    ) external onlyRole(RELAYER_ROLE) {
        Job storage j = jobs[jobId];
        if (j.submittedAt == 0) revert JobNotFound();

        j.status = JobStatus.Failed;

        // Refund requester
        if (j.payment > 0) {
            (bool ok, ) = payable(j.requester).call{value: j.payment}("");
            require(ok, "RefundFailed");
        }

        // Penalize provider reputation
        if (j.provider != address(0)) {
            providers[j.provider].jobsFailed++;
            providers[j.provider].reputation = _clampReputation(
                providers[j.provider].reputation > 100
                    ? providers[j.provider].reputation - 100 // -1% per failure
                    : 0
            );
        }

        emit JobFailed(jobId, reason);
    }

    // ─── Internal ─────────────────────────────────────────────────────────────

    /// @dev Isolated nullifier storage for this circuit.
    mapping(bytes32 => bool) private _usedNullifiers;
    function _getNullifierStorage() internal view returns (mapping(bytes32 => bool) storage) {
        return _usedNullifiers;
    }

    function _clampReputation(uint256 rep) internal pure returns (uint256) {
        return rep > 10000 ? 10000 : rep;
    }

    // ─── Admin ────────────────────────────────────────────────────────────────

    function setFee(uint16 _feeBps) external onlyRole(DEFAULT_ADMIN_ROLE) {
        require(_feeBps >= MIN_FEE_BPS && _feeBps <= MAX_FEE_BPS, "FeeRange");
        feeBps = _feeBps;
    }

    function setRevenueSplitter(address _rs) external onlyRole(DEFAULT_ADMIN_ROLE) {
        revenueSplitter = _rs;
    }

    function setZKVerifier(address _zk) external onlyRole(DEFAULT_ADMIN_ROLE) {
        zkVerifier = _zk;
    }

    function setSubchainConfig(uint256 _subchainId, address _bridge) external onlyRole(DEFAULT_ADMIN_ROLE) {
        subchainId = _subchainId;
        mainChainBridge = _bridge;
    }

    function pause() external onlyRole(OPERATOR_ROLE) { _pause(); }
    function unpause() external onlyRole(OPERATOR_ROLE) { _unpause(); }

    // ─── Views ────────────────────────────────────────────────────────────────

    function getModel(bytes32 modelId) external view returns (Model memory) {
        return models[modelId];
    }

    function getProvider(address addr) external view returns (Provider memory) {
        return providers[addr];
    }

    function getJob(bytes32 jobId) external view returns (Job memory) {
        return jobs[jobId];
    }

    function getModelCount() external view returns (uint256) {
        return modelCount;
    }

    function getStats() external view returns (
        uint256 jobs_, uint256 volume_, uint256 fees_,
        uint256 inferences_, uint256 latency_, uint256 providers_,
        uint256 staked_
    ) {
        return (jobCount, totalVolume, totalFeesCollected,
                totalInferences, avgLatencyMs, providerCount, totalStaked);
    }

    receive() external payable {}
}
