// SPDX-License-Identifier: MIT
pragma solidity ^0.8.22;

import "@openzeppelin/contracts/access/AccessControl.sol";
import "@openzeppelin/contracts/utils/Pausable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "../interfaces/IZKVerifierZkGPT.sol";

/**
 * @title ZKVerifierZkGPT
 * @author XFuel Protocol — Phase 1 (ZK Research Upgrade Package)
 * @notice Stub verifier for zkGPT (GKR + Lasso) inference proofs. Reverts until real verification is implemented.
 * @dev Phase 1: second verifier for inference_request when proof_system is zkgpt.
 *      Same verifyProof(circuitId, publicValues, proofBytes, nullifier) signature as ZKVerifierSP1
 *      so ZKMLCircuit/ThetaInferenceCircuit can route to this contract when proof_system is zkgpt.
 * @custom:security-contact security@xfuel.app
 *
 * References:
 *   - zkGPT paper: https://eprint.iacr.org/2025/1184 (NUS/HKUST; open-source: github.com/security-Anonymous/zkgpt)
 *   - docs/REFERENCES-AND-ATTRIBUTION.md, docs/research/zkGPT-feasibility-memo.md
 *   - ZK-RESEARCH-UPGRADE-PACKAGE.md Phase 1
 */
contract ZKVerifierZkGPT is IZKVerifierZkGPT, AccessControl, Pausable, ReentrancyGuard {
    bytes32 public constant OPERATOR_ROLE = keccak256("OPERATOR_ROLE");

    /// @notice Max proof size (~101 KB per paper; allow growth)
    uint256 public constant MAX_ZKGPT_PROOF_BYTES = 150_000;
    /// @notice Min proof size (reject empty)
    uint256 public constant MIN_PROOF_BYTES = 1;
    /// @notice Max publicValues calldata size
    uint256 public constant MAX_PUBLIC_VALUES_BYTES = 4096;

    mapping(bytes32 => bool) public usedNullifiers;
    uint256 public totalVerified;

    error NullifierAlreadyUsed(bytes32 nullifier);
    error ZkGPTVerifierNotImplemented();
    error InvalidProofLength(uint256 length);
    error InvalidPublicValuesLength(uint256 length);

    event ProofVerified(
        bytes32 indexed circuitId,
        bytes32 indexed nullifier,
        bytes32 publicValuesHash,
        uint256 timestamp
    );

    constructor(address admin) {
        require(admin != address(0), "ZeroAdmin");
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
        _grantRole(OPERATOR_ROLE, admin);
    }

    /**
     * @notice Verify a zkGPT proof. STUB: validates lengths then reverts until GKR+Lasso verification is implemented.
     * @dev When implemented: run GKR + Lasso verifier (see docs/ZKG2_VERIFIER_SPEC.md); record nullifier; emit ProofVerified; return true.
     */
    function verifyProof(
        bytes32 /* circuitId */,
        bytes calldata publicValues,
        bytes calldata proofBytes,
        bytes32 nullifier
    ) external override whenNotPaused nonReentrant returns (bool) {
        if (usedNullifiers[nullifier]) revert NullifierAlreadyUsed(nullifier);
        if (proofBytes.length < MIN_PROOF_BYTES || proofBytes.length > MAX_ZKGPT_PROOF_BYTES) {
            revert InvalidProofLength(proofBytes.length);
        }
        if (publicValues.length > MAX_PUBLIC_VALUES_BYTES) {
            revert InvalidPublicValuesLength(publicValues.length);
        }
        // ZKG-2: delegate to internal verifier (parse → GKR sumcheck → Lasso lookup → consistency)
        if (!_verifyZkGPTProof(publicValues, proofBytes)) revert ZkGPTVerifierNotImplemented();
        usedNullifiers[nullifier] = true;
        totalVerified += 1;
        emit ProofVerified(bytes32(0), nullifier, keccak256(publicValues), block.timestamp);
        return true;
    }

    /**
     * @dev ZKG-2 implementation hook. When implemented: parse proofBytes (GKR + Lasso segments),
     *      recompute Fiat–Shamir challenges, run GKR sumcheck verifier, Lasso lookup verifier,
     *      check publicValues consistency. See docs/ZKG2_VERIFIER_SPEC.md and upstream zkgpt repo.
     * @return true if proof is valid; false or revert in stub until GKR+Lasso are implemented.
     */
    function _verifyZkGPTProof(bytes calldata publicValues, bytes calldata proofBytes)
        internal
        pure
        returns (bool)
    {
        (publicValues, proofBytes); // silence unused warning
        // Stub: real implementation per ZKG2_VERIFIER_SPEC.md §4 (parse → GKR → Lasso → consistency)
        return false;
    }

    /// @inheritdoc IZKVerifierZkGPT
    function isNullifierUsed(bytes32 nullifier) external view override returns (bool) {
        return usedNullifiers[nullifier];
    }

    function pause() external onlyRole(OPERATOR_ROLE) {
        _pause();
    }

    function unpause() external onlyRole(OPERATOR_ROLE) {
        _unpause();
    }
}
