// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {EscrowFixture} from "./utils/EscrowFixture.sol";
import {EquivocationEscrowV0 as E} from "escrow/EquivocationEscrowV0.sol";
import {IERC20Metadata} from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";

/// @dev F1, opt-in. Runs only when BASE_SEPOLIA_RPC_URL is set, for example
///        BASE_SEPOLIA_RPC_URL=https://sepolia.base.org forge test --mc ForkBaseSepoliaTest -vv
///      Read-only: it forks state and sends eth_call to the RPC. It never
///      signs or sends a transaction, uses no key from the environment, and
///      the escrow it deploys lives only in the local fork.
contract ForkBaseSepoliaTest is EscrowFixture {
    address internal constant CIRCLE_USDC = 0x036CbD53842c5426634e7929541eC2318f3dCF7e;
    string internal rpcUrl;

    function setUp() public override {
        rpcUrl = vm.envOr("BASE_SEPOLIA_RPC_URL", string(""));
        if (bytes(rpcUrl).length == 0) return;
        vm.createSelectFork(rpcUrl);
        pk = uint256(keccak256("chit402.escrow.test.throwaway-key")) % (N - 1) + 1;
        (uint256 x, uint256 y) = vm.publicKeyP256(pk);
        pubX = bytes32(x);
        pubY = bytes32(y);
        kid = _thumb(pubX, pubY);
    }

    function _thumb(bytes32 x, bytes32 y) internal pure returns (bytes32) {
        return sha256(
            abi.encodePacked('{"crv":"P-256","kty":"EC","x":"', _b64(x), '","y":"', _b64(y), '"}')
        );
    }

    function _b64(bytes32 v) internal pure returns (bytes memory out) {
        bytes memory t = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
        out = new bytes(43);
        uint256 x = uint256(v);
        for (uint256 i = 0; i < 42; i++) out[i] = t[(x >> (256 - 6 * (i + 1))) & 63];
        out[42] = t[(x & 15) << 2];
    }

    function _skipIfNoRpc() internal {
        if (bytes(rpcUrl).length == 0) vm.skip(true);
    }

    /// @dev eth_call to 0x100 on the real network.
    function _remote100(bytes32 h, bytes32 r, bytes32 s, bytes32 x, bytes32 y) internal returns (bytes memory) {
        string memory data = vm.toString(abi.encodePacked(h, r, s, x, y));
        string memory params = string.concat(
            '[{"to":"0x0000000000000000000000000000000000000100","data":"', data, '"},"latest"]'
        );
        return vm.rpc("eth_call", params);
    }

    function _isOne(bytes memory out) internal pure returns (bool) {
        return out.length == 32 && abi.decode(out, (uint256)) == 1;
    }

    function test_F1_chain_and_circle_usdc() public {
        _skipIfNoRpc();
        assertEq(block.chainid, 84532, "Base Sepolia");
        assertGt(CIRCLE_USDC.code.length, 0, "USDC has code");
        assertEq(IERC20Metadata(CIRCLE_USDC).decimals(), 6, "decimals 6");
        assertEq(keccak256(bytes(IERC20Metadata(CIRCLE_USDC).symbol())), keccak256("USDC"), "symbol USDC");
        emit log_named_uint("fork block", block.number);
    }

    function test_F1_remote_precompile_vectors() public {
        _skipIfNoRpc();
        bytes32 dom = domainSep("Chit402TreeHead", "1", 84532, LOG_SALT);
        E.TreeHead memory h = head(2, 39, keccak256("fork vector"));
        bytes32 e = headDigest(h, dom);
        E.Sig memory s = signWith(pk, e);
        assertTrue(_isOne(_remote100(e, s.r, s.s, pubX, pubY)), "valid low-S verifies on Base Sepolia");
        assertTrue(_isOne(_remote100(e, s.r, highS(s).s, pubX, pubY)), "high-S verifies");
        assertEq(_remote100(bytes32(uint256(e) ^ 1), s.r, s.s, pubX, pubY).length, 0, "tampered digest: empty");
        assertEq(_remote100(e, bytes32(0), s.s, pubX, pubY).length, 0, "r=0: empty");
        assertEq(_remote100(e, s.r, bytes32(N), pubX, pubY).length, 0, "s=n: empty");
        assertEq(_remote100(e, s.r, s.s, pubX, bytes32(uint256(pubY) ^ 1)).length, 0, "off-curve: empty");
        assertEq(_remote100(e, s.r, s.s, bytes32(0), bytes32(0)).length, 0, "infinity: empty");

        // Node-signed shared vector (gen-vectors.mjs).
        string memory j = vm.readFile("vectors/eip712.json");
        bytes32 wx = vm.parseJsonBytes32(j, ".throwaway.x");
        bytes32 wy = vm.parseJsonBytes32(j, ".throwaway.y");
        E.TreeHead memory nh = E.TreeHead({
            epoch: uint32(vm.parseJsonUint(j, ".throwaway.head.epoch")),
            treeSize: uint64(vm.parseJsonUint(j, ".throwaway.head.tree_size")),
            root: vm.parseJsonBytes32(j, ".throwaway.head.root"),
            publishedAt: uint64(vm.parseJsonUint(j, ".throwaway.head.published_at")),
            kid: vm.parseJsonBytes32(j, ".throwaway.kid")
        });
        assertTrue(
            _isOne(_remote100(headDigest(nh, domainSep("Chit402TreeHead", "1", 84532, vm.parseJsonAddress(j, ".verifying_contract"), LOG_SALT)), vm.parseJsonBytes32(j, ".throwaway.head_sig.r"), vm.parseJsonBytes32(j, ".throwaway.head_sig.s"), wx, wy)),
            "node-signed head verifies on Base Sepolia"
        );
    }

    function test_F1_remote_wycheproof_subset() public {
        _skipIfNoRpc();
        string memory j = vm.readFile("vectors/wycheproof.json");
        uint256 n = vm.parseJsonUint(j, ".count");
        uint256 checked;
        // Every 8th case keeps the RPC load small (about 30 calls).
        for (uint256 i = 0; i < n; i += 8) {
            string memory p = string.concat(".cases[", vm.toString(i), "]");
            bytes memory out = _remote100(
                vm.parseJsonBytes32(j, string.concat(p, ".h")),
                vm.parseJsonBytes32(j, string.concat(p, ".r")),
                vm.parseJsonBytes32(j, string.concat(p, ".s")),
                vm.parseJsonBytes32(j, string.concat(p, ".x")),
                vm.parseJsonBytes32(j, string.concat(p, ".y"))
            );
            string memory tc = vm.toString(vm.parseJsonUint(j, string.concat(p, ".tcId")));
            if (vm.parseJsonBool(j, string.concat(p, ".valid"))) assertTrue(_isOne(out), string.concat("valid tc ", tc));
            else assertEq(out.length, 0, string.concat("invalid tc ", tc));
            checked++;
        }
        emit log_named_uint("wycheproof cases checked on Base Sepolia", checked);
    }

    /// @dev Escrow deployed in the local fork against the real USDC contract.
    ///      The test balance is written into local fork storage only.
    function test_F1_escrow_on_fork_typeA_commit_reveal() public {
        _skipIfNoRpc();
        E.TreeHead memory lh = liveHead();
        E fe = new E(owner, CIRCLE_USDC, kid, pubX, pubY, LOG_SALT, lh, signHeadNext(lh), 1000 * ONE);
        esc = fe;
        E.HeadRef[] memory entries = new E.HeadRef[](1);
        entries[0] = E.HeadRef({epoch: 2, treeSize: 11, root: keccak256("q")});
        E.HeadRef[] memory hw = new E.HeadRef[](1);
        hw[0] = E.HeadRef({epoch: 2, treeSize: 39, root: keccak256("live")});
        vm.prank(owner);
        fe.pinQuarantineList(keccak256("list"), entries, hw);

        // FiatToken v2.2 keeps balances in slot 9 (balanceAndBlacklistStates).
        bytes32 slot = keccak256(abi.encode(owner, uint256(9)));
        vm.store(CIRCLE_USDC, slot, bytes32(uint256(1000 * ONE)));
        assertEq(IERC20Metadata(CIRCLE_USDC).balanceOf(owner), 1000 * ONE, "local fork balance");
        vm.startPrank(owner);
        IERC20Metadata(CIRCLE_USDC).approve(address(fe), 1000 * ONE);
        fe.fund(1000 * ONE);
        fe.activate();
        vm.stopPrank();

        PairA memory p = pairA(5, 20, keccak256("r1"), keccak256("r2"));
        bytes32 salt = keccak256("fork");
        bytes32 c = fe.commitHash(alice, alice, 1, fe.evidenceHashA(p.h1, p.s1, p.h2, p.s2), salt);
        vm.prank(alice);
        uint256 g = gasleft();
        fe.commit(c);
        emit log_named_uint("fork gas commit", g - gasleft());
        vm.warp(block.timestamp + 5 minutes);
        vm.prank(alice);
        g = gasleft();
        fe.revealA(p.h1, p.s1, p.h2, p.s2, alice, salt);
        emit log_named_uint("fork gas revealA", g - gasleft());
        assertTrue(fe.frozen(), "incident opened on fork");
        vm.warp(block.timestamp + 1 hours);
        fe.finalizeBounty(5);
        uint256 before = IERC20Metadata(CIRCLE_USDC).balanceOf(alice);
        vm.prank(alice);
        g = gasleft();
        fe.claim();
        emit log_named_uint("fork gas claim (real USDC transfer)", g - gasleft());
        assertEq(IERC20Metadata(CIRCLE_USDC).balanceOf(alice) - before, 50 * ONE, "bounty in USDC");
    }
}
