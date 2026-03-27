// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/**
 * @title IZKVerifierZkGPT
 * @notice Interface for the zkGPT verifier (GKR + Lasso). Phase 1 — second verifier for inference.
 * @dev Same signature as SP1 verifier so circuits can call either verifier based on proof_system.
 *      See docs/PHASE1_KICKOFF.md and docs/research/zkGPT-feasibility-memo.md.
 */
interface IZKVerifierZkGPT {
    /// @notice Verify a zkGPT proof (GKR + Lasso); replay protection via nullifier.
    /// @param circuitId Circuit identifier (e.g. ZKML_CIRCUIT).
    /// @param publicValues Public inputs/outputs committed by the zkGPT prover.
    /// @param proofBytes zkGPT proof (~101 KB); format is GKR + Lasso, not Groth16/PLONK.
    /// @param nullifier Unique per proof; must not have been used before.
    /// @return success True if the proof is valid.
    function verifyProof(
        bytes32 circuitId,
        bytes calldata publicValues,
        bytes calldata proofBytes,
        bytes32 nullifier
    ) external returns (bool success);

    /// @notice Check whether a nullifier has already been used.
    function isNullifierUsed(bytes32 nullifier) external view returns (bool);
}
