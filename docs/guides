# 🚀 Quick Start - Run XFUEL Locally

## One-Command Start (Easiest)

**Windows:**
```bash
.\start-local.bat
```

This will:
1. ✅ Check dependencies
2. ✅ Start backend on port 3001
3. ✅ Start frontend on port 5173
4. ✅ Open both in separate windows

## Manual Start (If Needed)

**Terminal 1 - Backend:**
```bash
npm run dev:backend
```
✅ Backend: http://localhost:3001

**Terminal 2 - Frontend:**
```bash
npm run dev
```
✅ Frontend: http://localhost:5173

## Test It Works

1. **Open browser**: http://localhost:5173
2. **Open DevTools** (F12) → Console tab
3. **Connect Theta Wallet**
4. **Enter swap amount** (e.g., 100 TFUEL)
5. **Select LST** (stkTIA, stkATOM, stkXPRT)
6. **Click "Swap & Stake"**

## What to Expect

✅ **Instant prices** from cache (0ms)
✅ **Background refresh** from oracles (CoinGecko, Osmosis, Persistence)
✅ **Real-time calculations** as you type
✅ **Fast confirmation** (~3-4 seconds on Theta)

## Troubleshooting

**"Cannot access useMock before initialization"**
- ✅ Fixed! Refresh browser

**"Transaction sent but confirmation failed"**
- ✅ Fixed! Now uses fast polling (1s intervals)

**Prices showing 0.95 (fallback)**
- Check browser console for oracle errors
- Click "🔄 Refresh" button
- Verify backend is running: http://localhost:3001/health

**Swap not working**
- Make sure both servers are running
- Check browser console for errors
- Verify wallet is connected
- Check network (should be Theta Mainnet/Testnet)

## Configuration

The app auto-detects localhost and uses:
- **API URL**: `http://localhost:3001` (auto)
- **Network**: `mainnet` (default)
- **Mock Mode**: Toggleable in UI (top right button)

## Need Help?

Check browser console (F12) for detailed logs:
- `🔄 Fetching fresh prices...`
- `✅ Transaction sent: 0x...`
- `✅ Transaction confirmed`



