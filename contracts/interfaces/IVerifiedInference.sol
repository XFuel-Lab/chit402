// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/**
 * @title IVerifiedInference
 * @notice Mechanism-agnostic seam for XFuel Tier-3 (Verified Inference) proof checking.
 * @dev Phase 0 of docs/TIER3_VERIFIABLE_INFERENCE_BUILD_SPEC.md. Generalizes the
 *      single-mechanism IZKVerifierZkGPT so a circuit can route a proof to the right
 *      Tier-3 mechanism (TEE attestation, ZK spot-check, full zkML) without changing its
 *      call site. `IZKVerifierZkGPT` remains for backward compatibility; new code should
 *      target this interface.
 *
 * Tier-3 mechanisms (see docs/VERIFIED_INFERENCE_TIERS.md when authored):
 *   - T3A_TEE        : TEE attestation quote (fast path; e.g. NVIDIA H100 confidential computing)
 *   - T3B_ZK_SPOTCHK : stochastic ZK spot-check (self-owned prover; random layers/tokens/requests)
 *   - T3C_ZK_FULL    : full zkML proof (premium/high-assurance; small–mid models)
 *
 * The `verify()` signature is a superset of `IZKVerifierZkGPT.verifyProof()` plus a
 * `kind` selector and a `commitmentBundle` that binds the proof to XFuel's task context
 * (model commitment + input/output hash + payment ref — see PoMA/PBR in the build spec).
 */
interface IVerifiedInference {
    /// @notice Tier-3 verification mechanisms.
    enum ProofKind {
        T3A_TEE,        // 0: TEE attestation quote
        T3B_ZK_SPOTCHK, // 1: stochastic ZK spot-check
        T3C_ZK_FULL     // 2: full zkML proof
    }

    /// @notice Emitted on successful verification.
    event InferenceVerified(
        bytes32 indexed circuitId,
        bytes32 indexed nullifier,
        ProofKind kind,
        bytes32 commitmentHash,
        uint256 timestamp
    );

    /**
     * @notice Verify a Tier-3 inference proof/attestation; replay protection via nullifier.
     * @param kind             Which Tier-3 mechanism produced `proof` (selects the verifier path).
     * @param circuitId        Circuit identifier (e.g. ZKML_CIRCUIT).
     * @param commitmentBundle Task-binding public values: model commitment + input/output hash
     *                         + payment ref (PoMA/PBR). Opaque, ABI-encoded; layout per spec.
     * @param proof            Proof or attestation bytes for the given `kind`.
     * @param nullifier        Unique per proof; must not have been used before.
     * @return success         True if the proof/attestation is valid.
     */
    function verify(
        ProofKind kind,
        bytes32 circuitId,
        bytes calldata commitmentBundle,
        bytes calldata proof,
        bytes32 nullifier
    ) external returns (bool success);

    /// @notice Whether a given Tier-3 mechanism is currently supported by this verifier.
    function supportsKind(ProofKind kind) external view returns (bool);

    /// @notice Check whether a nullifier has already been used.
    function isNullifierUsed(bytes32 nullifier) external view returns (bool);
}
