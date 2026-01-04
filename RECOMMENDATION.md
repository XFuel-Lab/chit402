# 🎯 Recommendation: Use Simulation Mode for Local Development

## Why Simulation Mode?

✅ **No contract deployment needed** - Test the full UI/UX immediately  
✅ **Faster iteration** - No need to deploy/update contracts  
✅ **Real pricing** - Uses same oracle system (CoinGecko, Osmosis, Persistence)  
✅ **Full workflow testing** - Test all UI flows, error handling, etc.  
✅ **Easy to switch** - Can enable real contracts anytime  

## How to Enable Simulation Mode

### Option 1: Automatic (Recommended)
The app will automatically use simulation mode if:
- Balance is insufficient (< 0.1 TFUEL), OR
- Contract is not deployed at router address

Just try a swap and it will auto-detect!

### Option 2: Force Simulation
1. Make sure backend is running: `npm run dev:backend`
2. The frontend will automatically use simulation when balance is low
3. Or temporarily set a low balance check

### Option 3: Environment Variable
Create `.env.local`:
```env
VITE_MOCK_MODE=true
# Or just leave VITE_ROUTER_ADDRESS empty
```

## What Simulation Mode Does

✅ Uses backend API (`http://localhost:3001/api/swap`)  
✅ Calculates swap output using real oracle prices  
✅ Simulates the transaction without on-chain execution  
✅ Shows success/error states like real transactions  
✅ Updates UI with calculated amounts  

## When to Use Real Contracts

Use real contracts when:
- ✅ Testing on-chain transaction execution
- ✅ Testing gas estimation
- ✅ Testing wallet interactions (confirmations, etc.)
- ✅ Preparing for production deployment

## Current Setup (Best for Now)

1. **Backend running**: `npm run dev:backend` ✅
2. **Frontend running**: `npm run dev` ✅
3. **Simulation mode**: Auto-enabled ✅
4. **Real prices**: Working (CoinGecko, Osmosis, Persistence) ✅

## Test Flow

1. Start both servers: `.\start-local.bat`
2. Open: http://localhost:5173
3. Connect wallet
4. Enter swap amount (e.g., 100 TFUEL)
5. Select LST (stkTIA, stkATOM, stkXPRT)
6. Click "Swap & Stake"
7. Should show simulation with real prices!

## Next Steps When Ready for Real Contracts

1. Deploy `MockXFUELRouter.sol` to Theta testnet
2. Set `VITE_ROUTER_ADDRESS` in `.env.local`
3. Turn OFF mock mode in UI
4. Test real transactions

**For now: Stick with simulation mode!** 🚀



