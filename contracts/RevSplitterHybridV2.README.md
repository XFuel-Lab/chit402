# RevSplitterHybridV2 - TFUEL Revenue Splitter for XFuel Lab

**Solidity ^0.8.20** | **Hardhat Tested** | **XFuel Protocol Hybrid Tokenomics**

## 🎯 Overview

`RevSplitterHybridV2` is a smart contract that automatically splits incoming TFUEL revenue according to XFuel Lab's hybrid tokenomics model. On every TFUEL receive, the contract splits funds into four primary categories with an optional governance hook for community-driven initiatives.

## 📊 Revenue Split Model

### Base Distribution (100% of TFUEL received)

| Allocation | Percentage | Description |
|------------|------------|-------------|
| **BBB (Buyback/Burn)** | 30% | Buyback XFUEL tokens and burn them |
| **LP Funding** | 30% | Bridge to Persistence as ibcTFUEL for pool seeding via Axelar |
| **veXF Yields** | 25% | Distribute to veXF stakers as yield rewards |
| **Treasury** | 15% | Innovation Treasury for protocol development |

### Governance Hook (Optional 5-10% from LP slice)

- **veXF-voted parameters**: Community governance decides diversion amount
- **Opt-in extras**: Can divert 5-10% from LP Funding for special initiatives
- **Use cases**: NFT wallet rewards on revenue milestones, community incentives, etc.

#### Example with 7.5% Governance Diversion:
- LP Funding base: 30% = 300 TFUEL
- Governance diverts: 7.5% of 300 = 22.5 TFUEL
- **Final LP Funding**: 277.5 TFUEL
- **Governance Fund**: 22.5 TFUEL

## 🏗️ Architecture

```
TFUEL Deposit (receive/fallback/splitTFUELRevenue)
    ↓
Auto-Split Engine
    ↓
┌────────────────────────────────────────────┐
│  30% → BBB Contract (Buyback & Burn)       │
│  30% → LP Funding (Axelar Bridge)          │
│  25% → veXF Yields Distributor             │
│  15% → Innovation Treasury                 │
│   0-10% → Governance Fund (opt-in)         │
└────────────────────────────────────────────┘
    ↓
Milestone Check (trigger events on thresholds)
```

## 🚀 Features

### 1. Automatic TFUEL Splitting
- **Payable `receive()`**: Automatically splits TFUEL on direct transfers
- **Payable `fallback()`**: Handles TFUEL transfers with data
- **Explicit `splitTFUELRevenue()`**: Direct function call for splitting

### 2. Governance Hook
- Configure diversion percentage (5-10% from LP slice)
- Set recipient address for diverted funds
- Toggle on/off without losing configuration
- Purpose description for transparency

### 3. Revenue Milestones
- Set threshold-based milestones (e.g., 10,000 TFUEL, 50,000 TFUEL)
- Automatic milestone detection on each split
- Event emission for milestone achievements
- Useful for triggering NFT rewards, bonuses, etc.

### 4. Axelar Bridge Integration
- Automatic bridging to Persistence via Axelar adapter
- Manual bridge function for accumulated funds
- Holds funds in contract if adapter not set (safe mode)

### 5. Admin Controls
- Update all destination addresses
- Configure governance hook parameters
- Set revenue milestones
- Emergency withdraw function

## 📝 Contract Interface

### Core Functions

```solidity
// Automatic split on TFUEL receive
receive() external payable

// Explicit TFUEL split
function splitTFUELRevenue() external payable

// Calculate splits for preview
function calculateSplits(uint256 amount) external view returns (
    uint256 bbb,
    uint256 lpFunding,
    uint256 veXFYields,
    uint256 treasury,
    uint256 governanceDiverted
)
```

### Governance Functions

```solidity
// Configure governance hook (owner only)
function configureGovernanceHook(
    uint256 _diversionBps,      // 500-1000 (5-10%)
    address _recipient,
    bool _active,
    string memory _purpose
) external onlyOwner

// Set milestone (owner only)
function setMilestone(
    uint256 milestoneId,
    uint256 threshold,          // in wei (TFUEL)
    string memory description
) external onlyOwner
```

### Admin Functions

```solidity
function setTreasury(address _newAddress) external onlyOwner
function setBBBContract(address _newAddress) external onlyOwner
function setVeXFYieldsDistributor(address _newAddress) external onlyOwner
function setLPTreasury(string memory _newAddress) external onlyOwner
function setAxelarBridgeAdapter(address _newAddress) external onlyOwner
function manualBridgeLPFunding(uint256 amount) external onlyOwner
function emergencyWithdraw(address token, uint256 amount) external onlyOwner
```

## 🔥 Events

```solidity
event TFUELReceived(uint256 amount, address indexed sender)
event RevenueSplit(uint256 bbbAmount, uint256 lpFundingAmount, uint256 veXFYieldsAmount, uint256 treasuryAmount, uint256 governanceDivertedAmount)
event GovernanceHookConfigured(uint256 diversionBps, address recipient, bool active, string purpose)
event MilestoneReached(uint256 indexed milestoneId, uint256 totalRevenue, string description)
event LPFundingBridged(uint256 amount, string destinationAddress, address bridgeAdapter)
```

## 🧪 Testing

### Run Tests
```bash
npx hardhat test test/RevSplitterHybridV2.test.cjs
```

### Test Coverage
- ✅ 47 tests passing
- Deployment validation
- TFUEL auto-split via `receive()`, `fallback()`, and explicit call
- Governance hook configuration and diversion (5%, 10%, inactive)
- Milestone setting and triggering
- Admin function access control
- Manual bridge operations
- Emergency withdraw
- Edge cases (rounding, zero amounts, insufficient balance)

## 📦 Deployment

### Constructor Parameters

```solidity
constructor(
    address _treasuryAddr,              // Innovation Treasury address
    string memory _lpTreasuryAddr,      // Persistence bech32 address (e.g., "persistence1q50x9h4nchk2uhhj5jre0jsqxrs9qmhvjwf8yj")
    address _bbbContract,               // Buyback & Burn contract
    address _veXFYieldsDistributor,     // veXF yields distributor
    address _owner                      // Contract owner
)
```

### Example Deployment Script

```javascript
const { ethers } = require('hardhat')

async function main() {
  const [deployer] = await ethers.getSigners()
  
  const RevSplitterHybridV2 = await ethers.getContractFactory('RevSplitterHybridV2')
  const revSplitter = await RevSplitterHybridV2.deploy(
    '0x043d5231651379970d52a13CEfB4e80733DDb989',  // Innovation Treasury
    'persistence1q50x9h4nchk2uhhj5jre0jsqxrs9qmhvjwf8yj',  // LP Treasury
    '0xBBBContractAddress',  // BBB Contract
    '0xVeXFDistributorAddress',  // veXF Distributor
    deployer.address  // Owner
  )
  
  await revSplitter.waitForDeployment()
  console.log('RevSplitterHybridV2 deployed to:', await revSplitter.getAddress())
}

main()
  .then(() => process.exit(0))
  .catch(error => {
    console.error(error)
    process.exit(1)
  })
```

## 💡 Usage Examples

### Basic TFUEL Split

```javascript
// Send TFUEL directly to contract (triggers receive())
await signer.sendTransaction({
  to: revSplitterAddress,
  value: ethers.parseEther('1000')  // 1000 TFUEL
})

// Or call explicit function
await revSplitter.splitTFUELRevenue({ value: ethers.parseEther('1000') })
```

### Configure Governance Hook

```javascript
// Enable 7.5% diversion from LP slice for NFT rewards
await revSplitter.configureGovernanceHook(
  750,  // 7.5% in basis points
  nftRewardAddress,
  true,  // active
  'NFT Milestone Rewards Q1 2026'
)
```

### Set Revenue Milestones

```javascript
// Milestone 0: 10,000 TFUEL
await revSplitter.setMilestone(
  0,
  ethers.parseEther('10000'),
  'First 10K TFUEL - Bronze NFT Tier'
)

// Milestone 1: 50,000 TFUEL
await revSplitter.setMilestone(
  1,
  ethers.parseEther('50000'),
  'First 50K TFUEL - Silver NFT Tier'
)
```

### Bridge Pending LP Funding

```javascript
// Set Axelar bridge adapter
await revSplitter.setAxelarBridgeAdapter(axelarAdapterAddress)

// Manually bridge pending funds
const pendingAmount = await revSplitter.getPendingLPFunding()
await revSplitter.manualBridgeLPFunding(pendingAmount)
```

## 🔐 Security Features

- **Ownable**: All admin functions protected by `onlyOwner` modifier
- **ReentrancyGuard**: `nonReentrant` protection on all payable functions
- **Safe Math**: Solidity 0.8.20+ with overflow/underflow protection
- **Validation**: Extensive input validation on all parameters
- **Emergency Withdraw**: Owner can recover stuck funds

## 📊 Gas Costs

| Operation | Gas Cost (avg) |
|-----------|----------------|
| Deploy Contract | ~2,223,312 |
| TFUEL Split (receive) | ~216,675 |
| Configure Governance Hook | ~92,043 |
| Set Milestone | ~84,464 |
| Manual Bridge | ~44,777 |

## 🛠️ Dependencies

- OpenZeppelin-style `Ownable.sol`
- OpenZeppelin-style `ReentrancyGuard.sol`
- OpenZeppelin-style `SafeERC20.sol`
- `IERC20.sol`

## 📄 License

MIT License

## 🤝 Contributing

This contract is part of the XFuel Protocol ecosystem. For questions or contributions, please contact the XFuel Labs team.

## 🔗 Links

- **XFuel Protocol**: [xfuel.app](https://xfuel.app)
- **Documentation**: See main repo README
- **Theta Network**: [thetatoken.org](https://www.thetatoken.org)
- **Persistence**: [persistence.one](https://persistence.one)

---

**Built with ❤️ by XFuel Labs**




