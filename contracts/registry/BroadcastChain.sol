// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @notice Broadcast guard for ChitIssuerRoot deployment scripts.
///         The registry contract itself is chain-agnostic: `rootHash` binds
///         `block.chainid`, and a later mainnet deploy is a separate act.
///         Every script in this repo must call `assertBaseSepolia` before
///         `vm.startBroadcast`. Chain id 8453 (Base mainnet) is refused.
library BroadcastChain {
    error RefusingBroadcast(uint256 chainId);

    uint256 internal constant BASE_SEPOLIA_CHAIN_ID = 84532;

    function assertBaseSepolia() internal view {
        if (block.chainid != BASE_SEPOLIA_CHAIN_ID) revert RefusingBroadcast(block.chainid);
    }
}
