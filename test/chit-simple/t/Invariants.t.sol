// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Test, Vm} from "./utils/Test.sol";
import {ChitAnchor} from "chit-simple/ChitAnchor.sol";
import {Rfc9162Harness} from "./Harness.sol";
import {Tree} from "./Tree.sol";

/// @notice Foundry invariants I1–I4 and I11 for the v0 anchor.
contract ChitAnchorInvariantTest is Test {
    ChitAnchor internal anchor;
    Rfc9162Harness internal harness;
    Handler internal handler;

    function setUp() public {
        vm.chainId(84532);
        address cp = address(0xC0FFEE);
        anchor = new ChitAnchor(cp);
        harness = new Rfc9162Harness();
        handler = new Handler(anchor);
        vm.deal(address(handler), 1 ether);
        targetContract(address(handler));
    }

    function test_handler_seals_three() public {
        handler.sealOne(bytes32(uint256(1)), bytes32(uint256(9)));
        handler.sealOne(bytes32(uint256(2)), bytes32(uint256(8)));
        handler.sealOne(bytes32(uint256(3)), bytes32(uint256(7)));
        (uint64 epoch,, uint64 size,,) = anchor.latest();
        assertEq(epoch, 3, "epoch");
        assertEq(size, 3, "size");
        assertEq(handler.stepCount(), 3, "steps");
    }

    function invariant_I1_epochPlusOne() public view {
        uint256 n = handler.stepCount();
        for (uint256 i = 0; i < n; i++) {
            assert(handler.epochs(i) == i + 1);
        }
        (uint64 epoch,,,,) = anchor.latest();
        assert(epoch == n);
    }

    function invariant_I2_sizeRootAndGenesis() public view {
        uint256 n = handler.stepCount();
        uint64 prev = 0;
        for (uint256 i = 0; i < n; i++) {
            (uint64 prevSize, uint64 treeSize,,, bytes32 oldRoot, bytes32 newRoot) = handler.steps(i);
            assert(treeSize > prev);
            assert(prevSize == prev);
            if (i == 0) assert(prevSize == 0);
            else assert(prevSize != 0);
            assert(harness.verify(prevSize, treeSize, oldRoot, newRoot, handler.proofAt(i)) == 0);
            prev = treeSize;
        }
        (,, uint64 size, bytes32 root,) = anchor.latest();
        if (n == 0) {
            assert(size == 0);
            assert(root == harness.emptyRoot());
        } else {
            assert(size == prev);
            (,,,,, bytes32 newRoot) = handler.steps(n - 1);
            assert(root == newRoot);
        }
    }

    function invariant_I3_onlyCheckpointMovesTheHead() public view {
        assert(anchor.checkpoint() == handler.expectedCheckpoint());
        (uint64 epoch,,,,) = anchor.latest();
        assert(epoch == handler.stepCount());
        assert(anchor.domain() == handler.domainSeen());
    }

    function invariant_I4_finishedAlignedHours() public view {
        uint256 n = handler.stepCount();
        uint64 prev = 0;
        for (uint256 i = 0; i < n; i++) {
            (,, uint64 hour, uint256 at,,) = handler.steps(i);
            assert(hour % 3600 == 0);
            assert(hour > prev);
            assert(uint256(hour) + 3600 <= at);
            prev = hour;
        }
    }

    function invariant_I11_noEthHeld() public view {
        assert(address(anchor).balance == 0);
    }
}

contract Handler {
    struct Step {
        uint64 prevSize;
        uint64 treeSize;
        uint64 hour;
        uint256 at;
        bytes32 oldRoot;
        bytes32 newRoot;
    }

    uint256 internal constant CAP = 12;
    Vm internal constant vm = Vm(address(uint160(uint256(keccak256("hevm cheat code")))));

    ChitAnchor public anchor;
    address public expectedCheckpoint;
    bytes32 public domainSeen;
    bytes32[] internal leaves;
    uint64[] public epochs;
    Step[] public steps;
    bytes32[][] internal proofs;

    constructor(ChitAnchor anchor_) {
        anchor = anchor_;
        expectedCheckpoint = anchor_.checkpoint();
        domainSeen = anchor_.domain();
    }

    receive() external payable {}

    function stepCount() external view returns (uint256) {
        return steps.length;
    }

    function proofAt(uint256 i) external view returns (bytes32[] memory) {
        return proofs[i];
    }

    function sealOne(bytes32 leaf, bytes32 state) external {
        (uint64 ep, uint64 hour0, uint64 sz, bytes32 stored,) = anchor.latest();
        if (leaves.length >= CAP || uint256(sz) != leaves.length) return;
        leaves.push(leaf);
        bytes32[] memory all = _copy();
        bytes32 newRoot = Tree.mth(all);
        bytes32[] memory proof = Tree.consistency(all, sz, all.length);
        uint64 hour = hour0 + 3600;
        uint256 at = uint256(hour) + 3600;
        if (block.timestamp < at) vm.warp(at);
        address who = anchor.checkpoint();
        bytes32 dom = anchor.domain();
        vm.prank(who);
        anchor.anchor(dom, ep + 1, hour, uint64(all.length), newRoot, state, proof);
        epochs.push(ep + 1);
        steps.push(Step({
            prevSize: sz,
            treeSize: uint64(all.length),
            hour: hour,
            at: block.timestamp,
            oldRoot: stored,
            newRoot: newRoot
        }));
        proofs.push(proof);
    }

    function unfinished(bytes32 leaf, bytes32 state) external {
        (uint64 ep, uint64 hour0, uint64 sz,,) = anchor.latest();
        if (leaves.length >= CAP || uint256(sz) != leaves.length) return;
        bytes32[] memory all = _copyPlus(leaf);
        bytes32 newRoot = Tree.mth(all);
        bytes32[] memory proof = Tree.consistency(all, sz, all.length);
        uint64 hour = hour0 + 3600;
        vm.warp(uint256(hour) + 3600 - 1);
        address who = anchor.checkpoint();
        bytes32 dom = anchor.domain();
        vm.prank(who);
        try anchor.anchor(dom, ep + 1, hour, uint64(all.length), newRoot, state, proof) {} catch {}
    }

    function stranger(address who, bytes32 leaf, bytes32 state) external {
        if (who == anchor.checkpoint()) return;
        (uint64 ep, uint64 hour0, uint64 sz,,) = anchor.latest();
        if (leaves.length >= CAP || uint256(sz) != leaves.length) return;
        bytes32[] memory all = _copyPlus(leaf);
        bytes32 newRoot = Tree.mth(all);
        bytes32[] memory proof = Tree.consistency(all, sz, all.length);
        uint64 hour = hour0 + 3600;
        uint256 at = uint256(hour) + 3600;
        if (block.timestamp < at) vm.warp(at);
        bytes32 dom = anchor.domain();
        vm.prank(who);
        try anchor.anchor(dom, ep + 1, hour, uint64(all.length), newRoot, state, proof) {} catch {}
    }

    function badExtend() external {
        (uint64 ep, uint64 hour0, uint64 sz, bytes32 stored, bytes32 state) = anchor.latest();
        if (sz == 0) return;
        uint64 hour = hour0 + 3600;
        uint256 at = uint256(hour) + 3600;
        if (block.timestamp < at) vm.warp(at);
        address who = anchor.checkpoint();
        bytes32 dom = anchor.domain();
        vm.prank(who);
        try anchor.anchor(dom, ep + 1, hour, sz + 1, stored, state, new bytes32[](0)) {} catch {}
    }

    function rotate(uint96 salt) external {
        address next = address(uint160(uint256(keccak256(abi.encodePacked(salt, anchor.checkpointVersion())))));
        if (next == address(0) || next == anchor.checkpoint()) return;
        address who = anchor.checkpoint();
        uint64 version = anchor.checkpointVersion() + 1;
        vm.prank(who);
        anchor.rotateCheckpointKey(next, version);
        expectedCheckpoint = next;
    }

    function rotateStranger(address who, uint96 salt) external {
        if (who == anchor.checkpoint()) return;
        address next = address(uint160(uint256(keccak256(abi.encodePacked(salt, who)))));
        if (next == address(0) || next == anchor.checkpoint()) return;
        uint64 version = anchor.checkpointVersion() + 1;
        vm.prank(who);
        try anchor.rotateCheckpointKey(next, version) {} catch {}
    }

    function pay() external {
        if (address(this).balance == 0) return;
        (bool ok,) = address(anchor).call{value: 1}("");
        if (ok) return;
    }

    function _copy() internal view returns (bytes32[] memory all) {
        all = new bytes32[](leaves.length);
        for (uint256 i = 0; i < leaves.length; i++) all[i] = leaves[i];
    }

    function _copyPlus(bytes32 leaf) internal view returns (bytes32[] memory all) {
        all = new bytes32[](leaves.length + 1);
        for (uint256 i = 0; i < leaves.length; i++) all[i] = leaves[i];
        all[leaves.length] = leaf;
    }
}
