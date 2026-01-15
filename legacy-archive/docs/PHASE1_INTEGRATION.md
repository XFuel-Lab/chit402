# Phase 1 Tokenomics Integration Guide

This document describes how to integrate Phase 1 tokenomics contracts with the existing XFUELRouter via the adapter pattern.

## Overview

Phase 1 contracts are designed to integrate with XFUELRouter without requiring modifications to the router itself. Integration is done via the `IFeeAdapter` interface.

## Contracts

### veXF
- **Purpose**: Vote-escrowed XF token for governance and yield distribution
- **Address**: Set via `VITE_VEXF_ADDRESS` environment variable
- **Integration**: Used by RevenueSplitter for yield distribution

### RevenueSplitter
- **Purpose**: Collects and distributes protocol revenue
- **Address**: Set via `VITE_REVENUE_SPLITTER_ADDRESS` environment variable
- **Integration**: Router can call `splitRevenue()` to distribute fees

### CyberneticFeeSwitch
- **Purpose**: Governance-controlled fee tiers
- **Address**: Set via `VITE_FEE_SWITCH_ADDRESS` environment variable
- **Integration**: Implements `IFeeAdapter` interface for router integration

## Integration Pattern

### Option 1: Router Integration (Future)

The router can optionally query fee settings via the IFeeAdapter interface:

```solidity
// In XFUELRouter (future enhancement)
import "./IFeeAdapter.sol";

contract XFUELRouter {
    IFeeAdapter public feeAdapter;
    
    function setFeeAdapter(address _feeAdapter) external onlyOwner {
        feeAdapter = IFeeAdapter(_feeAdapter);
    }
    
    function calculateFee(uint256 baseFee) internal view returns (uint256) {
        if (address(feeAdapter) != address(0)) {
            return feeAdapter.getEffectiveFee(baseFee);
        }
        // Fallback to default fee calculation
        return baseFee;
    }
}
```

### Option 2: External Integration (Current)

For Phase 1, integration can be done externally:

1. **Fee Collection**: Router collects fees and calls `RevenueSplitter.splitRevenue()`
2. **Fee Query**: External services can query `CyberneticFeeSwitch.getFeeMultiplier()`
3. **Governance**: veXF holders vote on fee changes via `CyberneticFeeSwitch.setFeeMode()`

## Usage Examples

### Querying Fee Settings

```javascript
// Get current fee multiplier
const feeSwitch = await ethers.getContractAt('CyberneticFeeSwitch', FEE_SWITCH_ADDRESS);
const feeMultiplier = await feeSwitch.getFeeMultiplier();
// Returns: 10 (0.1%) for Growth mode, 100 (1.0%) for Extraction mode

// Check if fees are enabled
const feesEnabled = await feeSwitch.isFeesEnabled();

// Get effective fee for a base fee
const baseFee = 1000; // 10% base fee
const effectiveFee = await feeSwitch.getEffectiveFee(baseFee);
// Returns: 1 (0.01%) if Growth mode, 10 (0.1%) if Extraction mode
```

### Distributing Revenue

```javascript
// Distribute revenue from router
const revenueSplitter = await ethers.getContractAt('RevenueSplitter', REVENUE_SPLITTER_ADDRESS);
const revenueToken = await ethers.getContractAt('IERC20', USDC_ADDRESS);
const amount = ethers.utils.parseUnits('1000', 6); // 1000 USDC

// Approve and split
await revenueToken.approve(revenueSplitter.address, amount);
await revenueSplitter.splitRevenue(amount);

// This will:
// - 50% (500 USDC) → veXF yield
// - 25% (250 USDC) → buyback/burn (Phase 1: tracked)
// - 15% (150 USDC) → rXF mint (Phase 1: tracked)
// - 10% (100 USDC) → Treasury
```

### Governance Actions

```javascript
// Change fee mode (requires min veXF balance)
const veXF = await ethers.getContractAt('veXF', VEXF_ADDRESS);
const feeSwitch = await ethers.getContractAt('CyberneticFeeSwitch', FEE_SWITCH_ADDRESS);

// Check if user has enough veXF
const balance = await veXF.balanceOf(userAddress);
const minVeXF = await feeSwitch.minVeXFForFeeChange();

if (balance.gte(minVeXF)) {
    // Switch to Extraction mode (1.0% fees)
    await feeSwitch.setFeeMode(1); // 0 = Growth, 1 = Extraction
}
```

## Environment Variables

Add these to your `.env` file after deployment:

```bash
# Phase 1 Tokenomics Contracts
VITE_VEXF_ADDRESS=0x...
VITE_REVENUE_SPLITTER_ADDRESS=0x...
VITE_FEE_SWITCH_ADDRESS=0x...

# Token Addresses (if using mocks)
XF_TOKEN_ADDRESS=0x...
REVENUE_TOKEN_ADDRESS=0x...
```

## Testing Integration

```bash
# Test fee switching
npx hardhat test test/CyberneticFeeSwitch.test.cjs

# Test revenue splitting
npx hardhat test test/RevenueSplitter.test.cjs

# Test veXF locks and governance
npx hardhat test test/veXF.test.cjs
```

## Next Steps

1. Deploy Phase 1 contracts: `npx hardhat run scripts/phase1-deploy.ts --network theta-testnet`
2. Update environment variables with deployed addresses
3. (Optional) Integrate fee adapter into router in future phase
4. Test revenue distribution flow
5. Enable governance for fee changes

## Security Notes

- All contracts use OpenZeppelin upgradeable patterns
- UUPS upgradeability allows future improvements
- Only owner can upgrade contracts
- Fee changes have 7-day cooldown
- Minimum veXF required for governance actions

