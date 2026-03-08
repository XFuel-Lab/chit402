// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "../legacy/IChainlinkAggregator.sol";

/**
 * @title MockChainlinkAggregator
 * @dev Mock Chainlink oracle for testing purposes
 */
contract MockChainlinkAggregator is IChainlinkAggregator {
    uint8 private _decimals;
    int256 private _answer;
    uint80 private _roundId;
    uint256 private _updatedAt;
    
    constructor(uint8 decimalsValue, int256 initialAnswer) {
        _decimals = decimalsValue;
        _answer = initialAnswer;
        _roundId = 1;
        _updatedAt = block.timestamp;
    }
    
    function decimals() external view override returns (uint8) {
        return _decimals;
    }
    
    function description() external pure override returns (string memory) {
        return "Mock Chainlink Aggregator for Testing";
    }
    
    function version() external pure override returns (uint256) {
        return 1;
    }
    
    function getRoundData(uint80 roundId)
        external
        view
        override
        returns (
            uint80,
            int256,
            uint256,
            uint256,
            uint80
        )
    {
        require(roundId <= _roundId, "Round not complete");
        return (roundId, _answer, block.timestamp, _updatedAt, roundId);
    }
    
    function latestRoundData()
        external
        view
        override
        returns (
            uint80 roundId,
            int256 answer,
            uint256 startedAt,
            uint256 updatedAt,
            uint80 answeredInRound
        )
    {
        return (_roundId, _answer, block.timestamp, _updatedAt, _roundId);
    }
    
    // Helper functions for testing
    
    /**
     * @dev Update the answer (for simulating oracle updates)
     * @param newAnswer New answer value
     */
    function updateAnswer(int256 newAnswer) external {
        _answer = newAnswer;
        _roundId++;
        _updatedAt = block.timestamp;
    }
    
    /**
     * @dev Set updated timestamp (for testing staleness)
     * @param timestamp New timestamp
     */
    function setUpdatedAt(uint256 timestamp) external {
        _updatedAt = timestamp;
    }
    
    /**
     * @dev Get current answer
     * @return Current answer value
     */
    function getAnswer() external view returns (int256) {
        return _answer;
    }
}

