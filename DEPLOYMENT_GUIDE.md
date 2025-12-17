# Real XFUEL Contracts Deployment Guide

## Prerequisites

1. **Node.js** (v24.0.0 or higher)
2. **Theta Testnet Account** with TFUEL for gas fees
3. **Private Key** from your Theta testnet wallet

## Step 1: Set Up Your Private Key

Add your Theta testnet private key to your `.env` file:

```env
# Theta Testnet Configuration
THETA_TESTNET_PRIVATE_KEY=0xYourPrivateKeyHere
```

**⚠️ Security Warning:**
- Never commit your private key to version control
- Use a dedicated testnet account (not your mainnet wallet)
- The `.env` file is already in `.gitignore` for your protection

### How to Get Your Private Key

1. **From MetaMask/Theta Wallet:**
   - Open your wallet extension
   - Go to Account Details → Export Private Key
   - Enter your password to reveal the private key
   - Copy the key (it should start with `0x`)

2. **From a Hardware Wallet:**
   - Use a software wallet for testnet deployments
   - Hardware wallets are better for mainnet

## Step 2: Get Testnet TFUEL

You need TFUEL to pay for gas fees. Get testnet TFUEL from:

- **Theta Testnet Faucet:** https://faucet.thetatoken.org/
- Or use the faucet in your app (if configured)

**Recommended:** Have at least 0.5 TFUEL for deployment (contracts require gas for deployment)

## Step 3: Deploy Contracts

Run the deployment script:

```bash
npm run deploy:theta-testnet
```

Or directly with Hardhat:

```bash
npx hardhat run scripts/deploy.cjs --network theta-testnet
```

### What Gets Deployed

The script will deploy 4 contracts in this order:

1. **TipPool** - Lottery tip pools with VRF-based winner selection
2. **XFUELPoolFactory** - Factory for creating liquidity pools
3. **TreasuryILBackstop** - Impermanent loss coverage (8% threshold)
4. **XFUELRouter** - Main router with fee splitting (60% buyback-burn, 25% veXF yield, 15% treasury)

### Deployment Output

After successful deployment, you'll see:

```
📋 DEPLOYMENT SUMMARY
============================================================
🌐 Network: Theta Testnet (Chain ID: 365)
👤 Deployer: 0xYourDeployerAddress

📝 Contract Addresses:
   TipPool:            0x...
   XFUELPoolFactory:   0x...
   TreasuryILBackstop: 0x...
   XFUELRouter:        0x...
============================================================
```

The script will automatically update your `.env` file with:
- `VITE_ROUTER_ADDRESS` - XFUELRouter contract address
- `VITE_TIP_POOL_ADDRESS` - TipPool contract address

## Step 4: Verify Deployment

### Check on Theta Explorer

Visit the Theta Testnet Explorer and search for your contract addresses:
- **Explorer:** https://testnet-explorer.thetatoken.org/

### Verify Contract Functions

You can interact with contracts using Hardhat console:

```bash
npx hardhat console --network theta-testnet
```

Then in the console:
```javascript
const router = await ethers.getContractAt("XFUELRouter", "0xYourRouterAddress");
const factory = await router.factory();
console.log("Factory address:", factory);
```

## Step 5: Post-Deployment Configuration

### Update Token Addresses

The XFUELRouter was deployed with placeholder token addresses. Update them:

1. **Deploy or identify token contracts:**
   - `xfuelToken` - XF token address
   - `usdcToken` - USDC token address on Theta testnet

2. **Update TreasuryILBackstop:**
   - Set the treasury token address (USDC or stablecoin)

3. **Update XFUELRouter:**
   - Set treasury address
   - Set veXFContract address

### Create Initial Pool

Use XFUELPoolFactory to create your first liquidity pool:

```javascript
const factory = await ethers.getContractAt("XFUELPoolFactory", factoryAddress);
const tx = await factory.createPool(
  token0Address,  // TFUEL or first token
  token1Address,  // XPRT or second token
  500,            // Fee tier: 500 (0.05%) or 800 (0.08%)
  sqrtPriceX96    // Initial price (sqrt price in Q96 format)
);
```

## Troubleshooting

### Error: "No signers available"
- **Solution:** Make sure `THETA_TESTNET_PRIVATE_KEY` is set in your `.env` file

### Error: "insufficient funds"
- **Solution:** Get more TFUEL from the testnet faucet

### Error: "nonce too low"
- **Solution:** Wait a few seconds and try again, or reset your account nonce

### Contracts deployed but not showing in explorer
- **Solution:** Wait a few minutes for the explorer to index new blocks

## Next Steps After Deployment

1. ✅ Test contract interactions
2. ✅ Update frontend with new contract addresses
3. ✅ Create initial liquidity pools
4. ✅ Configure fee recipients and treasury addresses
5. ✅ Test swap and stake functionality
6. ✅ Set up monitoring and alerts

## Contract Addresses Reference

After deployment, save these addresses:

- **TipPool:** `0x...` - For tip pool functionality
- **XFUELPoolFactory:** `0x...` - For creating new pools
- **TreasuryILBackstop:** `0x...` - For IL coverage
- **XFUELRouter:** `0x...` - Main router contract

## Support

If you encounter issues:
1. Check the deployment logs for specific error messages
2. Verify your account has sufficient TFUEL
3. Ensure network connectivity to Theta testnet RPC
4. Check contract compilation: `npx hardhat compile`

