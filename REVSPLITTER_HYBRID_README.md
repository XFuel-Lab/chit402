# RevSplitterHybrid - XFuelLab Multi-Chain Revenue Splitter

## 🎯 Overview

**RevSplitterHybrid** is a production-ready Solidity ^0.8.20 smart contract for the @XFuelLab hybrid architecture that automatically splits protocol revenue across Theta and Persistence chains.

### Key Features

- ✅ **Multi-Chain Support**: Automatic splitting between Theta (EVM) and Persistence (Cosmos)
- ✅ **Fixed Revenue Splits**: 30% BBB, 30% LP Funding, 25% veXF Yields, 15% Innovation Treasury
- ✅ **Governance Hook**: 5-10% diversion from LP slice for governance initiatives
- ✅ **Axelar Bridge Integration**: Cross-chain LP funding bridging to Persistence
- ✅ **Comprehensive Tests**: 36 passing tests with full coverage
- ✅ **Gas Optimized**: Efficient basis point calculations and minimal storage operations
- ✅ **Security**: ReentrancyGuard, SafeERC20, Ownable access control

## 📊 Revenue Distribution

```
┌─────────────────────────────────────────────────────┐
│                 Protocol Revenue                     │
│                   (100% USDC)                        │
└──────────────┬──────────────────────────────────────┘
               │
       ┌───────┴───────┬───────────┬──────────┬─────────┐
       │               │           │          │         │
    30% BBB        30% LP      25% veXF   15% Innovation
  (Buyback &      Funding      Yields      Treasury
   Burn)          ↓ Axelar    Distributor  (Theta)
  (Theta)         Bridge
                  ↓
            Persistence LP
             Treasury
```

### Treasury Addresses

| Network | Type | Address |
|---------|------|---------|
| **Theta** | Innovation Treasury | `0x043d5231651379970d52a13CEfB4e80733DDb989` |
| **Persistence** | LP Treasury | `persistence1q50x9h4nchk2uhhj5jre0jsqxrs9qmhvjwf8yj` |

### Governance Hook

- Diverts 5-10% from LP Funding slice
- Owner-controlled activation
- Supports DAO/multisig governance initiatives

**Example with 5% diversion:**
- LP Funding: 28.5% (30% - 1.5%)
- Governance Fund: 1.5%

## 🚀 Quick Start

### 1. Installation

```bash
npm install
```

### 2. Configuration

Create `.env` file:

```bash
# Keystore
KEYSTORE_PATH=./keystore/deployer.json
KEYSTORE_PASSWORD=your_password

# Network
RPC_URL=https://eth-rpc-api.thetatoken.org/rpc

# Contracts
REVENUE_TOKEN=0x... # USDC address
BBB_CONTRACT=0x...
VEXF_DISTRIBUTOR=0x...
```

See `docs/env-revsplitter-example.txt` for full example.

### 3. Compile & Test

```bash
# Compile
npx hardhat compile

# Run tests
npx hardhat test test/RevSplitterHybrid.test.cjs

# Expected: 36 passing (12s)
```

### 4. Deploy

```bash
node scripts/deploy-revsplitter-hybrid.cjs
```

Output will include:
- Contract address
- Deployment transaction hash
- Gas cost
- Next steps for configuration

### 5. Interact

```bash
# View current configuration
REVSPLITTER_ADDRESS=0x... node scripts/interact-revsplitter.cjs
```

## 📝 Contract API

### Core Functions

#### `splitRevenue(uint256 amount)`
Split collected revenue according to tokenomics.

```solidity
// Approve revenue token first
revenueToken.approve(revSplitterAddress, amount);

// Split revenue
revSplitter.splitRevenue(amount);
```

**Events:**
- `RevenueCollected(address indexed token, uint256 amount, address indexed source)`
- `RevenueSplit(uint256 bbbAmount, uint256 lpFundingAmount, uint256 veXFYieldsAmount, uint256 innovationTreasuryAmount, uint256 governanceDivertedAmount)`

#### `calculateSplits(uint256 amount) view returns (...)`
Preview splits without executing.

```solidity
(
  uint256 bbb,
  uint256 lpFunding,
  uint256 veXFYields,
  uint256 innovationTreasury,
  uint256 governanceDiverted
) = revSplitter.calculateSplits(ethers.parseUnits('10000', 6));
```

### Admin Functions (Owner Only)

#### Configure Governance Hook

```solidity
revSplitter.configureGovernanceHook(
  500,              // 5% diversion
  governanceAddr,   // Recipient
  true              // Active
);
```

#### Update Addresses

```solidity
revSplitter.setInnovationTreasury(newAddress);
revSplitter.setBBBContract(newAddress);
revSplitter.setVeXFYieldsDistributor(newAddress);
revSplitter.setLPTreasury("persistence1...");
revSplitter.setAxelarBridgeAdapter(adapterAddress);
```

#### Manual Bridge

```solidity
// Bridge pending LP funding to Persistence
revSplitter.manualBridgeLPFunding(amount);
```

### View Functions

```solidity
// Get pending LP funding (awaiting bridge)
uint256 pending = revSplitter.getPendingLPFunding();

// Get governance hook config
(uint256 diversion, address recipient, bool active) = 
  revSplitter.getGovernanceHookConfig();

// Get statistics
uint256 totalRevenue = revSplitter.totalRevenueCollected();
uint256 totalBBB = revSplitter.totalBBBAllocated();
uint256 totalLP = revSplitter.totalLPFundingAllocated();
uint256 totalVeXF = revSplitter.totalVeXFYieldsAllocated();
uint256 totalInnovation = revSplitter.totalInnovationTreasuryAllocated();
uint256 totalGovernance = revSplitter.totalGovernanceDiverted();
```

## 📁 File Structure

```
xfuel-protocol/
├── contracts/
│   └── RevSplitterHybrid.sol          # Main contract
├── test/
│   └── RevSplitterHybrid.test.cjs     # Comprehensive tests (36 tests)
├── scripts/
│   ├── deploy-revsplitter-hybrid.cjs  # Deployment script
│   └── interact-revsplitter.cjs       # Interaction script
└── docs/
    ├── RevSplitterHybrid.md           # Full documentation
    └── env-revsplitter-example.txt    # Environment example
```

## 🧪 Test Coverage

All 36 tests passing:

```
✓ Deployment with correct addresses
✓ Revenue splitting (30/30/25/15)
✓ Governance hook (5-10% diversion)
✓ Axelar bridge integration
✓ Manual bridge for pending LP funding
✓ Admin functions (address updates)
✓ Rounding handling
✓ Access control (owner only)
✓ Emergency withdraw
✓ Event emissions
✓ View functions
```

Gas Usage:
- **Deployment**: ~1,703,288 gas (5.7% of block limit)
- **splitRevenue**: ~270k-321k gas
- **Admin updates**: ~27k-50k gas

## 🔒 Security

### Access Control
- Owner-only admin functions
- ReentrancyGuard on revenue splitting
- SafeERC20 for token transfers

### Validation
- Zero address checks
- Governance diversion limits (5-10%)
- Amount validations

### Emergency Functions
- `emergencyWithdraw`: Owner can recover stuck funds
- Pause-free design (no DoS risk)

## 🌉 Axelar Bridge Integration

### Automatic Bridging
When Axelar adapter is set, LP funding automatically bridges to Persistence:

```solidity
revSplitter.setAxelarBridgeAdapter(axelarAdapterAddress);
// Now splitRevenue() will automatically bridge LP funds
```

### Manual Bridging
If adapter not set, funds accumulate in contract:

```solidity
// Check pending funds
uint256 pending = revSplitter.getPendingLPFunding();

// Set adapter
revSplitter.setAxelarBridgeAdapter(adapterAddress);

// Manually bridge accumulated funds
revSplitter.manualBridgeLPFunding(pending);
```

## 📚 Documentation

- **Full Documentation**: [docs/RevSplitterHybrid.md](docs/RevSplitterHybrid.md)
- **Contract Source**: [contracts/RevSplitterHybrid.sol](contracts/RevSplitterHybrid.sol)
- **Tests**: [test/RevSplitterHybrid.test.cjs](test/RevSplitterHybrid.test.cjs)
- **Deployment Script**: [scripts/deploy-revsplitter-hybrid.cjs](scripts/deploy-revsplitter-hybrid.cjs)
- **Interaction Script**: [scripts/interact-revsplitter.cjs](scripts/interact-revsplitter.cjs)

## 🎯 Example Usage

### Deploy to Theta Mainnet

```bash
# 1. Prepare keystore and .env
export KEYSTORE_PATH=./keystore/deployer.json
export KEYSTORE_PASSWORD=secure_password
export REVENUE_TOKEN=0xYourUSDCAddress
export BBB_CONTRACT=0xYourBBBContract
export VEXF_DISTRIBUTOR=0xYourDistributor

# 2. Deploy
node scripts/deploy-revsplitter-hybrid.cjs

# 3. Save deployment address
export REVSPLITTER_ADDRESS=0xDeployedAddress
```

### Configure Post-Deployment

```javascript
const revSplitter = await ethers.getContractAt('RevSplitterHybrid', REVSPLITTER_ADDRESS)

// Set Axelar bridge
await revSplitter.setAxelarBridgeAdapter('0xAxelarAdapter')

// Enable 5% governance diversion
await revSplitter.configureGovernanceHook(
  500, // 5%
  '0xGovernanceMultisig',
  true
)

console.log('✅ Configuration complete!')
```

### Split Revenue

```javascript
const amount = ethers.parseUnits('10000', 6) // 10,000 USDC

// Approve
await revenueToken.approve(revSplitter.address, amount)

// Split
const tx = await revSplitter.splitRevenue(amount)
await tx.wait()

console.log('✅ Revenue split:')
console.log('  BBB:', '3,000 USDC (30%)')
console.log('  LP Funding:', '3,000 USDC (30%) → Persistence')
console.log('  veXF Yields:', '2,500 USDC (25%)')
console.log('  Innovation Treasury:', '1,500 USDC (15%)')
```

## 🤝 Contributing

1. Fork the repo
2. Create feature branch
3. Add tests for new features
4. Ensure all tests pass: `npx hardhat test`
5. Submit PR

## 📄 License

MIT License

## 🔗 Links

- **Website**: [xfuel.app](https://xfuel.app)
- **GitHub**: [xfuel-protocol](https://github.com/xfuel-protocol)
- **Docs**: [Full Documentation](docs/RevSplitterHybrid.md)

## 📞 Support

For questions or issues:
- Open a GitHub issue
- Contact: @XFuelLab

---

**Built with ❤️ for the XFuel hybrid multi-chain ecosystem**



