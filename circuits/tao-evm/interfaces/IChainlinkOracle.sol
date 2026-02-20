// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/**
 * @title IChainlinkOracle
 * @notice Minimal Chainlink AggregatorV3 interface for pricing fallback.
 *
 * Used by TAOCircuit for API pricing when on-chain AMM liquidity is thin.
 * Chainlink feeds are the standard fallback on EVM chains; on Bittensor EVM (964)
 * where Chainlink may not be deployed, the circuit falls back to admin-set prices.
 */
interface IChainlinkOracle {
    function latestRoundData() external view returns (
        uint80 roundId,
        int256 answer,
        uint256 startedAt,
        uint256 updatedAt,
        uint80 answeredInRound
    );

    function decimals() external view returns (uint8);
}
