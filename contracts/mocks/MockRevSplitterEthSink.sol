// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/**
 * @dev Accepts native TFUEL fee forwards from SubVault (tests / dry runs).
 * Legacy RevenueSplitter has no plain receive(); vault seeding tests need a sink.
 */
contract MockRevSplitterEthSink {
    receive() external payable {}
}
