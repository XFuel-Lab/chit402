// SPDX-License-Identifier: MIT
pragma solidity ^0.8.22;

/**
 * @title IBittensorStaking
 * @notice Interface for Bittensor's EVM Staking Precompile V2.
 *
 * Precompile address: 0x0000000000000000000000000000000000000805
 * Chain: Bittensor EVM (Chain ID 964)
 *
 * Per Bittensor EVM docs (2026): V2 accepts staking amounts as transaction
 * parameters. Replaces V1 (0x801) which used msg.value. Provides read access
 * to dTAO stake state for subnet-level verification.
 */
interface IBittensorStaking {
    /// @notice Add stake to a hotkey on a specific subnet.
    function addStake(bytes32 hotkey, uint16 netuid) external payable;

    /// @notice Remove stake from a hotkey on a specific subnet.
    function removeStake(bytes32 hotkey, uint256 amount, uint16 netuid) external;

    /// @notice Query stake for a hotkey/coldkey pair on a subnet.
    function getStake(
        bytes32 hotkey,
        bytes32 coldkey,
        uint16 netuid
    ) external view returns (uint256);
}
