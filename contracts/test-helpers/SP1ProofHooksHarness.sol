// SPDX-License-Identifier: MIT
pragma solidity ^0.8.22;

import "../core/SP1ProofHooks.sol";

/**
 * @title SP1ProofHooksHarness
 * @dev Thin wrapper that exposes SP1ProofHooks library functions for testing.
 */
contract SP1ProofHooksHarness {
    function computeNullifier(
        bytes32 taskId,
        address sender,
        uint64 nonce,
        uint256 blockNumber
    ) external pure returns (bytes32) {
        return SP1ProofHooks.computeNullifier(taskId, sender, nonce, blockNumber);
    }

    function computeFeeCommitment(
        uint256 feeAmount,
        bytes32 taskId,
        uint8 chainDiscriminant
    ) external pure returns (bytes32) {
        return SP1ProofHooks.computeFeeCommitment(feeAmount, taskId, chainDiscriminant);
    }

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
    ) external pure returns (bytes memory) {
        return SP1ProofHooks.encodeAITaskPublicValues(
            taskType, sourceChain, destChain, taskIdHash, senderHash,
            netAmount, feeAmount, feeBps, outputHash, blockHeight, timestamp, nonce
        );
    }

    function computePaymentCommitment(
        bytes32 paymentRefHash,
        bytes32 taskIdHash,
        uint8 paymentRail,
        uint256 amount
    ) external pure returns (bytes32) {
        return SP1ProofHooks.computePaymentCommitment(paymentRefHash, taskIdHash, paymentRail, amount);
    }

    function encodeAITaskPublicValuesV2(
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
        uint64 nonce,
        bytes32 paymentCommitment
    ) external pure returns (bytes memory) {
        return SP1ProofHooks.encodeAITaskPublicValuesV2(
            taskType, sourceChain, destChain, taskIdHash, senderHash,
            netAmount, feeAmount, feeBps, outputHash, blockHeight, timestamp, nonce,
            paymentCommitment
        );
    }

    function computeComposedCallNullifier(
        bytes32 taskId,
        bytes32 stateRoot,
        uint256 sourceBlock,
        address sender,
        uint64 nonce
    ) external pure returns (bytes32) {
        return SP1ProofHooks.computeComposedCallNullifier(taskId, stateRoot, sourceBlock, sender, nonce);
    }

    function encodeCrossChainPayload(
        bytes32 circuitId,
        bytes32 nullifier,
        bytes32 publicValuesHash,
        address verifier,
        uint256 timestamp
    ) external pure returns (bytes memory) {
        return SP1ProofHooks.encodeCrossChainPayload(circuitId, nullifier, publicValuesHash, verifier, timestamp);
    }

    function encodeComposedCallPublicValues(
        bytes32 stateRoot,
        uint256 sourceBlock,
        address targetContract,
        bytes32 callResultHash,
        bytes32 taskIdHash,
        uint64 timestamp
    ) external pure returns (bytes memory) {
        return SP1ProofHooks.encodeComposedCallPublicValues(
            stateRoot, sourceBlock, targetContract, callResultHash, taskIdHash, timestamp
        );
    }

    function verifySP1(
        address gateway,
        bytes32 programVKey,
        bytes calldata publicValues,
        bytes calldata proofBytes
    ) external view {
        SP1ProofHooks.verifySP1(gateway, programVKey, publicValues, proofBytes);
    }

    function verifySP1WithHash(
        address gateway,
        bytes32 programVKey,
        bytes calldata publicValues,
        bytes calldata proofBytes
    ) external view returns (bytes32) {
        return SP1ProofHooks.verifySP1WithHash(gateway, programVKey, publicValues, proofBytes);
    }
}
