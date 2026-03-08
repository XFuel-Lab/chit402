// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "../interfaces/IBittensorStaking.sol";

/**
 * @title MockStakingPrecompile
 * @dev Test-only mock for Bittensor's staking precompile (0x805).
 *      Simulates stake queries for dTAO-gated proof verification.
 */
contract MockStakingPrecompile is IBittensorStaking {
    mapping(bytes32 => mapping(bytes32 => mapping(uint16 => uint256))) public stakes;

    function setStake(
        bytes32 hotkey,
        bytes32 coldkey,
        uint16 netuid,
        uint256 amount
    ) external {
        stakes[hotkey][coldkey][netuid] = amount;
    }

    function addStake(bytes32 hotkey, uint16 netuid) external payable {
        bytes32 coldkey = bytes32(uint256(uint160(msg.sender)));
        stakes[hotkey][coldkey][netuid] += msg.value;
    }

    function removeStake(bytes32 hotkey, uint256 amount, uint16 netuid) external {
        bytes32 coldkey = bytes32(uint256(uint160(msg.sender)));
        require(stakes[hotkey][coldkey][netuid] >= amount, "InsufficientStake");
        stakes[hotkey][coldkey][netuid] -= amount;
    }

    function getStake(
        bytes32 hotkey,
        bytes32 coldkey,
        uint16 netuid
    ) external view returns (uint256) {
        return stakes[hotkey][coldkey][netuid];
    }
}
