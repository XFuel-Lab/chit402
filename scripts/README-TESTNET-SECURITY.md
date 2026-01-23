# Testnet Security Deployment Scripts

Complete security-focused deployment suite for Theta Testnet with TimelockController, MultiSigTreasury, and emergency pause controls.

## 📁 Files Overview

### Core Deployment Script
- **`testnet-deploy-security.ts`** - Main deployment script with full security infrastructure
  - Deploys all core contracts
  - Sets up 3-of-5 multi-sig treasury
  - Configures 6-hour timelock
  - Creates 5 mock signers for testing
  - Tests pause functionality
  - Saves deployment data to JSON

### Helper Scripts
- **`deploy-testnet-security.sh`** - Bash wrapper for deployment (Linux/Mac)
- **`deploy-testnet-security.ps1`** - PowerShell wrapper for deployment (Windows)
- **`test-testnet-security.ts`** - Interactive testing script with examples

### Documentation
- **`TESTNET_DEPLOYMENT_GUIDE.md`** - Complete deployment and testing guide

## 🚀 Quick Start

### Prerequisites

1. **Install Dependencies**
   ```bash
   npm install
   ```

2. **Get Testnet TFUEL**
   - Visit: https://faucet.thetatoken.org/
   - Minimum: 50 TFUEL (100+ recommended)

3. **Configure Environment**
   
   Create `.env.local`:
   ```bash
   PRIVATE_KEY=your_testnet_private_key_here
   THETA_TESTNET_RPC=https://eth-rpc-api-testnet.thetatoken.org/rpc
   ```

### Deploy to Testnet

#### Option 1: Using Bash Script (Linux/Mac)
```bash
chmod +x scripts/deploy-testnet-security.sh
./scripts/deploy-testnet-security.sh
```

#### Option 2: Using PowerShell (Windows)
```powershell
.\scripts\deploy-testnet-security.ps1
```

#### Option 3: Direct Hardhat Command
```bash
npx hardhat run scripts/testnet-deploy-security.ts --network theta-testnet
```

#### Option 4: Local Testing (Hardhat Network)
```bash
# Terminal 1: Start local node
npx hardhat node

# Terminal 2: Deploy
npx hardhat run scripts/testnet-deploy-security.ts --network hardhat
```

## 🔐 What Gets Deployed

### Security Infrastructure
| Contract | Type | Purpose |
|----------|------|---------|
| **XFuelTimelock** | TimelockController | 6-hour delay on critical operations |
| **MultiSigTreasury** | 3-of-5 Multi-sig | Treasury management with consensus |

### Token Contracts
| Contract | Type | Purpose |
|----------|------|---------|
| **MockERC20 (USDC)** | ERC20 | Mock stablecoin (6 decimals) |
| **MockERC20 (XF)** | ERC20 | Protocol token (18 decimals) |
| **veXF** | Vote-Escrowed | Governance token |
| **rXF** | Redeemable | Redeemable token |

### Core Protocol
| Contract | Type | Purpose |
|----------|------|---------|
| **BuybackBurner** | Upgradeable | Token buyback mechanism |
| **InnovationTreasury** | Upgradeable | Innovation fund |
| **RevenueSplitter** | Upgradeable | Revenue distribution |
| **TreasuryILBackstop** | Non-upgradeable | IL protection |
| **Governance** | Upgradeable | DAO governance |
| **XFUELPoolFactory** | Non-upgradeable | Pool creation |
| **XFUELRouter** | Non-upgradeable | Main router |

## 🛡️ Security Features

### 1. TimelockController
- **Delay**: 6 hours (testnet) / 48 hours (mainnet)
- **Proposers**: Multi-sig signers
- **Executors**: Multi-sig signers
- **Purpose**: Prevents immediate execution of critical operations

### 2. MultiSigTreasury
- **Configuration**: 3-of-5 signatures required
- **Type**: UUPS Upgradeable Proxy
- **Purpose**: No single point of failure for treasury

### 3. Pausable Contracts
- **Mechanism**: Emergency circuit breaker
- **Scope**: All core upgradeable contracts
- **Purpose**: Quick response to security incidents

### 4. Access Control
- **Pattern**: Role-based access control (RBAC)
- **Implementation**: OpenZeppelin AccessControl
- **Purpose**: Restricts sensitive functions

### 5. Mock Signers (Testnet)
- **Count**: 5 test accounts
- **Funding**: 1 TFUEL each
- **Purpose**: Testing multi-sig workflows

## 📊 Deployment Output

### Console Output
The script provides detailed logging:
- ✅ Success messages for each step
- 📊 Contract addresses
- 🔒 Security configuration details
- 👥 Multi-sig signer addresses
- ⚡ Next steps and recommendations

### JSON File
Deployment data saved to: `deployments/testnet-<timestamp>.json`

Example:
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
    // ... more contracts
  },
  "configuration": {
    "timelockDelay": "6 hours",
    "multiSigRequired": "3-of-5",
    "pausableEnabled": true,
    "betaLimitsEnabled": true
  }
}
```

## 🧪 Testing

### Run Interactive Tests
```bash
# 1. Update DEPLOYMENT addresses in test-testnet-security.ts
# 2. Run the test script
npx hardhat run scripts/test-testnet-security.ts --network theta-testnet
```

### Test Examples Included
1. **Timelock Operations**: Schedule and execute delayed operations
2. **Multi-sig Transactions**: Submit and confirm transactions
3. **Emergency Pause**: Test pause/unpause functionality
4. **Token Operations**: Approve, lock, and query tokens
5. **State Queries**: Check contract configurations

## 📝 Post-Deployment Tasks

### 1. Verify Contracts
```bash
npx hardhat verify --network theta-testnet <CONTRACT_ADDRESS> <CONSTRUCTOR_ARGS>
```

### 2. Update Frontend Environment
Add to your `.env`:
```bash
VITE_TESTNET_TIMELOCK_ADDRESS=<address>
VITE_TESTNET_MULTISIG_ADDRESS=<address>
VITE_TESTNET_ROUTER_ADDRESS=<address>
# ... more addresses
VITE_NETWORK=testnet
VITE_CHAIN_ID=365
```

### 3. Test Security Features
- Test timelock operations (6-hour delay)
- Test multi-sig workflow (3-of-5 confirmations)
- Test emergency pause/unpause
- Test token approvals and transfers

### 4. Monitor Events
Set up monitoring for:
- `CallScheduled` / `CallExecuted` (Timelock)
- `SubmitTransaction` / `ConfirmTransaction` (Multi-sig)
- `Paused` / `Unpaused` (All contracts)

## 🔧 Configuration

### Testnet vs Mainnet Differences

| Feature | Testnet | Mainnet |
|---------|---------|---------|
| Timelock Delay | 6 hours | 48 hours |
| Signers | Mock accounts | Real hardware wallets |
| Tokens | Mock ERC20 | Real tokens |
| Testing | Full testing enabled | Production ready |
| Gas Price | Standard | Optimized |

### Adjusting Configuration

To modify the deployment:

1. **Change Timelock Delay**
   ```typescript
   const minDelay = 12 * 60 * 60 // 12 hours instead of 6
   ```

2. **Change Multi-sig Threshold**
   ```typescript
   const requiredSignatures = 4 // 4-of-5 instead of 3-of-5
   ```

3. **Use Real Signers**
   ```typescript
   const mockSigners = [
     '0xYourRealAddress1',
     '0xYourRealAddress2',
     // ...
   ]
   ```

## 🚨 Troubleshooting

### "Insufficient balance for deployment"
**Solution**: Get more TFUEL from https://faucet.thetatoken.org/

### "Network not configured"
**Solution**: Check `hardhat.config.cjs` has `theta-testnet` network

### "Contract compilation errors"
**Solution**: 
```bash
npx hardhat clean
npx hardhat compile
```

### "Timeout during deployment"
**Solution**: Increase timeout in `hardhat.config.cjs`:
```javascript
networks: {
  'theta-testnet': {
    timeout: 180000, // 3 minutes
  }
}
```

### "Nonce too low"
**Solution**: Reset account or wait for pending transactions

## 📚 Additional Resources

- [Theta Documentation](https://docs.thetatoken.org/)
- [Theta Testnet Explorer](https://testnet-explorer.thetatoken.org/)
- [Theta Testnet Faucet](https://faucet.thetatoken.org/)
- [OpenZeppelin Contracts](https://docs.openzeppelin.com/contracts/)
- [Hardhat Documentation](https://hardhat.org/docs)

## 🛣️ Mainnet Migration Path

When ready for mainnet:

1. **Update Configuration**
   - Change timelock delay to 48 hours
   - Replace mock signers with real addresses
   - Use real tokens instead of mocks

2. **Security Audit**
   - Complete professional audit
   - Fix identified issues
   - Re-test all functionality

3. **Deploy to Mainnet**
   - Use production deployment script
   - Verify all contracts
   - Transfer ownership to timelock/multi-sig

4. **Post-Deployment**
   - Monitor for 24-48 hours
   - Keep emergency pause ready
   - Set up monitoring and alerts

## 📞 Support

For issues or questions:
1. Check the [Deployment Guide](TESTNET_DEPLOYMENT_GUIDE.md)
2. Review troubleshooting section above
3. Check contract events and logs
4. Contact the development team

---

**Version**: 1.0.0  
**Network**: Theta Testnet (Chain ID: 365)  
**Last Updated**: January 6, 2026

## 🔑 Key Commands Reference

```bash
# Deploy to testnet
npx hardhat run scripts/testnet-deploy-security.ts --network theta-testnet

# Test security features
npx hardhat run scripts/test-testnet-security.ts --network theta-testnet

# Verify contract
npx hardhat verify --network theta-testnet <ADDRESS> <ARGS>

# Clean and compile
npx hardhat clean && npx hardhat compile

# Run local node
npx hardhat node

# Deploy to local node
npx hardhat run scripts/testnet-deploy-security.ts --network hardhat
```

## 📋 Checklist

Before deployment:
- [ ] Installed dependencies (`npm install`)
- [ ] Got testnet TFUEL (50+ TFUEL)
- [ ] Configured `.env.local` with PRIVATE_KEY
- [ ] Compiled contracts successfully
- [ ] Read the deployment guide

After deployment:
- [ ] Saved all contract addresses
- [ ] Verified contracts on explorer
- [ ] Updated frontend `.env`
- [ ] Tested timelock operations
- [ ] Tested multi-sig workflow
- [ ] Tested emergency pause
- [ ] Set up monitoring
- [ ] Documented procedures


