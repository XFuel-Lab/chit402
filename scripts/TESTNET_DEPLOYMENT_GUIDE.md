# Theta Testnet Deployment Guide - Security Edition

## Overview

The `testnet-deploy-security.ts` script deploys the complete XFuel Protocol to Theta Testnet with full security infrastructure, including:

- **TimelockController**: 6-hour delay for critical operations
- **MultiSigTreasury**: 3-of-5 multi-signature wallet
- **Pausable Contracts**: Emergency pause switches on all core contracts
- **Mock Signers**: 5 test accounts for multi-sig testing
- **Complete Protocol**: All core contracts with proper security configuration

## Prerequisites

### 1. Network Configuration

Ensure your `hardhat.config.cjs` includes Theta testnet:

```javascript
'theta-testnet': {
  url: 'https://eth-rpc-api-testnet.thetatoken.org/rpc',
  chainId: 365,
}
```

### 2. Testnet TFUEL

Get testnet TFUEL from the Theta faucet:
- **Faucet URL**: https://faucet.thetatoken.org/
- **Minimum Required**: 50 TFUEL (100+ recommended)
- **Purpose**: Gas fees for contract deployments

### 3. Environment Setup

Create or update your `.env.local` file:

```bash
# Theta Testnet Configuration
PRIVATE_KEY=your_testnet_private_key_here
THETA_TESTNET_RPC=https://eth-rpc-api-testnet.thetatoken.org/rpc
```

## Deployment Steps

### Step 1: Run the Deployment Script

```bash
# Using npx hardhat
npx hardhat run scripts/testnet-deploy-security.ts --network theta-testnet

# Or using local hardhat
npm run hardhat -- run scripts/testnet-deploy-security.ts --network theta-testnet
```

### Step 2: For Local Testing (Hardhat Network)

```bash
# Start local Hardhat node
npx hardhat node

# In another terminal, deploy to local network
npx hardhat run scripts/testnet-deploy-security.ts --network hardhat
```

## Deployment Process

The script executes the following steps:

### 1. Network Validation
- Validates connection to Theta Testnet (Chain ID: 365)
- Checks deployer balance (minimum 50 TFUEL)
- Displays network and account information

### 2. Mock Token Deployment
- **USDC**: Mock stablecoin (6 decimals)
- **XF Token**: Protocol token (18 decimals)
- Mints initial supply:
  - 1,000,000 USDC to deployer
  - 10,000,000 XF to deployer

### 3. Mock Multi-Sig Signers
- Creates 5 mock wallet accounts
- Funds each with 1 TFUEL for gas
- Configures 3-of-5 signature requirement
- **⚠️ Production**: Replace with actual hardware wallet addresses

### 4. TimelockController Deployment
- **Delay**: 6 hours (testnet) / 48 hours (production)
- **Proposers**: 5 multi-sig signers
- **Executors**: 5 multi-sig signers
- **Admin**: Deployer (can be renounced)

### 5. MultiSigTreasury Deployment
- **Type**: UUPS Upgradeable Proxy
- **Configuration**: 3-of-5 signatures required
- **Linked**: To TimelockController
- **Purpose**: Secure treasury management

### 6. Core Protocol Deployment

Deploys all core contracts:

| Contract | Type | Purpose |
|----------|------|---------|
| veXF | Upgradeable | Vote-escrowed governance token |
| rXF | Upgradeable | Redeemable XF token |
| BuybackBurner | Upgradeable | Token buyback mechanism |
| InnovationTreasury | Upgradeable | Innovation fund management |
| RevenueSplitter | Upgradeable | Revenue distribution |
| TreasuryILBackstop | Non-upgradeable | Impermanent loss protection |
| Governance | Upgradeable | DAO governance |
| XFUELPoolFactory | Non-upgradeable | Pool creation |
| XFUELRouter | Non-upgradeable | Main router contract |

### 7. Contract Configuration
- Links contracts to each other
- Sets timelock for critical operations
- Configures access controls

### 8. Security Testing
- Tests pause/unpause on all pausable contracts
- Verifies emergency controls
- Validates timelock configuration

### 9. Deployment Summary
- Displays all contract addresses
- Lists multi-sig signers
- Shows security configurations
- Saves deployment data to JSON file

## Post-Deployment Tasks

### 1. Verify Contracts on Explorer

```bash
# Verify each contract individually
npx hardhat verify --network theta-testnet <CONTRACT_ADDRESS> <CONSTRUCTOR_ARGS>
```

**Explorer**: https://testnet-explorer.thetatoken.org/

### 2. Test Timelock Operations

```typescript
// Schedule a test operation
const timelockContract = await ethers.getContractAt('XFuelTimelock', TIMELOCK_ADDRESS)
const target = TARGET_CONTRACT_ADDRESS
const value = 0
const data = TARGET_CONTRACT.interface.encodeFunctionData('functionName', [args])
const predecessor = ethers.ZeroHash
const salt = ethers.id('unique-operation-id')
const delay = 6 * 60 * 60 // 6 hours

await timelockContract.schedule(target, value, data, predecessor, salt, delay)

// Wait 6 hours...

// Execute the operation
await timelockContract.execute(target, value, data, predecessor, salt)
```

### 3. Test Multi-Sig Workflow

```typescript
// Submit transaction
const multiSig = await ethers.getContractAt('MultiSigTreasury', MULTISIG_ADDRESS)
const tx = await multiSig.submitTransaction(target, value, data)

// Get transaction ID from event
const receipt = await tx.wait()
const txId = receipt.events[0].args.transactionId

// Confirm with 3 different signers
await multiSig.connect(signer1).confirmTransaction(txId)
await multiSig.connect(signer2).confirmTransaction(txId)
await multiSig.connect(signer3).confirmTransaction(txId)

// Execute (automatically if threshold met)
```

### 4. Test Emergency Pause

```typescript
// Pause a contract
const contract = await ethers.getContractAt('ContractName', CONTRACT_ADDRESS)
await contract.pause()

// Verify operations are blocked
// Try to call a function - should revert with "Pausable: paused"

// Unpause
await contract.unpause()
```

### 5. Test Token Operations

```typescript
// Approve and stake XF to veXF
const xfToken = await ethers.getContractAt('MockERC20', XF_ADDRESS)
const veXF = await ethers.getContractAt('veXF', VEXF_ADDRESS)

await xfToken.approve(veXF.address, ethers.parseEther('1000'))
await veXF.createLock(ethers.parseEther('1000'), lockDuration)

// Test swap functionality
const router = await ethers.getContractAt('XFUELRouter', ROUTER_ADDRESS)
// ... perform test swaps
```

### 6. Update Frontend Configuration

Add to your `.env` file:

```bash
# Testnet Addresses
VITE_TESTNET_TIMELOCK_ADDRESS=<TIMELOCK_ADDRESS>
VITE_TESTNET_MULTISIG_ADDRESS=<MULTISIG_ADDRESS>
VITE_TESTNET_USDC_ADDRESS=<USDC_ADDRESS>
VITE_TESTNET_XF_ADDRESS=<XF_ADDRESS>
VITE_TESTNET_VEXF_ADDRESS=<VEXF_ADDRESS>
VITE_TESTNET_RXF_ADDRESS=<RXF_ADDRESS>
VITE_TESTNET_ROUTER_ADDRESS=<ROUTER_ADDRESS>
VITE_TESTNET_REVENUE_SPLITTER_ADDRESS=<REVENUE_SPLITTER_ADDRESS>

# Network Configuration
VITE_NETWORK=testnet
VITE_CHAIN_ID=365
```

### 7. Monitor Events

```typescript
// Watch for important events
contract.on('Paused', (account) => {
  console.log('Contract paused by:', account)
})

contract.on('Unpaused', (account) => {
  console.log('Contract unpaused by:', account)
})

timelock.on('CallScheduled', (id, index, target, value, data, predecessor, delay) => {
  console.log('Operation scheduled:', id)
})

timelock.on('CallExecuted', (id, index, target, value, data) => {
  console.log('Operation executed:', id)
})
```

## Security Features

### 1. TimelockController
- **Delay**: 6 hours on testnet, 48 hours on mainnet
- **Purpose**: Prevents immediate execution of critical operations
- **Benefit**: Provides time window to detect and prevent malicious actions

### 2. MultiSigTreasury
- **Configuration**: 3-of-5 signatures
- **Purpose**: Prevents single point of failure
- **Benefit**: Requires consensus among multiple parties

### 3. Pausable Contracts
- **Mechanism**: Circuit breaker pattern
- **Purpose**: Emergency stop functionality
- **Benefit**: Quick response to security incidents

### 4. Access Control
- **Pattern**: Role-based access control (RBAC)
- **Purpose**: Restricts sensitive functions
- **Benefit**: Minimizes attack surface

### 5. Upgradeability
- **Pattern**: UUPS (Universal Upgradeable Proxy Standard)
- **Purpose**: Safe contract upgrades
- **Benefit**: Fix bugs without redeployment

## Multi-Sig Signer Information

### Testnet Configuration

The script creates 5 mock signers for testing:

```
Signer 1: <address>
Signer 2: <address>
Signer 3: <address>
Signer 4: <address>
Signer 5: <address>
```

**Required Signatures**: 3 out of 5

### Production Configuration

For mainnet deployment, replace mock signers with:

1. **Hardware Wallets** (Ledger, Trezor)
2. **Multi-party Computation** (MPC) wallets
3. **Gnosis Safe** multi-sig contracts
4. **Dedicated security keys** stored offline

## Deployment Output

The script saves deployment data to:

```
deployments/testnet-<timestamp>.json
```

Example structure:

```json
{
  "network": "theta-testnet",
  "chainId": "365",
  "timestamp": "2026-01-06T...",
  "deployer": "0x...",
  "contracts": {
    "timelock": "0x...",
    "multiSigTreasury": "0x...",
    "usdc": "0x...",
    "xfToken": "0x...",
    "veXF": "0x...",
    "rXF": "0x...",
    "buybackBurner": "0x...",
    "innovationTreasury": "0x...",
    "revenueSplitter": "0x...",
    "treasuryBackstop": "0x...",
    "governance": "0x...",
    "poolFactory": "0x...",
    "router": "0x...",
    "signers": ["0x...", "0x...", ...]
  },
  "configuration": {
    "timelockDelay": "6 hours",
    "multiSigRequired": "3-of-5",
    "pausableEnabled": true,
    "betaLimitsEnabled": true
  }
}
```

## Troubleshooting

### Issue: "Insufficient balance for deployment"

**Solution**: Get more testnet TFUEL from https://faucet.thetatoken.org/

### Issue: "Network not configured"

**Solution**: Ensure `hardhat.config.cjs` includes `theta-testnet` network

### Issue: "Contract compilation errors"

**Solution**: Run `npx hardhat clean` then `npx hardhat compile`

### Issue: "Timeout during deployment"

**Solution**: Increase timeout in hardhat config:

```javascript
networks: {
  'theta-testnet': {
    timeout: 180000, // 3 minutes
  }
}
```

### Issue: "Nonce too low"

**Solution**: Reset account nonce or wait for pending transactions

## Best Practices

### 1. Testing
- Always test on testnet before mainnet
- Test all security features thoroughly
- Simulate emergency scenarios
- Verify timelock operations

### 2. Security
- Use hardware wallets for production signers
- Keep private keys offline
- Document access procedures
- Maintain emergency contacts

### 3. Documentation
- Save all deployment addresses
- Document multi-sig procedures
- Record timelock operations
- Keep audit trail

### 4. Monitoring
- Set up event monitoring
- Track gas usage
- Monitor contract interactions
- Set up alerts for critical operations

## Mainnet Migration

When moving from testnet to mainnet:

1. **Update Configuration**
   - Change timelock delay from 6 hours to 48 hours
   - Replace mock signers with actual addresses
   - Use real tokens instead of mocks

2. **Security Audit**
   - Complete professional security audit
   - Fix any identified issues
   - Re-test all functionality

3. **Deployment Process**
   - Deploy to mainnet using production script
   - Verify all contracts
   - Transfer ownership to timelock/multi-sig
   - Test critical operations

4. **Post-Deployment**
   - Monitor for 24-48 hours
   - Keep emergency pause ready
   - Document all operations
   - Set up monitoring and alerts

## Additional Resources

- **Theta Documentation**: https://docs.thetatoken.org/
- **Theta Testnet Explorer**: https://testnet-explorer.thetatoken.org/
- **Theta Testnet Faucet**: https://faucet.thetatoken.org/
- **OpenZeppelin Documentation**: https://docs.openzeppelin.com/
- **Hardhat Documentation**: https://hardhat.org/docs

## Support

For issues or questions:
1. Check the troubleshooting section
2. Review Theta documentation
3. Check contract events and logs
4. Contact the development team

---

**Last Updated**: January 6, 2026
**Script Version**: 1.0.0
**Network**: Theta Testnet (Chain ID: 365)

