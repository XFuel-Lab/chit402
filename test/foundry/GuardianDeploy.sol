// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Vm} from "forge-std/Vm.sol";
import {ChitIssuerDigests} from "../../contracts/registry/ChitIssuerDigests.sol";
import {ChitIssuerRoot} from "../../contracts/registry/ChitIssuerRoot.sol";

/// @dev Throwaway guardian keys derived from labels. Never funded.
library GuardianDeploy {
    Vm private constant VM = Vm(address(uint160(uint256(keccak256("hevm cheat code")))));
    bytes32 public constant WITNESS_SALT = bytes32(uint256(0x5754));

    function pair() internal returns (address[] memory set, uint256[] memory pks) {
        uint256 a = uint256(keccak256("chit-issuer-root guardian A"));
        uint256 b = uint256(keccak256("chit-issuer-root guardian B"));
        if (VM.addr(a) > VM.addr(b)) {
            (a, b) = (b, a);
        }
        set = new address[](2);
        pks = new uint256[](2);
        pks[0] = a;
        pks[1] = b;
        set[0] = VM.addr(a);
        set[1] = VM.addr(b);
    }

    function sign(uint256 pk, bytes32 digest) internal returns (bytes memory) {
        (uint8 v, bytes32 r, bytes32 s) = VM.sign(pk, digest);
        return abi.encodePacked(r, s, v);
    }

    function pops(address controller, bytes32 kid, uint64 notBefore, address[] memory set, uint256[] memory pks, uint64 threshold)
        internal
        returns (bytes[] memory out)
    {
        ChitIssuerDigests.PopStatic memory pop;
        pop.chainId = block.chainid;
        pop.witnessSalt = WITNESS_SALT;
        pop.controller = controller;
        pop.genesisKid = kid;
        pop.genesisNotBefore = notBefore;
        pop.activatedAt = notBefore;
        pop.guardianThreshold = threshold;
        bytes32 digest = ChitIssuerDigests.witnessPopDigest(pop, set);
        out = new bytes[](set.length);
        for (uint256 i = 0; i < set.length; i++) {
            out[i] = sign(pks[i], digest);
        }
    }

    function args(address controller, bytes32 kid, uint64 notBefore)
        internal
        returns (address[] memory set, uint64 threshold, bytes32 salt, bytes[] memory popSigs)
    {
        uint256[] memory pks;
        (set, pks) = pair();
        threshold = 2;
        salt = WITNESS_SALT;
        popSigs = pops(controller, kid, notBefore, set, pks, threshold);
    }

    function deploy(address controller, bytes32 kid, uint64 notBefore) internal returns (ChitIssuerRoot) {
        (address[] memory set, uint256[] memory pks) = pair();
        return new ChitIssuerRoot(
            controller, kid, notBefore, set, 2, WITNESS_SALT, pops(controller, kid, notBefore, set, pks, 2)
        );
    }
}
