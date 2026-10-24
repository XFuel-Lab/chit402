// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {EscrowFixture} from "./utils/EscrowFixture.sol";
import {TreeLib} from "./utils/TreeLib.sol";
import {EquivocationEscrowV0 as E} from "escrow/EquivocationEscrowV0.sol";

/// @dev One fork is one incident, keyed by (epoch, kid). A settled or expired
///      epoch never re-opens, and later keys from it pay nothing. At most one
///      incident is open at a time, and the total frozen time over the bond's
///      life is capped at 28 days; after that, incidents pay but never freeze.
contract IncidentScopeTest is EscrowFixture {
    uint32 constant EP = 9;
    uint256 constant SIZE = 32;

    bytes32[] internal honest;
    bytes32[] internal forked;
    E.TreeHead internal hH;
    E.TreeHead internal hF;
    E.Sig internal sH;
    E.Sig internal sF;

    function setUp() public override {
        super.setUp();
        honest = TreeLib.leaves(SIZE, 91);
        forked = TreeLib.leaves(SIZE, 91);
        for (uint256 i = 3; i < SIZE; i++) forked[i] = TreeLib.leaf(abi.encodePacked("fork9-", i));
        hH = head(EP, uint64(SIZE), TreeLib.root(honest));
        hF = head(EP, uint64(SIZE), TreeLib.root(forked));
        sH = signHead(hH);
        sF = signHead(hF);
    }

    // ---------------- helpers ----------------

    /// @dev Type B key from the epoch-9 fork at index i (i >= 3).
    function evAt(uint256 i) internal view returns (E.EvidenceB memory ev) {
        ev = E.EvidenceB(hH, sH, hF, sF, uint64(i), honest[i], forked[i], TreeLib.proof(honest, i), TreeLib.proof(forked, i));
    }

    /// @dev Type A key from the epoch-9 fork at a prefix size n (4..SIZE).
    function prefixA(uint256 n) internal view returns (PairA memory p) {
        bytes32[] memory a = new bytes32[](n);
        bytes32[] memory b = new bytes32[](n);
        for (uint256 i = 0; i < n; i++) {
            a[i] = honest[i];
            b[i] = forked[i];
        }
        p = pairA(EP, uint64(n), TreeLib.root(a), TreeLib.root(b));
    }

    function keyOf(E.EvidenceB memory ev) internal view returns (bytes32) {
        (bytes32 lo, bytes32 hi) = ev.l1 < ev.l2 ? (ev.l1, ev.l2) : (ev.l2, ev.l1);
        return esc.keyB(ev.h1.epoch, ev.index, lo, hi);
    }

    function register(bytes32 key, bytes32 leaf, address payer, uint64 amt) internal {
        bytes32 ps = keccak256(abi.encode("ps", payer, leaf));
        E.ReceiptBinding memory b = binding(leaf, payer, ps, amt);
        E.Sig memory bs = signBinding(b);
        esc.registerRefund(key, b, bs, payer, ps);
    }

    function expectRegisterRevert(bytes32 key, bytes32 leaf, address payer, uint64 amt, bytes4 err) internal {
        bytes32 ps = keccak256(abi.encode("ps", payer, leaf));
        E.ReceiptBinding memory b = binding(leaf, payer, ps, amt);
        E.Sig memory bs = signBinding(b);
        vm.expectRevert(err);
        esc.registerRefund(key, b, bs, payer, ps);
    }

    function tryRevealB(address who, E.EvidenceB memory ev, bytes4 err) internal {
        bytes32 salt = keccak256(abi.encode("late", who, ev.index, block.timestamp));
        commitB(who, who, ev, salt);
        passDelay();
        vm.prank(who);
        vm.expectRevert(err);
        esc.revealB(ev, who, salt);
    }

    function tryRevealA(address who, PairA memory p, bytes4 err) internal {
        bytes32 salt = keccak256(abi.encode("lateA", who, p.h1.treeSize, block.timestamp));
        commitA(who, who, p, salt);
        passDelay();
        vm.prank(who);
        vm.expectRevert(err);
        esc.revealA(p.h1, p.s1, p.h2, p.s2, who, salt);
    }

    /// @dev Opens the epoch-9 incident with B@3, registers one 5 USDC refund
    ///      for honest[3], finalizes the bounty, settles and pays the refund.
    function openAndSettleEpoch9() internal returns (bytes32 key3, address payer) {
        payer = address(0x9001);
        key3 = submitB(alice, alice, evAt(3));
        assertEq(esc.incidentOf(esc.incidentKey(EP)), 1, "epoch 9 -> incident 1");
        register(key3, honest[3], payer, 5 * ONE);
        vm.warp(block.timestamp + 1 hours);
        esc.finalizeBounty(EP);
        vm.warp(esc.incident(1).claimsCloseAt + 1);
        esc.settle(1);
        esc.claimRefund(honest[3]);
        assertEq(usdc.balanceOf(payer), 5 * ONE, "refund paid once");
        assertFalse(esc.frozen(), "open after settle");
    }

    function noticeNow() internal {
        uint256 earliest = uint256(esc.activatedAt()) + esc.BOND_PERIOD();
        if (block.timestamp < earliest) vm.warp(earliest);
        vm.prank(owner);
        esc.giveNotice();
    }

    // ---------------- same fork after settlement ----------------

    function test_incident_same_fork_chain_after_settle_never_refreezes() public {
        (bytes32 key3, address payer) = openAndSettleEpoch9();
        uint256 bondAfter = esc.bondAccounted();
        assertEq(bondAfter, 1000 * ONE - 5 * ONE - 50 * ONE, "bond after incident 1");
        uint64 closeAt1 = esc.incident(1).claimsCloseAt;

        // Fresh, distinct content keys from the same fork, one per claim
        // window, across four expiries: B at new indices and A at new sizes.
        for (uint256 k = 0; k < 4; k++) {
            address who = address(uint160(0x7100 + k));
            E.EvidenceB memory ev = evAt(4 + k);
            tryRevealB(who, ev, E.IncidentClosed.selector);
            assertEq(esc.evidenceIncident(keyOf(ev)), 0, "late B key not recorded");

            tryRevealA(who, prefixA(8 + k), E.IncidentClosed.selector);

            assertFalse(esc.frozen(), "withdrawal stays open");
            assertEq(esc.incidentCount(), 1, "no new incident");
            assertEq(esc.openIncidents(), 0, "nothing open");
            assertEq(esc.incident(1).claimsCloseAt, closeAt1, "window not extended");
            assertEq(esc.bondAccounted(), bondAfter, "bond untouched");

            // The late leaf has no recorded key, so it cannot register.
            expectRegisterRevert(keyOf(ev), honest[4 + k], address(uint160(0x9100 + k)), 5 * ONE, E.NotAffected.selector);
            vm.warp(block.timestamp + esc.CLAIM_WINDOW() + 1);
        }

        // Nothing pays twice: the settled refund, the old key and the bounty.
        vm.expectRevert(E.NothingToClaim.selector);
        esc.claimRefund(honest[3]);
        expectRegisterRevert(key3, honest[3], payer, 5 * ONE, E.ClaimsClosed.selector);
        vm.expectRevert(E.NoPendingBounty.selector);
        esc.finalizeBounty(EP);
        vm.expectRevert(E.NothingToSettle.selector);
        esc.settle(1);
        assertEq(usdc.balanceOf(payer), 5 * ONE, "payer paid exactly once");
        assertEq(esc.bountiesPaid(), 50 * ONE, "one bounty");

        // Withdrawal goes through on the normal schedule.
        noticeNow();
        tryRevealB(carol, evAt(20), E.IncidentClosed.selector);
        vm.warp(esc.revealGraceEnd());
        vm.prank(owner);
        esc.withdraw();
        assertEq(usdc.balanceOf(owner), bondAfter, "owner gets the rest");
        assertTrue(esc.closed(), "closed");
    }

    function test_incident_expired_unsettled_epoch_refuses_new_keys() public {
        submitB(alice, alice, evAt(3));
        E.Incident memory before = esc.incident(1);
        vm.warp(before.claimsCloseAt + 1);

        // No auto-settle and no new window: the reveal reverts, nothing moves.
        tryRevealB(bob, evAt(5), E.IncidentClosed.selector);
        E.Incident memory after_ = esc.incident(1);
        assertFalse(after_.settled, "not settled by a reveal");
        assertEq(after_.claimsCloseAt, before.claimsCloseAt, "window not extended");
        assertEq(esc.incidentCount(), 1, "one incident");

        esc.settle(1);
        assertFalse(esc.frozen(), "open after settle");
        tryRevealB(carol, evAt(6), E.IncidentClosed.selector);
        assertFalse(esc.frozen(), "still open");
    }

    function test_incident_same_epoch_joins_open_incident() public {
        submitB(alice, alice, evAt(3));
        uint64 closeAt = esc.incident(1).claimsCloseAt;
        vm.warp(block.timestamp + 3 days);
        bytes32 k5 = submitB(bob, bob, evAt(5));
        submitA(carol, carol, prefixA(12));
        assertEq(esc.incidentCount(), 1, "one incident per fork");
        assertEq(esc.openIncidents(), 1, "one open");
        assertEq(esc.evidenceIncident(k5), 1, "joined incident 1");
        assertEq(esc.incident(1).claimsCloseAt, closeAt, "window fixed at first reveal");
    }

    // ---------------- other epochs and the single freeze ----------------

    /// @dev Heads of the same fork re-signed in epoch `ep` (a sustained fork).
    function evAtEpoch(uint32 ep, uint256 i) internal view returns (E.EvidenceB memory ev) {
        E.TreeHead memory g1 = head(ep, uint64(SIZE), TreeLib.root(honest));
        E.TreeHead memory g2 = head(ep, uint64(SIZE), TreeLib.root(forked));
        ev = E.EvidenceB(g1, signHead(g1), g2, signHead(g2), uint64(i), honest[i], forked[i], TreeLib.proof(honest, i), TreeLib.proof(forked, i));
    }

    function openEpoch(uint32 ep, uint256 idx, address who, address payer, uint64 amt) internal returns (bytes32 k) {
        k = submitB(who, who, evAtEpoch(ep, idx));
        register(k, honest[idx], payer, amt);
    }

    function closeOut(uint256 id) internal {
        uint32 ep = esc.incident(id).epoch;
        uint256 t = uint256(esc.incident(id).claimsCloseAt) + 1;
        if (block.timestamp < t) vm.warp(t);
        if (!esc.bounty(ep).finalized) esc.finalizeBounty(ep);
        esc.settle(id);
    }

    /// @dev One fork carried through epochs N to N+4, each epoch opened right
    ///      after the previous one settles, across several expiries. Total
    ///      frozen time stops at 28 days; later epochs still pay; no leaf or
    ///      bounty pays twice; withdrawal works after the cap.
    function test_incident_chain_across_epochs_capped_at_28_days() public {
        uint256 totalFrozen;
        for (uint256 e = 0; e < 5; e++) {
            uint32 ep = EP + uint32(e);
            address who = address(uint160(0x7300 + e));
            address payer = address(uint160(0x9300 + e));
            uint256 openedAt = block.timestamp + esc.MIN_DELAY();
            openEpoch(ep, 3 + e, who, payer, 5 * ONE);
            E.Incident memory inc = esc.incident(e + 1);
            assertEq(inc.epoch, ep, "epoch");
            assertEq(inc.openedAt, openedAt, "opened now");
            uint256 froze = inc.freezeUntil == 0 ? 0 : inc.freezeUntil - inc.openedAt;
            totalFrozen += froze;
            if (e < 2) {
                assertEq(froze, 14 days, "freezes one claim window");
                assertTrue(esc.frozen(), "frozen");
            } else {
                assertEq(froze, 0, "cap reached: no freeze");
                assertFalse(esc.frozen(), "not frozen after the cap");
            }
            assertLe(totalFrozen, 28 days, "cap");
            assertEq(uint256(esc.frozenUsed()), totalFrozen, "frozenUsed tracks");

            // The next epoch of the same fork waits while this one is open.
            tryRevealB(who, evAtEpoch(ep + 1, 20), E.AnotherIncidentOpen.selector);
            // A leaf refunded under an earlier epoch cannot register again.
            if (e > 0) {
                bytes32 again = submitB(who, who, evAtEpoch(ep, 2 + e));
                expectRegisterRevert(again, honest[2 + e], address(uint160(0x9300 + e - 1)), 5 * ONE, E.AlreadyClaimed.selector);
            }

            vm.warp(block.timestamp + 1 hours);
            closeOut(e + 1);
            esc.claimRefund(honest[3 + e]);
            assertEq(usdc.balanceOf(payer), 5 * ONE, "refund once");
            assertFalse(esc.frozen(), "open after settle");
            // A settled epoch never re-opens.
            tryRevealB(who, evAtEpoch(ep, 25), E.IncidentClosed.selector);
        }
        assertEq(totalFrozen, 28 days, "total frozen time is the cap");
        assertEq(esc.bountiesPaid(), 100 * ONE, "bounty cap");
        for (uint256 e = 0; e < 5; e++) {
            vm.expectRevert(E.NothingToClaim.selector);
            esc.claimRefund(honest[3 + e]);
        }

        noticeNow();
        vm.warp(esc.revealGraceEnd());
        vm.prank(owner);
        esc.withdraw();
        assertEq(usdc.balanceOf(owner), 1000 * ONE - 25 * ONE - 100 * ONE, "owner gets the rest");
    }

    function test_incident_second_incident_refused_while_one_open() public {
        submitB(alice, alice, evAtEpoch(EP, 3));
        E.EvidenceB memory other = evAtEpoch(EP + 1, 3);
        tryRevealB(bob, other, E.AnotherIncidentOpen.selector);
        tryRevealA(bob, pairA(EP + 7, 20, keccak256("z1"), keccak256("z2")), E.AnotherIncidentOpen.selector);
        assertEq(esc.incidentCount(), 1, "one incident");
        assertEq(esc.evidenceIncident(keyOf(other)), 0, "nothing recorded");
        assertEq(esc.pendingBounties(), 1, "no second bounty");

        // Past the window but unsettled: still one at a time.
        vm.warp(uint256(esc.incident(1).claimsCloseAt) + 1);
        tryRevealB(carol, other, E.AnotherIncidentOpen.selector);
        assertFalse(esc.frozen(), "freeze over");

        closeOut(1);
        submitB(carol, carol, other);
        assertEq(esc.incidentCount(), 2, "next epoch opens after settle");
        assertTrue(esc.frozen(), "second freeze inside the cap");
        assertEq(uint256(esc.frozenUsed()), 28 days, "cap used");
    }

    /// @dev After the cap, a later epoch opens without freezing; the owner
    ///      gives notice and withdraws while it is unsettled; its refund and
    ///      an earlier unclaimed bounty still pay after close.
    function test_incident_after_cap_withdraw_and_accepted_payouts() public {
        openEpoch(EP, 3, alice, address(0x9401), 5 * ONE);
        vm.warp(block.timestamp + 1 hours);
        closeOut(1);
        esc.claimRefund(honest[3]);
        openEpoch(EP + 1, 4, bob, address(0x9402), 5 * ONE);
        vm.warp(block.timestamp + 1 hours);
        closeOut(2);
        assertEq(uint256(esc.frozenUsed()), 28 days, "cap reached");
        assertEq(esc.credits(bob), 50 * ONE, "bounty credited, unclaimed");

        noticeNow();
        openEpoch(EP + 2, 5, carol, address(0x9403), 5 * ONE);
        assertFalse(esc.frozen(), "no freeze after the cap");
        assertEq(esc.incident(3).freezeUntil, 0, "freezeUntil 0");

        vm.warp(esc.revealGraceEnd());
        uint256 bondBefore = esc.bondAccounted();
        vm.prank(owner);
        esc.withdraw();
        assertEq(esc.bondAccounted(), 5 * ONE, "registered refund reserved");
        assertEq(usdc.balanceOf(owner), bondBefore - 5 * ONE, "owner gets the rest");

        // Closed: no new registrations or reveals; accepted payouts still pay.
        expectRegisterRevert(keyOf(evAtEpoch(EP + 2, 5)), forked[5], address(0x9404), 1 * ONE, E.NotActive.selector);
        esc.settle(3);
        esc.claimRefund(honest[5]);
        esc.claimRefund(honest[4]);
        vm.prank(bob);
        esc.claim();
        assertEq(usdc.balanceOf(address(0x9401)), 5 * ONE, "p1");
        assertEq(usdc.balanceOf(address(0x9402)), 5 * ONE, "p2 after cap");
        assertEq(usdc.balanceOf(address(0x9403)), 5 * ONE, "p3 after close");
        assertEq(usdc.balanceOf(bob), 50 * ONE, "bounty after cap");
        vm.prank(alice);
        esc.claim();
        vm.expectRevert(E.NothingToClaim.selector);
        esc.claimRefund(honest[5]);
        vm.prank(bob);
        vm.expectRevert(E.NothingToClaim.selector);
        esc.claim();
        assertEq(usdc.balanceOf(address(esc)), 0, "nothing stranded");
    }

    /// @dev Evidence never spans epochs: both heads of A and B must share one.
    function test_incident_cross_epoch_pairs_rejected() public {
        PairA memory p = pairA(EP, 20, keccak256("y1"), keccak256("y2"));
        p.h2.epoch = EP + 1;
        p.s2 = signHead(p.h2);
        tryRevealA(alice, p, E.NotEquivocation.selector);

        E.EvidenceB memory ev = evAt(3);
        ev.h2 = head(EP + 1, uint64(SIZE), TreeLib.root(forked));
        ev.s2 = signHead(ev.h2);
        tryRevealB(bob, ev, E.NotEquivocation.selector);
        assertEq(esc.incidentCount(), 0, "nothing opened");
    }
}
