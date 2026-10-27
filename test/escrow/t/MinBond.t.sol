// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {EscrowFixture} from "./utils/EscrowFixture.sol";
import {EquivocationEscrowV0 as E, minBondAllowed} from "escrow/EquivocationEscrowV0.sol";

/// @dev minBond constructor argument: 1,000 USDC everywhere, 10 USDC only on Base Sepolia (84532).
contract MinBondTest is EscrowFixture {
    function deployWith(uint256 mb) internal returns (E) {
        E.TreeHead memory h = liveHead();
        return new E(owner, address(usdc), kid, pubX, pubY, LOG_SALT, h, signHeadNext(h), mb);
    }

    /// @dev Signs first, so that vm.expectRevert applies to the constructor itself.
    function expectCtorRevert(bytes4 sel, uint256 mb) internal {
        E.TreeHead memory h = liveHead();
        E.Sig memory sg = signHeadNext(h);
        vm.expectRevert(sel);
        new E(owner, address(usdc), kid, pubX, pubY, LOG_SALT, h, sg, mb);
    }

    // ---------------- Base Sepolia ----------------

    function test_baseSepolia_10usdc_accepted() public {
        E e = deployWith(10 * ONE);
        assertEq(e.MIN_BOND(), 10 * ONE, "MIN_BOND is the constructor value");
    }

    function test_baseSepolia_9_999_999_refused() public {
        expectCtorRevert(E.BondTooSmall.selector, 9_999_999);
    }

    function test_baseSepolia_zero_refused() public {
        expectCtorRevert(E.BondTooSmall.selector, 0);
    }

    function test_baseSepolia_1000usdc_accepted() public {
        assertEq(deployWith(1000 * ONE).MIN_BOND(), 1000 * ONE, "1,000 USDC accepted");
    }

    // ---------------- Base mainnet (8453) and another chain ----------------

    function _refusedBelowFloor(uint256 chainId) internal {
        vm.chainId(chainId);
        uint256[5] memory low = [uint256(0), 1, 9_999_999, 10_000_000, 999_999_999];
        for (uint256 i = 0; i < low.length; i++) {
            expectCtorRevert(E.BondTooSmall.selector, low[i]);
        }
    }

    /// @dev V0 is Base Sepolia only, so on another chain a constructor that passes the
    ///      bond rule then stops at the chain check (WrongChain), never at BondTooSmall.
    function _acceptedAtFloor(uint256 chainId) internal {
        vm.chainId(chainId);
        assertTrue(minBondAllowed(chainId, 1000 * ONE), "1,000 USDC passes the rule");
        expectCtorRevert(E.WrongChain.selector, 1000 * ONE);
    }

    function test_baseMainnet_below_1000usdc_refused() public {
        _refusedBelowFloor(8453);
    }

    function test_baseMainnet_1000usdc_accepted_by_the_rule() public {
        _acceptedAtFloor(8453);
    }

    function test_otherChain_below_1000usdc_refused() public {
        _refusedBelowFloor(1);
    }

    function test_otherChain_1000usdc_accepted_by_the_rule() public {
        _acceptedAtFloor(1);
    }

    function test_rule_table() public pure {
        assertTrue(minBondAllowed(84532, 10_000_000), "84532 10 USDC");
        assertFalse(minBondAllowed(84532, 9_999_999), "84532 below 10 USDC");
        assertTrue(minBondAllowed(84532, 1_000_000_000), "84532 1,000 USDC");
        assertTrue(minBondAllowed(8453, 1_000_000_000), "8453 1,000 USDC");
        assertFalse(minBondAllowed(8453, 999_999_999), "8453 below 1,000 USDC");
        assertFalse(minBondAllowed(8453, 10_000_000), "8453 10 USDC");
        assertTrue(minBondAllowed(1, 1_000_000_000), "chain 1 1,000 USDC");
        assertFalse(minBondAllowed(1, 10_000_000), "chain 1 10 USDC");
        assertFalse(minBondAllowed(84531, 10_000_000), "84531 10 USDC");
        assertFalse(minBondAllowed(84533, 10_000_000), "84533 10 USDC");
    }

    function testFuzz_rule(uint256 chainId, uint256 mb) public pure {
        bool want = mb >= 1_000_000_000 || (chainId == 84532 && mb >= 10_000_000);
        assertEq(minBondAllowed(chainId, mb), want, "rule");
    }

    // ---------------- deposits below minBond ----------------

    function test_bond_below_minBond_cannot_activate() public {
        E e = deployWith(10 * ONE);
        pinDefaultList(e);
        usdc.mint(owner, 20 * ONE);
        vm.startPrank(owner);
        usdc.approve(address(e), 20 * ONE);
        e.fund(9_999_999);
        vm.expectRevert(E.BondTooSmall.selector);
        e.activate();
        e.fund(1);
        e.activate();
        vm.stopPrank();
        assertGt(e.activatedAt(), 0, "active at exactly minBond");
    }

    /// @dev The testnet step 6 plan: 10 USDC bond, then the remaining 10 USDC as a
    ///      second deposit, then activate. 20 USDC in total.
    function test_testnet_plan_20usdc() public {
        E e = deployWith(10 * ONE);
        pinDefaultList(e);
        usdc.mint(owner, 20 * ONE);
        vm.startPrank(owner);
        usdc.approve(address(e), 20 * ONE);
        vm.expectRevert(E.BondTooSmall.selector);
        e.activate();
        e.fund(10 * ONE);
        assertEq(e.bondAccounted(), 10 * ONE, "bond 10");
        e.fund(10 * ONE);
        assertEq(e.bondAccounted(), 20 * ONE, "bond 20");
        e.activate();
        vm.stopPrank();
        assertEq(usdc.balanceOf(address(e)), 20 * ONE, "escrow holds 20");
        assertEq(usdc.balanceOf(owner), 0, "owner spent 20");
    }

    function test_fixture_minBond_is_1000usdc() public view {
        assertEq(esc.MIN_BOND(), 1000 * ONE, "existing tests keep 1,000 USDC");
    }
}
