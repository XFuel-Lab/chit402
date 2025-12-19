// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/**
 * @title IFeeAdapter
 * @dev Interface for fee adapter to integrate with XFUELRouter
 * Allows router to query fee settings without direct dependency
 */
interface IFeeAdapter {
    /**
     * @dev Get the current fee multiplier (in basis points)
     * @return feeMultiplier Fee multiplier (0-10000, where 10000 = 100%)
     */
    function getFeeMultiplier() external view returns (uint256 feeMultiplier);

    /**
     * @dev Check if fees are enabled
     * @return enabled True if fees are enabled, false otherwise
     */
    function isFeesEnabled() external view returns (bool enabled);

    /**
     * @dev Get the effective fee for a given base fee
     * @param baseFee Base fee in basis points
     * @return effectiveFee Effective fee in basis points
     */
    function getEffectiveFee(uint256 baseFee) external view returns (uint256 effectiveFee);
}

