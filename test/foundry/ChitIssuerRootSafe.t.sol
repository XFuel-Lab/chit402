// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Enum} from "safe-smart-account/common/Enum.sol";
import {SafeL2} from "safe-smart-account/SafeL2.sol";
import {ChitIssuerCodes, ChitIssuerRoot} from "../../contracts/registry/ChitIssuerRoot.sol";
import {SafeFixture} from "./SafeFixture.sol";

/// @notice Controller is a real Safe v1.4.1 proxy (SafeL2 singleton + factory), threshold 2 of 3.
contract ChitIssuerRootSafeTest is SafeFixture {
    SafeL2 internal safe;
    ChitIssuerRoot internal root;
    bytes32 internal genesis = keccak256("safe-genesis");
    uint64 internal constant NOT_BEFORE = 1_700_000_000;

    function setUp() public {
        vm.chainId(84532);
        vm.warp(NOT_BEFORE);
        safe = _deploySafeFromSource();
        root = new ChitIssuerRoot(address(safe), genesis, NOT_BEFORE);
    }

    function test_anyTwoOfThreeOwnersCanCommitAndOneCannot() public {
        bytes memory data = _retire(genesis);
        bytes32 hash = _hash(address(root), data);
        (, bytes memory onlyOne) = _oneSig(ownerPk1, hash);
        vm.expectRevert(bytes("GS020"));
        _submit(address(root), data, onlyOne);

        _exec(safe, address(root), data, ownerPk1, ownerPk3);
        assertEq(root.rootSeq(), 1);

        bytes32 kid23 = keccak256("pair-23");
        ChitIssuerRoot pair23 = new ChitIssuerRoot(address(safe), kid23, NOT_BEFORE);
        _exec(safe, address(pair23), _retire(kid23), ownerPk2, ownerPk3);
        assertEq(pair23.rootSeq(), 1);

        bytes32 kid12 = keccak256("pair-12");
        ChitIssuerRoot pair12 = new ChitIssuerRoot(address(safe), kid12, NOT_BEFORE);
        _exec(safe, address(pair12), _retire(kid12), ownerPk1, ownerPk2);
        assertEq(pair12.rootSeq(), 1);
    }

    function test_rogueWriterCannotCommitAndTheDelayStillBinds() public {
        bytes32 kid = keccak256("delayed");
        uint64 notBefore = uint64(block.timestamp + 24 hours);
        bytes memory add = _commit(_one(_op(ChitIssuerCodes.OP_ADD_STANDBY, kid, notBefore)));

        address gateway = address(0xBEEF);
        vm.prank(gateway);
        vm.expectRevert(abi.encodeWithSelector(ChitIssuerRoot.NotController.selector, gateway));
        root.commit(_one(_op(ChitIssuerCodes.OP_ADD_STANDBY, kid, notBefore)), new ChitIssuerRoot.FreezeArg[](0), 0, bytes32(0));

        _exec(safe, address(root), add, ownerPk1, ownerPk2);

        ChitIssuerRoot.Op[] memory promoteOps = _one(_op(ChitIssuerCodes.OP_PROMOTE, kid, 0));
        vm.expectRevert(abi.encodeWithSelector(ChitIssuerRoot.NotYetActive.selector, kid, notBefore));
        vm.prank(address(safe));
        root.commit(promoteOps, new ChitIssuerRoot.FreezeArg[](0), 0, bytes32(0));

        vm.warp(notBefore);
        _exec(safe, address(root), _commit(promoteOps), ownerPk2, ownerPk3);
        (uint8 status, bool wasActive,,,,) = root.keys(kid);
        assertEq(status, ChitIssuerCodes.STATUS_ACTIVE);
        assertTrue(wasActive);
    }

    function test_unsortedSignaturesRevert() public {
        bytes memory data = _retire(genesis);
        bytes32 hash = _hash(address(root), data);
        (address a, bytes memory sa) = _oneSig(ownerPk1, hash);
        (address b, bytes memory sb) = _oneSig(ownerPk2, hash);
        bytes memory unsorted = a < b ? bytes.concat(sb, sa) : bytes.concat(sa, sb);
        vm.expectRevert(bytes("GS026"));
        _submit(address(root), data, unsorted);
    }

    function _submit(address to, bytes memory data, bytes memory signatures) internal {
        safe.execTransaction(to, 0, data, Enum.Operation.Call, 0, 0, 0, address(0), payable(address(0)), signatures);
    }

    function _hash(address to, bytes memory data) internal view returns (bytes32) {
        return safe.getTransactionHash(to, 0, data, Enum.Operation.Call, 0, 0, 0, address(0), address(0), safe.nonce());
    }

    function _retire(bytes32 kid) internal pure returns (bytes memory) {
        return _commit(_one(_op(ChitIssuerCodes.OP_RETIRE, kid, NOT_BEFORE)));
    }

    function _op(uint8 kind, bytes32 kid, uint64 timestamp) internal pure returns (ChitIssuerRoot.Op memory) {
        return ChitIssuerRoot.Op({kind: kind, kid: kid, timestamp: timestamp, reasonCode: 0});
    }

    function _one(ChitIssuerRoot.Op memory op) internal pure returns (ChitIssuerRoot.Op[] memory ops) {
        ops = new ChitIssuerRoot.Op[](1);
        ops[0] = op;
    }

    function _commit(ChitIssuerRoot.Op[] memory ops) internal pure returns (bytes memory) {
        ChitIssuerRoot.FreezeArg[] memory none = new ChitIssuerRoot.FreezeArg[](0);
        return abi.encodeCall(ChitIssuerRoot.commit, (ops, none, uint64(0), bytes32(0)));
    }
}
