// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {EscrowFixture} from "./utils/EscrowFixture.sol";
import {EquivocationEscrowV0 as E} from "escrow/EquivocationEscrowV0.sol";

/// @dev (i) Within one escrow a given equivocation slashes once: the same pair of
///      conflicting heads, in either order and with re-encoded but equivalent
///      signatures (high-S twins), by another committer and payTo, reverts
///      DuplicateEvidence, and the bond moves once.
contract SlashOnceTest is EscrowFixture {
    bytes32 internal constant R1 = keccak256("root one");
    bytes32 internal constant R2 = keccak256("root two");

    function _dupA(address who, PairA memory p, bytes32 salt) internal {
        bytes32 c = commitA(who, who, p, salt);
        passDelay();
        uint256 bond = esc.bondAccounted();
        uint256 n = esc.incidentCount();
        vm.expectRevert(E.DuplicateEvidence.selector);
        revealA(who, who, p, salt);
        assertEq(esc.bondAccounted(), bond, "bond unchanged");
        assertEq(esc.incidentCount(), n, "no new incident");
        (address committer,,) = esc.commits(c);
        assertEq(committer, who, "commit kept");
    }

    function test_S1_same_equivocation_slashes_once_any_order_or_encoding() public {
        PairA memory p = pairA(5, 20, R1, R2);
        submitA(alice, carol, p);
        assertEq(esc.incidentCount(), 1, "one incident");

        _dupA(bob, p, keccak256("same"));
        _dupA(bob, PairA({h1: p.h2, s1: p.s2, h2: p.h1, s2: p.s1}), keccak256("swapped"));
        _dupA(bob, PairA({h1: p.h1, s1: highS(p.s1), h2: p.h2, s2: p.s2}), keccak256("high-S first"));
        _dupA(bob, PairA({h1: p.h1, s1: highS(p.s1), h2: p.h2, s2: highS(p.s2)}), keccak256("high-S both"));
        _dupA(bob, PairA({h1: p.h2, s1: highS(p.s2), h2: p.h1, s2: highS(p.s1)}), keccak256("swapped high-S"));
        _dupA(alice, p, keccak256("same finder again"));
        // I3: the same roots with another published_at (re-signed) are the same evidence key.
        PairA memory q = p;
        q.h1.publishedAt = p.h1.publishedAt + 1;
        q.s1 = signHead(q.h1);
        q.h2.publishedAt = p.h2.publishedAt + 7;
        q.s2 = signHead(q.h2);
        _dupA(bob, q, keccak256("other published_at"));

        vm.warp(block.timestamp + esc.CONTEST_WINDOW());
        esc.finalizeBounty(5);
        assertEq(esc.bondAccounted(), 950 * ONE, "bond moved once (one 50 USDC bounty)");
        assertEq(esc.credits(carol), 50 * ONE, "first payTo credited");
        assertEq(esc.credits(bob), 0, "duplicates earn nothing");

        // After the slash, the same evidence again (both orders) still reverts and the bond stays.
        _dupA(bob, p, keccak256("after finalize"));
        _dupA(bob, PairA({h1: p.h2, s1: highS(p.s2), h2: p.h1, s2: p.s1}), keccak256("after finalize swapped"));
        vm.expectRevert();
        esc.finalizeBounty(5);
        assertEq(esc.bondAccounted(), 950 * ONE, "bond still moved once");
        assertEq(esc.bountiesPaid(), 50 * ONE, "one bounty paid");
    }

    /// @dev Type B: the same fork at the same index, with the leaves (and heads) given in
    ///      the other order, or high-S signatures, is the same evidence key: DuplicateEvidence.
    function test_S2_same_typeB_equivocation_once() public {
        E.EvidenceB memory ev = forkB(7, 16, 3, 42);
        submitB(alice, carol, ev);
        uint256 bond = esc.bondAccounted();

        E.EvidenceB memory sw = ev;
        (sw.h1, sw.h2) = (ev.h2, ev.h1);
        (sw.s1, sw.s2) = (ev.s2, ev.s1);
        (sw.l1, sw.l2) = (ev.l2, ev.l1);
        (sw.p1, sw.p2) = (ev.p2, ev.p1);
        E.EvidenceB memory hs = ev;
        hs.s1 = highS(ev.s1);
        hs.s2 = highS(ev.s2);
        E.EvidenceB[3] memory dups = [ev, sw, hs];
        for (uint256 i = 0; i < dups.length; i++) {
            bytes32 salt = keccak256(abi.encode("b-dup", i));
            commitB(bob, bob, dups[i], salt);
            passDelay();
            vm.expectRevert(E.DuplicateEvidence.selector);
            revealB(bob, bob, dups[i], salt);
        }
        assertEq(esc.incidentCount(), 1, "one incident");
        assertEq(esc.bondAccounted(), bond, "bond unchanged by duplicates");
        vm.warp(block.timestamp + esc.CONTEST_WINDOW());
        esc.finalizeBounty(7);
        assertEq(esc.bondAccounted(), bond - 50 * ONE, "one bounty");
        assertEq(esc.credits(bob), 0, "duplicates earn nothing");
    }

    /// @dev I4: type A and type B evidence from one epoch join one incident and pay one bounty.
    function test_S3_typeA_and_typeB_same_epoch_one_incident_one_bounty() public {
        E.EvidenceB memory ev = forkB(7, 16, 3, 42);
        submitB(alice, alice, ev);
        submitA(bob, bob, PairA({h1: ev.h1, s1: ev.s1, h2: ev.h2, s2: ev.s2}));
        assertEq(esc.incidentCount(), 1, "one incident for the epoch");
        uint256 bond = esc.bondAccounted();
        vm.warp(block.timestamp + esc.CONTEST_WINDOW());
        esc.finalizeBounty(7);
        assertEq(esc.bountiesPaid(), 50 * ONE, "one bounty");
        assertEq(esc.bondAccounted(), bond - 50 * ONE, "bond moved once");
        assertEq(esc.credits(alice), 50 * ONE, "earliest finder");
        assertEq(esc.credits(bob), 0, "second form earns nothing");
    }
}
