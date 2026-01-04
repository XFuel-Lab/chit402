# RevSplitterHybrid - Quick Reference

## Contract Details

**Solidity Version**: ^0.8.20  
**Network**: Theta Mainnet (EVM) + Persistence (Cosmos via Axelar)  
**License**: MIT

## Treasury Addresses (Hardcoded)

```solidity
Innovation Treasury (Theta):  0x043d5231651379970d52a13CEfB4e80733DDb989
LP Treasury (Persistence):    persistence1q50x9h4nchk2uhhj5jre0jsqxrs9qmhvjwf8yj
```

## Revenue Splits

| Allocation | % | Basis Points | Destination |
|-----------|---|--------------|-------------|
| BBB (Buyback & Burn) | 30% | 3000 | Theta - BBB Contract |
| LP Funding | 30% | 3000 | Persistence - LP Treasury (via Axelar) |
| veXF Yields | 25% | 2500 | Theta - veXF Distributor |
| Innovation Treasury | 15% | 1500 | Theta - Innovation Treasury |
| **Total** | **100%** | **10000** | |

## Governance Hook

- **Range**: 5-10% (500-1000 basis points)
- **Source**: Diverted from LP Funding slice
- **Control**: Owner-controlled, toggleable
- **Example (5%)**: LP gets 28.5%, Governance gets 1.5%

## Files Created

```
contracts/RevSplitterHybrid.sol         - Main contract (430 lines)
test/RevSplitterHybrid.test.cjs        - Tests (36 passing, ~730 lines)
scripts/deploy-revsplitter-hybrid.cjs  - Deployment script (~250 lines)
scripts/interact-revsplitter.cjs       - Interaction script (~220 lines)
docs/RevSplitterHybrid.md              - Full documentation (~550 lines)
docs/env-revsplitter-example.txt       - Environment example
REVSPLITTER_HYBRID_README.md           - Main README (~450 lines)
```

## Quick Commands

### Compile
```bash
npx hardhat compile
```

### Test
```bash
npx hardhat test test/RevSplitterHybrid.test.cjs
# Expected: 36 passing (12s)
```

### Deploy
```bash
node scripts/deploy-revsplitter-hybrid.cjs
```

### Interact
```bash
REVSPLITTER_ADDRESS=0x... node scripts/interact-revsplitter.cjs
```

## Core Functions

### User Functions
```solidity
// Split revenue
splitRevenue(uint256 amount)

// Preview splits
calculateSplits(uint256 amount) view returns (bbb, lp, veXF, innovation, governance)

// Check pending LP funding
getPendingLPFunding() view returns (uint256)
```

### Admin Functions (Owner Only)
```solidity
// Configure governance hook
configureGovernanceHook(uint256 diversionBps, address recipient, bool active)

// Update addresses
setInnovationTreasury(address)
setBBBContract(address)
setVeXFYieldsDistributor(address)
setLPTreasury(string)
setAxelarBridgeAdapter(address)
setRevenueToken(address)

// Manual bridge
manualBridgeLPFunding(uint256 amount)

// Emergency
emergencyWithdraw(address token, uint256 amount)
```

## Events

```solidity
event RevenueCollected(address indexed token, uint256 amount, address indexed source)
event RevenueSplit(uint256 bbb, uint256 lp, uint256 veXF, uint256 innovation, uint256 governance)
event GovernanceHookConfigured(uint256 diversionBps, address recipient, bool active)
event LPFundingBridged(uint256 amount, string destinationAddress)
event InnovationTreasuryUpdated(address indexed newAddress)
event BBBContractUpdated(address indexed newAddress)
event VeXFYieldsDistributorUpdated(address indexed newAddress)
event LPTreasuryUpdated(string newAddress)
event AxelarBridgeAdapterUpdated(address indexed newAddress)
event RevenueTokenUpdated(address indexed newToken)
```

## Required Environment Variables

```bash
KEYSTORE_PATH=./keystore/deployer.json
KEYSTORE_PASSWORD=your_password
RPC_URL=https://eth-rpc-api.thetatoken.org/rpc
REVENUE_TOKEN=0x...
BBB_CONTRACT=0x...
VEXF_DISTRIBUTOR=0x...
```

## Post-Deployment Checklist

- [ ] Verify treasury addresses
- [ ] Update placeholder addresses (if any)
- [ ] Set Axelar bridge adapter
- [ ] Configure governance hook (optional)
- [ ] Test with small revenue split
- [ ] Monitor events
- [ ] Document deployment address

## Gas Costs (Approx)

| Operation | Gas | % of Block |
|-----------|-----|------------|
| Deployment | 1,703,288 | 5.7% |
| splitRevenue | 270k-321k | 0.9-1.1% |
| configureGovernanceHook | 50k-70k | 0.2-0.3% |
| Admin updates | 27k-50k | 0.1-0.2% |

## Test Coverage

✅ 36 tests passing (12s)
- Deployment validation
- Revenue splitting (30/30/25/15)
- Governance hook (5-10%)
- Axelar bridge integration
- Manual bridging
- Admin functions
- Access control
- Rounding handling
- Emergency functions
- View functions

## Security Features

✅ **ReentrancyGuard**: Protection on splitRevenue  
✅ **SafeERC20**: Safe token transfers  
✅ **Ownable**: Access control for admin functions  
✅ **Address Validation**: Zero address checks  
✅ **Governance Limits**: Hard caps (5-10%)  
✅ **Emergency Withdraw**: Owner recovery function

## Example Usage

### Split Revenue
```javascript
const amount = ethers.parseUnits('10000', 6) // 10k USDC
await revenueToken.approve(revSplitter.address, amount)
await revSplitter.splitRevenue(amount)

// Result:
// BBB: 3,000 USDC (30%)
// LP: 3,000 USDC (30%) → Persistence
// veXF: 2,500 USDC (25%)
// Innovation: 1,500 USDC (15%)
```

### Enable Governance Hook (5%)
```javascript
await revSplitter.configureGovernanceHook(
  500, // 5%
  '0xGovernanceAddress',
  true
)

// Now splits become:
// BBB: 3,000 USDC (30%)
// LP: 2,850 USDC (28.5%)
// Governance: 150 USDC (1.5%)
// veXF: 2,500 USDC (25%)
// Innovation: 1,500 USDC (15%)
```

## Troubleshooting

### "Amount must be > 0"
→ Ensure amount parameter is not zero

### "Invalid address"
→ Check address is not zero address for required fields

### "Diversion too high/low"
→ Governance diversion must be 5-10% (500-1000 bps)

### "Bridge adapter not set"
→ Set Axelar adapter before manual bridging

### "Ownable: caller is not the owner"
→ Admin functions require owner permission

## Support

📧 Contact: @XFuelLab  
🌐 Website: xfuel.app  
📚 Docs: docs/RevSplitterHybrid.md  
💻 GitHub: xfuel-protocol

---

**Last Updated**: 2025-01-03  
**Version**: 1.0.0



