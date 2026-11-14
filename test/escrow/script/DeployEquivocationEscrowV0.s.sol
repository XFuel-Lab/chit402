// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Vm} from "../t/utils/Test.sol";
import {EquivocationEscrowV0 as E} from "escrow/EquivocationEscrowV0.sol";

/// @notice Deploy script for EquivocationEscrowV0 on Base Sepolia. Written for
///         the deploy step (step 8 of the deploy order); it has not been run.
///         Running it needs an explicit yes for the deploy and its testnet gas.
///
///         Every input comes from the environment. Nothing is hard-coded except
///         the chain and the Circle Base Sepolia USDC address, which the
///         constructor and the F1 fork test check.
///
///         forge script script/DeployEquivocationEscrowV0.s.sol --rpc-url <base sepolia> --broadcast
///
///         ESCROW_DEPLOYER_PRIVATE_KEY  deployer key (testnet gas only)
///         ESCROW_OWNER                 immutable owner address
///         ESCROW_KID                   32-byte RFC 7638 thumbprint (0x...)
///         ESCROW_PUB_X, ESCROW_PUB_Y   issuer P-256 public key
///         ESCROW_LOG_SALT              EIP-712 domain salt (log id)
///         ESCROW_LIVE_EPOCH, ESCROW_LIVE_TREE_SIZE, ESCROW_LIVE_ROOT,
///         ESCROW_LIVE_PUBLISHED_AT, ESCROW_LIVE_R, ESCROW_LIVE_S
///                                      one genuine fixed head and its signature
///         ESCROW_MIN_BOND              bond needed to activate, 6 decimals (10000000 = 10 USDC
///                                      is the lowest Base Sepolia allows; see minBondAllowed)
contract DeployEquivocationEscrowV0 {
    Vm internal constant vm = Vm(address(uint160(uint256(keccak256("hevm cheat code")))));
    address internal constant CIRCLE_USDC_BASE_SEPOLIA = 0x036CbD53842c5426634e7929541eC2318f3dCF7e;

    function run() external returns (E escrow) {
        require(block.chainid == 84532, "Base Sepolia only");
        E.TreeHead memory live = E.TreeHead({
            epoch: uint32(vm.envUint("ESCROW_LIVE_EPOCH")),
            treeSize: uint64(vm.envUint("ESCROW_LIVE_TREE_SIZE")),
            root: vm.envBytes32("ESCROW_LIVE_ROOT"),
            publishedAt: uint64(vm.envUint("ESCROW_LIVE_PUBLISHED_AT")),
            kid: vm.envBytes32("ESCROW_KID")
        });
        E.Sig memory sig = E.Sig({r: vm.envBytes32("ESCROW_LIVE_R"), s: vm.envBytes32("ESCROW_LIVE_S")});
        address owner = vm.envAddress("ESCROW_OWNER");
        bytes32 kid = vm.envBytes32("ESCROW_KID");
        bytes32 x = vm.envBytes32("ESCROW_PUB_X");
        bytes32 y = vm.envBytes32("ESCROW_PUB_Y");
        bytes32 salt = vm.envBytes32("ESCROW_LOG_SALT");
        uint256 minBond = vm.envUint("ESCROW_MIN_BOND");

        vm.startBroadcast(vm.envUint("ESCROW_DEPLOYER_PRIVATE_KEY"));
        escrow = new E(owner, CIRCLE_USDC_BASE_SEPOLIA, kid, x, y, salt, live, sig, minBond);
        vm.stopBroadcast();
    }
}
