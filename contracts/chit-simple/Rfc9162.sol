// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

/// @title Rfc9162
/// @notice RFC 9162 §2.1.4.2 consistency, plus the v13 genesis rule.
///         Leaf and node hashes are SHA-256. The empty root is SHA-256("").
///         `size` is a uint64. Shifts are exact on that width. The off-chain
///         2^53−1 cap is not applied here.
library Rfc9162 {
    bytes32 internal constant EMPTY_ROOT = hex"e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855";

    uint8 internal constant OK = 0;
    uint8 internal constant M_GT_N = 1;
    uint8 internal constant PROOF_NOT_EMPTY = 2;
    uint8 internal constant ROOT_MISMATCH = 3;
    uint8 internal constant PROOF_TOO_SHORT = 4;
    uint8 internal constant PROOF_TOO_LONG = 5;

    function verifyConsistency(
        uint64 m,
        uint64 n,
        bytes32 oldRoot,
        bytes32 newRoot,
        bytes32[] calldata proof
    ) internal pure returns (uint8) {
        if (m > n) return M_GT_N;
        if (m == 0) {
            if (proof.length != 0) return PROOF_NOT_EMPTY;
            if (oldRoot != EMPTY_ROOT) return ROOT_MISMATCH;
            if (n == 0 && newRoot != EMPTY_ROOT) return ROOT_MISMATCH;
            return OK;
        }
        if (m == n) {
            if (proof.length != 0) return PROOF_NOT_EMPTY;
            if (oldRoot != newRoot) return ROOT_MISMATCH;
            return OK;
        }
        if (proof.length == 0) return PROOF_TOO_SHORT;

        bool prepend = _pow2(m);
        uint256 len = proof.length;
        if (prepend) len += 1;
        bytes32[] memory nodes = new bytes32[](len);
        uint256 base = 0;
        if (prepend) {
            nodes[0] = oldRoot;
            base = 1;
        }
        for (uint256 i = 0; i < proof.length; i++) {
            nodes[base + i] = proof[i];
        }

        uint64 fn = m - 1;
        uint64 sn = n - 1;
        while (_lsb(fn)) {
            fn >>= 1;
            sn >>= 1;
        }

        bytes32 fr = nodes[0];
        bytes32 sr = nodes[0];
        for (uint256 i = 1; i < nodes.length; i++) {
            if (sn == 0) return PROOF_TOO_LONG;
            bytes32 c = nodes[i];
            if (_lsb(fn) || fn == sn) {
                fr = _node(c, fr);
                sr = _node(c, sr);
                if (!_lsb(fn)) {
                    while (!_lsb(fn) && fn != 0) {
                        fn >>= 1;
                        sn >>= 1;
                    }
                }
            } else {
                sr = _node(sr, c);
            }
            fn >>= 1;
            sn >>= 1;
        }
        if (sn != 0) return PROOF_TOO_SHORT;
        if (fr != oldRoot) return ROOT_MISMATCH;
        if (sr != newRoot) return ROOT_MISMATCH;
        return OK;
    }

    function _node(bytes32 left, bytes32 right) private pure returns (bytes32) {
        return sha256(abi.encodePacked(bytes1(0x01), left, right));
    }

    function _pow2(uint64 m) private pure returns (bool) {
        return m != 0 && (m & (m - 1)) == 0;
    }

    function _lsb(uint64 x) private pure returns (bool) {
        return (x & 1) == 1;
    }
}
