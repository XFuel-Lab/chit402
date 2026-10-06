// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {Enum} from "safe-smart-account/common/Enum.sol";
import {Safe} from "safe-smart-account/Safe.sol";
import {SafeL2} from "safe-smart-account/SafeL2.sol";
import {SafeProxyFactory} from "safe-smart-account/proxies/SafeProxyFactory.sol";

/// @dev Real Safe v1.4.1 (SafeL2 singleton + proxy factory), threshold 2 of 3.
///      Owner keys are derived in-test from labels. They are not literals and
///      they are not funded on any network.
abstract contract SafeFixture is Test {
    uint256 internal ownerPk1;
    uint256 internal ownerPk2;
    uint256 internal ownerPk3;
    address internal owner1;
    address internal owner2;
    address internal owner3;

    /// Canonical Safe v1.4.1 on Base Sepolia (safe-deployments).
    address internal constant CANONICAL_SAFE_L2 = 0x29fcB43b46531BcA003ddC8FCB67FFE91900C762;
    address internal constant CANONICAL_SAFE_FACTORY = 0x4e1DCf7AD4e460CfD30791CCC4F9c8a4f820ec67;

    function _initOwners() internal {
        ownerPk1 = uint256(keccak256("chit-issuer-root test owner 1"));
        ownerPk2 = uint256(keccak256("chit-issuer-root test owner 2"));
        ownerPk3 = uint256(keccak256("chit-issuer-root test owner 3"));
        owner1 = vm.addr(ownerPk1);
        owner2 = vm.addr(ownerPk2);
        owner3 = vm.addr(ownerPk3);
    }

    function _deploySafeFromSource() internal returns (SafeL2) {
        _initOwners();
        return _proxy(address(new SafeL2()), address(new SafeProxyFactory()));
    }

    function _deploySafeFromCanonical() internal returns (SafeL2) {
        _initOwners();
        require(CANONICAL_SAFE_L2.code.length > 0, "canonical SafeL2 missing");
        require(CANONICAL_SAFE_FACTORY.code.length > 0, "canonical factory missing");
        return _proxy(CANONICAL_SAFE_L2, CANONICAL_SAFE_FACTORY);
    }

    function _proxy(address singleton, address factory) internal returns (SafeL2) {
        address[] memory owners = new address[](3);
        owners[0] = owner1;
        owners[1] = owner2;
        owners[2] = owner3;
        bytes memory initializer = abi.encodeCall(
            Safe.setup, (owners, 2, address(0), bytes(""), address(0), address(0), 0, payable(address(0)))
        );
        address proxy = address(SafeProxyFactory(factory).createProxyWithNonce(singleton, initializer, 0));
        SafeL2 safe = SafeL2(payable(proxy));
        require(safe.getThreshold() == 2, "threshold");
        require(safe.isOwner(owner1) && safe.isOwner(owner2) && safe.isOwner(owner3), "owners");
        return safe;
    }

    function _exec(SafeL2 safe, address to, bytes memory data, uint256 pkA, uint256 pkB) internal {
        bytes memory signatures = _sigsFor(safe, to, data, pkA, pkB);
        _submit(safe, to, data, signatures);
    }

    function _sigsFor(SafeL2 safe, address to, bytes memory data, uint256 pkA, uint256 pkB)
        internal
        view
        returns (bytes memory)
    {
        bytes32 hash = _safeHash(safe, to, data);
        return _sortedSigs(hash, pkA, pkB);
    }

    function _safeHash(SafeL2 safe, address to, bytes memory data) internal view returns (bytes32) {
        return safe.getTransactionHash(
            to, 0, data, Enum.Operation.Call, 0, 0, 0, address(0), address(0), safe.nonce()
        );
    }

    function _submit(SafeL2 safe, address to, bytes memory data, bytes memory signatures) internal {
        bool ok = safe.execTransaction(
            to, 0, data, Enum.Operation.Call, 0, 0, 0, address(0), payable(address(0)), signatures
        );
        require(ok, "safe exec failed");
    }

    function _sortedSigs(bytes32 hash, uint256 pkA, uint256 pkB) internal pure returns (bytes memory) {
        (address a, bytes memory sa) = _oneSig(pkA, hash);
        (address b, bytes memory sb) = _oneSig(pkB, hash);
        if (a < b) return bytes.concat(sa, sb);
        return bytes.concat(sb, sa);
    }

    function _oneSig(uint256 pk, bytes32 hash) internal pure returns (address owner, bytes memory sig) {
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(pk, hash);
        owner = vm.addr(pk);
        sig = abi.encodePacked(r, s, v);
    }
}
