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

    function setUp() public override {
        super.setUp();
        j = vm.readFile("vectors/eip712.json");
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
        E e2 = new E(owner, address(t), k, x, y, LOG_SALT, h, s);
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
