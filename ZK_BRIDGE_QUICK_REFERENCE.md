# ZK Bridge Quick Reference

## 🚀 Quick Start

### Deploy Contracts
```bash
npx hardhat run scripts/deploy-zkbridge.cjs --network theta_testnet
```

### Run Tests
```bash
npx hardhat test test/ZKBridge.Integration.v6.test.cjs
```

---

## 📝 Key Functions

### VaultFactory

#### Create Vault
```solidity
function createVault(bytes32 salt) external whenNotPaused returns (address vaultAddr)
```
```javascript
const salt = await vaultFactory.generateSalt(userPersistenceAddress, 0);
const tx = await vaultFactory.createVault(salt);
const vaultAddr = await vaultFactory.predictAddress(salt);
```

#### Unwrap From Burn (ZK Bridge Operator Only)
```solidity
function unwrapFromBurn(
    address vault,
    bytes32 burnTxHash,
    address payable recipient,
    uint256 amount
) external onlyRole(ZK_BRIDGE_ROLE)
```
```javascript
await vaultFactory.connect(zkBridgeOperator).unwrapFromBurn(
    vaultAddr,
    burnTxHash,
    recipientAddress,
    ethers.parseEther('100')
);
```

#### Refund (Admin Only)
```solidity
function refundFromVault(
    address vault,
    address payable recipient,
    uint256 amount
) external onlyRole(DEFAULT_ADMIN_ROLE)
```

### SubVault

#### Deposit (via receive)
```javascript
await signer.sendTransaction({
    to: vaultAddress,
    value: ethers.parseEther('1000')
});
```

#### Check Balance
```javascript
const balance = await vault.getBalance();
```

#### Check if Burn Processed
```javascript
const isProcessed = await vault.isBurnProcessed(burnTxHash);
```

---

## 📊 Fee & Yield Structure

| Action | Amount | Destination |
|--------|--------|-------------|
| **Deposit Fee** | 0.5% | RevenueSplitter |
| **Deposit Net** | 99.5% | Stays in vault |
| **Deposit Yield Allocation** | 30% of net | Tracked for yield |
| **Unwrap to User** | 70% | Recipient address |
| **Unwrap Yield Recycle** | 30% | Stays in protocol |

### Example: 1000 TFUEL Deposit
```
Gross: 1000 TFUEL
├─ Fee (0.5%): 5 TFUEL → RevenueSplitter
└─ Net (99.5%): 995 TFUEL → Vault
   ├─ Locked (70%): 696.5 TFUEL
   └─ Yield (30%): 298.5 TFUEL (tracked)
```

### Example: 500 TFUEL Unwrap
```
Total: 500 TFUEL
├─ To User (70%): 350 TFUEL
└─ Yield Recycle (30%): 150 TFUEL (stays in protocol)
```

---

## 🎫 Events to Monitor

### For Bridge Relayer

```solidity
event DepositReceived(
    address indexed vault,
    address indexed sender,
    uint256 grossAmount,
    uint256 feeAmount,
    uint256 netAmount,
    uint256 yieldRecycleAmount
)
```
**Action**: Mint ibcTFUEL on Persistence

```solidity
event UnwrapFromBurnTriggered(
    address indexed vault,
    bytes32 indexed burnTxHash,
    address indexed recipient,
    uint256 amount
)
```
**Action**: Log successful unwrap

---

## 🔑 Roles

```javascript
// Get role identifiers
const DEFAULT_ADMIN_ROLE = ethers.ZeroHash;
const PAUSER_ROLE = ethers.id('PAUSER_ROLE');
const ZK_BRIDGE_ROLE = ethers.id('ZK_BRIDGE_ROLE');

// Grant roles
await vaultFactory.grantRole(ZK_BRIDGE_ROLE, operatorAddress);
await vaultFactory.grantRole(PAUSER_ROLE, pauserAddress);

// Check roles
const hasRole = await vaultFactory.hasRole(ZK_BRIDGE_ROLE, address);
```

---

## 🛡️ Security Checklist

- [ ] Only grant ZK_BRIDGE_ROLE to trusted bridge operator
- [ ] Monitor UnwrapFromBurnTriggered events for anomalies
- [ ] Verify burn proofs off-chain before calling unwrapFromBurn
- [ ] Set up alerts for large unwrap amounts
- [ ] Test pause functionality in emergencies
- [ ] Regular audits of vault balances vs. ibcTFUEL supply
- [ ] Multi-sig for DEFAULT_ADMIN_ROLE in production

---

## 🧪 Testing Commands

```bash
# Compile
npx hardhat compile

# Clean and recompile
npx hardhat clean && npx hardhat compile

# Run all tests
npx hardhat test

# Run specific test
npx hardhat test test/ZKBridge.Integration.v6.test.cjs

# Run with gas reporting
REPORT_GAS=true npx hardhat test

# Coverage (if configured)
npx hardhat coverage
```

---

## 📍 Contract Addresses (Update after deployment)

```javascript
// Theta Testnet
VAULT_FACTORY_ADDRESS = '0x...'
REVENUE_SPLITTER_ADDRESS = '0x...'
ZK_BRIDGE_OPERATOR_ADDRESS = '0x...'

// Persistence Testnet
IBC_TFUEL_CONTRACT = 'persistence...'
```

---

## 🔗 Integration Example (Bridge Relayer)

```javascript
// 1. Listen for deposits on Theta
vaultFactory.on('DepositReceived', async (vault, sender, gross, fee, net, yield) => {
    console.log(`Deposit: ${ethers.formatEther(net)} TFUEL from ${sender}`);
    
    // 2. Mint ibcTFUEL on Persistence
    await persistenceClient.mintIbcTFUEL(sender, net);
});

// 3. Listen for burns on Persistence
persistenceClient.on('BurnEvent', async (burnTxHash, amount, recipient) => {
    console.log(`Burn: ${amount} ibcTFUEL, recipient: ${recipient}`);
    
    // 4. Verify burn proof (ZK/optimistic)
    const isValid = await verifyBurnProof(burnTxHash);
    if (!isValid) return;
    
    // 5. Trigger unwrap on Theta
    await vaultFactory.connect(zkBridgeOperator).unwrapFromBurn(
        vaultAddr,
        burnTxHash,
        recipient,
        amount
    );
});
```

---

## 📞 Support

- Documentation: `docs/ZK_BRIDGE_IMPLEMENTATION.md`
- Summary: `ZK_BRIDGE_DELIVERY_SUMMARY.md`
- Tests: `test/ZKBridge.Integration.v6.test.cjs`
- Deployment: `scripts/deploy-zkbridge.cjs`

---

**Last Updated**: 2026-01-01
**Version**: 1.0.0
**Status**: ✅ Production Ready

