// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {ChitAnchor} from "chit-simple/ChitAnchor.sol";

/// @notice Base Sepolia deploy for the owner. This file holds no key and no RPC URL.
///         Broadcast uses an encrypted Foundry keystore (`--account <name>`) or
///         `--ledger`. Use a dedicated testnet deployer key.
///
///         Run from deploy/chit-simple/sepolia-pack. The sources are
///         contracts/chit-simple in this repo.
///         forge script DeployChitAnchor.s.sol:DeployChitAnchor \
///           --rpc-url <base-sepolia-rpc> --account <name> --broadcast
///
///         Set CHIT_ANCHOR_CHECKPOINT and CHIT_ANCHOR_CONTROLLER first.
///         The script passes GROWTH (1000000), ChitAnchor.DEFAULT_MAX_GROWTH.
///         That value is part of the runtime code hash.
///         The controller is a Safe (threshold 2, three owners) whose
///         singleton is SafeL2 1.4.1. The owner creates that Safe outside
///         this repo. Chain id must be 84532. Without --broadcast nothing
///         is sent. Every key change waits 24 hours on the controller.
///         Losing 2 of the 3 controller keys means a successor contract.
interface DeployVm {
    function envAddress(string calldata name) external view returns (address);
    function startBroadcast() external;
    function stopBroadcast() external;
    function chainId(uint256) external;
    function setNonce(address account, uint64 newNonce) external;
    function prank(address) external;
    function computeCreateAddress(address deployer, uint256 nonce) external pure returns (address);
}

contract DeployChitAnchor {
    DeployVm internal constant vm = DeployVm(address(uint160(uint256(keccak256("hevm cheat code")))));

    /// @dev Code-hash preview only. Runtime bytecode does not embed this address.
    address internal constant PREVIEW_CONTROLLER = 0x4444444444444444444444444444444444444444;

    /// @dev Equal to ChitAnchor.DEFAULT_MAX_GROWTH. The runtime hash embeds it.
    uint64 internal constant GROWTH = 1_000_000;

    /// @notice Read-only. Prints nothing itself; the caller reads the return values.
    ///         Sets chain id 84532 locally and does not broadcast. The preview
    ///         controller is PREVIEW_CONTROLLER because the code hash does not
    ///         depend on either constructor address.
    function preview(address deployer, uint256 nonce, address checkpoint_)
        external
        returns (address predicted, bytes32 codeHash)
    {
        require(deployer != address(0) && checkpoint_ != address(0), "address");
        require(checkpoint_ != PREVIEW_CONTROLLER, "controller");
        vm.chainId(84532);
        vm.setNonce(deployer, uint64(nonce));
        predicted = vm.computeCreateAddress(deployer, nonce);
        vm.prank(deployer);
        ChitAnchor deployed = new ChitAnchor(checkpoint_, PREVIEW_CONTROLLER, GROWTH);
        require(address(deployed) == predicted, "create");
        codeHash = keccak256(address(deployed).code);
    }

    /// @notice Broadcast path. After it lands, run the read-only check:
    ///         BASE_SEPOLIA_RPC_URL=... CHIT_ANCHOR_CHECKPOINT=... CHIT_ANCHOR_CONTROLLER=... CHIT_ANCHOR_TX=...
    ///         node check-deploy.mjs <deployed-address>
    function run() external returns (ChitAnchor deployed) {
        require(block.chainid == 84532, "Base Sepolia only");
        address checkpoint_ = vm.envAddress("CHIT_ANCHOR_CHECKPOINT");
        address controller_ = vm.envAddress("CHIT_ANCHOR_CONTROLLER");
        require(checkpoint_ != address(0) && controller_ != address(0), "address");
        require(controller_ != checkpoint_, "controller");
        vm.startBroadcast();
        deployed = new ChitAnchor(checkpoint_, controller_, GROWTH);
        vm.stopBroadcast();
    }
}
