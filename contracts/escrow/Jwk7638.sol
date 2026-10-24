// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title Jwk7638
/// @notice RFC 7638 SHA-256 thumbprint of a P-256 public key, computed on
///         chain so a deploy can not pin an x/y pair that does not match the
///         published kid. The JSON members are in the RFC 7638 order:
///         {"crv":"P-256","kty":"EC","x":"<b64url(x)>","y":"<b64url(y)>"}
library Jwk7638 {
    bytes private constant B64URL = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";

    /// @notice Unpadded base64url of a 32-byte big-endian value (43 chars).
    function b64url32(bytes32 v) internal pure returns (bytes memory out) {
        out = new bytes(43);
        uint256 x = uint256(v);
        // 256 bits are read as 42 full 6-bit groups plus one group made of
        // the last 4 bits followed by two zero bits.
        for (uint256 i = 0; i < 42; i++) {
            uint256 shift = 256 - 6 * (i + 1);
            out[i] = B64URL[(x >> shift) & 63];
        }
        out[42] = B64URL[(x & 15) << 2];
    }

    function thumbprintP256(bytes32 x, bytes32 y) internal pure returns (bytes32) {
        return sha256(
            abi.encodePacked(
                '{"crv":"P-256","kty":"EC","x":"', b64url32(x), '","y":"', b64url32(y), '"}'
            )
        );
    }
}
