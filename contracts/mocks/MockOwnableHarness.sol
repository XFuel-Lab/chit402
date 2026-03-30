// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "../legacy/Ownable.sol";

/// @notice Minimal Ownable surface for tests (replaces removed TipPool).
contract MockOwnableHarness is Ownable {
    constructor() Ownable(msg.sender) {}
}
