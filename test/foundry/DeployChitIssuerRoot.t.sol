// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {ChitIssuerRoot} from "../../contracts/registry/ChitIssuerRoot.sol";
import {DeployChitIssuerRoot} from "../../script/DeployChitIssuerRoot.s.sol";
import {GuardianDeploy} from "./GuardianDeploy.sol";

/// @dev The dry run built standby notBefore as simulatedTimestamp + 24h.
///      The mined block was ~56s later, and commit reverted ActivationTooSoon.
contract DeployChitIssuerRootTest is Test {
    uint256 internal constant SIMULATED = 1_791_283_406;
    /// @dev Observed gap between the script simulation and the mined block.
    uint256 internal constant MINED_LATER = 56;

    DeployChitIssuerRoot internal script;
    ChitIssuerRoot internal root;

    function setUp() public {
        vm.warp(SIMULATED);
        vm.roll(10);
        script = new DeployChitIssuerRoot();
        root = GuardianDeploy.deploy(address(this), keccak256("genesis"), 1_700_000_000);
    }

    function test_preflightRevertsWhenMinedTimestampPassesSimulation() public {
        assertEq(script.standbyCushion(), script.DEFAULT_STANDBY_CUSHION());
        assertEq(script.DEFAULT_STANDBY_CUSHION(), 1 hours);

        uint64 bare = script.standbyNotBefore(SIMULATED, 0);
        assertEq(bare, uint64(SIMULATED + root.ACTIVATION_DELAY()));
        assertEq(root.ACTIVATION_DELAY(), 24 hours);
        uint64 cushioned = script.standbyNotBefore(SIMULATED, script.DEFAULT_STANDBY_CUSHION());
        assertEq(cushioned, uint64(SIMULATED + 24 hours + 1 hours));

        bytes memory bareData = _data(bare);
        bytes memory cushionedData = _data(cushioned);

        // Mined block is later than the simulation. No cushion: the eth_call
        // reverts and the commit is not applied.
        vm.warp(SIMULATED + MINED_LATER);
        vm.expectRevert(
            abi.encodeWithSelector(
                DeployChitIssuerRoot.PreflightRevert.selector,
                abi.encodeWithSelector(ChitIssuerRoot.ActivationTooSoon.selector, bare, block.timestamp + 24 hours)
            )
        );
        script.preflightGenesis(address(this), address(root), bareData);
        assertEq(root.rootSeq(), 0);

        // The default one-hour cushion still clears a 56s mining delay.
        // The preflight rolls its own state back, so rootSeq stays 0.
        script.preflightGenesis(address(this), address(root), cushionedData);
        assertEq(root.rootSeq(), 0);

        // A mine past the cushion fails the preflight. Nothing is committed.
        vm.warp(SIMULATED + 1 hours + 1);
        vm.expectRevert(
            abi.encodeWithSelector(
                DeployChitIssuerRoot.PreflightRevert.selector,
                abi.encodeWithSelector(
                    ChitIssuerRoot.ActivationTooSoon.selector, cushioned, block.timestamp + 24 hours
                )
            )
        );
        script.preflightGenesis(address(this), address(root), cushionedData);
        assertEq(root.rootSeq(), 0);

        // Inside the cushion, the commit the script would broadcast succeeds.
        vm.warp(SIMULATED + MINED_LATER);
        (bool ok,) = address(root).call(cushionedData);
        assertTrue(ok);
        assertEq(root.rootSeq(), 1);
        (uint8 status,, uint64 notBefore,,,) = root.keys(keccak256("standby"));
        assertEq(status, 1);
        assertEq(notBefore, cushioned);
    }

    function isOwner(address) external pure returns (bool) {
        return false;
    }

    function _data(uint64 notBefore) internal view returns (bytes memory) {
        return script.genesisCommitData(
            keccak256("standby"), keccak256("universe"), bytes32(0), 0, 1, keccak256("hist"), notBefore
        );
    }
}
