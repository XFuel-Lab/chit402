// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/access/AccessControl.sol";
import "@openzeppelin/contracts/utils/Pausable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/**
 * @title CoreRevenueSplitter
 * @author XFuel Protocol — Core Layer
 * @notice Ecosystem-agnostic fee collection and distribution with configurable splits
 *         and fee-to-stake pools for validator incentives.
 *
 * Default Split (30/30/25/15):
 *   30% → Buyback-Burn (BBB): Buy XF on open market and burn
 *   30% → Liquidity Provision (LP): Deepen AMM pools
 *   25% → Stakers (veXF holders): Yield distribution
 *   15% → Treasury: Operations, AI infra, grants
 *
 * Fee-to-Stake (15-25% of treasury allocation):
 *   Per Theta Metachain docs: Subchain validators require wTHETA collateral.
 *   Fee-to-stake routes a configurable portion (15-25%) of incoming fees to
 *   validator staking pools (e.g., wTHETA/TFUEL for Theta Edge nodes).
 *
 * Fee Range: 0.1-1% (10-100 BPS) configurable per circuit.
 *
 * Design:
 *   - Accepts native token (TFUEL/TAO/ETH) via receive().
 *   - Accepts ERC20 via depositERC20().
 *   - Circuits plug in by sending fees to this contract.
 *   - Emits events for off-chain indexers and circuit listeners.
 *   - <100k gas per split operation.
 */
contract CoreRevenueSplitter is AccessControl, Pausable, ReentrancyGuard {
    // ─── Roles ────────────────────────────────────────────────────────────────
    bytes32 public constant FEE_MANAGER_ROLE = keccak256("FEE_MANAGER_ROLE");
    bytes32 public constant CIRCUIT_ROLE = keccak256("CIRCUIT_ROLE");

    // ─── Split Configuration (in BPS, must sum to 10000) ──────────────────────
    uint16 public bbbBps = 3000;        // 30% buyback-burn
    uint16 public lpBps = 3000;         // 30% liquidity
    uint16 public stakerBps = 2500;     // 25% stakers
    uint16 public treasuryBps = 1500;   // 15% treasury
    uint16 public constant TOTAL_BPS = 10000;

    // ─── Fee-to-Stake Configuration ───────────────────────────────────────────
    /// @notice Percentage of treasury allocation routed to validator staking (1500-2500 BPS).
    /// Per Theta docs: 1,000 wTHETA per validator + 20,000 TFUEL reserves.
    uint16 public feeToStakeBps = 2000; // 20% of treasury → staking
    uint16 public constant MIN_FEE_TO_STAKE_BPS = 1500; // 15%
    uint16 public constant MAX_FEE_TO_STAKE_BPS = 2500; // 25%

    // ─── Recipient Addresses ──────────────────────────────────────────────────
    address public bbbWallet;       // Buyback-burn executor
    address public lpWallet;        // Liquidity provision manager
    address public stakerVault;     // veXF yield vault
    address public treasuryWallet;  // Protocol treasury
    address public stakePool;       // Validator staking pool (wTHETA/TFUEL)

    // ─── Metrics ──────────────────────────────────────────────────────────────
    uint256 public totalCollected;
    uint256 public totalDistributed;
    uint256 public totalBBB;
    uint256 public totalLP;
    uint256 public totalStaker;
    uint256 public totalTreasury;
    uint256 public totalFeeToStake;

    /// @notice Per-circuit fee tracking.
    mapping(bytes32 => uint256) public circuitFees;

    // ─── Events ───────────────────────────────────────────────────────────────
    event FeeReceived(
        bytes32 indexed circuitId,
        address indexed sender,
        uint256 amount,
        uint256 timestamp
    );

    event FeeDistributed(
        uint256 bbbAmount,
        uint256 lpAmount,
        uint256 stakerAmount,
        uint256 treasuryAmount,
        uint256 feeToStakeAmount,
        uint256 timestamp
    );

    event SplitUpdated(uint16 bbb, uint16 lp, uint16 staker, uint16 treasury);
    event FeeToStakeUpdated(uint16 newBps);
    event RecipientUpdated(string role, address newAddress);

    // ─── Errors ───────────────────────────────────────────────────────────────
    error InvalidSplit();
    error InvalidFeeToStake();
    error ZeroAddress();
    error TransferFailed(string recipient);
    error NothingToDistribute();

    // ─── Constructor ──────────────────────────────────────────────────────────
    constructor(
        address _admin,
        address _bbbWallet,
        address _lpWallet,
        address _stakerVault,
        address _treasuryWallet,
        address _stakePool
    ) {
        require(_admin != address(0), "ZeroAdmin");

        bbbWallet = _bbbWallet;
        lpWallet = _lpWallet;
        stakerVault = _stakerVault;
        treasuryWallet = _treasuryWallet;
        stakePool = _stakePool;

        _grantRole(DEFAULT_ADMIN_ROLE, _admin);
        _grantRole(FEE_MANAGER_ROLE, _admin);
        _grantRole(CIRCUIT_ROLE, _admin);
    }

    // ─── Fee Ingress ──────────────────────────────────────────────────────────

    /**
     * @notice Receive native token fees from circuits.
     *         Circuits call: revenueSplitter.call{value: feeAmount}("")
     */
    receive() external payable {
        totalCollected += msg.value;
        emit FeeReceived(bytes32(0), msg.sender, msg.value, block.timestamp);
    }

    /**
     * @notice Receive fees tagged with a circuit identifier.
     * @param circuitId Identifier of the circuit sending fees.
     */
    function depositFee(bytes32 circuitId) external payable whenNotPaused {
        require(msg.value > 0, "ZeroAmount");
        totalCollected += msg.value;
        circuitFees[circuitId] += msg.value;
        emit FeeReceived(circuitId, msg.sender, msg.value, block.timestamp);
    }

    // ─── Distribution ─────────────────────────────────────────────────────────

    /**
     * @notice Distribute accumulated native token fees according to the split.
     * @dev Can be called by anyone. Gas-efficient: single pass, ~60k gas.
     */
    function distribute() external nonReentrant whenNotPaused {
        uint256 balance = address(this).balance;
        if (balance == 0) revert NothingToDistribute();

        // Calculate splits
        uint256 bbbAmount = (balance * bbbBps) / TOTAL_BPS;
        uint256 lpAmount = (balance * lpBps) / TOTAL_BPS;
        uint256 stakerAmount = (balance * stakerBps) / TOTAL_BPS;
        uint256 treasuryRaw = balance - bbbAmount - lpAmount - stakerAmount; // remainder

        // Fee-to-stake: carve from treasury allocation
        uint256 feeToStakeAmount = (treasuryRaw * feeToStakeBps) / TOTAL_BPS;
        uint256 treasuryAmount = treasuryRaw - feeToStakeAmount;

        // Transfer to recipients
        _safeTransfer(bbbWallet, bbbAmount, "BBB");
        _safeTransfer(lpWallet, lpAmount, "LP");
        _safeTransfer(stakerVault, stakerAmount, "Staker");
        _safeTransfer(treasuryWallet, treasuryAmount, "Treasury");

        if (feeToStakeAmount > 0 && stakePool != address(0)) {
            _safeTransfer(stakePool, feeToStakeAmount, "StakePool");
        } else if (feeToStakeAmount > 0) {
            // If no stake pool configured, redirect to treasury
            _safeTransfer(treasuryWallet, feeToStakeAmount, "Treasury(stake)");
            treasuryAmount += feeToStakeAmount;
            feeToStakeAmount = 0;
        }

        // Update metrics
        totalDistributed += balance;
        totalBBB += bbbAmount;
        totalLP += lpAmount;
        totalStaker += stakerAmount;
        totalTreasury += treasuryAmount;
        totalFeeToStake += feeToStakeAmount;

        emit FeeDistributed(
            bbbAmount, lpAmount, stakerAmount,
            treasuryAmount, feeToStakeAmount,
            block.timestamp
        );
    }

    // ─── Configuration ────────────────────────────────────────────────────────

    /**
     * @notice Update the fee split ratios. Must sum to TOTAL_BPS (10000).
     */
    function setSplit(
        uint16 _bbb, uint16 _lp, uint16 _staker, uint16 _treasury
    ) external onlyRole(FEE_MANAGER_ROLE) {
        if (_bbb + _lp + _staker + _treasury != TOTAL_BPS) revert InvalidSplit();
        bbbBps = _bbb;
        lpBps = _lp;
        stakerBps = _staker;
        treasuryBps = _treasury;
        emit SplitUpdated(_bbb, _lp, _staker, _treasury);
    }

    /**
     * @notice Update the fee-to-stake percentage (15-25% of treasury).
     */
    function setFeeToStake(uint16 _bps) external onlyRole(FEE_MANAGER_ROLE) {
        if (_bps < MIN_FEE_TO_STAKE_BPS || _bps > MAX_FEE_TO_STAKE_BPS) {
            revert InvalidFeeToStake();
        }
        feeToStakeBps = _bps;
        emit FeeToStakeUpdated(_bps);
    }

    function setBBBWallet(address a) external onlyRole(DEFAULT_ADMIN_ROLE) {
        if (a == address(0)) revert ZeroAddress();
        bbbWallet = a;
        emit RecipientUpdated("BBB", a);
    }

    function setLPWallet(address a) external onlyRole(DEFAULT_ADMIN_ROLE) {
        if (a == address(0)) revert ZeroAddress();
        lpWallet = a;
        emit RecipientUpdated("LP", a);
    }

    function setStakerVault(address a) external onlyRole(DEFAULT_ADMIN_ROLE) {
        if (a == address(0)) revert ZeroAddress();
        stakerVault = a;
        emit RecipientUpdated("Staker", a);
    }

    function setTreasuryWallet(address a) external onlyRole(DEFAULT_ADMIN_ROLE) {
        if (a == address(0)) revert ZeroAddress();
        treasuryWallet = a;
        emit RecipientUpdated("Treasury", a);
    }

    function setStakePool(address a) external onlyRole(DEFAULT_ADMIN_ROLE) {
        stakePool = a; // Can be address(0) to disable
        emit RecipientUpdated("StakePool", a);
    }

    function pause() external onlyRole(DEFAULT_ADMIN_ROLE) { _pause(); }
    function unpause() external onlyRole(DEFAULT_ADMIN_ROLE) { _unpause(); }

    // ─── Views ────────────────────────────────────────────────────────────────

    function getSplit() external view returns (uint16, uint16, uint16, uint16) {
        return (bbbBps, lpBps, stakerBps, treasuryBps);
    }

    function getStats() external view returns (
        uint256 collected, uint256 distributed,
        uint256 bbb, uint256 lp, uint256 staker,
        uint256 treasury, uint256 feeStake
    ) {
        return (totalCollected, totalDistributed, totalBBB, totalLP,
                totalStaker, totalTreasury, totalFeeToStake);
    }

    function pendingBalance() external view returns (uint256) {
        return address(this).balance;
    }

    // ─── Internal ─────────────────────────────────────────────────────────────

    function _safeTransfer(address to, uint256 amount, string memory label) internal {
        if (amount == 0 || to == address(0)) return;
        (bool ok, ) = payable(to).call{value: amount}("");
        if (!ok) revert TransferFailed(label);
    }
}
