# 🚀 Local Development Setup (Everything Stays Local)

## Quick Start - Run Everything Locally

### Option 1: Run Both Servers (Easiest)

**Windows:**
```bash
.\run-local.bat
```

**Mac/Linux:**
```bash
./run-local.sh
```

This starts both frontend and backend automatically!

### Option 2: Run Separately (More Control)

**Terminal 1 - Backend API:**
```bash
npm run dev:backend
```
✅ Backend runs on: `http://localhost:3001`

**Terminal 2 - Frontend:**
```bash
npm run dev
```
✅ Frontend runs on: `http://localhost:5173` (or similar)

## What You Get Locally

✅ **All pricing updates** - Oracle with CoinGecko, Osmosis, Persistence DEX
✅ **Backend API** - Updated swap endpoint with real pricing
✅ **Frontend** - Revamped swap screen with live prices
✅ **Mock Mode Toggle** - Test with or without real transactions
✅ **Hot Reload** - Changes update instantly

## Testing the Pricing Fix

1. **Start both servers** (Option 1 or 2 above)
2. **Open browser**: `http://localhost:5173`
3. **Open DevTools** (F12) → Console tab
4. **Connect wallet**
5. **Watch console logs**:
   - `🔄 Fetching fresh prices from oracles...`
   - `✅ Price fetch results:` (shows actual prices)
   - `💰 stkTIA: $X.XXXX (coingecko)`
6. **Enter swap amount** - see real-time calculations
7. **Click "🔄 Refresh"** button to force fresh prices

## Local Configuration

The app auto-detects localhost and uses:
- **API URL**: `http://localhost:3001` (auto)
- **Network**: `mainnet` (default, changeable)
- **Mock Mode**: Toggleable in UI (top right)

## Environment Variables (Optional)

Create `.env.local` (not committed to git):
```env
VITE_ROUTER_ADDRESS=0xYourRouterAddress
VITE_API_URL=http://localhost:3001
VITE_NETWORK=mainnet
VITE_MOCK_MODE=false
```

## Verify Everything Works

1. **Backend health check**: Visit `http://localhost:3001/health`
2. **Frontend**: Visit `http://localhost:5173`
3. **Check console**: Should see price fetching logs
4. **Test swap**: Enter amount, see real prices in preview

## Troubleshooting

**Prices not updating?**
- Check browser console (F12) for errors
- Click "🔄 Refresh" button in exchange rate display
- Verify backend is running: `http://localhost:3001/health`

**Backend won't start?**
- Check if port 3001 is in use
- Try different port: `PORT=3002 npm run dev:backend`
- Update `VITE_API_URL` in `.env.local` if needed

**Still seeing old prices?**
- Hard refresh browser: `Ctrl+Shift+R` (Windows) or `Cmd+Shift+R` (Mac)
- Clear browser cache
- Check console for `[BACKEND] Price calculation:` logs

## What Changed (All Local)

✅ `src/utils/oracle.ts` - Multi-source pricing (CoinGecko → Osmosis → Persistence)
✅ `src/App.tsx` - Revamped swap screen with live prices
✅ `server/api/swap.js` - Backend uses same pricing logic
✅ `src/utils/apyFetcher.ts` - Real APY fetching from Stride

**Nothing deploys to Vercel until you push to git!**
