// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "../legacy/Jackpot.sol";

/**
 * @title JackpotTestHarness
 * @dev Exposes internal fulfillRandomWords for testing VRF callbacks.
 */
contract JackpotTestHarness is Jackpot {
    constructor(
        address _admin, address _veXF, address _usdc,
        address _vrf, bytes32 _keyHash, uint64 _subId
    ) Jackpot(_admin, _veXF, _usdc, _vrf, _keyHash, _subId) {}

    function testFulfill(uint256 requestId, uint256[] memory randomWords) external {
        fulfillRandomWords(requestId, randomWords);
    }
}
