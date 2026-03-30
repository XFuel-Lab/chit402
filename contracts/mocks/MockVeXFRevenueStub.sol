// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/**
 * @dev Minimal veXF-shaped stub for legacy RevenueSplitter tests (non-zero address + distributeYield).
 */
contract MockVeXFRevenueStub {
    function distributeYield(address, uint256) external {}
}
