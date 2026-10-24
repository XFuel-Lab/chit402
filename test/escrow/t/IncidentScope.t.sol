// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {EscrowFixture} from "./utils/EscrowFixture.sol";
import {TreeLib} from "./utils/TreeLib.sol";
import {EquivocationEscrowV0 as E} from "escrow/EquivocationEscrowV0.sol";

/// @dev One fork is one incident, keyed by (epoch, kid). A settled or expired
///      epoch never re-opens or freezes withdrawal again, and later keys from
///      it pay nothing. A conflict in another epoch needs new signed heads and
///      opens its own incident.
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

    // ---------------- a different epoch ----------------

    /// @dev Epoch 10 heads are new issuer signatures: a new equivocation, so it
    ///      may open and freeze its own incident. A leaf already refunded in
    ///      epoch 9 still cannot be paid again.
    function test_incident_new_epoch_fork_opens_own_incident() public {
        (, address payer) = openAndSettleEpoch9();
        uint256 bondAfter = esc.bondAccounted();

        // Epoch 10 fork whose honest tree reuses honest[3] at index 3.
        E.TreeHead memory g1 = head(EP + 1, uint64(SIZE), TreeLib.root(honest));
        E.TreeHead memory g2 = head(EP + 1, uint64(SIZE), TreeLib.root(forked));
        E.EvidenceB memory ev =
            E.EvidenceB(g1, signHead(g1), g2, signHead(g2), 3, honest[3], forked[3], TreeLib.proof(honest, 3), TreeLib.proof(forked, 3));
        bytes32 k = submitB(bob, bob, ev);
        assertEq(esc.incidentCount(), 2, "incident 2");
        assertEq(esc.incidentOf(esc.incidentKey(EP + 1)), 2, "epoch 10 -> incident 2");
        assertEq(esc.incident(2).epoch, EP + 1, "epoch stored");
        assertTrue(esc.frozen(), "new equivocation freezes");

        expectRegisterRevert(k, honest[3], payer, 5 * ONE, E.AlreadyClaimed.selector);
        register(k, forked[3], address(0x9002), 4 * ONE);

        noticeNow();
        vm.warp(esc.revealGraceEnd());
        vm.prank(owner);
        vm.expectRevert(E.IncidentOpen.selector);
        esc.withdraw();

        uint256 close2 = uint256(esc.incident(2).claimsCloseAt) + 1;
        if (block.timestamp < close2) vm.warp(close2);
        esc.finalizeBounty(EP + 1);
        esc.settle(2);
        esc.claimRefund(forked[3]);
        assertEq(usdc.balanceOf(address(0x9002)), 4 * ONE, "paid from the remaining bond");
        assertEq(usdc.balanceOf(payer), 5 * ONE, "epoch 9 payer still paid once");
        vm.prank(owner);
        esc.withdraw();
        assertEq(usdc.balanceOf(owner), bondAfter - 4 * ONE - 50 * ONE, "rest returned after second bounty and refund");
    }

    function test_incident_concurrent_epochs_withdraw_waits_for_both() public {
        submitB(alice, alice, evAt(3));
        submitA(bob, bob, pairA(EP + 1, 20, keccak256("x1"), keccak256("x2")));
        assertEq(esc.openIncidents(), 2, "two open");
        bytes32 k3 = keyOf(evAt(3));
        register(k3, honest[3], address(0x9003), 5 * ONE);
        assertEq(esc.openRequested(), 5 * ONE, "reserve tracked");

        noticeNow();
        vm.warp(esc.revealGraceEnd());
        esc.finalizeBounty(EP);
        esc.finalizeBounty(EP + 1);
        esc.settle(1);
        assertTrue(esc.frozen(), "incident 2 still open");
        vm.prank(owner);
        vm.expectRevert(E.IncidentOpen.selector);
        esc.withdraw();
        esc.settle(2);
        assertFalse(esc.frozen(), "both settled");
        assertEq(esc.openRequested(), 0, "reserve cleared");

        vm.expectRevert(E.NothingToSettle.selector);
        esc.settle(0);
        vm.expectRevert(E.NothingToSettle.selector);
        esc.settle(3);
        vm.expectRevert(E.NothingToSettle.selector);
        esc.settle(2);

        vm.prank(owner);
        esc.withdraw();
        assertTrue(esc.closed(), "closed");
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
