# XFUEL Router Deployment Instructions

## Quick Start: Deploy Router to Theta Testnet

### Prerequisites
1. **Private Key**: You need a wallet with testnet TFUEL
2. **Environment Setup**: Create a `.env` file in the root directory

### Step 1: Set Up Environment Variables

Create or update `.env` file:
```bash
THETA_TESTNET_PRIVATE_KEY=0xYourPrivateKeyHere
```

**⚠️ Security Note**: Never commit your `.env` file to git. It's already in `.gitignore`.

### Step 2: Get Testnet TFUEL

If you don't have testnet TFUEL:
1. Visit: https://faucet.testnet.theta.org/
2. Request testnet TFUEL for your wallet address
3. Wait a few minutes for the faucet to process

### Step 3: Deploy Contracts

Run the deployment script:
```bash
npx hardhat run scripts/deploy.cjs --network theta-testnet
```

The script will:
- Deploy TipPool, XFUELPoolFactory, TreasuryILBackstop, and XFUELRouter
- Automatically update your `.env` file with contract addresses
- Print deployment summary with all addresses

### Step 4: Update Mobile App Config

After deployment, update `edgefarm-mobile/app.json`:
```json
{
  "extra": {
    "routerAddress": "0xYourDeployedRouterAddressHere"
  }
}
```

### Step 5: Restart Development Servers

1. **Web App**: Restart your dev server (Vite will pick up new env vars)
   ```bash
   npm run dev
   ```

2. **Mobile App**: Rebuild if needed (Expo will pick up new config)
   ```bash
   cd edgefarm-mobile
   npm start
   ```

## What Gets Deployed

1. **TipPool** - Lottery/tip pool functionality
2. **XFUELPoolFactory** - Factory for creating pools
3. **TreasuryILBackstop** - Treasury management
4. **XFUELRouter** - Main router with `swapAndStake` function

## Router Contract Details

The XFUELRouter now includes:
- ✅ `swapAndStake(uint256 amount, string calldata targetLST)` - Accepts native TFUEL via `msg.value`
- ✅ Emits `SwapAndStake` event with user, amounts, and target LST
- ✅ Returns staked amount

**Function Signature:**
```solidity
function swapAndStake(
    uint256 amount,
    string calldata targetLST
) external payable returns (uint256 stakedAmount)
```

## Testing the Deployment

After deployment, you can:
1. Connect wallet in web/mobile app
2. Select amount and LST
3. Click "Swap & Stake"
4. Confirm transaction in wallet
5. See transaction hash and explorer link
6. View on Theta Explorer: https://testnet-explorer.thetatoken.org

## Troubleshooting

### "No signers available"
- Check that `THETA_TESTNET_PRIVATE_KEY` is set in `.env`
- Ensure the key starts with `0x`

### "Insufficient funds"
- Get testnet TFUEL from faucet
- Need at least 0.1 TFUEL for deployment

### Contracts not found after deployment
- Check the deployment output for addresses
- Verify `.env` file was updated correctly
- Restart dev server to pick up new env vars

## Next Steps After Deployment

1. Test swap functionality with small amounts
2. Monitor transactions on Theta Explorer
3. Update token addresses in router (if needed)
4. Set treasury and veXF contract addresses (if needed)


