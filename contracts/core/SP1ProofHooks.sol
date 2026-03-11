// SPDX-License-Identifier: MIT
pragma solidity ^0.8.22;

import "../interfaces/ISP1Verifier.sol";

/**
 * @title SP1ProofHooks
 * @author XFuel Protocol — Core Layer
 * @custom:security-contact security@xfuel.app
 * @notice Library for integrating SP1 proof verification into any circuit contract.
 *
 * Research ties (SP1 docs v5.x, Feb 2026):
 *   - RISC-V program compiled with sp1-zkvm crate.
 *   - Host generates proof via sp1-sdk: client.prove(&pk, &stdin).groth16().run()
 *   - On-chain verification via ISP1Verifier.verifyProof(programVKey, publicValues, proofBytes)
 *   - Groth16: ~260 bytes, ~270k gas. PLONK: ~868 bytes, ~300k gas.
 *   - Gateway auto-routes to correct verifier version.
 *
 * Usage in circuit contracts:
 *   contract MyCircuit {
 *       using SP1ProofHooks for address;
 *
 *       address public sp1Gateway;
 *       bytes32 public programVKey;
 *
 *       function settle(bytes calldata proof, bytes calldata publicValues) external {
 *           sp1Gateway.verifySP1(programVKey, publicValues, proof);
 *           // proof is valid — proceed with settlement
 *       }
 *   }
 */
library SP1ProofHooks {
    // ─── Errors ───────────────────────────────────────────────────────────────
    error SP1VerificationFailed();
    error SP1GatewayCallFailed();

    /**
     * @notice Verify an SP1 proof against the gateway.
     * @param gateway The ISP1Verifier gateway address.
     * @param programVKey The verification key for the RISC-V program.
     * @param publicValues ABI-encoded public values committed by the program.
     * @param proofBytes The Groth16 or PLONK proof bytes.
     * @dev Reverts with SP1VerificationFailed if the proof is invalid.
     *      If gateway is address(0), acts as mock mode (always passes).
     */
    function verifySP1(
        address gateway,
        bytes32 programVKey,
        bytes calldata publicValues,
        bytes calldata proofBytes
    ) internal view {
        if (gateway == address(0)) return; // Mock mode

        try ISP1Verifier(gateway).verifyProof(programVKey, publicValues, proofBytes) {
            // Proof valid
        } catch {
            revert SP1VerificationFailed();
        }
    }

    /**
     * @notice Verify an SP1 proof and return the public values hash.
     * @param gateway The ISP1Verifier gateway address.
     * @param programVKey The verification key for the RISC-V program.
     * @param publicValues ABI-encoded public values.
     * @param proofBytes The Groth16 or PLONK proof bytes.
     * @return publicValuesHash keccak256 of the public values (for event emission).
     * @dev Reverts with SP1VerificationFailed if invalid. Mock mode if gateway is address(0).
     */
    function verifySP1WithHash(
        address gateway,
        bytes32 programVKey,
        bytes calldata publicValues,
        bytes calldata proofBytes
    ) internal view returns (bytes32 publicValuesHash) {
        verifySP1(gateway, programVKey, publicValues, proofBytes);
        return keccak256(publicValues);
    }

    /**
     * @notice Compute a nullifier from proof parameters (replay protection).
     * @param taskId Unique task or message identifier.
     * @param sender Sender address.
     * @param nonce Per-sender nonce.
     * @param blockNumber Source chain block number.
     * @return nullifier The computed nullifier hash.
     */
    function computeNullifier(
        bytes32 taskId,
        address sender,
        uint64 nonce,
        uint256 blockNumber
    ) internal pure returns (bytes32) {
        return keccak256(abi.encodePacked(taskId, sender, nonce, blockNumber));
    }

    /**
     * @notice Compute a fee commitment hash (mirrors sp1-prover fee_collector_commitment).
     * @param feeAmount Fee amount in wei.
     * @param taskId Task identifier.
     * @param chainDiscriminant Chain enum value (0=Theta, 1=Osmosis, etc.).
     * @return Commitment hash for fee verification in proofs.
     * @dev Used to bind fee to task and chain in SP1 programs.
     */
    function computeFeeCommitment(
        uint256 feeAmount,
        bytes32 taskId,
        uint8 chainDiscriminant
    ) internal pure returns (bytes32) {
        return keccak256(abi.encodePacked(feeAmount, taskId, chainDiscriminant));
    }

    /**
     * @notice Encode public values for an AI task proof (matches sp1-prover AITaskPublicInputs).
     * @param taskType Task type enum.
     * @param sourceChain Source chain discriminant.
     * @param destChain Destination chain discriminant.
     * @param taskIdHash Hash of task ID.
     * @param senderHash Hash of sender address.
     * @param netAmount Net amount after fees.
     * @param feeAmount Fee amount.
     * @param feeBps Fee in basis points.
     * @param outputHash Hash of AI output.
     * @param blockHeight Block height at proof time.
     * @param timestamp Timestamp.
     * @param nonce Sender nonce.
     * @return ABI-encoded public values for SP1 verification.
     * @dev Matches the SP1 program's expected format.
     */
    function encodeAITaskPublicValues(
        uint8 taskType,
        uint8 sourceChain,
        uint8 destChain,
        bytes32 taskIdHash,
        bytes32 senderHash,
        uint256 netAmount,
        uint256 feeAmount,
        uint16 feeBps,
        bytes32 outputHash,
        uint64 blockHeight,
        uint64 timestamp,
        uint64 nonce
    ) internal pure returns (bytes memory) {
        return abi.encode(
            taskType, sourceChain, destChain, taskIdHash, senderHash,
            netAmount, feeAmount, feeBps, outputHash, blockHeight, timestamp, nonce
        );
    }

    // ─── SP1-CC Composed Call Helpers ─────────────────────────────────────────

    /**
     * @notice Compute a nullifier for an SP1-CC composed call proof.
     * @param taskId Unique task identifier.
     * @param stateRoot State root the proof is bound to.
     * @param sourceBlock Block number for state read.
     * @param sender Sender address.
     * @param nonce Per-sender nonce.
     * @return nullifier Replay-protection hash bound to state snapshot.
     * @dev Binds nullifier to state root and source block to prevent replay.
     */
    function computeComposedCallNullifier(
        bytes32 taskId,
        bytes32 stateRoot,
        uint256 sourceBlock,
        address sender,
        uint64 nonce
    ) internal pure returns (bytes32) {
        return keccak256(abi.encodePacked(taskId, stateRoot, sourceBlock, sender, nonce));
    }

    /**
     * @notice Encode public values for an SP1-CC composed call proof.
     * @param stateRoot State root from source block.
     * @param sourceBlock Block number for state read.
     * @param targetContract Contract whose state was read.
     * @param callResultHash Hash of offchain call result.
     * @param taskIdHash Hash of task ID.
     * @param timestamp Proof timestamp.
     * @return ABI-encoded public values for SP1-CC verification.
     * @dev Matches SP1-CC format: Read (state) + Compute (result) + Verify.
     */
    function encodeComposedCallPublicValues(
        bytes32 stateRoot,
        uint256 sourceBlock,
        address targetContract,
        bytes32 callResultHash,
        bytes32 taskIdHash,
        uint64 timestamp
    ) internal pure returns (bytes memory) {
        return abi.encode(
            stateRoot, sourceBlock, targetContract,
            callResultHash, taskIdHash, timestamp
        );
    }

    /**
     * @notice Encode a cross-chain proof relay payload for Hyperlane dispatch.
     * @param circuitId Circuit that generated the proof.
     * @param nullifier Replay protection nullifier.
     * @param publicValuesHash keccak256 of public values.
     * @param verifier Address that verified the proof.
     * @param timestamp Verification timestamp.
     * @return ABI-encoded payload (160 bytes) for mailbox.dispatch.
     * @dev Used by circuits to relay verified proofs to remote chains.
     */
    function encodeCrossChainPayload(
        bytes32 circuitId,
        bytes32 nullifier,
        bytes32 publicValuesHash,
        address verifier,
        uint256 timestamp
    ) internal pure returns (bytes memory) {
        return abi.encode(circuitId, nullifier, publicValuesHash, verifier, timestamp);
    }
}
