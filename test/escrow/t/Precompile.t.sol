// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {TestBase} from "./utils/Test.sol";

/// @dev Local EVM (osaka, EIP-7951) 0x100 against the Wycheproof subset in
///      vectors/wycheproof.json: valid cases (including high-S) return the
///      32-byte word 1, every invalid case returns empty output without a revert.
contract PrecompileTest is TestBase {
    uint256 internal constant N = 0xffffffff00000000ffffffffffffffffbce6faada7179e84f3b9cac2fc632551;
    uint256 internal constant P = 0xffffffff00000001000000000000000000000000ffffffffffffffffffffffff;

    function call100(bytes32 h, bytes32 r, bytes32 s, bytes32 x, bytes32 y) internal view returns (bool ok, uint256 len, uint256 word) {
        bytes memory out;
        (ok, out) = address(0x100).staticcall(abi.encodePacked(h, r, s, x, y));
        len = out.length;
        if (len == 32) word = abi.decode(out, (uint256));
    }

    function test_wycheproof_subset_local() public view {
        string memory j = vm.readFile("vectors/wycheproof.json");
        uint256 n = vm.parseJsonUint(j, ".count");
        uint256 valid;
        for (uint256 i = 0; i < n; i++) {
            string memory p = string.concat(".cases[", vm.toString(i), "]");
            (bool ok, uint256 len, uint256 word) = call100(
                vm.parseJsonBytes32(j, string.concat(p, ".h")),
                vm.parseJsonBytes32(j, string.concat(p, ".r")),
                vm.parseJsonBytes32(j, string.concat(p, ".s")),
                vm.parseJsonBytes32(j, string.concat(p, ".x")),
                vm.parseJsonBytes32(j, string.concat(p, ".y"))
            );
            assertTrue(ok, "precompile never reverts");
            if (vm.parseJsonBool(j, string.concat(p, ".valid"))) {
                assertTrue(len == 32 && word == 1, string.concat("valid case rejected ", vm.toString(vm.parseJsonUint(j, string.concat(p, ".tcId")))));
                valid++;
            } else {
                assertEq(len, 0, string.concat("invalid case accepted ", vm.toString(vm.parseJsonUint(j, string.concat(p, ".tcId")))));
            }
        }
        assertGt(valid, 0, "some valid cases");
    }

    function test_edge_cases_local() public view {
        uint256 pk = 0xC0FFEE;
        bytes32 h = sha256("edge");
        (bytes32 r, bytes32 s) = vm.signP256(pk, h);
        (uint256 x, uint256 y) = vm.publicKeyP256(pk);
        bytes32 hs = uint256(s) > N / 2 ? s : bytes32(N - uint256(s));
        bytes32 ls = uint256(s) > N / 2 ? bytes32(N - uint256(s)) : s;
        (bool ok, uint256 len, uint256 word) = _c(h, r, ls, bytes32(x), bytes32(y));
        assertTrue(ok && len == 32 && word == 1, "low-S ok");
        (ok, len, word) = _c(h, r, hs, bytes32(x), bytes32(y));
        assertTrue(ok && len == 32 && word == 1, "high-S accepted");
        (ok, len,) = _c(h, bytes32(0), ls, bytes32(x), bytes32(y));
        assertTrue(ok && len == 0, "r=0 rejected");
        (ok, len,) = _c(h, r, bytes32(0), bytes32(x), bytes32(y));
        assertTrue(ok && len == 0, "s=0 rejected");
        (ok, len,) = _c(h, r, bytes32(N), bytes32(x), bytes32(y));
        assertTrue(ok && len == 0, "s=n rejected");
        (ok, len,) = _c(h, bytes32(N), ls, bytes32(x), bytes32(y));
        assertTrue(ok && len == 0, "r=n rejected");
        (ok, len,) = _c(h, r, ls, bytes32(x), bytes32(y ^ 1));
        assertTrue(ok && len == 0, "off-curve rejected");
        (ok, len,) = _c(h, r, ls, bytes32(0), bytes32(0));
        assertTrue(ok && len == 0, "infinity rejected");
        (ok, len,) = _c(h, r, ls, bytes32(P), bytes32(y));
        assertTrue(ok && len == 0, "x=p rejected");
        (ok, len,) = _c(bytes32(uint256(h) ^ 1), r, ls, bytes32(x), bytes32(y));
        assertTrue(ok && len == 0, "tampered hash rejected");
        // Wrong input length.
        bytes memory out;
        (ok, out) = address(0x100).staticcall(abi.encodePacked(h, r, ls, bytes32(x)));
        assertTrue(ok && out.length == 0, "short input rejected");
    }

    function _c(bytes32 h, bytes32 r, bytes32 s, bytes32 x, bytes32 y) internal view returns (bool ok, uint256 len, uint256 word) {
        return call100(h, r, s, x, y);
    }
}
