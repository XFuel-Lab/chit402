// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {EscrowFixture} from "./utils/EscrowFixture.sol";
import {TreeLib} from "./utils/TreeLib.sol";
import {EquivocationEscrowV0 as E} from "escrow/EquivocationEscrowV0.sol";

/// @dev Brief tests BC1-BC10 (refund claims through the ReceiptBinding).
contract BindingTest is EscrowFixture {
    address internal p1 = address(0x1001);
    address internal p2 = address(0x1002);
    bytes32 internal ps1 = keccak256("payer salt 1");
    bytes32 internal ps2 = keccak256("payer salt 2");

    E.EvidenceB internal ev;
    bytes32 internal key;

    function setUp() public override {
        super.setUp();
        E.EvidenceB memory e = forkB(7, 16, 3, 42);
        key = submitB(alice, alice, e);
        ev = e;
    }

    function _register(bytes32 k, E.ReceiptBinding memory b, address payer, bytes32 ps) internal {
        esc.registerRefund(k, b, signBinding(b), payer, ps);
    }

    // BC1
    function test_BC1_valid_claims_on_both_leaves() public {
        _register(key, binding(ev.l1, p1, ps1, 2 * ONE), p1, ps1);
        _register(key, binding(ev.l2, p2, ps2, 3 * ONE), p2, ps2);
        assertEq(esc.refundOf(ev.l1).payer, p1, "l1 registered");
        assertEq(esc.refundOf(ev.l2).payer, p2, "l2 registered");
        vm.expectRevert(E.NotSettled.selector);
        esc.claimRefund(ev.l1);
        vm.warp(esc.incident(1).claimsCloseAt + 1);
        esc.settle(1);
        esc.claimRefund(ev.l1);
        esc.claimRefund(ev.l2);
        assertEq(usdc.balanceOf(p1), 2 * ONE, "p1 paid");
        assertEq(usdc.balanceOf(p2), 3 * ONE, "p2 paid");
        vm.expectRevert(E.NothingToClaim.selector);
        esc.claimRefund(ev.l1);
    }

    // BC2
    function test_BC2_wrong_salt_or_payer() public {
        E.ReceiptBinding memory b = binding(ev.l1, p1, ps1, 2 * ONE);
        E.Sig memory s = signBinding(b);
        vm.expectRevert(E.BadCommitment.selector);
        esc.registerRefund(key, b, s, p1, ps2);
        vm.expectRevert(E.BadCommitment.selector);
        esc.registerRefund(key, b, s, p2, ps1);
        E.ReceiptBinding memory z = binding(ev.l1, address(0), ps1, 2 * ONE);
        E.Sig memory zs = signBinding(z);
        vm.expectRevert(E.BadCommitment.selector);
        esc.registerRefund(key, z, zs, address(0), ps1);
        assertEq(esc.incident(1).requested, 0, "nothing registered");
    }

    // BC3
    function test_BC3_leaf_not_affected_or_typeA_only() public {
        E.ReceiptBinding memory b = binding(ev.p1[0], p1, ps1, 2 * ONE);
        E.Sig memory s = signBinding(b);
        vm.expectRevert(E.NotAffected.selector);
        esc.registerRefund(key, b, s, p1, ps1);

        bytes32 keyA = submitA(bob, bob, PairA({h1: ev.h1, s1: ev.s1, h2: ev.h2, s2: ev.s2}));
        b = binding(ev.h1.root, p1, ps1, 2 * ONE);
        s = signBinding(b);
        vm.expectRevert(E.NotAffected.selector);
        esc.registerRefund(keyA, b, s, p1, ps1);
        b = binding(ev.l1, p1, ps1, 2 * ONE);
        s = signBinding(b);
        vm.expectRevert(E.NotAffected.selector);
        esc.registerRefund(keyA, b, s, p1, ps1);
    }

    // BC4
    function test_BC4_same_leaf_twice_same_or_other_incident() public {
        _register(key, binding(ev.l1, p1, ps1, 2 * ONE), p1, ps1);
        E.ReceiptBinding memory again = binding(ev.l1, p2, ps2, 2 * ONE);
        E.Sig memory as_ = signBinding(again);
        vm.expectRevert(E.AlreadyClaimed.selector);
        esc.registerRefund(key, again, as_, p2, ps2);

        // Second incident: a new fork in another epoch that contains the same
        // leaf hash on one side.
        vm.warp(esc.incident(1).claimsCloseAt + 1);
        esc.settle(1);
        bytes32[] memory honest = new bytes32[](4);
        bytes32[] memory forked = new bytes32[](4);
        for (uint256 i = 0; i < 4; i++) {
            honest[i] = TreeLib.leaf(abi.encodePacked("h", i));
            forked[i] = TreeLib.leaf(abi.encodePacked("f", i));
        }
        honest[1] = ev.l1;
        E.EvidenceB memory e2;
        e2.h1 = head(30, 4, TreeLib.root(honest));
        e2.s1 = signHead(e2.h1);
        e2.h2 = head(30, 4, TreeLib.root(forked));
        e2.s2 = signHead(e2.h2);
        e2.index = 1;
        e2.l1 = honest[1];
        e2.l2 = forked[1];
        e2.p1 = TreeLib.proof(honest, 1);
        e2.p2 = TreeLib.proof(forked, 1);
        bytes32 key2 = submitB(bob, bob, e2);
        assertEq(esc.evidenceIncident(key2), 2, "second incident");
        E.ReceiptBinding memory b2 = binding(ev.l1, p1, ps1, 2 * ONE);
        E.Sig memory s2 = signBinding(b2);
        vm.expectRevert(E.AlreadyClaimed.selector);
        esc.registerRefund(key2, b2, s2, p1, ps1);
    }

    // BC5
    function test_BC5_wrong_key_domain_typehash_or_head_sig() public {
        E.ReceiptBinding memory b = binding(ev.l1, p1, ps1, 2 * ONE);
        bytes32 bdom = domainSep("Chit402ReceiptBinding", "1", 84532, LOG_SALT);
        bytes32 sh = bindingStruct(b);

        uint256 other = uint256(keccak256("other key")) % (N - 1) + 1;
        E.Sig memory s = signWith(other, sha256(abi.encodePacked(hex"1901", bdom, sh)));
        vm.expectRevert(E.BadSignature.selector);
        esc.registerRefund(key, b, s, p1, ps1);

        s = signWith(pk, sha256(abi.encodePacked(hex"1901", domainSep("Chit402ReceiptBinding", "1", 8453, LOG_SALT), sh)));
        vm.expectRevert(E.BadSignature.selector);
        esc.registerRefund(key, b, s, p1, ps1);

        s = signWith(pk, sha256(abi.encodePacked(hex"1901", domainSep("Chit402TreeHead", "1", 84532, LOG_SALT), sh)));
        vm.expectRevert(E.BadSignature.selector);
        esc.registerRefund(key, b, s, p1, ps1);

        bytes32 wrongType = keccak256(
            abi.encode(
                keccak256("ReceiptBinding(bytes32 leaf_hash,bytes32 payer_commitment,uint256 amount_atomic,bytes32 asset_id,bytes32 kid)"),
                b.leafHash, b.payerCommitment, b.amountAtomic, b.assetId, b.kid
            )
        );
        s = signWith(pk, sha256(abi.encodePacked(hex"1901", bdom, wrongType)));
        vm.expectRevert(E.BadSignature.selector);
        esc.registerRefund(key, b, s, p1, ps1);

        // A tree head signature replayed as a binding signature.
        vm.expectRevert(E.BadSignature.selector);
        esc.registerRefund(key, b, ev.s1, p1, ps1);

        E.ReceiptBinding memory wk = b;
        wk.kid = keccak256("other kid");
        s = signBinding(wk);
        vm.expectRevert(E.UnknownKid.selector);
        esc.registerRefund(key, wk, s, p1, ps1);
    }

    // BC6
    function test_BC6_asset_not_usdc() public {
        E.ReceiptBinding memory b = binding(ev.l1, p1, ps1, 2 * ONE);
        b.assetId = keccak256("eip155:8453/erc20:0x0000000000000000000000000000000000000001");
        E.Sig memory s = signBinding(b);
        vm.expectRevert(E.WrongAsset.selector);
        esc.registerRefund(key, b, s, p1, ps1);
    }

    // BC7 (pro rata on oversubscription is in EscrowTest.test_C15_cap_and_pro_rata)
    function test_BC7_amount_capped_at_5_usdc() public {
        _register(key, binding(ev.l1, p1, ps1, 9 * ONE), p1, ps1);
        assertEq(esc.refundOf(ev.l1).amount, 5 * ONE, "capped");
        vm.warp(esc.incident(1).claimsCloseAt + 1);
        esc.settle(1);
        esc.claimRefund(ev.l1);
        assertEq(usdc.balanceOf(p1), 5 * ONE, "paid 5");
    }

    // BC8
    function test_BC8_claim_after_close() public {
        E.ReceiptBinding memory b = binding(ev.l1, p1, ps1, 2 * ONE);
        E.Sig memory s = signBinding(b);
        vm.warp(esc.incident(1).claimsCloseAt + 1);
        vm.expectRevert(E.ClaimsClosed.selector);
        esc.registerRefund(key, b, s, p1, ps1);
        esc.settle(1);
        vm.expectRevert(E.ClaimsClosed.selector);
        esc.registerRefund(key, b, s, p1, ps1);
    }

    // BC9
    function test_BC9_copied_claim_pays_the_same_payer() public {
        E.ReceiptBinding memory b = binding(ev.l1, p1, ps1, 2 * ONE);
        E.Sig memory s = signBinding(b);
        vm.prank(carol);
        esc.registerRefund(key, b, s, p1, ps1);
        vm.warp(esc.incident(1).claimsCloseAt + 1);
        esc.settle(1);
        vm.prank(carol);
        esc.claimRefund(ev.l1);
        assertEq(usdc.balanceOf(p1), 2 * ONE, "payer paid");
        assertEq(usdc.balanceOf(carol), 0, "submitter paid nothing");
    }

    // BC10
    function test_BC10_blacklisted_payer_isolated() public {
        _register(key, binding(ev.l1, p1, ps1, 2 * ONE), p1, ps1);
        _register(key, binding(ev.l2, p2, ps2, 2 * ONE), p2, ps2);
        vm.warp(block.timestamp + 1 hours);
        esc.finalizeBounty(7);
        vm.warp(esc.incident(1).claimsCloseAt + 1);
        esc.settle(1);
        usdc.setBlacklisted(p1, true);
        vm.expectRevert(bytes("Blacklistable: account is blacklisted"));
        esc.claimRefund(ev.l1);
        esc.claimRefund(ev.l2);
        assertEq(usdc.balanceOf(p2), 2 * ONE, "other payer paid");
        vm.prank(alice);
        esc.claim();
        vm.prank(owner);
        esc.giveNotice();
        vm.warp(esc.revealGraceEnd());
        vm.prank(owner);
        esc.withdraw();
        assertEq(usdc.balanceOf(owner), 1000 * ONE - 50 * ONE - 4 * ONE, "withdraw unaffected");
        assertEq(usdc.balanceOf(address(esc)), 2 * ONE, "blacklisted refund stays claimable");
        usdc.setBlacklisted(p1, false);
        esc.claimRefund(ev.l1);
        assertEq(usdc.balanceOf(p1), 2 * ONE, "paid once unlisted");
    }
}
