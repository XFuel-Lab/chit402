// SPDX-License-Identifier: MIT
pragma solidity ^0.8.22;

/**
 * @title ISwapRouter
 * @dev Interface for swap router implementations
 * This interface can be extended to match specific DEX router interfaces (e.g., Uniswap V2/V3, SushiSwap)
 */
interface ISwapRouter {
    /**
     * @dev Swap tokens
     * @param tokenIn Address of input token (revenue token)
     * @param tokenOut Address of output token (XF token)
     * @param amountIn Amount of input tokens
     * @param amountOutMin Minimum amount of output tokens (slippage protection)
     * @param to Address to receive output tokens
     * @return amountOut Amount of output tokens received
     */
    function swap(
        address tokenIn,
        address tokenOut,
        uint256 amountIn,
        uint256 amountOutMin,
        address to
    ) external returns (uint256 amountOut);
}

