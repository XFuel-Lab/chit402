# Environment Configuration Guide

## Quick Setup

1. **Create your `.env` file** (if it doesn't exist):
   ```bash
   cp .env.example .env
   ```
   Or on Windows PowerShell:
   ```powershell
   Copy-Item .env.example .env
   ```

2. **Edit `.env` and add your contract addresses**:
   ```env
   VITE_ROUTER_ADDRESS=0xYourRouterAddressHere
   VITE_TIP_POOL_ADDRESS=0xYourTipPoolAddressHere
   ```

3. **Restart your dev server** for changes to take effect:
   ```bash
   npm run dev
   ```

## Contract Addresses

### Router Contract Address
The router contract should implement:
- `swapAndStake(uint256 amount, string calldata targetLST)` - payable function that accepts native TFUEL

Example:
```env
VITE_ROUTER_ADDRESS=0x1234567890123456789012345678901234567890
```

### Tip Pool Contract Address
The tip pool contract should implement:
- `createPool(uint256 duration, address creator)` - create a new tip pool
- `tipPool(uint256 poolId)` - add a tip to a pool (payable)
- `endPool(uint256 poolId)` - end pool and draw winner
- `getPoolInfo(uint256 poolId)` - get pool information

Example:
```env
VITE_TIP_POOL_ADDRESS=0xabcdefabcdefabcdefabcdefabcdefabcdefabcd
```

## Getting Contract Addresses

### If you haven't deployed yet:

1. **Deploy Router Contract**:
   - Use the `XFUELRouter.sol` or create a contract with `swapAndStake` function
   - Deploy to Theta testnet (chain ID: 365)
   - Copy the deployment address

2. **Deploy Tip Pool Contract**:
   - Use the `TipPool.sol` contract from `contracts/`
   - Deploy to Theta testnet
   - Copy the deployment address

### Using Hardhat:
```bash
# Compile contracts
npx hardhat compile

# Deploy to Theta testnet (you'll need network config in hardhat.config.cjs)
npx hardhat run scripts/deploy.js --network theta-testnet
```

## Testing Without Contracts

If you want to test the UI without deployed contracts:
- Leave the addresses empty in `.env`
- The app will show helpful error messages when you try to use features
- You can still test wallet connection and faucet functionality

## Environment Variables Reference

| Variable | Description | Required |
|----------|-------------|----------|
| `VITE_ROUTER_ADDRESS` | Router contract address on Theta testnet | Yes (for swaps) |
| `VITE_TIP_POOL_ADDRESS` | Tip Pool contract address on Theta testnet | Yes (for tip pools) |

Note: All variables prefixed with `VITE_` are exposed to the browser. Never put private keys or sensitive data here!





