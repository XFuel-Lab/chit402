// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {EscrowFixture} from "./utils/EscrowFixture.sol";
import {MockUSDC} from "./utils/MockUSDC.sol";
import {EquivocationEscrowV0 as E} from "escrow/EquivocationEscrowV0.sol";
import {Jwk7638} from "escrow/Jwk7638.sol";

/// @dev Shared JSON vectors (vectors/eip712.json, built by gen-vectors.mjs with
///      node crypto and ethers). The same file is meant for the gateway tests.
contract VectorsTest is EscrowFixture {
    string internal j;

    string internal gw; // the gateway's own fixture (services/gateway/test/fixtures), not regenerated here

    function setUp() public override {
        super.setUp();
        j = vm.readFile("vectors/eip712.json");
        gw = vm.readFile("../../services/gateway/test/fixtures/escrow-eip712-vectors.json");
    }

    function gwHead() internal view returns (E.TreeHead memory) {
        return E.TreeHead({
            epoch: uint32(vm.parseJsonUint(gw, ".tree_head.vectors[0].message.epoch")),
            treeSize: uint64(vm.parseJsonUint(gw, ".tree_head.vectors[0].message.tree_size")),
            root: vm.parseJsonBytes32(gw, ".tree_head.vectors[0].message.root"),
            publishedAt: uint64(vm.parseJsonUint(gw, ".tree_head.vectors[0].message.published_at")),
            kid: vm.parseJsonBytes32(gw, ".tree_head.vectors[0].message.kid")
        });
    }

    function gwBinding() internal view returns (E.ReceiptBinding memory) {
        return E.ReceiptBinding({
            leafHash: vm.parseJsonBytes32(gw, ".receipt_binding.vectors[0].message.leaf_hash"),
            payerCommitment: vm.parseJsonBytes32(gw, ".receipt_binding.vectors[0].message.payer_commitment"),
            amountAtomic: uint64(vm.parseJsonUint(gw, ".receipt_binding.vectors[0].message.amount_atomic")),
            assetId: vm.parseJsonBytes32(gw, ".receipt_binding.vectors[0].message.asset_id"),
            kid: vm.parseJsonBytes32(gw, ".receipt_binding.vectors[0].message.kid")
        });
    }

    /// @dev M2 / I1 / I2: both signing domains are byte-identical to the gateway signer's own
    ///      fixture file (read as is, never regenerated): domain typehash 0xa604fff5...,
    ///      head separator 0xf872d64d...cbc9, binding separator 0xd8170c88...e927, and the
    ///      gateway's digest e for its head and binding vectors.
    function test_domains_equal_gateway_fixture_byte_for_byte() public view {
        assertEq(esc.DOMAIN_TYPEHASH(), vm.parseJsonBytes32(gw, ".domain_typehash"), "domain typehash = gateway");
        assertEq(esc.DOMAIN_TYPEHASH(), 0xa604fff5a27d5951f334ccda7abff3286a8af29caeeb196a6f2b40a1dce7612b, "0xa604fff5");
        assertEq(vm.parseJsonUint(gw, ".chain_id"), esc.CHAIN_ID(), "chain");
        assertEq(esc.LOG_SALT(), vm.parseJsonBytes32(gw, ".log_id.salt"), "log salt = gateway");
        assertEq(esc.TREEHEAD_TYPEHASH(), vm.parseJsonBytes32(gw, ".tree_head.typehash"), "head typehash = gateway");
        assertEq(esc.TREEHEAD_DOMAIN_SEPARATOR(), vm.parseJsonBytes32(gw, ".tree_head.domain_separator"), "head domain = gateway");
        assertEq(esc.TREEHEAD_DOMAIN_SEPARATOR(), 0xf872d64db3e6a1016b2dbdef96c6065d8b1104416485c6ef465c2b9df8c4cbc9, "0xf872d64d");
        assertEq(esc.treeHeadDigest(gwHead()), vm.parseJsonBytes32(gw, ".tree_head.vectors[0].e"), "head e = gateway");
        assertEq(esc.BINDING_TYPEHASH(), vm.parseJsonBytes32(gw, ".receipt_binding.typehash"), "binding typehash = gateway");
        assertEq(esc.BINDING_DOMAIN_SEPARATOR(), vm.parseJsonBytes32(gw, ".receipt_binding.domain_separator"), "binding domain = gateway");
        assertEq(esc.bindingDigest(gwBinding()), vm.parseJsonBytes32(gw, ".receipt_binding.vectors[0].e"), "binding e = gateway");
        assertEq(esc.PAYER_TAG(), vm.parseJsonBytes32(gw, ".receipt_binding.payer_tag"), "payer tag = gateway");
        assertEq(esc.USDC_BASE_ID(), vm.parseJsonBytes32(gw, ".receipt_binding.asset_id"), "asset id = gateway");
        // This repo's vectors file agrees with the gateway fixture on every shared value.
        assertEq(vm.parseJsonBytes32(j, ".treehead_domain_separator"), vm.parseJsonBytes32(gw, ".tree_head.domain_separator"), "vectors head dom");
        assertEq(vm.parseJsonBytes32(j, ".binding_domain_separator"), vm.parseJsonBytes32(gw, ".receipt_binding.domain_separator"), "vectors binding dom");
        assertEq(vm.parseJsonBytes32(j, ".worked_head.e"), vm.parseJsonBytes32(gw, ".tree_head.vectors[0].e"), "vectors worked e");
    }

    /// @dev M2 / I1: a liveness head in the gateway's format (sha256 over 0x1901, the gateway
    ///      fixture's head separator and the struct hash) deploys an escrow. Throwaway key: the
    ///      fixture carries no production signature.
    function test_liveness_head_in_gateway_format_deploys() public {
        bytes32 gds = vm.parseJsonBytes32(gw, ".tree_head.domain_separator");
        E.TreeHead memory h = liveHead();
        E.Sig memory s = signWith(pk, sha256(abi.encodePacked(hex"1901", gds, headStruct(h))));
        E e = new E(owner, address(usdc), kid, pubX, pubY, LOG_SALT, h, s, 1000 * ONE);
        assertEq(e.TREEHEAD_DOMAIN_SEPARATOR(), gds, "head domain");
    }

    function test_constants_match_vectors() public view {
        assertEq(esc.DOMAIN_TYPEHASH(), vm.parseJsonBytes32(j, ".domain_typehash"), "domain typehash");
        assertEq(esc.TREEHEAD_TYPEHASH(), vm.parseJsonBytes32(j, ".treehead_typehash"), "treehead typehash");
        assertEq(esc.BINDING_TYPEHASH(), vm.parseJsonBytes32(j, ".binding_typehash"), "binding typehash");
        assertEq(esc.COMMIT_TAG(), vm.parseJsonBytes32(j, ".commit_tag"), "commit tag");
        assertEq(esc.PAYER_TAG(), vm.parseJsonBytes32(j, ".payer_tag"), "payer tag");
        assertEq(esc.USDC_BASE_ID(), vm.parseJsonBytes32(j, ".usdc_base_id"), "usdc id");
        assertEq(esc.LOG_SALT(), vm.parseJsonBytes32(j, ".log_salt"), "salt");
        assertEq(esc.TREEHEAD_DOMAIN_SEPARATOR(), vm.parseJsonBytes32(j, ".treehead_domain_separator"), "th dom");
        assertEq(esc.BINDING_DOMAIN_SEPARATOR(), vm.parseJsonBytes32(j, ".binding_domain_separator"), "b dom");
        // Brief section (a) values.
        assertEq(esc.TREEHEAD_DOMAIN_SEPARATOR(), 0xf872d64db3e6a1016b2dbdef96c6065d8b1104416485c6ef465c2b9df8c4cbc9, "brief dom");
        assertEq(esc.BINDING_TYPEHASH(), 0x988137c56725cd0e31ca35c99b68f3e106602c950645b1a17ea521fe49100ba0, "brief binding typehash");
    }

    function test_worked_vector_digest() public view {
        E.TreeHead memory h = E.TreeHead({
            epoch: uint32(vm.parseJsonUint(j, ".worked_head.epoch")),
            treeSize: uint64(vm.parseJsonUint(j, ".worked_head.tree_size")),
            root: vm.parseJsonBytes32(j, ".worked_head.root"),
            publishedAt: uint64(vm.parseJsonUint(j, ".worked_head.published_at")),
            kid: vm.parseJsonBytes32(j, ".worked_head.kid")
        });
        assertEq(headStruct(h), vm.parseJsonBytes32(j, ".worked_head.struct_hash"), "struct hash");
        assertEq(esc.treeHeadDigest(h), vm.parseJsonBytes32(j, ".worked_head.e"), "e");
        assertEq(esc.treeHeadDigest(h), 0x2c7b0ae5fab76b2b6b13e6ef7ba99d0eb7e7df9e087102ad32b681ec7842412f, "brief e");
    }

    function test_production_kid_thumbprint() public view {
        bytes32 x = vm.parseJsonBytes32(j, ".production_key.x");
        bytes32 y = vm.parseJsonBytes32(j, ".production_key.y");
        assertEq(Jwk7638.thumbprintP256(x, y), vm.parseJsonBytes32(j, ".production_key.kid"), "prod kid");
        assertEq(Jwk7638.thumbprintP256(x, y), 0x22f169982faf3e1918fefd2f89db2b5954fdbb3944e5758a66000439e253ab54, "brief kid");
    }

    /// @dev A head and a binding signed by node crypto (SHA-256 over the
    ///      66-byte preimage, P1363) verify on chain: the contract deploys with
    ///      the node-signed head as its liveness proof, and the binding digest
    ///      and signature pass 0x100.
    function test_node_signed_vectors_verify_on_chain() public {
        bytes32 x = vm.parseJsonBytes32(j, ".throwaway.x");
        bytes32 y = vm.parseJsonBytes32(j, ".throwaway.y");
        bytes32 k = vm.parseJsonBytes32(j, ".throwaway.kid");
        E.TreeHead memory h = E.TreeHead({
            epoch: uint32(vm.parseJsonUint(j, ".throwaway.head.epoch")),
            treeSize: uint64(vm.parseJsonUint(j, ".throwaway.head.tree_size")),
            root: vm.parseJsonBytes32(j, ".throwaway.head.root"),
            publishedAt: uint64(vm.parseJsonUint(j, ".throwaway.head.published_at")),
            kid: k
        });
        E.Sig memory s = E.Sig({r: vm.parseJsonBytes32(j, ".throwaway.head_sig.r"), s: vm.parseJsonBytes32(j, ".throwaway.head_sig.s")});
        MockUSDC t = new MockUSDC();
        E e2 = new E(owner, address(t), k, x, y, LOG_SALT, h, s, 1000 * ONE);
        assertEq(e2.KID(), k, "kid");

        E.ReceiptBinding memory b = E.ReceiptBinding({
            leafHash: vm.parseJsonBytes32(j, ".throwaway.binding.leaf_hash"),
            payerCommitment: vm.parseJsonBytes32(j, ".throwaway.binding.payer_commitment"),
            amountAtomic: uint64(vm.parseJsonUint(j, ".throwaway.binding.amount_atomic")),
            assetId: vm.parseJsonBytes32(j, ".throwaway.binding.asset_id"),
            kid: k
        });
        address payer = vm.parseJsonAddress(j, ".throwaway.binding_payer");
        bytes32 psalt = vm.parseJsonBytes32(j, ".throwaway.binding_payer_salt");
        assertEq(commitment(payer, psalt), b.payerCommitment, "commitment");
        bytes32 r = vm.parseJsonBytes32(j, ".throwaway.binding_sig.r");
        bytes32 sv = vm.parseJsonBytes32(j, ".throwaway.binding_sig.s");
        (bool ok, bytes memory out) = address(0x100).staticcall(abi.encodePacked(e2.bindingDigest(b), r, sv, x, y));
        assertTrue(ok && out.length == 32 && abi.decode(out, (uint256)) == 1, "binding sig");
        // The same signature does not verify as a tree head digest.
        (ok, out) = address(0x100).staticcall(abi.encodePacked(e2.treeHeadDigest(h), r, sv, x, y));
        assertEq(out.length, 0, "binding sig is not a head sig");
    }
}
