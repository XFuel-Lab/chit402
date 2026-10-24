// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {TestBase} from "./utils/Test.sol";
import {TreeLib} from "./utils/TreeLib.sol";
import {EscrowMerkle} from "escrow/EscrowMerkle.sol";

contract MerkleHarness {
    function verify(bytes32 leaf, uint64 index, uint64 size, bytes32 root, bytes32[] calldata proof) external pure returns (bool) {
        return EscrowMerkle.verifyInclusion(leaf, index, size, root, proof);
    }
}

/// @dev C10 / C11: the Solidity inclusion check agrees with the gateway JS on
///      every vector (positive and negative), and fuzzed honest trees reject
///      wrong length, swapped sides, index >= size, over-long paths and
///      interior nodes used as leaves.
contract MerkleTest is TestBase {
    MerkleHarness internal m = new MerkleHarness();

    function _diff(uint256 from, uint256 to) internal view returns (uint256 pos) {
        string memory j = vm.readFile("vectors/merkle.json");
        uint256 n = vm.parseJsonUint(j, ".count");
        if (to > n) to = n;
        for (uint256 i = from; i < to; i++) {
            string memory p = string.concat(".cases[", vm.toString(i), "]");
            bool want = vm.parseJsonBool(j, string.concat(p, ".ok"));
            bool got = m.verify(
                vm.parseJsonBytes32(j, string.concat(p, ".leaf")),
                uint64(vm.parseJsonUint(j, string.concat(p, ".index"))),
                uint64(vm.parseJsonUint(j, string.concat(p, ".size"))),
                vm.parseJsonBytes32(j, string.concat(p, ".root")),
                vm.parseJsonBytes32Array(j, string.concat(p, ".proof"))
            );
            assertEq(got, want, string.concat("JS/Solidity disagree at case ", vm.toString(i)));
            if (want) pos++;
        }
    }

    function test_C10_gateway_vectors_differential_part1() public view {
        assertGt(_diff(0, 100), 0, "positive cases");
    }

    function test_C10_gateway_vectors_differential_part2() public view {
        assertGt(_diff(100, 200), 0, "positive cases");
    }

    function test_C10_gateway_vectors_differential_part3() public view {
        assertGt(_diff(200, 300), 0, "positive cases");
    }

    function test_C10_gateway_vectors_differential_part4() public view {
        assertGt(_diff(300, 400), 0, "positive cases");
    }

    function test_C10_gateway_vectors_differential_part5() public view {
        string memory j = vm.readFile("vectors/merkle.json");
        uint256 n = vm.parseJsonUint(j, ".count");
        assertLe(n, 600, "add a part when the vector file grows");
        assertGt(_diff(400, 600), 0, "positive cases");
    }

    function testFuzz_C10_solidity_tree_roundtrip(uint16 sizeSeed, uint16 idxSeed, uint256 seed) public view {
        uint256 size = bound(sizeSeed, 1, 300);
        uint256 index = idxSeed % size;
        bytes32[] memory ls = TreeLib.leaves(size, seed);
        bytes32 root = TreeLib.root(ls);
        bytes32[] memory proof = TreeLib.proof(ls, index);
        assertTrue(m.verify(ls[index], uint64(index), uint64(size), root, proof), "honest proof");
    }

    function testFuzz_C11_malformed_proofs_rejected(uint16 sizeSeed, uint16 idxSeed, uint256 seed) public view {
        uint256 size = bound(sizeSeed, 2, 300);
        uint256 index = idxSeed % size;
        bytes32[] memory ls = TreeLib.leaves(size, seed);
        bytes32 root = TreeLib.root(ls);
        bytes32[] memory proof = TreeLib.proof(ls, index);

        // index >= size
        assertFalse(m.verify(ls[index], uint64(size), uint64(size), root, proof), "index == size");
        // short
        bytes32[] memory shortP = new bytes32[](proof.length - 1);
        for (uint256 i = 0; i < shortP.length; i++) shortP[i] = proof[i];
        assertFalse(m.verify(ls[index], uint64(index), uint64(size), root, shortP), "short");
        // long
        bytes32[] memory longP = new bytes32[](proof.length + 1);
        for (uint256 i = 0; i < proof.length; i++) longP[i] = proof[i];
        longP[proof.length] = ls[0];
        assertFalse(m.verify(ls[index], uint64(index), uint64(size), root, longP), "long");
        // swapped sides
        if (proof.length >= 2 && proof[0] != proof[1]) {
            bytes32[] memory sw = new bytes32[](proof.length);
            for (uint256 i = 0; i < proof.length; i++) sw[i] = proof[i];
            (sw[0], sw[1]) = (sw[1], sw[0]);
            assertFalse(m.verify(ls[index], uint64(index), uint64(size), root, sw), "swapped");
        }
        // wrong index (same proof)
        uint256 other = (index + 1) % size;
        if (ls[other] != ls[index]) {
            assertFalse(m.verify(ls[index], uint64(other), uint64(size), root, proof), "wrong index");
        }
        // interior node as leaf: the parent of leaves (0,1) at index 0 with the
        // remaining path, which is one step short for a leaf at index 0.
        if (size >= 3) {
            bytes32 interior = TreeLib.node(ls[0], ls[1]);
            bytes32[] memory p0 = TreeLib.proof(ls, 0);
            bytes32[] memory rest = new bytes32[](p0.length - 1);
            for (uint256 i = 1; i < p0.length; i++) rest[i - 1] = p0[i];
            assertFalse(m.verify(interior, 0, uint64(size), root, rest), "interior node as leaf");
        }
    }

    function test_C11_over_long_path_rejected() public view {
        bytes32[] memory p = new bytes32[](65);
        assertFalse(m.verify(bytes32(0), 0, type(uint64).max, bytes32(0), p), "65 steps");
    }

    function test_C11_size_one_and_zero() public view {
        bytes32 l = TreeLib.leaf("only");
        bytes32[] memory empty = new bytes32[](0);
        assertTrue(m.verify(l, 0, 1, l, empty), "size 1");
        assertFalse(m.verify(l, 0, 0, l, empty), "size 0");
        bytes32[] memory one = new bytes32[](1);
        assertFalse(m.verify(l, 0, 1, l, one), "size 1 with a step");
    }

    function bound(uint256 x, uint256 lo, uint256 hi) internal pure returns (uint256) {
        return lo + (x % (hi - lo + 1));
    }
}
