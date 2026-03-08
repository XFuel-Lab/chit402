// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/**
 * @title MockAggregator
 * @dev Minimal Chainlink AggregatorV3-compatible mock for Phase 6 oracle tests.
 *      Supports price updates, staleness simulation, and negative price injection.
 */
contract MockAggregator {
    int256 public price;
    uint256 public updatedAt;
    uint8 public decimals_;
    string public description_;

    constructor(uint8 _decimals, int256 _initialPrice) {
        decimals_ = _decimals;
        price = _initialPrice;
        updatedAt = block.timestamp;
    }

    function setPrice(int256 _p) external {
        price = _p;
        updatedAt = block.timestamp;
    }

    function setUpdatedAt(uint256 _ts) external {
        updatedAt = _ts;
    }

    function decimals() external view returns (uint8) {
        return decimals_;
    }

    function description() external view returns (string memory) {
        return description_;
    }

    function latestRoundData()
        external
        view
        returns (uint80, int256, uint256, uint256, uint80)
    {
        return (1, price, block.timestamp, updatedAt, 1);
    }
}
