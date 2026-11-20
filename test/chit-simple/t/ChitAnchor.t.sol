// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Test, Vm} from "./utils/Test.sol";
import {ChitAnchor} from "chit-simple/ChitAnchor.sol";
import {Tree} from "./Tree.sol";

contract ChitAnchorTest is Test {
    uint256 internal constant HOUR = 3600;
    address internal constant EXAMPLE_DEPLOYER = 0x1111111111111111111111111111111111111111;
    address internal constant EXAMPLE_CHECKPOINT = 0x2222222222222222222222222222222222222222;
    address internal constant EXAMPLE_CONTROLLER = 0x4444444444444444444444444444444444444444;

    ChitAnchor internal a;
    address internal cp = address(0xC0FFEE);
    address internal ctrl = address(0xC0117011);
    bytes32 internal dom;

    function setUp() public {
        vm.chainId(84532);
        a = new ChitAnchor(cp, ctrl);
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
        assertEq(a.controller(), ctrl, "controller");
        assertEq(a.ROTATION_DELAY(), 24 hours, "delay");
        (uint8 kind,,,) = a.pendingAction();
        assertEq(uint256(kind), 0, "empty slot");
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
        new ChitAnchor(address(0), ctrl);
    }

    function test_constructor_emits_initial_rotation() public {
        vm.recordLogs();
        ChitAnchor fresh = new ChitAnchor(cp, ctrl);
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
        vm.prank(ctrl);
        a.proposeRotation(next, 2);
        (,,, uint64 eta) = a.pendingAction();
        vm.warp(eta);
        vm.recordLogs();
        vm.prank(ctrl);
        a.executePending();
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
        vm.expectRevert(ChitAnchor.NotController.selector);
        a.proposeRotation(address(0xBEEF), 2);

        vm.prank(ctrl);
        vm.expectRevert(ChitAnchor.ZeroCheckpoint.selector);
        a.proposeRotation(address(0), 2);

        vm.prank(ctrl);
        vm.expectRevert(ChitAnchor.SameCheckpoint.selector);
        a.proposeRotation(cp, 2);

        vm.prank(ctrl);
        vm.expectRevert(ChitAnchor.BadVersion.selector);
        a.proposeRotation(address(0xBEEF), 1);
        vm.prank(ctrl);
        vm.expectRevert(ChitAnchor.BadVersion.selector);
        a.proposeRotation(address(0xBEEF), 0);

        vm.prank(ctrl);
        a.proposeRotation(address(0xBEEF), 5);
        (,,, uint64 eta) = a.pendingAction();
        vm.warp(eta);
        vm.prank(ctrl);
        a.executePending();
        assertEq(uint256(a.checkpointVersion()), 5, "skipped ahead");
        vm.prank(address(0xBEEF));
        vm.expectRevert(ChitAnchor.NotController.selector);
        a.proposeRotation(address(0xCAFE), 6);
        vm.prank(ctrl);
        vm.expectRevert(ChitAnchor.BadVersion.selector);
        a.proposeRotation(address(0xCAFE), 4);
        vm.prank(ctrl);
        a.proposeRotation(address(0xCAFE), 6);
        (,,, eta) = a.pendingAction();
        vm.warp(eta);
        vm.prank(ctrl);
        a.executePending();
        assertEq(a.checkpoint(), address(0xCAFE), "second");
        assertEq(uint256(a.checkpointVersion()), 6, "version");
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

        vm.prank(ctrl);
        (ok,) = address(a).call{value: 1}(abi.encodeCall(ChitAnchor.proposeRotation, (address(0xBEEF), uint64(2))));
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
        ChitAnchor deployed = new ChitAnchor(EXAMPLE_CHECKPOINT, EXAMPLE_CONTROLLER);
        assertEq(address(deployed), predicted, "create address");
        string memory json = vm.readFile("../../deploy/chit-simple/sepolia-pack/expected-runtime.json");
        string memory wantAddr = vm.parseJsonString(json, ".example.contract");
        string memory wantHash = vm.parseJsonString(json, ".example.runtimeCodeHash");
        string memory gotAddr = _addr(address(deployed));
        string memory gotHash = string.concat("0x", _hex(keccak256(address(deployed).code)));
        if (keccak256(bytes(gotAddr)) != keccak256(bytes(wantAddr))) revert(gotAddr);
        if (keccak256(bytes(gotHash)) != keccak256(bytes(wantHash))) revert(gotHash);
        string memory preview = vm.readFile("cache/pack-preview.txt");
        assertTrue(_has(preview, gotAddr), "pack address");
        assertTrue(_has(preview, gotHash), "pack hash");
        assertEq(vm.parseJsonUint(json, ".example.chainId"), 84532, "chain");
        assertEq(vm.parseJsonUint(json, ".example.nonce"), 0, "nonce");
        assertEq(vm.parseJsonString(json, ".bytecodeHash"), "none", "bytecode hash");
        assertEq(vm.parseJsonString(json, ".evmVersion"), "cancun", "cancun");
        assertEq(vm.parseJsonString(json, ".example.controller"), "0x4444444444444444444444444444444444444444", "controller");
    }

    function test_pack_has_no_key_on_argv() public view {
        string memory root = "../../deploy/chit-simple/sepolia-pack/";
        _noKey(string.concat(root, "README.md"));
        _noKey(string.concat(root, "DeployChitAnchor.s.sol"));
        _noKey(string.concat(root, "print-runtime.mjs"));
        _noKey(string.concat(root, "check-deploy.mjs"));
        _noKey(string.concat(root, "foundry.toml"));
        _noKey(string.concat(root, "constructor-args.json"));
        _noKey(string.concat(root, "expected-runtime.json"));
    }

    function test_pack_scan_rejects_each_pattern() public pure {
        assertEq(_reject("0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"), "raw-hex", "raw-hex");
        assertEq(_reject(string.concat("forge --", "mnemonic word")), "mnemonic", "mnemonic");
        assertEq(_reject(string.concat("forge --", "mnemonics word")), "mnemonics", "mnemonics");
        assertEq(_reject(string.concat("forge --", "interactive")), "interactive", "interactive");
        assertEq(_reject(string.concat("forge --", "interactives")), "interactives", "interactives");
        assertEq(_reject(string.concat("cast --", "password")), "password", "password");
        assertEq(_reject(string.concat("DEPLOYER_", "PK")), "deployer-pk", "deployer-pk");
        assertEq(_reject(string.concat("FOO_", "PK")), "pk-suffix", "pk-suffix");
        assertEq(_reject(string.concat("ETH_", "PRIVATE_KEY")), "eth-private-key", "eth-private-key");
        assertEq(_reject(string.concat("vm.", "envUint")), "env-uint", "env-uint");
        assertEq(_reject(string.concat("vm.", "startBroadcast(secret)")), "broadcast-key", "broadcast-key");
        assertEq(_reject("vm.startBroadcast();"), "", "empty broadcast");
        assertEq(_reject(string.concat("--private-", "key")), "private-key", "private-key");
        assertEq(_reject(string.concat("PRIVATE_", "KEY")), "private-env", "private-env");
    }

    function _noKey(string memory path) private view {
        string memory text = vm.readFile(path);
        text = _cut(text, "cast wallet import <name> --interactive");
        text = _cut(text, "Never use --private-key.");
        assertEq(_reject(text), "", path);
    }

    function _cut(string memory text, string memory needle) private pure returns (string memory) {
        bytes memory b = bytes(text);
        bytes memory n = bytes(needle);
        if (n.length == 0 || b.length < n.length) return text;
        bytes memory out = new bytes(b.length);
        uint256 w = 0;
        uint256 i = 0;
        while (i < b.length) {
            bool match_ = i + n.length <= b.length;
            if (match_) {
                for (uint256 j = 0; j < n.length; j++) {
                    if (b[i + j] != n[j]) {
                        match_ = false;
                        break;
                    }
                }
            }
            if (match_) {
                i += n.length;
                continue;
            }
            out[w++] = b[i++];
        }
        bytes memory trimmed = new bytes(w);
        for (uint256 k = 0; k < w; k++) trimmed[k] = out[k];
        return string(trimmed);
    }

    function _reject(string memory text) private pure returns (string memory) {
        if (_has(text, string.concat("--private-", "key"))) return "private-key";
        if (_has(text, string.concat("ETH_", "PRIVATE_KEY"))) return "eth-private-key";
        if (_has(text, string.concat("PRIVATE_", "KEY"))) return "private-env";
        if (_has(text, string.concat("--", "mnemonics"))) return "mnemonics";
        if (_has(text, string.concat("--", "mnemonic"))) return "mnemonic";
        if (_has(text, string.concat("--", "interactives"))) return "interactives";
        if (_has(text, string.concat("--", "interactive"))) return "interactive";
        if (_has(text, string.concat("--", "password"))) return "password";
        if (_has(text, string.concat("DEPLOYER_", "PK"))) return "deployer-pk";
        if (_has(text, "_PK")) return "pk-suffix";
        if (_has(text, string.concat("vm.", "envUint"))) return "env-uint";
        if (_broadcastHasArg(text)) return "broadcast-key";
        if (_rawHex(text)) return "raw-hex";
        return "";
    }

    function _broadcastHasArg(string memory text) private pure returns (bool) {
        bytes memory b = bytes(text);
        bytes memory needle = bytes("startBroadcast(");
        for (uint256 i = 0; i + needle.length < b.length; i++) {
            bool match_ = true;
            for (uint256 j = 0; j < needle.length; j++) {
                if (b[i + j] != needle[j]) {
                    match_ = false;
                    break;
                }
            }
            if (!match_) continue;
            uint256 k = i + needle.length;
            while (k < b.length && (b[k] == " " || b[k] == "\n" || b[k] == "\t")) k++;
            if (k < b.length && b[k] != ")") return true;
        }
        return false;
    }

    function _rawHex(string memory text) private pure returns (bool) {
        bytes memory b = bytes(text);
        uint256 i = 0;
        while (i < b.length) {
            if (i + 1 < b.length && b[i] == "0" && (b[i + 1] == "x" || b[i + 1] == "X")) {
                uint256 start = i + 2;
                uint256 j = start;
                while (j < b.length && _hexChar(b[j])) j++;
                if (j - start == 64 && !_allowedHex(b, start)) return true;
                i = j;
                continue;
            }
            if (_hexChar(b[i])) {
                uint256 start = i;
                while (i < b.length && _hexChar(b[i])) i++;
                if (i - start == 64 && !_allowedHex(b, start)) return true;
            } else {
                i++;
            }
        }
        return false;
    }

    function _hexChar(bytes1 c) private pure returns (bool) {
        return (c >= "0" && c <= "9") || (c >= "a" && c <= "f") || (c >= "A" && c <= "F");
    }

    function _allowedHex(bytes memory b, uint256 start) private pure returns (bool) {
        bytes32 word = _parseHex(b, start);
        return word == hex"b7ad0c729af141a19695bc89d09bd0a04a8d9ab9668373a066cba94f13aee45c"
            || word == hex"bc37f50aefd1f20e30781db115c88ea4bb3263e504eb6e61653fb9e4f1b7b75e"
            || word == hex"95d3ad0e28a557ff091289f350472166359808c1308277737cd6cc7cacc4e8b3"
            || word == hex"e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"
            || word == hex"1ec6130d39d03ed3b8bce8139d615ffe17377a1cf2cab8f4b7bf98f45dda27b0";
    }

    function _parseHex(bytes memory b, uint256 start) private pure returns (bytes32 word) {
        for (uint256 i = 0; i < 64; i++) {
            uint8 d = uint8(b[start + i]);
            uint8 v;
            if (d >= 48 && d <= 57) v = d - 48;
            else if (d >= 97 && d <= 102) v = d - 87;
            else v = d - 55;
            word = (word << 4) | bytes32(uint256(v));
        }
    }

    function _sameHead(ChitAnchor.Head memory left, ChitAnchor.Head memory right) internal pure returns (bool) {
        return left.hourStart == right.hourStart
            && left.size == right.size
            && left.checkpointVersion == right.checkpointVersion
            && left.anchorBlock == right.anchorBlock
            && left.anchorTime == right.anchorTime
            && left.root == right.root
            && left.stateRoot == right.stateRoot;
    }

    function test_F1_anchor_writes_all_seven_head_fields() public {
        (bytes32 root,,) = _roots(1);
        bytes32 state = bytes32(uint256(0x51a7e));
        vm.warp(HOUR + HOUR);
        uint64 bn = uint64(block.number);
        uint40 ts = uint40(block.timestamp);
        assertTrue(bn != uint64(ts), "block and time differ");
        vm.prank(cp);
        a.anchor(dom, 1, uint64(HOUR), 1, root, state, new bytes32[](0));
        ChitAnchor.Head memory h = a.headAt(1);
        assertEq(h.hourStart, uint40(HOUR), "hourStart");
        assertEq(h.size, 1, "size");
        assertEq(h.checkpointVersion, 1, "version");
        assertEq(h.anchorBlock, bn, "anchorBlock");
        assertEq(h.anchorTime, ts, "anchorTime");
        assertEq(h.root, root, "root");
        assertEq(h.stateRoot, state, "stateRoot");
        assertTrue(h.root != h.stateRoot, "root is not stateRoot");
    }

    function test_F2_headAt_unwritten_is_zero() public view {
        ChitAnchor.Head memory z = a.headAt(9);
        assertEq(z.hourStart, 0, "hour");
        assertEq(z.size, 0, "size");
        assertEq(z.checkpointVersion, 0, "version");
        assertEq(z.anchorBlock, 0, "anchorBlock");
        assertEq(z.anchorTime, 0, "anchorTime");
        assertEq(z.root, bytes32(0), "root");
        assertEq(z.stateRoot, bytes32(0), "state");
    }

    function test_F3_reanchor_reverts_and_head_is_unchanged() public {
        _seal(1, bytes32(uint256(1)));
        ChitAnchor.Head memory before = a.headAt(1);
        (bytes32 root, bytes32[] memory proof,) = _roots(3);
        vm.warp(5 * HOUR);
        vm.prank(cp);
        vm.expectRevert(ChitAnchor.BadEpoch.selector);
        a.anchor(dom, 1, uint64(3 * HOUR), 3, root, bytes32(uint256(9)), proof);
        assertTrue(_sameHead(a.headAt(1), before), "byte-identical");
        assertEq(a.latestEpoch(), 1, "latest");
    }

    function test_F5_rotation_leaves_past_heads_and_stamps_the_next() public {
        _seal(1, bytes32(uint256(1)));
        ChitAnchor.Head memory past = a.headAt(1);
        ChitAnchor.Head memory genesis = a.headAt(0);
        _rotateTo(address(0xBEEF), 2);
        assertTrue(_sameHead(a.headAt(1), past), "epoch 1");
        assertTrue(_sameHead(a.headAt(0), genesis), "genesis");
        assertEq(a.headAt(1).checkpointVersion, 1, "old version");
        (bytes32 root, bytes32[] memory proof,) = _roots(2);
        vm.warp(3 * HOUR);
        vm.prank(address(0xBEEF));
        a.anchor(dom, 2, uint64(2 * HOUR), 2, root, bytes32(uint256(2)), proof);
        assertEq(a.headAt(2).checkpointVersion, 2, "new version");
        assertTrue(_sameHead(a.headAt(1), past), "epoch 1 after");
        assertEq(a.headAt(1).checkpointVersion, 1, "old version after");
    }

    function test_F6_genesis_head() public {
        vm.chainId(84532);
        vm.warp(1234);
        uint64 bn = uint64(block.number);
        ChitAnchor fresh = new ChitAnchor(cp, ctrl);
        ChitAnchor.Head memory g = fresh.headAt(0);
        assertEq(g.root, sha256(""), "empty root");
        assertEq(g.size, 0, "size");
        assertEq(g.checkpointVersion, 1, "version");
        assertEq(g.hourStart, 0, "hour");
        assertEq(g.stateRoot, bytes32(0), "state");
        assertEq(g.anchorBlock, bn, "deploy block");
        assertEq(g.anchorTime, 1234, "deploy time");
        assertEq(fresh.latestEpoch(), 0, "latest");
        (uint64 epoch, uint64 hour, uint64 size, bytes32 root, bytes32 state) = fresh.latest();
        assertEq(epoch, 0, "latest epoch");
        assertEq(hour, 0, "latest hour");
        assertEq(size, 0, "latest size");
        assertEq(root, g.root, "latest root");
        assertEq(state, bytes32(0), "latest state");
    }

    function test_F7_headsFor_pairs_the_previous_head() public {
        _seal(1, bytes32(uint256(1)));
        _seal(2, bytes32(uint256(2)));
        (ChitAnchor.Head memory cur, ChitAnchor.Head memory prior, uint64 latest) = a.headsFor(2);
        assertTrue(_sameHead(cur, a.headAt(2)), "current");
        assertTrue(_sameHead(prior, a.headAt(1)), "prior");
        assertEq(latest, a.latestEpoch(), "latest");
        (ChitAnchor.Head memory g, ChitAnchor.Head memory zero, uint64 latest0) = a.headsFor(0);
        assertTrue(_sameHead(g, a.headAt(0)), "genesis");
        assertEq(zero.anchorBlock, 0, "prior of 0");
        assertEq(zero.root, bytes32(0), "prior root");
        assertEq(zero.size, 0, "prior size");
        assertEq(latest0, 2, "latest still");
        (ChitAnchor.Head memory missing,,) = a.headsFor(9);
        assertEq(missing.anchorBlock, 0, "unwritten");
    }

    function test_F9_latest_matches_heads_after_five_anchors() public {
        for (uint256 i = 1; i <= 5; i++) {
            _seal(i, bytes32(i));
        }
        assertEq(a.latestEpoch(), 5, "latestEpoch");
        (uint64 epoch, uint64 hour, uint64 size, bytes32 root, bytes32 state) = a.latest();
        ChitAnchor.Head memory h = a.headAt(5);
        assertEq(epoch, 5, "epoch");
        assertEq(hour, h.hourStart, "hour");
        assertEq(size, h.size, "size");
        assertEq(root, h.root, "root");
        assertEq(state, h.stateRoot, "state");
        assertEq(uint256(h.checkpointVersion), 1, "version");
    }

    function test_checkpoint_version_does_not_truncate() public {
        vm.prank(ctrl);
        vm.expectRevert(ChitAnchor.BadVersion.selector);
        a.proposeRotation(address(0xBEEF), uint64(type(uint32).max) + 1);
        assertEq(a.checkpointVersion(), 1, "unchanged");
        _rotateTo(address(0xBEEF), uint64(type(uint32).max));
        (bytes32 root,,) = _roots(1);
        vm.warp(HOUR + HOUR);
        vm.prank(address(0xBEEF));
        a.anchor(dom, 1, uint64(HOUR), 1, root, bytes32(uint256(1)), new bytes32[](0));
        assertEq(a.headAt(1).checkpointVersion, type(uint32).max, "full width");
        assertEq(a.checkpointVersion(), uint64(type(uint32).max), "stored version");
    }

    function test_C1_checkpoint_cannot_propose_rotation() public {
        vm.prank(cp);
        vm.expectRevert(ChitAnchor.NotController.selector);
        a.proposeRotation(address(0xBEEF), 2);
    }

    function test_C2_controller_rotation_waits_and_keeps_head() public {
        _seal(1, bytes32(uint256(11)));
        (uint64 epoch, uint64 hour, uint64 size, bytes32 root, bytes32 state) = a.latest();
        uint64 current = a.checkpointVersion();
        vm.prank(ctrl);
        vm.expectRevert(ChitAnchor.BadVersion.selector);
        a.proposeRotation(address(0xBEEF), current);
        uint256 t = block.timestamp;
        vm.prank(ctrl);
        a.proposeRotation(address(0xBEEF), 2);
        (uint8 kind, address addr, uint64 version, uint64 eta) = a.pendingAction();
        assertEq(uint256(kind), 1, "kind");
        assertEq(addr, address(0xBEEF), "addr");
        assertEq(uint256(version), 2, "pending version");
        assertEq(uint256(eta), t + 86400, "eta");
        vm.warp(eta);
        vm.prank(ctrl);
        a.executePending();
        assertEq(a.checkpoint(), address(0xBEEF), "checkpoint");
        assertEq(uint256(a.checkpointVersion()), 2, "version");
        (uint64 e2, uint64 h2, uint64 s2, bytes32 r2, bytes32 st2) = a.latest();
        assertEq(uint256(e2), uint256(epoch), "epoch");
        assertEq(uint256(h2), uint256(hour), "hour");
        assertEq(uint256(s2), uint256(size), "size");
        assertEq(r2, root, "root");
        assertEq(st2, state, "state");
        assertEq(a.controller(), ctrl, "controller");
    }

    function test_C3_controller_change_only_by_controller() public {
        vm.prank(cp);
        vm.expectRevert(ChitAnchor.NotController.selector);
        a.proposeControllerChange(address(0xD00D));
        vm.prank(address(0xB0B));
        vm.expectRevert(ChitAnchor.NotController.selector);
        a.proposeControllerChange(address(0xD00D));
        vm.prank(ctrl);
        vm.expectRevert(ChitAnchor.ZeroCheckpoint.selector);
        a.proposeControllerChange(address(0));
        vm.prank(ctrl);
        vm.expectRevert(ChitAnchor.SameCheckpoint.selector);
        a.proposeControllerChange(ctrl);
        vm.prank(ctrl);
        a.proposeControllerChange(address(0xD00D));
        (uint8 kind, address addr, uint64 version,) = a.pendingAction();
        assertEq(uint256(kind), 2, "kind");
        assertEq(addr, address(0xD00D), "addr");
        assertEq(uint256(version), 0, "version");
    }

    function test_C4_constructor_rejects_zero_or_same_controller() public {
        vm.expectRevert(ChitAnchor.ZeroCheckpoint.selector);
        new ChitAnchor(cp, address(0));
        vm.expectRevert(ChitAnchor.SameCheckpoint.selector);
        new ChitAnchor(cp, cp);
        vm.expectRevert(ChitAnchor.ZeroCheckpoint.selector);
        new ChitAnchor(address(0), ctrl);
    }

    function test_C5_old_controller_loses_every_action() public {
        address neu = address(0xD00D);
        _controllerTo(neu);
        assertEq(a.controller(), neu, "controller");
        vm.prank(ctrl);
        vm.expectRevert(ChitAnchor.NotController.selector);
        a.proposeRotation(address(0xBEEF), 2);
        vm.prank(ctrl);
        vm.expectRevert(ChitAnchor.NotController.selector);
        a.proposeControllerChange(address(0xCAFE));
        vm.prank(ctrl);
        vm.expectRevert(ChitAnchor.NotController.selector);
        a.executePending();
        vm.prank(ctrl);
        vm.expectRevert(ChitAnchor.NotController.selector);
        a.cancelPending();
        vm.prank(neu);
        a.proposeRotation(address(0xBEEF), 2);
        (uint8 kind,,,) = a.pendingAction();
        assertEq(uint256(kind), 1, "new controller proposes");
    }

    function test_C6_old_checkpoint_cannot_anchor_after_rotation() public {
        address next = address(0xBEEF);
        _rotateTo(next, 2);
        (bytes32 root,,) = _roots(1);
        vm.prank(cp);
        vm.expectRevert(ChitAnchor.NotCheckpoint.selector);
        a.anchor(dom, 1, uint64(HOUR), 1, root, bytes32(uint256(1)), new bytes32[](0));
        vm.prank(next);
        a.anchor(dom, 1, uint64(HOUR), 1, root, bytes32(uint256(1)), new bytes32[](0));
        (uint64 epoch,,,,) = a.latest();
        assertEq(uint256(epoch), 1, "epoch");
        assertEq(uint256(a.headAt(1).checkpointVersion), 2, "heads[1].checkpointVersion");
        assertEq(uint256(a.headAt(0).checkpointVersion), 1, "heads[0].checkpointVersion");
    }

    function test_C8_anchor_invariants_hold_between_timelock_actions() public {
        _seal(1, bytes32(uint256(1)));
        address neu = address(0xD00D);
        vm.prank(ctrl);
        a.proposeControllerChange(neu);
        (,,, uint64 etaC) = a.pendingAction();
        _seal(2, bytes32(uint256(2)));
        assertEq(uint256(a.headAt(2).checkpointVersion), 1, "heads[2].checkpointVersion during the delay");
        (uint64 epoch,,,,) = a.latest();
        assertEq(uint256(epoch), 2, "epoch during controller delay");
        assertTrue(block.timestamp < etaC, "controller eta still ahead");
        vm.warp(etaC);
        vm.prank(ctrl);
        a.executePending();
        assertEq(a.controller(), neu, "controller");
        assertEq(a.checkpoint(), cp, "checkpoint");
        assertEq(uint256(a.checkpointVersion()), 1, "version");
        (, uint64 h2, uint64 s2, bytes32 r2, bytes32 st2) = a.latest();
        vm.prank(neu);
        a.proposeRotation(address(0xBEEF), 2);
        (,,, uint64 etaR) = a.pendingAction();
        _seal(3, bytes32(uint256(3)));
        assertTrue(block.timestamp < etaR, "rotation eta still ahead");
        (uint64 e3,,,,) = a.latest();
        assertEq(uint256(e3), 3, "epoch during rotation delay");
        vm.prank(cp);
        vm.expectRevert(ChitAnchor.BadEpoch.selector);
        a.anchor(dom, 3, uint64(3 * HOUR), 3, r2, st2, new bytes32[](0));
        vm.warp(etaR);
        vm.prank(neu);
        a.executePending();
        (uint64 afterE, uint64 afterH, uint64 afterS, bytes32 afterR, bytes32 afterSRoot) = a.latest();
        assertEq(uint256(afterE), uint256(e3), "rotation keeps the epoch");
        assertEq(a.checkpoint(), address(0xBEEF), "new checkpoint");
        assertEq(uint256(a.headAt(3).checkpointVersion), 1, "heads[3].checkpointVersion stays the pre-rotation version");
        vm.prank(cp);
        vm.expectRevert(ChitAnchor.NotCheckpoint.selector);
        a.anchor(dom, 4, uint64(4 * HOUR), 4, afterR, afterSRoot, new bytes32[](0));
        _seal(4, bytes32(uint256(4)));
        (uint64 e4, uint64 h4, uint64 s4,,) = a.latest();
        assertEq(uint256(e4), 4, "new key epoch");
        assertEq(uint256(a.headAt(4).checkpointVersion), 2, "heads[4].checkpointVersion");
        assertEq(uint256(a.checkpointVersion()), 2, "anchor does not change version");
        assertTrue(h4 > afterH && s4 > afterS && h2 > 0 && s2 > 0, "head only moved forward");
        vm.prank(address(0xBEEF));
        vm.expectRevert(ChitAnchor.BadEpoch.selector);
        a.anchor(dom, 4, h4, s4, afterR, afterSRoot, new bytes32[](0));
    }

    function test_C9_execute_boundary_for_both_kinds() public {
        uint256 t = block.timestamp;
        vm.prank(ctrl);
        a.proposeRotation(address(0xBEEF), 2);
        (,,, uint64 eta) = a.pendingAction();
        assertEq(uint256(eta), t + 86400, "rotation eta");
        vm.warp(uint256(eta) - 1);
        assertFalse(_ok(ctrl, abi.encodeCall(ChitAnchor.executePending, ())), "rotation eta-1");
        assertEq(a.checkpoint(), cp, "checkpoint waits");
        vm.warp(eta);
        assertTrue(_ok(ctrl, abi.encodeCall(ChitAnchor.executePending, ())), "rotation at eta");
        assertEq(a.checkpoint(), address(0xBEEF), "rotated");
        t = block.timestamp;
        vm.prank(ctrl);
        a.proposeControllerChange(address(0xD00D));
        (,,, eta) = a.pendingAction();
        assertEq(uint256(eta), t + 86400, "controller eta");
        vm.warp(uint256(eta) - 1);
        assertFalse(_ok(ctrl, abi.encodeCall(ChitAnchor.executePending, ())), "controller eta-1");
        assertEq(a.controller(), ctrl, "controller waits");
        vm.warp(eta);
        assertTrue(_ok(ctrl, abi.encodeCall(ChitAnchor.executePending, ())), "controller at eta");
        assertEq(a.controller(), address(0xD00D), "controller moved");
        assertEq(a.checkpoint(), address(0xBEEF), "checkpoint stays");
    }

    function test_C10_no_direct_path_and_no_outsider() public {
        bytes memory code = address(a).code;
        assertTrue(_selector(code, bytes4(keccak256("proposeRotation(address,uint64)"))), "propose present");
        assertTrue(_selector(code, bytes4(keccak256("proposeControllerChange(address)"))), "controller propose present");
        assertTrue(_selector(code, bytes4(keccak256("executePending()"))), "execute present");
        assertTrue(_selector(code, bytes4(keccak256("cancelPending()"))), "cancel present");
        assertFalse(_selector(code, bytes4(keccak256("rotateCheckpointKey(address,uint64)"))), "rotate selector");
        assertFalse(_selector(code, bytes4(keccak256("setController(address)"))), "setController selector");
        string memory abiMd = vm.readFile("../../contracts/chit-simple/ABI.md");
        assertFalse(_has(abiMd, "rotateCheckpointKey("), "abi rotate");
        assertFalse(_has(abiMd, "setController("), "abi setController");
        address[2] memory outsiders = [cp, address(0xB0B)];
        for (uint256 i = 0; i < outsiders.length; i++) {
            vm.prank(outsiders[i]);
            vm.expectRevert(ChitAnchor.NotController.selector);
            a.proposeRotation(address(0xBEEF), 2);
            vm.prank(outsiders[i]);
            vm.expectRevert(ChitAnchor.NotController.selector);
            a.proposeControllerChange(address(0xD00D));
        }
        vm.prank(ctrl);
        a.proposeRotation(address(0xBEEF), 2);
        (,,, uint64 eta) = a.pendingAction();
        for (uint256 i = 0; i < outsiders.length; i++) {
            vm.prank(outsiders[i]);
            vm.expectRevert(ChitAnchor.NotController.selector);
            a.cancelPending();
        }
        vm.warp(eta);
        for (uint256 i = 0; i < outsiders.length; i++) {
            vm.prank(outsiders[i]);
            vm.expectRevert(ChitAnchor.NotController.selector);
            a.executePending();
        }
        (uint8 kind, address addr,, uint64 still) = a.pendingAction();
        assertEq(uint256(kind), 1, "still pending");
        assertEq(addr, address(0xBEEF), "same addr");
        assertEq(uint256(still), uint256(eta), "same eta");
    }

    function test_C11_cancel_restarts_a_full_delay() public {
        _cancelThenFresh(1, address(0xBEEF), 2);
        _cancelThenFresh(2, address(0xD00D), 0);
    }

    function test_C12_second_propose_does_not_replace_the_slot() public {
        uint256 t = block.timestamp;
        vm.prank(ctrl);
        a.proposeRotation(address(0xBEEF), 2);
        vm.prank(ctrl);
        vm.expectRevert(ChitAnchor.ActionPending.selector);
        a.proposeRotation(address(0xCAFE), 3);
        vm.prank(ctrl);
        vm.expectRevert(ChitAnchor.ActionPending.selector);
        a.proposeControllerChange(address(0xD00D));
        (uint8 kind, address addr, uint64 version, uint64 eta) = a.pendingAction();
        assertEq(uint256(kind), 1, "kind");
        assertEq(addr, address(0xBEEF), "addr");
        assertEq(uint256(version), 2, "version");
        assertEq(uint256(eta), t + 86400, "eta");
        vm.prank(ctrl);
        a.cancelPending();
        t = block.timestamp;
        vm.prank(ctrl);
        a.proposeControllerChange(address(0xD00D));
        vm.prank(ctrl);
        vm.expectRevert(ChitAnchor.ActionPending.selector);
        a.proposeControllerChange(address(0xCAFE));
        vm.prank(ctrl);
        vm.expectRevert(ChitAnchor.ActionPending.selector);
        a.proposeRotation(address(0xBEEF), 2);
        (kind, addr, version, eta) = a.pendingAction();
        assertEq(uint256(kind), 2, "controller kind");
        assertEq(addr, address(0xD00D), "controller addr");
        assertEq(uint256(version), 0, "controller version");
        assertEq(uint256(eta), t + 86400, "controller eta");
    }

    function test_C13_old_key_anchors_during_the_delay() public {
        uint256 t = block.timestamp;
        vm.prank(ctrl);
        a.proposeRotation(address(0xBEEF), 2);
        (,,, uint64 eta) = a.pendingAction();
        assertEq(uint256(eta), t + 86400, "eta");
        if (block.timestamp < HOUR + HOUR) vm.warp(HOUR + HOUR);
        (bytes32 root1,,) = _roots(1);
        vm.prank(cp);
        a.anchor(dom, 1, uint64(HOUR), 1, root1, bytes32(uint256(1)), new bytes32[](0));
        (uint64 epoch,,,,) = a.latest();
        assertEq(uint256(epoch), 1, "epoch during delay");
        assertEq(uint256(a.headAt(1).checkpointVersion), 1, "heads[1].checkpointVersion during the delay");
        assertTrue(block.timestamp < eta, "delay still open");
        vm.warp(eta);
        vm.prank(ctrl);
        a.executePending();
        assertEq(uint256(a.headAt(1).checkpointVersion), 1, "heads[1].checkpointVersion unchanged by execution");
        (bytes32 root2, bytes32[] memory proof,) = _roots(2);
        vm.prank(cp);
        vm.expectRevert(ChitAnchor.NotCheckpoint.selector);
        a.anchor(dom, 2, uint64(2 * HOUR), 2, root2, bytes32(uint256(2)), proof);
        vm.prank(address(0xBEEF));
        a.anchor(dom, 2, uint64(2 * HOUR), 2, root2, bytes32(uint256(2)), proof);
        (uint64 epoch2,,,,) = a.latest();
        assertEq(uint256(epoch2), 2, "new key epoch");
        assertEq(uint256(a.headAt(2).checkpointVersion), 2, "heads[2].checkpointVersion");
        assertEq(uint256(a.headAt(1).checkpointVersion), 1, "heads[1].checkpointVersion stays");
        assertEq(uint256(a.checkpointVersion()), 2, "anchor leaves the version");
    }

    function test_C14_proposed_events_use_a_one_day_eta() public {
        uint256 t = block.timestamp;
        vm.recordLogs();
        vm.prank(ctrl);
        a.proposeRotation(address(0xBEEF), 4);
        Vm.Log[] memory logs = vm.getRecordedLogs();
        assertEq(logs.length, 1, "one rotation log");
        assertEq(logs[0].topics.length, 1, "rotation topics");
        assertEq(logs[0].topics[0], keccak256("ActionProposed(uint8,address,uint64,uint64)"), "rotation topic");
        assertEq(logs[0].data, abi.encode(uint8(1), address(0xBEEF), uint64(4), uint64(t + 86400)), "rotation data");
        vm.prank(ctrl);
        a.cancelPending();
        t = block.timestamp;
        vm.recordLogs();
        vm.prank(ctrl);
        a.proposeControllerChange(address(0xD00D));
        logs = vm.getRecordedLogs();
        assertEq(logs.length, 1, "one controller log");
        assertEq(logs[0].topics[0], keccak256("ActionProposed(uint8,address,uint64,uint64)"), "controller topic");
        assertEq(logs[0].data, abi.encode(uint8(2), address(0xD00D), uint64(0), uint64(t + 86400)), "controller data");
        assertEq(a.ROTATION_DELAY(), 86400, "delay is one day");
    }

    function test_C15_controller_change_cannot_replace_a_rotation() public {
        vm.prank(ctrl);
        a.proposeRotation(address(0xBEEF), 2);
        (,,, uint64 eta) = a.pendingAction();
        vm.prank(ctrl);
        vm.expectRevert(ChitAnchor.ActionPending.selector);
        a.proposeControllerChange(address(0xD00D));
        vm.warp(eta);
        vm.recordLogs();
        vm.prank(ctrl);
        a.executePending();
        Vm.Log[] memory logs = vm.getRecordedLogs();
        assertEq(logs.length, 1, "one log");
        assertEq(logs[0].topics[0], keccak256("CheckpointKeyRotated(uint64,address,address)"), "rotation event");
        assertEq(logs[0].data, abi.encode(uint64(2), cp, address(0xBEEF)), "rotation data");
        assertEq(a.checkpoint(), address(0xBEEF), "rotated");
        assertEq(a.controller(), ctrl, "controller");
        assertEq(uint256(a.checkpointVersion()), 2, "version");
    }

    function test_C16_rotation_after_controller_change_waits_again() public {
        address neu = address(0xD00D);
        vm.prank(ctrl);
        a.proposeControllerChange(neu);
        vm.prank(ctrl);
        vm.expectRevert(ChitAnchor.ActionPending.selector);
        a.proposeRotation(address(0xBEEF), 2);
        (,,, uint64 eta) = a.pendingAction();
        vm.warp(eta);
        vm.prank(ctrl);
        a.executePending();
        assertEq(a.controller(), neu, "controller");
        uint256 t = block.timestamp;
        assertTrue(_ok(neu, abi.encodeCall(ChitAnchor.proposeRotation, (address(0xBEEF), uint64(2)))), "fresh propose");
        (uint8 kind,,, uint64 nextEta) = a.pendingAction();
        assertEq(uint256(kind), 1, "kind");
        assertEq(uint256(nextEta), t + 86400, "fresh day");
        vm.warp(uint256(nextEta) - 1);
        assertFalse(_ok(neu, abi.encodeCall(ChitAnchor.executePending, ())), "not the old eta");
        vm.warp(nextEta);
        assertTrue(_ok(neu, abi.encodeCall(ChitAnchor.executePending, ())), "own eta");
        assertEq(a.checkpoint(), address(0xBEEF), "rotated");
        assertEq(uint256(a.checkpointVersion()), 2, "version");
        assertEq(a.controller(), neu, "controller stays");
    }

    function test_C17_cancelled_rotation_does_not_lend_its_eta() public {
        uint256 t0 = block.timestamp;
        vm.prank(ctrl);
        a.proposeRotation(address(0xBEEF), 2);
        (,,, uint64 cancelled) = a.pendingAction();
        assertEq(uint256(cancelled), t0 + 86400, "cancelled eta");
        vm.warp(t0 + 10);
        vm.prank(ctrl);
        a.cancelPending();
        uint256 t1 = block.timestamp;
        vm.prank(ctrl);
        a.proposeControllerChange(address(0xD00D));
        (uint8 kind, address addr,, uint64 eta) = a.pendingAction();
        assertEq(uint256(kind), 2, "kind");
        assertEq(addr, address(0xD00D), "addr");
        assertEq(uint256(eta), t1 + 86400, "own eta");
        assertTrue(uint256(eta) != uint256(cancelled), "etas differ");
        vm.warp(cancelled);
        assertFalse(_ok(ctrl, abi.encodeCall(ChitAnchor.executePending, ())), "cancelled eta is too early");
        assertEq(a.controller(), ctrl, "controller");
        assertEq(a.checkpoint(), cp, "checkpoint");
        vm.warp(eta);
        assertTrue(_ok(ctrl, abi.encodeCall(ChitAnchor.executePending, ())), "own eta");
        assertEq(a.controller(), address(0xD00D), "controller moved");
        assertEq(a.checkpoint(), cp, "checkpoint stays");
        assertEq(uint256(a.checkpointVersion()), 1, "version stays");
    }

    function test_C18_each_kind_changes_only_its_own_key() public {
        address neu = address(0xD00D);
        _seal(1, bytes32(uint256(1)));
        (uint64 epoch, uint64 hour, uint64 size, bytes32 root, bytes32 state) = a.latest();
        _controllerTo(neu);
        assertEq(a.checkpoint(), cp, "checkpoint");
        assertEq(uint256(a.checkpointVersion()), 1, "version");
        (uint64 e2, uint64 h2, uint64 s2, bytes32 r2, bytes32 st2) = a.latest();
        assertEq(uint256(e2), uint256(epoch), "epoch");
        assertEq(uint256(h2), uint256(hour), "hour");
        assertEq(uint256(s2), uint256(size), "size");
        assertEq(r2, root, "root");
        assertEq(st2, state, "state");
        vm.prank(neu);
        a.proposeRotation(address(0xBEEF), 2);
        (,,, uint64 eta) = a.pendingAction();
        vm.warp(eta);
        vm.prank(neu);
        a.executePending();
        assertEq(a.controller(), neu, "controller");
        assertEq(a.checkpoint(), address(0xBEEF), "checkpoint");
        assertEq(uint256(a.checkpointVersion()), 2, "version");
        (e2, h2, s2, r2, st2) = a.latest();
        assertEq(uint256(e2), uint256(epoch), "epoch after rotation");
        assertEq(r2, root, "root after rotation");
    }

    function test_AH15_execute_does_not_write_heads() public {
        _seal(1, bytes32(uint256(1)));
        _seal(2, bytes32(uint256(2)));
        ChitAnchor.Head memory g = a.headAt(0);
        ChitAnchor.Head memory h1 = a.headAt(1);
        ChitAnchor.Head memory h2 = a.headAt(2);
        uint64 tip = a.latestEpoch();
        _rotateTo(address(0xBEEF), 2);
        assertTrue(_sameHead(a.headAt(0), g), "genesis");
        assertTrue(_sameHead(a.headAt(1), h1), "epoch 1");
        assertTrue(_sameHead(a.headAt(2), h2), "epoch 2");
        assertEq(a.latestEpoch(), tip, "latestEpoch");
        assertEq(a.headAt(3).anchorBlock, 0, "no new head");
        vm.prank(ctrl);
        a.proposeControllerChange(address(0xD00D));
        (,,, uint64 eta) = a.pendingAction();
        vm.warp(eta);
        vm.prank(ctrl);
        a.executePending();
        assertTrue(_sameHead(a.headAt(0), g), "genesis after controller");
        assertTrue(_sameHead(a.headAt(1), h1), "epoch 1 after controller");
        assertTrue(_sameHead(a.headAt(2), h2), "epoch 2 after controller");
        assertEq(a.latestEpoch(), tip, "latestEpoch after controller");
        assertEq(a.headAt(3).anchorBlock, 0, "still no new head");
    }

    function test_gas_propose() public {
        vm.pauseGasMetering();
        vm.resumeGasMetering();
        vm.prank(ctrl);
        a.proposeRotation(address(0xBEEF), 2);
        vm.pauseGasMetering();
    }

    function test_rotation_rejects_the_controller_address() public {
        vm.prank(ctrl);
        vm.expectRevert(ChitAnchor.RotationToController.selector);
        a.proposeRotation(ctrl, 2);
        (uint8 kind,,,) = a.pendingAction();
        assertEq(uint256(kind), 0, "slot stays empty");
    }

    function test_controller_change_rejects_the_checkpoint() public {
        vm.prank(ctrl);
        vm.expectRevert(ChitAnchor.ControllerIsCheckpoint.selector);
        a.proposeControllerChange(cp);
        (uint8 kind,,,) = a.pendingAction();
        assertEq(uint256(kind), 0, "slot stays empty");
    }

    function test_version_cannot_exceed_uint32() public {
        uint64 cap = uint64(type(uint32).max);
        vm.prank(ctrl);
        vm.expectRevert(ChitAnchor.BadVersion.selector);
        a.proposeRotation(address(0xBEEF), cap + 1);
        vm.prank(ctrl);
        a.proposeRotation(address(0xBEEF), cap);
        (uint8 kind,, uint64 version,) = a.pendingAction();
        assertEq(uint256(kind), 1, "accepted");
        assertEq(uint256(version), uint256(cap), "uint32 max");
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
        vm.prank(ctrl);
        a.proposeRotation(address(0xBEEF), 2);
        (,,, uint64 eta) = a.pendingAction();
        vm.warp(eta);
        vm.resumeGasMetering();
        vm.prank(ctrl);
        a.executePending();
        vm.pauseGasMetering();
    }

    function _rotateTo(address next, uint64 version) internal {
        vm.prank(ctrl);
        a.proposeRotation(next, version);
        (,,, uint64 eta) = a.pendingAction();
        vm.warp(eta);
        vm.prank(ctrl);
        a.executePending();
    }

    function _controllerTo(address next) internal {
        vm.prank(ctrl);
        a.proposeControllerChange(next);
        (,,, uint64 eta) = a.pendingAction();
        vm.warp(eta);
        vm.prank(ctrl);
        a.executePending();
    }

    function _cancelThenFresh(uint8 wantKind, address next, uint64 version) internal {
        uint256 t0 = block.timestamp;
        assertTrue(_propose(wantKind, next, version), "propose");
        (,,, uint64 oldEta) = a.pendingAction();
        assertEq(uint256(oldEta), t0 + 86400, "old eta");
        vm.recordLogs();
        vm.prank(ctrl);
        a.cancelPending();
        Vm.Log[] memory logs = vm.getRecordedLogs();
        assertEq(logs.length, 1, "cancel log");
        assertEq(logs[0].topics[0], keccak256("ActionCancelled(uint8)"), "cancel topic");
        assertEq(logs[0].data, abi.encode(wantKind), "cancel data");
        vm.warp(oldEta);
        assertFalse(_ok(ctrl, abi.encodeCall(ChitAnchor.executePending, ())), "cleared");
        uint256 t1 = block.timestamp;
        assertTrue(_propose(wantKind, next, version), "fresh propose");
        (uint8 kind, address addr, uint64 ver, uint64 eta) = a.pendingAction();
        assertEq(uint256(kind), uint256(wantKind), "kind");
        assertEq(addr, next, "addr");
        assertEq(uint256(ver), uint256(version), "version");
        assertEq(uint256(eta), t1 + 86400, "fresh eta");
        assertTrue(uint256(eta) != uint256(oldEta), "not the cancelled eta");
        vm.prank(ctrl);
        a.cancelPending();
    }

    function _propose(uint8 kind, address next, uint64 version) internal returns (bool ok) {
        bytes memory data = kind == 1
            ? abi.encodeCall(ChitAnchor.proposeRotation, (next, version))
            : abi.encodeCall(ChitAnchor.proposeControllerChange, (next));
        return _ok(ctrl, data);
    }

    function _ok(address who, bytes memory data) internal returns (bool ok) {
        vm.prank(who);
        (ok,) = address(a).call(data);
    }

    function _selector(bytes memory code, bytes4 sel) internal pure returns (bool) {
        if (code.length < 4) return false;
        for (uint256 i = 0; i <= code.length - 4; i++) {
            if (code[i] == sel[0] && code[i + 1] == sel[1] && code[i + 2] == sel[2] && code[i + 3] == sel[3]) return true;
        }
        return false;
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
