// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/**
 * @title IModelRegistry
 * @notice On-chain registry of model-authenticity commitments (PoMA — Proof of Model
 *         Authenticity). Phase 1 of docs/TIER3_VERIFIABLE_INFERENCE_BUILD_SPEC.md.
 * @dev A model is identified by a stable `modelId` (keccak256 of a canonical model slug,
 *      e.g. "llama-3-70b:q4_k_m"). Each version pins an immutable `commitment` to the exact
 *      weights served (see docs/POMA_SPEC.md). Commitments are append-only per model:
 *      versions are never mutated or deleted, so a receipt that cites a commitment stays
 *      verifiable forever. This is the anti-downgrade wedge — a provider cannot silently
 *      serve a smaller/cheaper model than the one committed for the version it claims.
 */
interface IModelRegistry {
    /// @notice Commitment scheme used for a version (upgrade path: keccak/Merkle → MLE).
    enum CommitmentScheme {
        KECCAK_MERKLE, // 0: keccak256 Merkle root over ordered weight shards (Phase 1 default)
        MLE_POLY       // 1: multilinear-extension / polynomial commitment (ZK-tier reusable)
    }

    /// @notice A single immutable model version.
    struct ModelVersion {
        bytes32 commitment;       // root commitment over the exact weight file(s)
        CommitmentScheme scheme;  // how `commitment` was computed
        string arch;              // architecture family, e.g. "llama-3"
        string quant;             // quantization tag, e.g. "q4_k_m" / "fp16"
        string metadataURI;       // off-chain manifest (shard list, sizes, hashes)
        uint64 registeredAt;      // block timestamp of registration
        address registrar;        // who registered this version
    }

    /// @notice Emitted when a new model version is registered.
    event ModelRegistered(
        bytes32 indexed modelId,
        uint256 indexed version,
        bytes32 indexed commitment,
        CommitmentScheme scheme,
        address registrar
    );

    /// @notice Emitted when a model version is retired from active serving (commitment stays readable).
    event ModelVersionRetired(bytes32 indexed modelId, uint256 indexed version);

    error CommitmentZero();
    error CommitmentAlreadyRegistered(bytes32 commitment);
    error UnknownModel(bytes32 modelId);
    error UnknownVersion(bytes32 modelId, uint256 version);
    error VersionAlreadyRetired(bytes32 modelId, uint256 version);

    /**
     * @notice Register a new immutable version for a model. Appends a version; never mutates.
     * @param modelId       Stable id (keccak256 of canonical model slug).
     * @param commitment    Root commitment over the exact weights (must be non-zero, globally unique).
     * @param scheme        Commitment scheme used.
     * @param arch          Architecture family label.
     * @param quant         Quantization tag.
     * @param metadataURI   Off-chain manifest URI (shard hashes/sizes).
     * @return version      The newly assigned version index (1-based).
     */
    function registerModel(
        bytes32 modelId,
        bytes32 commitment,
        CommitmentScheme scheme,
        string calldata arch,
        string calldata quant,
        string calldata metadataURI
    ) external returns (uint256 version);

    /// @notice Retire a version from active serving. Commitment remains permanently readable.
    function retireVersion(bytes32 modelId, uint256 version) external;

    /// @notice Latest (highest) version index for a model, or 0 if unknown.
    function latestVersion(bytes32 modelId) external view returns (uint256);

    /// @notice Read a specific model version.
    function getModel(bytes32 modelId, uint256 version) external view returns (ModelVersion memory);

    /// @notice Read the latest version of a model.
    function getLatestModel(bytes32 modelId) external view returns (ModelVersion memory);

    /// @notice True if a version is registered and not retired.
    function isActive(bytes32 modelId, uint256 version) external view returns (bool);

    /**
     * @notice Verify a claimed commitment matches a registered (active) model version.
     * @return ok True iff the version exists, is active, and its commitment equals `commitment`.
     */
    function verifyCommitment(bytes32 modelId, uint256 version, bytes32 commitment)
        external
        view
        returns (bool ok);

    /// @notice Reverse lookup: which (modelId, version) a commitment belongs to (0,0 if none).
    function lookupCommitment(bytes32 commitment)
        external
        view
        returns (bytes32 modelId, uint256 version);
}
