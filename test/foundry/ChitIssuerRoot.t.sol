// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {Vm} from "forge-std/Vm.sol";
import {BroadcastChain} from "../../contracts/registry/BroadcastChain.sol";
import {ChitIssuerCodes, ChitIssuerRoot} from "../../contracts/registry/ChitIssuerRoot.sol";
import {ChitIssuerDigests} from "../../contracts/registry/ChitIssuerDigests.sol";
import {DeployChitIssuerRoot} from "../../script/DeployChitIssuerRoot.s.sol";
import {GuardianDeploy} from "./GuardianDeploy.sol";

contract ChitIssuerRootTest is Test {
    bytes32 internal constant GENESIS_KID = 0x22f169982faf3e1918fefd2f89db2b5954fdbb3944e5758a66000439e253ab54;
    uint64 internal constant GENESIS_NOT_BEFORE = 1_788_511_925;
    uint256 internal constant KEYS_SLOT = 4;

    ChitIssuerRoot internal root;

    function setUp() public {
        vm.chainId(84532);
        vm.warp(GENESIS_NOT_BEFORE);
        root = GuardianDeploy.deploy(address(this), GENESIS_KID, GENESIS_NOT_BEFORE);
    }

    function test_constructorSeedsActiveKeyAndDoesNotCommit() public {
        assertEq(root.controller(), address(this));
        assertEq(root.rootSeq(), 0);
        assertEq(root.rootHash(), _genesisHash(root, GENESIS_KID, GENESIS_NOT_BEFORE));
        assertEq(root.supersededBy(), address(0));
        assertEq(root.ACTIVATION_DELAY(), 24 hours);

        (uint8 status, bool wasActive, uint64 notBefore, uint64 notAfter, uint64 revokedAt, uint64 activatedAt) =
            root.keys(GENESIS_KID);
        assertEq(status, ChitIssuerCodes.STATUS_ACTIVE);
        assertTrue(wasActive);
        assertEq(notBefore, GENESIS_NOT_BEFORE);
        assertEq(notAfter, 0);
        assertEq(revokedAt, 0);
        assertEq(activatedAt, GENESIS_NOT_BEFORE);

        (bool ok, uint8 returned) = root.keyValidAt(GENESIS_KID, GENESIS_NOT_BEFORE);
        assertTrue(ok);
        assertEq(returned, ChitIssuerCodes.STATUS_ACTIVE);
        (ok,) = root.keyValidAt(GENESIS_KID, GENESIS_NOT_BEFORE - 1);
        assertFalse(ok);
    }

    function test_constructorEmitsKeyActivatedAtSeqZeroOnly() public {
        bytes32 kid = keccak256("fresh-genesis");
        address predicted = vm.computeCreateAddress(address(this), vm.getNonce(address(this)));
        vm.recordLogs();
        ChitIssuerRoot fresh = GuardianDeploy.deploy(address(this), kid, 100);
        Vm.Log[] memory logs = vm.getRecordedLogs();
        uint256 fromContract;
        bytes32 activatedTopic = keccak256("KeyActivated(bytes32,uint64,uint64)");
        bytes32 seededTopic = keccak256("GenesisSeeded(address,bytes32,uint64,uint64,uint64,bytes32)");
        bool sawActivated;
        bool sawSeeded;
        for (uint256 i = 0; i < logs.length; i++) {
            if (logs[i].emitter != predicted) continue;
            fromContract++;
            if (logs[i].topics[0] == activatedTopic) sawActivated = true;
            if (logs[i].topics[0] == seededTopic) sawSeeded = true;
        }
        assertEq(fromContract, 3);
        assertTrue(sawActivated);
        assertTrue(sawSeeded);
        assertEq(fresh.rootSeq(), 0);
        assertEq(
            fresh.rootHash(),
            _genesisHash(fresh, kid, 100)
        );
    }

    function test_constructorRejectsZeroControllerAndZeroKid() public {
        vm.expectRevert(ChitIssuerRoot.ZeroController.selector);
        new ChitIssuerRoot(address(0), GENESIS_KID, 1, new address[](0), 0, bytes32(0), new bytes[](0));
        vm.expectRevert(ChitIssuerRoot.ZeroKid.selector);
        new ChitIssuerRoot(address(this), bytes32(0), 1, new address[](0), 0, bytes32(0), new bytes[](0));
    }

    function test_onlyControllerCanWrite() public {
        address gateway = address(0xBEEF);
        vm.prank(gateway);
        vm.expectRevert(abi.encodeWithSelector(ChitIssuerRoot.NotController.selector, gateway));
        root.supersede(address(0x1234));

        ChitIssuerRoot.Op[] memory ops = new ChitIssuerRoot.Op[](1);
        ops[0] = _op(ChitIssuerCodes.OP_RETIRE, GENESIS_KID, GENESIS_NOT_BEFORE, 0);
        vm.prank(gateway);
        vm.expectRevert(abi.encodeWithSelector(ChitIssuerRoot.NotController.selector, gateway));
        root.commit(ops, _noFreezes(), 0, bytes32(0));
    }

    function test_emptyCommitReverts() public {
        vm.expectRevert(ChitIssuerRoot.EmptyCommit.selector);
        root.commit(_noOps(), _noFreezes(), 0, bytes32(0));
        vm.expectRevert(ChitIssuerRoot.EmptyCommit.selector);
        root.commit(_noOps(), _noFreezes(), 1, keccak256("hist"));
    }

    function test_historyRules() public {
        bytes32 snap = keccak256("hist-v1");
        _commit(_op(ChitIssuerCodes.OP_RETIRE, GENESIS_KID, GENESIS_NOT_BEFORE, 0), 1, snap);
        assertEq(root.historyVersion(), 1);
        assertEq(root.historySnapshot(), snap);

        vm.expectRevert(abi.encodeWithSelector(ChitIssuerRoot.HistoryVersionRegressed.selector, uint64(0), uint64(1)));
        root.commit(_one(_op(ChitIssuerCodes.OP_REVOKE, GENESIS_KID, GENESIS_NOT_BEFORE, 2)), _noFreezes(), 0, snap);

        vm.expectRevert(abi.encodeWithSelector(ChitIssuerRoot.HistorySnapshotMismatch.selector, keccak256("other"), snap));
        root.commit(_one(_op(ChitIssuerCodes.OP_REVOKE, GENESIS_KID, GENESIS_NOT_BEFORE, 2)), _noFreezes(), 1, keccak256("other"));

        _commit(_op(ChitIssuerCodes.OP_REVOKE, GENESIS_KID, GENESIS_NOT_BEFORE, 2), 2, keccak256("hist-v2"));
        assertEq(root.historyVersion(), 2);
    }

    function test_standbyDelayAndInstantPromote() public {
        bytes32 kid = keccak256("standby");
        uint64 tooSoon = uint64(block.timestamp + 24 hours - 1);
        vm.expectRevert(
            abi.encodeWithSelector(ChitIssuerRoot.ActivationTooSoon.selector, tooSoon, block.timestamp + 24 hours)
        );
        _commit(_op(ChitIssuerCodes.OP_ADD_STANDBY, kid, tooSoon, 0), 0, bytes32(0));

        uint64 notBefore = uint64(block.timestamp + 24 hours);
        _commit(_op(ChitIssuerCodes.OP_ADD_STANDBY, kid, notBefore, 0), 0, bytes32(0));

        vm.expectRevert(abi.encodeWithSelector(ChitIssuerRoot.NotYetActive.selector, kid, notBefore));
        _commit(_op(ChitIssuerCodes.OP_PROMOTE, kid, 0, 0), 0, bytes32(0));

        vm.warp(notBefore - 1);
        vm.expectRevert(abi.encodeWithSelector(ChitIssuerRoot.NotYetActive.selector, kid, notBefore));
        _commit(_op(ChitIssuerCodes.OP_PROMOTE, kid, 0, 0), 0, bytes32(0));

        vm.warp(notBefore);
        _commit(_op(ChitIssuerCodes.OP_PROMOTE, kid, 0, 0), 0, bytes32(0));
        (uint8 status, bool wasActive,,,,) = root.keys(kid);
        assertEq(status, ChitIssuerCodes.STATUS_ACTIVE);
        assertTrue(wasActive);
        (bool ok,) = root.keyValidAt(kid, notBefore);
        assertTrue(ok);
    }

    function test_retireMayBeBackdatedOrFutureButNotBeforeNotBefore() public {
        vm.expectRevert(
            abi.encodeWithSelector(ChitIssuerRoot.NotAfterBeforeStart.selector, GENESIS_NOT_BEFORE - 1, GENESIS_NOT_BEFORE)
        );
        _commit(_op(ChitIssuerCodes.OP_RETIRE, GENESIS_KID, GENESIS_NOT_BEFORE - 1, 0), 0, bytes32(0));

        uint64 backdated = GENESIS_NOT_BEFORE;
        _commit(_op(ChitIssuerCodes.OP_RETIRE, GENESIS_KID, backdated, 0), 0, bytes32(0));
        (bool ok,) = root.keyValidAt(GENESIS_KID, backdated);
        assertTrue(ok);
        (ok,) = root.keyValidAt(GENESIS_KID, backdated + 1);
        assertFalse(ok);

        bytes32 kid = _activeStandby("retire-future");
        uint64 future = uint64(block.timestamp + 7 days);
        _commitOn(kid, ChitIssuerCodes.OP_RETIRE, future, 0);
        (ok,) = root.keyValidAt(kid, future);
        assertTrue(ok);
        (ok,) = root.keyValidAt(kid, future + 1);
        assertFalse(ok);
    }

    function test_revokeIsInstantWriteOnceAndBackdatable() public {
        vm.warp(GENESIS_NOT_BEFORE + 10 days);
        uint64 revokedAt = GENESIS_NOT_BEFORE + 3 days;
        assertLt(uint256(revokedAt), block.timestamp);
        _commit(_op(ChitIssuerCodes.OP_REVOKE, GENESIS_KID, revokedAt, ChitIssuerCodes.REASON_LOST), 0, bytes32(0));

        (uint8 status, bool wasActive,,, uint64 stored,) = root.keys(GENESIS_KID);
        assertEq(status, ChitIssuerCodes.STATUS_REVOKED);
        assertTrue(wasActive);
        assertEq(stored, revokedAt);

        (bool ok, uint8 returned) = root.keyValidAt(GENESIS_KID, GENESIS_NOT_BEFORE);
        assertTrue(ok);
        (ok, returned) = root.keyValidAt(GENESIS_KID, revokedAt - 1);
        assertTrue(ok);
        assertEq(returned, ChitIssuerCodes.STATUS_REVOKED);
        (ok,) = root.keyValidAt(GENESIS_KID, revokedAt);
        assertFalse(ok);

        vm.expectRevert(abi.encodeWithSelector(ChitIssuerRoot.AlreadyRevoked.selector, GENESIS_KID));
        _commit(_op(ChitIssuerCodes.OP_REVOKE, GENESIS_KID, revokedAt, ChitIssuerCodes.REASON_LOST), 0, bytes32(0));
        vm.expectRevert(abi.encodeWithSelector(ChitIssuerRoot.BadStatus.selector, GENESIS_KID, ChitIssuerCodes.STATUS_REVOKED));
        _commit(_op(ChitIssuerCodes.OP_RETIRE, GENESIS_KID, revokedAt, 0), 0, bytes32(0));
    }

    function test_revokedAtEqualNowIsAllowedAndFutureOnlyForUnpromotedStandby() public {
        bytes32 activeKid = _activeStandby("active-revoke");
        uint64 nowTs = uint64(block.timestamp);
        _commitOn(activeKid, ChitIssuerCodes.OP_REVOKE, nowTs, ChitIssuerCodes.REASON_LOST);

        bytes32 futureKid = _activeStandby("future-revoke");
        uint64 futureNow = uint64(block.timestamp);
        uint64 version = root.historyVersion();
        bytes32 snapshot = root.historySnapshot();
        vm.expectRevert(abi.encodeWithSelector(ChitIssuerRoot.RevokedAtInFuture.selector, futureNow + 1));
        root.commit(
            _one(_op(ChitIssuerCodes.OP_REVOKE, futureKid, futureNow + 1, ChitIssuerCodes.REASON_LOST)),
            _noFreezes(),
            version,
            snapshot
        );

        bytes32 standby = keccak256("unpromoted");
        uint64 notBefore = uint64(block.timestamp + 24 hours);
        _commit(_op(ChitIssuerCodes.OP_ADD_STANDBY, standby, notBefore, 0), 0, bytes32(0));
        _commit(_op(ChitIssuerCodes.OP_REVOKE, standby, notBefore, ChitIssuerCodes.REASON_OTHER), 0, bytes32(0));
        (, bool wasActive,,,,) = root.keys(standby);
        assertFalse(wasActive);
        (bool ok,) = root.keyValidAt(standby, notBefore - 1);
        assertFalse(ok);
        (ok,) = root.keyValidAt(standby, notBefore);
        assertFalse(ok);
        (ok,) = root.keyValidAt(standby, notBefore + 10 days);
        assertFalse(ok);
    }

    function test_revokedAtCannotPrecedeNotBeforeOrBeZero() public {
        vm.expectRevert(abi.encodeWithSelector(ChitIssuerRoot.RevokedAtBeforeStart.selector, GENESIS_NOT_BEFORE - 1, GENESIS_NOT_BEFORE));
        _commit(_op(ChitIssuerCodes.OP_REVOKE, GENESIS_KID, GENESIS_NOT_BEFORE - 1, 2), 0, bytes32(0));

        bytes32 standby = keccak256("zero-revoke");
        uint64 notBefore = uint64(block.timestamp + 24 hours);
        _commit(_op(ChitIssuerCodes.OP_ADD_STANDBY, standby, notBefore, 0), 0, bytes32(0));
        vm.warp(notBefore);
        vm.expectRevert(ChitIssuerRoot.RevokedAtZero.selector);
        _commit(_op(ChitIssuerCodes.OP_REVOKE, standby, 0, 2), 0, bytes32(0));
    }

    function test_reasonCodes() public {
        uint8[3] memory ok = [uint8(2), 3, 255];
        for (uint256 i = 0; i < ok.length; i++) {
            bytes32 each = _activeStandby(vm.toString(ok[i]));
            _commitOn(each, ChitIssuerCodes.OP_REVOKE, uint64(block.timestamp), ok[i]);
        }
        bytes32 compromiseKid = _activeStandby("compromise");
        uint64 compromiseVersion = root.historyVersion();
        bytes32 compromiseSnap = root.historySnapshot();
        vm.expectRevert(ChitIssuerRoot.CompromiseRequiresGuardians.selector);
        root.commit(
            _one(_op(ChitIssuerCodes.OP_REVOKE, compromiseKid, uint64(block.timestamp), 1)),
            _noFreezes(),
            compromiseVersion,
            compromiseSnap
        );
        bytes32 badKid = _activeStandby("bad-reason");
        uint64 badNow = uint64(block.timestamp);
        uint64 version = root.historyVersion();
        bytes32 snapshot = root.historySnapshot();
        uint8[3] memory bad = [uint8(0), 4, 254];
        for (uint256 i = 0; i < bad.length; i++) {
            vm.expectRevert(abi.encodeWithSelector(ChitIssuerRoot.BadReason.selector, bad[i]));
            root.commit(_one(_op(ChitIssuerCodes.OP_REVOKE, badKid, badNow, bad[i])), _noFreezes(), version, snapshot);
        }
    }

    function test_retiredThenRevokedStillRespectsNotAfter() public {
        uint64 notAfter = GENESIS_NOT_BEFORE + 300;
        uint64 revokedAt = GENESIS_NOT_BEFORE + 700;
        vm.warp(revokedAt);
        _commit(_op(ChitIssuerCodes.OP_RETIRE, GENESIS_KID, notAfter, 0), 0, bytes32(0));
        _commit(_op(ChitIssuerCodes.OP_REVOKE, GENESIS_KID, revokedAt, ChitIssuerCodes.REASON_LOST), 0, bytes32(0));

        (bool ok,) = root.keyValidAt(GENESIS_KID, GENESIS_NOT_BEFORE + 250);
        assertTrue(ok);
        (ok,) = root.keyValidAt(GENESIS_KID, GENESIS_NOT_BEFORE + 400);
        assertFalse(ok);
        (ok,) = root.keyValidAt(GENESIS_KID, revokedAt);
        assertFalse(ok);

        bytes32 kid = _activeStandby("revoke-inside-retirement");
        uint64 retireAt = uint64(block.timestamp + 500);
        uint64 compromise = uint64(block.timestamp + 100);
        vm.warp(retireAt);
        _commitOn(kid, ChitIssuerCodes.OP_RETIRE, retireAt, 0);
        _commitOn(kid, ChitIssuerCodes.OP_REVOKE, compromise, 2);
        (ok,) = root.keyValidAt(kid, compromise - 1);
        assertTrue(ok);
        (ok,) = root.keyValidAt(kid, compromise);
        assertFalse(ok);
        (ok,) = root.keyValidAt(kid, retireAt);
        assertFalse(ok);
    }

    function test_freezeIsWriteOnce() public {
        bytes32 universe = keccak256("legacy_receipts_pre_v11");
        bytes32 uhash = keccak256("merkle");
        ChitIssuerRoot.FreezeArg[] memory fz = new ChitIssuerRoot.FreezeArg[](1);
        fz[0] = ChitIssuerRoot.FreezeArg({universeId: universe, universeHash: uhash, enumeratedCount: 4});
        root.commit(_one(_op(ChitIssuerCodes.OP_RETIRE, GENESIS_KID, GENESIS_NOT_BEFORE, 0)), fz, 1, keccak256("snap"));

        (bytes32 storedHash, uint64 count, uint64 frozenBlock, uint64 seq) = root.freezes(universe);
        assertEq(storedHash, uhash);
        assertEq(count, 4);
        assertEq(frozenBlock, uint64(block.number));
        assertEq(seq, 1);

        vm.expectRevert(abi.encodeWithSelector(ChitIssuerRoot.AlreadyFrozen.selector, universe));
        root.commit(_noOps(), fz, 1, keccak256("snap"));

        vm.expectRevert(ChitIssuerRoot.ZeroUniverseId.selector);
        ChitIssuerRoot.FreezeArg[] memory zero = new ChitIssuerRoot.FreezeArg[](1);
        zero[0] = ChitIssuerRoot.FreezeArg({universeId: bytes32(0), universeHash: uhash, enumeratedCount: 1});
        root.commit(_noOps(), zero, 1, keccak256("snap"));
    }

    function test_genesisCommitEmitsRootCommittedAndFrozenTogether() public {
        bytes32 standby = keccak256("genesis-standby");
        bytes32 universe = keccak256("legacy_receipts_pre_v11");
        bytes32 uhash = keccak256("legacy-merkle");
        bytes32 snap = keccak256("hist-snapshot");
        uint64 notBefore = uint64(block.timestamp + 24 hours);

        ChitIssuerRoot.Op[] memory ops = _one(_op(ChitIssuerCodes.OP_ADD_STANDBY, standby, notBefore, 0));
        ChitIssuerRoot.FreezeArg[] memory fz = new ChitIssuerRoot.FreezeArg[](1);
        fz[0] = ChitIssuerRoot.FreezeArg({universeId: universe, universeHash: uhash, enumeratedCount: 9});

        bytes32 prevHash = root.rootHash();
        uint64 blockNumber = uint64(block.number);
        bytes32 expected = _hashCommit(root, prevHash, blockNumber, ops, fz, 1, snap);
        assertTrue(expected != _hashCommit(root, prevHash, blockNumber + 1, ops, fz, 1, snap));

        vm.expectEmit(true, true, false, true, address(root));
        emit ChitIssuerRoot.KeyStandby(standby, notBefore, 1);
        vm.expectEmit(true, true, false, true, address(root));
        emit ChitIssuerRoot.Frozen(universe, uhash, 9, uint64(block.number), 1);
        vm.expectEmit(true, false, false, true, address(root));
        emit ChitIssuerRoot.RootCommitted(1, expected, 1, snap, blockNumber);
        root.commit(ops, fz, 1, snap);

        assertEq(root.rootSeq(), 1);
        assertEq(root.rootHash(), expected);
        assertEq(root.historyVersion(), 1);
        assertEq(root.historySnapshot(), snap);
    }

    function test_eventsForPromoteRetireRevokeAndSupersede() public {
        bytes32 kid = keccak256("event-kid");
        uint64 notBefore = uint64(block.timestamp + 24 hours);
        _commit(_op(ChitIssuerCodes.OP_ADD_STANDBY, kid, notBefore, 0), 0, bytes32(0));
        vm.warp(notBefore);

        vm.expectEmit(true, true, false, true, address(root));
        emit ChitIssuerRoot.KeyActivated(kid, notBefore, 2);
        _commit(_op(ChitIssuerCodes.OP_PROMOTE, kid, 0, 0), 0, bytes32(0));

        vm.expectEmit(true, true, false, true, address(root));
        emit ChitIssuerRoot.KeyRetired(kid, notBefore, 3);
        _commit(_op(ChitIssuerCodes.OP_RETIRE, kid, notBefore, 0), 0, bytes32(0));

        vm.expectEmit(true, true, false, true, address(root));
        emit ChitIssuerRoot.KeyRevoked(kid, notBefore, ChitIssuerCodes.REASON_SUPERSEDED, 4);
        _commit(_op(ChitIssuerCodes.OP_REVOKE, kid, notBefore, ChitIssuerCodes.REASON_SUPERSEDED), 0, bytes32(0));

        address next = address(0xCAFE);
        uint64 seqBefore = root.rootSeq();
        bytes32 hashBefore = root.rootHash();
        vm.recordLogs();
        vm.expectEmit(false, false, false, true, address(root));
        emit ChitIssuerRoot.Superseded(next);
        root.supersede(next);
        Vm.Log[] memory logs = vm.getRecordedLogs();
        uint256 fromContract;
        for (uint256 i = 0; i < logs.length; i++) {
            if (logs[i].emitter == address(root)) fromContract++;
        }
        assertEq(fromContract, 1);
        assertEq(root.rootSeq(), seqBefore);
        assertEq(root.rootHash(), hashBefore);
        assertEq(root.supersededBy(), next);
    }

    function test_supersedeIsFinalAndBlocksCommit() public {
        address next = address(0x1234);
        root.supersede(next);
        vm.expectRevert(abi.encodeWithSelector(ChitIssuerRoot.AlreadySuperseded.selector, next));
        root.supersede(address(0x5678));

        ChitIssuerRoot fresh = GuardianDeploy.deploy(address(this), keccak256("g2"), 1);
        vm.expectRevert(ChitIssuerRoot.ZeroNextRegistry.selector);
        fresh.supersede(address(0));
        vm.expectRevert(ChitIssuerRoot.SupersedeSelf.selector);
        fresh.supersede(address(fresh));

        vm.expectRevert(abi.encodeWithSelector(ChitIssuerRoot.RegistrySuperseded.selector, next));
        root.commit(_one(_op(ChitIssuerCodes.OP_RETIRE, GENESIS_KID, GENESIS_NOT_BEFORE, 0)), _noFreezes(), 0, bytes32(0));
    }

    function test_rootHashBindsChainIdAndRegistry() public {
        ChitIssuerRoot.Op[] memory ops = _one(_op(ChitIssuerCodes.OP_RETIRE, GENESIS_KID, GENESIS_NOT_BEFORE, 0));
        bytes32 firstPrev = root.rootHash();
        bytes32 first = _commitHash(root, firstPrev, 1, 84532, uint64(block.number), ops, _noFreezes(), 0, bytes32(0));
        root.commit(ops, _noFreezes(), 0, bytes32(0));
        assertEq(root.rootHash(), first);

        ChitIssuerRoot other = GuardianDeploy.deploy(address(this), GENESIS_KID, GENESIS_NOT_BEFORE);
        bytes32 otherHash =
            _commitHash(other, other.rootHash(), 1, 84532, uint64(block.number), ops, _noFreezes(), 0, bytes32(0));
        assertTrue(otherHash != first);
        other.commit(ops, _noFreezes(), 0, bytes32(0));
        assertEq(other.rootHash(), otherHash);

        bytes32 otherChain =
            _commitHash(root, firstPrev, 1, 8453, uint64(block.number), ops, _noFreezes(), 0, bytes32(0));
        assertTrue(otherChain != first);

        vm.chainId(8453);
        ChitIssuerRoot onOtherChain = GuardianDeploy.deploy(address(this), GENESIS_KID, GENESIS_NOT_BEFORE);
        bytes32 chainPrev = onOtherChain.rootHash();
        onOtherChain.commit(ops, _noFreezes(), 0, bytes32(0));
        assertTrue(onOtherChain.rootHash() != first);
        _assertMatchesCommitment(onOtherChain, chainPrev, 8453, ops);
    }

    function _commitHash(
        ChitIssuerRoot r,
        bytes32 prev,
        uint64 seq,
        uint256 chainId,
        uint64 blockNumber,
        ChitIssuerRoot.Op[] memory ops,
        ChitIssuerRoot.FreezeArg[] memory fz,
        uint64 version,
        bytes32 snap
    ) internal view returns (bytes32) {
        ChitIssuerDigests.CommitStatic memory preimage;
        preimage.prevRootHash = prev;
        preimage.seq = seq;
        preimage.chainId = chainId;
        preimage.registry = address(r);
        preimage.blockNumber = blockNumber;
        preimage.historyVersion = version;
        preimage.historySnapshot = snap;
        preimage.guardianSeq = r.guardianSeq();
        preimage.guardianSetHash = r.guardianSetHash();
        return r.commitmentHash(preimage, ops, fz);
    }

    function _hashCommit(
        ChitIssuerRoot r,
        bytes32 prev,
        uint64 blockNumber,
        ChitIssuerRoot.Op[] memory ops,
        ChitIssuerRoot.FreezeArg[] memory fz,
        uint64 version,
        bytes32 snap
    ) internal view returns (bytes32) {
        return _commitHash(r, prev, 1, block.chainid, blockNumber, ops, fz, version, snap);
    }

    function _assertMatchesCommitment(ChitIssuerRoot r, bytes32 prev, uint256 chainId, ChitIssuerRoot.Op[] memory ops)
        internal
        view
    {
        assertEq(
            r.rootHash(),
            _commitHash(r, prev, 1, chainId, uint64(block.number), ops, _noFreezes(), 0, bytes32(0))
        );
    }

    function test_rootSeqIsMonotonicAcrossCommits() public {
        assertEq(root.rootSeq(), 0);
        _commit(_op(ChitIssuerCodes.OP_RETIRE, GENESIS_KID, GENESIS_NOT_BEFORE, 0), 0, bytes32(0));
        assertEq(root.rootSeq(), 1);
        bytes32 kid = keccak256("second");
        _commit(_op(ChitIssuerCodes.OP_ADD_STANDBY, kid, uint64(block.timestamp + 24 hours), 0), 0, bytes32(0));
        assertEq(root.rootSeq(), 2);
        assertTrue(root.rootHash() != bytes32(0));
    }

    function test_opOrderAndReasonAreInsideTheHash() public {
        bytes32 a = keccak256("a");
        bytes32 b = keccak256("b");
        uint64 nb = uint64(block.timestamp + 24 hours);
        ChitIssuerRoot.Op[] memory forward = new ChitIssuerRoot.Op[](2);
        forward[0] = _op(ChitIssuerCodes.OP_ADD_STANDBY, a, nb, 0);
        forward[1] = _op(ChitIssuerCodes.OP_ADD_STANDBY, b, nb, 0);
        ChitIssuerRoot.Op[] memory backward = new ChitIssuerRoot.Op[](2);
        backward[0] = forward[1];
        backward[1] = forward[0];
        bytes32 h1 = _commitHash(root, bytes32(0), 1, block.chainid, 1, forward, _noFreezes(), 0, bytes32(0));
        bytes32 h2 = _commitHash(root, bytes32(0), 1, block.chainid, 1, backward, _noFreezes(), 0, bytes32(0));
        assertTrue(h1 != h2);
    }

    function test_emergencyRevokeAndPromoteInOneCommit() public {
        bytes32 standby = keccak256("emergency");
        uint64 notBefore = uint64(block.timestamp + 24 hours);
        _commit(_op(ChitIssuerCodes.OP_ADD_STANDBY, standby, notBefore, 0), 0, bytes32(0));
        vm.warp(notBefore + 1 hours);

        ChitIssuerRoot.Op[] memory ops = new ChitIssuerRoot.Op[](2);
        ops[0] = _op(ChitIssuerCodes.OP_REVOKE, GENESIS_KID, notBefore, ChitIssuerCodes.REASON_LOST);
        ops[1] = _op(ChitIssuerCodes.OP_PROMOTE, standby, 0, 0);
        root.commit(ops, _noFreezes(), 0, bytes32(0));

        (bool oldOk,) = root.keyValidAt(GENESIS_KID, notBefore);
        assertFalse(oldOk);
        (bool oldBefore,) = root.keyValidAt(GENESIS_KID, notBefore - 1);
        assertTrue(oldBefore);
        (bool newOk,) = root.keyValidAt(standby, uint64(block.timestamp));
        assertTrue(newOk);
    }

    function test_promoteRejectsNonCanonicalEncoding() public {
        bytes32 kid = keccak256("canonical");
        uint64 notBefore = uint64(block.timestamp + 24 hours);
        _commit(_op(ChitIssuerCodes.OP_ADD_STANDBY, kid, notBefore, 0), 0, bytes32(0));
        vm.warp(notBefore);
        vm.expectRevert(abi.encodeWithSelector(ChitIssuerRoot.NonZeroReason.selector, uint8(1)));
        _commit(_op(ChitIssuerCodes.OP_PROMOTE, kid, 0, 1), 0, bytes32(0));
        vm.expectRevert(ChitIssuerRoot.NonZeroTimestamp.selector);
        _commit(_op(ChitIssuerCodes.OP_PROMOTE, kid, 1, 0), 0, bytes32(0));
        vm.expectRevert(abi.encodeWithSelector(ChitIssuerRoot.UnknownOp.selector, uint8(9)));
        _commit(_op(9, kid, 0, 0), 0, bytes32(0));
    }

    function test_ethSendRevertsAndThereIsNoTokenInterface() public {
        vm.deal(address(this), 1 ether);
        (bool ok,) = address(root).call{value: 1 ether}("");
        assertFalse(ok);
        (ok,) = address(root).call{value: 1 ether}(hex"1234");
        assertFalse(ok);
        assertEq(address(root).balance, 0);

        bytes[6] memory calls = [
            abi.encodeWithSignature("transfer(address,uint256)", address(1), 1),
            abi.encodeWithSignature("approve(address,uint256)", address(1), 1),
            abi.encodeWithSignature("balanceOf(address)", address(1)),
            abi.encodeWithSignature("transferFrom(address,address,uint256)", address(1), address(2), 1),
            abi.encodeWithSignature("ownerOf(uint256)", uint256(1)),
            abi.encodeWithSignature("supportsInterface(bytes4)", bytes4(0x01ffc9a7))
        ];
        for (uint256 i = 0; i < calls.length; i++) {
            (ok,) = address(root).call(calls[i]);
            assertFalse(ok);
        }

        bytes32 codehash = address(root).codehash;
        root.supersede(address(0x999));
        assertEq(address(root).codehash, codehash);
        assertGt(address(root).code.length, 0);
    }

    function test_keyStateUsesTwoSlots() public {
        bytes32 base = keccak256(abi.encode(GENESIS_KID, KEYS_SLOT));
        uint256 word = uint256(vm.load(address(root), base));
        assertEq(uint8(word), ChitIssuerCodes.STATUS_ACTIVE);
        assertEq(uint8(word >> 8), 1);
        assertEq(uint64(word >> 16), GENESIS_NOT_BEFORE);
        assertEq(uint64(word >> 80), 0);
        assertEq(uint64(word >> 144), 0);
        assertEq(word >> 208, 0);
        assertEq(uint64(uint256(vm.load(address(root), bytes32(uint256(base) + 1)))), GENESIS_NOT_BEFORE);
    }

    function test_latePromoteDoesNotBackdateAndRevokeStopsAtActivatedAt() public {
        bytes32 kid = keccak256("late");
        uint64 notBefore = uint64(block.timestamp + 24 hours);
        _commit(_op(ChitIssuerCodes.OP_ADD_STANDBY, kid, notBefore, 0), 0, bytes32(0));
        vm.warp(notBefore + 7 days);
        _commit(_op(ChitIssuerCodes.OP_PROMOTE, kid, 0, 0), 0, bytes32(0));
        uint64 activatedAt = uint64(block.timestamp);
        (,,,,, uint64 storedActivated) = root.keys(kid);
        assertEq(storedActivated, activatedAt);
        (bool duringGap,) = root.keyValidAt(kid, notBefore);
        assertFalse(duringGap);
        (bool atPromotion,) = root.keyValidAt(kid, activatedAt);
        assertTrue(atPromotion);

        vm.expectRevert(abi.encodeWithSelector(ChitIssuerRoot.RevokedAtBeforeStart.selector, notBefore, activatedAt));
        _commit(_op(ChitIssuerCodes.OP_REVOKE, kid, notBefore, ChitIssuerCodes.REASON_LOST), 0, bytes32(0));
        _commit(_op(ChitIssuerCodes.OP_REVOKE, kid, activatedAt, ChitIssuerCodes.REASON_LOST), 0, bytes32(0));
        (bool beforeRevoke,) = root.keyValidAt(kid, activatedAt - 1);
        assertFalse(beforeRevoke);
        (bool atRevokeBoundary,) = root.keyValidAt(kid, activatedAt);
        assertFalse(atRevokeBoundary);
    }

    function test_offChainHelperMatchesRootHash() public {
        ChitIssuerRoot.Op memory op = _op(ChitIssuerCodes.OP_RETIRE, GENESIS_KID, GENESIS_NOT_BEFORE, 0);
        bytes32 snap = keccak256("helper");
        bytes32 prev = root.rootHash();
        uint64 blockNumber = uint64(block.number);
        _commit(op, 1, snap);
        bytes32 js = _jsHash(prev, 1, address(root), blockNumber, op, 1, snap);
        assertEq(js, root.rootHash());
    }

    function test_scriptRefusesBroadcastOffSepolia() public {
        DeployChitIssuerRoot deployer = new DeployChitIssuerRoot();
        uint256[3] memory chains = [uint256(1), uint256(8453), uint256(31337)];
        for (uint256 i = 0; i < chains.length; i++) {
            vm.chainId(chains[i]);
            vm.expectRevert(abi.encodeWithSelector(BroadcastChain.RefusingBroadcast.selector, chains[i]));
            deployer.run();
        }
        vm.chainId(84532);
        BroadcastChain.assertBaseSepolia();
    }

    function testFuzz_statusTransitions(uint96 salt, uint8 fromStatus, uint8 opKind, uint64 ts, uint8 reason, uint32 warpBy)
        public
    {
        fromStatus = fromStatus % 5;
        opKind = uint8((opKind % 4) + 1);
        vm.warp(1_700_000_000);
        bytes32 kid = keccak256(abi.encode("transition", salt, fromStatus));
        ChitIssuerRoot r = GuardianDeploy.deploy(address(this), keccak256("fuzz-genesis"), 1);
        uint64 notBefore = uint64(uint256(1_700_000_000) + 24 hours + 1000);
        _seedStatus(r, kid, fromStatus, notBefore);
        _attemptTransition(r, kid, fromStatus, notBefore, opKind, ts, reason, warpBy);
    }

    function _seedStatus(ChitIssuerRoot r, bytes32 kid, uint8 fromStatus, uint64 notBefore) internal {
        if (fromStatus == 0) return;
        r.commit(_one(_op(ChitIssuerCodes.OP_ADD_STANDBY, kid, notBefore, 0)), _noFreezes(), 0, bytes32(0));
        if (fromStatus < 2) return;
        vm.warp(notBefore);
        r.commit(_one(_op(ChitIssuerCodes.OP_PROMOTE, kid, 0, 0)), _noFreezes(), 0, bytes32(0));
        if (fromStatus == 3) {
            r.commit(_one(_op(ChitIssuerCodes.OP_RETIRE, kid, notBefore, 0)), _noFreezes(), 0, bytes32(0));
        }
        if (fromStatus == 4) {
            r.commit(
                _one(_op(ChitIssuerCodes.OP_REVOKE, kid, notBefore, ChitIssuerCodes.REASON_LOST)),
                _noFreezes(),
                0,
                bytes32(0)
            );
        }
    }

    function _attemptTransition(
        ChitIssuerRoot r,
        bytes32 kid,
        uint8 fromStatus,
        uint64 notBefore,
        uint8 opKind,
        uint64 ts,
        uint8 reason,
        uint32 warpBy
    ) internal {
        uint256 attemptNow = 1_700_000_000 + (uint256(warpBy) % 90 days);
        vm.warp(attemptNow);
        uint64 notAfter = fromStatus == 3 ? notBefore : 0;
        bool accept = _predict(fromStatus, fromStatus >= 2, notBefore, notAfter, opKind, ts, reason, attemptNow);
        ChitIssuerRoot.Op[] memory ops = _one(_op(opKind, kid, ts, reason));
        if (accept) {
            r.commit(ops, _noFreezes(), 0, bytes32(0));
            _assertTransition(r, kid, opKind, ts);
        } else {
            vm.expectRevert();
            r.commit(ops, _noFreezes(), 0, bytes32(0));
        }
    }

    function _assertTransition(ChitIssuerRoot r, bytes32 kid, uint8 opKind, uint64 ts) internal view {
        (uint8 status,, uint64 nb, uint64 na, uint64 rv,) = r.keys(kid);
        if (opKind == 1) assertEq(status, ChitIssuerCodes.STATUS_STANDBY);
        if (opKind == 2) assertEq(status, ChitIssuerCodes.STATUS_ACTIVE);
        if (opKind == 3) {
            assertEq(status, ChitIssuerCodes.STATUS_RETIRED);
            assertEq(na, ts);
        }
        if (opKind == 4) {
            assertEq(status, ChitIssuerCodes.STATUS_REVOKED);
            assertEq(rv, ts);
        }
        nb;
    }

    function _predict(
        uint8 status,
        bool wasActive,
        uint64 notBefore,
        uint64 notAfter,
        uint8 opKind,
        uint64 ts,
        uint8 reason,
        uint256 nowTs
    ) internal pure returns (bool) {
        notAfter;
        if (opKind == 1) {
            if (reason != 0 || status != 0) return false;
            return uint256(ts) >= nowTs + 24 hours;
        }
        if (opKind == 2) {
            if (reason != 0 || ts != 0 || status != 1) return false;
            return nowTs >= uint256(notBefore);
        }
        if (opKind == 3) {
            if (reason != 0 || status != 2) return false;
            return ts >= notBefore;
        }
        if (opKind == 4) {
            if (reason == 1) return false;
            if (reason != 2 && reason != 3 && reason != 255) return false;
            if (ts == 0 || status == 0 || status == 4 || ts < notBefore) return false;
            if (uint256(ts) > nowTs && (status != 1 || wasActive)) return false;
            return true;
        }
        return false;
    }

    function _activeStandby(string memory label) internal returns (bytes32 kid) {
        kid = keccak256(bytes(label));
        uint64 notBefore = uint64(block.timestamp + 24 hours);
        _commit(_op(ChitIssuerCodes.OP_ADD_STANDBY, kid, notBefore, 0), 0, bytes32(0));
        vm.warp(notBefore);
        _commit(_op(ChitIssuerCodes.OP_PROMOTE, kid, 0, 0), 0, bytes32(0));
    }

    function _commit(ChitIssuerRoot.Op memory op, uint64 version, bytes32 snapshot) internal {
        root.commit(_one(op), _noFreezes(), version, snapshot);
    }

    function _commitOn(bytes32 kid, uint8 kind, uint64 ts, uint8 reason) internal {
        uint64 version = root.historyVersion();
        bytes32 snapshot = root.historySnapshot();
        root.commit(_one(_op(kind, kid, ts, reason)), _noFreezes(), version, snapshot);
    }

    function _op(uint8 kind, bytes32 kid, uint64 timestamp, uint8 reasonCode) internal pure returns (ChitIssuerRoot.Op memory) {
        return ChitIssuerRoot.Op({kind: kind, kid: kid, timestamp: timestamp, reasonCode: reasonCode});
    }

    function _one(ChitIssuerRoot.Op memory op) internal pure returns (ChitIssuerRoot.Op[] memory ops) {
        ops = new ChitIssuerRoot.Op[](1);
        ops[0] = op;
    }

    function _noOps() internal pure returns (ChitIssuerRoot.Op[] memory ops) {
        ops = new ChitIssuerRoot.Op[](0);
    }

    function _noFreezes() internal pure returns (ChitIssuerRoot.FreezeArg[] memory freezeArgs) {
        freezeArgs = new ChitIssuerRoot.FreezeArg[](0);
    }

    function isOwner(address) external pure returns (bool) {
        return false;
    }

    function _genesisHash(ChitIssuerRoot r, bytes32 kid, uint64 notBefore) internal view returns (bytes32) {
        (uint64 seq, uint64 threshold, address[] memory set,) = r.guardianSet();
        ChitIssuerDigests.GenesisStatic memory p;
        p.chainId = block.chainid;
        p.registry = address(r);
        p.controller = address(this);
        p.genesisKid = kid;
        p.genesisNotBefore = notBefore;
        p.activatedAt = notBefore;
        p.blockNumber = uint64(block.number);
        p.witnessSalt = r.witnessSalt();
        p.guardianSeq = seq;
        p.guardianThreshold = threshold;
        return ChitIssuerDigests.genesisRootHash(p, set);
    }

    function _jsHash(
        bytes32 prev,
        uint64 seq,
        address registry,
        uint64 blockNumber,
        ChitIssuerRoot.Op memory op,
        uint64 version,
        bytes32 snapshot
    ) internal returns (bytes32) {
        string[] memory cmd = new string[](24);
        cmd[0] = "node";
        cmd[1] = "scripts/issuer-root.mjs";
        cmd[2] = "hash";
        cmd[3] = "--prev";
        cmd[4] = vm.toString(prev);
        cmd[5] = "--seq";
        cmd[6] = vm.toString(seq);
        cmd[7] = "--chain";
        cmd[8] = vm.toString(block.chainid);
        cmd[9] = "--registry";
        cmd[10] = vm.toString(registry);
        cmd[11] = "--block";
        cmd[12] = vm.toString(blockNumber);
        cmd[13] = "--hist-version";
        cmd[14] = vm.toString(version);
        cmd[15] = "--hist-snapshot";
        cmd[16] = vm.toString(snapshot);
        cmd[17] = "--op";
        cmd[18] = string.concat(
            vm.toString(uint256(op.kind)),
            ",",
            vm.toString(op.kid),
            ",",
            vm.toString(uint256(op.timestamp)),
            ",",
            vm.toString(uint256(op.reasonCode))
        );
        cmd[19] = "--guardian-seq";
        cmd[20] = vm.toString(root.guardianSeq());
        cmd[21] = "--guardian-set";
        cmd[22] = vm.toString(root.guardianSetHash());
        string[] memory trimmed = new string[](23);
        for (uint256 i = 0; i < 23; i++) trimmed[i] = cmd[i];
        bytes memory out = vm.ffi(trimmed);
        if (out.length == 32) return bytes32(out);
        uint256 n = out.length;
        if (n > 0 && out[n - 1] == 0x0a) n--;
        bytes memory hexChars = new bytes(n);
        for (uint256 i = 0; i < n; i++) hexChars[i] = out[i];
        return vm.parseBytes32(string(hexChars));
    }
}
