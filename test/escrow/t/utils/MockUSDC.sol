// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

/// @dev Test token with 6 decimals and FiatToken-like knobs: a blacklist that
///      makes transfers to or from a listed address revert, a fee-on-transfer
///      mode, and a hook that calls back into a target during transfers.
contract MockUSDC is ERC20 {
    mapping(address => bool) public blacklisted;
    uint256 public feeBps;
    address public hookTarget;
    bytes public hookData;
    bool private _inHook;

    constructor() ERC20("USD Coin", "USDC") {}

    function decimals() public pure override returns (uint8) {
        return 6;
    }

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }

    function setBlacklisted(address who, bool v) external {
        blacklisted[who] = v;
    }

    function setFeeBps(uint256 bps) external {
        feeBps = bps;
    }

    function setHook(address target, bytes calldata data) external {
        hookTarget = target;
        hookData = data;
    }

    function _update(address from, address to, uint256 value) internal override {
        require(!blacklisted[from] && !blacklisted[to], "Blacklistable: account is blacklisted");
        if (feeBps != 0 && from != address(0) && to != address(0)) {
            uint256 fee = (value * feeBps) / 10_000;
            super._update(from, address(0xFEE), fee);
            value -= fee;
        }
        super._update(from, to, value);
        if (hookTarget != address(0) && !_inHook && from != address(0)) {
            _inHook = true;
            (bool ok, bytes memory ret) = hookTarget.call(hookData);
            _inHook = false;
            if (!ok) {
                assembly {
                    revert(add(ret, 0x20), mload(ret))
                }
            }
        }
    }
}

/// @dev 18-decimal token for the constructor decimals check.
contract Mock18 is ERC20 {
    constructor() ERC20("Other", "OTH") {}
}
