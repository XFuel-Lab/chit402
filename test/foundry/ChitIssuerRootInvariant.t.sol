// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {ChitIssuerCodes, ChitIssuerRoot} from "../../contracts/registry/ChitIssuerRoot.sol";

contract ChitIssuerRootHandler is Test {
    ChitIssuerRoot public root;
    bytes32 public immutable genesisKid;
    uint64 public ghostSeq;
    bytes32[] public tracked;
    bytes32[] public revokedKids;
    bytes32[] public frozenIds;
    bytes32[] public frozenHashes;
    uint64[] public frozenCounts;
    uint64[] public frozenBlocks;
    uint64[] public frozenSeqs;
    address public supersededTo;

    constructor() {
        genesisKid = keccak256("invariant-genesis");
        root = new ChitIssuerRoot(address(this), genesisKid, 1_700_000_000);
        vm.warp(1_700_000_000);
    }

    function warpForward(uint32 secs) external {
        vm.warp(block.timestamp + secs);
    }

    function addStandby(bytes32 kid, uint64 extra) external {
        if (kid == bytes32(0) || kid == genesisKid) kid = keccak256(abi.encode("standby", kid, extra));
        uint64 notBefore = uint64(block.timestamp + root.ACTIVATION_DELAY() + (extra % 10 days));
        ChitIssuerRoot.Op[] memory ops = new ChitIssuerRoot.Op[](1);
        ops[0] = ChitIssuerRoot.Op({kind: ChitIssuerCodes.OP_ADD_STANDBY, kid: kid, timestamp: notBefore, reasonCode: 0});
        if (_commit(ops, new ChitIssuerRoot.FreezeArg[](0))) tracked.push(kid);
    }

    function promote(uint256 index) external {
        if (tracked.length == 0) return;
        bytes32 kid = tracked[index % tracked.length];
        ChitIssuerRoot.Op[] memory ops = new ChitIssuerRoot.Op[](1);
        ops[0] = ChitIssuerRoot.Op({kind: ChitIssuerCodes.OP_PROMOTE, kid: kid, timestamp: 0, reasonCode: 0});
        _commit(ops, new ChitIssuerRoot.FreezeArg[](0));
    }

    function retire(uint256 index, uint64 notAfter) external {
        if (tracked.length == 0) return;
        bytes32 kid = tracked[index % tracked.length];
        (uint8 status,, uint64 notBefore,,,) = root.keys(kid);
        if (status != ChitIssuerCodes.STATUS_ACTIVE) return;
        if (notAfter < notBefore) notAfter = notBefore;
        ChitIssuerRoot.Op[] memory ops = new ChitIssuerRoot.Op[](1);
        ops[0] = ChitIssuerRoot.Op({kind: ChitIssuerCodes.OP_RETIRE, kid: kid, timestamp: notAfter, reasonCode: 0});
        _commit(ops, new ChitIssuerRoot.FreezeArg[](0));
    }

    function revoke(uint256 index, uint64 revokedAt, uint8 reason) external {
        bytes32 kid = index % (tracked.length + 1) == 0 ? genesisKid : tracked[index % tracked.length];
        (uint8 status,, uint64 notBefore,,,) = root.keys(kid);
        if (status == ChitIssuerCodes.STATUS_NONE || status == ChitIssuerCodes.STATUS_REVOKED) return;
        if (reason != 1 && reason != 2 && reason != 3 && reason != 255) reason = 1;
        if (revokedAt < notBefore) revokedAt = notBefore;
        if (status != ChitIssuerCodes.STATUS_STANDBY && revokedAt > block.timestamp) {
            revokedAt = uint64(block.timestamp);
        }
        if (revokedAt == 0) revokedAt = notBefore == 0 ? 1 : notBefore;
        ChitIssuerRoot.Op[] memory ops = new ChitIssuerRoot.Op[](1);
        ops[0] = ChitIssuerRoot.Op({
            kind: ChitIssuerCodes.OP_REVOKE,
            kid: kid,
            timestamp: revokedAt,
            reasonCode: reason
        });
        if (_commit(ops, new ChitIssuerRoot.FreezeArg[](0))) revokedKids.push(kid);
    }

    function freeze(bytes32 universeId, bytes32 universeHash, uint64 count) external {
        if (universeId == bytes32(0)) universeId = keccak256(abi.encode("universe", universeHash, count));
        ChitIssuerRoot.FreezeArg[] memory fz = new ChitIssuerRoot.FreezeArg[](1);
        fz[0] = ChitIssuerRoot.FreezeArg({universeId: universeId, universeHash: universeHash, enumeratedCount: count});
        if (_commit(new ChitIssuerRoot.Op[](0), fz)) {
            (bytes32 h, uint64 n, uint64 b, uint64 seq) = root.freezes(universeId);
            frozenIds.push(universeId);
            frozenHashes.push(h);
            frozenCounts.push(n);
            frozenBlocks.push(b);
            frozenSeqs.push(seq);
        }
    }

    function supersede(address next) external {
        if (supersededTo != address(0) || next == address(0) || next == address(root)) return;
        root.supersede(next);
        supersededTo = next;
        assertEq(root.rootSeq(), ghostSeq);
    }

    function assertRevokesStick() external view {
        for (uint256 i = 0; i < revokedKids.length; i++) {
            (uint8 status,,,,,) = root.keys(revokedKids[i]);
            assertEq(status, ChitIssuerCodes.STATUS_REVOKED);
        }
    }

    function assertFreezesStick() external view {
        for (uint256 i = 0; i < frozenIds.length; i++) {
            (bytes32 h, uint64 n, uint64 b, uint64 seq) = root.freezes(frozenIds[i]);
            assertEq(h, frozenHashes[i]);
            assertEq(n, frozenCounts[i]);
            assertEq(b, frozenBlocks[i]);
            assertEq(seq, frozenSeqs[i]);
            assertGt(seq, 0);
        }
    }

    function assertWasActive() external view {
        _was(genesisKid);
        for (uint256 i = 0; i < tracked.length; i++) _was(tracked[i]);
    }

    function _was(bytes32 kid) internal view {
        (uint8 status, bool wasActive,,, uint64 revokedAt, uint64 activatedAt) = root.keys(kid);
        if (status == ChitIssuerCodes.STATUS_ACTIVE || status == ChitIssuerCodes.STATUS_RETIRED) {
            assertTrue(wasActive);
            assertGt(activatedAt, 0);
        }
        if (status == ChitIssuerCodes.STATUS_STANDBY) {
            assertFalse(wasActive);
            assertEq(activatedAt, 0);
        }
        revokedAt;
    }

    function _commit(ChitIssuerRoot.Op[] memory ops, ChitIssuerRoot.FreezeArg[] memory fz) internal returns (bool ok) {
        uint64 before = root.rootSeq();
        try root.commit(ops, fz, root.historyVersion(), root.historySnapshot()) {
            assertEq(root.rootSeq(), before + 1);
            ghostSeq = root.rootSeq();
            return true;
        } catch {
            assertEq(root.rootSeq(), before);
            return false;
        }
    }
}

contract ChitIssuerRootInvariantTest is Test {
    ChitIssuerRootHandler internal handler;

    function setUp() public {
        handler = new ChitIssuerRootHandler();
        targetContract(address(handler));
        bytes4[] memory selectors = new bytes4[](7);
        selectors[0] = handler.warpForward.selector;
        selectors[1] = handler.addStandby.selector;
        selectors[2] = handler.promote.selector;
        selectors[3] = handler.retire.selector;
        selectors[4] = handler.revoke.selector;
        selectors[5] = handler.freeze.selector;
        selectors[6] = handler.supersede.selector;
        targetSelector(FuzzSelector({addr: address(handler), selectors: selectors}));
    }

    function invariant_rootSeqMatchesGhost() public view {
        assertEq(handler.root().rootSeq(), handler.ghostSeq());
        if (handler.ghostSeq() == 0) assertTrue(handler.root().rootHash() != bytes32(0));
    }

    function invariant_revokeIrreversible() public view {
        handler.assertRevokesStick();
    }

    function invariant_freezeWriteOnce() public view {
        handler.assertFreezesStick();
    }

    function invariant_wasActiveMatchesStatus() public view {
        handler.assertWasActive();
    }

    function invariant_supersedeSticks() public view {
        if (handler.supersededTo() != address(0)) {
            assertEq(handler.root().supersededBy(), handler.supersededTo());
        }
    }
}
