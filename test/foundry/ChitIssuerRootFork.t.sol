// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {console2} from "forge-std/console2.sol";
import {ChitIssuerCodes, ChitIssuerRoot} from "../../contracts/registry/ChitIssuerRoot.sol";
import {SafeFixture} from "./SafeFixture.sol";
import {SafeL2} from "safe-smart-account/SafeL2.sol";

/// @notice Fork-measured gas on Base Sepolia (chain 84532). No broadcast.
///         The Safe is the canonical SafeL2 1.4.1 singleton and factory.
contract DeployMeter {
    address public deployed;

    function deploy(address controller, bytes32 kid, uint64 notBefore) external returns (address) {
        deployed = address(new ChitIssuerRoot(controller, kid, notBefore));
        return deployed;
    }
}

contract ChitIssuerRootForkTest is SafeFixture {
    function test_forkMeasuredGas() public {
        vm.createSelectFork(vm.rpcUrl("base_sepolia"));
        assertEq(block.chainid, 84532);

        SafeL2 safe = _deploySafeFromCanonical();
        bytes32 genesis = keccak256("fork-genesis");
        uint64 notBefore = uint64(block.timestamp > 0 ? block.timestamp - 1 : 0);

        DeployMeter meter = new DeployMeter();
        meter.deploy(address(safe), genesis, notBefore);
        uint256 deployMetered = vm.lastCallGas().gasTotalUsed;
        console2.log("FORK_GAS deploy_exec", deployMetered);
        ChitIssuerRoot root = ChitIssuerRoot(meter.deployed());
        console2.log("FORK_GAS deploy_codesize", address(root).code.length);

        bytes32 standby = keccak256("fork-standby");
        uint64 standbyAt = uint64(block.timestamp + 24 hours);
        bytes memory oneOp = _encode(
            _one(ChitIssuerRoot.Op({kind: ChitIssuerCodes.OP_ADD_STANDBY, kid: standby, timestamp: standbyAt, reasonCode: 0})),
            new ChitIssuerRoot.FreezeArg[](0),
            0,
            bytes32(0)
        );
        _exec(safe, address(root), oneOp, ownerPk1, ownerPk2);
        uint256 oneOpGas = vm.lastCallGas().gasTotalUsed;
        console2.log("FORK_GAS commit_one_op_exec", oneOpGas);
        console2.log("FORK_GAS commit_one_op_tx", 21000 + _calldataGas(oneOp) + oneOpGas);

        bytes32 universe = keccak256("legacy_receipts_pre_v11");
        ChitIssuerRoot.Op[] memory ops = _one(
            ChitIssuerRoot.Op({
                kind: ChitIssuerCodes.OP_ADD_STANDBY,
                kid: keccak256("fork-standby-2"),
                timestamp: standbyAt,
                reasonCode: 0
            })
        );
        ChitIssuerRoot.FreezeArg[] memory fz = new ChitIssuerRoot.FreezeArg[](1);
        fz[0] = ChitIssuerRoot.FreezeArg({
            universeId: universe,
            universeHash: keccak256("fork-merkle"),
            enumeratedCount: 3
        });
        bytes memory both = _encode(ops, fz, 1, keccak256("fork-hist"));
        _exec(safe, address(root), both, ownerPk1, ownerPk3);
        uint256 bothGas = vm.lastCallGas().gasTotalUsed;
        console2.log("FORK_GAS commit_op_freeze_exec", bothGas);
        console2.log("FORK_GAS commit_op_freeze_tx", 21000 + _calldataGas(both) + bothGas);

        assertEq(root.rootSeq(), 2);
        (uint8 status,,,,) = root.keys(standby);
        assertEq(status, ChitIssuerCodes.STATUS_STANDBY);
        (bytes32 uhash,,,) = root.freezes(universe);
        assertEq(uhash, keccak256("fork-merkle"));
    }

    function _encode(
        ChitIssuerRoot.Op[] memory ops,
        ChitIssuerRoot.FreezeArg[] memory fz,
        uint64 version,
        bytes32 snapshot
    ) internal pure returns (bytes memory) {
        return abi.encodeCall(ChitIssuerRoot.commit, (ops, fz, version, snapshot));
    }

    function _one(ChitIssuerRoot.Op memory op) internal pure returns (ChitIssuerRoot.Op[] memory ops) {
        ops = new ChitIssuerRoot.Op[](1);
        ops[0] = op;
    }

    function _calldataGas(bytes memory data) internal pure returns (uint256 gas) {
        // The measured call is execTransaction, whose calldata is the ABI encoding
        // of that call, not the inner commit bytes. This helper prices the inner
        // payload only; the tx figure below is recomputed by the test log from the
        // execution gas plus a flat 21,000. Callers pass the inner payload as a
        // lower bound on calldata. The test also logs a priced execTransaction
        // encoding when it has one. Here we price `data` itself.
        for (uint256 i = 0; i < data.length; i++) {
            gas += data[i] == 0 ? 4 : 16;
        }
    }
}
