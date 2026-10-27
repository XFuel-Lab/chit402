// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @dev Minimal Foundry cheatcode interface and assertions, kept in-tree so the
///      escrow tests need no git submodule. Signatures match forge's Vm.
interface Vm {
    function warp(uint256) external;
    function getNonce(address) external view returns (uint64);
    function computeCreateAddress(address deployer, uint256 nonce) external pure returns (address);
    function etch(address target, bytes calldata code) external;
    function chainId(uint256) external;
    function prank(address) external;
    function startPrank(address) external;
    function stopPrank() external;
    function expectRevert() external;
    function expectRevert(bytes4) external;
    function expectRevert(bytes calldata) external;
    function signP256(uint256 privateKey, bytes32 digest) external pure returns (bytes32 r, bytes32 s);
    function publicKeyP256(uint256 privateKey) external pure returns (uint256 x, uint256 y);
    function mockCall(address callee, bytes calldata data, bytes calldata returnData) external;
    function mockCallRevert(address callee, bytes calldata data, bytes calldata revertData) external;
    function clearMockedCalls() external;
    function envOr(string calldata name, string calldata defaultValue) external view returns (string memory);
    function createSelectFork(string calldata urlOrAlias) external returns (uint256);
    function rpc(string calldata method, string calldata params) external returns (bytes memory);
    function readFile(string calldata path) external view returns (string memory);
    function parseJsonBytes32(string calldata json, string calldata key) external pure returns (bytes32);
    function parseJsonBytes32Array(string calldata json, string calldata key) external pure returns (bytes32[] memory);
    function parseJsonUint(string calldata json, string calldata key) external pure returns (uint256);
    function parseJsonBool(string calldata json, string calldata key) external pure returns (bool);
    function parseJsonAddress(string calldata json, string calldata key) external pure returns (address);
    function skip(bool) external;
    function store(address target, bytes32 slot, bytes32 value) external;
    function load(address target, bytes32 slot) external view returns (bytes32);
    function deal(address who, uint256 newBalance) external;
    function assume(bool) external pure;
    function toString(uint256) external pure returns (string memory);
    function toString(bytes memory) external pure returns (string memory);
    function toString(bytes32) external pure returns (string memory);
    function envUint(string calldata name) external view returns (uint256);
    function envAddress(string calldata name) external view returns (address);
    function envBytes32(string calldata name) external view returns (bytes32);
    function envOr(string calldata name, uint256 defaultValue) external view returns (uint256);
    function startBroadcast(uint256 privateKey) external;
    function stopBroadcast() external;
}

abstract contract TestBase {
    Vm internal constant vm = Vm(address(uint160(uint256(keccak256("hevm cheat code")))));

    event log(string);
    event log_named_uint(string key, uint256 val);
    event log_named_bytes32(string key, bytes32 val);

    function fail(string memory why) internal pure {
        revert(why);
    }

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

    function assertEq(bool a, bool b, string memory why) internal pure {
        if (a != b) revert(why);
    }

    function assertEq(bytes memory a, bytes memory b, string memory why) internal pure {
        if (keccak256(a) != keccak256(b)) revert(why);
    }

    function assertLe(uint256 a, uint256 b, string memory why) internal pure {
        if (a > b) revert(string.concat(why, ": ", _u(a), " > ", _u(b)));
    }

    function assertGt(uint256 a, uint256 b, string memory why) internal pure {
        if (a <= b) revert(string.concat(why, ": ", _u(a), " <= ", _u(b)));
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
