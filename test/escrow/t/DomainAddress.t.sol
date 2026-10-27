// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {EscrowFixture} from "./utils/EscrowFixture.sol";
import {EquivocationEscrowV0 as E} from "escrow/EquivocationEscrowV0.sol";

/// @dev Both signing domains name the escrow (verifyingContract = address(this)).
///      Two escrows on the same chain with the same owner, token, key and log
///      salt: a head or binding signed for escrow A is not valid at escrow B,
///      so the same signed heads cannot open an incident (or pay a refund) twice.
contract DomainAddressTest is EscrowFixture {
    bytes32 internal constant R1 = keccak256("root one");
    bytes32 internal constant R2 = keccak256("root two");
    address internal p1 = address(0x1001);
    bytes32 internal ps1 = keccak256("payer salt 1");

    E internal escA;
    E internal escB;

    function setUp() public override {
        super.setUp();
        escA = esc;
        escB = deploy(address(usdc));
        pinDefaultList(escB);
        fundAndActivate(escB, 1000 * ONE);
        assertTrue(address(escA) != address(escB), "two escrows");
        assertEq(escA.LOG_SALT(), escB.LOG_SALT(), "same salt");
        assertEq(escA.OWNER(), escB.OWNER(), "same owner");
        assertEq(escA.KID(), escB.KID(), "same key");
        assertTrue(escA.TREEHEAD_DOMAIN_SEPARATOR() != escB.TREEHEAD_DOMAIN_SEPARATOR(), "head domains differ");
        assertTrue(escA.BINDING_DOMAIN_SEPARATOR() != escB.BINDING_DOMAIN_SEPARATOR(), "binding domains differ");
    }

    function _use(E e) internal {
        esc = e;
    }

    function _rejectAt(E e, PairA memory p, bytes4 err) internal {
        _use(e);
        bytes32 salt = keccak256(abi.encode("dom", address(e), p.s1.s, p.s2.s));
        bytes32 c = commitA(alice, alice, p, salt);
        passDelay();
        vm.expectRevert(err);
        revealA(alice, alice, p, salt);
        assertEq(e.incidentCount(), 0, "no incident");
        assertFalse(e.frozen(), "not frozen");
        (address committer,,) = e.commits(c);
        assertEq(committer, alice, "commit kept");
    }

    function test_D1_head_for_A_rejected_by_B_accepted_by_A() public {
        PairA memory p = pairA(5, 20, R1, R2); // signed for escA (esc)
        _rejectAt(escB, p, E.BadSignature.selector);
        _use(escA);
        submitA(alice, carol, p);
        assertTrue(escA.frozen(), "A frozen");
        assertEq(escA.incidentCount(), 1, "A incident");
        assertFalse(escB.frozen(), "B not frozen");
        assertEq(escB.incidentCount(), 0, "B no incident");
    }

    function test_D2_head_for_B_rejected_by_A_accepted_by_B() public {
        PairA memory p;
        p.h1 = head(5, 20, R1);
        p.s1 = signHeadFor(p.h1, address(escB));
        p.h2 = head(5, 20, R2);
        p.s2 = signHeadFor(p.h2, address(escB));
        _rejectAt(escA, p, E.BadSignature.selector);
        _use(escB);
        submitA(alice, carol, p);
        assertEq(escB.incidentCount(), 1, "B incident");
        assertEq(escA.incidentCount(), 0, "A no incident");
    }

    /// @dev One head signed for A and one for B do not pair up at either escrow.
    function test_D3_mixed_pair_rejected_at_both() public {
        PairA memory p;
        p.h1 = head(5, 20, R1);
        p.s1 = signHeadFor(p.h1, address(escA));
        p.h2 = head(5, 20, R2);
        p.s2 = signHeadFor(p.h2, address(escB));
        _rejectAt(escA, p, E.BadSignature.selector);
        _rejectAt(escB, p, E.BadSignature.selector);
    }

    /// @dev Refund path: same B evidence and binding on both escrows. Heads and
    ///      binding signed for A open an incident and register a refund at A
    ///      only; at B the binding signed for A is rejected even once B has
    ///      its own incident from heads signed for B.
    function test_D4_refund_binding_for_A_rejected_by_B() public {
        E.EvidenceB memory ev = forkB(7, 16, 3, 42); // heads signed for escA
        _use(escB);
        bytes32 salt = keccak256("b-at-B");
        commitB(alice, alice, ev, salt);
        passDelay();
        vm.expectRevert(E.BadSignature.selector);
        revealB(alice, alice, ev, salt);

        _use(escA);
        bytes32 keyA = submitB(alice, alice, ev);
        E.ReceiptBinding memory b = binding(ev.l1, p1, ps1, 2 * ONE);
        E.Sig memory sA = signBindingFor(b, address(escA));
        escA.registerRefund(keyA, b, sA, p1, ps1);
        assertEq(escA.refundOf(ev.l1).payer, p1, "A refund registered");

        // B gets its own incident from heads signed for B.
        E.EvidenceB memory evB = ev;
        evB.s1 = signHeadFor(ev.h1, address(escB));
        evB.s2 = signHeadFor(ev.h2, address(escB));
        _use(escB);
        bytes32 keyB = submitB(alice, alice, evB);
        assertEq(keyB, keyA, "same evidence key on both");
        vm.expectRevert(E.BadSignature.selector);
        escB.registerRefund(keyB, b, sA, p1, ps1);
        assertEq(escB.refundOf(ev.l1).payer, address(0), "no refund at B from A's binding");
        // A binding signed for B is accepted at B.
        escB.registerRefund(keyB, b, signBindingFor(b, address(escB)), p1, ps1);
        assertEq(escB.refundOf(ev.l1).payer, p1, "B refund with B binding");
    }

    /// @dev Constructor liveness: a head signed for one address does not deploy at another.
    function test_D5_liveness_head_is_per_address() public {
        E.TreeHead memory h = liveHead();
        E.Sig memory forA = signHeadFor(h, address(escA));
        vm.expectRevert(E.LivenessFailed.selector);
        new E(owner, address(usdc), kid, pubX, pubY, LOG_SALT, h, forA, 1000 * ONE);
        E.Sig memory forNext = signHeadNext(h);
        E e = new E(owner, address(usdc), kid, pubX, pubY, LOG_SALT, h, forNext, 1000 * ONE);
        assertTrue(address(e) != address(escA), "new address");
    }

    /// @dev Same address, other chainId in the domain: rejected (C23/BC5 cover
    ///      this for the fixture too; here with the address spelled out).
    function test_D6_other_chain_same_address_rejected() public {
        PairA memory p = pairA(5, 20, R1, R2);
        p.s2 = signWith(pk, headDigest(p.h2, domainSep("Chit402TreeHead", "1", 8453, address(escA), LOG_SALT)));
        _rejectAt(escA, p, E.BadSignature.selector);
        p = pairA(5, 20, R1, R2);
        p.s1 = signWith(pk, headDigest(p.h1, domainSep("Chit402TreeHead", "1", 1, address(escA), LOG_SALT)));
        _rejectAt(escA, p, E.BadSignature.selector);
    }

    /// @dev The domain without verifyingContract (the pre-change shape) is rejected.
    function test_D7_domain_without_address_rejected() public {
        bytes32 old = keccak256(
            abi.encode(
                keccak256("EIP712Domain(string name,string version,uint256 chainId,bytes32 salt)"),
                keccak256("Chit402TreeHead"),
                keccak256("1"),
                uint256(84532),
                LOG_SALT
            )
        );
        PairA memory p = pairA(5, 20, R1, R2);
        p.s1 = signWith(pk, headDigest(p.h1, old));
        p.s2 = signWith(pk, headDigest(p.h2, old));
        _rejectAt(escA, p, E.BadSignature.selector);
        // Zero address in the domain is not this escrow either.
        p = pairA(5, 20, R1, R2);
        p.s2 = signWith(pk, headDigest(p.h2, domainSep("Chit402TreeHead", "1", 84532, address(0), LOG_SALT)));
        _rejectAt(escA, p, E.BadSignature.selector);
    }
}
