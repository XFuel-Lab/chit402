# Theta EVM Bridge - Vault System

## 🎯 Overview

Complete Solidity ^0.8.20 implementation of a Theta EVM bridge vault system using OpenZeppelin libraries. The system enables deterministic vault creation and fee-based TFUEL deposits for cross-chain bridging.

## 📦 Contracts

### VaultFactory.sol
- **Create2 Deployment**: Deploys SubVaults with deterministic addresses
- **Salt Generation**: `keccak256(abi.encode(userPersistenceAddress, nonce))`
- **Access Control**: Admin (DEFAULT_ADMIN_ROLE) and Pauser (PAUSER_ROLE) roles
- **Pausable**: Emergency stop for vault creation
- **Refund System**: Admin-controlled refunds for stuck/expired deposits
- **Rev Splitter Management**: Configurable fee recipient address

### SubVault.sol
- **Minimal Design**: Lightweight payable contract for TFUEL deposits
- **0.5% Fee**: Automatic fee calculation (50 basis points / 10000)
- **Fee Transfer**: Sends fee to RevenueSplitter, keeps net amount in vault
- **Event Emission**: DepositReceived with gross, fee, and net amounts
- **Immutable References**: Factory and RevSplitter addresses set at deployment
- **Refund Support**: Factory-only refund function

## 🚀 Quick Start

### Installation

```bash
npm install
```

### Compile Contracts

```bash
npx hardhat compile
```

### Run Tests

```bash
npx hardhat test test/VaultFactory.test.cjs
```

**Test Results**: ✅ 33/33 passing

### Deploy

```bash
# Theta Testnet
export REV_SPLITTER_ADDRESS=0x...
npx hardhat run scripts/deploy-vault-factory.cjs --network theta-testnet

# Theta Mainnet
export REV_SPLITTER_ADDRESS=0x...
npx hardhat run scripts/deploy-vault-factory.cjs --network theta-mainnet
```

## 📋 Features Implemented

✅ **VaultFactory with Create2**
- Deterministic address prediction
- Salt-based deployment
- Vault tracking and verification

✅ **Access Control**
- DEFAULT_ADMIN_ROLE: Manage roles, update RevSplitter, refunds
- PAUSER_ROLE: Emergency pause/unpause
- OpenZeppelin AccessControl standard

✅ **Pausable Deposits**
- Emergency stop mechanism
- Only affects new vault creation
- Existing vaults continue operating

✅ **SubVault**
- Minimal gas-efficient design
- 0.5% fee calculation with basis points
- Automatic fee transfer to RevSplitter
- Net amount stays as backed reserves
- Safe TFUEL transfers with call{value}

✅ **Refund System**
- Admin-only refunds from vaults
- Balance checks and safety validations
- Factory-controlled access

✅ **Events**
- VaultCreated(vaultAddr, salt, creator)
- DepositReceived(vault, sender, grossAmount, feeAmount, netAmount)
- RevSplitterUpdated(oldRevSplitter, newRevSplitter)
- RefundInitiated(vault, recipient, amount)
- RefundProcessed(recipient, amount)

✅ **Full NatSpec Documentation**
- Comprehensive comments on all functions
- Parameter descriptions
- Usage examples

✅ **Comprehensive Tests**
- 33 test cases covering all scenarios
- Deployment tests
- Create2 deterministic address verification
- Deposit with fee calculation
- Access control enforcement
- Pause/unpause functionality
- Refund scenarios
- Edge cases (dust amounts, large deposits)
- Integration workflows
- Gas reporting

## 📁 Project Structure

```
contracts/
├── VaultFactory.sol      # Main factory with Create2 deployment
└── SubVault.sol          # Minimal vault for TFUEL deposits

scripts/
├── deploy-vault-factory.cjs    # Deployment script
└── interact-vault-factory.cjs  # Interactive management script

test/
└── VaultFactory.test.cjs       # Comprehensive test suite (33 tests)

docs/
└── THETA_BRIDGE_VAULT_SYSTEM.md  # Complete documentation
```

## 🔧 Usage Examples

### Create a Vault

```javascript
const factory = await ethers.getContractAt('VaultFactory', FACTORY_ADDRESS)
const salt = await factory.generateSalt(userPersistenceAddress, 0)
await factory.createVault(salt)
const vaultAddress = await factory.predictAddress(salt)
```

### Deposit to Vault

```javascript
const depositAmount = ethers.parseEther('100')
await signer.sendTransaction({ to: vaultAddress, value: depositAmount })
// Fee (0.5%): 0.5 TFUEL → RevenueSplitter
// Net: 99.5 TFUEL → Stays in vault
```

### Predict Address (Before Creation)

```javascript
const salt = await factory.generateSalt(userAddress, nonce)
const predictedAddress = await factory.predictAddress(salt)
```

### Refund (Admin Only)

```javascript
await factory.refundFromVault(vaultAddress, recipientAddress, refundAmount)
```

### Update RevenueSplitter (Admin Only)

```javascript
await factory.setRevSplitter(newRevSplitterAddress)
```

### Pause/Unpause (Pauser Role)

```javascript
await factory.pause()
await factory.unpause()
```

## 📊 Gas Estimates

| Operation | Gas Used |
|-----------|----------|
| Deploy VaultFactory | ~1,143,169 |
| Create SubVault | ~375,522 |
| Deposit to Vault | ~80,000 |
| Refund | ~43,191 |
| Pause/Unpause | ~29,902 |
| Update RevSplitter | ~30,830 |

## 🔒 Security Features

- **Access Control**: OpenZeppelin's battle-tested AccessControl
- **Pausable**: Emergency stop mechanism
- **Safe Transfers**: call{value} with success checks
- **Immutability**: Critical addresses immutable in SubVault
- **Reentrancy Protection**: State changes before external calls
- **Balance Validation**: Checks before refunds
- **Factory Verification**: Only factory can call vault refund

## 🧪 Test Coverage

```
33 passing (7s)

- VaultFactory Deployment (4 tests)
- Vault Creation (6 tests)
- SubVault Deposits (5 tests)
- Access Control (6 tests)
- Refund Functionality (5 tests)
- Edge Cases and Security (5 tests)
- Integration Tests (2 tests)
```

## 📚 Documentation

Full documentation available in `docs/THETA_BRIDGE_VAULT_SYSTEM.md`:
- Architecture diagrams
- Fee structure details
- Deployment guide
- API reference
- Integration examples
- Troubleshooting

## 🔗 Interactive Scripts

### Get Factory Info
```bash
export VAULT_FACTORY_ADDRESS=0x...
export ACTION=info
npx hardhat run scripts/interact-vault-factory.cjs --network theta-testnet
```

### Create Vault
```bash
export ACTION=create
export USER_ADDRESS=0x...
export NONCE=0
npx hardhat run scripts/interact-vault-factory.cjs --network theta-testnet
```

### Deposit to Vault
```bash
export ACTION=deposit
export AMOUNT=100.0
npx hardhat run scripts/interact-vault-factory.cjs --network theta-testnet
```

## 🎯 Integration with Bridge

1. User provides Persistence address
2. Backend generates salt: `keccak256(abi.encode(persistenceAddress, nonce))`
3. Backend predicts vault address: `factory.predictAddress(salt)`
4. If not deployed, deploy vault: `factory.createVault(salt)`
5. Provide vault address to user for deposit
6. Monitor `DepositReceived` events
7. Mint ibcTFUEL on Persistence chain for net amount

## ⚙️ Configuration

### Environment Variables

```env
THETA_TESTNET_PRIVATE_KEY=your_private_key
THETA_MAINNET_PRIVATE_KEY=your_private_key
REV_SPLITTER_ADDRESS=0x...
VAULT_FACTORY_ADDRESS=0x...  # After deployment
```

### Network Configuration

Hardhat config includes:
- Theta Testnet (Chain ID: 365)
- Theta Mainnet (Chain ID: 361)
- Solidity 0.8.20 and 0.8.22 compilers
- Optimizer enabled (200 runs)

## 🛠️ Development

### Run All Tests
```bash
npm run test:contracts
```

### With Coverage
```bash
npm run test:coverage
```

### Compile
```bash
npx hardhat compile
```

### Clean
```bash
npx hardhat clean
```

## 📝 License

MIT

## 🤝 Support

For issues and questions:
- Review `docs/THETA_BRIDGE_VAULT_SYSTEM.md`
- Check test cases in `test/VaultFactory.test.cjs`
- Use interactive scripts for debugging

---

**Built for the Theta ecosystem** 🚀

