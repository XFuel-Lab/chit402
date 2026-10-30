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
///         Set CHIT_ANCHOR_CHECKPOINT to the checkpoint address first.
///         Chain id must be 84532. Without --broadcast nothing is sent.
///
///         In v0 on Base Sepolia, rotateCheckpointKey is authorized by the
///         checkpoint key alone, so a rotation is not a trust event. The
///         2-of-3 secp256k1 controller path is required before any mainnet deploy.
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

    /// @notice Read-only. Prints nothing itself; the caller reads the return values.
    ///         Sets chain id 84532 locally and does not broadcast.
    function preview(address deployer, uint256 nonce, address checkpoint_)
        external
        returns (address predicted, bytes32 codeHash)
    {
        require(deployer != address(0) && checkpoint_ != address(0), "address");
        vm.chainId(84532);
        vm.setNonce(deployer, uint64(nonce));
        predicted = vm.computeCreateAddress(deployer, nonce);
        vm.prank(deployer);
        ChitAnchor deployed = new ChitAnchor(checkpoint_);
        require(address(deployed) == predicted, "create");
        codeHash = keccak256(address(deployed).code);
    }

    /// @notice Broadcast path. After it lands, run the read-only check:
    ///         BASE_SEPOLIA_RPC_URL=... CHIT_ANCHOR_CHECKPOINT=... CHIT_ANCHOR_TX=...
    ///         node check-deploy.mjs <deployed-address>
    function run() external returns (ChitAnchor deployed) {
        require(block.chainid == 84532, "Base Sepolia only");
        address checkpoint_ = vm.envAddress("CHIT_ANCHOR_CHECKPOINT");
        require(checkpoint_ != address(0), "checkpoint");
        vm.startBroadcast();
        deployed = new ChitAnchor(checkpoint_);
        vm.stopBroadcast();
    }
}
