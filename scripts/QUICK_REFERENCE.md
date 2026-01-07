# 🚀 Quick Reference Card - Testnet Security Deployment

## One-Command Deployment

### Windows (PowerShell)
```powershell
.\scripts\deploy-testnet-security.ps1
```

### Linux/Mac (Bash)
```bash
chmod +x scripts/deploy-testnet-security.sh && ./scripts/deploy-testnet-security.sh
```

### Direct (Any OS)
```bash
npx hardhat run scripts/testnet-deploy-security.ts --network theta-testnet
```

---

## Pre-Flight Checklist

- [ ] **Node.js**: v18+ installed
- [ ] **Dependencies**: Run `npm install`
- [ ] **TFUEL**: Get 50+ testnet TFUEL from https://faucet.thetatoken.org/
- [ ] **Private Key**: Set in `.env.local`:
  ```
  PRIVATE_KEY=your_testnet_private_key_here
  ```

---

## What Gets Deployed

✅ TimelockController (6-hour delay)  
✅ MultiSigTreasury (3-of-5 signatures)  
✅ 5 Mock signers (funded with 1 TFUEL each)  
✅ Mock tokens (USDC, XF)  
✅ Core protocol (veXF, rXF, Router, etc.)  
✅ All contracts configured with security features  
✅ Pause functionality tested  

---

## After Deployment

### 1. Save Addresses
Deployment data automatically saved to:
```
deployments/testnet-<timestamp>.json
```

### 2. Verify Contracts
```bash
npx hardhat verify --network theta-testnet <ADDRESS> <ARGS>
```

### 3. Update Frontend
Add addresses to your `.env`:
```bash
VITE_TESTNET_TIMELOCK_ADDRESS=<from deployment output>
VITE_TESTNET_MULTISIG_ADDRESS=<from deployment output>
VITE_TESTNET_ROUTER_ADDRESS=<from deployment output>
# ... more addresses
```

### 4. Test Security Features
```bash
# Update addresses in test-testnet-security.ts first
npx hardhat run scripts/test-testnet-security.ts --network theta-testnet
```

---

## Key Security Features

| Feature | Configuration | Purpose |
|---------|--------------|---------|
| **Timelock** | 6 hours | Delay critical operations |
| **Multi-sig** | 3-of-5 | Require consensus |
| **Pausable** | All contracts | Emergency stop |
| **Access Control** | Role-based | Restrict functions |
| **Upgradeable** | UUPS | Safe upgrades |

---

## Common Operations

### Schedule Timelock Operation
```typescript
const timelock = await ethers.getContractAt('XFuelTimelock', TIMELOCK_ADDRESS)
await timelock.schedule(target, value, data, predecessor, salt, delay)
// Wait 6 hours...
await timelock.execute(target, value, data, predecessor, salt)
```

### Submit Multi-sig Transaction
```typescript
const multiSig = await ethers.getContractAt('MultiSigTreasury', MULTISIG_ADDRESS)
const tx = await multiSig.submitTransaction(target, value, data)
// Get 3 confirmations from different signers
await multiSig.connect(signer1).confirmTransaction(txId)
await multiSig.connect(signer2).confirmTransaction(txId)
await multiSig.connect(signer3).confirmTransaction(txId)
```

### Emergency Pause
```typescript
const contract = await ethers.getContractAt('ContractName', ADDRESS)
await contract.pause() // Stop operations
await contract.unpause() // Resume operations
```

---

## Important Links

📖 **Full Guide**: `scripts/TESTNET_DEPLOYMENT_GUIDE.md`  
📋 **Detailed README**: `scripts/README-TESTNET-SECURITY.md`  
🔗 **Explorer**: https://testnet-explorer.thetatoken.org/  
💧 **Faucet**: https://faucet.thetatoken.org/  
📚 **Theta Docs**: https://docs.thetatoken.org/  

---

## Troubleshooting

| Issue | Solution |
|-------|----------|
| Low balance | Get more TFUEL from faucet |
| Network error | Check `hardhat.config.cjs` |
| Compile error | `npx hardhat clean && npx hardhat compile` |
| Timeout | Increase timeout in config |
| Nonce error | Wait for pending transactions |

---

## Emergency Contacts

🚨 **Pause Contract**: Call `pause()` as contract owner  
🔧 **Timelock Admin**: Can manage proposals  
👥 **Multi-sig Owners**: Any 3-of-5 can execute  

---

## Mainnet Differences

| Setting | Testnet | Mainnet |
|---------|---------|---------|
| Timelock | 6 hours | 48 hours |
| Signers | Mock | Real hardware wallets |
| Tokens | Mock | Real tokens |

---

**Version**: 1.0.0  
**Network**: Theta Testnet (365)  
**Status**: Production Ready  

---

## Need Help?

1. Check deployment logs
2. Review `TESTNET_DEPLOYMENT_GUIDE.md`
3. Inspect contract events
4. Contact dev team

**Remember**: This is testnet - test everything thoroughly before mainnet! 🧪

