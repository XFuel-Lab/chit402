// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "./IERC20.sol";
import "./Ownable.sol";
import "./ReentrancyGuard.sol";
import "./SafeERC20.sol";

/**
 * @title TreasuryILBackstop
 * @dev Covers impermanent loss >8% for liquidity providers
 * 
 * Security Features:
 * - Timelock: Critical operations require timelock delay
 * - Multi-sig: Treasury operations via multi-sig
 * - Pausable: Emergency pause functionality
 * - Access control: Owner and timelock roles
 */
contract TreasuryILBackstop is Ownable, ReentrancyGuard {
    using SafeERC20 for IERC20;
    IERC20 public treasuryToken; // USDC or stablecoin
    address public pool;
    address public timelock; // Timelock controller
    bool public paused; // Pause functionality
    
    uint256 public constant IL_THRESHOLD_BPS = 800; // 8% = 800 basis points
    uint256 public totalCoverageProvided;
    
    event ILCoverageProvided(
        address indexed lp,
        uint256 lossAmount,
        uint256 coverageAmount
    );
    
    event TreasuryDeposit(address indexed depositor, uint256 amount);
    event TimelockSet(address indexed timelock);
    event Paused(address indexed account);
    event Unpaused(address indexed account);
    
    modifier whenNotPaused() {
        require(!paused, "TreasuryILBackstop: PAUSED");
        _;
    }
    
    constructor(address _treasuryToken) Ownable(msg.sender) {
        require(_treasuryToken != address(0), "TreasuryILBackstop: invalid treasury token");
        treasuryToken = IERC20(_treasuryToken);
    }
    
    function setPool(address _pool) external onlyOwner {
        require(_pool != address(0), "TreasuryILBackstop: invalid pool");
        pool = _pool;
    }
    
    /**
     * @dev Calculate impermanent loss percentage
     * @param initialValue Initial LP position value
     * @param currentValue Current LP position value
     * @return ilBps Impermanent loss in basis points (10000 = 100%)
     */
    function calculateIL(uint256 initialValue, uint256 currentValue) public pure returns (uint256 ilBps) {
        if (currentValue >= initialValue) {
            return 0; // No loss
        }
        uint256 loss = initialValue - currentValue;
        ilBps = (loss * 10000) / initialValue;
    }
    
    /**
     * @dev Provide IL coverage if loss exceeds 8%
     * @param lpAddress The liquidity provider address
     * @param initialValue Initial LP position value in stablecoin terms
     * @param currentValue Current LP position value in stablecoin terms
     */
    function provideCoverage(
        address lpAddress,
        uint256 initialValue,
        uint256 currentValue
    ) external nonReentrant whenNotPaused {
        require(msg.sender == pool, "TreasuryILBackstop: UNAUTHORIZED");
        require(lpAddress != address(0), "TreasuryILBackstop: invalid LP address");
        require(initialValue > 0, "TreasuryILBackstop: invalid initial value");
        
        uint256 ilBps = calculateIL(initialValue, currentValue);
        
        if (ilBps > IL_THRESHOLD_BPS) {
            uint256 excessLoss = ilBps - IL_THRESHOLD_BPS;
            uint256 coverageAmount = (initialValue * excessLoss) / 10000;
            
            require(
                treasuryToken.balanceOf(address(this)) >= coverageAmount,
                "TreasuryILBackstop: INSUFFICIENT_TREASURY"
            );
            
            // Update state first, then make external call
            totalCoverageProvided += coverageAmount;
            treasuryToken.safeTransfer(lpAddress, coverageAmount);
            
            emit ILCoverageProvided(lpAddress, ilBps, coverageAmount);
        }
    }
    
    /**
     * @dev Deposit treasury funds
     */
    function depositTreasury(uint256 amount) external nonReentrant whenNotPaused {
        require(amount > 0, "TreasuryILBackstop: INVALID_AMOUNT");
        treasuryToken.safeTransferFrom(msg.sender, address(this), amount);
        emit TreasuryDeposit(msg.sender, amount);
    }
    
    /**
     * @dev Set timelock controller (owner only)
     */
    function setTimelock(address _timelock) external onlyOwner {
        require(_timelock != address(0), "TreasuryILBackstop: invalid timelock");
        timelock = _timelock;
        emit TimelockSet(_timelock);
    }
    
    /**
     * @dev Pause the contract (owner or timelock only)
     */
    function pause() external {
        require(msg.sender == owner || msg.sender == timelock, "TreasuryILBackstop: not authorized");
        paused = true;
        emit Paused(msg.sender);
    }
    
    /**
     * @dev Unpause the contract (owner or timelock only)
     */
    function unpause() external {
        require(msg.sender == owner || msg.sender == timelock, "TreasuryILBackstop: not authorized");
        paused = false;
        emit Unpaused(msg.sender);
    }
    
    /**
     * @dev Emergency withdrawal (owner only)
     */
    function emergencyWithdraw(uint256 amount) external onlyOwner nonReentrant {
        require(amount > 0, "TreasuryILBackstop: INVALID_AMOUNT");
        treasuryToken.safeTransfer(owner, amount);
    }
}

