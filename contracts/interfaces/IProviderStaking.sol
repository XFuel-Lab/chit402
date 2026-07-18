// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/**
 * @title IProviderStaking
 * @notice Staking + slashing for XFuel Verified Inference providers (Phase 4, T3b economics).
 * @dev Providers stake an ERC-20 (USDC on Base). A failed spot-check lets a SLASHER_ROLE slash
 *      the stake and ding reputation; unstaking has a cooldown so a provider can't exit ahead of
 *      a pending dispute. See docs/VERIFIED_INFERENCE_TIERS.md.
 */
interface IProviderStaking {
    event Staked(address indexed provider, uint256 amount, uint256 newActiveStake);
    event UnstakeRequested(address indexed provider, uint256 amount, uint256 unlockAt);
    event Withdrawn(address indexed provider, uint256 amount);
    event ProviderSlashed(address indexed provider, uint256 amount, bytes32 indexed taskIdHash, string reason);
    event ProviderFrozen(address indexed provider, bool frozen);
    event ParamsUpdated(uint256 minStake, uint256 unbondingPeriod, address treasury);

    /// @notice Stake `amount` (pulled via transferFrom; caller must approve first).
    function stake(uint256 amount) external;

    /// @notice Begin unbonding `amount` from active stake; withdrawable after the cooldown.
    function requestUnstake(uint256 amount) external;

    /// @notice Withdraw matured unbonding funds (after cooldown, unless frozen).
    function withdraw() external;

    /// @notice Slash `amount` from a provider (active first, then unbonding) → treasury.
    function slash(address provider, uint256 amount, bytes32 taskIdHash, string calldata reason) external;

    /// @notice Freeze/unfreeze a provider's withdrawals during a dispute.
    function setFrozen(address provider, bool frozen) external;

    /// @notice Active (slashable, counts for provider status) stake.
    function stakeOf(address provider) external view returns (uint256);

    /// @notice Amount currently unbonding and its unlock timestamp.
    function pendingOf(address provider) external view returns (uint256 amount, uint256 unlockAt);

    /// @notice True when a provider meets minStake and isn't frozen.
    function isActiveProvider(address provider) external view returns (bool);

    /// @notice How many times a provider has been slashed (reputation signal).
    function slashCount(address provider) external view returns (uint256);
}
