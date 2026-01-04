# ZK Bridge Hybrid - VaultFactory & SubVault

## Overview

This implementation provides a **ZK bridge hybrid system** for @XFuelLab that enables bidirectional TFUEL ↔ ibcTFUEL transfers between Theta Network and Persistence Chain. The system uses deterministic Create2 vault deployment, fee collection, yield loop integration, and ZK-verified unwrap operations.

## Architecture

### Core Components

1. **VaultFactory** - Factory contract that deploys and manages SubVault instances
2. **SubVault** - Individual vault contracts that hold TFUEL as collateral for ibcTFUEL
3. **ZK Bridge Operator** - Off-chain service that monitors burn events and triggers unwraps
4. **RevenueSplitter** - Receives protocol fees (0.5% per deposit)

### Flow Diagram

```
┌─────────────────────────────────────────────────────────────────┐
│                         WRAP FLOW                                │
│  (Theta → Persistence)                                          │
└─────────────────────────────────────────────────────────────────┘

User (Theta)
    │
    ├─→ Create deterministic vault via VaultFactory
    │   (Create2: salt = keccak256(persistenceAddr, nonce))
    │
    └─→ Deposit TFUEL to SubVault
        │
        ├─→ Deduct 0.5% fee → RevenueSplitter
        ├─→ Calculate 30% yield recycle allocation
        └─→ Emit DepositReceived event
            │
            └─→ ZK Bridge Relayer detects event
                └─→ Mints ibcTFUEL on Persistence Chain

┌─────────────────────────────────────────────────────────────────┐
│                       UNWRAP FLOW                                │
│  (Persistence → Theta)                                          │
└─────────────────────────────────────────────────────────────────┘

User (Persistence)
    │
    └─→ Burns ibcTFUEL on Persistence Chain
        │
        └─→ ZK Bridge Relayer detects burn
            │
            └─→ Verifies burn proof (ZK/optimistic)
                │
                └─→ Calls VaultFactory.unwrapFromBurn()
                    │
                    ├─→ Marks burn tx as processed (prevent replay)
                    ├─→ Calculates 30% yield recycle
                    ├─→ Sends 70% TFUEL to recipient
                    └─→ Emits UnwrapFromBurn event
```

## Key Features

### ✅ Deterministic Create2 Deployment
- Each user gets a predictable vault address based on `keccak256(persistenceAddr, nonce)`
- Allows users to know their vault address before deployment
- Supports multiple vaults per user (via different nonces)

### ✅ Fee Structure
- **0.5% deposit fee** → Sent to RevenueSplitter
- Fees fund protocol operations, buybacks, and veXF yield

### ✅ Yield Loop Integration (30% Recycle)
- **Deposit**: 30% of net deposit allocated for yield strategies
- **Unwrap**: 30% of unwrap amount recycled back to protocol
- 70% sent to recipient, 30% stays for yield generation

### ✅ UnwrapFromBurn - ZK Bridge Unlock
- Admin/ZK bridge operator triggers unlocks
- Prevents double-spending via `processedBurns` mapping
- Requires `ZK_BRIDGE_ROLE` for access control
- Tracks original recipient per burn transaction

### ✅ Access Control (OpenZeppelin)
- **DEFAULT_ADMIN_ROLE**: Update RevenueSplitter, refunds, role management
- **PAUSER_ROLE**: Emergency pause/unpause vault creation
- **ZK_BRIDGE_ROLE**: Trigger unwrapFromBurn operations

### ✅ Pause & Refund Mechanisms
- Emergency pause to stop vault creation
- Admin refunds for stuck/expired deposits
- Factory-only control over vault operations

## Smart Contracts

### VaultFactory.sol

**Key Functions:**
- `createVault(bytes32 salt)` - Deploy new SubVault with Create2
- `predictAddress(bytes32 salt)` - Calculate vault address before deployment
- `generateSalt(address userPersistenceAddress, uint256 nonce)` - Helper to generate salt
- `unwrapFromBurn(address vault, bytes32 burnTxHash, address payable recipient, uint256 amount)` - ZK bridge unlock
- `refundFromVault(address vault, address payable recipient, uint256 amount)` - Admin refund
- `setRevSplitter(address newRevSplitter)` - Update fee recipient
- `pause()` / `unpause()` - Emergency controls

**Events:**
- `VaultCreated(address indexed vaultAddr, bytes32 indexed salt, address indexed creator)`
- `UnwrapFromBurnTriggered(address indexed vault, bytes32 indexed burnTxHash, address indexed recipient, uint256 amount)`
- `RefundInitiated(address indexed vault, address indexed recipient, uint256 amount)`
- `RevSplitterUpdated(address indexed oldRevSplitter, address indexed newRevSplitter)`

### SubVault.sol

**Key Functions:**
- `receive()` - Accept TFUEL deposits, deduct 0.5% fee, emit event
- `unwrapFromBurn(bytes32 burnTxHash, address payable recipient, uint256 amount)` - Unlock TFUEL after burn verification
- `refund(address payable recipient, uint256 amount)` - Factory-triggered refund
- `getBalance()` - Query vault TFUEL balance
- `isBurnProcessed(bytes32 burnTxHash)` - Check if burn already processed
- `getUnwrapRecipient(bytes32 burnTxHash)` - Get recipient for burn tx

**Events:**
- `DepositReceived(address indexed vault, address indexed sender, uint256 grossAmount, uint256 feeAmount, uint256 netAmount, uint256 yieldRecycleAmount)`
- `UnwrapFromBurn(bytes32 indexed burnTxHash, address indexed recipient, uint256 amount, uint256 netAmount, uint256 yieldRecycleAmount)`
- `RefundProcessed(address indexed recipient, uint256 amount)`

## Constants

```solidity
// SubVault
uint256 public constant FEE_BASIS_POINTS = 50;              // 0.5%
uint256 public constant BASIS_POINTS_DENOMINATOR = 10000;   // 100%
uint256 public constant YIELD_RECYCLE_BPS = 3000;           // 30%

// VaultFactory
bytes32 public constant PAUSER_ROLE = keccak256("PAUSER_ROLE");
bytes32 public constant ZK_BRIDGE_ROLE = keccak256("ZK_BRIDGE_ROLE");
```

## Testing

### Run Tests

```bash
# Run all tests
npx hardhat test

# Run specific test file
npx hardhat test test/VaultFactory.ZKBridge.test.cjs
npx hardhat test test/ZKBridge.Integration.test.cjs

# Run with gas reporting
REPORT_GAS=true npx hardhat test
```

### Test Coverage

**Unit Tests** (`VaultFactory.ZKBridge.test.cjs`):
- ✅ Deployment & access control
- ✅ Create2 vault creation with deterministic addresses
- ✅ Deposits with 0.5% fee deduction
- ✅ Yield loop recycle calculation (30%)
- ✅ UnwrapFromBurn functionality
- ✅ Replay attack prevention
- ✅ Refund mechanisms
- ✅ Pause/unpause controls
- ✅ RevenueSplitter updates

**Integration Tests** (`ZKBridge.Integration.test.cjs`):
- ✅ Complete wrap → unwrap cycle
- ✅ Multi-user independent vaults
- ✅ Yield tracking through full flow
- ✅ Edge cases & security
- ✅ Gas optimization checks

### Gas Benchmarks

Expected gas costs (approximate):
- Vault creation: **~250k-300k gas**
- Deposit: **~60k-80k gas**
- Unwrap: **~80k-100k gas**

## Deployment

### 1. Deploy RevenueSplitter

```javascript
const RevenueSplitter = await ethers.getContractFactory('RevenueSplitter');
const revSplitter = await RevenueSplitter.deploy(/* constructor args */);
await revSplitter.deployed();
```

### 2. Deploy VaultFactory

```javascript
const VaultFactory = await ethers.getContractFactory('VaultFactory');
const vaultFactory = await VaultFactory.deploy(
  adminAddress,           // Admin address (gets all roles)
  revSplitter.address     // RevenueSplitter address
);
await vaultFactory.deployed();
```

### 3. Grant ZK Bridge Role

```javascript
const ZK_BRIDGE_ROLE = ethers.utils.keccak256(
  ethers.utils.toUtf8Bytes('ZK_BRIDGE_ROLE')
);
await vaultFactory.grantRole(ZK_BRIDGE_ROLE, zkBridgeOperatorAddress);
```

## Usage Examples

### Create Deterministic Vault

```javascript
// Generate salt from persistence address + nonce
const salt = await vaultFactory.generateSalt(userPersistenceAddress, 0);

// Predict vault address
const vaultAddr = await vaultFactory.predictAddress(salt);

// Create vault
await vaultFactory.createVault(salt);
```

### Deposit TFUEL (Wrap)

```javascript
// Send TFUEL to vault
await userSigner.sendTransaction({
  to: vaultAddr,
  value: ethers.utils.parseEther('1000')
});

// Listen for DepositReceived event
vaultFactory.on('DepositReceived', (vault, sender, grossAmount, feeAmount, netAmount, yieldRecycleAmount) => {
  console.log('Deposit received:', {
    vault,
    sender,
    gross: ethers.utils.formatEther(grossAmount),
    fee: ethers.utils.formatEther(feeAmount),
    net: ethers.utils.formatEther(netAmount),
    yieldRecycle: ethers.utils.formatEther(yieldRecycleAmount)
  });
});
```

### Unwrap TFUEL (Burn → Unlock)

```javascript
// ZK bridge operator calls this after verifying burn on Persistence
const burnTxHash = '0x...'; // From Persistence chain
const recipient = '0x...';  // TFUEL recipient on Theta
const amount = ethers.utils.parseEther('500');

await vaultFactory.connect(zkBridgeOperator).unwrapFromBurn(
  vaultAddr,
  burnTxHash,
  recipient,
  amount
);
```

## Security Considerations

### ✅ Implemented Protections

1. **Replay Attack Prevention**: `processedBurns` mapping prevents double-processing
2. **Access Control**: Role-based permissions via OpenZeppelin AccessControl
3. **Reentrancy**: Uses low-level `call` safely with checks-effects-interactions pattern
4. **Zero Address Checks**: Validates addresses in critical functions
5. **Balance Checks**: Ensures sufficient funds before transfers
6. **Immutable References**: Factory and RevSplitter addresses immutable in SubVault

### ⚠️ Additional Considerations

1. **ZK Bridge Operator Trust**: System relies on trusted ZK bridge operator for burn verification
   - Consider implementing ZK proof verification on-chain
   - Or use optimistic verification with fraud proofs + dispute period

2. **RevenueSplitter Upgrades**: Updating RevenueSplitter only affects new vaults
   - Existing vaults continue using old RevenueSplitter
   - Plan migration strategy if needed

3. **Yield Recycle**: 30% yield allocation currently stays in vault
   - Future: Route to yield strategy contracts (e.g., Theta EdgeCloud staking)

4. **Emergency Pause**: Only prevents new vault creation
   - Deposits and unwraps still work on existing vaults
   - Consider adding per-vault pause if needed

## Future Enhancements

1. **Automated Yield Strategies**
   - Route 30% recycle amounts to Theta staking
   - Compound earnings back into protocol

2. **On-Chain ZK Verification**
   - Replace trusted operator with ZK proof verification
   - Use zkSNARK/zkSTARK for burn proof validation

3. **Multi-Token Support**
   - Support wrapping other Theta tokens (THETA, TDROP, etc.)
   - Dynamic fee structure per token

4. **Liquidity Mining**
   - Reward vault depositors with protocol tokens
   - Incentivize long-term liquidity provision

## License

MIT

## Contact

- Twitter: [@XFuelLab](https://twitter.com/XFuelLab)
- GitHub: [xfuel-protocol](https://github.com/xfuel-protocol)

---

**Built with ❤️ for Theta Network & Persistence Chain**

