// SPDX-License-Identifier: MIT
pragma solidity ^0.8.22;

import "@openzeppelin/contracts/access/AccessControl.sol";
import "@openzeppelin/contracts/utils/Pausable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/**
 * @dev Minimal ERC-20 interface for TDROP (TNT-20).
 *      TDROP on Theta mainnet: 0x1336739B05C7Ab8a526D40DCC0d04a826b5f8B03 (chain 361)
 *      Testnet:                0xde41591ED1f8ED1484aC2CD8ca0876428de60EfF (chain 365)
 *      Only transferFrom + balanceOf are needed for the payment path.
 */
interface ITdropToken {
    function transferFrom(address from, address to, uint256 amount) external returns (bool);
    function transfer(address to, uint256 amount) external returns (bool);
    function balanceOf(address account) external view returns (uint256);
    function allowance(address owner, address spender) external view returns (uint256);
}

/**
 * @title ThetaInferenceCircuit
 * @author XFuel Protocol — Circuits
 * @notice Specialized AI Services Circuit for Theta EdgeCloud inference products.
 *
 * Extends beyond generic GPU compute (ThetaGPUCircuit) to provide structured
 * intent submission for seven distinct Theta EdgeCloud service categories:
 *   1. LLM Inference (Llama 3, etc.)
 *   2. Image Generation (FLUX, Stable Diffusion)
 *   3. Speech-to-Text (Whisper)
 *   4. Voice Cloning (TTS synthesis)
 *   5. RAG Chatbot (Retrieval-Augmented Generation)
 *   6. Video Processing (transcode, analytics)
 *   7. Object Detection (YOLO, vision models)
 *
 * Per Whitepaper Section 9.8 (Custom Circuits): Implements the circuit interface
 * (event listeners + proof submission) while Core Layer provides ZK settlement,
 * fee collection, and governance.
 *
 * Research ties:
 *   Per Theta EdgeCloud docs (Feb 2026):
 *     - On-demand API: /v1/chat/completions, /v1/images/generations, etc.
 *     - MCP Server (thetalabs on-demand-api-mcp): 20+ model access
 *     - RapidAPI: Theta Edge Cloud AI Inference API for enterprise routing
 *     - Agentic AI: AI agents, voice cloning, RAG chatbot services
 *     - Video API: transcoding, P2P delivery, DRM
 *
 *   Per Theta 2026 H1 roadmap: Inference Engine upgrades, RapidAPI integration,
 *   MCP server for streamlined GPU access.
 *
 * Core Layer integration:
 *   - Emits InferenceIntentSubmitted for ai-listener.js / theta-inference-handler.js
 *   - Sends fees to CoreRevenueSplitter via depositFee(CIRCUIT_ID)
 *   - Uses ZKVerifierSP1 for settlement proof verification
 *   - SP1 publicValues encode: serviceType, modelHash, inputHash, outputHash
 *
 * Isolation:
 *   - Own intent registry, service catalog, and provider config
 *   - No shared state with ThetaGPUCircuit or TAOCircuit
 *   - Deployable on Theta mainnet (361) or dedicated subchain
 */
contract ThetaInferenceCircuit is AccessControl, Pausable, ReentrancyGuard {
    // ─── Roles ────────────────────────────────────────────────────────────────
    bytes32 public constant RELAYER_ROLE = keccak256("RELAYER_ROLE");
    bytes32 public constant OPERATOR_ROLE = keccak256("OPERATOR_ROLE");

    // ─── Circuit Identity ─────────────────────────────────────────────────────
    bytes32 public constant CIRCUIT_ID = keccak256("THETA_INFERENCE_CIRCUIT");

    // ─── Core Layer References ────────────────────────────────────────────────
    address public revenueSplitter;
    address public zkVerifier;           // ZKVerifierSP1 for SP1 proofs
    address public zkVerifierZkGPT;      // Phase 1: ZKVerifierZkGPT for zkGPT (GKR+Lasso) inference proofs

    // ─── Fee Configuration ────────────────────────────────────────────────────
    uint16 public feeBps = 50;                  // 0.5% default
    uint16 public constant MIN_FEE_BPS = 10;    // 0.1%
    uint16 public constant MAX_FEE_BPS = 100;   // 1%
    uint16 public constant BPS_DENOM = 10000;

    // ─── TDROP Payment (Track 4.2) ────────────────────────────────────────────
    // TDROP (TNT-20) is Theta's designated AI-to-AI incentive token.
    // Callers who pay in TDROP receive a discount on the circuit fee (default 20%),
    // incentivising adoption of the native Theta token in XFuel settlement.
    //
    // Price conversion: tdropPerTfuel is set by governance / oracle keeper and
    // represents how many TDROP wei equal 1 TFUEL wei.  Default: 1:1 (placeholder
    // until a live TDROP/TFUEL Chainlink feed is available on Theta mainnet).
    //
    // Mainnet TDROP:  0x1336739B05C7Ab8a526D40DCC0d04a826b5f8B03 (chain 361)
    // Testnet TDROP:  0xde41591ED1f8ED1484aC2CD8ca0876428de60EfF (chain 365)
    ITdropToken public tdropToken;             // zero → TDROP payments disabled
    uint16 public tdropDiscountBps = 2000;     // 20% fee discount for TDROP payers
    uint16 public constant MAX_TDROP_DISCOUNT = 5000; // 50% max discount
    uint256 public tdropPerTfuel = 1e18;       // TDROP wei per 1 TFUEL wei (1:1 default)
    uint256 public totalTdropCollected;        // lifetime TDROP fees received

    // ─── Service Types ────────────────────────────────────────────────────────
    enum ServiceType {
        LLM_INFERENCE,      // 0 — Llama, GPT-style chat/completions
        IMAGE_GENERATION,   // 1 — FLUX, Stable Diffusion
        SPEECH_TO_TEXT,      // 2 — Whisper transcription
        VOICE_CLONING,       // 3 — TTS / voice synthesis
        RAG_QUERY,           // 4 — Retrieval-Augmented Generation
        VIDEO_PROCESSING,    // 5 — Transcode, analytics, DRM
        OBJECT_DETECTION     // 6 — YOLO, vision models
    }

    // ─── GPU Tiers (EdgeCloud pricing tiers) ─────────────────────────────────
    enum GpuTier {
        RTX_4090,   // 0 — Consumer-grade, lowest cost
        A100,       // 1 — Data-center mid-tier
        H100        // 2 — Flagship, highest throughput
    }

    // ─── Provider Tag ─────────────────────────────────────────────────────────
    // Tracks whether execution was Theta-native or routed to a hybrid fallback.
    // THETA_NATIVE unlocks boostMultiplier in CoreRevenueSplitter GET sub-bucket.
    enum ProviderTag {
        UNSET,           // 0 — not yet attested
        THETA_NATIVE,    // 1 — executed on Theta EdgeCloud (priority tier)
        HYBRID_FALLBACK, // 2 — legacy alias; kept for ABI backward compat
        DEPIN_AKASH,     // 3 — routed to Akash Network GPU marketplace
        DEPIN_RENDER,    // 4 — routed to Render Network distributed GPU
        HYBRID_CLOUD     // 5 — routed to AWS Bedrock / Google Vertex (last resort)
    }

    // ─── EdgeCloud Node Attestation ───────────────────────────────────────────
    // Cryptographically binds the EdgeCloud node that executed a job to its
    // on-chain intent. nodeId is also encoded in SP1 publicValues so the ZK
    // proof commits to the specific hardware that produced the output.
    struct EdgeCloudAttestation {
        bytes32 nodeId;          // EdgeCloud node identifier (from job response)
        bytes32 gpuFingerprint;  // Hash of GPU model + driver version reported by node
        uint64  petaflopsUsed;   // Compute consumed (in GFLOPS — divide by 1000 for PFLOPS)
        uint64  attestedAt;      // Block timestamp of attestation
        ProviderTag providerTag; // THETA_NATIVE | DEPIN_AKASH | DEPIN_RENDER | HYBRID_CLOUD
    }

    mapping(bytes32 => EdgeCloudAttestation) public attestations; // intentId → attestation
    uint256 public attestationCount;

    // ─── Service Catalog (isolated state) ─────────────────────────────────────
    struct ServiceConfig {
        bytes32 serviceId;
        ServiceType serviceType;
        string modelName;            // e.g., "llama-3.1-70b", "flux-schnell"
        uint256 pricePerCall;        // Wei (TFUEL) per invocation
        uint256 maxLatencyMs;        // SLA: max acceptable latency
        bool active;
        uint256 totalCalls;
    }

    mapping(bytes32 => ServiceConfig) public services;
    bytes32[] public serviceIds;
    uint256 public serviceCount;

    // ─── Preset Hooks (one-click developer presets) ──────────────────────────
    struct PresetConfig {
        bytes32 presetId;
        string name;                 // e.g., "Quick Llama 3.1", "Need Bigger GPU"
        ServiceType serviceType;
        string defaultModel;
        GpuTier defaultGpu;
        string defaultPrompt;        // Auto-filled prompt/input hint
        bool active;
    }

    mapping(bytes32 => PresetConfig) public presets;
    bytes32[] public presetIds;
    uint256 public presetCount;

    // GPU tier → price multiplier (basis points, 10000 = 1x)
    mapping(GpuTier => uint256) public gpuPriceMultiplier;

    // ─── Intent Lifecycle ─────────────────────────────────────────────────────
    enum IntentStatus { None, Submitted, Processing, Completed, Failed, Settled }

    struct Intent {
        bytes32 intentId;
        ServiceType serviceType;
        bytes32 serviceId;
        address requester;
        uint256 payment;
        uint256 fee;
        bytes32 inputHash;           // Keccak256 of intent input (prompt, audio, etc.)
        bytes32 outputHash;          // Set on completion — hash of API response
        bytes32 modelHash;           // Hash of specific model version used
        IntentStatus status;
        uint64 submittedAt;
        uint64 completedAt;
        uint64 settledAt;
        uint256 latencyMs;
        bytes32 proofNullifier;
    }

    mapping(bytes32 => Intent) public intents;
    uint256 public intentCount;

    // ─── Metrics ──────────────────────────────────────────────────────────────
    uint256 public totalFeesCollected;
    uint256 public totalVolume;
    mapping(ServiceType => uint256) public callsByType;
    mapping(ServiceType => uint256) public volumeByType;

    // ─── Nullifier tracking (circuit-local) ───────────────────────────────────
    mapping(bytes32 => bool) private _usedNullifiers;

    // ─── Events (Core Layer + handler listen to these) ────────────────────────
    event ServiceRegistered(
        bytes32 indexed serviceId,
        ServiceType serviceType,
        string modelName,
        uint256 pricePerCall
    );

    event ServiceUpdated(bytes32 indexed serviceId, uint256 newPrice, bool active);

    event InferenceIntentSubmitted(
        bytes32 indexed circuitId,
        bytes32 indexed intentId,
        ServiceType serviceType,
        bytes32 indexed serviceId,
        address requester,
        uint256 payment,
        uint256 fee,
        bytes32 inputHash
    );

    // Emitted when a caller pays in TDROP instead of TFUEL.
    // tdropFee is the TDROP fee amount transferred to this contract.
    // discountBps is the fee discount applied relative to the TFUEL price.
    event TdropIntentSubmitted(
        bytes32 indexed intentId,
        address indexed requester,
        uint256 tdropFee,
        uint256 tfuelEquivalent,
        uint16  discountBps
    );

    // Emitted when governance updates the TDROP payment configuration.
    event TdropConfigUpdated(address tdropToken, uint16 discountBps, uint256 tdropPerTfuel);

    event IntentCompleted(
        bytes32 indexed intentId,
        bytes32 outputHash,
        bytes32 modelHash,
        uint256 latencyMs
    );

    event IntentSettled(
        bytes32 indexed intentId,
        bytes32 nullifier,
        uint256 settledAmount
    );

    event IntentFailed(bytes32 indexed intentId, string reason);

    event PresetRegistered(bytes32 indexed presetId, string name, ServiceType serviceType, GpuTier defaultGpu);

    event PresetIntentSubmitted(
        bytes32 indexed intentId,
        bytes32 indexed presetId,
        GpuTier gpuTier,
        address requester,
        uint256 payment
    );

    // Emitted by attestEdgeCloudNode() — ai-listener.js calls this before settleIntent()
    event EdgeCloudNodeAttested(
        bytes32 indexed intentId,
        bytes32 indexed nodeId,
        bytes32 gpuFingerprint,
        uint64  petaflopsUsed,
        ProviderTag providerTag
    );

    // Stub for Track 3.2 — emitted when Video API transcoding completes
    event VideoProvenance(
        bytes32 indexed intentId,
        bytes32 videoId,
        bytes32 contentHash,
        string  playbackUri
    );

    // ─── Errors ───────────────────────────────────────────────────────────────
    error ServiceNotFound();
    error ServiceNotActive();
    error IntentNotFound();
    error InvalidIntentStatus(IntentStatus current, IntentStatus expected);
    error InsufficientPayment();
    error NullifierUsed();
    error PresetNotFound();
    error PresetNotActive();
    error AlreadyAttested();
    error IntentNotCompleted();
    error TdropNotEnabled();
    error TdropTransferFailed();
    error InvalidTdropDiscount();

    // ─── Constructor ──────────────────────────────────────────────────────────
    /**
     * @param _admin Admin address.
     * @param _revenueSplitter CoreRevenueSplitter address (or address(0) for dev).
     * @param _zkVerifier ZKVerifierSP1 address (or address(0) for mock mode).
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

        gpuPriceMultiplier[GpuTier.RTX_4090] = 10000;  // 1x base
        gpuPriceMultiplier[GpuTier.A100]     = 25000;  // 2.5x
        gpuPriceMultiplier[GpuTier.H100]     = 50000;  // 5x
    }

    // ═══════════════════════════════════════════════════════════════════════════
    //  1. SERVICE CATALOG
    // ═══════════════════════════════════════════════════════════════════════════

    /**
     * @notice Register a Theta EdgeCloud service in the catalog.
     * @param serviceType Category of AI service.
     * @param modelName Human-readable model identifier (e.g., "llama-3.1-70b").
     * @param pricePerCall Cost per invocation in wei (TFUEL).
     * @param maxLatencyMs Maximum acceptable latency for SLA enforcement.
     */
    function registerService(
        ServiceType serviceType,
        string calldata modelName,
        uint256 pricePerCall,
        uint256 maxLatencyMs
    ) external onlyRole(OPERATOR_ROLE) returns (bytes32 serviceId) {
        serviceId = keccak256(abi.encodePacked(
            CIRCUIT_ID, uint8(serviceType), modelName, serviceCount
        ));

        services[serviceId] = ServiceConfig({
            serviceId: serviceId,
            serviceType: serviceType,
            modelName: modelName,
            pricePerCall: pricePerCall,
            maxLatencyMs: maxLatencyMs,
            active: true,
            totalCalls: 0
        });

        serviceIds.push(serviceId);
        serviceCount++;

        emit ServiceRegistered(serviceId, serviceType, modelName, pricePerCall);
    }

    /**
     * @notice Update service pricing and status.
     */
    function updateService(
        bytes32 serviceId,
        uint256 newPrice,
        bool active
    ) external onlyRole(OPERATOR_ROLE) {
        if (services[serviceId].serviceId == bytes32(0)) revert ServiceNotFound();
        services[serviceId].pricePerCall = newPrice;
        services[serviceId].active = active;
        emit ServiceUpdated(serviceId, newPrice, active);
    }

    // ═══════════════════════════════════════════════════════════════════════════
    //  1b. PRESET HOOKS & GPU TIER
    // ═══════════════════════════════════════════════════════════════════════════

    function registerPreset(
        string calldata name,
        ServiceType serviceType,
        string calldata defaultModel,
        GpuTier defaultGpu,
        string calldata defaultPrompt
    ) external onlyRole(OPERATOR_ROLE) returns (bytes32 presetId) {
        presetId = keccak256(abi.encodePacked(CIRCUIT_ID, "PRESET", name, presetCount));

        presets[presetId] = PresetConfig({
            presetId: presetId,
            name: name,
            serviceType: serviceType,
            defaultModel: defaultModel,
            defaultGpu: defaultGpu,
            defaultPrompt: defaultPrompt,
            active: true
        });

        presetIds.push(presetId);
        presetCount++;

        emit PresetRegistered(presetId, name, serviceType, defaultGpu);
    }

    function updatePreset(bytes32 presetId, bool active) external onlyRole(OPERATOR_ROLE) {
        if (presets[presetId].presetId == bytes32(0)) revert PresetNotFound();
        presets[presetId].active = active;
    }

    function setGpuMultiplier(GpuTier tier, uint256 multiplierBps) external onlyRole(OPERATOR_ROLE) {
        require(multiplierBps >= 5000 && multiplierBps <= 200000, "MultiplierRange");
        gpuPriceMultiplier[tier] = multiplierBps;
    }

    /**
     * @notice Get the effective price for a service + GPU tier combination.
     * @return effectivePrice The price in wei adjusted for the GPU multiplier.
     */
    function getEffectivePrice(bytes32 serviceId, GpuTier gpuTier) public view returns (uint256 effectivePrice) {
        ServiceConfig storage svc = services[serviceId];
        if (svc.serviceId == bytes32(0)) revert ServiceNotFound();
        effectivePrice = (svc.pricePerCall * gpuPriceMultiplier[gpuTier]) / 10000;
    }

    /**
     * @notice One-click preset intent: select preset + GPU tier, auto-resolve service + price.
     * @param presetId The preset hook ID.
     * @param gpuTier Desired GPU tier (H100/A100/RTX-4090).
     * @param serviceId Target service from catalog (must match preset's serviceType).
     * @param inputHash Keccak256 of inference input.
     * @return intentId The generated intent identifier.
     */
    function submitPresetIntent(
        bytes32 presetId,
        GpuTier gpuTier,
        bytes32 serviceId,
        bytes32 inputHash
    ) external payable whenNotPaused nonReentrant returns (bytes32 intentId) {
        PresetConfig storage preset = presets[presetId];
        if (preset.presetId == bytes32(0)) revert PresetNotFound();
        if (!preset.active) revert PresetNotActive();

        ServiceConfig storage svc = services[serviceId];
        if (svc.serviceId == bytes32(0)) revert ServiceNotFound();
        if (!svc.active) revert ServiceNotActive();

        uint256 effectivePrice = getEffectivePrice(serviceId, gpuTier);
        if (msg.value < effectivePrice) revert InsufficientPayment();

        uint256 fee = (msg.value * feeBps) / BPS_DENOM;
        uint256 netPayment = msg.value - fee;

        intentId = keccak256(abi.encodePacked(
            CIRCUIT_ID, msg.sender, presetId, serviceId, block.number, intentCount++
        ));

        intents[intentId] = Intent({
            intentId: intentId,
            serviceType: svc.serviceType,
            serviceId: serviceId,
            requester: msg.sender,
            payment: netPayment,
            fee: fee,
            inputHash: inputHash,
            outputHash: bytes32(0),
            modelHash: bytes32(0),
            status: IntentStatus.Submitted,
            submittedAt: uint64(block.timestamp),
            completedAt: 0,
            settledAt: 0,
            latencyMs: 0,
            proofNullifier: bytes32(0)
        });

        totalVolume += msg.value;
        totalFeesCollected += fee;
        callsByType[svc.serviceType]++;
        volumeByType[svc.serviceType] += msg.value;
        svc.totalCalls++;

        if (fee > 0 && revenueSplitter != address(0)) {
            (bool ok, ) = revenueSplitter.call{value: fee}(
                abi.encodeWithSignature("depositFee(bytes32)", CIRCUIT_ID)
            );
            if (!ok) {
                (bool ok2, ) = payable(revenueSplitter).call{value: fee}("");
                require(ok2, "FeeFwd");
            }
        }

        emit InferenceIntentSubmitted(
            CIRCUIT_ID, intentId, svc.serviceType, serviceId,
            msg.sender, netPayment, fee, inputHash
        );

        emit PresetIntentSubmitted(intentId, presetId, gpuTier, msg.sender, msg.value);
    }

    // ═══════════════════════════════════════════════════════════════════════════
    //  2. INTENT SUBMISSION
    // ═══════════════════════════════════════════════════════════════════════════

    /**
     * @notice Submit an AI inference intent for a specific Theta EdgeCloud service.
     * @param serviceId Target service from the catalog.
     * @param inputHash Keccak256 hash of the inference input (prompt, audio data, etc.).
     * @return intentId Unique intent identifier.
     *
     * @dev Payment must be >= service's pricePerCall. Fee is deducted and
     *      forwarded to CoreRevenueSplitter. Emits InferenceIntentSubmitted
     *      for theta-inference-handler.js to detect and route to EdgeCloud API.
     *
     * Per Section 9.8: Circuit provides domain-specific logic; Core Layer
     * provides ZK settlement, fee collection, and governance.
     */
    function submitIntent(
        bytes32 serviceId,
        bytes32 inputHash
    ) external payable whenNotPaused nonReentrant returns (bytes32 intentId) {
        ServiceConfig storage svc = services[serviceId];
        if (svc.serviceId == bytes32(0)) revert ServiceNotFound();
        if (!svc.active) revert ServiceNotActive();
        if (msg.value < svc.pricePerCall) revert InsufficientPayment();

        uint256 fee = (msg.value * feeBps) / BPS_DENOM;
        uint256 netPayment = msg.value - fee;

        intentId = keccak256(abi.encodePacked(
            CIRCUIT_ID, msg.sender, serviceId, block.number, intentCount++
        ));

        intents[intentId] = Intent({
            intentId: intentId,
            serviceType: svc.serviceType,
            serviceId: serviceId,
            requester: msg.sender,
            payment: netPayment,
            fee: fee,
            inputHash: inputHash,
            outputHash: bytes32(0),
            modelHash: bytes32(0),
            status: IntentStatus.Submitted,
            submittedAt: uint64(block.timestamp),
            completedAt: 0,
            settledAt: 0,
            latencyMs: 0,
            proofNullifier: bytes32(0)
        });

        totalVolume += msg.value;
        totalFeesCollected += fee;
        callsByType[svc.serviceType]++;
        volumeByType[svc.serviceType] += msg.value;
        svc.totalCalls++;

        // Forward fee to Core RevenueSplitter — per Section 5
        if (fee > 0 && revenueSplitter != address(0)) {
            (bool ok, ) = revenueSplitter.call{value: fee}(
                abi.encodeWithSignature("depositFee(bytes32)", CIRCUIT_ID)
            );
            if (!ok) {
                (bool ok2, ) = payable(revenueSplitter).call{value: fee}("");
                require(ok2, "FeeFwd");
            }
        }

        emit InferenceIntentSubmitted(
            CIRCUIT_ID, intentId, svc.serviceType, serviceId,
            msg.sender, netPayment, fee, inputHash
        );
    }

    /**
     * @notice Submit an AI inference intent paid in TDROP (TNT-20) instead of TFUEL.
     *
     * Callers approve this contract for the required TDROP amount before calling.
     * The TDROP amount required is:
     *   tfuelPrice   = service.pricePerCall
     *   discountedFee = feeBps * (1 - tdropDiscountBps / BPS_DENOM)
     *   tdropRequired = tfuelPrice * tdropPerTfuel / 1e18
     *     (minus the fee discount already baked into `tdropFee` below)
     *
     * Concretely:
     *   tdropFee        = (tfuelPrice * tdropPerTfuel / 1e18) * feeBps / BPS_DENOM
     *                     * (BPS_DENOM - tdropDiscountBps) / BPS_DENOM
     *   tdropPayment    = (tfuelPrice * tdropPerTfuel / 1e18) - tdropFee
     *   totalTdrop      = tdropFee + tdropPayment  == tfuelPrice * tdropPerTfuel / 1e18
     *
     * TDROP fees are forwarded to CoreRevenueSplitter via receiveERC20Fee().
     * The intent is recorded in the same `intents` mapping as TFUEL intents,
     * allowing identical settlement, attestation, and ZK proof paths.
     *
     * @param serviceId   Service to invoke (must be registered + active).
     * @param inputHash   Keccak256 of the off-chain request payload.
     * @return intentId   bytes32 identifier for downstream tracking.
     */
    function submitIntentWithTDROP(
        bytes32 serviceId,
        bytes32 inputHash
    ) external whenNotPaused nonReentrant returns (bytes32 intentId) {
        if (address(tdropToken) == address(0)) revert TdropNotEnabled();

        ServiceConfig storage svc = services[serviceId];
        if (svc.serviceId == bytes32(0)) revert ServiceNotFound();
        if (!svc.active) revert ServiceNotActive();

        // Convert TFUEL price → TDROP amount using the configured rate
        // tdropPerTfuel: how many TDROP wei equal 1 TFUEL wei
        uint256 tdropTotal = (svc.pricePerCall * tdropPerTfuel) / 1e18;
        require(tdropTotal > 0, "PriceTooSmall");

        // Apply discount to the fee portion only (not the full payment)
        uint256 tdropFeeBase   = (tdropTotal * feeBps) / BPS_DENOM;
        uint256 tdropFeeActual = (tdropFeeBase * (BPS_DENOM - tdropDiscountBps)) / BPS_DENOM;
        uint256 tdropPayment   = tdropTotal - tdropFeeBase; // base net payment
        // Adjust for the discount: caller saves tdropFeeBase - tdropFeeActual
        uint256 tdropRequired  = tdropPayment + tdropFeeActual;

        // Pull TDROP from caller (must have approved this contract beforehand)
        bool ok = tdropToken.transferFrom(msg.sender, address(this), tdropRequired);
        if (!ok) revert TdropTransferFailed();

        totalTdropCollected += tdropRequired;

        intentId = keccak256(abi.encodePacked(
            CIRCUIT_ID, msg.sender, serviceId, block.number, intentCount++
        ));

        // Store intent with zero TFUEL payment — fee denominated in TDROP
        intents[intentId] = Intent({
            intentId:       intentId,
            serviceType:    svc.serviceType,
            serviceId:      serviceId,
            requester:      msg.sender,
            payment:        tdropPayment,   // TDROP units (not TFUEL)
            fee:            tdropFeeActual, // TDROP fee (discounted)
            inputHash:      inputHash,
            outputHash:     bytes32(0),
            modelHash:      bytes32(0),
            status:         IntentStatus.Submitted,
            submittedAt:    uint64(block.timestamp),
            completedAt:    0,
            settledAt:      0,
            latencyMs:      0,
            proofNullifier: bytes32(0)
        });

        callsByType[svc.serviceType]++;
        svc.totalCalls++;
        // Note: volumeByType tracks TDROP in TDROP units for this serviceType

        // Forward TDROP fee to CoreRevenueSplitter (non-fatal if not configured)
        if (tdropFeeActual > 0 && revenueSplitter != address(0)) {
            // Approve splitter to pull the fee
            // (some ERC-20s require re-approval; this is safe for TNT-20)
            (bool appOk, ) = address(tdropToken).call(
                abi.encodeWithSignature("approve(address,uint256)", revenueSplitter, tdropFeeActual)
            );
            if (appOk) {
                // Call receiveERC20Fee on the splitter — non-fatal if not implemented
                // solhint-disable-next-line no-unused-vars
                bool _fwdOk; bytes memory _fwdData;
                (_fwdOk, _fwdData) = revenueSplitter.call(
                    abi.encodeWithSignature(
                        "receiveERC20Fee(bytes32,address,uint256,uint8)",
                        CIRCUIT_ID, address(tdropToken), tdropFeeActual, uint8(1) // THETA_NATIVE tag
                    )
                );
            }
        }

        emit TdropIntentSubmitted(intentId, msg.sender, tdropFeeActual, svc.pricePerCall, tdropDiscountBps);
        emit InferenceIntentSubmitted(
            CIRCUIT_ID, intentId, svc.serviceType, serviceId,
            msg.sender, tdropPayment, tdropFeeActual, inputHash
        );
    }

    // ═══════════════════════════════════════════════════════════════════════════
    //  3. COMPLETION & SETTLEMENT
    // ═══════════════════════════════════════════════════════════════════════════

    /**
     * @notice Report intent completion with output hash and latency.
     * @param intentId Completed intent.
     * @param outputHash Keccak256 of API response body.
     * @param modelHash Hash of the model version/checkpoint used.
     * @param latencyMs Actual API call latency in milliseconds.
     */
    function completeIntent(
        bytes32 intentId,
        bytes32 outputHash,
        bytes32 modelHash,
        uint256 latencyMs
    ) external onlyRole(RELAYER_ROLE) {
        Intent storage i = intents[intentId];
        if (i.submittedAt == 0) revert IntentNotFound();
        if (i.status != IntentStatus.Submitted && i.status != IntentStatus.Processing) {
            revert InvalidIntentStatus(i.status, IntentStatus.Submitted);
        }

        i.outputHash = outputHash;
        i.modelHash = modelHash;
        i.latencyMs = latencyMs;
        i.status = IntentStatus.Completed;
        i.completedAt = uint64(block.timestamp);

        emit IntentCompleted(intentId, outputHash, modelHash, latencyMs);
    }

    // ═══════════════════════════════════════════════════════════════════════════
    //  3b. EDGECLOUD NODE ATTESTATION  (Track 2.1)
    // ═══════════════════════════════════════════════════════════════════════════

    /**
     * @notice Attest which Theta EdgeCloud node executed a given intent.
     *
     * @dev Called by ai-listener.js (RELAYER_ROLE) after receiving the EdgeCloud
     *      API job response and before calling settleIntent(). The nodeId must
     *      also be encoded in the SP1 publicValues passed to settleIntent() so
     *      the ZK proof cryptographically commits to the specific hardware.
     *
     *      Workflow in ai-listener.js:
     *        1. completeIntent(intentId, outputHash, modelHash, latencyMs)
     *        2. attestEdgeCloudNode(intentId, nodeId, gpuFingerprint, petaflops, tag)
     *        3. settleIntent(intentId, proof, publicValues, nullifier)
     *           └─ publicValues must include nodeId at bytes[64:96]
     *
     * @param intentId        The intent being attested.
     * @param nodeId          EdgeCloud node ID from job response metadata.
     * @param gpuFingerprint  Hash of GPU model string + driver version (off-chain hashed).
     * @param petaflopsUsed   Compute consumed reported by node (in GFLOPS units).
     * @param providerTag     THETA_NATIVE (1) or HYBRID_FALLBACK (2).
     */
    function attestEdgeCloudNode(
        bytes32 intentId,
        bytes32 nodeId,
        bytes32 gpuFingerprint,
        uint64  petaflopsUsed,
        ProviderTag providerTag
    ) external onlyRole(RELAYER_ROLE) {
        Intent storage i = intents[intentId];
        if (i.submittedAt == 0) revert IntentNotFound();
        if (i.status != IntentStatus.Completed) revert IntentNotCompleted();
        if (attestations[intentId].attestedAt != 0) revert AlreadyAttested();
        require(providerTag != ProviderTag.UNSET, "ProviderTagUnset");

        attestations[intentId] = EdgeCloudAttestation({
            nodeId:         nodeId,
            gpuFingerprint: gpuFingerprint,
            petaflopsUsed:  petaflopsUsed,
            attestedAt:     uint64(block.timestamp),
            providerTag:    providerTag
        });
        attestationCount++;

        emit EdgeCloudNodeAttested(intentId, nodeId, gpuFingerprint, petaflopsUsed, providerTag);
    }

    /**
     * @notice Emit video provenance for a VIDEO_PROCESSING intent.
     *         Called by the backend after Theta Video API transcoding succeeds.
     * @dev    Track 3.2 stub — handler populates from Video API GET /video/<id> response.
     */
    function emitVideoProvenance(
        bytes32 intentId,
        bytes32 videoId,
        bytes32 contentHash,
        string calldata playbackUri
    ) external onlyRole(RELAYER_ROLE) {
        Intent storage i = intents[intentId];
        if (i.submittedAt == 0) revert IntentNotFound();
        require(i.serviceType == ServiceType.VIDEO_PROCESSING, "NotVideoIntent");
        emit VideoProvenance(intentId, videoId, contentHash, playbackUri);
    }

    /**
     * @notice Settle a completed intent with ZK proof.
     * @param intentId Intent to settle.
     * @param proof SP1 proof bytes.
     * @param publicValues SP1 public values encoding serviceType, modelHash,
     *        inputHash, outputHash for privacy-preserving verification.
     * @param nullifier Replay protection nullifier.
     * @param useZkGPT If true and zkVerifierZkGPT is set, use ZKVerifierZkGPT (Phase 1); else use zkVerifier (SP1).
     *
     * @dev Per Section 7: Uses SP1ProofHooks for nullifier computation.
     *      In mock mode (zkVerifier == address(0)), proof verification is skipped.
     */
    function settleIntent(
        bytes32 intentId,
        bytes calldata proof,
        bytes calldata publicValues,
        bytes32 nullifier,
        bool useZkGPT
    ) external onlyRole(RELAYER_ROLE) nonReentrant whenNotPaused {
        Intent storage i = intents[intentId];
        if (i.submittedAt == 0) revert IntentNotFound();
        if (i.status != IntentStatus.Completed) {
            revert InvalidIntentStatus(i.status, IntentStatus.Completed);
        }

        if (_usedNullifiers[nullifier]) revert NullifierUsed();
        _usedNullifiers[nullifier] = true;

        // Verify proof via Core verifier (SP1 or zkGPT per Phase 1) — per Section 3.2
        address verifier = (useZkGPT && zkVerifierZkGPT != address(0)) ? zkVerifierZkGPT : zkVerifier;
        if (verifier != address(0)) {
            (bool ok, ) = verifier.call(
                abi.encodeWithSignature(
                    "verifyProof(bytes32,bytes,bytes,bytes32)",
                    CIRCUIT_ID, publicValues, proof, nullifier
                )
            );
            require(ok, "ProofFailed");
        }

        i.status = IntentStatus.Settled;
        i.settledAt = uint64(block.timestamp);
        i.proofNullifier = nullifier;

        // ── Tag fee origin on splitter for dynamic boost accounting ──────────
        // The fee was forwarded at submitIntent() time; now we know the providerTag
        // from the attestation (if any) and report it to CoreRevenueSplitter so the
        // dynamic boost multiplier reflects real Theta-native execution share.
        if (revenueSplitter != address(0) && i.fee > 0) {
            EdgeCloudAttestation storage att = attestations[intentId];
            uint8 tag = att.attestedAt > 0 ? uint8(att.providerTag) : uint8(ProviderTag.UNSET);
            if (tag != uint8(ProviderTag.UNSET)) {
                // Non-fatal — boost accounting failure must not block settlement
                bool _tagOk;
                (_tagOk, ) = revenueSplitter.call(
                    abi.encodeWithSignature(
                        "tagFeeOrigin(bytes32,uint8,uint256)",
                        CIRCUIT_ID, tag, i.fee
                    )
                );
            }
        }

        emit IntentSettled(intentId, nullifier, i.payment);
    }

    /**
     * @notice Mark an intent as failed (API error, timeout, SLA breach).
     * @param intentId Failed intent.
     * @param reason Human-readable failure reason.
     */
    function failIntent(
        bytes32 intentId,
        string calldata reason
    ) external onlyRole(RELAYER_ROLE) nonReentrant {
        Intent storage i = intents[intentId];
        if (i.submittedAt == 0) revert IntentNotFound();

        i.status = IntentStatus.Failed;

        // Refund requester
        if (i.payment > 0) {
            (bool ok, ) = payable(i.requester).call{value: i.payment}("");
            require(ok, "RefundFailed");
        }

        emit IntentFailed(intentId, reason);
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

    /// @notice Set zkGPT verifier for Phase 1 inference path (proof_system: zkgpt).
    function setZKVerifierZkGPT(address _zk) external onlyRole(DEFAULT_ADMIN_ROLE) {
        zkVerifierZkGPT = _zk;
    }

    /**
     * @notice Configure TDROP payment support.
     * @param _tdropToken      TNT-20 TDROP contract address. Zero disables TDROP payments.
     * @param _discountBps     Fee discount for TDROP payers, in BPS (0–5000).
     * @param _tdropPerTfuel   TDROP wei equivalent of 1 TFUEL wei. Set by governance
     *                         or an oracle keeper. Default 1e18 (1:1).
     *
     * Mainnet TDROP:  0x1336739B05C7Ab8a526D40DCC0d04a826b5f8B03 (chain 361)
     * Testnet TDROP:  0xde41591ED1f8ED1484aC2CD8ca0876428de60EfF (chain 365)
     *
     * @dev Callable by DEFAULT_ADMIN_ROLE. Also callable by GOVERNANCE_ROLE to allow
     *      on-chain governance proposals to adjust the discount rate and price feed.
     */
    function setTdropConfig(
        address _tdropToken,
        uint16  _discountBps,
        uint256 _tdropPerTfuel
    ) external {
        require(
            hasRole(DEFAULT_ADMIN_ROLE, msg.sender) || hasRole(OPERATOR_ROLE, msg.sender),
            "NotAdminOrOperator"
        );
        if (_discountBps > MAX_TDROP_DISCOUNT) revert InvalidTdropDiscount();
        require(_tdropPerTfuel > 0, "ZeroRate");

        tdropToken       = ITdropToken(_tdropToken);
        tdropDiscountBps = _discountBps;
        tdropPerTfuel    = _tdropPerTfuel;

        emit TdropConfigUpdated(_tdropToken, _discountBps, _tdropPerTfuel);
    }

    /**
     * @notice Calculate how much TDROP is required to pay for a service.
     * @param serviceId  Registered service to query.
     * @return tdropRequired  Total TDROP wei the caller must approve + transfer.
     * @return tdropFee       TDROP fee portion (discounted).
     * @return tdropPayment   TDROP net payment portion.
     * @return discountBps    Applied discount in BPS.
     */
    function quoteTdrop(bytes32 serviceId) external view returns (
        uint256 tdropRequired,
        uint256 tdropFee,
        uint256 tdropPayment,
        uint16  discountBps
    ) {
        ServiceConfig storage svc = services[serviceId];
        if (svc.serviceId == bytes32(0)) revert ServiceNotFound();
        if (address(tdropToken) == address(0)) revert TdropNotEnabled();

        uint256 tdropTotal = (svc.pricePerCall * tdropPerTfuel) / 1e18;
        uint256 feeBase    = (tdropTotal * feeBps) / BPS_DENOM;
        tdropFee     = (feeBase * (BPS_DENOM - tdropDiscountBps)) / BPS_DENOM;
        tdropPayment = tdropTotal - feeBase;
        tdropRequired = tdropPayment + tdropFee;
        discountBps  = tdropDiscountBps;
    }

    function pause() external onlyRole(OPERATOR_ROLE) { _pause(); }
    function unpause() external onlyRole(OPERATOR_ROLE) { _unpause(); }

    // ─── Views ────────────────────────────────────────────────────────────────

    function getService(bytes32 serviceId) external view returns (ServiceConfig memory) {
        return services[serviceId];
    }

    function getIntent(bytes32 intentId) external view returns (Intent memory) {
        return intents[intentId];
    }

    function getServiceCount() external view returns (uint256) {
        return serviceCount;
    }

    function getStats() external view returns (
        uint256 intents_, uint256 volume_, uint256 fees_, uint256 services_
    ) {
        return (intentCount, totalVolume, totalFeesCollected, serviceCount);
    }

    function getTypeStats(ServiceType sType) external view returns (
        uint256 calls_, uint256 volume_
    ) {
        return (callsByType[sType], volumeByType[sType]);
    }

    function getPreset(bytes32 presetId) external view returns (PresetConfig memory) {
        return presets[presetId];
    }

    function getPresetCount() external view returns (uint256) {
        return presetCount;
    }

    function getGpuMultiplier(GpuTier tier) external view returns (uint256) {
        return gpuPriceMultiplier[tier];
    }

    function getAttestation(bytes32 intentId) external view returns (EdgeCloudAttestation memory) {
        return attestations[intentId];
    }

    function getAttestationCount() external view returns (uint256) {
        return attestationCount;
    }

    receive() external payable {}
}
