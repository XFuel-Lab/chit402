// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {EscrowFixture} from "./utils/EscrowFixture.sol";
import {EquivocationEscrowV0 as E} from "escrow/EquivocationEscrowV0.sol";

/// @dev V0 (option b1): neither signing domain names the escrow. Tree heads AND refund
///      bindings are per log by design: the same signed head and the same refund binding
///      are valid at any escrow that pins this log's key and salt. One canonical escrow at
///      a time; a redeploy must quarantine the old escrow's incident heads (I9) so no
///      refund is paid twice. Protocol Review report escrow-659-option-b.md, I6 to I12.
contract CrossEscrowTest is EscrowFixture {
    bytes32 internal constant R1 = keccak256("root one");
    bytes32 internal constant R2 = keccak256("root two");
    address internal p1 = address(0x1001);
    bytes32 internal ps1 = keccak256("payer salt 1");
    address internal owner2 = address(0x0B2);

    E internal escA;
    E internal escB;

    function setUp() public override {
        super.setUp();
        escA = esc;
        escB = deploy(address(usdc));
        pinDefaultList(escB);
        fundAndActivate(escB, 1000 * ONE);
        assertTrue(address(escA) != address(escB), "two escrows");
        assertEq(escA.TREEHEAD_DOMAIN_SEPARATOR(), escB.TREEHEAD_DOMAIN_SEPARATOR(), "head domain is per log");
        assertEq(escA.BINDING_DOMAIN_SEPARATOR(), escB.BINDING_DOMAIN_SEPARATOR(), "binding domain is per log (V0)");
    }

    function _use(E e) internal {
        esc = e;
    }

    /// @dev Same equivocation accepted at A and B: intended, an equivocation by the log key is
    ///      provable at any escrow of this log. Each escrow pays only from its own bond.
    function test_X1_same_equivocation_accepted_at_A_and_B_per_log_by_design() public {
        PairA memory p = pairA(5, 20, R1, R2);
        _use(escA);
        submitA(alice, carol, p);
        _use(escB);
        submitA(alice, carol, p);
        assertEq(escA.incidentCount(), 1, "A incident");
        assertEq(escB.incidentCount(), 1, "B incident");
    }

    /// @dev The same refund binding is valid at A and at B (per log by design for V0). This
    ///      is why a redeploy must quarantine the old incidents (test_X5).
    function test_X2_same_refund_binding_valid_at_A_and_B_per_log_by_design() public {
        E.EvidenceB memory ev = forkB(7, 16, 3, 42);
        _use(escA);
        bytes32 key = submitB(alice, alice, ev);
        _use(escB);
        assertEq(submitB(alice, alice, ev), key, "same evidence key");
        E.ReceiptBinding memory b = binding(ev.l1, p1, ps1, 2 * ONE);
        E.Sig memory s = signBinding(b);
        escA.registerRefund(key, b, s, p1, ps1);
        escB.registerRefund(key, b, s, p1, ps1);
        assertEq(escA.refundOf(ev.l1).payer, p1, "A");
        assertEq(escB.refundOf(ev.l1).payer, p1, "B");
        vm.expectRevert(E.AlreadyClaimed.selector);
        escA.registerRefund(key, b, s, p1, ps1);
    }

    /// @dev I6: the refund goes to the payer opened from the signed commitment whoever submits
    ///      and whoever claims.
    function test_X3_refund_paid_to_opened_payer_whatever_sender() public {
        E.EvidenceB memory ev = forkB(7, 16, 3, 42);
        _use(escA);
        bytes32 key = submitB(alice, alice, ev);
        E.ReceiptBinding memory b = binding(ev.l1, p1, ps1, 2 * ONE);
        vm.prank(carol);
        escA.registerRefund(key, b, signBinding(b), p1, ps1);
        vm.warp(escA.incident(1).claimsCloseAt + 1);
        escA.settle(1);
        uint256 cb = usdc.balanceOf(carol);
        vm.prank(carol);
        escA.claimRefund(ev.l1);
        assertEq(usdc.balanceOf(p1), 2 * ONE, "paid to the payer");
        assertEq(usdc.balanceOf(carol), cb, "not to the caller");
    }

    /// @dev I7: calls on B never change A's state or balance (shared OWNER, KID, LOG_SALT).
    function test_X4_isolation_B_does_not_touch_A() public {
        uint256 aBal = usdc.balanceOf(address(escA));
        uint256 aBond = escA.bondAccounted();
        _use(escB);
        E.EvidenceB memory ev = forkB(7, 16, 3, 42);
        bytes32 key = submitB(alice, alice, ev);
        E.ReceiptBinding memory b = binding(ev.l1, p1, ps1, 2 * ONE);
        escB.registerRefund(key, b, signBinding(b), p1, ps1);
        vm.warp(escB.incident(1).claimsCloseAt + 1);
        escB.settle(1);
        escB.claimRefund(ev.l1);
        assertEq(usdc.balanceOf(address(escA)), aBal, "A balance");
        assertEq(escA.bondAccounted(), aBond, "A bond");
        assertEq(escA.incidentCount(), 0, "A incidents");
        assertFalse(escA.frozen(), "A not frozen");
        assertEq(escA.refundOf(ev.l1).payer, address(0), "A no refund");
    }

    /// @dev I9 / redeploy rule: a new escrow A2 whose quarantine list covers the old escrow's
    ///      incident head refuses that evidence (Excluded) and so those refunds (NotAffected).
    function test_X5_redeploy_quarantine_excludes_old_incident_and_its_refunds() public {
        E.EvidenceB memory ev = forkB(7, 16, 3, 42);
        _use(escA);
        bytes32 key = submitB(alice, alice, ev);
        E.ReceiptBinding memory b = binding(ev.l1, p1, ps1, 2 * ONE);
        E.Sig memory s = signBinding(b);
        escA.registerRefund(key, b, s, p1, ps1);

        E a2 = deploy(address(usdc));
        E.HeadRef[] memory entries = new E.HeadRef[](2);
        entries[0] = E.HeadRef({epoch: 2, treeSize: 11, root: qRoot});
        entries[1] = E.HeadRef({epoch: ev.h2.epoch, treeSize: ev.h2.treeSize, root: ev.h2.root}); // the old incident's forked head
        E.HeadRef[] memory hw = new E.HeadRef[](2);
        hw[0] = E.HeadRef({epoch: 2, treeSize: 39, root: keccak256("live")});
        hw[1] = E.HeadRef({epoch: ev.h1.epoch, treeSize: ev.h1.treeSize, root: ev.h1.root});
        vm.prank(owner);
        a2.pinQuarantineList(keccak256("list-v2-after-redeploy"), entries, hw);
        fundAndActivate(a2, 1000 * ONE);

        _use(a2);
        bytes32 salt = keccak256("replay at a2");
        commitB(alice, alice, ev, salt);
        passDelay();
        vm.expectRevert(E.Excluded.selector);
        revealB(alice, alice, ev, salt);
        vm.expectRevert(E.NotAffected.selector);
        a2.registerRefund(key, b, s, p1, ps1);
        assertEq(a2.incidentCount(), 0, "no incident at the new escrow");
        assertEq(a2.openRequested(), 0, "no refund requested at the new escrow");
    }

    /// @dev I8: a third party deploys an escrow naming our key and log with its own OWNER and a
    ///      public head as liveness. Its payouts never touch A.
    function test_X6_third_party_escrow_never_touches_A() public {
        E.TreeHead memory h = liveHead();
        E t = new E(owner2, address(usdc), kid, pubX, pubY, LOG_SALT, h, signHead(h), 1000 * ONE);
        assertEq(t.OWNER(), owner2, "their owner");
        usdc.mint(owner2, 1000 * ONE);
        vm.startPrank(owner2);
        usdc.approve(address(t), 1000 * ONE);
        t.fund(1000 * ONE);
        vm.stopPrank();
        uint256 aBal = usdc.balanceOf(address(escA));
        vm.prank(owner);
        vm.expectRevert(E.NotOwner.selector);
        t.activate();
        _use(t);
        assertEq(usdc.balanceOf(address(escA)), aBal, "A untouched");
        assertEq(escA.bondAccounted(), 1000 * ONE, "A bond untouched");
    }

    /// @dev I11: a commit made at A cannot be revealed at B.
    function test_X7_commit_at_A_not_revealable_at_B() public {
        PairA memory p = pairA(5, 20, R1, R2);
        _use(escA);
        bytes32 salt = keccak256("x7");
        commitA(alice, alice, p, salt);
        passDelay();
        vm.prank(alice);
        vm.expectRevert(E.NoCommit.selector);
        escB.revealA(p.h1, p.s1, p.h2, p.s2, alice, salt);
    }

    /// @dev I10: the constructor reverts on every chain but 84532 for every minBond: below
    ///      1,000 USDC the bond rule fires first (BondTooSmall), else WrongChain.
    function testFuzz_X8_ctor_reverts_off_84532(uint256 chain, uint256 mb) public {
        chain = 1 + (chain % type(uint64).max);
        vm.assume(chain != 84532);
        E.TreeHead memory h = liveHead();
        E.Sig memory s = signHead(h);
        vm.chainId(chain);
        vm.expectRevert(mb < 1000 * ONE ? E.BondTooSmall.selector : E.WrongChain.selector);
        new E(owner, address(usdc), kid, pubX, pubY, LOG_SALT, h, s, mb);
    }

    function test_X8b_ctor_named_chains() public {
        E.TreeHead memory h = liveHead();
        E.Sig memory s = signHead(h);
        uint256[3] memory chains = [uint256(8453), 11155111, 1];
        for (uint256 i = 0; i < chains.length; i++) {
            vm.chainId(chains[i]);
            vm.expectRevert(E.BondTooSmall.selector);
            new E(owner, address(usdc), kid, pubX, pubY, LOG_SALT, h, s, 10 * ONE);
            vm.expectRevert(E.WrongChain.selector);
            new E(owner, address(usdc), kid, pubX, pubY, LOG_SALT, h, s, 1000 * ONE);
        }
    }

    /// @dev I12 / S3: at the 20 test-USDC bond the bounty cannot pay (needs 50 above open
    ///      refunds): finalizeBounty pays 0 and the bond is unchanged. Testnet only, by design.
    function test_X9_bounty_pays_zero_at_20_usdc_bond() public {
        E small = deployWith20();
        _use(small);
        submitA(alice, carol, pairA(5, 20, R1, R2));
        vm.warp(block.timestamp + small.CONTEST_WINDOW());
        small.finalizeBounty(5);
        assertEq(small.credits(carol), 0, "no bounty");
        assertEq(small.bountiesPaid(), 0, "nothing paid");
        assertEq(small.bondAccounted(), 20 * ONE, "bond unchanged");
    }

    function deployWith20() internal returns (E e) {
        E.TreeHead memory h = liveHead();
        e = new E(owner, address(usdc), kid, pubX, pubY, LOG_SALT, h, signHead(h), 10 * ONE);
        pinDefaultList(e);
        fundAndActivate(e, 20 * ONE);
    }

    /// @dev I13: after activation, withdraw before the notice and reveal grace has run reverts.
    function test_X10_withdraw_waits_for_notice_and_grace() public {
        vm.prank(owner);
        vm.expectRevert(E.NoNotice.selector);
        escA.withdraw();
        vm.warp(escA.activatedAt() + 14 days); // giveNotice itself waits 14 days (C16)
        vm.prank(owner);
        escA.giveNotice();
        vm.warp(escA.revealGraceEnd() - 1);
        vm.prank(owner);
        vm.expectRevert(E.TooEarly.selector);
        escA.withdraw();
        vm.warp(escA.revealGraceEnd());
        vm.prank(owner);
        escA.withdraw();
        assertTrue(escA.closed(), "closed after the grace");
    }
}
