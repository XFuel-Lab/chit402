# RevSplitterHybrid - XFuelLab Multi-Chain Revenue Splitter

## Overview

`RevSplitterHybrid` is a Solidity ^0.8.20 smart contract designed for the @XFuelLab hybrid architecture. It automatically splits protocol revenue across multiple chains (Theta + Persistence) according to predefined tokenomics.

## Revenue Splits

| Allocation | Percentage | Destination |
|-----------|-----------|-------------|
| **BBB (Buyback & Burn)** | 30% | Theta - BBB Contract |
| **LP Funding** | 30% | Persistence - LP Treasury (via Axelar) |
| **veXF Yields** | 25% | Theta - veXF Distributor |
| **Innovation Treasury** | 15% | Theta - Innovation Treasury |

## Treasury Addresses

### Theta (EVM)
- **Innovation Treasury**: `0x043d5231651379970d52a13CEfB4e80733DDb989`

### Persistence (Cosmos)
- **LP Treasury**: `persistence1q50x9h4nchk2uhhj5jre0jsqxrs9qmhvjwf8yj`

## Governance Hook

The contract includes a governance hook that allows 5-10% of the LP Funding slice to be diverted for governance-approved initiatives:

- **Minimum Diversion**: 5% (500 basis points)
- **Maximum Diversion**: 10% (1000 basis points)
- **Source**: Diverted from LP Funding allocation
- **Control**: Owner-controlled, can be toggled on/off

### Example Governance Diversion (5%)

With 5% governance diversion active:
- LP Funding: 28.5% (30% - 1.5% diverted)
- Governance Fund: 1.5% (5% of 30%)
- All other allocations unchanged

## Smart Contract Features

### Core Functions

#### `splitRevenue(uint256 amount)`
Main function to split collected revenue according to tokenomics.

**Parameters:**
- `amount`: Amount of revenue tokens to split

**Events:**
- `RevenueCollected(address indexed token, uint256 amount, address indexed source)`
- `RevenueSplit(uint256 bbbAmount, uint256 lpFundingAmount, uint256 veXFYieldsAmount, uint256 innovationTreasuryAmount, uint256 governanceDivertedAmount)`

#### `calculateSplits(uint256 amount)`
View function to preview revenue splits without executing.

**Returns:**
- `bbb`: BBB allocation
- `lpFunding`: LP funding allocation (after governance diversion)
- `veXFYields`: veXF yields allocation
- `innovationTreasury`: Innovation treasury allocation
- `governanceDiverted`: Amount diverted to governance

### Admin Functions

#### `configureGovernanceHook(uint256 diversionBps, address recipient, bool active)`
Configure the governance hook diversion.

**Parameters:**
- `diversionBps`: Diversion percentage in basis points (500-1000)
- `recipient`: Address to receive diverted funds
- `active`: Whether the hook is active

**Requirements:**
- Only callable by owner
- If active: diversionBps must be 500-1000 and recipient must be non-zero
- Emits `GovernanceHookConfigured` event

#### Address Updates
- `setInnovationTreasury(address)`
- `setBBBContract(address)`
- `setVeXFYieldsDistributor(address)`
- `setLPTreasury(string)` - Cosmos address
- `setAxelarBridgeAdapter(address)` - For cross-chain bridging
- `setRevenueToken(address)`

### Axelar Bridge Integration

The contract supports automatic bridging of LP Funding to Persistence via Axelar:

- If `axelarBridgeAdapter` is set: Funds automatically bridge on split
- If not set: Funds remain in contract as "pending"
- Use `manualBridgeLPFunding(amount)` to manually bridge pending funds

#### `getPendingLPFunding()`
Returns the amount of LP funding held in contract awaiting bridge.

#### `manualBridgeLPFunding(uint256 amount)`
Manually bridge pending LP funding (owner only).

### Emergency Functions

#### `emergencyWithdraw(address token, uint256 amount)`
Emergency withdraw function (owner only).

## Deployment

### Prerequisites

1. **Keystore File**: Encrypted wallet keystore (JSON format)
2. **Environment Variables**: See `.env.example` below
3. **Dependencies**: Hardhat, ethers.js, OpenZeppelin contracts

### Environment Setup

Create `.env` file:

```bash
# Keystore Authentication
KEYSTORE_PATH=./keystore/deployer.json
KEYSTORE_PASSWORD=your_secure_password

# Network Configuration
RPC_URL=https://eth-rpc-api.thetatoken.org/rpc

# Contract Addresses
REVENUE_TOKEN=0x... # USDC or stablecoin address
BBB_CONTRACT=0x...  # Buyback & Burn contract
VEXF_DISTRIBUTOR=0x... # veXF yields distributor

# Optional: Axelar Bridge
AXELAR_BRIDGE_ADAPTER=0x... # Axelar bridge adapter
```

### Deploy Command

```bash
# Install dependencies
npm install

# Compile contracts
npx hardhat compile

# Run tests
npx hardhat test test/RevSplitterHybrid.test.cjs

# Deploy to Theta Mainnet
node scripts/deploy-revsplitter-hybrid.cjs
```

### Deployment Output

The script will:
1. Decrypt keystore using provided password
2. Connect to specified RPC
3. Deploy `RevSplitterHybrid` contract
4. Save deployment info to `deployments/` directory
5. Print next steps and contract address

## Post-Deployment Configuration

### 1. Verify Treasury Addresses

```javascript
const innovationTreasury = await revSplitter.innovationTreasuryAddr()
const lpTreasury = await revSplitter.lpTreasuryAddr()

console.log('Innovation Treasury:', innovationTreasury)
console.log('LP Treasury:', lpTreasury)
```

### 2. Update Placeholder Addresses (if needed)

```javascript
// If deployed with placeholder addresses
await revSplitter.setBBBContract('0xActualBBBAddress')
await revSplitter.setVeXFYieldsDistributor('0xActualDistributorAddress')
```

### 3. Set Axelar Bridge Adapter

```javascript
await revSplitter.setAxelarBridgeAdapter('0xAxelarAdapterAddress')
```

### 4. Configure Governance Hook (Optional)

```javascript
// Enable 5% diversion to governance fund
await revSplitter.configureGovernanceHook(
  500, // 5%
  '0xGovernanceFundAddress',
  true // active
)
```

### 5. Test Revenue Split

```javascript
const amount = ethers.parseUnits('1000', 6) // 1000 USDC

// Approve
await revenueToken.approve(revSplitterAddress, amount)

// Split
const tx = await revSplitter.splitRevenue(amount)
await tx.wait()

// Check allocations
console.log('Total Revenue:', await revSplitter.totalRevenueCollected())
console.log('BBB Allocated:', await revSplitter.totalBBBAllocated())
console.log('LP Funding Allocated:', await revSplitter.totalLPFundingAllocated())
console.log('veXF Yields Allocated:', await revSplitter.totalVeXFYieldsAllocated())
console.log('Innovation Treasury Allocated:', await revSplitter.totalInnovationTreasuryAllocated())
console.log('Governance Diverted:', await revSplitter.totalGovernanceDiverted())
```

## Testing

### Run All Tests

```bash
npx hardhat test test/RevSplitterHybrid.test.cjs
```

### Test Coverage

The test suite covers:
- ✅ Deployment with correct addresses
- ✅ Revenue splitting (30/30/25/15)
- ✅ Governance hook (5-10% diversion from LP slice)
- ✅ Axelar bridge integration
- ✅ Manual bridge for pending LP funding
- ✅ Admin functions (address updates)
- ✅ Rounding handling
- ✅ Access control (owner only functions)
- ✅ Emergency withdraw
- ✅ Event emissions
- ✅ View functions (`calculateSplits`, `getPendingLPFunding`)

### Sample Test Output

```
  RevSplitterHybrid
    Deployment
      ✓ Should initialize with correct addresses
      ✓ Should initialize with zero totals
      ✓ Should initialize with governance hook disabled
    splitRevenue
      ✓ Should split revenue correctly (30/30/25/15)
      ✓ Should split revenue with Axelar bridge adapter
      ✓ Should handle rounding correctly
    Governance Hook
      ✓ Should apply governance diversion from LP slice (5%)
      ✓ Should apply governance diversion from LP slice (10%)
      ✓ Should not apply diversion when hook is inactive
    calculateSplits
      ✓ Should calculate splits correctly without governance hook
      ✓ Should calculate splits correctly with 5% governance diversion
    Admin Functions
      ✓ Should allow owner to update innovation treasury
      ✓ Should allow owner to update BBB contract
      ✓ Should revert if non-owner tries to update
    Manual Bridge
      ✓ Should allow owner to manually bridge pending LP funding
    Emergency Withdraw
      ✓ Should allow owner to withdraw tokens

  36 passing (2.1s)
```

## Gas Optimization

The contract is optimized for gas efficiency:
- Uses `SafeERC20` for safe token transfers
- Minimal storage reads/writes
- Efficient basis point calculations
- Reentrancy protection via `ReentrancyGuard`

## Security Features

1. **Ownable**: Admin functions restricted to contract owner
2. **ReentrancyGuard**: Protection against reentrancy attacks
3. **SafeERC20**: Safe token transfer handling
4. **Address Validation**: Zero address checks on critical functions
5. **Governance Limits**: Hard caps on governance diversion (5-10%)
6. **Emergency Withdraw**: Owner can recover stuck funds

## Events

```solidity
event RevenueCollected(address indexed token, uint256 amount, address indexed source)
event RevenueSplit(uint256 bbbAmount, uint256 lpFundingAmount, uint256 veXFYieldsAmount, uint256 innovationTreasuryAmount, uint256 governanceDivertedAmount)
event InnovationTreasuryUpdated(address indexed newAddress)
event BBBContractUpdated(address indexed newAddress)
event VeXFYieldsDistributorUpdated(address indexed newAddress)
event LPTreasuryUpdated(string newAddress)
event AxelarBridgeAdapterUpdated(address indexed newAddress)
event RevenueTokenUpdated(address indexed newToken)
event GovernanceHookConfigured(uint256 diversionBps, address recipient, bool active)
event LPFundingBridged(uint256 amount, string destinationAddress)
```

## License

MIT License

## Support

For issues or questions:
- GitHub: [xfuel-protocol](https://github.com/xfuel-protocol)
- Website: [xfuel.app](https://xfuel.app)

## Changelog

### v1.0.0 (Initial Release)
- Multi-chain revenue splitting (Theta + Persistence)
- 30% BBB, 30% LP Funding, 25% veXF Yields, 15% Innovation Treasury
- Governance hook (5-10% from LP slice)
- Axelar bridge integration
- Manual bridge for pending LP funding
- Comprehensive test suite
- Keystore-based deployment




