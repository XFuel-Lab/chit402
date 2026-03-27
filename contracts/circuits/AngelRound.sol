// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/access/AccessControl.sol";
import "@openzeppelin/contracts/utils/Pausable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

/**
 * @title AngelRound
 * @author XFuel Protocol
 * @notice Pre-TGE treasury / audit funding round. Separate from BelieverRound (refundable community round).
 *
 * Key differences vs BelieverRound:
 *   - No TFUEL refund path — angels accept pre-TGE treasury use.
 *   - Admin may withdraw native TFUEL to treasury (multisig) while round is Open or Closed, before TGE,
 *     for audits, LP seed, ops — disclosed via on-chain memo (trust + transparency, not cryptographic earmark).
 *   - XF allocation is fixed at commit time; TGE still requires admin to deposit totalXFReserved of XF.
 *   - Same cliff + linear vesting as Believer for claimed XF (no optional lock tiers in v1).
 *
 * TGE is triggered separately from BelieverRound (two contracts → two triggerTGE calls).
 */
contract AngelRound is AccessControl, Pausable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    bytes32 public constant OPERATOR_ROLE = keccak256("OPERATOR_ROLE");

    uint256 public minCommitment;
    uint256 public maxCommitmentPerWallet;
    uint256 public hardCap;
    uint256 public tokenPriceNumerator;
    uint256 public tokenPriceDenominator;
    uint8 public phase;

    uint256 public constant CLIFF_DURATION = 90 days;
    uint256 public constant VESTING_DURATION = 270 days;

    enum RoundStatus {
        Open,
        Closed,
        TGETriggered
    }
    RoundStatus public status;

    IERC20 public xfToken;
    uint256 public roundOpenedAt;
    uint256 public roundClosedAt;
    uint256 public tgeTimestamp;
    uint256 public totalCommitted;
    uint256 public totalAngels;
    uint256 public totalXFReserved;
    uint256 public totalTokensAllocated;
    uint256 public totalTokensClaimed;
    /// @notice Cumulative native TFUEL sent to treasury via withdrawToTreasury (pre-TGE).
    uint256 public totalTreasuryWithdrawn;

    struct Commitment {
        uint256 amount;
        uint256 tokenAllocation;
        uint256 tokensClaimed;
        uint64 committedAt;
    }

    mapping(address => Commitment) public commitments;

    event RoundOpened(uint256 hardCap, uint256 maxPerWallet, uint256 minCommitment, uint8 phase, uint256 timestamp);
    event Committed(address indexed angel, uint256 amount, uint256 totalCommitted);
    event RoundClosed(uint256 totalRaised, uint256 totalAngels, uint256 timestamp);
    event TreasuryWithdrawal(address indexed to, uint256 amount, string memo, address indexed caller);
    event TGETriggered(address xfToken, uint256 totalTokens, uint256 timestamp);
    event TokensClaimed(address indexed angel, uint256 amount, uint256 totalClaimed);
    event FundsWithdrawn(address indexed to, uint256 amount);

    error RoundNotOpen();
    error RoundNotClosed();
    error TGENotTriggered();
    error TGEAlreadyTriggered();
    error NothingToClaim();
    error ExceedsWalletCap();
    error ExceedsHardCap();
    error BelowMinimum();
    error NoCommitment();
    error InsufficientBalance();
    error TreasuryWithdrawAfterTGE();
    error ZeroAddress();
    error ZeroWithdraw();
    error CliffNotEnded();

    constructor(
        address _admin,
        uint256 _hardCap,
        uint256 _maxPerWallet,
        uint256 _minCommitment,
        uint256 _priceNumerator,
        uint256 _priceDenominator,
        uint8 _phase
    ) {
        require(_admin != address(0), "ZeroAdmin");
        require(_hardCap > 0, "ZeroHardCap");
        require(_minCommitment > 0, "ZeroMin");
        require(_maxPerWallet == 0 || _maxPerWallet <= _hardCap, "BadWalletCap");
        require(_priceNumerator > 0 && _priceDenominator > 0, "BadPrice");
        require(_phase >= 1 && _phase <= 3, "BadPhase");

        hardCap = _hardCap;
        maxCommitmentPerWallet = _maxPerWallet;
        minCommitment = _minCommitment;
        tokenPriceNumerator = _priceNumerator;
        tokenPriceDenominator = _priceDenominator;
        phase = _phase;

        _grantRole(DEFAULT_ADMIN_ROLE, _admin);
        _grantRole(OPERATOR_ROLE, _admin);

        status = RoundStatus.Open;
        roundOpenedAt = block.timestamp;

        emit RoundOpened(_hardCap, _maxPerWallet, _minCommitment, _phase, block.timestamp);
    }

    function commit() external payable nonReentrant whenNotPaused {
        if (status != RoundStatus.Open) revert RoundNotOpen();
        if (msg.value < minCommitment) revert BelowMinimum();

        Commitment storage c = commitments[msg.sender];

        if (maxCommitmentPerWallet > 0 && c.amount + msg.value > maxCommitmentPerWallet) revert ExceedsWalletCap();
        if (totalCommitted + msg.value > hardCap) revert ExceedsHardCap();

        uint256 xfDelta = _xfForAmount(msg.value);
        totalXFReserved += xfDelta;

        if (c.amount == 0) {
            totalAngels++;
            c.committedAt = uint64(block.timestamp);
        }

        c.amount += msg.value;
        totalCommitted += msg.value;

        emit Committed(msg.sender, msg.value, totalCommitted);
    }

    function closeRound() external onlyRole(OPERATOR_ROLE) {
        if (status != RoundStatus.Open) revert RoundNotOpen();
        status = RoundStatus.Closed;
        roundClosedAt = block.timestamp;
        emit RoundClosed(totalCommitted, totalAngels, block.timestamp);
    }

    /// @notice Pull TFUEL to treasury (e.g. multisig) for audits, LP, ops. Only before TGE. Angels accept this risk.
    function withdrawToTreasury(address payable to, uint256 amount, string calldata memo) external onlyRole(DEFAULT_ADMIN_ROLE) nonReentrant {
        if (status == RoundStatus.TGETriggered) revert TreasuryWithdrawAfterTGE();
        if (to == address(0)) revert ZeroAddress();
        if (amount == 0) revert ZeroWithdraw();
        if (address(this).balance < amount) revert InsufficientBalance();

        totalTreasuryWithdrawn += amount;
        (bool ok, ) = to.call{value: amount}("");
        require(ok, "TransferFailed");

        emit TreasuryWithdrawal(to, amount, memo, msg.sender);
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

        if (block.timestamp < tgeTimestamp + CLIFF_DURATION) revert CliffNotEnded();

        if (c.tokenAllocation == 0) {
            c.tokenAllocation = _xfForAmount(c.amount);
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

    function _xfForAmount(uint256 amountWei) internal view returns (uint256) {
        return (amountWei * tokenPriceNumerator) / tokenPriceDenominator;
    }

    /// @notice After TGE: sweep remaining native TFUEL (e.g. if any left) to treasury.
    function withdrawFunds(address payable to) external onlyRole(DEFAULT_ADMIN_ROLE) {
        if (status != RoundStatus.TGETriggered) revert TGENotTriggered();
        uint256 bal = address(this).balance;
        require(bal > 0, "NoFunds");
        (bool ok, ) = to.call{value: bal}("");
        require(ok, "WithdrawFailed");
        emit FundsWithdrawn(to, bal);
    }

    function pause() external onlyRole(DEFAULT_ADMIN_ROLE) {
        _pause();
    }

    function unpause() external onlyRole(DEFAULT_ADMIN_ROLE) {
        _unpause();
    }

    function getCommitment(address angel) external view returns (Commitment memory) {
        return commitments[angel];
    }

    function claimable(address angel) external view returns (uint256) {
        if (status != RoundStatus.TGETriggered) return 0;
        Commitment memory c = commitments[angel];
        if (c.amount == 0) return 0;
        if (block.timestamp < tgeTimestamp + CLIFF_DURATION) return 0;

        if (c.tokenAllocation == 0) {
            c.tokenAllocation = _xfForAmount(c.amount);
        }
        uint256 vested = _vestedAmount(c);
        return vested > c.tokensClaimed ? vested - c.tokensClaimed : 0;
    }

    function getStats()
        external
        view
        returns (
            uint256 committed_,
            uint256 angels_,
            uint256 allocated_,
            uint256 claimed_,
            uint256 hardCap_,
            RoundStatus status_,
            uint8 phase_,
            uint256 treasuryWithdrawn_,
            uint256 xfReserved_
        )
    {
        return (
            totalCommitted,
            totalAngels,
            totalTokensAllocated,
            totalTokensClaimed,
            hardCap,
            status,
            phase,
            totalTreasuryWithdrawn,
            totalXFReserved
        );
    }

    receive() external payable {}
}
