// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/access/AccessControl.sol";
import "@openzeppelin/contracts/utils/Pausable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

/**
 * @title BelieverRound
 * @author XFuel Protocol
 * @notice Community contribution round: cliff + linear vesting, optional lock bonuses, on-chain XF ceiling.
 *
 * Tokenomics (see WHITEPAPER §10):
 *   - Community Contribution bucket: up to 150,000,000 XF (15% of 1B) — enforced by `xfAllocationCap`.
 *   - Single open round (no phased tranches); `phase` is retained for ABI/deploy compatibility (use 1).
 *   - XF per TFUEL (`tokenPriceNumerator` / `tokenPriceDenominator`) may be updated while status is Open
 *     via `setTokenPrice` (e.g. multisig adjusts from TFUEL/USD reference — see docs/PRICING_TFUEL_XF.md).
 *
 * Vesting (all tiers):
 *   - 3-month cliff — no claims
 *   - 9-month linear vesting after cliff — 12 months from TGE to full unlock by schedule
 *
 * Optional lock tiers (chosen on first commit; additional commits must match):
 *   - Tier 0: base allocation, claims allowed after cliff (per vesting schedule)
 *   - Tier 1: +8% XF,  earliest claim after 365 days from TGE
 *   - Tier 2: +20% XF, earliest claim after 730 days from TGE
 *   - Tier 3: +35% XF, earliest claim after 1095 days from TGE
 *
 * Refund: if TGE not triggered within 180 days of round open, full TFUEL refund.
 */
contract BelieverRound is AccessControl, Pausable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    bytes32 public constant OPERATOR_ROLE = keccak256("OPERATOR_ROLE");

    uint256 public maxCommitmentPerWallet;
    uint256 public constant MIN_COMMITMENT = 100 ether;
    uint256 public hardCap;
    uint256 public tokenPriceNumerator;
    uint256 public tokenPriceDenominator;
    uint8 public phase;

    /// @notice Hard ceiling on sum of XF reserved across all commitments (in XF wei). Typically 150M * 10**18.
    uint256 public immutable xfAllocationCap;

    uint256 public constant CLIFF_DURATION = 90 days;
    /// @notice Linear vesting length after cliff (9 months).
    uint256 public constant VESTING_DURATION = 270 days;
    uint256 public constant REFUND_DEADLINE = 180 days;

    enum RoundStatus {
        Open,
        Closed,
        TGETriggered,
        Refunding
    }
    RoundStatus public status;

    IERC20 public xfToken;
    uint256 public roundOpenedAt;
    uint256 public roundClosedAt;
    uint256 public tgeTimestamp;
    uint256 public totalCommitted;
    uint256 public totalBelievers;
    /// @notice Sum of XF reserved for all commitments (includes lock bonuses). Used at TGE.
    uint256 public totalXFReserved;
    uint256 public totalTokensAllocated;
    uint256 public totalTokensClaimed;

    struct Commitment {
        uint256 amount;
        uint256 tokenAllocation;
        uint256 tokensClaimed;
        uint64 committedAt;
        uint8 lockTier;
        bool refunded;
    }

    mapping(address => Commitment) public commitments;

    event RoundOpened(uint256 hardCap, uint256 maxPerWallet, uint8 phase, uint256 timestamp);
    event Committed(address indexed believer, uint256 amount, uint256 totalCommitted, uint8 lockTier);
    event RoundClosed(uint256 totalRaised, uint256 totalBelievers, uint256 timestamp);
    event TGETriggered(address xfToken, uint256 totalTokens, uint256 timestamp);
    event TokensClaimed(address indexed believer, uint256 amount, uint256 totalClaimed);
    event Refunded(address indexed believer, uint256 amount);
    event FundsWithdrawn(address indexed to, uint256 amount);
    event TokenPriceUpdated(uint256 numerator, uint256 denominator);

    error RoundNotOpen();
    error RoundNotClosed();
    error TGENotTriggered();
    error AlreadyRefunded();
    error NothingToClaim();
    error ExceedsWalletCap();
    error ExceedsHardCap();
    error BelowMinimum();
    error TGEAlreadyTriggered();
    error RefundDeadlineNotReached();
    error NoCommitment();
    error BadLockTier();
    error LockTierMismatch();
    error LockPeriodActive();
    error ExceedsXFAllocationCap();
    error PriceUpdateNotAllowed();

    constructor(
        address _admin,
        uint256 _hardCap,
        uint256 _maxPerWallet,
        uint256 _priceNumerator,
        uint256 _priceDenominator,
        uint8 _phase,
        uint256 _xfAllocationCap
    ) {
        require(_admin != address(0), "ZeroAdmin");
        require(_hardCap > 0, "ZeroHardCap");
        require(_maxPerWallet == 0 || _maxPerWallet <= _hardCap, "BadWalletCap");
        require(_priceNumerator > 0 && _priceDenominator > 0, "BadPrice");
        require(_phase >= 1 && _phase <= 3, "BadPhase");
        require(_xfAllocationCap > 0, "ZeroXFCap");

        hardCap = _hardCap;
        maxCommitmentPerWallet = _maxPerWallet;
        tokenPriceNumerator = _priceNumerator;
        tokenPriceDenominator = _priceDenominator;
        phase = _phase;
        xfAllocationCap = _xfAllocationCap;

        _grantRole(DEFAULT_ADMIN_ROLE, _admin);
        _grantRole(OPERATOR_ROLE, _admin);

        status = RoundStatus.Open;
        roundOpenedAt = block.timestamp;

        emit RoundOpened(_hardCap, _maxPerWallet, _phase, block.timestamp);
    }

    /// @notice Updates XF per 1e18 TFUEL while the round is Open (e.g. after off-chain TFUEL/USD observation).
    function setTokenPrice(uint256 newNumerator, uint256 newDenominator) external onlyRole(DEFAULT_ADMIN_ROLE) {
        if (status != RoundStatus.Open) revert PriceUpdateNotAllowed();
        require(newNumerator > 0 && newDenominator > 0, "BadPrice");
        tokenPriceNumerator = newNumerator;
        tokenPriceDenominator = newDenominator;
        emit TokenPriceUpdated(newNumerator, newDenominator);
    }

    function commit() external payable nonReentrant whenNotPaused {
        _commit(msg.value, 0);
    }

    /// @param lockTier 0 = base; 1 = +8% / 1y lock; 2 = +20% / 2y lock; 3 = +35% / 3y lock
    function commitWithLock(uint8 lockTier) external payable nonReentrant whenNotPaused {
        _commit(msg.value, lockTier);
    }

    function _commit(uint256 value, uint8 lockTier) internal {
        if (status != RoundStatus.Open) revert RoundNotOpen();
        if (value < MIN_COMMITMENT) revert BelowMinimum();

        Commitment storage c = commitments[msg.sender];

        if (c.amount > 0) {
            if (lockTier != c.lockTier) revert LockTierMismatch();
        }

        uint8 tier = c.amount == 0 ? lockTier : c.lockTier;

        if (maxCommitmentPerWallet > 0 && c.amount + value > maxCommitmentPerWallet) revert ExceedsWalletCap();
        if (totalCommitted + value > hardCap) revert ExceedsHardCap();

        uint256 xfDelta = _xfForAmount(value, tier);
        if (totalXFReserved + xfDelta > xfAllocationCap) revert ExceedsXFAllocationCap();
        totalXFReserved += xfDelta;

        if (c.amount == 0) {
            totalBelievers++;
            c.committedAt = uint64(block.timestamp);
            c.lockTier = lockTier;
        }

        c.amount += value;
        totalCommitted += value;

        emit Committed(msg.sender, value, totalCommitted, tier);
    }

    function closeRound() external onlyRole(OPERATOR_ROLE) {
        if (status != RoundStatus.Open) revert RoundNotOpen();
        status = RoundStatus.Closed;
        roundClosedAt = block.timestamp;
        emit RoundClosed(totalCommitted, totalBelievers, block.timestamp);
    }

    function triggerTGE(address _xfToken) external onlyRole(DEFAULT_ADMIN_ROLE) {
        if (status != RoundStatus.Closed) revert RoundNotClosed();
        if (address(xfToken) != address(0)) revert TGEAlreadyTriggered();
        require(_xfToken != address(0), "ZeroToken");

        xfToken = IERC20(_xfToken);
        tgeTimestamp = block.timestamp;
        status = RoundStatus.TGETriggered;

        totalTokensAllocated = totalXFReserved;

        xfToken.safeTransferFrom(msg.sender, address(this), totalTokensAllocated);

        emit TGETriggered(_xfToken, totalTokensAllocated, block.timestamp);
    }

    function claim() external nonReentrant {
        if (status != RoundStatus.TGETriggered) revert TGENotTriggered();

        Commitment storage c = commitments[msg.sender];
        if (c.amount == 0) revert NoCommitment();
        if (block.timestamp < _lockEnd(c)) revert LockPeriodActive();

        if (c.tokenAllocation == 0) {
            c.tokenAllocation = _xfForAmount(c.amount, c.lockTier);
        }

        uint256 vested = _vestedAmount(c);
        uint256 unlocked = vested - c.tokensClaimed;
        if (unlocked == 0) revert NothingToClaim();

        c.tokensClaimed += unlocked;
        totalTokensClaimed += unlocked;

        xfToken.safeTransfer(msg.sender, unlocked);

        emit TokensClaimed(msg.sender, unlocked, c.tokensClaimed);
    }

    function _vestedAmount(Commitment memory c) internal view returns (uint256) {
        uint256 elapsed = block.timestamp - tgeTimestamp;

        if (elapsed < CLIFF_DURATION) return 0;

        uint256 vestingElapsed = elapsed - CLIFF_DURATION;
        uint256 alloc = c.tokenAllocation;
        if (vestingElapsed >= VESTING_DURATION) return alloc;

        return (alloc * vestingElapsed) / VESTING_DURATION;
    }

    function _lockEnd(Commitment memory c) internal view returns (uint256) {
        uint256 t = tgeTimestamp;
        if (c.lockTier == 0) return t + CLIFF_DURATION;
        if (c.lockTier == 1) return t + 365 days;
        if (c.lockTier == 2) return t + 730 days;
        return t + 1095 days;
    }

    function _bonusBps(uint8 tier) internal pure returns (uint256 bps) {
        if (tier == 0) return 10_000;
        if (tier == 1) return 10_800;
        if (tier == 2) return 12_000;
        if (tier == 3) return 13_500;
        revert BadLockTier();
    }

    function bonusBps(uint8 tier) external pure returns (uint256) {
        return _bonusBps(tier);
    }

    function _xfForAmount(uint256 amountWei, uint8 tier) internal view returns (uint256) {
        uint256 bps = _bonusBps(tier);
        return (amountWei * tokenPriceNumerator * bps) / (tokenPriceDenominator * 10_000);
    }

    function requestRefund() external nonReentrant {
        if (status == RoundStatus.TGETriggered) revert TGEAlreadyTriggered();
        if (block.timestamp < roundOpenedAt + REFUND_DEADLINE) revert RefundDeadlineNotReached();

        Commitment storage c = commitments[msg.sender];
        if (c.amount == 0) revert NoCommitment();
        if (c.refunded) revert AlreadyRefunded();

        uint256 refundAmount = c.amount;
        uint256 xfPart = _xfForAmount(refundAmount, c.lockTier);

        totalCommitted -= refundAmount;
        totalXFReserved -= xfPart;

        c.refunded = true;
        c.amount = 0;

        (bool ok, ) = payable(msg.sender).call{value: refundAmount}("");
        require(ok, "RefundFailed");

        emit Refunded(msg.sender, refundAmount);
    }

    function withdrawFunds(address to) external onlyRole(DEFAULT_ADMIN_ROLE) {
        if (status != RoundStatus.TGETriggered) revert TGENotTriggered();
        uint256 bal = address(this).balance;
        require(bal > 0, "NoFunds");
        (bool ok, ) = payable(to).call{value: bal}("");
        require(ok, "WithdrawFailed");
        emit FundsWithdrawn(to, bal);
    }

    function pause() external onlyRole(DEFAULT_ADMIN_ROLE) {
        _pause();
    }

    function unpause() external onlyRole(DEFAULT_ADMIN_ROLE) {
        _unpause();
    }

    function getCommitment(address believer) external view returns (Commitment memory) {
        return commitments[believer];
    }

    function claimable(address believer) external view returns (uint256) {
        if (status != RoundStatus.TGETriggered) return 0;
        Commitment memory c = commitments[believer];
        if (c.amount == 0) return 0;
        if (block.timestamp < _lockEnd(c)) return 0;

        if (c.tokenAllocation == 0) {
            c.tokenAllocation = _xfForAmount(c.amount, c.lockTier);
        }
        uint256 vested = _vestedAmount(c);
        return vested > c.tokensClaimed ? vested - c.tokensClaimed : 0;
    }

    function getStats()
        external
        view
        returns (
            uint256 committed_,
            uint256 believers_,
            uint256 allocated_,
            uint256 claimed_,
            uint256 hardCap_,
            RoundStatus status_,
            uint8 phase_
        )
    {
        return (
            totalCommitted,
            totalBelievers,
            totalTokensAllocated,
            totalTokensClaimed,
            hardCap,
            status,
            phase
        );
    }

    receive() external payable {}
}
