// SPDX-License-Identifier: MIT
pragma solidity ^0.8.22;

import "../interfaces/ISP1Verifier.sol";

contract MockSP1Gateway is ISP1Verifier {
    bool public shouldRevert;

    function setRevert(bool _shouldRevert) external {
        shouldRevert = _shouldRevert;
    }

    function verifyProof(bytes32, bytes calldata, bytes calldata) external view override {
        if (shouldRevert) revert("MockSP1Gateway: invalid proof");
    }
}
