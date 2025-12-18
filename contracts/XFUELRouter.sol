// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "./IERC20.sol";
import "./XFUELPool.sol";
import "./XFUELPoolFactory.sol";
import "./TreasuryILBackstop.sol";
import "./Ownable.sol";
import "./ReentrancyGuard.sol";
import "./SafeERC20.sol";

/**
 * @title XFUELRouter
 * @dev Router with fee splitting: 60% buyback-burn XF, 25% USDC yield to veXF, 15% treasury
 */
contract XFUELRouter is Ownable, ReentrancyGuard {
    using SafeERC20 for IERC20;
    XFUELPoolFactory public factory;
    TreasuryILBackstop public backstop;
    
    IERC20 public xfuelToken; // XF token for buyback-burn
    IERC20 public usdcToken; // USDC for veXF yield
    address public treasury;
    address public veXFContract; // veXF contract address
    
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
    }
    
    /**
     * @dev Collect protocol fees from pool and distribute according to split
     */
    function collectAndDistributeFees(address pool) external nonReentrant {
        require(pool != address(0), "XFUELRouter: invalid pool");
        XFUELPool poolContract = XFUELPool(pool);
        (uint128 amount0, uint128 amount1) = poolContract.collectProtocolFees();
        
        if (amount0 == 0 && amount1 == 0) {
            return; // No fees to distribute
        }
        
        totalFeesCollected += amount0 + amount1;
        
        // Determine which token is TFUEL and which is XPRT
        // For simplicity, assume token0 is TFUEL and token1 is XPRT
        // In production, you'd check token addresses
        
        // Convert fees to USDC equivalent for distribution (simplified)
        uint256 totalFeesUSDC = _convertToUSDC(amount0, amount1);
        
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
     * @dev Swap tokens through the pool
     * @param pool Pool address
     * @param zeroForOne Direction of swap
     * @param amountSpecified Amount to swap
     * @param recipient Recipient address
     * @param minAmountOut Minimum output amount (slippage protection)
     */
    function swap(
        address pool,
        bool zeroForOne,
        int256 amountSpecified,
        address recipient,
        uint256 minAmountOut
    ) external nonReentrant returns (int256 amount0, int256 amount1) {
        require(pool != address(0), "XFUELRouter: invalid pool");
        require(recipient != address(0), "XFUELRouter: invalid recipient");
        
        XFUELPool poolContract = XFUELPool(pool);
        
        // Get the token that needs to be transferred
        IERC20 inputToken = zeroForOne ? poolContract.token0() : poolContract.token1();
        uint256 amountIn = uint256(amountSpecified);
        
        // Transfer tokens from user to router
        inputToken.safeTransferFrom(msg.sender, address(this), amountIn);
        
        // Approve pool to spend router's tokens
        SafeERC20.safeApprove(inputToken, pool, amountIn);
        
        // Execute swap
        (amount0, amount1) = poolContract.swap(recipient, zeroForOne, amountSpecified, 0, minAmountOut);
        
        // Reset approval for gas efficiency (optional, but good practice)
        SafeERC20.safeApprove(inputToken, pool, 0);
        
        return (amount0, amount1);
    }
    
    /**
     * @dev Swap TFUEL (native) and stake the result
     * @param amount Amount of TFUEL to swap (in wei)
     * @param targetLST Target staking token (e.g., "stkXPRT", "stkATOM", "pSTAKE BTC")
     * @param minAmountOut Minimum amount of staked tokens expected (slippage protection)
     * @return stakedAmount Amount of tokens staked
     */
    function swapAndStake(
        uint256 amount,
        string calldata targetLST,
        uint256 minAmountOut
    ) external payable nonReentrant returns (uint256 stakedAmount) {
        require(amount > 0, "XFUELRouter: amount must be greater than 0");
        require(msg.value == amount, "XFUELRouter: TFUEL amount must match msg.value");
        require(bytes(targetLST).length > 0, "XFUELRouter: stake target cannot be empty");
        
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
}

