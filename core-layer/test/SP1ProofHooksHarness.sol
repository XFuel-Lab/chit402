// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "../contracts/SP1ProofHooks.sol";

/**
 * @title SP1ProofHooksHarness
 * @dev Thin wrapper that exposes SP1ProofHooks library functions for testing.
 */
contract SP1ProofHooksHarness {
    function computeNullifier(
        bytes32 proofHash,
        uint256 chainId,
        uint256 nonce
    ) external pure returns (bytes32) {
        return SP1ProofHooks.computeNullifier(proofHash, chainId, nonce);
    }

    function computeFeeCommitment(
        address collector,
        uint256 feeBps,
        uint256 amount
    ) external pure returns (bytes32) {
        return SP1ProofHooks.computeFeeCommitment(collector, feeBps, amount);
    }

    function encodeAITaskPublicValues(
        address requester,
        bytes32 taskHash,
        uint256 feeBps,
        uint256 nonce,
        uint256 chainId
    ) external pure returns (bytes memory) {
        return SP1ProofHooks.encodeAITaskPublicValues(requester, taskHash, feeBps, nonce, chainId);
    }
}
