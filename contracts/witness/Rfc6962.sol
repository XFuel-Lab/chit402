// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title Rfc6962
/// @notice RFC 9162 §2.1.4.2 consistency-proof check. Node hash is
///         SHA-256(0x01 || left || right), the SHA-256 precompile.
///         The proof omits the old root. When `oldSize` is a power of two
///         the verifier prepends `oldRoot` itself, matching the RFC.
library Rfc6962 {
    uint256 internal constant MAX_PROOF = 64;

    function verify(
        uint256 oldSize,
        uint256 newSize,
        bytes32 oldRoot,
        bytes32 newRoot,
        bytes32[] memory proof
    ) internal pure returns (bool) {
        if (oldSize == 0 || newSize < oldSize || oldRoot == bytes32(0) || newRoot == bytes32(0)) return false;
        if (oldSize == newSize) return proof.length == 0 && oldRoot == newRoot;
        if (proof.length == 0 || proof.length > MAX_PROOF) return false;

        bool pow2 = oldSize & (oldSize - 1) == 0;
        uint256 len = proof.length + (pow2 ? 1 : 0);
        bytes32[] memory path = new bytes32[](len);
        uint256 offset = 0;
        if (pow2) {
            path[0] = oldRoot;
            offset = 1;
        }
        for (uint256 i = 0; i < proof.length; i++) {
            path[offset + i] = proof[i];
        }

        uint256 fn = oldSize - 1;
        uint256 sn = newSize - 1;
        while ((fn & 1) == 1) {
            fn >>= 1;
            sn >>= 1;
        }

        bytes32 fr = path[0];
        bytes32 sr = path[0];
        for (uint256 i = 1; i < path.length; i++) {
            if (sn == 0) return false;
            bytes32 c = path[i];
            if ((fn & 1) == 1 || fn == sn) {
                fr = _node(c, fr);
                sr = _node(c, sr);
                if ((fn & 1) == 0) {
                    while ((fn & 1) == 0 && fn != 0) {
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
        return sn == 0 && fr == oldRoot && sr == newRoot;
    }

    function _node(bytes32 left, bytes32 right) private pure returns (bytes32) {
        return sha256(abi.encodePacked(bytes1(0x01), left, right));
    }
}
