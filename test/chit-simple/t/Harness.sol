// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Rfc9162} from "chit-simple/Rfc9162.sol";

/// @notice Exposes the consistency checker. The production contract keeps it internal.
contract Rfc9162Harness {
    function verify(uint64 m, uint64 n, bytes32 oldRoot, bytes32 newRoot, bytes32[] calldata proof)
        external
        pure
        returns (uint8)
    {
        return Rfc9162.verifyConsistency(m, n, oldRoot, newRoot, proof);
    }

    function emptyRoot() external pure returns (bytes32) {
        return Rfc9162.EMPTY_ROOT;
    }
}
