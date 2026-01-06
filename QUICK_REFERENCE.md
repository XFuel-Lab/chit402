# Quick Reference: Using the Enhanced XFUEL Protocol

## For Developers

### 1. Swap with Slippage Protection

```javascript
const { ethers } = require('ethers')

// Setup
const router = await ethers.getContractAt('XFUELRouter', ROUTER_ADDRESS)
const deadline = Math.floor(Date.now() / 1000) + 600 // 10 minutes from now

// Calculate minimum output with 1% slippage tolerance
const amountIn = ethers.parseEther('100') // 100 TFUEL
const expectedOut = ethers.parseEther('95') // Expected output
const slippageTolerance = 0.01 // 1%
const minAmountOut = expectedOut * BigInt(Math.floor((1 - slippageTolerance) * 10000)) / 10000n

// Execute swap
const tx = await router.swap(
    poolAddress,
    true, // zeroForOne
    amountIn,
    recipientAddress,
    minAmountOut,
    deadline
)
await tx.wait()
```

### 2. Auto-Route to Best Yield

```javascript
// Get optimal yield source
const [bestLST, bestAPY] = await router.getOptimalYieldSource()
console.log(`Best LST: ${bestLST} at ${bestAPY/100}% APY`)

// Auto-route with slippage protection
const amount = ethers.parseEther('50')
const minOut = calculateMinOutput(amount, 0.01) // 1% slippage
const deadline = Math.floor(Date.now() / 1000) + 600

const tx = await router.autoRouteToOptimalYield(
    amount,
    minOut,
    deadline,
    { value: amount }
)
const receipt = await tx.wait()

// Get staked amount from event
const event = receipt.events.find(e => e.event === 'SwapAndStake')
console.log(`Staked ${ethers.formatEther(event.args.stakedAmount)} tokens`)
```

### 3. Query Yield Optimizer

```javascript
const optimizer = await ethers.getContractAt('YieldOptimizer', OPTIMIZER_ADDRESS)

// Get all available LSTs and their APYs
const [symbols, apys, tokens] = await optimizer.getAllYieldSources()
for (let i = 0; i < symbols.length; i++) {
    console.log(`${symbols[i]}: ${apys[i]/100}% APY`)
}

// Check if rebalancing is beneficial
const currentLST = 'stkTIA'
const [shouldRebalance, targetLST, apyGain] = await optimizer.shouldRebalance(currentLST)
if (shouldRebalance) {
    console.log(`Rebalance from ${currentLST} to ${targetLST} for ${apyGain/100}% gain`)
}

// Get specific LST APY
const [apy, isStale] = await optimizer.getAPY('stkXPRT')
console.log(`stkXPRT APY: ${apy/100}% (stale: ${isStale})`)
```

### 4. Admin: Manage Yield Sources

```javascript
const optimizer = await ethers.getContractAt('YieldOptimizer', OPTIMIZER_ADDRESS)

// Add new yield source
await optimizer.addYieldSource(
    'stkTIA',                           // LST symbol
    '0x...token_address',               // Token address
    '0x...chainlink_oracle_address',    // Chainlink oracle
    ethers.parseEther('10000')          // Min liquidity: 10k
)

// Update yield source
await optimizer.updateYieldSource(
    'stkTIA',
    ethers.parseEther('20000') // New min liquidity: 20k
)

// Update APYs from oracles
await optimizer.updateAllAPYs()

// Remove yield source
await optimizer.removeYieldSource('stkTIA')
```

### 5. Admin: Fee Collection with TWAP

```javascript
const router = await ethers.getContractAt('XFUELRouter', ROUTER_ADDRESS)

// Take fee snapshot (call periodically, e.g., every hour)
await router.takeFeeSnapshot(poolAddress)

// After 2+ snapshots, collect fees with TWAP protection
await router.collectAndDistributeFees(poolAddress)

// Query fee snapshots
const snapshots = await router.feeSnapshots(poolAddress, index)
console.log(`Snapshot ${index}:`, snapshots)
```

## For Smart Contract Integration

### Interface Definitions

```solidity
// XFUELRouter Interface
interface IXFUELRouter {
    function swap(
        address pool,
        bool zeroForOne,
        int256 amountSpecified,
        address recipient,
        uint256 minAmountOut,
        uint256 deadline
    ) external returns (int256 amount0, int256 amount1);
    
    function swapAndStake(
        uint256 amount,
        string calldata targetLST,
        uint256 minAmountOut,
        uint256 deadline
    ) external payable returns (uint256 stakedAmount);
    
    function autoRouteToOptimalYield(
        uint256 amount,
        uint256 minAmountOut,
        uint256 deadline
    ) external payable returns (uint256 stakedAmount, string memory lstSymbol);
    
    function getOptimalYieldSource() 
        external view 
        returns (string memory lstSymbol, uint256 apy);
}

// YieldOptimizer Interface
interface IYieldOptimizer {
    function getBestYieldSource() 
        external view 
        returns (string memory bestLST, uint256 bestAPY);
    
    function getAPY(string calldata lstSymbol) 
        external view 
        returns (uint256 apy, bool isStale);
    
    function shouldRebalance(string calldata currentLST) 
        external view 
        returns (
            bool shouldRebalanceFlag,
            string memory targetLST,
            uint256 apyGain
        );
    
    function getAllYieldSources() 
        external view 
        returns (
            string[] memory symbols,
            uint256[] memory apys,
            address[] memory tokens
        );
}
```

### Example Contract Integration

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "./IXFUELRouter.sol";

contract YourProtocol {
    IXFUELRouter public router;
    
    constructor(address _router) {
        router = IXFUELRouter(_router);
    }
    
    function swapToOptimalYield(uint256 amount, uint256 slippageBps) external payable {
        require(msg.value == amount, "Incorrect value");
        
        // Calculate min output with slippage
        uint256 minOut = (amount * (10000 - slippageBps)) / 10000;
        uint256 deadline = block.timestamp + 600; // 10 minutes
        
        // Auto-route to best yield
        (uint256 staked, string memory lst) = router.autoRouteToOptimalYield{value: amount}(
            amount,
            minOut,
            deadline
        );
        
        // Handle staked amount...
    }
}
```

## Common Patterns

### Calculate Slippage

```javascript
function calculateMinOutput(amountIn, slippagePercent = 0.01) {
    const expectedOut = amountIn * 95n / 100n // Assuming 5% fee
    const slippageBps = Math.floor(slippagePercent * 10000)
    return expectedOut * BigInt(10000 - slippageBps) / 10000n
}
```

### Handle Deadlines

```javascript
// 10 minutes from now
const deadline10m = Math.floor(Date.now() / 1000) + 600

// 30 minutes from now
const deadline30m = Math.floor(Date.now() / 1000) + 1800

// Custom duration
function getDeadline(minutes) {
    return Math.floor(Date.now() / 1000) + (minutes * 60)
}
```

### Monitor Events

```javascript
// Listen for swap events
router.on('SwapExecuted', (user, pool, amountIn, amountOut, zeroForOne) => {
    console.log(`Swap: ${ethers.formatEther(amountIn)} -> ${ethers.formatEther(amountOut)}`)
})

// Listen for yield updates
optimizer.on('APYUpdatedFromOracle', (lstSymbol, apy, timestamp) => {
    console.log(`${lstSymbol} APY updated to ${apy/100}%`)
})

// Listen for fee snapshots
router.on('FeeSnapshotTaken', (pool, cumulativeFees, timestamp) => {
    console.log(`Fee snapshot: ${ethers.formatEther(cumulativeFees)} at ${new Date(timestamp * 1000)}`)
})
```

## Error Handling

### Common Errors

```javascript
try {
    await router.swap(...)
} catch (error) {
    if (error.message.includes('EXPIRED')) {
        console.error('Transaction deadline passed')
    } else if (error.message.includes('INSUFFICIENT_OUTPUT_AMOUNT')) {
        console.error('Slippage too high, reduce minAmountOut or increase tolerance')
    } else if (error.message.includes('INVALID_SLIPPAGE')) {
        console.error('minAmountOut must be greater than 0')
    } else if (error.message.includes('ReentrancyGuard: reentrant call')) {
        console.error('Reentrancy detected')
    } else {
        console.error('Unknown error:', error)
    }
}
```

## Testing

### Local Testing

```bash
# Run specific tests
npx hardhat test test/YieldOptimizer.test.cjs
npx hardhat test test/XFUELRouter.test.cjs

# Run with gas reporting
REPORT_GAS=true npx hardhat test

# Run with coverage
npx hardhat coverage
```

### Testnet Testing

```bash
# Deploy to testnet
npx hardhat run scripts/deployYieldOptimizer.cjs --network theta_testnet

# Verify contracts
npx hardhat verify --network theta_testnet <CONTRACT_ADDRESS>
```

## Gas Estimates

| Function | Gas Cost (approx) |
|----------|------------------|
| `swap()` | 150,000 - 200,000 |
| `swapAndStake()` | 180,000 - 250,000 |
| `autoRouteToOptimalYield()` | 200,000 - 300,000 |
| `takeFeeSnapshot()` | 50,000 - 80,000 |
| `collectAndDistributeFees()` | 200,000 - 400,000 |
| `updateAPYFromOracle()` | 80,000 - 120,000 |
| `getBestYieldSource()` (view) | 0 (no gas) |

*Note: Gas costs vary based on network congestion and operation complexity*

## Best Practices

1. **Always set reasonable deadlines** (5-30 minutes recommended)
2. **Use appropriate slippage tolerance** (0.5-2% for normal conditions)
3. **Check if oracle data is stale** before making decisions
4. **Monitor events** for transparency and debugging
5. **Test with small amounts** first on mainnet
6. **Handle errors gracefully** with user-friendly messages
7. **Update APYs regularly** (hourly or daily)
8. **Take fee snapshots** at consistent intervals

## Resources

- Full Documentation: `SECURITY_ENHANCEMENTS.md`
- Implementation Details: `IMPLEMENTATION_SUMMARY.md`
- Contract Tests: `test/YieldOptimizer.test.cjs`
- Deployment Script: `scripts/deployYieldOptimizer.cjs`

---

**Quick Reference Version:** 1.0.0  
**Last Updated:** January 6, 2026
