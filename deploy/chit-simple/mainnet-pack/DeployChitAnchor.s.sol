// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {ChitAnchor} from "chit-simple/ChitAnchor.sol";

/// @notice Chain 8453 code-hash preview. This script does not broadcast and
///         holds no key. The runtime hash embeds chain id and the CREATE address.
interface DeployVm {
    function chainId(uint256) external;
    function setNonce(address account, uint64 newNonce) external;
    function prank(address) external;
    function computeCreateAddress(address deployer, uint256 nonce) external pure returns (address);
}

contract DeployChitAnchor {
    DeployVm internal constant vm = DeployVm(address(uint160(uint256(keccak256("hevm cheat code")))));

    address internal constant PREVIEW_CONTROLLER = 0x4444444444444444444444444444444444444444;
    uint64 internal constant GROWTH = 1_000_000;

    /// @notice Sets chain id 8453 locally and does not broadcast.
    function preview(address deployer, uint256 nonce, address checkpoint_)
        external
        returns (address predicted, bytes32 codeHash)
    {
        require(deployer != address(0) && checkpoint_ != address(0), "address");
        require(checkpoint_ != PREVIEW_CONTROLLER, "controller");
        vm.chainId(8453);
        vm.setNonce(deployer, uint64(nonce));
        predicted = vm.computeCreateAddress(deployer, nonce);
        vm.prank(deployer);
        ChitAnchor deployed = new ChitAnchor(checkpoint_, PREVIEW_CONTROLLER, GROWTH);
        require(address(deployed) == predicted, "create");
        codeHash = keccak256(address(deployed).code);
    }
}
