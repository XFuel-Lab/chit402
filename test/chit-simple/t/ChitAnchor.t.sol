// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Test, Vm} from "./utils/Test.sol";
import {ChitAnchor} from "chit-simple/ChitAnchor.sol";
import {Tree} from "./Tree.sol";

contract ChitAnchorTest is Test {
    uint256 internal constant HOUR = 3600;
    address internal constant EXAMPLE_DEPLOYER = 0x1111111111111111111111111111111111111111;
    address internal constant EXAMPLE_CHECKPOINT = 0x2222222222222222222222222222222222222222;

    ChitAnchor internal a;
    address internal cp = address(0xC0FFEE);
    bytes32 internal dom;

    function setUp() public {
        vm.chainId(84532);
        a = new ChitAnchor(cp);
        dom = a.domain();
    }

    function _roots(uint256 n) internal pure returns (bytes32 root, bytes32[] memory proof, bytes32[] memory leaves) {
        leaves = new bytes32[](n);
        for (uint256 i = 0; i < n; i++) leaves[i] = bytes32(uint256(i + 1));
        root = n == 0 ? sha256("") : Tree.mth(leaves);
        if (n == 0) proof = new bytes32[](0);
        else proof = Tree.consistency(leaves, n - 1, n);
    }

    function _seal(uint256 n, bytes32 state) internal {
        (bytes32 root, bytes32[] memory proof,) = _roots(n);
        uint256 hour = n * HOUR;
        vm.warp(hour + HOUR);
        vm.prank(a.checkpoint());
        a.anchor(dom, uint64(n), uint64(hour), uint64(n), root, state, proof);
    }

    function test_initial_head_is_empty_tree() public view {
        (uint64 epoch, uint64 hour, uint64 size, bytes32 root, bytes32 state) = a.latest();
        assertEq(epoch, 0, "epoch");
        assertEq(hour, 0, "hour");
        assertEq(size, 0, "size");
        assertEq(root, sha256(""), "root");
        assertEq(state, bytes32(0), "state");
        assertEq(a.checkpoint(), cp, "checkpoint");
        assertEq(a.checkpointVersion(), 1, "version");
    }

    function test_domain_matches_formula() public view {
        bytes32 expect = sha256(abi.encodePacked("chit402-checkpoint-v1", uint64(block.chainid), address(a)));
        assertEq(a.domain(), expect, "domain");
        assertEq(block.chainid, 84532, "chain");
    }

    function test_illustrative_domain_on_chain_8453() public pure {
        address synthetic = address(uint160(0x3333333333333333333333333333333333333333));
        bytes32 got = sha256(abi.encodePacked("chit402-checkpoint-v1", uint64(8453), synthetic));
        assertEq(got, hex"1ec6130d39d03ed3b8bce8139d615ffe17377a1cf2cab8f4b7bf98f45dda27b0", "illustrative");
    }

    function test_constructor_rejects_zero_checkpoint() public {
        vm.expectRevert(ChitAnchor.ZeroCheckpoint.selector);
        new ChitAnchor(address(0));
    }

    function test_constructor_emits_initial_rotation() public {
        vm.recordLogs();
        ChitAnchor fresh = new ChitAnchor(cp);
        Vm.Log[] memory logs = vm.getRecordedLogs();
        assertEq(logs.length, 1, "one log");
        assertEq(logs[0].topics.length, 1, "no indexed fields");
        assertEq(logs[0].topics[0], keccak256("CheckpointKeyRotated(uint64,address,address)"), "topic0");
        assertEq(logs[0].data, abi.encode(uint64(1), address(0), cp), "data");
        assertEq(logs[0].emitter, address(fresh), "emitter");
        assertEq(fresh.checkpointVersion(), 1, "version");
    }

    function test_genesis_anchor_and_event_bytes() public {
        (bytes32 root,,) = _roots(1);
        bytes32 state = bytes32(uint256(0x51a7e));
        vm.warp(HOUR + HOUR);
        vm.recordLogs();
        vm.prank(cp);
        a.anchor(dom, 1, uint64(HOUR), 1, root, state, new bytes32[](0));

        Vm.Log[] memory logs = vm.getRecordedLogs();
        assertEq(logs.length, 1, "one log");
        assertEq(logs[0].emitter, address(a), "emitter");
        assertEq(logs[0].topics.length, 3, "topics");
        assertEq(logs[0].topics[0], keccak256("Anchored(uint64,uint64,uint64,bytes32,bytes32,uint8)"), "topic0");
        assertEq(logs[0].topics[1], bytes32(uint256(1)), "epoch topic");
        assertEq(logs[0].topics[2], bytes32(uint256(HOUR)), "hour topic");
        assertEq(logs[0].data, abi.encode(uint64(1), root, state, uint8(0)), "data");

        string memory json = vm.readFile("../../contracts/chit-simple/vectors/anchored-topic0.json");
        string memory signature = vm.parseJsonString(json, ".anchored.signature");
        assertEq(signature, "Anchored(uint64,uint64,uint64,bytes32,bytes32,uint8)", "signature");
        assertEq(logs[0].topics[0], keccak256(bytes(signature)), "topic matches signature");
        assertEq(vm.parseJsonString(json, ".anchored.topic0"), "0xbc37f50aefd1f20e30781db115c88ea4bb3263e504eb6e61653fb9e4f1b7b75e", "pinned topic0");
        assertEq(vm.parseJsonUint(json, ".anchored.kind_v0"), 0, "kind v0");
        (uint64 epoch, uint64 hour, uint64 size, bytes32 stored, bytes32 storedState) = a.latest();
        assertEq(epoch, 1, "epoch");
        assertEq(hour, HOUR, "hour");
        assertEq(size, 1, "size");
        assertEq(stored, root, "root");
        assertEq(storedState, state, "state");
    }

    function test_revert_not_checkpoint() public {
        (bytes32 root,,) = _roots(1);
        vm.warp(HOUR + HOUR);
        vm.prank(address(0xB0B));
        vm.expectRevert(ChitAnchor.NotCheckpoint.selector);
        a.anchor(dom, 1, uint64(HOUR), 1, root, bytes32(0), new bytes32[](0));
    }

    function test_revert_bad_domain() public {
        (bytes32 root,,) = _roots(1);
        vm.warp(HOUR + HOUR);
        vm.prank(cp);
        vm.expectRevert(ChitAnchor.BadDomain.selector);
        a.anchor(bytes32(uint256(1)), 1, uint64(HOUR), 1, root, bytes32(0), new bytes32[](0));
    }

    function test_revert_bad_epoch_zero_and_skip() public {
        (bytes32 root,,) = _roots(1);
        vm.warp(HOUR + HOUR);
        vm.prank(cp);
        vm.expectRevert(ChitAnchor.BadEpoch.selector);
        a.anchor(dom, 0, uint64(HOUR), 1, root, bytes32(0), new bytes32[](0));
        vm.prank(cp);
        vm.expectRevert(ChitAnchor.BadEpoch.selector);
        a.anchor(dom, 2, uint64(HOUR), 1, root, bytes32(0), new bytes32[](0));
    }

    function test_revert_replay_epoch() public {
        _seal(1, bytes32(uint256(1)));
        (bytes32 root,,) = _roots(1);
        vm.prank(cp);
        vm.expectRevert(ChitAnchor.BadEpoch.selector);
        a.anchor(dom, 1, uint64(HOUR), 1, root, bytes32(0), new bytes32[](0));
    }

    function test_revert_bad_hour_alignment() public {
        (bytes32 root,,) = _roots(1);
        vm.warp(10 * HOUR);
        vm.prank(cp);
        vm.expectRevert(ChitAnchor.BadHour.selector);
        a.anchor(dom, 1, 3601, 1, root, bytes32(0), new bytes32[](0));
    }

    function test_revert_hour_not_increasing() public {
        _seal(1, bytes32(uint256(1)));
        (bytes32 root, bytes32[] memory proof,) = _roots(2);
        vm.warp(4 * HOUR);
        vm.prank(cp);
        vm.expectRevert(ChitAnchor.HourNotIncreasing.selector);
        a.anchor(dom, 2, uint64(HOUR), 2, root, bytes32(uint256(2)), proof);
        vm.prank(cp);
        vm.expectRevert(ChitAnchor.HourNotIncreasing.selector);
        a.anchor(dom, 2, 0, 2, root, bytes32(uint256(2)), proof);
    }

    function test_revert_unfinished_current_hour() public {
        _seal(1, bytes32(uint256(1)));
        (bytes32 root, bytes32[] memory proof,) = _roots(2);
        vm.warp((2 * HOUR) + 100);
        vm.prank(cp);
        vm.expectRevert(ChitAnchor.HourNotFinished.selector);
        a.anchor(dom, 2, uint64(2 * HOUR), 2, root, bytes32(uint256(2)), proof);
    }

    function test_revert_future_hour() public {
        (bytes32 root,,) = _roots(1);
        vm.warp(HOUR + 10);
        vm.prank(cp);
        vm.expectRevert(ChitAnchor.HourNotFinished.selector);
        a.anchor(dom, 1, uint64(2 * HOUR), 1, root, bytes32(0), new bytes32[](0));
    }

    function test_revert_one_second_before_hour_ends() public {
        _seal(1, bytes32(uint256(1)));
        (bytes32 root, bytes32[] memory proof,) = _roots(2);
        vm.warp((3 * HOUR) - 1);
        vm.prank(cp);
        vm.expectRevert(ChitAnchor.HourNotFinished.selector);
        a.anchor(dom, 2, uint64(2 * HOUR), 2, root, bytes32(uint256(2)), proof);
    }

    function test_hour_accepted_when_it_ends_exactly_now() public {
        _seal(1, bytes32(uint256(1)));
        (bytes32 root, bytes32[] memory proof,) = _roots(2);
        vm.warp(3 * HOUR);
        vm.prank(cp);
        a.anchor(dom, 2, uint64(2 * HOUR), 2, root, bytes32(uint256(2)), proof);
        (, uint64 hour, uint64 size, bytes32 stored,) = a.latest();
        assertEq(hour, 2 * HOUR, "hour");
        assertEq(size, 2, "size");
        assertEq(stored, root, "root");
    }

    function test_revert_size_not_increasing() public {
        (bytes32 root,,) = _roots(1);
        vm.warp(HOUR + HOUR);
        vm.prank(cp);
        vm.expectRevert(ChitAnchor.SizeNotIncreasing.selector);
        a.anchor(dom, 1, uint64(HOUR), 0, root, bytes32(0), new bytes32[](0));

        _seal(1, bytes32(uint256(1)));
        vm.warp(4 * HOUR);
        vm.prank(cp);
        vm.expectRevert(ChitAnchor.SizeNotIncreasing.selector);
        a.anchor(dom, 2, uint64(2 * HOUR), 1, root, bytes32(uint256(2)), new bytes32[](0));
        vm.prank(cp);
        vm.expectRevert(ChitAnchor.SizeNotIncreasing.selector);
        a.anchor(dom, 2, uint64(2 * HOUR), 0, root, bytes32(uint256(2)), new bytes32[](0));
    }

    function test_revert_genesis_nonempty_proof() public {
        (bytes32 root,,) = _roots(1);
        bytes32[] memory proof = new bytes32[](1);
        proof[0] = bytes32(uint256(9));
        vm.warp(HOUR + HOUR);
        vm.prank(cp);
        vm.expectRevert(ChitAnchor.BadConsistency.selector);
        a.anchor(dom, 1, uint64(HOUR), 1, root, bytes32(0), proof);
    }

    function test_genesis_accepted_only_once() public {
        _seal(1, bytes32(uint256(1)));
        (,, uint64 size,,) = a.latest();
        assertGt(size, 0, "sealed");
        vm.warp(3 * HOUR);
        vm.prank(cp);
        vm.expectRevert(ChitAnchor.BadConsistency.selector);
        a.anchor(dom, 2, uint64(2 * HOUR), 2, bytes32(uint256(4)), bytes32(uint256(4)), new bytes32[](0));
    }

    function test_revert_bad_extension_proof() public {
        _seal(1, bytes32(uint256(1)));
        (bytes32 root, bytes32[] memory proof,) = _roots(2);
        proof[0] = bytes32(uint256(uint256(proof[0]) ^ 1));
        vm.warp(3 * HOUR);
        vm.prank(cp);
        vm.expectRevert(ChitAnchor.BadConsistency.selector);
        a.anchor(dom, 2, uint64(2 * HOUR), 2, root, bytes32(uint256(2)), proof);
    }

    function test_size_above_js_safe_integer_cap() public {
        uint64 above = uint64(1) << 53;
        assertEq(uint256(above), 9007199254740992, "2^53");
        vm.warp(HOUR + HOUR);
        vm.prank(cp);
        a.anchor(dom, 1, uint64(HOUR), above, bytes32(uint256(1)), bytes32(uint256(2)), new bytes32[](0));
        (,, uint64 size,,) = a.latest();
        assertEq(size, above, "size");
    }

    function test_size_uint64_max_accepted_at_genesis() public {
        vm.warp(HOUR + HOUR);
        vm.prank(cp);
        a.anchor(dom, 1, uint64(HOUR), type(uint64).max, bytes32(uint256(3)), bytes32(uint256(4)), new bytes32[](0));
        (,, uint64 size,,) = a.latest();
        assertEq(size, type(uint64).max, "max");
    }

    function test_rotation_event_and_old_key_refused() public {
        address next = address(0xBEEF);
        vm.recordLogs();
        vm.prank(cp);
        a.rotateCheckpointKey(next, 2);
        Vm.Log[] memory logs = vm.getRecordedLogs();
        assertEq(logs.length, 1, "one log");
        assertEq(logs[0].topics[0], keccak256("CheckpointKeyRotated(uint64,address,address)"), "topic0");
        assertEq(logs[0].topics.length, 1, "unindexed");
        assertEq(logs[0].data, abi.encode(uint64(2), cp, next), "data");
        assertEq(a.checkpoint(), next, "checkpoint");
        assertEq(a.checkpointVersion(), 2, "version");

        (bytes32 root,,) = _roots(1);
        vm.warp(HOUR + HOUR);
        vm.prank(cp);
        vm.expectRevert(ChitAnchor.NotCheckpoint.selector);
        a.anchor(dom, 1, uint64(HOUR), 1, root, bytes32(0), new bytes32[](0));
        vm.prank(next);
        a.anchor(dom, 1, uint64(HOUR), 1, root, bytes32(uint256(1)), new bytes32[](0));
        (uint64 epoch,,,,) = a.latest();
        assertEq(epoch, 1, "anchored");
    }

    function test_revert_rotate_sender_zero_same_and_version() public {
        vm.prank(address(0xB0B));
        vm.expectRevert(ChitAnchor.NotCheckpoint.selector);
        a.rotateCheckpointKey(address(0xBEEF), 2);

        vm.prank(cp);
        vm.expectRevert(ChitAnchor.ZeroCheckpoint.selector);
        a.rotateCheckpointKey(address(0), 2);

        vm.prank(cp);
        vm.expectRevert(ChitAnchor.SameCheckpoint.selector);
        a.rotateCheckpointKey(cp, 2);

        vm.prank(cp);
        vm.expectRevert(ChitAnchor.BadVersion.selector);
        a.rotateCheckpointKey(address(0xBEEF), 1);
        vm.prank(cp);
        vm.expectRevert(ChitAnchor.BadVersion.selector);
        a.rotateCheckpointKey(address(0xBEEF), 0);

        vm.prank(cp);
        a.rotateCheckpointKey(address(0xBEEF), 5);
        assertEq(a.checkpointVersion(), 5, "skipped ahead");
        vm.prank(address(0xBEEF));
        vm.expectRevert(ChitAnchor.BadVersion.selector);
        a.rotateCheckpointKey(address(0xCAFE), 4);
        vm.prank(address(0xBEEF));
        a.rotateCheckpointKey(address(0xCAFE), 6);
        assertEq(a.checkpoint(), address(0xCAFE), "second");
    }

    function test_eth_transfer_reverts_and_balance_stays_zero() public {
        vm.deal(address(this), 1 ether);
        (bool ok,) = address(a).call{value: 1 ether}("");
        assertFalse(ok, "plain value");
        assertEq(address(a).balance, 0, "balance");

        (bytes32 root,,) = _roots(1);
        vm.warp(HOUR + HOUR);
        vm.prank(cp);
        (ok,) = address(a).call{value: 1}(
            abi.encodeCall(ChitAnchor.anchor, (dom, uint64(1), uint64(HOUR), uint64(1), root, bytes32(0), new bytes32[](0)))
        );
        assertFalse(ok, "anchor value");
        assertEq(address(a).balance, 0, "balance after anchor");

        vm.prank(cp);
        (ok,) = address(a).call{value: 1}(abi.encodeCall(ChitAnchor.rotateCheckpointKey, (address(0xBEEF), uint64(2))));
        assertFalse(ok, "rotate value");
        assertEq(address(a).balance, 0, "balance after rotate");
        assertEq(a.checkpoint(), cp, "key unchanged");
    }

    function test_source_has_no_owner_proxy_or_value_path() public view {
        string memory anchorSrc = vm.readFile("../../contracts/chit-simple/ChitAnchor.sol");
        string memory rfcSrc = vm.readFile("../../contracts/chit-simple/Rfc9162.sol");
        string memory both = string.concat(anchorSrc, rfcSrc);
        assertFalse(_has(both, "delegatecall"), "delegatecall");
        assertFalse(_has(both, "selfdestruct"), "selfdestruct");
        assertFalse(_has(both, "suicide"), "suicide");
        assertFalse(_has(both, "payable"), "payable");
        assertFalse(_has(both, "Ownable"), "ownable");
        assertFalse(_has(both, "upgradeTo"), "upgrade");
        assertFalse(_has(both, "max_tree_size"), "cap");
        assertFalse(_has(both, "9007199254740991"), "js cap");
    }

    function test_known_tree_roots_and_subproof() public pure {
        bytes32[9] memory roots;
        roots[0] = hex"e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855";
        roots[1] = hex"34c4c2f144a01ce94c3b9e76b0243d82913915bf72d08f1677fa045a821f3240";
        roots[2] = hex"af7894942c289da190349dd80b14443eaa6feeb5be12ff962cbc4b457fdc208e";
        roots[3] = hex"956971f06cf87803c8809455f38daadb47f4ce4467d3383bc8a5f4e836c29d30";
        roots[4] = hex"384db7dc2989e8a2d518e3ec7fadc2a30621853c4e2a67caa92ef0b5f9bfd460";
        roots[5] = hex"1d542b71a71ee8d6b249ad997194ec8cc56bd45fed5f011ab428c281acb33d80";
        roots[6] = hex"f6bd6b5baa7bf1288a0c7ce4d2b518673d197a5199c9506aaa604b6d71401818";
        roots[7] = hex"3bfc4110fea1fea35c0b41ae66bf1fb230e1118efc749ab5ab95b1cf47c5cbcb";
        roots[8] = hex"10271298c76ddcbceee6ebdbb8fb536f26ced0dbf3c67126907a649b75dd9d5a";
        bytes32[] memory leaves = new bytes32[](8);
        for (uint32 i = 0; i < 8; i++) {
            leaves[i] = sha256(abi.encodePacked("chit402-rfc9162-vector-v1", i));
        }
        assertEq(sha256(""), roots[0], "empty");
        for (uint256 n = 1; n <= 8; n++) {
            bytes32[] memory prefix = new bytes32[](n);
            for (uint256 i = 0; i < n; i++) prefix[i] = leaves[i];
            assertEq(Tree.mth(prefix), roots[n], "root");
        }
        bytes32[] memory two = new bytes32[](2);
        two[0] = leaves[0];
        two[1] = leaves[1];
        bytes32[] memory proof = Tree.consistency(two, 1, 2);
        assertEq(proof.length, 1, "proof len");
        assertEq(proof[0], hex"8ba1de6456862fd596ddd993c93c47eaca9c5400e219214a8bfbaa3c2b7d9df9", "subproof");
    }

    function test_example_runtime_code_hash() public {
        vm.chainId(84532);
        vm.setNonce(EXAMPLE_DEPLOYER, 0);
        address predicted = vm.computeCreateAddress(EXAMPLE_DEPLOYER, 0);
        vm.prank(EXAMPLE_DEPLOYER);
        ChitAnchor deployed = new ChitAnchor(EXAMPLE_CHECKPOINT);
        assertEq(address(deployed), predicted, "create address");
        string memory json = vm.readFile("../../deploy/chit-simple/sepolia-pack/expected-runtime.json");
        string memory wantAddr = vm.parseJsonString(json, ".example.contract");
        string memory wantHash = vm.parseJsonString(json, ".example.runtimeCodeHash");
        string memory gotAddr = _addr(address(deployed));
        string memory gotHash = string.concat("0x", _hex(keccak256(address(deployed).code)));
        if (keccak256(bytes(gotAddr)) != keccak256(bytes(wantAddr))) revert(gotAddr);
        if (keccak256(bytes(gotHash)) != keccak256(bytes(wantHash))) revert(gotHash);
        assertEq(vm.parseJsonUint(json, ".example.chainId"), 84532, "chain");
        assertEq(vm.parseJsonUint(json, ".example.nonce"), 0, "nonce");
    }

    function test_gas_anchor_genesis() public {
        vm.pauseGasMetering();
        (bytes32 root,,) = _roots(1);
        vm.warp(HOUR + HOUR);
        vm.resumeGasMetering();
        vm.prank(cp);
        a.anchor(dom, 1, uint64(HOUR), 1, root, bytes32(uint256(1)), new bytes32[](0));
        vm.pauseGasMetering();
    }

    function test_gas_anchor_extend() public {
        vm.pauseGasMetering();
        _seal(1, bytes32(uint256(1)));
        (bytes32 root, bytes32[] memory proof,) = _roots(2);
        vm.warp(3 * HOUR);
        vm.resumeGasMetering();
        vm.prank(cp);
        a.anchor(dom, 2, uint64(2 * HOUR), 2, root, bytes32(uint256(2)), proof);
        vm.pauseGasMetering();
    }

    function test_gas_rotate() public {
        vm.pauseGasMetering();
        vm.resumeGasMetering();
        vm.prank(cp);
        a.rotateCheckpointKey(address(0xBEEF), 2);
        vm.pauseGasMetering();
    }

    function _hex(bytes32 v) private pure returns (string memory) {
        bytes memory alphabet = "0123456789abcdef";
        bytes memory out = new bytes(64);
        for (uint256 i = 0; i < 32; i++) {
            out[i * 2] = alphabet[uint8(v[i]) >> 4];
            out[i * 2 + 1] = alphabet[uint8(v[i]) & 0x0f];
        }
        return string(out);
    }

    function _addr(address who) private pure returns (string memory) {
        bytes memory full = bytes(_hex(bytes32(uint256(uint160(who)))));
        bytes memory out = new bytes(40);
        for (uint256 i = 0; i < 40; i++) out[i] = full[i + 24];
        return string.concat("0x", string(out));
    }
}
