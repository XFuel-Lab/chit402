// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/**
 * @title MockXFUELRouter
 * @dev Mock router contract for testing XFUEL swap and stake functionality
 */
contract MockXFUELRouter {
    // Event emitted when a swap and stake operation completes
    event SwapAndStake(
        address indexed user,
        uint256 tfuelAmount,
        uint256 stakedAmount,
        string stakeTarget
    );

    // Event emitted when swap fails
    event SwapFailed(address indexed user, uint256 tfuelAmount, string reason);

    /**
     * @dev Swaps TFUEL and stakes the result
     * @param tfuelAmount Amount of TFUEL to swap (in wei)
     * @param stakeTarget Target staking token (e.g., "stkXPRT", "stkATOM", "pSTAKE BTC")
     * @return stakedAmount Amount of tokens staked
     */
    function swapAndStake(
        uint256 tfuelAmount,
        string memory stakeTarget
    ) external returns (uint256 stakedAmount) {
        require(tfuelAmount > 0, "Amount must be greater than 0");
        require(bytes(stakeTarget).length > 0, "Stake target cannot be empty");

        // Mock swap calculation: 1 TFUEL = 0.95 staked tokens (5% fee)
        // In a real implementation, this would call actual swap contracts
        stakedAmount = (tfuelAmount * 95) / 100;

        // Emit the swap and stake event
        emit SwapAndStake(msg.sender, tfuelAmount, stakedAmount, stakeTarget);

        return stakedAmount;
    }

    /**
     * @dev Fails the swap (for testing error cases)
     */
    function swapAndStakeFail(
        uint256 tfuelAmount,
        string memory stakeTarget
    ) external {
        emit SwapFailed(msg.sender, tfuelAmount, "Mock failure for testing");
        revert("Swap failed");
    }
}

