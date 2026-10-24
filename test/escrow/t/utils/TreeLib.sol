// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @dev Solidity port of rootOf / inclusionProof from
///      services/gateway/src/receipt-merkle.js, for building fuzzed trees.
library TreeLib {
    function leaf(bytes memory data) internal pure returns (bytes32) {
        return sha256(abi.encodePacked(bytes1(0x00), data));
    }

    function node(bytes32 l, bytes32 r) internal pure returns (bytes32) {
        return sha256(abi.encodePacked(bytes1(0x01), l, r));
    }

    function leaves(uint256 n, uint256 seed) internal pure returns (bytes32[] memory out) {
        out = new bytes32[](n);
        for (uint256 i = 0; i < n; i++) out[i] = leaf(abi.encodePacked("task-", seed, "-", i));
    }

    function prefix(bytes32[] memory ls, uint256 n) internal pure returns (bytes32[] memory out) {
        out = new bytes32[](n);
        for (uint256 i = 0; i < n; i++) out[i] = ls[i];
    }

    function root(bytes32[] memory ls) internal pure returns (bytes32) {
        if (ls.length == 0) return sha256(abi.encodePacked(bytes1(0x00)));
        bytes32[] memory level = ls;
        while (level.length > 1) {
            bytes32[] memory next = new bytes32[]((level.length + 1) / 2);
            for (uint256 i = 0; i < level.length; i += 2) {
                next[i / 2] = i + 1 == level.length ? level[i] : node(level[i], level[i + 1]);
            }
            level = next;
        }
        return level[0];
    }

    function proof(bytes32[] memory ls, uint256 index) internal pure returns (bytes32[] memory) {
        bytes32[] memory tmp = new bytes32[](64);
        uint256 n = 0;
        uint256 idx = index;
        bytes32[] memory level = ls;
        while (level.length > 1) {
            uint256 sib = idx ^ 1;
            if (sib < level.length) tmp[n++] = level[sib];
            bytes32[] memory next = new bytes32[]((level.length + 1) / 2);
            for (uint256 i = 0; i < level.length; i += 2) {
                next[i / 2] = i + 1 == level.length ? level[i] : node(level[i], level[i + 1]);
            }
            idx /= 2;
            level = next;
        }
        bytes32[] memory out = new bytes32[](n);
        for (uint256 i = 0; i < n; i++) out[i] = tmp[i];
        return out;
    }
}
