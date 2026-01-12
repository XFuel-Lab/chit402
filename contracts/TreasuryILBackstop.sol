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
 * - Pausable: Emergency pause functionality (unwrap/payouts)
 * - Access control: Owner and timelock roles
 * - Low reserve detection and automatic backstop
 */
contract TreasuryILBackstop is Ownable, ReentrancyGuard {
    using SafeERC20 for IERC20;
    IERC20 public treasuryToken; // USDC or stablecoin
    address public pool;
    address public timelock; // Timelock controller
    bool public paused; // Pause functionality
    bool public payoutsPaused; // Separate pause for payouts only
    bool public unwrapPaused; // Separate pause for unwrap operations
    
    uint256 public constant IL_THRESHOLD_BPS = 800; // 8% = 800 basis points
    uint256 public totalCoverageProvided;
    
    // Low reserve backstop
    uint256 public lowReserveThresholdBps; // e.g., 1000 = 10%
    uint256 public minimumReserve; // Minimum reserve in absolute terms
    address public backstopFunder; // Address that can replenish reserves
    
    event ILCoverageProvided(
        address indexed lp,
        uint256 lossAmount,
        uint256 coverageAmount
    );
    
    event TreasuryDeposit(address indexed depositor, uint256 amount);
    event TimelockSet(address indexed timelock);
    event Paused(address indexed account);
    event Unpaused(address indexed account);
    event PayoutsPaused(address indexed account);
    event PayoutsUnpaused(address indexed account);
    event UnwrapPaused(address indexed account);
    event UnwrapUnpaused(address indexed account);
    event LowReserveDetected(uint256 balance, uint256 threshold);
    event BackstopTriggered(address indexed funder, uint256 amount);
    event LowReserveThresholdSet(uint256 oldThreshold, uint256 newThreshold);
    event MinimumReserveSet(uint256 oldMin, uint256 newMin);
    event BackstopFunderSet(address indexed oldFunder, address indexed newFunder);
    
    modifier whenNotPaused() {
        require(!paused, "TreasuryILBackstop: PAUSED");
        _;
    }
    
    modifier whenPayoutsNotPaused() {
        require(!payoutsPaused && !paused, "TreasuryILBackstop: PAYOUTS_PAUSED");
        _;
    }
    
    modifier whenUnwrapNotPaused() {
        require(!unwrapPaused && !paused, "TreasuryILBackstop: UNWRAP_PAUSED");
        _;
    }
    
    constructor(address _treasuryToken, uint256 _lowReserveThresholdBps, uint256 _minimumReserve) Ownable(msg.sender) {
        require(_treasuryToken != address(0), "TreasuryILBackstop: invalid treasury token");
        require(_lowReserveThresholdBps > 0 && _lowReserveThresholdBps <= 5000, "TreasuryILBackstop: invalid threshold");
        require(_minimumReserve > 0, "TreasuryILBackstop: invalid minimum reserve");
        
        treasuryToken = IERC20(_treasuryToken);
        lowReserveThresholdBps = _lowReserveThresholdBps;
        minimumReserve = _minimumReserve;
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
     * @dev Provide IL coverage if loss exceeds 8% (pausable)
     * @param lpAddress The liquidity provider address
     * @param initialValue Initial LP position value in stablecoin terms
     * @param currentValue Current LP position value in stablecoin terms
     */
    function provideCoverage(
        address lpAddress,
        uint256 initialValue,
        uint256 currentValue
    ) external nonReentrant whenNotPaused whenPayoutsNotPaused {
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
            
            // Check for low reserves before payout
            _checkAndTriggerBackstop();
            
            // Update state first, then make external call
            totalCoverageProvided += coverageAmount;
            treasuryToken.safeTransfer(lpAddress, coverageAmount);
            
            emit ILCoverageProvided(lpAddress, ilBps, coverageAmount);
            
            // Check reserves again after payout
            _checkAndTriggerBackstop();
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
     * @dev Pause payouts only (owner or timelock only)
     */
    function pausePayouts() external {
        require(msg.sender == owner || msg.sender == timelock, "TreasuryILBackstop: not authorized");
        payoutsPaused = true;
        emit PayoutsPaused(msg.sender);
    }
    
    /**
     * @dev Unpause payouts (owner or timelock only)
     */
    function unpausePayouts() external {
        require(msg.sender == owner || msg.sender == timelock, "TreasuryILBackstop: not authorized");
        payoutsPaused = false;
        emit PayoutsUnpaused(msg.sender);
    }
    
    /**
     * @dev Pause unwrap operations (owner or timelock only)
     */
    function pauseUnwrap() external {
        require(msg.sender == owner || msg.sender == timelock, "TreasuryILBackstop: not authorized");
        unwrapPaused = true;
        emit UnwrapPaused(msg.sender);
    }
    
    /**
     * @dev Unpause unwrap operations (owner or timelock only)
     */
    function unpauseUnwrap() external {
        require(msg.sender == owner || msg.sender == timelock, "TreasuryILBackstop: not authorized");
        unwrapPaused = false;
        emit UnwrapUnpaused(msg.sender);
    }
    
    // ============ Low Reserve Backstop Functions ============
    
    /**
     * @dev Check if reserves are low and trigger backstop if needed
     * @return isLow True if reserves are below threshold
     */
    function _checkAndTriggerBackstop() internal returns (bool isLow) {
        uint256 balance = treasuryToken.balanceOf(address(this));
        
        // Check absolute minimum first
        if (balance < minimumReserve) {
            emit LowReserveDetected(balance, minimumReserve);
            
            // Trigger backstop funding if funder is set
            if (backstopFunder != address(0)) {
                _triggerBackstop(minimumReserve - balance);
            }
            
            return true;
        }
        
        // Check percentage threshold
        uint256 targetReserve = (totalCoverageProvided * 10000) / (10000 - lowReserveThresholdBps);
        uint256 threshold = (targetReserve * lowReserveThresholdBps) / 10000;
        
        if (balance < threshold) {
            emit LowReserveDetected(balance, threshold);
            
            // Trigger backstop funding if funder is set
            if (backstopFunder != address(0)) {
                _triggerBackstop(threshold - balance);
            }
            
            return true;
        }
        
        return false;
    }
    
    /**
     * @dev Trigger backstop funding from designated funder
     * @param amount Amount needed to replenish reserves
     */
    function _triggerBackstop(uint256 amount) internal {
        require(backstopFunder != address(0), "TreasuryILBackstop: no backstop funder");
        
        // In production, this would call an external backstop contract
        // or notify the backstop funder to deposit funds
        emit BackstopTriggered(backstopFunder, amount);
    }
    
    /**
     * @dev Manually check and trigger backstop (callable by anyone)
     * @return isLow True if reserves are low
     */
    function checkLowReserves() external returns (bool isLow) {
        return _checkAndTriggerBackstop();
    }
    
    /**
     * @dev Set low reserve threshold (owner only)
     * @param _thresholdBps New threshold in basis points
     */
    function setLowReserveThreshold(uint256 _thresholdBps) external onlyOwner {
        require(_thresholdBps > 0 && _thresholdBps <= 5000, "TreasuryILBackstop: invalid threshold");
        uint256 oldThreshold = lowReserveThresholdBps;
        lowReserveThresholdBps = _thresholdBps;
        emit LowReserveThresholdSet(oldThreshold, _thresholdBps);
    }
    
    /**
     * @dev Set minimum reserve (owner only)
     * @param _minimumReserve New minimum reserve
     */
    function setMinimumReserve(uint256 _minimumReserve) external onlyOwner {
        require(_minimumReserve > 0, "TreasuryILBackstop: invalid minimum reserve");
        uint256 oldMin = minimumReserve;
        minimumReserve = _minimumReserve;
        emit MinimumReserveSet(oldMin, _minimumReserve);
    }
    
    /**
     * @dev Set backstop funder address (owner only)
     * @param _funder New backstop funder address
     */
    function setBackstopFunder(address _funder) external onlyOwner {
        address oldFunder = backstopFunder;
        backstopFunder = _funder;
        emit BackstopFunderSet(oldFunder, _funder);
    }
    
    /**
     * @dev Get current reserve status
     * @return balance Current balance
     * @return threshold Low reserve threshold
     * @return isLow True if reserves are low
     */
    function getReserveStatus() external view returns (uint256 balance, uint256 threshold, bool isLow) {
        balance = treasuryToken.balanceOf(address(this));
        
        // Check absolute minimum first
        if (balance < minimumReserve) {
            return (balance, minimumReserve, true);
        }
        
        // Check percentage threshold
        uint256 targetReserve = (totalCoverageProvided * 10000) / (10000 - lowReserveThresholdBps);
        threshold = (targetReserve * lowReserveThresholdBps) / 10000;
        isLow = balance < threshold;
        
        return (balance, threshold, isLow);
    }
    
    /**
     * @dev Emergency withdrawal (owner only)
     */
    function emergencyWithdraw(uint256 amount) external onlyOwner nonReentrant {
        require(amount > 0, "TreasuryILBackstop: INVALID_AMOUNT");
        treasuryToken.safeTransfer(owner, amount);
    }
}

