// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;
import {Test} from "./utils/Test.sol";
import {ChitAnchor} from "chit-simple/ChitAnchor.sol";
import {Tree} from "./Tree.sol";
contract DoctorForkTest is Test {
    function test_fork_from_other_prefix_refused() public {
        vm.chainId(84532);
        address cp = address(0xC0FFEE);
        ChitAnchor a = new ChitAnchor(cp);
        bytes32 dom = a.domain();
        bytes32[] memory A = new bytes32[](3);
        for (uint256 i = 0; i < 3; i++) A[i] = bytes32(uint256(i + 1));
        bytes32 rootA = Tree.mth(A);
        vm.warp(7200); vm.prank(cp);
        a.anchor(dom, 1, 3600, 3, rootA, bytes32(uint256(1)), new bytes32[](0));
        bytes32[] memory B = new bytes32[](5);
        for (uint256 i = 0; i < 5; i++) B[i] = bytes32(uint256(100 + i));
        bytes32[] memory proof = Tree.consistency(B, 3, 5);
        bytes32 rootB = Tree.mth(B);
        vm.warp(3 * 3600); vm.prank(cp);
        vm.expectRevert(ChitAnchor.BadConsistency.selector);
        a.anchor(dom, 2, 7200, 5, rootB, bytes32(uint256(2)), proof);
    }

    /// @notice A 3-leaf head extended with an empty proof is refused.
    ///         Size 3 is not a power of two, so the later length check never
    ///         runs when the empty-proof guard is removed.
    function test_empty_proof_at_three_leaves_refused() public {
        vm.chainId(84532);
        address cp = address(0xC0FFEE);
        ChitAnchor a = new ChitAnchor(cp);
        bytes32 dom = a.domain();
        bytes32[] memory leaves = new bytes32[](3);
        for (uint256 i = 0; i < 3; i++) leaves[i] = bytes32(uint256(i + 1));
        bytes32 root = Tree.mth(leaves);
        vm.warp(7200);
        vm.prank(cp);
        a.anchor(dom, 1, 3600, 3, root, bytes32(uint256(1)), new bytes32[](0));
        vm.warp(3 * 3600);
        vm.prank(cp);
        vm.expectRevert(ChitAnchor.BadConsistency.selector);
        a.anchor(dom, 2, 7200, 5, bytes32(uint256(9)), bytes32(uint256(2)), new bytes32[](0));
    }
}
