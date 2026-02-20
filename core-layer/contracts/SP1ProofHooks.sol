// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "./interfaces/ISP1Verifier.sol";

/**
 * @title SP1ProofHooks
 * @author XFuel Protocol — Core Layer
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
     * @notice Verify and decode public values in a single call.
     * @return publicValuesHash keccak256 of the public values (for event emission).
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
     * @dev This helper ensures the encoding matches the SP1 program's expected format.
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
}
