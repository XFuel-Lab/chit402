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
 * @notice Community-first micro-commitment funding with cliff + linear vesting.
 *
 * Architecture:
 *   1. Commitment Phase  — Believers commit TFUEL/ETH within per-wallet caps.
 *   2. TGE Trigger       — Admin triggers Token Generation Event, deposits XF tokens.
 *   3. Cliff Period      — 3-month cliff; no claims allowed.
 *   4. Linear Vesting    — 12-month linear release (~8.33% per month).
 *   5. Claiming          — Believers claim unlocked tokens; excess returned.
 *   6. Refund Safety     — If TGE not triggered within deadline, full refund.
 *
 * Key parameters:
 *   - Min commitment: 0.01 ETH / TFUEL  (gas-cost protection)
 *   - Max commitment: configurable per-wallet cap (anti-whale)
 *   - Cliff: 90 days (3 months)
 *   - Vesting: 365 days (12 months) linear after cliff
 *   - Total vesting: 455 days (15 months)
 *   - Refund deadline: 180 days from round close (if no TGE)
 *
 * Per OpenZeppelin VestingWallet patterns:
 *   - Linear vesting: tokens released proportional to elapsed time.
 *   - SafeERC20 for safe token transfers.
 *   - Immutable vesting parameters (no admin override post-TGE).
 */
contract BelieverRound is AccessControl, Pausable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    bytes32 public constant OPERATOR_ROLE = keccak256("OPERATOR_ROLE");

    // ─── Round Parameters ─────────────────────────────────────────────
    uint256 public maxCommitmentPerWallet;    // Max native token per wallet
    uint256 public constant MIN_COMMITMENT = 0.01 ether;
    uint256 public hardCap;                    // Total raise hard cap
    uint256 public tokenPriceNumerator;        // XF tokens per 1 ETH (numerator)
    uint256 public tokenPriceDenominator;      // XF tokens per 1 ETH (denominator)

    // ─── Vesting Parameters ───────────────────────────────────────────
    uint256 public constant CLIFF_DURATION = 90 days;     // 3 months
    uint256 public constant VESTING_DURATION = 365 days;   // 12 months linear
    uint256 public constant REFUND_DEADLINE = 180 days;    // 6 months for TGE

    // ─── State ────────────────────────────────────────────────────────
    enum RoundStatus { Open, Closed, TGETriggered, Refunding }
    RoundStatus public status;

    IERC20 public xfToken;
    uint256 public roundOpenedAt;
    uint256 public roundClosedAt;
    uint256 public tgeTimestamp;
    uint256 public totalCommitted;
    uint256 public totalBelievers;
    uint256 public totalTokensAllocated;
    uint256 public totalTokensClaimed;

    struct Commitment {
        uint256 amount;          // Native token committed
        uint256 tokenAllocation; // XF tokens allocated at TGE
        uint256 tokensClaimed;   // XF tokens already claimed
        uint64  committedAt;
        bool    refunded;
    }

    mapping(address => Commitment) public commitments;

    // ─── Events ───────────────────────────────────────────────────────
    event RoundOpened(uint256 hardCap, uint256 maxPerWallet, uint256 timestamp);
    event Committed(address indexed believer, uint256 amount, uint256 totalCommitted);
    event RoundClosed(uint256 totalRaised, uint256 totalBelievers, uint256 timestamp);
    event TGETriggered(address xfToken, uint256 totalTokens, uint256 timestamp);
    event TokensClaimed(address indexed believer, uint256 amount, uint256 totalClaimed);
    event Refunded(address indexed believer, uint256 amount);
    event FundsWithdrawn(address indexed to, uint256 amount);

    // ─── Errors ───────────────────────────────────────────────────────
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

    constructor(
        address _admin,
        uint256 _hardCap,
        uint256 _maxPerWallet,
        uint256 _priceNumerator,
        uint256 _priceDenominator
    ) {
        require(_admin != address(0), "ZeroAdmin");
        require(_hardCap > 0, "ZeroHardCap");
        require(_maxPerWallet > 0 && _maxPerWallet <= _hardCap, "BadWalletCap");
        require(_priceNumerator > 0 && _priceDenominator > 0, "BadPrice");

        hardCap = _hardCap;
        maxCommitmentPerWallet = _maxPerWallet;
        tokenPriceNumerator = _priceNumerator;
        tokenPriceDenominator = _priceDenominator;

        _grantRole(DEFAULT_ADMIN_ROLE, _admin);
        _grantRole(OPERATOR_ROLE, _admin);

        status = RoundStatus.Open;
        roundOpenedAt = block.timestamp;

        emit RoundOpened(_hardCap, _maxPerWallet, block.timestamp);
    }

    // ═══════════════════════════════════════════════════════════════════
    //  1. COMMITMENT PHASE
    // ═══════════════════════════════════════════════════════════════════

    function commit() external payable nonReentrant whenNotPaused {
        if (status != RoundStatus.Open) revert RoundNotOpen();
        if (msg.value < MIN_COMMITMENT) revert BelowMinimum();

        Commitment storage c = commitments[msg.sender];
        if (c.amount + msg.value > maxCommitmentPerWallet) revert ExceedsWalletCap();
        if (totalCommitted + msg.value > hardCap) revert ExceedsHardCap();

        if (c.amount == 0) {
            totalBelievers++;
            c.committedAt = uint64(block.timestamp);
        }

        c.amount += msg.value;
        totalCommitted += msg.value;

        emit Committed(msg.sender, msg.value, totalCommitted);
    }

    // ═══════════════════════════════════════════════════════════════════
    //  2. ROUND MANAGEMENT
    // ═══════════════════════════════════════════════════════════════════

    function closeRound() external onlyRole(OPERATOR_ROLE) {
        if (status != RoundStatus.Open) revert RoundNotOpen();
        status = RoundStatus.Closed;
        roundClosedAt = block.timestamp;
        emit RoundClosed(totalCommitted, totalBelievers, block.timestamp);
    }

    // ═══════════════════════════════════════════════════════════════════
    //  3. TOKEN GENERATION EVENT (TGE)
    // ═══════════════════════════════════════════════════════════════════

    function triggerTGE(address _xfToken) external onlyRole(DEFAULT_ADMIN_ROLE) {
        if (status != RoundStatus.Closed) revert RoundNotClosed();
        if (address(xfToken) != address(0)) revert TGEAlreadyTriggered();
        require(_xfToken != address(0), "ZeroToken");

        xfToken = IERC20(_xfToken);
        tgeTimestamp = block.timestamp;
        status = RoundStatus.TGETriggered;

        // Calculate total tokens needed
        totalTokensAllocated = (totalCommitted * tokenPriceNumerator) / tokenPriceDenominator;

        // Pull tokens from admin (must have approved this contract)
        xfToken.safeTransferFrom(msg.sender, address(this), totalTokensAllocated);

        emit TGETriggered(_xfToken, totalTokensAllocated, block.timestamp);
    }

    // ═══════════════════════════════════════════════════════════════════
    //  4. VESTING & CLAIMING
    // ═══════════════════════════════════════════════════════════════════

    function claim() external nonReentrant {
        if (status != RoundStatus.TGETriggered) revert TGENotTriggered();

        Commitment storage c = commitments[msg.sender];
        if (c.amount == 0) revert NoCommitment();

        // Calculate allocation if not yet set
        if (c.tokenAllocation == 0) {
            c.tokenAllocation = (c.amount * tokenPriceNumerator) / tokenPriceDenominator;
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

        // During cliff: nothing vested
        if (elapsed < CLIFF_DURATION) return 0;

        // After cliff: linear vesting over VESTING_DURATION
        uint256 vestingElapsed = elapsed - CLIFF_DURATION;
        if (vestingElapsed >= VESTING_DURATION) return c.tokenAllocation;

        return (c.tokenAllocation * vestingElapsed) / VESTING_DURATION;
    }

    // ═══════════════════════════════════════════════════════════════════
    //  5. REFUND SAFETY
    // ═══════════════════════════════════════════════════════════════════

    function requestRefund() external nonReentrant {
        // Refund only if TGE not triggered and deadline passed
        if (status == RoundStatus.TGETriggered) revert TGEAlreadyTriggered();
        if (block.timestamp < roundOpenedAt + REFUND_DEADLINE) revert RefundDeadlineNotReached();

        Commitment storage c = commitments[msg.sender];
        if (c.amount == 0) revert NoCommitment();
        if (c.refunded) revert AlreadyRefunded();

        c.refunded = true;
        uint256 refundAmount = c.amount;

        (bool ok, ) = payable(msg.sender).call{value: refundAmount}("");
        require(ok, "RefundFailed");

        emit Refunded(msg.sender, refundAmount);
    }

    // ═══════════════════════════════════════════════════════════════════
    //  6. ADMIN
    // ═══════════════════════════════════════════════════════════════════

    function withdrawFunds(address to) external onlyRole(DEFAULT_ADMIN_ROLE) {
        if (status != RoundStatus.TGETriggered) revert TGENotTriggered();
        uint256 bal = address(this).balance;
        require(bal > 0, "NoFunds");
        (bool ok, ) = payable(to).call{value: bal}("");
        require(ok, "WithdrawFailed");
        emit FundsWithdrawn(to, bal);
    }

    function pause() external onlyRole(DEFAULT_ADMIN_ROLE) { _pause(); }
    function unpause() external onlyRole(DEFAULT_ADMIN_ROLE) { _unpause(); }

    // ═══════════════════════════════════════════════════════════════════
    //  7. VIEWS
    // ═══════════════════════════════════════════════════════════════════

    function getCommitment(address believer) external view returns (Commitment memory) {
        return commitments[believer];
    }

    function claimable(address believer) external view returns (uint256) {
        if (status != RoundStatus.TGETriggered) return 0;
        Commitment memory c = commitments[believer];
        if (c.amount == 0) return 0;
        if (c.tokenAllocation == 0) {
            c.tokenAllocation = (c.amount * tokenPriceNumerator) / tokenPriceDenominator;
        }
        uint256 vested = _vestedAmount(c);
        return vested > c.tokensClaimed ? vested - c.tokensClaimed : 0;
    }

    function getStats() external view returns (
        uint256 committed_, uint256 believers_, uint256 allocated_,
        uint256 claimed_, uint256 hardCap_, RoundStatus status_
    ) {
        return (totalCommitted, totalBelievers, totalTokensAllocated,
                totalTokensClaimed, hardCap, status);
    }

    receive() external payable {}
}
