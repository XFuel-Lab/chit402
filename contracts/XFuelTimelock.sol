// SPDX-License-Identifier: MIT
pragma solidity ^0.8.22;

import "@openzeppelin/contracts/governance/TimelockController.sol";

/**
 * @title XFuelTimelock
 * @dev TimelockController wrapper for XFuel Protocol
 * 
 * Security Features:
 * - Delays execution of sensitive operations (e.g., 48 hours)
 * - Requires multi-sig approval via proposers/executors
 * - Protects against malicious or compromised admin actions
 * - Allows cancellation of pending operations
 * 
 * Roles:
 * - PROPOSER_ROLE: Can schedule operations (multi-sig wallets)
 * - EXECUTOR_ROLE: Can execute operations after delay (multi-sig wallets)
 * - CANCELLER_ROLE: Can cancel pending operations (emergency multi-sig)
 * - ADMIN_ROLE: Can manage roles (governance or multi-sig)
 */
contract XFuelTimelock is TimelockController {
    /**
     * @dev Constructor
     * @param minDelay Minimum delay in seconds (e.g., 48 hours = 172800)
     * @param proposers Array of addresses that can propose operations
     * @param executors Array of addresses that can execute operations (address(0) = anyone)
     * @param admin Address that can manage roles (should be governance or multi-sig)
     */
    constructor(
        uint256 minDelay,
        address[] memory proposers,
        address[] memory executors,
        address admin
    ) TimelockController(minDelay, proposers, executors, admin) {
        // Constructor automatically:
        // - Sets minDelay for all operations
        // - Grants PROPOSER_ROLE to proposers
        // - Grants EXECUTOR_ROLE to executors
        // - Grants ADMIN_ROLE to admin
        // - Grants CANCELLER_ROLE to admin
    }

    /**
     * @dev Get minimum delay
     */
    function getMinDelay() external view returns (uint256) {
        return super.getMinDelay();
    }
}

