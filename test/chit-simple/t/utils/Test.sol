// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {StdInvariant} from "./StdInvariant.sol";

interface Vm {
    struct Log {
        bytes32[] topics;
        bytes data;
        address emitter;
    }

    function warp(uint256) external;
    function chainId(uint256) external;
    function prank(address) external;
    function startPrank(address) external;
    function stopPrank() external;
    function deal(address who, uint256 newBalance) external;
    function setNonce(address account, uint64 newNonce) external;
    function getNonce(address account) external view returns (uint64);
    function computeCreateAddress(address deployer, uint256 nonce) external pure returns (address);
    function expectRevert() external;
    function expectRevert(bytes4) external;
    function recordLogs() external;
    function getRecordedLogs() external returns (Log[] memory);
    function pauseGasMetering() external;
    function resumeGasMetering() external;
    function readFile(string calldata path) external view returns (string memory);
    function readFileBinary(string calldata path) external view returns (bytes memory);
    function parseJsonString(string calldata json, string calldata key) external pure returns (string memory);
    function parseJsonUint(string calldata json, string calldata key) external pure returns (uint256);
    function toString(uint256) external pure returns (string memory);
}

abstract contract Test is StdInvariant {
    Vm internal constant vm = Vm(address(uint160(uint256(keccak256("hevm cheat code")))));

    function assertTrue(bool v, string memory why) internal pure {
        if (!v) revert(why);
    }

    function assertFalse(bool v, string memory why) internal pure {
        if (v) revert(why);
    }

    function assertEq(uint256 a, uint256 b, string memory why) internal pure {
        if (a != b) revert(string.concat(why, ": ", _u(a), " != ", _u(b)));
    }

    function assertEq(bytes32 a, bytes32 b, string memory why) internal pure {
        if (a != b) revert(why);
    }

    function assertEq(address a, address b, string memory why) internal pure {
        if (a != b) revert(why);
    }

    function assertEq(string memory a, string memory b, string memory why) internal pure {
        if (keccak256(bytes(a)) != keccak256(bytes(b))) revert(why);
    }

    function assertEq(bytes memory a, bytes memory b, string memory why) internal pure {
        if (keccak256(a) != keccak256(b)) revert(why);
    }

    function assertGt(uint256 a, uint256 b, string memory why) internal pure {
        if (a <= b) revert(why);
    }

    function _has(string memory s, string memory needle) internal pure returns (bool) {
        bytes memory b = bytes(s);
        bytes memory n = bytes(needle);
        if (n.length == 0 || b.length < n.length) return false;
        for (uint256 i = 0; i <= b.length - n.length; i++) {
            bool ok = true;
            for (uint256 j = 0; j < n.length; j++) {
                if (b[i + j] != n[j]) {
                    ok = false;
                    break;
                }
            }
            if (ok) return true;
        }
        return false;
    }

    function _u(uint256 v) private pure returns (string memory) {
        if (v == 0) return "0";
        uint256 n;
        for (uint256 t = v; t != 0; t /= 10) n++;
        bytes memory b = new bytes(n);
        for (; v != 0; v /= 10) b[--n] = bytes1(uint8(48 + (v % 10)));
        return string(b);
    }
}
