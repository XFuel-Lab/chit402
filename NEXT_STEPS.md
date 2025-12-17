# Next Steps: Get Testnet TFUEL & Deploy

## Current Status
✅ Router contract updated with `swapAndStake` function  
✅ Deployment script ready  
❌ Need testnet TFUEL for deployment wallet

## Your Deployment Wallet Address
```
0x627082bFAdffb16B979d99A8eFc8F1874c0990C4
```

## Step 1: Get Testnet TFUEL

1. **Visit Theta Testnet Faucet:**
   - URL: https://faucet.testnet.theta.org/
   - Paste your wallet address: `0x627082bFAdffb16B979d99A8eFc8F1874c0990C4`
   - Request testnet TFUEL

2. **Wait 1-2 minutes** for the faucet to process

3. **Verify Balance:**
   ```bash
   npx hardhat run scripts/check-balance.cjs --network theta-testnet
   ```
   Or check on explorer: https://testnet-explorer.thetatoken.org/address/0x627082bFAdffb16B979d99A8eFc8F1874c0990C4

## Step 2: Deploy Contracts

Once you have TFUEL (need at least 0.1 TFUEL):

```bash
npx hardhat run scripts/deploy.cjs --network theta-testnet
```

This will:
- Deploy all contracts (TipPool, Factory, Backstop, Router)
- Update your `.env` file with router address
- Print deployment summary

## Step 3: Update Mobile App

After deployment, update `edgefarm-mobile/app.json`:
```json
{
  "extra": {
    "routerAddress": "0xYourDeployedRouterAddress"
  }
}
```

## Step 4: Test Swaps

1. Start web app: `npm run dev`
2. Connect Theta wallet
3. Get test TFUEL if needed (faucet button)
4. Try a swap!

## What Changed

✅ Added `swapAndStake` function to XFUELRouter contract  
✅ Function accepts native TFUEL via `msg.value`  
✅ Emits `SwapAndStake` event  
✅ Matches the ABI used in web/mobile apps  

The contract is ready to deploy once you have testnet TFUEL!

