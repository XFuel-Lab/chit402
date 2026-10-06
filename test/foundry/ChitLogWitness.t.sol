// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test, console2} from "forge-std/Test.sol";
import {ChitLogWitness, ChitLogPins} from "../../contracts/witness/ChitLogWitness.sol";
import {Rfc6962} from "../../contracts/witness/Rfc6962.sol";
import {DeployChitLogWitness} from "../../script/DeployChitLogWitness.s.sol";

contract ChitLogWitnessTest is Test {
    address owner = address(0x0A11);
    address appender = address(0xA99E);
    address other = address(0xB0B);

    ChitLogWitness witness;

    function setUp() public {
        witness = new ChitLogWitness(
            owner, appender, 1, ChitLogPins.EPOCH1_FINAL_SIZE, ChitLogPins.EPOCH1_FINAL_ROOT
        );
    }

    function test_pinsMatchTheReceiptLog() public view {
        assertEq(witness.epoch(), 1);
        assertEq(witness.treeSize(), 4);
        assertEq(witness.root(), ChitLogPins.EPOCH1_FINAL_ROOT);
        (uint256 epoch, uint256 size, bytes32 root) = witness.head();
        assertEq(epoch, 1);
        assertEq(size, 4);
        assertEq(root, ChitLogPins.EPOCH1_FINAL_ROOT);
        assertEq(witness.owner(), owner);
        assertEq(witness.appender(), appender);
    }

    function test_oct5ResetIsRefusedUntilTheSafeDeclaresEpoch2() public {
        bytes32[] memory emptyProof = new bytes32[](0);
        vm.prank(appender);
        vm.expectRevert(
            abi.encodeWithSelector(ChitLogWitness.SizeNotExtended.selector, 4, 1)
        );
        witness.append(1, ChitLogPins.EPOCH2_OPENING_ROOT, emptyProof);

        vm.prank(owner);
        vm.expectRevert(
            abi.encodeWithSelector(
                ChitLogWitness.PrevHeadMismatch.selector, 4, ChitLogPins.EPOCH1_FINAL_ROOT
            )
        );
        witness.declareEpoch(2, 0, bytes32(0), 1, ChitLogPins.EPOCH2_OPENING_ROOT);

        vm.prank(owner);
        vm.expectEmit(true, false, false, true, address(witness));
        emit ChitLogWitness.EpochDeclared(
            2, 4, ChitLogPins.EPOCH1_FINAL_ROOT, 1, ChitLogPins.EPOCH2_OPENING_ROOT
        );
        witness.declareEpoch(
            2, 4, ChitLogPins.EPOCH1_FINAL_ROOT, 1, ChitLogPins.EPOCH2_OPENING_ROOT
        );
        assertEq(witness.epoch(), 2);
        assertEq(witness.treeSize(), 1);
        assertEq(witness.root(), ChitLogPins.EPOCH2_OPENING_ROOT);
    }

    function test_epoch2RejectsAnyOtherOpening() public {
        vm.prank(owner);
        vm.expectRevert(ChitLogWitness.PinMismatch.selector);
        witness.declareEpoch(2, 4, ChitLogPins.EPOCH1_FINAL_ROOT, 1, bytes32(uint256(9)));
    }

    function test_appenderCannotDeclareOrChangeRoles() public {
        vm.startPrank(appender);
        vm.expectRevert(abi.encodeWithSelector(ChitLogWitness.NotOwner.selector, appender));
        witness.declareEpoch(
            2, 4, ChitLogPins.EPOCH1_FINAL_ROOT, 1, ChitLogPins.EPOCH2_OPENING_ROOT
        );
        vm.expectRevert(abi.encodeWithSelector(ChitLogWitness.NotOwner.selector, appender));
        witness.setAppender(other);
        vm.expectRevert(abi.encodeWithSelector(ChitLogWitness.NotOwner.selector, appender));
        witness.transferOwner(other);
        vm.stopPrank();
        assertEq(witness.appender(), appender);
        assertEq(witness.owner(), owner);
        assertEq(witness.epoch(), 1);
    }

    function test_ownerCannotAppend() public {
        bytes32[] memory proof = new bytes32[](0);
        vm.prank(owner);
        vm.expectRevert(abi.encodeWithSelector(ChitLogWitness.NotAppender.selector, owner));
        witness.append(5, bytes32(uint256(1)), proof);
    }

    function test_ownerCanReplaceTheAppenderAndOnlyTheNewOneAppends() public {
        vm.prank(owner);
        witness.setAppender(other);
        assertEq(witness.appender(), other);
        bytes32[] memory proof = new bytes32[](0);
        vm.prank(appender);
        vm.expectRevert(abi.encodeWithSelector(ChitLogWitness.NotAppender.selector, appender));
        witness.append(5, bytes32(uint256(1)), proof);
    }

    function test_ethTransferReverts() public {
        vm.deal(address(this), 1 ether);
        (bool ok,) = address(witness).call{value: 1 ether}("");
        assertFalse(ok);
        assertEq(address(witness).balance, 0);
    }

    function test_vectorsMatchTheGoFixture() public view {
        string memory raw = vm.readFile("services/gateway/test/fixtures/rfc6962-consistency-40.txt");
        string[] memory lines = vm.split(raw, "\n");
        uint256 checked = 0;
        uint256 extensions = 0;
        for (uint256 i = 0; i < lines.length; i++) {
            if (bytes(lines[i]).length == 0) continue;
            string[] memory parts = vm.split(lines[i], " ");
            uint256 m = vm.parseUint(parts[0]);
            uint256 n = vm.parseUint(parts[1]);
            bytes32 oldRoot = vm.parseBytes32(string.concat("0x", parts[2]));
            bytes32 newRoot = vm.parseBytes32(string.concat("0x", parts[3]));
            bytes32[] memory proof = _proof(parts[4]);
            assertTrue(Rfc6962.verify(m, n, oldRoot, newRoot, proof), lines[i]);
            if (m < n) {
                extensions++;
                if (proof.length > 0) {
                    proof[0] = bytes32(uint256(proof[0]) ^ 1);
                    assertFalse(Rfc6962.verify(m, n, oldRoot, newRoot, proof));
                }
            }
            checked++;
        }
        assertEq(checked, 820);
        assertEq(extensions, 780);
    }

    function test_appendUsesTheOffChainProofAndRejectsAShrink() public {
        (uint256 m, uint256 n, bytes32 oldRoot, bytes32 newRoot, bytes32[] memory proof) = _one(4, 8, 7);
        ChitLogWitness local = new ChitLogWitness(owner, appender, 3, m, oldRoot);
        vm.prank(appender);
        vm.expectRevert(abi.encodeWithSelector(ChitLogWitness.SizeNotExtended.selector, m, m));
        local.append(m, newRoot, proof);
        uint256 gasBefore = gasleft();
        vm.prank(appender);
        local.append(n, newRoot, proof);
        uint256 used = gasBefore - gasleft();
        console2.log("append gas m=4 n=8", used);
        assertEq(local.treeSize(), n);
        assertEq(local.root(), newRoot);
        assertFalse(local.accepts(n, newRoot, proof));
        bytes32[] memory wrong = proof;
        if (wrong.length > 0) wrong[0] = bytes32(uint256(1));
        vm.prank(appender);
        vm.expectRevert(ChitLogWitness.ProofRejected.selector);
        local.append(n + 1, bytes32(uint256(2)), wrong);
    }

    function testFuzz_appendMatchesJs(uint8 nRaw, uint8 mRaw, uint64 seed) public {
        uint256 n = bound(nRaw, 2, 40);
        uint256 m = bound(mRaw, 1, n - 1);
        (uint256 gotM, uint256 gotN, bytes32 oldRoot, bytes32 newRoot, bytes32[] memory proof) = _one(m, n, seed);
        assertEq(gotM, m);
        assertEq(gotN, n);
        ChitLogWitness local = new ChitLogWitness(owner, appender, 4, m, oldRoot);
        assertTrue(local.accepts(n, newRoot, proof));
        vm.prank(appender);
        local.append(n, newRoot, proof);
        assertEq(local.treeSize(), n);
        assertEq(local.root(), newRoot);
        vm.prank(appender);
        vm.expectRevert(abi.encodeWithSelector(ChitLogWitness.SizeNotExtended.selector, n, m));
        local.append(m, oldRoot, proof);
    }

    function test_gasLargerAppend() public {
        (uint256 m, uint256 n, bytes32 oldRoot, bytes32 newRoot, bytes32[] memory proof) = _one(32, 40, 99);
        ChitLogWitness local = new ChitLogWitness(owner, appender, 3, m, oldRoot);
        uint256 gasBefore = gasleft();
        vm.prank(appender);
        local.append(n, newRoot, proof);
        console2.log("append gas m=32 n=40", gasBefore - gasleft());
        assertEq(local.root(), newRoot);
    }

    function test_preflightCushionRollsBack() public {
        DeployChitLogWitness deploy = new DeployChitLogWitness();
        uint256 codeBefore = address(witness).code.length;
        (uint256 measured, uint256 cushioned) = deploy.preflight(owner, appender);
        assertEq(measured, deploy.DECLARE_EPOCH_GAS_MAX());
        assertEq(cushioned, deploy.cushionGas(measured));
        assertEq(deploy.cushionGas(deploy.APPEND_GAS_MAX()), 72_000);
        assertEq(deploy.cushionGas(deploy.DECLARE_EPOCH_GAS_MAX()), 60_000);
        assertEq(address(witness).code.length, codeBefore);
        assertEq(witness.epoch(), 1);
        console2.log("declareEpoch preflight gas", measured);
        console2.log("declareEpoch cushioned gas", cushioned);
    }

    function _one(uint256 m, uint256 n, uint256 seed)
        internal
        returns (uint256, uint256, bytes32, bytes32, bytes32[] memory)
    {
        string[] memory cmd = new string[](6);
        cmd[0] = "node";
        cmd[1] = "services/gateway/scripts/rfc6962-dump.mjs";
        cmd[2] = "--one";
        cmd[3] = vm.toString(m);
        cmd[4] = vm.toString(n);
        cmd[5] = vm.toString(seed);
        string memory line = string(vm.ffi(cmd));
        // ffi keeps the trailing newline some runtimes add.
        string[] memory parts = vm.split(line, " ");
        return (
            vm.parseUint(parts[0]),
            vm.parseUint(parts[1]),
            vm.parseBytes32(string.concat("0x", parts[2])),
            vm.parseBytes32(string.concat("0x", parts[3])),
            _proof(_trim(parts[4]))
        );
    }

    function _trim(string memory body) internal pure returns (string memory) {
        bytes memory raw = bytes(body);
        uint256 len = raw.length;
        while (len > 0 && (raw[len - 1] == bytes1(0x0a) || raw[len - 1] == bytes1(0x0d))) len--;
        if (len == raw.length) return body;
        bytes memory out = new bytes(len);
        for (uint256 i = 0; i < len; i++) out[i] = raw[i];
        return string(out);
    }

    function _proof(string memory body) internal pure returns (bytes32[] memory nodes) {
        if (keccak256(bytes(body)) == keccak256("-")) return new bytes32[](0);
        string[] memory parts = vm.split(body, ",");
        nodes = new bytes32[](parts.length);
        for (uint256 i = 0; i < parts.length; i++) {
            nodes[i] = vm.parseBytes32(string.concat("0x", parts[i]));
        }
    }
}

contract ChitLogWitnessInvariant is Test {
    ChitLogWitness witness;
    AppenderHandler handler;

    function setUp() public {
        witness = new ChitLogWitness(
            address(this), address(0xA11), 1, ChitLogPins.EPOCH1_FINAL_SIZE, ChitLogPins.EPOCH1_FINAL_ROOT
        );
        handler = new AppenderHandler(witness, address(0xA11));
        targetContract(address(handler));
    }

    /// The appender is the only caller in this handler. Junk proofs revert.
    /// Epoch, size, root, and both roles stay on the pinned epoch-1 head.
    function invariant_appenderCannotMoveTheHead() public view {
        assertEq(witness.epoch(), 1);
        assertEq(witness.treeSize(), 4);
        assertEq(witness.root(), ChitLogPins.EPOCH1_FINAL_ROOT);
        assertEq(witness.owner(), address(this));
        assertEq(witness.appender(), address(0xA11));
    }
}

contract AppenderHandler is Test {
    ChitLogWitness public witness;
    address public appender;

    constructor(ChitLogWitness w, address a) {
        witness = w;
        appender = a;
    }

    function appendJunk(uint256 newSize, bytes32 newRoot, uint256 salt) external {
        bytes32[] memory proof = new bytes32[](newSize % 3);
        for (uint256 i = 0; i < proof.length; i++) proof[i] = bytes32(salt + i);
        vm.prank(appender);
        try witness.append(newSize, newRoot, proof) {} catch {}
    }

    function declareJunk(uint256 epoch, uint256 size, bytes32 root) external {
        vm.prank(appender);
        try witness.declareEpoch(epoch, 4, ChitLogPins.EPOCH1_FINAL_ROOT, size, root) {} catch {}
    }

    function stealRoles(address next) external {
        vm.prank(appender);
        try witness.setAppender(next) {} catch {}
        vm.prank(appender);
        try witness.transferOwner(next) {} catch {}
    }
}
