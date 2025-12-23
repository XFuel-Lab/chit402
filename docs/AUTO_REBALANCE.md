# Auto-Rebalance for Single-Sided LP Deposits

This document describes the auto-rebalance system for maintaining pool balance when single-sided deposits are made.

## Overview

When users make single-sided LP deposits (e.g., only depositing TFUEL without XPRT), the pool ratio can become skewed (e.g., 60/40 or 40/60). The auto-rebalance system monitors pool ratios and automatically swaps excess tokens to maintain balance when the skew exceeds a configurable threshold (default: 10%).

## Architecture

### Components

1. **LPRebalancer Contract** (`contracts/LPRebalancer.sol`)
   - Monitors pool ratios
   - Executes rebalancing swaps via router
   - Uses treasury funds to fund swaps
   - Logs all rebalance transactions
   - Configurable threshold and cooldown periods

2. **Monitoring Script** (`scripts/monitor-rebalance.ts`)
   - Periodically checks pools for rebalancing needs
   - Triggers rebalance function when threshold exceeded
   - Logs rebalance history to JSON file
   - Can run as daemon for continuous monitoring

### Key Features

- **Configurable Threshold**: Default 10% (1000 basis points)
  - Pool ratio >60/40 or <40/60 triggers rebalance
- **Cooldown Period**: Prevents excessive rebalancing (default: 1 hour)
- **Treasury Funding**: Uses treasury or accumulated fees to fund swaps
- **Transaction Logging**: All rebalances logged with before/after ratios
- **Gas Efficient**: Only executes when necessary

## Deployment

### 1. Deploy LPRebalancer Contract

```bash
npx hardhat run scripts/deploy-rebalancer.ts --network <network>
```

This will:
- Deploy LPRebalancer contract
- Link to existing Router and Treasury
- Set default 10% threshold
- Save deployment info to `deployments/rebalancer-<network>.json`

### 2. Configure Treasury Approvals

The treasury contract needs to approve the rebalancer to spend tokens for swaps:

```solidity
// Approve rebalancer to spend tokens
token0.approve(rebalancerAddress, type(uint256).max);
token1.approve(rebalancerAddress, type(uint256).max);
```

### 3. Set Pool Cooldowns (Optional)

Configure per-pool cooldown periods:

```solidity
// Set 30 minute cooldown for a specific pool
rebalancer.setRebalanceCooldown(poolAddress, 1800);

// Or set default cooldown for all pools
rebalancer.setRebalanceCooldown(address(0), 3600); // 1 hour
```

## Usage

### Manual Rebalance Check

Check if a pool needs rebalancing:

```solidity
(bool needsRebalance, bool zeroForOne, uint256 swapAmount) = 
    rebalancer.checkRebalanceNeeded(poolAddress);
```

### Execute Rebalance

Execute rebalance for a pool:

```solidity
bool success = rebalancer.rebalance(poolAddress);
```

### Monitor via Script

Run one-time check:

```bash
npx hardhat run scripts/monitor-rebalance.ts --network <network>
```

Run as daemon (continuous monitoring):

```bash
REBALANCE_INTERVAL_MINUTES=60 npx hardhat run scripts/monitor-rebalance.ts --network <network> --daemon
```

The script will:
- Check all configured pools
- Execute rebalances when needed
- Log results to `logs/rebalance-log.json`

## Configuration

### Threshold Adjustment

Change the rebalance threshold (in basis points):

```solidity
// Set to 5% (500 bps)
rebalancer.setRebalanceThreshold(500);

// Set to 15% (1500 bps)
rebalancer.setRebalanceThreshold(1500);
```

### Enable/Disable

```solidity
// Disable rebalancing
rebalancer.setRebalanceEnabled(false);

// Re-enable
rebalancer.setRebalanceEnabled(true);
```

### Minimum Rebalance Amount

Set minimum amount to trigger rebalance:

```solidity
// Set minimum to 10 tokens
rebalancer.setMinRebalanceAmount(10e18);
```

## How It Works

1. **Pool Ratio Calculation**
   - Calculates current pool ratio: `token0 / (token0 + token1)`
   - Expressed in basis points (5000 = 50/50)

2. **Skew Detection**
   - Calculates deviation from ideal 50/50 ratio
   - If skew > threshold (default 10%), rebalance needed

3. **Swap Calculation**
   - Determines swap direction (token0→token1 or token1→token0)
   - Calculates swap amount to bring ratio closer to 50/50
   - Moves ratio halfway between current and balanced

4. **Execution**
   - Transfers tokens from treasury to rebalancer
   - Executes swap via router
   - Records rebalance in history
   - Emits event with before/after ratios

## Events

### RebalanceExecuted

Emitted when a rebalance is executed:

```solidity
event RebalanceExecuted(
    address indexed pool,
    uint256 ratioBefore,    // Pool ratio before rebalance (in bps)
    uint256 ratioAfter,     // Pool ratio after rebalance (in bps)
    uint256 swapAmount,     // Amount swapped
    bool zeroForOne         // Swap direction
);
```

## Security Considerations

1. **Access Control**: Only owner can configure rebalancer
2. **Cooldown**: Prevents excessive rebalancing and MEV attacks
3. **Threshold**: Minimum swap amounts prevent dust attacks
4. **Treasury Approval**: Treasury must explicitly approve rebalancer
5. **Reentrancy Protection**: Uses ReentrancyGuard

## Monitoring & Logging

### Rebalance History

Query rebalance history:

```solidity
// Get total rebalance count
uint256 count = rebalancer.getRebalanceHistoryCount();

// Get specific rebalance record
RebalanceRecord memory record = rebalancer.getRebalanceRecord(index);
```

### Log Files

The monitoring script logs all rebalances to `logs/rebalance-log.json`:

```json
[
  {
    "timestamp": 1234567890,
    "pool": "0x...",
    "poolName": "TFUEL/USDC",
    "ratioBefore": "6000",
    "ratioAfter": "5500",
    "swapAmount": "1000000000000000000",
    "zeroForOne": true,
    "txHash": "0x...",
    "success": true
  }
]
```

## Example Scenarios

### Scenario 1: Single-Sided TFUEL Deposit

1. User deposits 100 TFUEL (no XPRT)
2. Pool ratio becomes 65% TFUEL / 35% XPRT
3. Skew = 15% (exceeds 10% threshold)
4. Rebalancer swaps 10 TFUEL → XPRT
5. Pool ratio becomes ~55% TFUEL / 45% XPRT

### Scenario 2: Multiple Small Deposits

1. Multiple users deposit only token0
2. Pool gradually becomes 62% token0 / 38% token1
3. After cooldown expires, rebalancer checks
4. Skew = 12% (exceeds threshold)
5. Rebalancer executes swap to restore balance

## Troubleshooting

### Rebalance Not Executing

- Check if rebalancing is enabled: `rebalancer.rebalanceEnabled()`
- Verify pool ratio and skew: `rebalancer.calculateSkew(pool)`
- Check cooldown: `rebalancer.lastRebalanceTime(pool)`
- Verify treasury has sufficient balance and approvals

### Swap Failing

- Check treasury token balance
- Verify router has proper pool configuration
- Check minimum amount requirements
- Review router swap function for errors

## Future Enhancements

- Price oracle integration for accurate ratio calculation
- Multi-pool support with priority queuing
- Dynamic threshold adjustment based on pool size
- MEV protection via private transaction submission
- Integration with governance for threshold voting

