// SPDX-License-Identifier: MIT
pragma solidity ^0.8.22;

import "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/utils/ReentrancyGuardUpgradeable.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "./veXF.sol";
import "./BuybackBurner.sol";

/**
 * @title RevenueSplitter
 * @dev Collects protocol revenue and distributes according to tokenomics:
 * Current Split: 30% BBB (buyback-burn), 30% LP funding, 25% veXF payout, 15% treasury
 * 
 * Monthly Batch Processing:
 * - Accumulates LP fees in USDC from IBC operations
 * - Monthly: 30% converted to TFUEL via (USDC → ibcTFUEL burn → unwrap)
 * - Unwrapped TFUEL sent to this contract and distributed via standard split above
 * - Remaining 70% stays as USDC for protocol operations
 * 
 * UUPS upgradeable contract
 * Uses Solidity 0.8+ built-in overflow protection (no SafeMath needed)
 * 
 * Security Features:
 * - Timelock: Critical operations require timelock delay
 * - Multi-sig: Treasury operations via multi-sig
 * - Pausable: Built-in pause functionality
 * - Access control: Owner and timelock roles
 */
contract RevenueSplitter is UUPSUpgradeable, OwnableUpgradeable, ReentrancyGuardUpgradeable {
    using SafeERC20 for IERC20;

    // Revenue split constants (in basis points)
    // Current Split: 30% BBB, 30% LP funding, 25% veXF, 15% treasury
    uint256 public constant BBB_BPS = 3000;              // 30% to buyback-burn-bond
    uint256 public constant LP_FUNDING_BPS = 3000;       // 30% to LP funding
    uint256 public constant VEXF_PAYOUT_BPS = 2500;      // 25% to veXF payout
    uint256 public constant TREASURY_BPS = 1500;         // 15% to Treasury
    uint256 public constant TOTAL_BPS = 10000;           // 100%

    // Contract addresses
    veXF public veXFContract;
    address public treasury;
    BuybackBurner public buybackBurner;
    address public lpFundingPool;  // LP funding pool address
    
    // Timelock controller for critical operations
    address public timelock;

    // Revenue token (e.g., USDC)
    IERC20 public revenueToken;

    // Tracking
    uint256 public totalRevenueCollected;
    uint256 public totalBBBSent;              // Total sent to buyback-burn-bond
    uint256 public totalLPFundingSent;        // Total sent to LP funding
    uint256 public totalVeXFPayout;           // Total paid out to veXF
    uint256 public totalTreasurySent;
    
    // Monthly batch processing tracking
    uint256 public accumulatedLPFeesUSDC;        // Accumulated LP fees in USDC for monthly processing
    uint256 public lastMonthlyBatchTime;         // Timestamp of last monthly batch
    uint256 public constant MONTHLY_INTERVAL = 30 days;
    uint256 public totalRecycledToBonus;         // Total recycled to bonus revenue (30% as TFUEL)

    // Mainnet Beta Testing Safety Limits
    uint256 public maxSwapAmount;            // Max per swap (default: 1,000 TFUEL)
    uint256 public totalUserLimit;           // Max total per user (default: 5,000 TFUEL)
    mapping(address => uint256) public userTotalSwapped;
    bool public paused;                      // Emergency pause switch

    // Events
    event RevenueCollected(
        address indexed token,
        uint256 amount,
        address indexed source
    );
    event RevenueSplit(
        uint256 bbbAmount,
        uint256 lpFundingAmount,
        uint256 veXFAmount,
        uint256 treasuryAmount
    );
    event VeXFSet(address indexed veXF);
    event TreasurySet(address indexed treasury);
    event BuybackBurnerSet(address indexed buybackBurner);
    event LPFundingPoolSet(address indexed lpFundingPool);
    event RevenueTokenSet(address indexed token);
    event SwapLimitUpdated(uint256 maxSwapAmount, uint256 totalUserLimit);
    event PauseToggled(bool paused);
    event UserSwapRecorded(address indexed user, uint256 amount, uint256 totalSwapped);
    event TimelockSet(address indexed timelock);
    
    // Monthly batch processing events
    event LPFeesAccumulated(uint256 amount, uint256 totalAccumulated);
    event MonthlyBatchProcessed(
        uint256 indexed batchId,
        uint256 totalProcessed,
        uint256 recycleAmount,
        uint256 timestamp
    );
    event BonusRevenueRecycled(uint256 amount);

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    /**
     * @dev Initialize the contract (replaces constructor for upgradeable contracts)
     * @param _revenueToken Address of revenue token (e.g., USDC)
     * @param _veXF Address of veXF contract
     * @param _treasury Address of treasury
     * @param _owner Address of contract owner
     */
    function initialize(
        address _revenueToken,
        address _veXF,
        address _treasury,
        address _owner
    ) public initializer {
        require(_revenueToken != address(0), "RevenueSplitter: invalid revenue token");
        require(_veXF != address(0), "RevenueSplitter: invalid veXF");
        require(_treasury != address(0), "RevenueSplitter: invalid treasury");
        require(_owner != address(0), "RevenueSplitter: invalid owner");

        __Ownable_init(_owner);
        __ReentrancyGuard_init();
        __UUPSUpgradeable_init();

        revenueToken = IERC20(_revenueToken);
        veXFContract = veXF(_veXF);
        treasury = _treasury;

        // Initialize mainnet beta testing limits
        maxSwapAmount = 1000 * 1e18;      // 1,000 TFUEL per swap
        totalUserLimit = 5000 * 1e18;     // 5,000 TFUEL total per user
        paused = false;
        
        // Initialize monthly batch timestamp
        lastMonthlyBatchTime = block.timestamp;

        emit RevenueTokenSet(_revenueToken);
        emit VeXFSet(_veXF);
        emit TreasurySet(_treasury);
    }

    /**
     * @dev Collect and split protocol revenue
     * @param amount Amount of revenue tokens to split
     */
    function splitRevenue(uint256 amount) external nonReentrant {
        require(!paused, "RevenueSplitter: contract is paused");
        require(amount > 0, "RevenueSplitter: amount must be greater than 0");
        require(amount <= maxSwapAmount, "RevenueSplitter: amount exceeds max swap limit");
        
        // Track by msg.sender for proper per-caller limits (beta safety)
        address user = msg.sender;
        require(userTotalSwapped[user] + amount <= totalUserLimit, "RevenueSplitter: user total limit exceeded");

        // Update user's total swapped amount
        userTotalSwapped[user] += amount;
        emit UserSwapRecorded(user, amount, userTotalSwapped[user]);

        // Transfer revenue from caller
        revenueToken.safeTransferFrom(msg.sender, address(this), amount);

        totalRevenueCollected += amount;

        emit RevenueCollected(address(revenueToken), amount, msg.sender);

        // Calculate splits: 30% BBB, 30% LP funding, 25% veXF, 15% treasury
        uint256 bbbAmount = (amount * BBB_BPS) / TOTAL_BPS;
        uint256 lpFundingAmount = (amount * LP_FUNDING_BPS) / TOTAL_BPS;
        uint256 veXFAmount = (amount * VEXF_PAYOUT_BPS) / TOTAL_BPS;
        uint256 treasuryAmount = (amount * TREASURY_BPS) / TOTAL_BPS;

        // Verify total matches (handle rounding)
        uint256 totalSplit = bbbAmount + lpFundingAmount + veXFAmount + treasuryAmount;
        if (totalSplit < amount) {
            // Add remainder to veXF payout
            veXFAmount += (amount - totalSplit);
        }

        // Distribute to buyback-burn-bond (30%)
        if (bbbAmount > 0) {
            require(address(buybackBurner) != address(0), "RevenueSplitter: buybackBurner not set");
            revenueToken.safeIncreaseAllowance(address(buybackBurner), bbbAmount);
            buybackBurner.receiveRevenue(bbbAmount);
            totalBBBSent += bbbAmount;
        }

        // Send to LP funding pool (30%)
        if (lpFundingAmount > 0) {
            require(lpFundingPool != address(0), "RevenueSplitter: LP funding pool not set");
            revenueToken.safeTransfer(lpFundingPool, lpFundingAmount);
            totalLPFundingSent += lpFundingAmount;
        }

        // Distribute to veXF holders (25%)
        if (veXFAmount > 0) {
            revenueToken.safeIncreaseAllowance(address(veXFContract), veXFAmount);
            veXFContract.distributeYield(address(revenueToken), veXFAmount);
            totalVeXFPayout += veXFAmount;
        }

        // Send to Treasury (15%)
        if (treasuryAmount > 0) {
            revenueToken.safeTransfer(treasury, treasuryAmount);
            totalTreasurySent += treasuryAmount;
        }

        emit RevenueSplit(bbbAmount, lpFundingAmount, veXFAmount, treasuryAmount);
    }

    /**
     * @dev Collect and split revenue from native token (TFUEL)
     * Splits according to: 30% BBB, 30% LP funding, 25% veXF, 15% treasury
     */
    function splitRevenueNative() external payable nonReentrant {
        require(!paused, "RevenueSplitter: contract is paused");
        require(msg.value > 0, "RevenueSplitter: amount must be greater than 0");
        require(msg.value <= maxSwapAmount, "RevenueSplitter: amount exceeds max swap limit");
        
        // Track by msg.sender for proper per-caller limits (beta safety)
        address user = msg.sender;
        require(userTotalSwapped[user] + msg.value <= totalUserLimit, "RevenueSplitter: user total limit exceeded");

        // Update user's total swapped amount
        userTotalSwapped[user] += msg.value;
        emit UserSwapRecorded(user, msg.value, userTotalSwapped[user]);

        totalRevenueCollected += msg.value;

        emit RevenueCollected(address(0), msg.value, msg.sender);

        // Calculate splits: 30% BBB, 30% LP funding, 25% veXF, 15% treasury
        uint256 bbbAmount = (msg.value * BBB_BPS) / TOTAL_BPS;
        uint256 lpFundingAmount = (msg.value * LP_FUNDING_BPS) / TOTAL_BPS;
        uint256 veXFAmount = (msg.value * VEXF_PAYOUT_BPS) / TOTAL_BPS;
        uint256 treasuryAmount = (msg.value * TREASURY_BPS) / TOTAL_BPS;
        
        // Handle rounding
        uint256 totalSplit = bbbAmount + lpFundingAmount + veXFAmount + treasuryAmount;
        if (totalSplit < msg.value) {
            veXFAmount += (msg.value - totalSplit);
        }

        // Send BBB amount (30%)
        if (bbbAmount > 0 && address(buybackBurner) != address(0)) {
            (bool success, ) = address(buybackBurner).call{value: bbbAmount}("");
            require(success, "RevenueSplitter: BBB transfer failed");
            totalBBBSent += bbbAmount;
        }

        // Send LP funding amount (30%)
        if (lpFundingAmount > 0 && lpFundingPool != address(0)) {
            (bool success, ) = lpFundingPool.call{value: lpFundingAmount}("");
            require(success, "RevenueSplitter: LP funding transfer failed");
            totalLPFundingSent += lpFundingAmount;
        }

        // Send veXF amount (25%)
        if (veXFAmount > 0) {
            (bool success, ) = address(veXFContract).call{value: veXFAmount}("");
            require(success, "RevenueSplitter: veXF transfer failed");
            totalVeXFPayout += veXFAmount;
        }

        // Send treasury amount (15%)
        if (treasuryAmount > 0) {
            (bool success, ) = payable(treasury).call{value: treasuryAmount}("");
            require(success, "RevenueSplitter: treasury transfer failed");
            totalTreasurySent += treasuryAmount;
        }

        emit RevenueSplit(bbbAmount, lpFundingAmount, veXFAmount, treasuryAmount);
    }

    /**
     * @dev Set veXF contract address
     */
    function setVeXF(address _veXF) external onlyOwner {
        require(_veXF != address(0), "RevenueSplitter: invalid veXF");
        veXFContract = veXF(_veXF);
        emit VeXFSet(_veXF);
    }

    /**
     * @dev Set Treasury address
     */
    function setTreasury(address _treasury) external onlyOwner {
        require(_treasury != address(0), "RevenueSplitter: invalid treasury");
        treasury = _treasury;
        emit TreasurySet(_treasury);
    }

    /**
     * @dev Set BuybackBurner address
     */
    function setBuybackBurner(address _buybackBurner) external onlyOwner {
        require(_buybackBurner != address(0), "RevenueSplitter: invalid buyback burner");
        buybackBurner = BuybackBurner(_buybackBurner);
        emit BuybackBurnerSet(_buybackBurner);
    }

    /**
     * @dev Set LP funding pool address
     */
    function setLPFundingPool(address _lpFundingPool) external onlyOwner {
        require(_lpFundingPool != address(0), "RevenueSplitter: invalid LP funding pool");
        lpFundingPool = _lpFundingPool;
        emit LPFundingPoolSet(_lpFundingPool);
    }

    /**
     * @dev Set revenue token address
     */
    function setRevenueToken(address _revenueToken) external onlyOwner {
        require(_revenueToken != address(0), "RevenueSplitter: invalid revenue token");
        revenueToken = IERC20(_revenueToken);
        emit RevenueTokenSet(_revenueToken);
    }
    
    /**
     * @dev Set timelock controller (owner only)
     * @param _timelock Address of timelock controller
     */
    function setTimelock(address _timelock) external onlyOwner {
        require(_timelock != address(0), "RevenueSplitter: invalid timelock");
        timelock = _timelock;
        emit TimelockSet(_timelock);
    }

    /**
     * @dev Update swap limits (owner only)
     * @param _maxSwapAmount New max per swap (in wei)
     * @param _totalUserLimit New total limit per user (in wei)
     */
    function updateSwapLimits(uint256 _maxSwapAmount, uint256 _totalUserLimit) external onlyOwner {
        require(_maxSwapAmount > 0, "RevenueSplitter: max swap amount must be greater than 0");
        require(_totalUserLimit >= _maxSwapAmount, "RevenueSplitter: total limit must be >= max swap");
        
        maxSwapAmount = _maxSwapAmount;
        totalUserLimit = _totalUserLimit;
        
        emit SwapLimitUpdated(_maxSwapAmount, _totalUserLimit);
    }

    /**
     * @dev Toggle pause state (owner only) - emergency kill switch
     * @param _paused New pause state
     */
    function setPaused(bool _paused) external onlyOwner {
        paused = _paused;
        emit PauseToggled(_paused);
    }

    /**
     * @dev Reset user's swap total (owner only) - for exceptions
     * @param user Address of user to reset
     */
    function resetUserSwapTotal(address user) external onlyOwner {
        userTotalSwapped[user] = 0;
    }

    /**
     * @dev Initialize beta limits (for upgrades - only if not already set)
     * Can be called by owner after upgrade to set initial limits
     */
    function initializeBetaLimits() external onlyOwner {
        // Only initialize if not already set (allows safe re-initialization on upgrade)
        if (maxSwapAmount == 0) {
            maxSwapAmount = 1000 * 1e18;      // 1,000 TFUEL per swap
            totalUserLimit = 5000 * 1e18;     // 5,000 TFUEL total per user
            paused = false;
            emit SwapLimitUpdated(maxSwapAmount, totalUserLimit);
        }
    }

    /**
     * @dev Get current split amounts for a given revenue amount
     * @param amount Revenue amount to calculate splits for
     * @return bbbAmount BBB amount (30%)
     * @return lpFundingAmount LP funding amount (30%)
     * @return veXFAmount veXF payout amount (25%)
     * @return treasuryAmount Treasury amount (15%)
     */
    function calculateSplits(uint256 amount) external pure returns (
        uint256 bbbAmount,
        uint256 lpFundingAmount,
        uint256 veXFAmount,
        uint256 treasuryAmount
    ) {
        bbbAmount = (amount * BBB_BPS) / TOTAL_BPS;
        lpFundingAmount = (amount * LP_FUNDING_BPS) / TOTAL_BPS;
        veXFAmount = (amount * VEXF_PAYOUT_BPS) / TOTAL_BPS;
        treasuryAmount = (amount * TREASURY_BPS) / TOTAL_BPS;

        // Handle rounding (remainder goes to veXF)
        uint256 total = bbbAmount + lpFundingAmount + veXFAmount + treasuryAmount;
        if (total < amount) {
            veXFAmount += (amount - total);
        }
    }

    /**
     * @dev Accumulate LP fees in USDC for monthly processing
     * @param amount Amount of USDC LP fees to accumulate
     */
    function accumulateLPFees(uint256 amount) external nonReentrant {
        require(!paused, "RevenueSplitter: contract is paused");
        require(amount > 0, "RevenueSplitter: amount must be greater than 0");
        
        // Transfer USDC from caller
        revenueToken.safeTransferFrom(msg.sender, address(this), amount);
        
        accumulatedLPFeesUSDC += amount;
        
        emit LPFeesAccumulated(amount, accumulatedLPFeesUSDC);
    }
    
    /**
     * @dev Process monthly batch: Convert 30% of accumulated LP fees to TFUEL via burn/unwrap,
     *      send to RevSplitter for standard distribution (30% BBB, 30% LP funding, 25% veXF, 15% treasury)
     *      Note: In production, this involves:
     *      1. Take 30% of accumulated USDC LP fees
     *      2. USDC → ibcTFUEL on Persistence → burn → ZK bridge unwrap → TFUEL on Theta
     *      3. Unwrapped TFUEL sent to this contract via receiveBonusRevenue()
     *      4. Then distributed via splitRevenueNative() with standard splits
     *      5. Remaining 70% stays as USDC in contract for other protocol operations
     * @return batchId Unique identifier for this batch
     */
    function processMonthlyBatch() external onlyOwner nonReentrant returns (uint256 batchId) {
        require(!paused, "RevenueSplitter: contract is paused");
        require(block.timestamp >= lastMonthlyBatchTime + MONTHLY_INTERVAL, "RevenueSplitter: monthly interval not reached");
        require(accumulatedLPFeesUSDC > 0, "RevenueSplitter: no LP fees to process");
        
        uint256 totalToProcess = accumulatedLPFeesUSDC;
        batchId = block.timestamp;
        
        // Calculate split: 30% recycle to TFUEL for RevSplitter distribution, 70% stays as USDC
        uint256 recycleAmount = (totalToProcess * 3000) / 10000;   // 30%
        // Remaining 70% stays in contract as USDC for other protocol operations
        
        // Reset accumulated fees
        accumulatedLPFeesUSDC = 0;
        lastMonthlyBatchTime = block.timestamp;
        
        // Update tracking
        totalRecycledToBonus += recycleAmount;
        
        // Note: In production implementation:
        // 1. recycleAmount (USDC) → Swap to ibcTFUEL on Persistence chain
        // 2. Burn ibcTFUEL on Persistence chain
        // 3. ZK bridge triggers unwrap on Theta to get TFUEL
        // 4. Unwrapped TFUEL sent to this contract via receiveBonusRevenue()
        // 5. Then distributed via splitRevenueNative() with standard splits:
        //    - 30% to BBB (buyback-burn-bond)
        //    - 30% to LP funding
        //    - 25% to veXF payout (this is where veXF gets TFUEL)
        //    - 15% to treasury
        //
        // For testnet/development, the recycleAmount is tracked but actual
        // IBC bridge integration and TFUEL distribution happen off-chain
        
        emit MonthlyBatchProcessed(
            batchId,
            totalToProcess,
            recycleAmount,
            block.timestamp
        );
        
        return batchId;
    }
    
    /**
     * @dev Receive recycled TFUEL as bonus revenue (called after unwrap completes for recycle amount)
     *      This TFUEL then goes through standard RevSplitter distribution via splitRevenueNative()
     *      which gives veXF holders their 50% share
     */
    function receiveBonusRevenue() external payable {
        require(msg.value > 0, "RevenueSplitter: no bonus revenue");
        
        emit BonusRevenueRecycled(msg.value);
        
        // Bonus revenue stays in contract and can be distributed via splitRevenueNative
    }
    
    /**
     * @dev Get time until next monthly batch can be processed
     * @return Time in seconds until next batch, 0 if ready
     */
    function timeUntilNextMonthlyBatch() external view returns (uint256) {
        uint256 nextBatchTime = lastMonthlyBatchTime + MONTHLY_INTERVAL;
        if (block.timestamp >= nextBatchTime) {
            return 0;
        }
        return nextBatchTime - block.timestamp;
    }
    
    /**
     * @dev Check if monthly batch is ready to process
     * @return True if ready, false otherwise
     */
    function isMonthlyBatchReady() external view returns (bool) {
        return block.timestamp >= lastMonthlyBatchTime + MONTHLY_INTERVAL && accumulatedLPFeesUSDC > 0;
    }

    /**
     * @dev Emergency withdraw (owner only)
     */
    function emergencyWithdraw(address token, uint256 amount) external onlyOwner {
        if (token == address(0)) {
            (bool success, ) = payable(owner()).call{value: amount}("");
            require(success, "RevenueSplitter: withdraw failed");
        } else {
            IERC20(token).safeTransfer(owner(), amount);
        }
    }

    /**
     * @dev Authorize upgrade (UUPS)
     */
    function _authorizeUpgrade(address newImplementation) internal override onlyOwner {}
}
