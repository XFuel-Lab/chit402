# Theta EVM Bridge - Vault System

## Overview

The Theta EVM Bridge Vault System consists of two main smart contracts that enable deterministic vault creation and fee-based TFUEL deposits for cross-chain bridging:

1. **VaultFactory**: Creates and manages SubVault instances using Create2 for deterministic addresses
2. **SubVault**: Minimal vault contract that receives TFUEL, deducts 0.5% fee, and emits events for bridge indexing

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                        VaultFactory                          │
│  - Create2 deployment                                        │
│  - AccessControl (Admin & Pauser roles)                      │
│  - Pausable deposits                                         │
│  - Refund management                                         │
└────────────────┬────────────────────────────────────────────┘
                 │
                 │ deploys (Create2)
                 ▼
┌─────────────────────────────────────────────────────────────┐
│                         SubVault                             │
│  - Receives TFUEL deposits                                   │
│  - Deducts 0.5% fee → RevenueSplitter                       │
│  - Keeps net amount (backed reserves for ibcTFUEL peg)      │
│  - Emits DepositReceived event                               │
└─────────────────────────────────────────────────────────────┘
```

## Features

### VaultFactory

- **Deterministic Vault Creation**: Uses Create2 to deploy SubVaults with predictable addresses
- **Salt Generation**: `keccak256(abi.encode(userPersistenceAddress, nonce))`
- **Access Control**:
  - `DEFAULT_ADMIN_ROLE`: Can update RevSplitter, initiate refunds, manage roles
  - `PAUSER_ROLE`: Can pause/unpause vault creation
- **Pausable**: Emergency stop for vault creation during incidents
- **Refund System**: Admin can refund stuck/expired deposits from vaults

### SubVault

- **Minimal Design**: Lightweight contract optimized for gas efficiency
- **Fee Calculation**: 0.5% (50 basis points) on all deposits
- **Automatic Fee Transfer**: Sends fee to RevenueSplitter on deposit
- **Event Emission**: `DepositReceived(vault, sender, grossAmount, feeAmount, netAmount)`
- **Immutable References**: Factory and RevSplitter addresses set at deployment
- **Refund Support**: Factory can trigger refunds via access-controlled function

## Fee Structure

```
Deposit Amount: 100 TFUEL
Fee (0.5%):     0.5 TFUEL  → Sent to RevenueSplitter
Net Amount:     99.5 TFUEL → Stays in vault (backed reserves)
```

Fee calculation uses basis points:
```solidity
uint256 FEE_BASIS_POINTS = 50;
uint256 BASIS_POINTS_DENOMINATOR = 10000;
uint256 feeAmount = (depositAmount * 50) / 10000;
```

## Deployment

### Prerequisites

```bash
npm install
```

### Environment Setup

Create `.env` file:
```env
THETA_TESTNET_PRIVATE_KEY=your_private_key
THETA_MAINNET_PRIVATE_KEY=your_private_key
REV_SPLITTER_ADDRESS=0x...  # Your RevenueSplitter contract address
```

### Deploy to Theta Testnet

```bash
npx hardhat run scripts/deploy-vault-factory.cjs --network theta-testnet
```

### Deploy to Theta Mainnet

```bash
npx hardhat run scripts/deploy-vault-factory.cjs --network theta-mainnet
```

## Usage

### 1. Create a Vault

```javascript
const factory = await ethers.getContractAt('VaultFactory', FACTORY_ADDRESS)

// Generate salt for user
const userAddress = '0x...'  // User's Persistence address or identifier
const nonce = 0              // Unique nonce per vault
const salt = await factory.generateSalt(userAddress, nonce)

// Create vault
const tx = await factory.createVault(salt)
await tx.wait()

// Get vault address
const vaultAddress = await factory.predictAddress(salt)
console.log('Vault created at:', vaultAddress)
```

### 2. Predict Vault Address (Before Creation)

```javascript
const salt = await factory.generateSalt(userAddress, nonce)
const predictedAddress = await factory.predictAddress(salt)
console.log('Vault will be deployed at:', predictedAddress)
```

### 3. Deposit to Vault

```javascript
const vaultAddress = '0x...'  // From prediction or creation
const depositAmount = ethers.parseEther('100')

const tx = await signer.sendTransaction({
  to: vaultAddress,
  value: depositAmount
})
await tx.wait()

// Listen for DepositReceived event
const SubVault = await ethers.getContractFactory('SubVault')
const vault = SubVault.attach(vaultAddress)

vault.on('DepositReceived', (vault, sender, gross, fee, net) => {
  console.log('Deposit received!')
  console.log('Gross amount:', ethers.formatEther(gross))
  console.log('Fee amount:', ethers.formatEther(fee))
  console.log('Net amount:', ethers.formatEther(net))
})
```

### 4. Admin: Refund from Vault

```javascript
// Only callable by DEFAULT_ADMIN_ROLE
const vaultAddress = '0x...'
const recipientAddress = '0x...'
const refundAmount = ethers.parseEther('50')

const tx = await factory.refundFromVault(
  vaultAddress,
  recipientAddress,
  refundAmount
)
await tx.wait()
```

### 5. Admin: Update RevenueSplitter

```javascript
// Only callable by DEFAULT_ADMIN_ROLE
const newRevSplitterAddress = '0x...'

const tx = await factory.setRevSplitter(newRevSplitterAddress)
await tx.wait()

// Note: Only affects newly created vaults
```

### 6. Pauser: Pause/Unpause Factory

```javascript
// Pause vault creation (PAUSER_ROLE)
await factory.pause()

// Unpause vault creation (PAUSER_ROLE)
await factory.unpause()
```

## Interactive Scripts

### Get Factory Info

```bash
export VAULT_FACTORY_ADDRESS=0x...
export ACTION=info
npx hardhat run scripts/interact-vault-factory.cjs --network theta-testnet
```

### Create Vault

```bash
export VAULT_FACTORY_ADDRESS=0x...
export ACTION=create
export USER_ADDRESS=0x...  # User's persistence address
export NONCE=0
npx hardhat run scripts/interact-vault-factory.cjs --network theta-testnet
```

### Predict Vault Address

```bash
export VAULT_FACTORY_ADDRESS=0x...
export ACTION=predict
export USER_ADDRESS=0x...
export NONCE=0
npx hardhat run scripts/interact-vault-factory.cjs --network theta-testnet
```

### Deposit to Vault

```bash
export VAULT_FACTORY_ADDRESS=0x...
export ACTION=deposit
export USER_ADDRESS=0x...
export NONCE=0
export AMOUNT=100.0
npx hardhat run scripts/interact-vault-factory.cjs --network theta-testnet
```

### Refund from Vault (Admin only)

```bash
export VAULT_FACTORY_ADDRESS=0x...
export ACTION=refund
export VAULT_ADDRESS=0x...
export RECIPIENT_ADDRESS=0x...
export AMOUNT=50.0
npx hardhat run scripts/interact-vault-factory.cjs --network theta-testnet
```

## Testing

### Run All Tests

```bash
npm run test:contracts
```

### Run with Coverage

```bash
npm run test:coverage
```

### Test Output

The test suite includes:
- ✅ Factory deployment with access control
- ✅ Create2 deterministic vault creation
- ✅ Address prediction accuracy
- ✅ Deposit with 0.5% fee calculation
- ✅ Fee transfer to RevenueSplitter
- ✅ Multiple deposits handling
- ✅ Pause/unpause functionality
- ✅ Refund system (admin-only)
- ✅ Access control enforcement
- ✅ Edge cases (dust amounts, large deposits)
- ✅ Integration workflows

## Gas Estimates

Based on Hardhat tests:

| Operation | Gas Used |
|-----------|----------|
| Deploy VaultFactory | ~2,500,000 |
| Create SubVault | ~350,000 |
| Deposit to Vault | ~80,000 |
| Refund | ~60,000 |
| Pause/Unpause | ~45,000 |

## Security Considerations

### Access Control
- Admin role should be a multisig wallet in production
- Pauser role can be granted to monitoring systems for automatic emergency response
- Role management follows OpenZeppelin's AccessControl standard

### Pausable
- Only affects vault creation, not deposits to existing vaults
- Emergency mechanism for security incidents
- Cannot be paused indefinitely without admin action

### Refunds
- Only admin can initiate refunds
- Only works on vaults deployed by the factory
- Vault must have sufficient balance
- Used for expired/stuck deposits recovery

### Fee Transfer
- Uses low-level `call` for TFUEL transfers
- Reverts if fee transfer to RevenueSplitter fails
- No reentrancy risk (receives before external call)

### Immutability
- SubVault's factory and revSplitter addresses are immutable
- Prevents malicious updates after deployment
- Factory address change affects only new vaults

## Integration with Bridge

### Event Indexing

The bridge indexer should listen for `DepositReceived` events:

```javascript
const filter = vault.filters.DepositReceived()

provider.on(filter, (log) => {
  const event = vault.interface.parseLog(log)
  const {
    vault,
    sender,
    grossAmount,
    feeAmount,
    netAmount
  } = event.args

  // Process bridge transaction
  // Mint ibcTFUEL on Persistence chain for netAmount
})
```

### Off-Chain Vault Management

1. User provides Persistence address
2. Backend generates salt: `keccak256(abi.encode(persistenceAddress, nonce))`
3. Backend predicts vault address: `factory.predictAddress(salt)`
4. If not deployed, deploy vault: `factory.createVault(salt)`
5. Provide vault address to user for deposit
6. Monitor `DepositReceived` events
7. Mint ibcTFUEL on Persistence chain

### Nonce Management

- Start with nonce 0 for each user
- Increment nonce for additional vaults (if needed)
- Store user → nonce mapping in database
- Each vault is unique per (userAddress, nonce) pair

## Contract Addresses

### Theta Testnet
```
VaultFactory: [To be deployed]
RevenueSplitter: [Your address]
```

### Theta Mainnet
```
VaultFactory: [To be deployed]
RevenueSplitter: [Your address]
```

## API Reference

### VaultFactory

#### Functions

##### `createVault(bytes32 salt) → address`
Creates a new SubVault using Create2 deployment.

##### `predictAddress(bytes32 salt) → address`
Predicts the address of a vault before deployment.

##### `generateSalt(address user, uint256 nonce) → bytes32`
Helper to generate salt from user address and nonce.

##### `setRevSplitter(address newRevSplitter)`
Updates RevenueSplitter address (admin only).

##### `refundFromVault(address vault, address recipient, uint256 amount)`
Initiates refund from a vault (admin only).

##### `pause()` / `unpause()`
Emergency controls for vault creation (pauser role).

#### Events

- `VaultCreated(address indexed vaultAddr, bytes32 indexed salt, address indexed creator)`
- `RevSplitterUpdated(address indexed oldRevSplitter, address indexed newRevSplitter)`
- `RefundInitiated(address indexed vault, address indexed recipient, uint256 amount)`

### SubVault

#### Functions

##### `receive() external payable`
Handles incoming TFUEL deposits, calculates fee, transfers to RevenueSplitter.

##### `refund(address recipient, uint256 amount)`
Refunds amount to recipient (factory only).

##### `getBalance() → uint256`
Returns current vault balance.

#### Events

- `DepositReceived(address indexed vault, address indexed sender, uint256 grossAmount, uint256 feeAmount, uint256 netAmount)`
- `RefundProcessed(address indexed recipient, uint256 amount)`

## Development

### Compile Contracts

```bash
npx hardhat compile
```

### Run Tests

```bash
npx hardhat test
```

### Coverage Report

```bash
npx hardhat coverage
```

### Flatten Contracts (for verification)

```bash
npx hardhat flatten contracts/VaultFactory.sol > VaultFactory-flat.sol
npx hardhat flatten contracts/SubVault.sol > SubVault-flat.sol
```

## Troubleshooting

### "VaultAlreadyExists" Error
The salt you're using has already been used. Increment the nonce to generate a new unique salt.

### "Pausable: paused" Error
Vault creation is paused. Contact admin to unpause, or wait for emergency to resolve.

### "AccessControlUnauthorizedAccount" Error
You don't have the required role. Check with admin for role grants.

### Fee Transfer Failed
The RevenueSplitter address might be invalid or not accepting transfers. Verify the address.

## License

MIT

## Support

For issues and questions:
- GitHub Issues: [Your repo]
- Discord: [Your server]
- Email: [Your email]

---

**Built with ❤️ for the Theta ecosystem**

