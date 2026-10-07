// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test, console2} from "forge-std/Test.sol";
import {ChitIssuerCodes, ChitIssuerRoot} from "../../contracts/registry/ChitIssuerRoot.sol";
import {ChitIssuerDigests} from "../../contracts/registry/ChitIssuerDigests.sol";
import {GuardianDeploy} from "./GuardianDeploy.sol";

/// @notice Guardian quorum is the only compromise-retirement authority.
///         Keys are derived from labels and are not funded.
contract ChitIssuerRootGuardianTest is Test {
    bytes32 internal constant GENESIS = keccak256("guardian-genesis");
    uint64 internal constant NOT_BEFORE = 1_700_000_000;

    ChitIssuerRoot internal root;
    address[] internal set;
    uint256[] internal pks;
    address internal signerOverlap;

    function setUp() public {
        vm.chainId(84532);
        vm.warp(NOT_BEFORE + 10 days);
        vm.roll(20);
        (set, pks) = GuardianDeploy.pair();
        root = GuardianDeploy.deploy(address(this), GENESIS, NOT_BEFORE);
    }

    function isOwner(address account) external view returns (bool) {
        return account == signerOverlap;
    }

    function test_quorumRefusesMMinusOneDuplicateAndNonGuardian() public {
        bytes32 digest = ChitIssuerDigests.recoverAuthDigest(block.chainid, address(root), root.guardianSeq(), GENESIS, false);

        bytes[] memory one = new bytes[](1);
        one[0] = GuardianDeploy.sign(pks[0], digest);
        vm.expectRevert(abi.encodeWithSelector(ChitIssuerRoot.QuorumNotMet.selector, 1, 2));
        root.recover(GENESIS, false, one);

        bytes[] memory dup = new bytes[](2);
        dup[0] = one[0];
        dup[1] = one[0];
        vm.expectRevert(abi.encodeWithSelector(ChitIssuerRoot.DuplicateOrUnsortedSigner.selector, set[0]));
        root.recover(GENESIS, false, dup);

        uint256 outsiderPk = uint256(keccak256("chit-issuer-root not a guardian"));
        address outsider = vm.addr(outsiderPk);
        bytes memory outsiderSig = GuardianDeploy.sign(outsiderPk, digest);
        bytes[] memory mixed = new bytes[](2);
        if (outsider < set[0]) {
            mixed[0] = outsiderSig;
            mixed[1] = GuardianDeploy.sign(pks[0], digest);
            vm.expectRevert(abi.encodeWithSelector(ChitIssuerRoot.NotGuardian.selector, outsider));
        } else {
            mixed[0] = GuardianDeploy.sign(pks[0], digest);
            mixed[1] = outsiderSig;
            vm.expectRevert(abi.encodeWithSelector(ChitIssuerRoot.NotGuardian.selector, outsider));
        }
        root.recover(GENESIS, false, mixed);
    }

    function test_controllerCannotCompromiseRetireAndGuardiansCannotAdd() public {
        vm.expectRevert(ChitIssuerRoot.CompromiseRequiresGuardians.selector);
        root.commit(
            _one(ChitIssuerRoot.Op({
                kind: ChitIssuerCodes.OP_REVOKE,
                kid: GENESIS,
                timestamp: uint64(block.timestamp),
                reasonCode: ChitIssuerCodes.REASON_COMPROMISE
            })),
            _none(),
            0,
            bytes32(0)
        );

        vm.prank(set[0]);
        vm.expectRevert(abi.encodeWithSelector(ChitIssuerRoot.NotController.selector, set[0]));
        root.commit(
            _one(ChitIssuerRoot.Op({
                kind: ChitIssuerCodes.OP_ADD_STANDBY,
                kid: keccak256("nope"),
                timestamp: uint64(block.timestamp + 24 hours),
                reasonCode: 0
            })),
            _none(),
            0,
            bytes32(0)
        );
    }

    function test_recoveryCutsTheRetirementBlockAndCanInvalidatePrior() public {
        uint64 retiredAt = uint64(block.timestamp);
        _recover(false);
        (bool before,) = root.keyValidAt(GENESIS, retiredAt - 1);
        assertTrue(before);
        (bool at,) = root.keyValidAt(GENESIS, retiredAt);
        assertFalse(at);
        assertEq(root.rootSeq(), 1);

        ChitIssuerRoot prior = GuardianDeploy.deploy(address(this), keccak256("prior"), NOT_BEFORE);
        uint64 start = NOT_BEFORE;
        bytes32 digest = ChitIssuerDigests.recoverAuthDigest(block.chainid, address(prior), prior.guardianSeq(), keccak256("prior"), true);
        prior.recover(keccak256("prior"), true, _sigs(digest));
        (bool atStart,) = prior.keyValidAt(keccak256("prior"), start);
        assertFalse(atStart);
        (bool earlier,) = prior.keyValidAt(keccak256("prior"), start - 1);
        assertFalse(earlier);
    }

    function test_replayOnAnotherChainOrRegistryIsRefused() public {
        bytes32 digest = ChitIssuerDigests.recoverAuthDigest(84532, address(root), root.guardianSeq(), GENESIS, false);
        bytes[] memory sigs = _sigs(digest);

        vm.chainId(1);
        (bool ok,) = address(root).call(abi.encodeCall(ChitIssuerRoot.recover, (GENESIS, false, sigs)));
        assertFalse(ok);

        vm.chainId(84532);
        ChitIssuerRoot other = GuardianDeploy.deploy(address(this), GENESIS, NOT_BEFORE);
        (ok,) = address(other).call(abi.encodeCall(ChitIssuerRoot.recover, (GENESIS, false, sigs)));
        assertFalse(ok);

        root.recover(GENESIS, false, sigs);
        (bool still,) = root.keyValidAt(GENESIS, uint64(block.timestamp));
        assertFalse(still);
    }

    function test_guardianRotationIsOrderedAndBoundIntoRootHash() public {
        bytes32 before = root.rootHash();
        uint64 prevSeq = root.guardianSeq();
        (address[] memory next, uint256[] memory nextPks) = _freshPair("rotate");
        uint64 nextSeq = prevSeq + 1;
        ChitIssuerDigests.RotateAuth memory authPreimage;
        authPreimage.chainId = block.chainid;
        authPreimage.registry = address(root);
        authPreimage.guardianSeq = prevSeq;
        authPreimage.nextGuardianSeq = nextSeq;
        authPreimage.newThreshold = 2;
        bytes32 auth = ChitIssuerDigests.rotateAuthDigest(authPreimage, next);
        bytes32 popDigest = ChitIssuerDigests.seatedPopDigest(block.chainid, address(root), nextSeq, 2, next);
        bytes[] memory pops = new bytes[](2);
        pops[0] = GuardianDeploy.sign(nextPks[0], popDigest);
        pops[1] = GuardianDeploy.sign(nextPks[1], popDigest);

        bytes[] memory short = new bytes[](1);
        short[0] = GuardianDeploy.sign(pks[0], auth);
        vm.expectRevert(abi.encodeWithSelector(ChitIssuerRoot.QuorumNotMet.selector, 1, 2));
        root.rotateGuardians(next, 2, short, pops);

        uint256 gasBefore = gasleft();
        root.rotateGuardians(next, 2, _sigs(auth), pops);
        console2.log("GAS rotateGuardians", gasBefore - gasleft());

        assertEq(root.guardianSeq(), nextSeq);
        assertTrue(root.rootHash() != before);
        assertEq(root.rootSeq(), 1);
        (uint64 seq, uint64 threshold, address[] memory seated, bytes32 setHash) = root.guardianSet();
        assertEq(seq, nextSeq);
        assertEq(threshold, 2);
        assertEq(seated[0], next[0]);
        assertEq(setHash, _setHash(next));
        assertFalse(root.isGuardian(set[0]));
        assertTrue(root.isGuardian(next[0]));
    }

    function test_historyVersionAndSnapshotAreBoundIntoRootHash() public {
        bytes32 snapA = keccak256("hist-a");
        bytes32 snapB = keccak256("hist-b");
        ChitIssuerRoot.Op[] memory ops = _one(ChitIssuerRoot.Op({
            kind: ChitIssuerCodes.OP_RETIRE, kid: GENESIS, timestamp: NOT_BEFORE, reasonCode: 0
        }));
        bytes32 prev = root.rootHash();
        bytes32 withA = _bound(prev, ops, 4, snapA);
        bytes32 withB = _bound(prev, ops, 4, snapB);
        assertTrue(withA != withB);
        root.commit(ops, _none(), 4, snapA);
        assertEq(root.historyVersion(), 4);
        assertEq(root.historySnapshot(), snapA);
        assertEq(root.rootHash(), withA);
    }

    function test_controllerSignerCannotAlsoBeGuardian() public {
        signerOverlap = set[0];
        bytes32 kid = keccak256("overlap");
        bytes[] memory popSigs = GuardianDeploy.pops(address(this), kid, NOT_BEFORE, set, pks, 2);
        vm.expectRevert(abi.encodeWithSelector(ChitIssuerRoot.GuardianIsControllerSigner.selector, set[0]));
        new ChitIssuerRoot(address(this), kid, NOT_BEFORE, set, 2, GuardianDeploy.WITNESS_SALT, popSigs);
    }

    function test_guardianGasOnAnvilChain() public {
        assertEq(block.chainid, 84532);
        uint256 gasBefore = gasleft();
        _recover(false);
        console2.log("GAS recover", gasBefore - gasleft());
        console2.log("GAS deploy_codesize", address(root).code.length);
    }

    function _bound(bytes32 prev, ChitIssuerRoot.Op[] memory ops, uint64 version, bytes32 snap) internal view returns (bytes32) {
        ChitIssuerDigests.CommitStatic memory preimage;
        preimage.prevRootHash = prev;
        preimage.seq = 1;
        preimage.chainId = block.chainid;
        preimage.registry = address(root);
        preimage.blockNumber = uint64(block.number);
        preimage.historyVersion = version;
        preimage.historySnapshot = snap;
        preimage.guardianSeq = root.guardianSeq();
        preimage.guardianSetHash = root.guardianSetHash();
        return root.commitmentHash(preimage, ops, _none());
    }

    function _recover(bool invalidatePrior) internal {
        bytes32 digest = ChitIssuerDigests.recoverAuthDigest(block.chainid, address(root), root.guardianSeq(), GENESIS, invalidatePrior);
        root.recover(GENESIS, invalidatePrior, _sigs(digest));
    }

    function _sigs(bytes32 digest) internal returns (bytes[] memory sigs) {
        sigs = new bytes[](2);
        sigs[0] = GuardianDeploy.sign(pks[0], digest);
        sigs[1] = GuardianDeploy.sign(pks[1], digest);
    }

    function _guardianRoot(bytes32 prev, uint64 nextSeq, address[] memory next) internal view returns (bytes32) {
        ChitIssuerDigests.GuardianStatic memory preimage;
        preimage.prevRootHash = prev;
        preimage.seq = 1;
        preimage.chainId = block.chainid;
        preimage.registry = address(root);
        preimage.blockNumber = uint64(block.number);
        preimage.guardianSeq = nextSeq;
        preimage.guardianThreshold = 2;
        return ChitIssuerDigests.guardianRootHash(preimage, next);
    }

    function _setHash(address[] memory next) internal pure returns (bytes32) {
        return ChitIssuerDigests.guardianSetHash(next, 2);
    }

    function _freshPair(string memory label) internal returns (address[] memory fresh, uint256[] memory freshPks) {
        uint256 a = uint256(keccak256(abi.encode(label, "a")));
        uint256 b = uint256(keccak256(abi.encode(label, "b")));
        if (vm.addr(a) > vm.addr(b)) (a, b) = (b, a);
        fresh = new address[](2);
        freshPks = new uint256[](2);
        freshPks[0] = a;
        freshPks[1] = b;
        fresh[0] = vm.addr(a);
        fresh[1] = vm.addr(b);
    }

    function _one(ChitIssuerRoot.Op memory op) internal pure returns (ChitIssuerRoot.Op[] memory ops) {
        ops = new ChitIssuerRoot.Op[](1);
        ops[0] = op;
    }

    function _none() internal pure returns (ChitIssuerRoot.FreezeArg[] memory freezeArgs) {
        freezeArgs = new ChitIssuerRoot.FreezeArg[](0);
    }
}
