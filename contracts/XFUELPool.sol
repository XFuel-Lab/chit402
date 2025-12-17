// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "./IERC20.sol";

/**
 * @title XFUELPool
 * @dev Concentrated liquidity pool for TFUEL↔XPRT (forked from Theta's Uniswap-v3 style pool)
 * Supports 0.05% and 0.08% fee tiers
 */
contract XFUELPool {
    IERC20 public token0; // TFUEL
    IERC20 public token1; // XPRT
    uint24 public fee; // Fee tier: 500 (0.05%) or 800 (0.08%)
    
    uint128 public liquidity;
    uint256 public feeGrowthGlobal0X128;
    uint256 public feeGrowthGlobal1X128;
    
    // Tick info for concentrated liquidity
    struct TickInfo {
        uint128 liquidityGross;
        int128 liquidityNet;
        uint256 feeGrowthOutside0X128;
        uint256 feeGrowthOutside1X128;
    }
    
    mapping(int24 => TickInfo) public ticks;
    int24 public tick;
    
    // Pool state
    uint160 public sqrtPriceX96;
    uint256 public protocolFees0;
    uint256 public protocolFees1;
    
    address public factory;
    address public feeRecipient; // Router for fee distribution
    
    event Swap(
        address indexed sender,
        address indexed recipient,
        int256 amount0,
        int256 amount1,
        uint160 sqrtPriceX96,
        uint128 liquidity,
        int24 tick
    );
    
    event Mint(
        address indexed sender,
        address indexed owner,
        int24 tickLower,
        int24 tickUpper,
        uint128 amount,
        uint256 amount0,
        uint256 amount1
    );
    
    event Collect(
        address indexed owner,
        address indexed recipient,
        int24 tickLower,
        int24 tickUpper,
        uint128 amount0,
        uint128 amount1
    );
    
    modifier onlyFactory() {
        require(msg.sender == factory, "XFUELPool: FORBIDDEN");
        _;
    }
    
    constructor() {
        factory = msg.sender;
    }
    
    function initialize(address _token0, address _token1, uint24 _fee, uint160 _sqrtPriceX96) external {
        require(msg.sender == factory, "XFUELPool: FORBIDDEN");
        require(_fee == 500 || _fee == 800, "XFUELPool: INVALID_FEE");
        require(token0 == IERC20(address(0)), "XFUELPool: ALREADY_INITIALIZED");
        
        token0 = IERC20(_token0);
        token1 = IERC20(_token1);
        fee = _fee;
        sqrtPriceX96 = _sqrtPriceX96;
        tick = _tickFromSqrtPrice(_sqrtPriceX96);
    }
    
    function setFeeRecipient(address _feeRecipient) external onlyFactory {
        feeRecipient = _feeRecipient;
    }
    
    function swap(
        address recipient,
        bool zeroForOne,
        int256 amountSpecified,
        uint160 sqrtPriceLimitX96
    ) external returns (int256 amount0, int256 amount1) {
        require(amountSpecified != 0, "XFUELPool: INVALID_AMOUNT");
        
        uint160 sqrtPriceX96Next = sqrtPriceX96;
        uint128 liquidityCurrent = liquidity;
        
        // Simplified swap logic (full Uniswap-v3 implementation would be more complex)
        if (zeroForOne) {
            // Swap token0 for token1
            uint256 amountIn = uint256(amountSpecified);
            uint256 amountOut = _getAmountOut(amountIn, true);
            
            token0.transferFrom(msg.sender, address(this), amountIn);
            token1.transfer(recipient, amountOut);
            
            amount0 = amountSpecified;
            amount1 = -int256(amountOut);
        } else {
            // Swap token1 for token0
            uint256 amountIn = uint256(amountSpecified);
            uint256 amountOut = _getAmountOut(amountIn, false);
            
            token1.transferFrom(msg.sender, address(this), amountOut);
            token0.transfer(recipient, amountIn);
            
            amount0 = int256(amountOut);
            amount1 = -amountSpecified;
        }
        
        emit Swap(msg.sender, recipient, amount0, amount1, sqrtPriceX96Next, liquidityCurrent, tick);
    }
    
    function _getAmountOut(uint256 amountIn, bool zeroForOne) internal view returns (uint256) {
        // Simplified constant product formula: x * y = k
        uint256 reserve0 = token0.balanceOf(address(this));
        uint256 reserve1 = token1.balanceOf(address(this));
        
        if (zeroForOne) {
            uint256 amountInWithFee = amountIn * (10000 - fee) / 10000;
            return (amountInWithFee * reserve1) / (reserve0 + amountInWithFee);
        } else {
            uint256 amountInWithFee = amountIn * (10000 - fee) / 10000;
            return (amountInWithFee * reserve0) / (reserve1 + amountInWithFee);
        }
    }
    
    function _tickFromSqrtPrice(uint160 sqrtPriceX96) internal pure returns (int24) {
        // Simplified tick calculation
        return int24(int256(uint256(sqrtPriceX96)) / 2**96);
    }
    
    function collectProtocolFees() external returns (uint128 amount0, uint128 amount1) {
        amount0 = uint128(protocolFees0);
        amount1 = uint128(protocolFees1);
        
        if (amount0 > 0) {
            protocolFees0 = 0;
            token0.transfer(feeRecipient, amount0);
        }
        if (amount1 > 0) {
            protocolFees1 = 0;
            token1.transfer(feeRecipient, amount1);
        }
    }
}

