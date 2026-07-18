// SPDX-License-Identifier: MIT
pragma solidity ^0.8.22;

import "@openzeppelin/contracts/access/AccessControl.sol";
import "@openzeppelin/contracts/utils/Pausable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "../interfaces/IProviderStaking.sol";

/**
 * @title ProviderStaking
 * @notice Stake + slash for XFuel Verified Inference providers (Phase 4, T3b economics).
 * @dev Providers stake an ERC-20 (USDC on Base). The spot-check orchestrator / governance holds
 *      SLASHER_ROLE and slashes on a failed check; slashed funds go to the treasury and the
 *      provider's reputation (slashCount) is bumped. Unstaking has a cooldown (unbonding) so a
 *      provider can't withdraw ahead of a pending dispute; SLASHER_ROLE can also freeze
 *      withdrawals while a dispute is open. See docs/VERIFIED_INFERENCE_TIERS.md.
 */
contract ProviderStaking is IProviderStaking, AccessControl, Pausable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    bytes32 public constant OPERATOR_ROLE = keccak256("OPERATOR_ROLE");
    bytes32 public constant SLASHER_ROLE = keccak256("SLASHER_ROLE");

    IERC20 public immutable stakeToken;
    address public treasury;
    uint256 public minStake;
    uint256 public unbondingPeriod;

    struct Unbonding {
        uint256 amount;
        uint256 unlockAt;
    }

    mapping(address => uint256) private _active;
    mapping(address => Unbonding) private _pending;
    mapping(address => bool) public frozen;
    mapping(address => uint256) public override slashCount;

    uint256 public totalActiveStake;

    error ZeroAddress();
    error ZeroAmount();
    error InsufficientActiveStake(uint256 have, uint256 want);
    error InsufficientStakeToSlash(uint256 have, uint256 want);
    error NothingToWithdraw();
    error StillUnbonding(uint256 unlockAt);
    error ProviderIsFrozen();

    constructor(
        address admin,
        address stakeToken_,
        address treasury_,
        uint256 minStake_,
        uint256 unbondingPeriod_
    ) {
        if (admin == address(0) || stakeToken_ == address(0) || treasury_ == address(0)) revert ZeroAddress();
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
        _grantRole(OPERATOR_ROLE, admin);
        _grantRole(SLASHER_ROLE, admin);
        stakeToken = IERC20(stakeToken_);
        treasury = treasury_;
        minStake = minStake_;
        unbondingPeriod = unbondingPeriod_;
        emit ParamsUpdated(minStake_, unbondingPeriod_, treasury_);
    }

    // ── Provider actions ──────────────────────────────────────────────────────

    function stake(uint256 amount) external override whenNotPaused nonReentrant {
        if (amount == 0) revert ZeroAmount();
        stakeToken.safeTransferFrom(msg.sender, address(this), amount);
        _active[msg.sender] += amount;
        totalActiveStake += amount;
        emit Staked(msg.sender, amount, _active[msg.sender]);
    }

    function requestUnstake(uint256 amount) external override whenNotPaused nonReentrant {
        if (amount == 0) revert ZeroAmount();
        uint256 have = _active[msg.sender];
        if (amount > have) revert InsufficientActiveStake(have, amount);
        if (frozen[msg.sender]) revert ProviderIsFrozen();

        _active[msg.sender] = have - amount;
        totalActiveStake -= amount;

        Unbonding storage u = _pending[msg.sender];
        u.amount += amount;
        u.unlockAt = block.timestamp + unbondingPeriod; // resets cooldown for the whole pending bucket
        emit UnstakeRequested(msg.sender, amount, u.unlockAt);
    }

    function withdraw() external override nonReentrant {
        if (frozen[msg.sender]) revert ProviderIsFrozen();
        Unbonding storage u = _pending[msg.sender];
        uint256 amount = u.amount;
        if (amount == 0) revert NothingToWithdraw();
        if (block.timestamp < u.unlockAt) revert StillUnbonding(u.unlockAt);

        u.amount = 0;
        u.unlockAt = 0;
        stakeToken.safeTransfer(msg.sender, amount);
        emit Withdrawn(msg.sender, amount);
    }

    // ── Slashing / dispute controls (SLASHER_ROLE) ────────────────────────────

    function slash(address provider, uint256 amount, bytes32 taskIdHash, string calldata reason)
        external
        override
        onlyRole(SLASHER_ROLE)
        nonReentrant
    {
        if (amount == 0) revert ZeroAmount();
        uint256 active = _active[provider];
        uint256 pending = _pending[provider].amount;
        if (amount > active + pending) revert InsufficientStakeToSlash(active + pending, amount);

        // Slash active first, then dip into the unbonding bucket.
        uint256 fromActive = amount > active ? active : amount;
        if (fromActive > 0) {
            _active[provider] = active - fromActive;
            totalActiveStake -= fromActive;
        }
        uint256 remainder = amount - fromActive;
        if (remainder > 0) {
            _pending[provider].amount = pending - remainder;
        }

        slashCount[provider] += 1;
        stakeToken.safeTransfer(treasury, amount);
        emit ProviderSlashed(provider, amount, taskIdHash, reason);
    }

    function setFrozen(address provider, bool frozen_) external override onlyRole(SLASHER_ROLE) {
        frozen[provider] = frozen_;
        emit ProviderFrozen(provider, frozen_);
    }

    // ── Admin params (OPERATOR_ROLE) ──────────────────────────────────────────

    function setParams(uint256 minStake_, uint256 unbondingPeriod_, address treasury_) external onlyRole(OPERATOR_ROLE) {
        if (treasury_ == address(0)) revert ZeroAddress();
        minStake = minStake_;
        unbondingPeriod = unbondingPeriod_;
        treasury = treasury_;
        emit ParamsUpdated(minStake_, unbondingPeriod_, treasury_);
    }

    function pause() external onlyRole(OPERATOR_ROLE) {
        _pause();
    }

    function unpause() external onlyRole(OPERATOR_ROLE) {
        _unpause();
    }

    // ── Views ─────────────────────────────────────────────────────────────────

    function stakeOf(address provider) external view override returns (uint256) {
        return _active[provider];
    }

    function pendingOf(address provider) external view override returns (uint256 amount, uint256 unlockAt) {
        Unbonding storage u = _pending[provider];
        return (u.amount, u.unlockAt);
    }

    function isActiveProvider(address provider) external view override returns (bool) {
        return !frozen[provider] && _active[provider] >= minStake && minStake > 0;
    }
}
