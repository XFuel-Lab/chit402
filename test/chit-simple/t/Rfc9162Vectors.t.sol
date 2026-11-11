// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Test} from "./utils/Test.sol";
import {ChitAnchor} from "chit-simple/ChitAnchor.sol";
import {Rfc9162Harness} from "./Harness.sol";

/// @notice Runs the P0-0 consistency vectors, read from rfc9162.json and packed
///         by pack-consistency.mjs. That JSON file is not modified.
contract Rfc9162VectorTest is Test {
    uint256 internal constant HOUR = 3600;
    uint8 internal constant ROOT_MISMATCH = 3;

    Rfc9162Harness internal harness;
    bytes internal blob;

    function setUp() public {
        harness = new Rfc9162Harness();
        blob = _load();
    }

    function test_p0_0_consistency_vectors() public view {
        bytes memory data = blob;
        uint256 o = 0;
        uint256 magic = _uint(data, o, 4);
        o += 4;
        uint256 positives = _uint(data, o, 4);
        o += 4;
        uint256 negatives = _uint(data, o, 4);
        o += 4;
        assertEq(magic, 0x91629162, "magic");
        assertEq(positives, 2145, "positives");
        assertGt(negatives, 8, "negatives");
        o = _check(data, o, positives, true);
        o = _check(data, o, negatives, false);
        assertEq(o, data.length, "trailing");
    }

    function test_genesis_rejects_a_non_empty_old_root() public view {
        bytes32[] memory empty = new bytes32[](0);
        uint8 got = harness.verify(0, 1, bytes32(uint256(1)), bytes32(uint256(2)), empty);
        assertEq(got, ROOT_MISMATCH, "old root");
    }

    function test_equal_size_rejects_unequal_roots() public view {
        bytes32[] memory empty = new bytes32[](0);
        uint8 got = harness.verify(4, 4, bytes32(uint256(1)), bytes32(uint256(2)), empty);
        assertEq(got, ROOT_MISMATCH, "m == n");
    }

    function test_vector_chain_anchors_on_the_contract() public {
        vm.chainId(84532);
        address cp = address(0xC0FFEE);
        ChitAnchor anchor = new ChitAnchor(cp);
        bytes memory data = blob;
        bytes32 dom = anchor.domain();
        bytes32 prev = harness.emptyRoot();
        for (uint64 n = 1; n <= 8; n++) {
            (bytes32 oldRoot, bytes32 newRoot, bytes32[] memory proof) = _pair(data, n - 1, n);
            assertEq(oldRoot, prev, "chain root");
            uint256 hourStart = uint256(n) * HOUR;
            vm.warp(hourStart + HOUR);
            vm.prank(cp);
            anchor.anchor(dom, n, uint64(hourStart), n, newRoot, bytes32(uint256(n)), proof);
            prev = newRoot;
        }
        (uint64 epoch, uint64 hour, uint64 size, bytes32 root,) = anchor.latest();
        assertEq(epoch, 8, "epoch");
        assertEq(hour, 8 * HOUR, "hour");
        assertEq(size, 8, "size");
        assertEq(root, prev, "root");
    }

    function _check(bytes memory data, uint256 o, uint256 count, bool expectOk) private view returns (uint256) {
        for (uint256 i = 0; i < count; i++) {
            uint8 okFlag = uint8(data[o]);
            o += 1;
            uint8 reason = uint8(data[o]);
            o += 1;
            uint64 m = uint64(_uint(data, o, 8));
            o += 8;
            uint64 n = uint64(_uint(data, o, 8));
            o += 8;
            bytes32 oldRoot = _b32(data, o);
            o += 32;
            bytes32 newRoot = _b32(data, o);
            o += 32;
            uint256 proofLen = _uint(data, o, 2);
            o += 2;
            bytes32[] memory proof = new bytes32[](proofLen);
            for (uint256 p = 0; p < proofLen; p++) {
                proof[p] = _b32(data, o);
                o += 32;
            }
            uint8 got = harness.verify(m, n, oldRoot, newRoot, proof);
            if (expectOk) {
                assertEq(okFlag, 1, "flag");
                assertEq(got, 0, "accept");
            } else {
                assertEq(okFlag, 0, "flag");
                assertEq(got, reason, "reason");
            }
        }
        return o;
    }

    function _pair(bytes memory data, uint64 m, uint64 n)
        private
        pure
        returns (bytes32 oldRoot, bytes32 newRoot, bytes32[] memory proof)
    {
        uint256 o = 12;
        uint256 positives = _uint(data, 4, 4);
        for (uint256 i = 0; i < positives; i++) {
            o += 1 + 1;
            uint64 rm = uint64(_uint(data, o, 8));
            o += 8;
            uint64 rn = uint64(_uint(data, o, 8));
            o += 8;
            bytes32 oldR = _b32(data, o);
            o += 32;
            bytes32 newR = _b32(data, o);
            o += 32;
            uint256 proofLen = _uint(data, o, 2);
            o += 2;
            if (rm == m && rn == n) {
                proof = new bytes32[](proofLen);
                for (uint256 p = 0; p < proofLen; p++) {
                    proof[p] = _b32(data, o);
                    o += 32;
                }
                return (oldR, newR, proof);
            }
            o += proofLen * 32;
        }
        revert("pair missing");
    }

    function _load() private view returns (bytes memory) {
        return vm.readFileBinary("cache/consistency.bin");
    }

    function _uint(bytes memory b, uint256 o, uint256 n) private pure returns (uint256 v) {
        for (uint256 i = 0; i < n; i++) v = (v << 8) | uint8(b[o + i]);
    }

    function _b32(bytes memory b, uint256 o) private pure returns (bytes32 w) {
        for (uint256 i = 0; i < 32; i++) w = (w << 8) | bytes32(uint256(uint8(b[o + i])));
    }
}
