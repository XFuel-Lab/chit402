// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title EscrowMerkle
/// @notice Inclusion check for the Chit402 receipt log, ported line for line
///         from `verifyInclusion` in services/gateway/src/receipt-merkle.js
///         (the RFC 9162 inclusion proof loop). Leaf hashes are taken as given
///         (SHA-256(0x00 || task_id|row_hash) is computed off chain), and an
///         interior node is SHA-256(0x01 || left || right).
library EscrowMerkle {
    /// @notice Longest proof accepted. A tree of 2^64 leaves needs 64 steps.
    uint256 internal constant MAX_PROOF_STEPS = 64;

    function nodeHash(bytes32 left, bytes32 right) internal pure returns (bytes32) {
        return sha256(abi.encodePacked(bytes1(0x01), left, right));
    }

    /// @notice True only when `proof` places `leaf` at `index` in a tree of
    ///         `size` leaves with root `root`. Direction comes from index and
    ///         size only, and the proof must be exactly as long as that pair
    ///         requires.
    function verifyInclusion(
        bytes32 leaf,
        uint64 index,
        uint64 size,
        bytes32 root,
        bytes32[] memory proof
    ) internal pure returns (bool) {
        if (index >= size) return false;
        if (proof.length > MAX_PROOF_STEPS) return false;
        uint256 fn = index;
        uint256 sn = uint256(size) - 1;
        bytes32 h = leaf;
        for (uint256 i = 0; i < proof.length; i++) {
            if (sn == 0) return false;
            bytes32 sib = proof[i];
            bool siblingOnLeft = (fn & 1) == 1 || fn == sn;
            if (siblingOnLeft) {
                h = nodeHash(sib, h);
                if ((fn & 1) == 0) {
                    while ((fn & 1) == 0 && fn != 0) {
                        fn >>= 1;
                        sn >>= 1;
                    }
                }
            } else {
                h = nodeHash(h, sib);
            }
            fn >>= 1;
            sn >>= 1;
        }
        return sn == 0 && h == root;
    }
}
