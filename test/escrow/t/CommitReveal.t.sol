// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {EscrowFixture} from "./utils/EscrowFixture.sol";
import {MockUSDC} from "./utils/MockUSDC.sol";
import {EquivocationEscrowV0 as E} from "escrow/EquivocationEscrowV0.sol";

/// @dev Brief tests CR1-CR14 (commit-reveal).
contract CommitRevealTest is EscrowFixture {
    bytes32 constant R1 = keccak256("root-1");
    bytes32 constant R2 = keccak256("root-2");
    bytes32 constant R3 = keccak256("root-3");

    function _commitSeq(bytes32 c) internal view returns (uint48 seq) {
        (,, seq) = esc.commits(c);
    }

    // CR1
    function test_CR1_reveal_one_second_early_then_exact() public {
        PairA memory p = pairA(5, 20, R1, R2);
        bytes32 salt = keccak256("cr1");
        commitA(alice, alice, p, salt);
        uint256 at = block.timestamp;
        vm.warp(at + 5 minutes - 1);
        vm.expectRevert(E.CommitTooYoung.selector);
        revealA(alice, alice, p, salt);
        vm.warp(at + 5 minutes);
        revealA(alice, alice, p, salt);
        assertEq(esc.incidentCount(), 1, "revealed at exactly MIN_DELAY");
    }

    // CR2
    function test_CR2_reveal_expired_and_last_second() public {
        PairA memory p = pairA(5, 20, R1, R2);
        bytes32 salt = keccak256("cr2");
        commitA(alice, alice, p, salt);
        uint256 at = block.timestamp;
        vm.warp(at + 5 minutes + 24 hours + 1);
        vm.expectRevert(E.CommitExpired.selector);
        revealA(alice, alice, p, salt);

        PairA memory q = pairA(6, 20, R1, R2);
        salt = keccak256("cr2b");
        commitA(alice, alice, q, salt);
        at = block.timestamp;
        vm.warp(at + 5 minutes + 24 hours);
        revealA(alice, alice, q, salt);
        assertEq(esc.incidentCount(), 1, "last second accepted");
    }

    // CR3
    function test_CR3_reveal_from_other_address() public {
        PairA memory p = pairA(5, 20, R1, R2);
        bytes32 salt = keccak256("cr3");
        commitA(alice, alice, p, salt);
        passDelay();
        vm.expectRevert(E.NoCommit.selector);
        revealA(bob, alice, p, salt);
        vm.expectRevert(E.NoCommit.selector);
        revealA(bob, bob, p, salt);
    }

    // CR4
    function test_CR4_copier_after_reveal_loses() public {
        PairA memory p = pairA(5, 20, R1, R2);
        submitA(alice, carol, p);
        // Copier sees the reveal and commits the same evidence, and variants.
        bytes32 s1 = keccak256("copy");
        commitA(bob, bob, p, s1);
        PairA memory swapped = PairA({h1: p.h2, s1: highS(p.s2), h2: p.h1, s2: p.s1});
        bytes32 s2 = keccak256("copy2");
        commitA(bob, bob, swapped, s2);
        // A new key from the same fork in the same epoch (third root).
        PairA memory third = pairA(5, 20, R1, R3);
        bytes32 s3 = keccak256("copy3");
        commitA(bob, bob, third, s3);
        passDelay();
        vm.expectRevert(E.DuplicateEvidence.selector);
        revealA(bob, bob, p, s1);
        vm.expectRevert(E.DuplicateEvidence.selector);
        revealA(bob, bob, swapped, s2);
        revealA(bob, bob, third, s3); // recorded, but a later seq
        vm.warp(block.timestamp + 1 hours);
        esc.finalizeBounty(5);
        assertEq(esc.credits(carol), 50 * ONE, "original finder keeps the bounty");
        assertEq(esc.credits(bob), 0, "copier gets nothing");
    }

    // CR5
    function test_CR5_same_block_commits_lower_seq_wins() public {
        PairA memory pa = pairA(5, 20, R1, R2);
        PairA memory pb = pairA(5, 20, R1, R3);
        bytes32 sa = keccak256("a");
        bytes32 sb = keccak256("b");
        bytes32 ca = commitA(alice, alice, pa, sa);
        bytes32 cb = commitA(bob, bob, pb, sb);
        assertTrue(_commitSeq(ca) < _commitSeq(cb), "strict seq in one block");
        passDelay();
        revealA(bob, bob, pb, sb); // B reveals first
        revealA(alice, alice, pa, sa); // A reveals inside the contest window
        vm.warp(block.timestamp + 1 hours);
        esc.finalizeBounty(5);
        assertEq(esc.credits(alice), 50 * ONE, "lower seq wins");
        assertEq(esc.credits(bob), 0, "higher seq");
    }

    // CR6
    function test_CR6_reveal_after_contest_window_changes_nothing() public {
        PairA memory pa = pairA(5, 20, R1, R2);
        PairA memory pb = pairA(5, 20, R1, R3);
        bytes32 sa = keccak256("a");
        bytes32 sb = keccak256("b");
        commitA(alice, alice, pa, sa); // lower seq
        commitA(bob, bob, pb, sb);
        passDelay();
        revealA(bob, bob, pb, sb);
        vm.warp(block.timestamp + 1 hours); // contest window over
        revealA(alice, alice, pa, sa);
        (bytes32 lo, bytes32 hi) = R1 < R2 ? (R1, R2) : (R2, R1);
        assertEq(esc.evidenceIncident(esc.keyA(5, 20, lo, hi)), 1, "evidence still recorded");
        esc.finalizeBounty(5);
        assertEq(esc.credits(bob), 50 * ONE, "bounty unchanged");
        assertEq(esc.credits(alice), 0, "late reveal, no bounty");
    }

    // CR7
    function test_CR7_same_commit_twice() public {
        bytes32 c = keccak256("c");
        vm.prank(alice);
        esc.commit(c);
        vm.prank(alice);
        vm.expectRevert(E.CommitExists.selector);
        esc.commit(c);
        vm.prank(bob);
        vm.expectRevert(E.CommitExists.selector);
        esc.commit(c);
    }

    // CR8
    function test_CR8_non_canonical_abi_encoding_same_hash_no_second_key() public {
        E.EvidenceB memory ev = forkB(7, 16, 5, 2);
        bytes32 salt = keccak256("cr8");
        commitB(alice, alice, ev, salt);
        passDelay();

        // Canonical calldata, then a variant with one junk word inserted before
        // the tuple tail and the two array offsets moved by 32.
        bytes memory canon = abi.encodeCall(E.revealB, (ev, alice, salt));
        bytes memory odd = _shiftArrays(canon);
        assertTrue(keccak256(odd) != keccak256(canon), "different bytes");

        bytes memory hashCallCanon = abi.encodeCall(E.evidenceHashB, (ev));
        bytes memory hashCallOdd = _shiftArraysAt(hashCallCanon, 4 + 32);
        (, bytes memory h1) = address(esc).staticcall(hashCallCanon);
        (bool okOdd, bytes memory h2) = address(esc).staticcall(hashCallOdd);
        assertTrue(okOdd, "odd encoding decodes");
        assertEq(abi.decode(h1, (bytes32)), abi.decode(h2, (bytes32)), "same evidenceHash");

        vm.prank(alice);
        (bool ok,) = address(esc).call(odd);
        assertTrue(ok, "reveal with non-canonical encoding");
        assertEq(esc.incidentCount(), 1, "recorded once");

        // The canonical form of the same evidence, from another commit, is a duplicate.
        bytes32 salt2 = keccak256("cr8b");
        commitB(bob, bob, ev, salt2);
        passDelay();
        vm.expectRevert(E.DuplicateEvidence.selector);
        revealB(bob, bob, ev, salt2);
    }

    /// @dev Calldata layout: selector | offset(ev) | payTo | salt | tuple.
    function _shiftArrays(bytes memory cd) internal pure returns (bytes memory) {
        return _shiftArraysAt(cd, 4 + 3 * 32);
    }

    /// @dev Tuple head is 17 static words then the p1 and p2 offsets.
    function _shiftArraysAt(bytes memory cd, uint256 tupleStart) internal pure returns (bytes memory out) {
        uint256 headEnd = tupleStart + 19 * 32;
        out = new bytes(cd.length + 32);
        for (uint256 i = 0; i < headEnd; i++) out[i] = cd[i];
        for (uint256 i = 0; i < 32; i++) out[headEnd + i] = 0xAB;
        for (uint256 i = headEnd; i < cd.length; i++) out[i + 32] = cd[i];
        for (uint256 k = 17; k < 19; k++) {
            uint256 pos = tupleStart + k * 32;
            uint256 v;
            assembly {
                v := mload(add(add(out, 0x20), pos))
            }
            v += 32;
            assembly {
                mstore(add(add(out, 0x20), pos), v)
            }
        }
    }

    // CR9
    function test_CR9_wrong_payto_salt_type_chain_contract() public {
        PairA memory p = pairA(5, 20, R1, R2);
        bytes32 salt = keccak256("cr9");
        bytes32 c = commitA(alice, alice, p, salt);
        passDelay();
        vm.expectRevert(E.NoCommit.selector);
        revealA(alice, bob, p, salt);
        vm.expectRevert(E.NoCommit.selector);
        revealA(alice, alice, p, keccak256("other"));

        // Commit made with the wrong type, chainId or contract address.
        bytes32 eh = esc.evidenceHashA(p.h1, p.s1, p.h2, p.s2);
        bytes32 wrongType = esc.commitHash(alice, alice, 2, eh, keccak256("t"));
        bytes32 wrongChain = keccak256(abi.encode(esc.COMMIT_TAG(), uint256(8453), address(esc), alice, alice, uint8(1), eh, keccak256("ch")));
        bytes32 wrongAddr = keccak256(abi.encode(esc.COMMIT_TAG(), uint256(84532), address(0xBEEF), alice, alice, uint8(1), eh, keccak256("ad")));
        vm.startPrank(alice);
        esc.commit(wrongType);
        esc.commit(wrongChain);
        esc.commit(wrongAddr);
        vm.stopPrank();
        passDelay();
        vm.expectRevert(E.NoCommit.selector);
        revealA(alice, alice, p, keccak256("t"));
        vm.expectRevert(E.NoCommit.selector);
        revealA(alice, alice, p, keccak256("ch"));
        vm.expectRevert(E.NoCommit.selector);
        revealA(alice, alice, p, keccak256("ad"));
        assertEq(esc.incidentCount(), 0, "no state change");
        (address committer,,) = esc.commits(c);
        assertEq(committer, alice, "original commit untouched");
        revealA(alice, alice, p, salt);
        assertEq(esc.incidentCount(), 1, "correct reveal still works");
    }

    // CR10
    function test_CR10_freeze_is_immediate_not_after_contest() public {
        vm.warp(esc.activatedAt() + 14 days);
        vm.prank(owner);
        esc.giveNotice();
        vm.warp(esc.withdrawableAt() - 1);
        PairA memory p = pairA(5, 20, R1, R2);
        bytes32 salt = keccak256("cr10");
        commitA(alice, alice, p, salt);
        vm.warp(esc.revealGraceEnd() - 1);
        assertFalse(esc.frozen(), "pending commit does not freeze");
        revealA(alice, alice, p, salt);
        assertTrue(esc.frozen(), "frozen in the reveal block");
        vm.warp(block.timestamp + 1); // next block, contest window still open
        vm.prank(owner);
        vm.expectRevert(E.IncidentOpen.selector);
        esc.withdraw();
    }

    // CR11
    function test_CR11_coverage_end() public {
        vm.warp(esc.activatedAt() + 14 days);
        vm.prank(owner);
        esc.giveNotice();
        uint256 wa = esc.withdrawableAt();
        vm.warp(wa);
        vm.prank(alice);
        vm.expectRevert(E.CoverageEnded.selector);
        esc.commit(keccak256("late"));

        vm.warp(wa - 1);
        PairA memory p = pairA(5, 20, R1, R2);
        bytes32 salt = keccak256("cr11");
        commitA(alice, alice, p, salt);
        vm.warp(esc.revealGraceEnd() - 2);
        vm.prank(owner);
        vm.expectRevert(E.TooEarly.selector);
        esc.withdraw();
        // The reveal of an earlier commit passes inside the grace.
        revealA(alice, alice, p, salt);
        assertTrue(esc.frozen(), "evidence counted in the grace");
    }

    function test_CR11_withdraw_after_grace_with_unrevealed_commit() public {
        vm.warp(esc.activatedAt() + 14 days);
        vm.prank(owner);
        esc.giveNotice();
        vm.warp(esc.withdrawableAt() - 1);
        PairA memory p = pairA(5, 20, R1, R2);
        bytes32 salt = keccak256("never");
        commitA(alice, alice, p, salt);
        vm.warp(esc.revealGraceEnd());
        vm.expectRevert(E.CommitExpired.selector);
        revealA(alice, alice, p, salt);
        vm.prank(owner);
        esc.withdraw();
        assertTrue(esc.closed(), "pending commit did not block the exit after the grace");
    }

    // CR12
    function test_CR12_open_commit_cap_and_spam_never_blocks() public {
        vm.startPrank(alice);
        for (uint256 i = 0; i < 8; i++) esc.commit(keccak256(abi.encode("spam", i)));
        vm.expectRevert(E.TooManyOpenCommits.selector);
        esc.commit(keccak256("ninth"));
        vm.stopPrank();
        assertFalse(esc.frozen(), "spam commits freeze nothing");

        // Expired commits stop counting.
        vm.warp(block.timestamp + 5 minutes + 24 hours + 1);
        vm.prank(alice);
        esc.commit(keccak256("ninth"));

        // Many addresses spam right up to withdrawableAt; withdraw still works after the grace.
        vm.warp(esc.activatedAt() + 14 days);
        vm.prank(owner);
        esc.giveNotice();
        vm.warp(esc.withdrawableAt() - 1);
        for (uint256 a = 0; a < 5; a++) {
            vm.startPrank(address(uint160(0xD000 + a)));
            for (uint256 i = 0; i < 8; i++) esc.commit(keccak256(abi.encode("late spam", a, i)));
            vm.stopPrank();
        }
        assertFalse(esc.frozen(), "still not frozen");
        vm.warp(esc.revealGraceEnd());
        vm.prank(owner);
        esc.withdraw();
        assertTrue(esc.closed(), "withdrawn");
    }

    function test_CR12_revealed_commit_frees_its_slot() public {
        PairA memory p = pairA(5, 20, R1, R2);
        bytes32 salt = keccak256("slot");
        commitA(alice, alice, p, salt);
        vm.startPrank(alice);
        for (uint256 i = 0; i < 7; i++) esc.commit(keccak256(abi.encode("fill", i)));
        vm.expectRevert(E.TooManyOpenCommits.selector);
        esc.commit(keccak256("over"));
        vm.stopPrank();
        passDelay();
        revealA(alice, alice, p, salt);
        vm.prank(alice);
        esc.commit(keccak256("over"));
    }

    function test_CR12_expired_commit_can_be_made_again() public {
        bytes32 c = keccak256("again");
        vm.prank(alice);
        esc.commit(c);
        uint48 s1 = _commitSeq(c);
        vm.warp(block.timestamp + 5 minutes + 24 hours + 1);
        vm.prank(alice);
        esc.commit(c);
        assertGt(_commitSeq(c), s1, "fresh seq");
    }

    // CR13
    function test_CR13_reveal_before_activation() public {
        MockUSDC t = new MockUSDC();
        usdc = t;
        E e2 = deploy(address(t));
        E prev = esc;
        esc = e2;
        PairA memory p = pairA(5, 20, R1, R2);
        bytes32 salt = keccak256("cr13");
        commitA(alice, alice, p, salt); // allowed before activation
        passDelay();
        vm.expectRevert(E.NotActive.selector);
        revealA(alice, alice, p, salt);
        pinDefaultList(e2);
        fundAndActivate(e2, 1000 * ONE);
        revealA(alice, alice, p, salt);
        assertEq(e2.incidentCount(), 1, "revealed after activation");
        esc = prev;
    }

    // CR14
    function test_CR14_bounty_caps_through_commit_reveal() public {
        for (uint32 ep = 20; ep < 24; ep++) {
            for (uint256 k = 0; k < 3; k++) {
                address who = address(uint160(0xE000 + ep * 10 + k));
                PairA memory p = pairA(ep, 9, R1, keccak256(abi.encode(ep, k)));
                commitA(who, who, p, bytes32(k));
            }
        }
        passDelay();
        for (uint32 ep = 20; ep < 24; ep++) {
            for (uint256 k = 0; k < 3; k++) {
                address who = address(uint160(0xE000 + ep * 10 + k));
                PairA memory p = pairA(ep, 9, R1, keccak256(abi.encode(ep, k)));
                revealA(who, who, p, bytes32(k));
            }
        }
        vm.warp(block.timestamp + 1 hours);
        uint256 total;
        for (uint32 ep = 20; ep < 24; ep++) {
            esc.finalizeBounty(ep);
            for (uint256 k = 0; k < 3; k++) total += esc.credits(address(uint160(0xE000 + ep * 10 + k)));
        }
        assertEq(total, 100 * ONE, "total bounty cap");
        assertEq(esc.bountiesPaid(), 100 * ONE, "bountiesPaid");
        assertEq(esc.credits(address(uint160(0xE000 + 20 * 10))), 50 * ONE, "epoch 20 first commit");
        assertEq(esc.credits(address(uint160(0xE000 + 21 * 10))), 50 * ONE, "epoch 21 first commit");
        vm.expectRevert(E.NoPendingBounty.selector);
        esc.finalizeBounty(20);
    }
}
