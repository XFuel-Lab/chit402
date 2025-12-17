# Deployment Checklist

Use this checklist to ensure everything is ready before deploying:

## Pre-Deployment Checklist

- [ ] **Private Key Set**
  - [ ] Added `THETA_TESTNET_PRIVATE_KEY` to `.env` file
  - [ ] Private key starts with `0x`
  - [ ] Using a testnet account (not mainnet)

- [ ] **Testnet TFUEL**
  - [ ] Account has at least 0.5 TFUEL
  - [ ] Got TFUEL from faucet: https://faucet.thetatoken.org/

- [ ] **Contracts Compiled**
  - [ ] Ran `npx hardhat compile` successfully
  - [ ] No compilation errors

- [ ] **Network Configuration**
  - [ ] Theta testnet RPC is accessible
  - [ ] Chain ID 365 is correct in `hardhat.config.cjs`

## Deployment Steps

1. [ ] Run deployment: `npm run deploy:theta-testnet`
2. [ ] Verify all 4 contracts deployed successfully
3. [ ] Check contract addresses in deployment output
4. [ ] Verify `.env` file was updated with addresses
5. [ ] Check contracts on Theta Explorer

## Post-Deployment Checklist

- [ ] **Contract Addresses Saved**
  - [ ] TipPool address
  - [ ] XFUELPoolFactory address
  - [ ] TreasuryILBackstop address
  - [ ] XFUELRouter address

- [ ] **Environment Variables**
  - [ ] `VITE_ROUTER_ADDRESS` updated in `.env`
  - [ ] `VITE_TIP_POOL_ADDRESS` updated in `.env`

- [ ] **Next Steps Planned**
  - [ ] Update token addresses in XFUELRouter
  - [ ] Configure treasury addresses
  - [ ] Create initial liquidity pools
  - [ ] Test contract interactions

## Quick Commands

```bash
# Compile contracts
npx hardhat compile

# Deploy to Theta testnet
npm run deploy:theta-testnet

# Check deployment status
npx hardhat console --network theta-testnet

# Verify on explorer
# Visit: https://testnet-explorer.thetatoken.org/
```

## Troubleshooting Quick Reference

| Issue | Solution |
|-------|----------|
| No signers available | Add `THETA_TESTNET_PRIVATE_KEY` to `.env` |
| Insufficient funds | Get TFUEL from faucet |
| Compilation errors | Run `npx hardhat clean` then `npx hardhat compile` |
| Network timeout | Check internet connection and RPC endpoint |

