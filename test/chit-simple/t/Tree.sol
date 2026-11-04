// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

/// @notice RFC 9162 tree builder for tests. Leaves are raw data, not hashes.
library Tree {
    function mth(bytes32[] memory leaves) internal pure returns (bytes32) {
        return _mth(leaves, 0, leaves.length);
    }

    function consistency(bytes32[] memory leaves, uint256 m, uint256 n) internal pure returns (bytes32[] memory) {
        if (m == 0 || m == n) return new bytes32[](0);
        bytes32[] memory buf = new bytes32[](64);
        uint256 w = _sub(leaves, 0, n, m, true, buf, 0);
        bytes32[] memory proof = new bytes32[](w);
        for (uint256 i = 0; i < w; i++) proof[i] = buf[i];
        return proof;
    }

    function _mth(bytes32[] memory leaves, uint256 start, uint256 end) private pure returns (bytes32) {
        uint256 n = end - start;
        if (n == 0) return sha256("");
        if (n == 1) return sha256(abi.encodePacked(bytes1(0x00), leaves[start]));
        uint256 k = 1;
        while (k * 2 < n) k *= 2;
        return sha256(abi.encodePacked(bytes1(0x01), _mth(leaves, start, start + k), _mth(leaves, start + k, end)));
    }

    function _sub(
        bytes32[] memory leaves,
        uint256 start,
        uint256 end,
        uint256 m,
        bool known,
        bytes32[] memory buf,
        uint256 w
    ) private pure returns (uint256) {
        uint256 size = end - start;
        if (m == size) {
            if (known) return w;
            buf[w] = _mth(leaves, start, end);
            return w + 1;
        }
        uint256 k = 1;
        while (k * 2 < size) k *= 2;
        if (m <= k) {
            w = _sub(leaves, start, start + k, m, known, buf, w);
            buf[w] = _mth(leaves, start + k, end);
            return w + 1;
        }
        w = _sub(leaves, start + k, end, m - k, false, buf, w);
        buf[w] = _mth(leaves, start, start + k);
        return w + 1;
    }
}
