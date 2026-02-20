// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/**
 * @title ISP1Verifier
 * @notice Interface for the SP1 Verifier Gateway (Succinct SP1 zkVM).
 *
 * Research notes (SP1 docs v5.x, Feb 2026):
 *   - SP1 compiles Rust to RISC-V, generates STARK core proofs, then wraps as
 *     Groth16 (Bn254) or PLONK for on-chain verification.
 *   - Groth16 proofs: ~260 bytes, ~270k gas to verify.
 *   - PLONK proofs: ~868 bytes, ~300k gas, no trusted setup.
 *   - Gateway auto-routes to the correct verifier version.
 *   - Deployed on 13+ chains including Ethereum, Arbitrum, Base.
 *
 * Canonical gateway addresses (Ethereum mainnet):
 *   Groth16: 0x397A5f7f3dBd538f23DE225B51f532c34448dA9B
 *   PLONK:   0x3B6041173B80E77f038f3F2C0f9744f04837185e
 */
interface ISP1Verifier {
    /// @notice Verify an SP1 proof.
    /// @param programVKey The verification key for the RISC-V program.
    /// @param publicValues The ABI-encoded public values committed by the program.
    /// @param proofBytes The proof bytes (Groth16 or PLONK).
    /// @dev Reverts if the proof is invalid.
    function verifyProof(
        bytes32 programVKey,
        bytes calldata publicValues,
        bytes calldata proofBytes
    ) external view;
}

/**
 * @title ISP1VerifierWithHash
 * @notice Extended interface that also returns the hash of the public values.
 */
interface ISP1VerifierWithHash is ISP1Verifier {
    /// @notice Verify an SP1 proof and return the public values hash.
    /// @return publicValuesHash keccak256 of the public values.
    function verifyProofWithHash(
        bytes32 programVKey,
        bytes calldata publicValues,
        bytes calldata proofBytes
    ) external view returns (bytes32 publicValuesHash);
}
