// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {EscrowFixture} from "./utils/EscrowFixture.sol";
import {MockUSDC, Mock18} from "./utils/MockUSDC.sol";
import {TreeLib} from "./utils/TreeLib.sol";
import {EquivocationEscrowV0 as E} from "escrow/EquivocationEscrowV0.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/// @dev Brief tests C1-C9 and C12-C25 (C10/C11 are in Merkle.t.sol).
contract EscrowTest is EscrowFixture {
    bytes32 constant R1 = keccak256("root-1");
    bytes32 constant R2 = keccak256("root-2");
    bytes32 constant R3 = keccak256("root-3");

    // ---------------- C1 ----------------

    function test_C1_typeA_happy_path() public {
        PairA memory p = pairA(5, 20, R1, R2);
        bytes32 salt = keccak256("s");
        bytes32 c = commitA(alice, carol, p, salt);
        passDelay();
        assertFalse(esc.frozen(), "not frozen before reveal");
        revealA(alice, carol, p, salt);
        assertTrue(esc.frozen(), "frozen at reveal");
        assertEq(esc.incidentCount(), 1, "incident");
        (address committer,,) = esc.commits(c);
        assertEq(committer, address(0), "commit consumed");
        E.EpochBounty memory b = esc.bounty(5);
        assertEq(b.bestPayTo, carol, "pending payTo");
        assertEq(esc.pendingBounties(), 1, "pending");

        vm.expectRevert(E.ContestOpen.selector);
        esc.finalizeBounty(5);
        vm.warp(block.timestamp + esc.CONTEST_WINDOW());
        esc.finalizeBounty(5);
        assertEq(esc.credits(carol), 50 * ONE, "bounty credited to payTo");
        assertEq(esc.bondAccounted(), 950 * ONE, "bond reduced");
        vm.prank(carol);
        esc.claim();
        assertEq(usdc.balanceOf(carol), 50 * ONE, "bounty pulled");
    }

    // ---------------- C2-C4 ----------------

    function test_C2_same_root_different_published_at_is_not_evidence() public {
        PairA memory p = pairA(5, 20, R1, R1);
        p.h2.publishedAt = p.h1.publishedAt + 3600;
        p.s2 = signHead(p.h2);
        bytes32 salt = keccak256("s");
        commitA(alice, alice, p, salt);
        passDelay();
        vm.expectRevert(E.NotEquivocation.selector);
        revealA(alice, alice, p, salt);
    }

    function test_C3_different_epochs_rejected() public {
        PairA memory p = pairA(5, 20, R1, R2);
        p.h2.epoch = 6;
        p.s2 = signHead(p.h2);
        bytes32 salt = keccak256("s");
        commitA(alice, alice, p, salt);
        passDelay();
        vm.expectRevert(E.NotEquivocation.selector);
        revealA(alice, alice, p, salt);
    }

    function test_C4_different_sizes_typeA_rejected() public {
        PairA memory p = pairA(5, 20, R1, R2);
        p.h2.treeSize = 21;
        p.s2 = signHead(p.h2);
        bytes32 salt = keccak256("s");
        commitA(alice, alice, p, salt);
        passDelay();
        vm.expectRevert(E.NotEquivocation.selector);
        revealA(alice, alice, p, salt);
    }

    // ---------------- C5 ----------------

    function _expectRejectNoStateChange(PairA memory p, bytes4 err) internal {
        bytes32 salt = keccak256(abi.encode("c5", err, p.s1.s, p.s2.s, p.h1.kid));
        bytes32 c = commitA(alice, alice, p, salt);
        passDelay();
        vm.expectRevert(err);
        revealA(alice, alice, p, salt);
        assertEq(esc.incidentCount(), 0, "no incident");
        assertFalse(esc.frozen(), "not frozen");
        (address committer,,) = esc.commits(c);
        assertEq(committer, alice, "commit kept for resubmission");
    }

    function test_C5_bad_sig_other_key_wrong_kid() public {
        PairA memory p = pairA(5, 20, R1, R2);
        p.s2.s = bytes32(uint256(p.s2.s) ^ 1);
        _expectRejectNoStateChange(p, E.BadSignature.selector);

        p = pairA(5, 20, R1, R2);
        uint256 other = uint256(keccak256("other key")) % (N - 1) + 1;
        p.s1 = signWith(other, headDigest(p.h1, domainSep("Chit402TreeHead", "1", 84532, LOG_SALT)));
        _expectRejectNoStateChange(p, E.BadSignature.selector);

        p = pairA(5, 20, R1, R2);
        p.h1.kid = keccak256("other kid");
        p.s1 = signHead(p.h1);
        _expectRejectNoStateChange(p, E.UnknownKid.selector);
    }

    // ---------------- C6 / C7 ----------------

    function test_C6_high_s_accepted_and_deduped() public {
        PairA memory p = pairA(5, 20, R1, R2);
        p.s1 = highS(p.s1);
        assertGt(uint256(p.s1.s), N / 2, "is high-S");
        submitA(alice, alice, p);
        assertEq(esc.incidentCount(), 1, "high-S evidence accepted");

        PairA memory q = pairA(5, 20, R1, R2); // low-S twin of the same heads
        bytes32 salt = keccak256("twin");
        commitA(bob, bob, q, salt);
        passDelay();
        vm.expectRevert(E.DuplicateEvidence.selector);
        revealA(bob, bob, q, salt);
    }

    function test_C7_swapped_head_order_is_duplicate() public {
        PairA memory p = pairA(5, 20, R1, R2);
        submitA(alice, alice, p);
        PairA memory q = PairA({h1: p.h2, s1: p.s2, h2: p.h1, s2: p.s1});
        bytes32 salt = keccak256("swap");
        commitA(bob, bob, q, salt);
        passDelay();
        vm.expectRevert(E.DuplicateEvidence.selector);
        revealA(bob, bob, q, salt);
    }

    // ---------------- C8 / C9 ----------------

    function test_C8_quarantined_triple_excluded() public {
        PairA memory p = pairA(2, 11, qRoot, R2);
        bytes32 salt = keccak256("q");
        commitA(alice, alice, p, salt);
        passDelay();
        vm.expectRevert(E.Excluded.selector);
        revealA(alice, alice, p, salt);

        // A different published_at does not escape the list.
        p.h1.publishedAt = 1;
        p.s1 = signHead(p.h1);
        salt = keccak256("q2");
        commitA(alice, alice, p, salt);
        passDelay();
        vm.expectRevert(E.Excluded.selector);
        revealA(alice, alice, p, salt);
    }

    function test_C8_entry_above_high_water_reverts_at_pin() public {
        E e2 = deploy(address(usdc));
        E.HeadRef[] memory entries = new E.HeadRef[](1);
        entries[0] = E.HeadRef({epoch: 2, treeSize: 40, root: R1});
        E.HeadRef[] memory hw = new E.HeadRef[](1);
        hw[0] = E.HeadRef({epoch: 2, treeSize: 39, root: R2});
        vm.prank(owner);
        vm.expectRevert(E.AboveHighWater.selector);
        e2.pinQuarantineList(keccak256("l"), entries, hw);

        entries[0] = E.HeadRef({epoch: 3, treeSize: 1, root: R1}); // no high-water for epoch 3
        vm.prank(owner);
        vm.expectRevert(E.AboveHighWater.selector);
        e2.pinQuarantineList(keccak256("l"), entries, hw);

        E.HeadRef[] memory hw2 = new E.HeadRef[](2);
        hw2[0] = hw[0];
        hw2[1] = hw[0];
        entries[0] = E.HeadRef({epoch: 2, treeSize: 11, root: R1});
        vm.prank(owner);
        vm.expectRevert(E.DuplicateHighWater.selector);
        e2.pinQuarantineList(keccak256("l"), entries, hw2);
        assertFalse(e2.listPinned(), "nothing pinned");
    }

    function test_C9_activate_without_list_and_pin_after_activation() public {
        E e2 = deploy(address(usdc));
        usdc.mint(owner, 1000 * ONE);
        vm.startPrank(owner);
        usdc.approve(address(e2), 1000 * ONE);
        e2.fund(1000 * ONE);
        vm.expectRevert(E.ListNotPinned.selector);
        e2.activate();
        vm.stopPrank();

        E.HeadRef[] memory none = new E.HeadRef[](0);
        vm.prank(owner);
        vm.expectRevert(E.AlreadyActive.selector);
        esc.pinQuarantineList(keccak256("v2"), none, none);
    }

    function test_C9_bond_minimum_and_single_pin() public {
        E e2 = deploy(address(usdc));
        pinDefaultList(e2);
        E.HeadRef[] memory none = new E.HeadRef[](0);
        vm.prank(owner);
        vm.expectRevert(E.ListAlreadyPinned.selector);
        e2.pinQuarantineList(keccak256("v2"), none, none);
        usdc.mint(owner, 1000 * ONE);
        vm.startPrank(owner);
        usdc.approve(address(e2), 1000 * ONE);
        e2.fund(1000 * ONE - 1);
        vm.expectRevert(E.BondTooSmall.selector);
        e2.activate();
        e2.fund(1);
        e2.activate();
        vm.stopPrank();
        assertGt(e2.activatedAt(), 0, "active at exactly MIN_BOND");
    }

    // ---------------- C12 ----------------

    function test_C12_oct9_shape_is_typeB_evidence() public {
        string memory j = vm.readFile("vectors/merkle.json");
        E.EvidenceB memory ev;
        ev.h1 = head(9, 11, vm.parseJsonBytes32(j, ".oct9.bad_root"));
        ev.s1 = signHead(ev.h1);
        ev.h2 = head(9, 11, vm.parseJsonBytes32(j, ".oct9.good_root"));
        ev.s2 = signHead(ev.h2);
        ev.index = 10;
        ev.l1 = vm.parseJsonBytes32(j, ".oct9.bad_leaf");
        ev.l2 = vm.parseJsonBytes32(j, ".oct9.good_leaf");
        ev.p1 = vm.parseJsonBytes32Array(j, ".oct9.bad_proof");
        ev.p2 = vm.parseJsonBytes32Array(j, ".oct9.good_proof");
        bytes32 key = submitB(alice, alice, ev);
        assertEq(esc.evidenceIncident(key), 1, "Oct 9 shape pays out: R-1 in the gateway must refuse it");
    }

    // ---------------- C14 / C15 ----------------

    function test_C14_bounty_farming_one_bounty_per_epoch() public {
        E.EvidenceB memory ev = forkB(7, 32, 3, 1);
        submitB(alice, alice, ev);
        for (uint64 i = 4; i < 10; i++) {
            E.EvidenceB memory more = forkB(7, 32, 3, 1);
            more.index = i;
            more.l1 = TreeLib.leaves(32, 1)[i];
            more.l2 = TreeLib.leaf(abi.encodePacked("forked-", uint256(1), "-", uint256(i)));
            bytes32[] memory honest = TreeLib.leaves(32, 1);
            bytes32[] memory forked = TreeLib.leaves(32, 1);
            for (uint256 k = 3; k < 32; k++) forked[k] = TreeLib.leaf(abi.encodePacked("forked-", uint256(1), "-", k));
            more.p1 = TreeLib.proof(honest, i);
            more.p2 = TreeLib.proof(forked, i);
            submitB(bob, bob, more);
        }
        submitA(carol, carol, PairA({h1: ev.h1, s1: ev.s1, h2: ev.h2, s2: ev.s2}));
        vm.warp(block.timestamp + 1 hours);
        esc.finalizeBounty(7);
        assertEq(esc.bountiesPaid(), 50 * ONE, "one bounty for the epoch");
        assertEq(esc.credits(alice), 50 * ONE, "first finder");
        assertEq(esc.credits(bob) + esc.credits(carol), 0, "later keys pay nothing");

        submitA(bob, bob, pairA(8, 5, R1, R2));
        submitA(carol, carol, pairA(9, 5, R1, R2));
        vm.warp(block.timestamp + 1 hours);
        esc.finalizeBounty(8);
        esc.finalizeBounty(9);
        assertEq(esc.bountiesPaid(), 100 * ONE, "total cap");
        assertEq(esc.credits(carol), 0, "third epoch over cap");
    }

    /// @dev Oversubscribed refunds: 100 B keys (200 leaves) at 5 USDC each ask
    ///      for 1,000 against a 950 bond after one bounty. Pro rata, total paid
    ///      never exceeds the bond.
    function test_C15_cap_and_pro_rata() public {
        uint256 n = 128;
        bytes32[] memory honest = TreeLib.leaves(n, 9);
        bytes32[] memory forked = new bytes32[](n);
        for (uint256 i = 0; i < n; i++) forked[i] = TreeLib.leaf(abi.encodePacked("f9-", i));
        E.TreeHead memory h1 = head(11, uint64(n), TreeLib.root(honest));
        E.TreeHead memory h2 = head(11, uint64(n), TreeLib.root(forked));
        E.Sig memory s1 = signHead(h1);
        E.Sig memory s2 = signHead(h2);

        bytes32[] memory keys = new bytes32[](100);
        E.EvidenceB[] memory evs = new E.EvidenceB[](100);
        for (uint256 i = 0; i < 100; i++) {
            evs[i] = E.EvidenceB({
                h1: h1, s1: s1, h2: h2, s2: s2, index: uint64(i), l1: honest[i], l2: forked[i],
                p1: TreeLib.proof(honest, i), p2: TreeLib.proof(forked, i)
            });
            address who = address(uint160(0x5000 + i));
            commitB(who, who, evs[i], bytes32(i));
        }
        passDelay();
        for (uint256 i = 0; i < 100; i++) {
            address who = address(uint160(0x5000 + i));
            revealB(who, who, evs[i], bytes32(i));
            (bytes32 lo, bytes32 hi) = honest[i] < forked[i] ? (honest[i], forked[i]) : (forked[i], honest[i]);
            keys[i] = esc.keyB(11, uint64(i), lo, hi);
        }
        vm.warp(block.timestamp + 1 hours);
        esc.finalizeBounty(11);
        assertEq(esc.bondAccounted(), 950 * ONE, "bond after one bounty");

        for (uint256 i = 0; i < 100; i++) {
            _reg(keys[i], honest[i], address(uint160(0x9000 + 2 * i)), 9 * ONE); // capped at 5
            _reg(keys[i], forked[i], address(uint160(0x9001 + 2 * i)), 5 * ONE);
        }
        E.Incident memory inc = esc.incident(1);
        assertEq(inc.requested, 1000 * ONE, "requested");
        vm.warp(inc.claimsCloseAt + 1);
        esc.settle(1);
        inc = esc.incident(1);
        assertEq(inc.pool, 950 * ONE, "pool = remaining bond");
        uint256 paid;
        for (uint256 i = 0; i < 100; i++) {
            esc.claimRefund(honest[i]);
            esc.claimRefund(forked[i]);
        }
        for (uint256 i = 0; i < 200; i++) paid += usdc.balanceOf(address(uint160(0x9000 + i)));
        assertEq(usdc.balanceOf(address(uint160(0x9000))), 4_750_000, "pro rata 5 * 950/1000");
        assertLe(paid + esc.bountiesPaid(), 1000 * ONE, "bounty + refunds <= bond");
        assertEq(paid, 950 * ONE, "all of the pool paid");
    }

    function test_C15_refunds_have_priority_over_later_bounty() public {
        // With room in the bond, the bounty is paid next to a registered refund.
        E.EvidenceB memory ev = forkB(12, 16, 0, 3);
        bytes32 key = submitB(alice, alice, ev);
        _reg(key, ev.l1, bob, 5 * ONE);
        vm.warp(block.timestamp + 1 hours);
        esc.finalizeBounty(12);
        assertEq(esc.credits(alice), 50 * ONE, "bounty paid when the reserve allows");

        // Fresh escrow funded at exactly MIN_BOND, with 1,000 USDC of refunds registered first.
        E e2 = _activeEscrow();
        E.EvidenceB memory ev2 = forkB(13, 256, 0, 4);
        bytes32[] memory honest = TreeLib.leaves(256, 4);
        bytes32[] memory forked = new bytes32[](256);
        for (uint256 i = 0; i < 256; i++) forked[i] = TreeLib.leaf(abi.encodePacked("forked-", uint256(4), "-", i));
        E prev = esc;
        esc = e2;
        bytes32[] memory keys = new bytes32[](100);
        for (uint256 i = 0; i < 100; i++) {
            ev2.index = uint64(i);
            ev2.l1 = honest[i];
            ev2.l2 = forked[i];
            ev2.p1 = TreeLib.proof(honest, i);
            ev2.p2 = TreeLib.proof(forked, i);
            address who = address(uint160(0x7000 + i));
            commitB(who, who, ev2, bytes32(i));
        }
        passDelay();
        for (uint256 i = 0; i < 100; i++) {
            ev2.index = uint64(i);
            ev2.l1 = honest[i];
            ev2.l2 = forked[i];
            ev2.p1 = TreeLib.proof(honest, i);
            ev2.p2 = TreeLib.proof(forked, i);
            address who = address(uint160(0x7000 + i));
            revealB(who, who, ev2, bytes32(i));
            (bytes32 lo, bytes32 hi) = honest[i] < forked[i] ? (honest[i], forked[i]) : (forked[i], honest[i]);
            keys[i] = esc.keyB(13, uint64(i), lo, hi);
        }
        for (uint256 i = 0; i < 100; i++) {
            _reg(keys[i], honest[i], address(uint160(0xB000 + 2 * i)), 5 * ONE);
            _reg(keys[i], forked[i], address(uint160(0xB001 + 2 * i)), 5 * ONE);
        }
        vm.warp(block.timestamp + 1 hours);
        esc.finalizeBounty(13);
        assertEq(esc.credits(address(0x7000)), 0, "bounty yields to registered refunds");
        assertEq(esc.bounty(13).paid, 0, "recorded as zero");
        assertEq(esc.bondAccounted(), 1000 * ONE, "bond kept for refunds");
        esc = prev;
    }

    function _activeEscrow() internal returns (E e2) {
        e2 = deploy(address(usdc));
        pinDefaultList(e2);
        fundAndActivate(e2, 1000 * ONE);
    }

    function _reg(bytes32 key, bytes32 leafHash, address payer, uint64 amount) internal {
        bytes32 ps = keccak256(abi.encode("salt", payer));
        E.ReceiptBinding memory b = binding(leafHash, payer, ps, amount);
        esc.registerRefund(key, b, signBinding(b), payer, ps);
    }

    // ---------------- C16 ----------------

    function test_C16_notice_and_withdraw_exact_seconds() public {
        uint256 act = esc.activatedAt();
        vm.warp(act + 14 days - 1);
        vm.prank(owner);
        vm.expectRevert(E.TooEarly.selector);
        esc.giveNotice();
        vm.warp(act + 14 days);
        vm.prank(owner);
        esc.giveNotice();
        uint256 grace = esc.revealGraceEnd();
        assertEq(grace, act + 28 days + 5 minutes + 24 hours, "grace end");
        assertEq(esc.withdrawableAt(), act + 28 days, "withdrawableAt");
        vm.warp(grace - 1);
        vm.prank(owner);
        vm.expectRevert(E.TooEarly.selector);
        esc.withdraw();
        vm.warp(grace);
        vm.prank(owner);
        esc.withdraw();
        assertEq(usdc.balanceOf(owner), 1000 * ONE, "bond returned");
        assertTrue(esc.closed(), "closed");
    }

    function test_C16_open_incident_blocks_withdraw_and_claim_window_edges() public {
        vm.warp(esc.activatedAt() + 14 days);
        vm.prank(owner);
        esc.giveNotice();
        // A monitor commits one second before withdrawableAt and reveals at the
        // last allowed second, so the claim window outlasts the reveal grace.
        vm.warp(esc.withdrawableAt() - 1);
        E.EvidenceB memory ev = forkB(7, 8, 2, 5);
        bytes32 salt = keccak256("late");
        commitB(alice, alice, ev, salt);
        vm.warp(block.timestamp + esc.MIN_DELAY() + esc.REVEAL_WINDOW());
        revealB(alice, alice, ev, salt);
        (bytes32 lo, bytes32 hi) = ev.l1 < ev.l2 ? (ev.l1, ev.l2) : (ev.l2, ev.l1);
        bytes32 key = esc.keyB(7, ev.index, lo, hi);
        assertEq(block.timestamp, esc.revealGraceEnd() - 1, "revealed at the last second of the grace");

        vm.warp(esc.revealGraceEnd());
        vm.prank(owner);
        vm.expectRevert(E.IncidentOpen.selector);
        esc.withdraw();

        E.Incident memory inc = esc.incident(1);
        vm.warp(inc.claimsCloseAt);
        vm.expectRevert(E.ClaimsOpen.selector);
        esc.settle(1);
        _reg(key, ev.l1, bob, 1 * ONE); // exactly at claimsCloseAt is still open
        vm.warp(inc.claimsCloseAt + 1);
        bytes32 ps = keccak256(abi.encode("salt", carol));
        E.ReceiptBinding memory b = binding(ev.l2, carol, ps, 1 * ONE);
        E.Sig memory bs = signBinding(b);
        vm.expectRevert(E.ClaimsClosed.selector);
        esc.registerRefund(key, b, bs, carol, ps);
        esc.settle(1);
        vm.prank(owner);
        vm.expectRevert(E.BountyPending.selector);
        esc.withdraw();
        esc.finalizeBounty(7);
        vm.prank(owner);
        esc.withdraw();
        esc.claimRefund(ev.l1);
        assertEq(usdc.balanceOf(bob), 1 * ONE, "refund paid after withdraw");
        vm.prank(alice);
        esc.claim();
        assertEq(usdc.balanceOf(alice), 50 * ONE, "bounty paid after withdraw");
        assertEq(usdc.balanceOf(owner), 949 * ONE, "owner gets the rest");
    }

    // ---------------- C17 ----------------

    function test_C17_reentrancy_through_token_hook() public {
        E.EvidenceB memory ev = forkB(7, 8, 2, 6);
        bytes32 key = submitB(alice, alice, ev);
        _reg(key, ev.l1, bob, 1 * ONE);
        vm.warp(block.timestamp + 1 hours);
        esc.finalizeBounty(7);
        vm.warp(esc.incident(1).claimsCloseAt + 1);
        esc.settle(1);

        usdc.setHook(address(esc), abi.encodeCall(E.claim, ()));
        vm.prank(alice);
        vm.expectRevert(ReentrancyGuard.ReentrancyGuardReentrantCall.selector);
        esc.claim();

        usdc.setHook(address(esc), abi.encodeCall(E.settle, (uint256(1))));
        vm.expectRevert(ReentrancyGuard.ReentrancyGuardReentrantCall.selector);
        esc.claimRefund(ev.l1);

        usdc.setHook(address(esc), abi.encodeCall(E.claimRefund, (ev.l1)));
        vm.expectRevert(ReentrancyGuard.ReentrancyGuardReentrantCall.selector);
        esc.claimRefund(ev.l1);

        vm.warp(esc.activatedAt() + 14 days > block.timestamp ? esc.activatedAt() + 14 days : block.timestamp);
        vm.prank(owner);
        esc.giveNotice();
        vm.warp(esc.revealGraceEnd());
        // withdraw is owner-only, so the hook re-enters through claim().
        usdc.setHook(address(esc), abi.encodeCall(E.claim, ()));
        vm.prank(owner);
        vm.expectRevert(ReentrancyGuard.ReentrancyGuardReentrantCall.selector);
        esc.withdraw();
        assertFalse(esc.closed(), "withdraw rolled back");

        usdc.setHook(address(0), "");
        vm.prank(alice);
        esc.claim();
        assertEq(usdc.balanceOf(alice), 50 * ONE, "claim works without the hook");
    }

    // ---------------- C18 / C19 ----------------

    function test_C18_no_precompile_reverts_and_is_resubmittable() public {
        PairA memory p = pairA(5, 20, R1, R2);
        bytes32 salt = keccak256("c18");
        bytes32 c = commitA(alice, alice, p, salt);
        passDelay();
        vm.mockCall(address(0x100), bytes(""), bytes(""));
        vm.expectRevert(E.BadSignature.selector);
        revealA(alice, alice, p, salt);
        assertEq(esc.incidentCount(), 0, "no state change");
        (address committer,,) = esc.commits(c);
        assertEq(committer, alice, "commit kept");

        E.TreeHead memory h = liveHead();
        E.Sig memory s = signHead(h);
        vm.expectRevert(E.LivenessFailed.selector);
        new E(owner, address(usdc), kid, pubX, pubY, LOG_SALT, h, s);

        vm.clearMockedCalls();
        revealA(alice, alice, p, salt);
        assertEq(esc.incidentCount(), 1, "resubmitted after the precompile is back");
    }

    function test_C19_wrong_length_or_word_rejected() public {
        PairA memory p = pairA(5, 20, R1, R2);
        bytes32 salt = keccak256("c19");
        commitA(alice, alice, p, salt);
        passDelay();

        vm.mockCall(address(0x100), bytes(""), abi.encode(uint256(1), uint256(1)));
        vm.expectRevert(E.BadSignature.selector);
        revealA(alice, alice, p, salt);

        vm.mockCall(address(0x100), bytes(""), abi.encode(uint256(2)));
        vm.expectRevert(E.BadSignature.selector);
        revealA(alice, alice, p, salt);

        vm.mockCall(address(0x100), bytes(""), hex"01");
        vm.expectRevert(E.BadSignature.selector);
        revealA(alice, alice, p, salt);

        vm.mockCallRevert(address(0x100), bytes(""), abi.encode(uint256(1)));
        vm.expectRevert(E.BadSignature.selector);
        revealA(alice, alice, p, salt);

        vm.clearMockedCalls();
        revealA(alice, alice, p, salt);
        assertEq(esc.incidentCount(), 1, "real precompile accepts");
    }

    // ---------------- C20 ----------------

    function test_C20_constructor_checks() public {
        E.TreeHead memory h = liveHead();
        E.Sig memory s = signHead(h);

        vm.expectRevert(E.KidMismatch.selector);
        new E(owner, address(usdc), kid, pubY, pubX, LOG_SALT, h, s);

        vm.expectRevert(E.KidMismatch.selector);
        new E(owner, address(usdc), keccak256("x"), pubX, pubY, LOG_SALT, h, s);

        E.TreeHead memory other = h;
        other.root = keccak256("not signed");
        vm.expectRevert(E.LivenessFailed.selector);
        new E(owner, address(usdc), kid, pubX, pubY, LOG_SALT, other, s);

        other = h;
        other.kid = keccak256("other kid");
        E.Sig memory os = signHead(other);
        vm.expectRevert(E.LivenessFailed.selector);
        new E(owner, address(usdc), kid, pubX, pubY, LOG_SALT, other, os);

        vm.expectRevert(E.LivenessFailed.selector);
        new E(owner, address(usdc), kid, pubX, pubY, keccak256("other salt"), h, s);

        vm.expectRevert(E.ZeroAddress.selector);
        new E(address(0), address(usdc), kid, pubX, pubY, LOG_SALT, h, s);

        vm.expectRevert(E.NoTokenCode.selector);
        new E(owner, address(0xDEAD), kid, pubX, pubY, LOG_SALT, h, s);

        Mock18 t18 = new Mock18();
        vm.expectRevert(E.WrongDecimals.selector);
        new E(owner, address(t18), kid, pubX, pubY, LOG_SALT, h, s);

        vm.chainId(8453);
        vm.expectRevert(E.WrongChain.selector);
        new E(owner, address(usdc), kid, pubX, pubY, LOG_SALT, h, s);
    }

    // ---------------- C21 / C22 ----------------

    function test_C21_donation_does_not_change_accounting() public {
        usdc.mint(address(esc), 777 * ONE);
        assertEq(esc.bondAccounted(), 1000 * ONE, "accounting ignores donations");
        vm.warp(esc.activatedAt() + 14 days);
        vm.prank(owner);
        esc.giveNotice();
        vm.warp(esc.revealGraceEnd());
        vm.prank(owner);
        esc.withdraw();
        assertEq(usdc.balanceOf(owner), 1000 * ONE, "only the accounted bond moves");
    }

    function test_C22_eth_rejected() public {
        vm.deal(address(this), 1 ether);
        (bool ok,) = address(esc).call{value: 1}("");
        assertFalse(ok, "plain ETH transfer");
        (ok,) = address(esc).call{value: 1}(abi.encodeCall(E.commit, (bytes32(uint256(1)))));
        assertFalse(ok, "ETH with a call");
        (ok,) = address(esc).call{value: 1}(hex"deadbeef");
        assertFalse(ok, "ETH to unknown selector");
        assertEq(address(esc).balance, 0, "no ETH held");
    }

    // ---------------- C23 ----------------

    function test_C23_wrong_domain_rejected() public {
        bytes32[4] memory doms = [
            domainSep("Chit402TreeHead", "1", 8453, LOG_SALT),
            domainSep("Chit402TreeHead", "1", 84532, keccak256("another log")),
            domainSep("Chit402ReceiptBinding", "1", 84532, LOG_SALT),
            domainSep("Chit402TreeHead", "2", 84532, LOG_SALT)
        ];
        for (uint256 i = 0; i < doms.length; i++) {
            PairA memory p = pairA(5, 20, R1, R2);
            p.s2 = signWith(pk, headDigest(p.h2, doms[i]));
            _expectRejectNoStateChange(p, E.BadSignature.selector);
        }
    }

    // ---------------- C24 ----------------

    function test_C24_no_dodge_selectors() public {
        bytes[] memory calls = new bytes[](14);
        calls[0] = abi.encodeWithSignature("pause()");
        calls[1] = abi.encodeWithSignature("unpause()");
        calls[2] = abi.encodeWithSignature("removeKey(bytes32)", kid);
        calls[3] = abi.encodeWithSignature("setKey(bytes32,bytes32,bytes32)", kid, pubX, pubY);
        calls[4] = abi.encodeWithSignature("upgradeTo(address)", address(1));
        calls[5] = abi.encodeWithSignature("upgradeToAndCall(address,bytes)", address(1), "");
        calls[6] = abi.encodeWithSignature("transferOwnership(address)", address(1));
        calls[7] = abi.encodeWithSignature("renounceOwnership()");
        calls[8] = abi.encodeWithSignature("setQuarantineList(bytes32)", bytes32(0));
        calls[9] = abi.encodeWithSignature("unpinQuarantineList()");
        calls[10] = abi.encodeWithSignature("emergencyWithdraw()");
        calls[11] = abi.encodeWithSignature("sweep(address)", address(usdc));
        calls[12] = abi.encodeWithSignature("setToken(address)", address(1));
        calls[13] = abi.encodeWithSignature("removeQuarantineEntry(bytes32)", bytes32(0));
        for (uint256 i = 0; i < calls.length; i++) {
            vm.prank(owner);
            (bool ok,) = address(esc).call(calls[i]);
            assertFalse(ok, "selector must not exist");
        }
        E.HeadRef[] memory none = new E.HeadRef[](0);
        vm.prank(owner);
        vm.expectRevert(E.AlreadyActive.selector);
        esc.pinQuarantineList(keccak256("x"), none, none);
    }

    function test_owner_only_functions() public {
        vm.startPrank(alice);
        vm.expectRevert(E.NotOwner.selector);
        esc.fund(1);
        vm.expectRevert(E.NotOwner.selector);
        esc.activate();
        vm.expectRevert(E.NotOwner.selector);
        esc.giveNotice();
        vm.expectRevert(E.NotOwner.selector);
        esc.cancelNotice();
        vm.expectRevert(E.NotOwner.selector);
        esc.withdraw();
        E.HeadRef[] memory none = new E.HeadRef[](0);
        vm.expectRevert(E.NotOwner.selector);
        esc.pinQuarantineList(keccak256("x"), none, none);
        vm.stopPrank();
    }

    // ---------------- C25 ----------------

    function test_C25_gas_report() public {
        PairA memory p = pairA(5, 20, R1, R2);
        bytes32 salt = keccak256("gas");
        bytes32 c = esc.commitHash(alice, alice, 1, esc.evidenceHashA(p.h1, p.s1, p.h2, p.s2), salt);
        vm.prank(alice);
        uint256 g = gasleft();
        esc.commit(c);
        emit log_named_uint("gas commit", g - gasleft());
        passDelay();
        vm.prank(alice);
        g = gasleft();
        esc.revealA(p.h1, p.s1, p.h2, p.s2, alice, salt);
        emit log_named_uint("gas revealA (first, opens incident)", g - gasleft());

        E.EvidenceB memory ev = forkB(5, 39, 20, 7);
        salt = keccak256("gasB");
        commitB(bob, bob, ev, salt);
        passDelay();
        vm.prank(bob);
        g = gasleft();
        esc.revealB(ev, bob, salt);
        emit log_named_uint("gas revealB (size 39, joins incident)", g - gasleft());

        (bytes32 lo, bytes32 hi) = ev.l1 < ev.l2 ? (ev.l1, ev.l2) : (ev.l2, ev.l1);
        bytes32 key = esc.keyB(5, ev.index, lo, hi);
        bytes32 ps = keccak256("ps");
        E.ReceiptBinding memory b = binding(ev.l1, carol, ps, 2 * ONE);
        E.Sig memory bs = signBinding(b);
        g = gasleft();
        esc.registerRefund(key, b, bs, carol, ps);
        emit log_named_uint("gas registerRefund", g - gasleft());

        vm.warp(block.timestamp + 1 hours);
        g = gasleft();
        esc.finalizeBounty(5);
        emit log_named_uint("gas finalizeBounty", g - gasleft());
        vm.prank(alice);
        g = gasleft();
        esc.claim();
        emit log_named_uint("gas claim (bounty)", g - gasleft());
        vm.warp(esc.incident(1).claimsCloseAt + 1);
        g = gasleft();
        esc.settle(1);
        emit log_named_uint("gas settle", g - gasleft());
        g = gasleft();
        esc.claimRefund(ev.l1);
        emit log_named_uint("gas claimRefund", g - gasleft());
    }
}
