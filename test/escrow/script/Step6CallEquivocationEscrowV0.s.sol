// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {EquivocationEscrowV0 as E} from "escrow/EquivocationEscrowV0.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

interface Vm6 {
    function envUint(string calldata name) external view returns (uint256);
    function envAddress(string calldata name) external view returns (address);
    function envBytes(string calldata name) external view returns (bytes memory);
    function startBroadcast(uint256 privateKey) external;
    function stopBroadcast() external;
}

/// @notice Sends ONE owner setup call to a deployed EquivocationEscrowV0 on Base Sepolia,
///         so the testnet step 6 paste never puts the key on a command line or on disk
///         (cast only takes a key as an argument, a prompt or a keystore file).
///
///         The paste builds the calldata with `cast calldata` and passes the key the same
///         way as the deploy script: ESCROW_DEPLOYER_PRIVATE_KEY on the forge line only.
///
///         STEP6_ESCROW  the deployed escrow
///         STEP6_TO      the escrow, or Circle Base Sepolia USDC for approve
///         STEP6_DATA    calldata: pinQuarantineList, fund or activate on the escrow,
///                       or approve(escrow, amount) on USDC. Nothing else is accepted.
contract Step6CallEquivocationEscrowV0 {
    Vm6 internal constant vm = Vm6(address(uint160(uint256(keccak256("hevm cheat code")))));
    address internal constant CIRCLE_USDC_BASE_SEPOLIA = 0x036CbD53842c5426634e7929541eC2318f3dCF7e;

    function run() external {
        require(block.chainid == 84532, "Base Sepolia only");
        address escrow = vm.envAddress("STEP6_ESCROW");
        address to = vm.envAddress("STEP6_TO");
        bytes memory data = vm.envBytes("STEP6_DATA");
        require(data.length >= 4, "no selector");
        bytes4 sel;
        assembly {
            sel := mload(add(data, 32))
        }
        if (to == CIRCLE_USDC_BASE_SEPOLIA) {
            require(sel == IERC20.approve.selector && data.length == 68, "only approve on USDC");
            address spender;
            assembly {
                spender := mload(add(data, 36))
            }
            require(spender == escrow, "approve spender is not the escrow");
        } else {
            require(to == escrow, "target is not the escrow");
            require(
                sel == E.pinQuarantineList.selector || sel == E.fund.selector || sel == E.activate.selector,
                "only pinQuarantineList, fund or activate"
            );
        }
        vm.startBroadcast(vm.envUint("ESCROW_DEPLOYER_PRIVATE_KEY"));
        (bool ok,) = to.call(data);
        require(ok, "call reverted");
        vm.stopBroadcast();
    }
}
