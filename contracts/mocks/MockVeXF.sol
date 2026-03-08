// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/**
 * @title MockVeXF
 * @dev Mock veXFGovernance with settable voting power for Jackpot tests.
 */
contract MockVeXF {
    mapping(address => uint256) public power;
    uint256 public total;

    function setVotingPower(address account, uint256 vp) external {
        total = total - power[account] + vp;
        power[account] = vp;
    }

    function getVotingPower(address account) external view returns (uint256) {
        return power[account];
    }

    function totalVotingPower() external view returns (uint256) {
        return total;
    }
}
