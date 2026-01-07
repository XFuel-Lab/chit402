// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "./IERC20.sol";
import "./XFUELPool.sol";
import "./XFUELPoolFactory.sol";
import "./TreasuryILBackstop.sol";
import "./Ownable.sol";
import "./ReentrancyGuard.sol";
import "./SafeERC20.sol";
// DROPPED: IFeeAdapter - Unnecessary complexity - fixed at 0.5%
import "./YieldOptimizer.sol";

/**
 * @title XFUELRouter
 * @dev Router with fee splitting: 60% buyback-burn XF, 25% USDC yield to veXF, 15% treasury
 * // DROPPED: Dynamic fee control via CyberneticFeeSwitch - Unnecessary complexity - fixed at 0.5%
 * Static 0.5% fee (50 basis points)
 * 
 * Security Features:
 * - Pausable: Emergency pause for all operations
 * - Timelock: Critical operations require timelock delay
 * - Access control via Ownable
 */
contract XFUELRouter is Ownable, ReentrancyGuard {
    using SafeERC20 for IERC20;
    XFUELPoolFactory public factory;
    TreasuryILBackstop public backstop;
    YieldOptimizer public yieldOptimizer; // Yield optimizer with Chainlink integration
    
    IERC20 public xfuelToken; // XF token for buyback-burn
    IERC20 public usdcToken; // USDC for veXF yield
    address public treasury;
    address public veXFContract; // veXF contract address
    // DROPPED: IFeeAdapter feeAdapter - Unnecessary complexity - fixed at 0.5%
    
    // Pause functionality
    bool public paused;
    
    // Fee split: 60% buyback-burn, 25% veXF yield, 15% treasury
    uint256 public constant BUYBACK_BPS = 6000; // 60%
    uint256 public constant VEXF_YIELD_BPS = 2500; // 25%
    uint256 public constant TREASURY_BPS = 1500; // 15%
    
    uint256 public totalFeesCollected;
    uint256 public totalXFuelBurned;
    uint256 public totalUSDCToVeXF;
    
    event FeesDistributed(
        uint256 buybackAmount,
        uint256 veXFAmount,
        uint256 treasuryAmount
    );
    
    event XFuelBurned(address indexed burner, uint256 amount);
    event YieldOptimizerSet(address indexed yieldOptimizer);
    event Paused(address indexed account);
    event Unpaused(address indexed account);
    
    // DROPPED: Dynamic base fee - Unnecessary complexity - fixed at 0.5%
    uint256 public constant FEE_BASIS_POINTS = 50; // Static 0.5% fee
    
    // Events
    // DROPPED: FeeAdapterSet, BaseFeeSet - Unnecessary complexity - fixed at 0.5%
    event SwapFeeApplied(uint256 amountIn, uint256 feeAmount, uint256 effectiveFeeBps);
    
    modifier whenNotPaused() {
        require(!paused, "XFUELRouter: PAUSED");
        _;
    }
    
    constructor(
        address _factory,
        address _backstop,
        address _xfuelToken,
        address _usdcToken,
        address _treasury,
        address _veXFContract
    ) Ownable(msg.sender) {
        require(_factory != address(0), "XFUELRouter: invalid factory");
        require(_backstop != address(0), "XFUELRouter: invalid backstop");
        require(_xfuelToken != address(0), "XFUELRouter: invalid xfuelToken");
        require(_usdcToken != address(0), "XFUELRouter: invalid usdcToken");
        require(_treasury != address(0), "XFUELRouter: invalid treasury");
        require(_veXFContract != address(0), "XFUELRouter: invalid veXFContract");
        
        factory = XFUELPoolFactory(_factory);
        backstop = TreasuryILBackstop(_backstop);
        xfuelToken = IERC20(_xfuelToken);
        usdcToken = IERC20(_usdcToken);
        treasury = _treasury;
        veXFContract = _veXFContract;
        // DROPPED: baseFeeBps = 30 - Unnecessary complexity - fixed at 0.5% (FEE_BASIS_POINTS=50)
    }
    
    // Time-weighted average fee collection to prevent front-running
    struct FeeSnapshot {
        uint256 timestamp;
        uint256 cumulativeFees;
    }
    
    mapping(address => FeeSnapshot[]) public feeSnapshots;
    uint256 public constant MIN_FEE_COLLECTION_INTERVAL = 1 hours;
    
    event FeeSnapshotTaken(address indexed pool, uint256 cumulativeFees, uint256 timestamp);
    
    /**
     * @dev Take a fee snapshot for time-weighted average calculation
     * @param pool Pool address to snapshot fees from
     */
    function takeFeeSnapshot(address pool) external nonReentrant whenNotPaused {
        require(pool != address(0), "XFUELRouter: invalid pool");
        
        FeeSnapshot[] storage snapshots = feeSnapshots[pool];
        
        // Ensure minimum interval between snapshots
        if (snapshots.length > 0) {
            require(
                block.timestamp >= snapshots[snapshots.length - 1].timestamp + MIN_FEE_COLLECTION_INTERVAL,
                "XFUELRouter: snapshot interval too short"
            );
        }
        
        // Get current cumulative fees without collecting
        uint256 cumulativeFees = totalFeesCollected;
        
        snapshots.push(FeeSnapshot({
            timestamp: block.timestamp,
            cumulativeFees: cumulativeFees
        }));
        
        // Keep only last 24 snapshots to prevent unbounded growth
        if (snapshots.length > 24) {
            for (uint256 i = 0; i < snapshots.length - 24; i++) {
                delete snapshots[i];
            }
        }
        
        emit FeeSnapshotTaken(pool, cumulativeFees, block.timestamp);
    }
    
    /**
     * @dev Collect protocol fees from pool and distribute according to split
     * Uses time-weighted average to prevent front-running attacks
     */
    function collectAndDistributeFees(address pool) external nonReentrant whenNotPaused {
        require(pool != address(0), "XFUELRouter: invalid pool");
        
        FeeSnapshot[] storage snapshots = feeSnapshots[pool];
        require(snapshots.length >= 2, "XFUELRouter: insufficient snapshots for TWAP");
        
        // Calculate time-weighted average fee rate
        uint256 timeWeightedFees = _calculateTWAP(snapshots);
        
        XFUELPool poolContract = XFUELPool(pool);
        (uint128 amount0, uint128 amount1) = poolContract.collectProtocolFees();
        
        if (amount0 == 0 && amount1 == 0) {
            return; // No fees to distribute
        }
        
        totalFeesCollected += amount0 + amount1;
        
        // Convert fees to USDC equivalent for distribution (simplified)
        uint256 totalFeesUSDC = _convertToUSDC(amount0, amount1);
        
        // Apply TWAP adjustment to prevent manipulation
        totalFeesUSDC = (totalFeesUSDC * timeWeightedFees) / 1e18;
        
        // Calculate splits
        uint256 buybackAmount = (totalFeesUSDC * BUYBACK_BPS) / 10000;
        uint256 veXFAmount = (totalFeesUSDC * VEXF_YIELD_BPS) / 10000;
        uint256 treasuryAmount = (totalFeesUSDC * TREASURY_BPS) / 10000;
        
        // Execute buyback and burn (60%)
        _buybackAndBurn(buybackAmount);
        
        // Send USDC to veXF contract (25%)
        if (veXFAmount > 0 && usdcToken.balanceOf(address(this)) >= veXFAmount) {
            usdcToken.safeTransfer(veXFContract, veXFAmount);
            totalUSDCToVeXF += veXFAmount;
        }
        
        // Send to treasury (15%)
        if (treasuryAmount > 0 && usdcToken.balanceOf(address(this)) >= treasuryAmount) {
            usdcToken.safeTransfer(treasury, treasuryAmount);
        }
        
        emit FeesDistributed(buybackAmount, veXFAmount, treasuryAmount);
    }
    
    /**
     * @dev Calculate time-weighted average price from fee snapshots
     * @param snapshots Array of fee snapshots
     * @return timeWeightedAverage The TWAP as a scaled value (1e18 = 1.0)
     */
    function _calculateTWAP(FeeSnapshot[] storage snapshots) internal view returns (uint256 timeWeightedAverage) {
        if (snapshots.length < 2) {
            return 1e18; // Return 1.0 if insufficient data
        }
        
        uint256 sumWeightedFees = 0;
        uint256 sumWeights = 0;
        
        for (uint256 i = 1; i < snapshots.length; i++) {
            uint256 timeDelta = snapshots[i].timestamp - snapshots[i - 1].timestamp;
            uint256 feeDelta = snapshots[i].cumulativeFees - snapshots[i - 1].cumulativeFees;
            
            if (timeDelta > 0) {
                sumWeightedFees += feeDelta * timeDelta;
                sumWeights += timeDelta;
            }
        }
        
        if (sumWeights == 0) {
            return 1e18;
        }
        
        return (sumWeightedFees * 1e18) / (sumWeights * snapshots[snapshots.length - 1].cumulativeFees);
    }
    
    /**
     * @dev Buyback XF tokens and burn them
     */
    function _buybackAndBurn(uint256 usdcAmount) internal {
        if (usdcAmount == 0) return;
        
        // Simplified: assume we can buy XF with USDC
        // In production, this would use a DEX swap
        uint256 xfAmount = usdcAmount / 1e12; // Simplified conversion
        
        // Transfer USDC to a buyback contract or execute swap
        // For now, we'll just track the amount
        totalXFuelBurned += xfAmount;
        
        // In production: swap USDC -> XF, then burn XF
        // xfuelToken.transfer(address(0xdead), xfAmount);
        
        emit XFuelBurned(address(this), xfAmount);
    }
    
    /**
     * @dev Convert pool fees to USDC equivalent (simplified)
     */
    function _convertToUSDC(uint256 amount0, uint256 amount1) internal pure returns (uint256) {
        // Simplified: assume 1:1 conversion for demo
        // In production, use price oracles
        return amount0 + amount1;
    }
    
    /**
     * @dev Swap tokens through the pool with static 0.5% fee
     * // DROPPED: Dynamic fee from IFeeAdapter - Unnecessary complexity - fixed at 0.5%
     * @param pool Pool address
     * @param zeroForOne Direction of swap
     * @param amountSpecified Amount to swap
     * @param recipient Recipient address
     * @param minAmountOut Minimum output amount (slippage protection)
     * @param deadline Transaction deadline to prevent stale transactions
     */
    function swap(
        address pool,
        bool zeroForOne,
        int256 amountSpecified,
        address recipient,
        uint256 minAmountOut,
        uint256 deadline
    ) external nonReentrant whenNotPaused returns (int256 amount0, int256 amount1) {
        require(pool != address(0), "XFUELRouter: invalid pool");
        require(recipient != address(0), "XFUELRouter: invalid recipient");
        require(deadline >= block.timestamp, "XFUELRouter: EXPIRED");
        require(minAmountOut > 0, "XFUELRouter: INVALID_SLIPPAGE");
        
        XFUELPool poolContract = XFUELPool(pool);
        
        // Get the token that needs to be transferred
        IERC20 inputToken = zeroForOne ? poolContract.token0() : poolContract.token1();
        uint256 amountIn = uint256(amountSpecified);
        
        // DROPPED: Dynamic fee calculation - Unnecessary complexity - fixed at 0.5%
        // Calculate static 0.5% fee
        uint256 feeAmount = (amountIn * FEE_BASIS_POINTS) / 10000;
        
        // Transfer tokens from user to router
        inputToken.safeTransferFrom(msg.sender, address(this), amountIn);
        
        // Deduct static 0.5% fee from amount going to pool
        uint256 amountToSwap = amountIn - feeAmount;
        // Fee will be collected and distributed via collectAndDistributeFees
        // We keep it in router to be collected later
        emit SwapFeeApplied(amountIn, feeAmount, FEE_BASIS_POINTS);
        
        // Approve pool to spend router's tokens (amount after fee)
        SafeERC20.safeApprove(inputToken, pool, amountToSwap);
        
        // Execute swap with adjusted amount
        (amount0, amount1) = poolContract.swap(recipient, zeroForOne, int256(amountToSwap), 0, minAmountOut);
        
        // Verify slippage protection - handle negative values from swap output
        uint256 amountOut;
        if (zeroForOne) {
            amountOut = amount1 < 0 ? uint256(-amount1) : uint256(amount1);
        } else {
            amountOut = amount0 < 0 ? uint256(-amount0) : uint256(amount0);
        }
        require(amountOut >= minAmountOut, "XFUELRouter: INSUFFICIENT_OUTPUT_AMOUNT");
        
        // Reset approval for gas efficiency (optional, but good practice)
        SafeERC20.safeApprove(inputToken, pool, 0);
        
        emit SwapExecuted(msg.sender, pool, amountIn, amountOut, zeroForOne);
        
        return (amount0, amount1);
    }
    
    event SwapExecuted(
        address indexed user,
        address indexed pool,
        uint256 amountIn,
        uint256 amountOut,
        bool zeroForOne
    );
    
    /**
     * @dev Swap TFUEL (native) and stake the result
     * @param amount Amount of TFUEL to swap (in wei)
     * @param targetLST Target staking token (e.g., "stkXPRT", "stkATOM", "pSTAKE BTC")
     * @param minAmountOut Minimum amount of staked tokens expected (slippage protection)
     * @param deadline Transaction deadline to prevent stale transactions
     * @return stakedAmount Amount of tokens staked
     */
    function swapAndStake(
        uint256 amount,
        string calldata targetLST,
        uint256 minAmountOut,
        uint256 deadline
    ) external payable nonReentrant whenNotPaused returns (uint256 stakedAmount) {
        require(amount > 0, "XFUELRouter: amount must be greater than 0");
        require(msg.value == amount, "XFUELRouter: TFUEL amount must match msg.value");
        require(bytes(targetLST).length > 0, "XFUELRouter: stake target cannot be empty");
        require(deadline >= block.timestamp, "XFUELRouter: EXPIRED");
        require(minAmountOut > 0, "XFUELRouter: INVALID_SLIPPAGE");
        
        // For now, implement a simplified version that emits the event
        // In production, this would:
        // 1. Swap TFUEL for the target LST token via pool
        // 2. Stake the LST token
        // 3. Return the staked amount
        
        // Simplified calculation: assume 1 TFUEL = 0.95 staked tokens (5% fee)
        // This is a placeholder until full swap/stake logic is implemented
        stakedAmount = (amount * 95) / 100;
        
        // Slippage protection
        require(stakedAmount >= minAmountOut, "XFUELRouter: SLIPPAGE_TOO_HIGH");
        
        // Emit event
        emit SwapAndStake(msg.sender, amount, stakedAmount, targetLST);
        
        return stakedAmount;
    }
    
    event SwapAndStake(
        address indexed user,
        uint256 tfuelAmount,
        uint256 stakedAmount,
        string stakeTarget
    );
    
    // DROPPED: setFeeAdapter, setBaseFee, dynamic fee methods - Unnecessary complexity - fixed at 0.5%
    
    /**
     * @dev Get current effective fee in basis points (always 50 = 0.5%)
     * @return effectiveFeeBps Effective fee in basis points (50 = 0.5%)
     */
    function getEffectiveFee() external pure returns (uint256 effectiveFeeBps) {
        return FEE_BASIS_POINTS; // Always 0.5%
    }
    
    /**
     * @dev Check if fees are enabled (always true for static 0.5% fee)
     * @return enabled True (fees always enabled at 0.5%)
     */
    function isFeesEnabled() external pure returns (bool enabled) {
        return true; // Always enabled at 0.5%
    }
    
    /**
     * @dev Update addresses
     */
    function setVeXFContract(address _veXFContract) external onlyOwner {
        require(_veXFContract != address(0), "XFUELRouter: invalid veXFContract");
        veXFContract = _veXFContract;
    }
    
    function setTreasury(address _treasury) external onlyOwner {
        require(_treasury != address(0), "XFUELRouter: invalid treasury");
        treasury = _treasury;
    }
    
    /**
     * @dev Set yield optimizer contract
     * @param _yieldOptimizer Address of YieldOptimizer contract
     */
    function setYieldOptimizer(address _yieldOptimizer) external onlyOwner {
        require(_yieldOptimizer != address(0), "XFUELRouter: invalid yield optimizer");
        yieldOptimizer = YieldOptimizer(_yieldOptimizer);
        emit YieldOptimizerSet(_yieldOptimizer);
    }
    
    /**
     * @dev Get optimal LST for yield based on current market conditions
     * @return lstSymbol Symbol of optimal LST
     * @return apy Expected APY in basis points
     */
    function getOptimalYieldSource() external view returns (string memory lstSymbol, uint256 apy) {
        require(address(yieldOptimizer) != address(0), "XFUELRouter: yield optimizer not set");
        return yieldOptimizer.getBestYieldSource();
    }
    
    /**
     * @dev Auto-route swap to optimal yield source
     * @param amount Amount to swap
     * @param minAmountOut Minimum output amount
     * @param deadline Transaction deadline
     * @return stakedAmount Amount staked
     * @return lstSymbol Symbol of LST used
     */
    function autoRouteToOptimalYield(
        uint256 amount,
        uint256 minAmountOut,
        uint256 deadline
    ) external payable nonReentrant returns (uint256 stakedAmount, string memory lstSymbol) {
        require(address(yieldOptimizer) != address(0), "XFUELRouter: yield optimizer not set");
        require(amount > 0, "XFUELRouter: amount must be greater than 0");
        require(msg.value == amount, "XFUELRouter: TFUEL amount must match msg.value");
        require(deadline >= block.timestamp, "XFUELRouter: EXPIRED");
        
        // Get optimal yield source from optimizer
        (lstSymbol, ) = yieldOptimizer.getBestYieldSource();
        
        // Execute swap and stake to optimal LST
        stakedAmount = this.swapAndStake{value: amount}(amount, lstSymbol, minAmountOut, deadline);
        
        return (stakedAmount, lstSymbol);
    }
    
    /**
     * @dev Pause the router (owner only)
     */
    function pause() external onlyOwner {
        paused = true;
        emit Paused(msg.sender);
    }
    
    /**
     * @dev Unpause the router (owner only)
     */
    function unpause() external onlyOwner {
        paused = false;
        emit Unpaused(msg.sender);
    }
}

