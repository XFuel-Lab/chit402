// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {ChitAnchor} from "chit-simple/ChitAnchor.sol";

/// @notice Sepolia deploy for the owner. This file holds no key and no RPC URL.
///         Broadcast only with forge's --broadcast and the owner's own key:
///
///         Run from deploy/chit-simple/sepolia-pack:
///         forge script DeployChitAnchor.s.sol:DeployChitAnchor \
///           --rpc-url <base-sepolia-rpc> --private-key <testnet-key> --broadcast
///
///         Set CHIT_ANCHOR_CHECKPOINT to the checkpoint address first.
///         Chain id must be 84532. Without --broadcast nothing is sent.
interface DeployVm {
    function envAddress(string calldata name) external view returns (address);
    function startBroadcast() external;
    function stopBroadcast() external;
}

contract DeployChitAnchor {
    DeployVm internal constant vm = DeployVm(address(uint160(uint256(keccak256("hevm cheat code")))));

    function run() external returns (ChitAnchor deployed) {
        require(block.chainid == 84532, "base sepolia only");
        address checkpoint_ = vm.envAddress("CHIT_ANCHOR_CHECKPOINT");
        require(checkpoint_ != address(0), "checkpoint");
        vm.startBroadcast();
        deployed = new ChitAnchor(checkpoint_);
        vm.stopBroadcast();
    }
}
