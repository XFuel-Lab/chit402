// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @notice Broadcast guard. Same rule as the ChitIssuerRoot deploy script:
///         Base Sepolia (84532) only. Base mainnet (8453) is refused.
///         A mainnet deploy is a separate act, with Christopher's signature
///         through the Safe. This library does not broadcast.
library BroadcastChain {
    error RefusingBroadcast(uint256 chainId);

    uint256 internal constant BASE_SEPOLIA_CHAIN_ID = 84532;

    function assertBaseSepolia() internal view {
        if (block.chainid != BASE_SEPOLIA_CHAIN_ID) revert RefusingBroadcast(block.chainid);
    }
}
