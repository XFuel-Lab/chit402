// SPDX-License-Identifier: MIT
pragma solidity ^0.8.22;

import "@openzeppelin/contracts/access/AccessControl.sol";
import "@openzeppelin/contracts/utils/Pausable.sol";
import "../interfaces/IModelRegistry.sol";

/**
 * @title ModelRegistry
 * @author XFuel Protocol — Verified Inference (Tier-3), Phase 1 (PoMA)
 * @custom:security-contact security@xfuel.app
 * @notice On-chain registry of model-authenticity commitments — the anti-downgrade wedge
 *         for XFuel Verified Inference. Providers register a commitment to the exact weights
 *         they serve; receipts cite `(modelId, version, commitment)` so a downgrade to a
 *         smaller/cheaper model becomes detectable and, later, provable (PoMA).
 *
 * @dev Design (see docs/POMA_SPEC.md and docs/TIER3_VERIFIABLE_INFERENCE_BUILD_SPEC.md §4):
 *      - `modelId` = keccak256(canonical slug), e.g. keccak256("llama-3-70b:q4_k_m").
 *      - Versions are APPEND-ONLY per model and 1-based; a version's commitment is IMMUTABLE.
 *      - Commitments are globally unique (one commitment ↔ one (modelId, version)).
 *      - `retireVersion` only flips an active flag; the commitment stays permanently readable
 *        so historical receipts remain verifiable.
 *      - Only REGISTRAR_ROLE can register/retire; deploy on Base (ADR 0002).
 */
contract ModelRegistry is IModelRegistry, AccessControl, Pausable {
    bytes32 public constant OPERATOR_ROLE = keccak256("OPERATOR_ROLE");
    bytes32 public constant REGISTRAR_ROLE = keccak256("REGISTRAR_ROLE");

    /// @notice modelId → list of versions (index 0 unused so versions are 1-based).
    mapping(bytes32 => ModelVersion[]) private _versions;
    /// @notice modelId → version → retired flag.
    mapping(bytes32 => mapping(uint256 => bool)) private _retired;
    /// @notice commitment → packed (modelId, version) for reverse lookup.
    mapping(bytes32 => bytes32) private _commitmentModel;
    mapping(bytes32 => uint256) private _commitmentVersion;

    /// @notice Total distinct models with ≥1 version.
    uint256 public modelCount;
    /// @notice Total versions registered across all models.
    uint256 public totalVersions;

    constructor(address admin) {
        require(admin != address(0), "ZeroAdmin");
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
        _grantRole(OPERATOR_ROLE, admin);
        _grantRole(REGISTRAR_ROLE, admin);
    }

    // ─── Registration ───────────────────────────────────────────────────────────

    /// @inheritdoc IModelRegistry
    function registerModel(
        bytes32 modelId,
        bytes32 commitment,
        CommitmentScheme scheme,
        string calldata arch,
        string calldata quant,
        string calldata metadataURI
    ) external override whenNotPaused onlyRole(REGISTRAR_ROLE) returns (uint256 version) {
        if (commitment == bytes32(0)) revert CommitmentZero();
        if (_commitmentModel[commitment] != bytes32(0)) revert CommitmentAlreadyRegistered(commitment);

        ModelVersion[] storage list = _versions[modelId];
        if (list.length == 0) {
            // Reserve index 0 so real versions are 1-based (empty sentinel).
            list.push();
            modelCount += 1;
        }

        list.push(
            ModelVersion({
                commitment: commitment,
                scheme: scheme,
                arch: arch,
                quant: quant,
                metadataURI: metadataURI,
                registeredAt: uint64(block.timestamp),
                registrar: msg.sender
            })
        );
        version = list.length - 1; // 1-based

        _commitmentModel[commitment] = modelId;
        _commitmentVersion[commitment] = version;
        totalVersions += 1;

        emit ModelRegistered(modelId, version, commitment, scheme, msg.sender);
    }

    /// @inheritdoc IModelRegistry
    function retireVersion(bytes32 modelId, uint256 version)
        external
        override
        onlyRole(REGISTRAR_ROLE)
    {
        _requireVersion(modelId, version);
        if (_retired[modelId][version]) revert VersionAlreadyRetired(modelId, version);
        _retired[modelId][version] = true;
        emit ModelVersionRetired(modelId, version);
    }

    // ─── Views ──────────────────────────────────────────────────────────────────

    /// @inheritdoc IModelRegistry
    function latestVersion(bytes32 modelId) public view override returns (uint256) {
        uint256 len = _versions[modelId].length;
        return len == 0 ? 0 : len - 1;
    }

    /// @inheritdoc IModelRegistry
    function getModel(bytes32 modelId, uint256 version)
        public
        view
        override
        returns (ModelVersion memory)
    {
        _requireVersion(modelId, version);
        return _versions[modelId][version];
    }

    /// @inheritdoc IModelRegistry
    function getLatestModel(bytes32 modelId) external view override returns (ModelVersion memory) {
        uint256 v = latestVersion(modelId);
        if (v == 0) revert UnknownModel(modelId);
        return _versions[modelId][v];
    }

    /// @inheritdoc IModelRegistry
    function isActive(bytes32 modelId, uint256 version) public view override returns (bool) {
        uint256 len = _versions[modelId].length;
        if (version == 0 || version >= len) return false;
        return !_retired[modelId][version];
    }

    /// @inheritdoc IModelRegistry
    function verifyCommitment(bytes32 modelId, uint256 version, bytes32 commitment)
        external
        view
        override
        returns (bool ok)
    {
        if (!isActive(modelId, version)) return false;
        return _versions[modelId][version].commitment == commitment;
    }

    /// @inheritdoc IModelRegistry
    function lookupCommitment(bytes32 commitment)
        external
        view
        override
        returns (bytes32 modelId, uint256 version)
    {
        modelId = _commitmentModel[commitment];
        version = _commitmentVersion[commitment];
    }

    /// @notice Number of versions registered for a model (excludes the 1-based sentinel).
    function versionCount(bytes32 modelId) external view returns (uint256) {
        uint256 len = _versions[modelId].length;
        return len == 0 ? 0 : len - 1;
    }

    // ─── Admin ────────────────────────────────────────────────────────────────

    function pause() external onlyRole(OPERATOR_ROLE) {
        _pause();
    }

    function unpause() external onlyRole(OPERATOR_ROLE) {
        _unpause();
    }

    // ─── Internal ────────────────────────────────────────────────────────────

    function _requireVersion(bytes32 modelId, uint256 version) internal view {
        uint256 len = _versions[modelId].length;
        if (len == 0) revert UnknownModel(modelId);
        if (version == 0 || version >= len) revert UnknownVersion(modelId, version);
    }
}
