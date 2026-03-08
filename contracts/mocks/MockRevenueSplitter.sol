// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/**
 * @title MockRevenueSplitter
 * @notice Mock contract for testing that can receive ETH/TFUEL
 */
contract MockRevenueSplitter {
    event FeeReceived(address indexed sender, uint256 amount);

    receive() external payable {
        emit FeeReceived(msg.sender, msg.value);
    }

    function getBalance() external view returns (uint256) {
        return address(this).balance;
    }
}

