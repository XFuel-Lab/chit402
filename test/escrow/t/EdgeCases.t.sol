// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {EscrowFixture} from "./utils/EscrowFixture.sol";
import {MockUSDC} from "./utils/MockUSDC.sol";
import {TreeLib} from "./utils/TreeLib.sol";
import {EquivocationEscrowV0 as E} from "escrow/EquivocationEscrowV0.sol";

/// @dev Cases beyond the C/CR/BC tables: funding with a fee token,
///      starving the precompile of gas, malformed type B shapes, a zero payee,
///      reveals after close, and a payout bound fuzz.
contract EdgeCasesTest is EscrowFixture {
    bytes32 constant R1 = keccak256("root-1");
    bytes32 constant R2 = keccak256("root-2");

    function test_edge_fee_on_transfer_funding_rejected() public {
        E e2 = deploy(address(usdc));
        usdc.setFeeBps(100);
        usdc.mint(owner, 1000 * ONE);
        vm.startPrank(owner);
        usdc.approve(address(e2), 1000 * ONE);
        vm.expectRevert(E.FundingMismatch.selector);
        e2.fund(1000 * ONE);
        vm.stopPrank();
        assertEq(e2.bondAccounted(), 0, "nothing accounted");
    }

    function test_edge_low_gas_reveal_reverts_without_state_change() public {
        PairA memory p = pairA(5, 20, R1, R2);
        bytes32 salt = keccak256("lowgas");
        bytes32 c = commitA(alice, alice, p, salt);
        passDelay();
        vm.prank(alice);
        (bool ok,) = address(esc).call{gas: 40_000}(abi.encodeCall(E.revealA, (p.h1, p.s1, p.h2, p.s2, alice, salt)));
        assertFalse(ok, "starved reveal fails");
        assertEq(esc.incidentCount(), 0, "no incident");
        (address committer,,) = esc.commits(c);
        assertEq(committer, alice, "commit kept");
        revealA(alice, alice, p, salt);
        assertEq(esc.incidentCount(), 1, "full-gas reveal works");
    }

    function test_edge_typeB_malformed_shapes() public {
        E.EvidenceB memory ev = forkB(7, 16, 3, 77);

        E.EvidenceB memory same = ev;
        same.l2 = same.l1;
        same.p2 = same.p1;
        _expectB(same, E.NotEquivocation.selector, "same leaf");

        E.EvidenceB memory beyond = forkB(7, 16, 3, 77);
        beyond.h2 = head(7, 3, beyond.h2.root);
        beyond.s2 = signHead(beyond.h2);
        _expectB(beyond, E.BadProof.selector, "index >= one size");

        E.EvidenceB memory crossed = forkB(7, 16, 3, 77);
        (crossed.p1, crossed.p2) = (crossed.p2, crossed.p1);
        _expectB(crossed, E.BadProof.selector, "proofs swapped between heads");

        E.EvidenceB memory longp = forkB(7, 16, 3, 77);
        longp.p1 = new bytes32[](65);
        _expectB(longp, E.BadProof.selector, "65-step proof");

        E.EvidenceB memory epochs = forkB(7, 16, 3, 77);
        epochs.h2.epoch = 8;
        epochs.s2 = signHead(epochs.h2);
        _expectB(epochs, E.NotEquivocation.selector, "different epochs");
    }

    function _expectB(E.EvidenceB memory ev, bytes4 err, string memory why) internal {
        bytes32 salt = keccak256(abi.encode(why));
        commitB(alice, alice, ev, salt);
        passDelay();
        vm.expectRevert(err);
        revealB(alice, alice, ev, salt);
        assertEq(esc.incidentCount(), 0, why);
    }

    function test_edge_zero_payto_rejected() public {
        PairA memory p = pairA(5, 20, R1, R2);
        bytes32 salt = keccak256("zero");
        commitA(alice, address(0), p, salt);
        passDelay();
        vm.expectRevert(E.ZeroPayTo.selector);
        revealA(alice, address(0), p, salt);
    }

    function test_edge_after_close_nothing_moves() public {
        vm.warp(esc.activatedAt() + 14 days);
        vm.prank(owner);
        esc.giveNotice();
        vm.warp(esc.revealGraceEnd());
        vm.prank(owner);
        esc.withdraw();
        vm.prank(alice);
        vm.expectRevert(E.NotActive.selector);
        esc.commit(keccak256("x"));
        PairA memory p = pairA(5, 20, R1, R2);
        vm.prank(alice);
        vm.expectRevert(E.NotActive.selector);
        esc.revealA(p.h1, p.s1, p.h2, p.s2, alice, keccak256("x"));
        vm.prank(owner);
        vm.expectRevert(E.NotActive.selector);
        esc.withdraw();
        vm.prank(owner);
        vm.expectRevert(E.NotActive.selector);
        esc.fund(1);
    }

    function test_edge_cancel_notice_does_not_unfreeze() public {
        vm.warp(esc.activatedAt() + 14 days);
        vm.prank(owner);
        esc.giveNotice();
        submitA(alice, alice, pairA(5, 20, R1, R2));
        vm.prank(owner);
        esc.cancelNotice();
        vm.prank(owner);
        esc.giveNotice();
        vm.warp(esc.revealGraceEnd());
        assertTrue(esc.frozen(), "still frozen");
        vm.prank(owner);
        vm.expectRevert(E.IncidentOpen.selector);
        esc.withdraw();
    }

    function test_edge_pre_activation_withdraw_closes() public {
        MockUSDC t = new MockUSDC();
        usdc = t;
        E e2 = deploy(address(t));
        t.mint(owner, 10 * ONE);
        vm.startPrank(owner);
        t.approve(address(e2), 10 * ONE);
        e2.fund(10 * ONE);
        e2.withdraw();
        vm.stopPrank();
        assertTrue(e2.closed(), "closed");
        assertEq(t.balanceOf(owner), 10 * ONE, "returned");
        vm.prank(owner);
        vm.expectRevert(E.AlreadyActive.selector);
        e2.activate();
    }

    function test_edge_new_evidence_after_window_opens_second_incident() public {
        submitA(alice, alice, pairA(5, 20, R1, R2));
        vm.warp(esc.incident(1).claimsCloseAt + 1);
        // No explicit settle: the next valid reveal settles incident 1 first.
        submitA(bob, bob, pairA(6, 20, R1, R2));
        assertTrue(esc.incident(1).settled, "incident 1 settled");
        assertEq(esc.incidentCount(), 2, "incident 2 opened");
        assertTrue(esc.frozen(), "frozen again");
    }

    /// @dev Bounties plus refunds never exceed the bond, for random refund sets.
    function testFuzz_payouts_never_exceed_bond(uint8 nKeys, uint64 amtSeed, bool bountyFirst) public {
        uint256 n = 1 + (uint256(nKeys) % 40);
        bytes32[] memory honest = TreeLib.leaves(64, amtSeed);
        bytes32[] memory forked = new bytes32[](64);
        for (uint256 i = 0; i < 64; i++) forked[i] = TreeLib.leaf(abi.encodePacked("fz", amtSeed, i));
        E.TreeHead memory h1 = head(40, 64, TreeLib.root(honest));
        E.TreeHead memory h2 = head(40, 64, TreeLib.root(forked));
        E.Sig memory s1 = signHead(h1);
        E.Sig memory s2 = signHead(h2);
        for (uint256 i = 0; i < n; i++) {
            E.EvidenceB memory ev = E.EvidenceB(h1, s1, h2, s2, uint64(i), honest[i], forked[i], TreeLib.proof(honest, i), TreeLib.proof(forked, i));
            address who = address(uint160(0x6000 + i));
            commitB(who, who, ev, bytes32(i));
        }
        passDelay();
        for (uint256 i = 0; i < n; i++) {
            E.EvidenceB memory ev = E.EvidenceB(h1, s1, h2, s2, uint64(i), honest[i], forked[i], TreeLib.proof(honest, i), TreeLib.proof(forked, i));
            address who = address(uint160(0x6000 + i));
            revealB(who, who, ev, bytes32(i));
        }
        if (bountyFirst) {
            vm.warp(block.timestamp + 1 hours);
            esc.finalizeBounty(40);
        }
        for (uint256 i = 0; i < n; i++) {
            (bytes32 lo, bytes32 hi) = honest[i] < forked[i] ? (honest[i], forked[i]) : (forked[i], honest[i]);
            bytes32 k = esc.keyB(40, uint64(i), lo, hi);
            uint64 amt = uint64(uint256(keccak256(abi.encode(amtSeed, i))) % (20 * ONE));
            address payer = address(uint160(0x8000 + i));
            bytes32 ps = keccak256(abi.encode(i));
            E.ReceiptBinding memory b = binding(honest[i], payer, ps, amt);
            esc.registerRefund(k, b, signBinding(b), payer, ps);
        }
        if (!bountyFirst) {
            vm.warp(block.timestamp + 1 hours);
            esc.finalizeBounty(40);
        }
        vm.warp(esc.incident(1).claimsCloseAt + 1);
        esc.settle();
        uint256 paid;
        for (uint256 i = 0; i < n; i++) {
            esc.claimRefund(honest[i]);
            paid += usdc.balanceOf(address(uint160(0x8000 + i)));
        }
        assertLe(paid + esc.bountiesPaid(), 1000 * ONE, "bounded by bond");
        assertLe(paid, esc.incident(1).requested, "bounded by requested");
        assertEq(paid + esc.bountiesPaid() + esc.bondAccounted() + _dust(n, paid), 1000 * ONE, "conservation");
    }

    function _dust(uint256, uint256 paid) internal view returns (uint256) {
        E.Incident memory inc = esc.incident(1);
        return inc.pool - paid;
    }
}
