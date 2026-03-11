# Router Configuration Verification Guide

## ✅ Current Status

**Router Address**: `0x6256D8A728aA102Aa06B6B239ba1247Bd835d816`  
**Network**: Theta Mainnet (Chain ID: 361)  
**Mode**: REAL (no mock/simulation)

## 🔍 Verification Checklist

### 1. Environment Variable Setup

#### Local Development
```bash
# Create .env.local file
echo "VITE_ROUTER_ADDRESS=0x6256D8A728aA102Aa06B6B239ba1247Bd835d816" > .env.local
```

#### Vercel Production
1. Go to: https://vercel.com/[your-project]/settings/environment-variables
2. Add new variable:
   - **Key**: `VITE_ROUTER_ADDRESS`
   - **Value**: `0x6256D8A728aA102Aa06B6B239ba1247Bd835d816`
   - **Environments**: Production, Preview, Development
3. Redeploy the project

#### Netlify Production
1. Go to: Site Settings → Environment Variables
2. Add new variable:
   - **Key**: `VITE_ROUTER_ADDRESS`
   - **Value**: `0x6256D8A728aA102Aa06B6B239ba1247Bd835d816`
3. Trigger a new deploy

### 2. Console Log Verification

After loading the app, open browser console (F12) and verify these logs appear:

#### ✅ Expected Logs on Page Load:
```
🔧 [XFUEL Config] Router address loaded: 0x6256D8A728aA102Aa06B6B239ba1247Bd835d816
🔧 [XFUEL Config] Mode: REAL
🔧 [XFUEL Config] Expected mainnet router: 0x6256D8A728aA102Aa06B6B239ba1247Bd835d816
✅ [XFUEL Config] Mainnet router correctly configured
```

#### ❌ ERROR: Router Not Configured
```
🔧 [XFUEL Config] Router address loaded: (not configured)
🔧 [XFUEL Config] Mode: NO ROUTER
```
**Fix**: Set `VITE_ROUTER_ADDRESS` environment variable

#### ❌ ERROR: Mock Router Detected
```
🔧 [XFUEL Config] Router address loaded: 0x0000000000000000000000000000000000000001
❌ [XFUEL Config] Mock router address detected in production!
```
**Fix**: Update `VITE_ROUTER_ADDRESS` to real mainnet address

### 3. Swap Execution Verification

When attempting a swap, verify these logs appear:

#### ✅ Expected Logs During Swap:
```
🚀 [XFUEL Swap] Starting real swap execution
🚀 [XFUEL Swap] Using router: 0x6256D8A728aA102Aa06B6B239ba1247Bd835d816
🚀 [XFUEL Swap] Mode: REAL (production)
🚀 [XFUEL Swap] Network: Theta Mainnet (Chain ID: 361)
🚀 [XFUEL Swap] Amount: [amount] TFUEL → [LST]
⛽ [XFUEL Swap] Estimating gas for real transaction...
⛽ [XFUEL Swap] Gas estimate: [estimate]
📤 [XFUEL Swap] Sending real transaction to router contract...
✅ [XFUEL Swap] Transaction sent! Hash: 0x...
🔗 [XFUEL Swap] View on explorer: https://explorer.thetatoken.org/tx/0x...
⏳ [XFUEL Swap] Waiting for transaction confirmation...
✅ [XFUEL Swap] Transaction confirmed! Block: [number]
⛽ [XFUEL Swap] Gas used: [amount]
💰 [XFUEL Swap] Real gas cost: [cost] TFUEL
```

#### ❌ ERROR: Router Not Configured
```
❌ [XFUEL Swap] Router address not configured
```
**User sees**: "❌ Real router not configured — contact support"

#### ❌ ERROR: Mock Router Detected
```
❌ [XFUEL Swap] Mock router address detected - refusing to execute swap
```
**User sees**: "❌ Mock router detected — production requires real router address"

### 4. Network Verification

Ensure you're connected to **Theta Mainnet** (Chain ID: 361):

1. Open Theta Wallet
2. Check network selector shows "Theta Mainnet"
3. If on testnet, switch to mainnet

### 5. Contract Verification

Verify the router contract exists on Theta Mainnet:

🔗 **Router Contract**: https://explorer.thetatoken.org/address/0x6256D8A728aA102Aa06B6B239ba1247Bd835d816

**Expected**:
- Contract should show bytecode
- Should have transactions
- Should show verified contract (if verified)

## 🚨 No Mock Mode or Simulation

### Confirmed Removed:
- ✅ No `MOCK_MODE` environment variable
- ✅ No `USE_MOCK_MODE` flag
- ✅ No simulation toggle
- ✅ Mock router address (`0x000...001`) explicitly blocked
- ✅ All swap execution uses real contracts
- ✅ Real gas estimation
- ✅ Real transaction sending
- ✅ Real event parsing

### Code Guarantees:
```typescript
// src/config/appConfig.ts
USE_REAL_MODE: true  // Always use real contracts

// src/App.tsx - Mock address check
if (ROUTER_ADDRESS === '0x0000000000000000000000000000000000000001') {
  console.error('❌ Mock router detected - refusing to execute')
  return
}

// src/config/thetaConfig.ts - Validation
if (isMockAddress) {
  console.error('❌ Mock router address detected in production!')
}
```

## 🧪 Testing Procedure

### Local Testing
1. Create `.env.local` with router address
2. Run: `npm run dev`
3. Open http://localhost:3000
4. Check console logs
5. Connect Theta Wallet
6. Attempt a small swap (0.1 TFUEL)
7. Verify transaction appears on Theta explorer

### Production Preview
1. Build production bundle: `npm run build`
2. Preview locally: `npm run preview`
3. Open http://localhost:3000
4. Verify console logs show correct router
5. Test swap flow

### Production Verification
1. Deploy to production
2. Open production URL
3. Open browser console (F12)
4. Verify router logs show correct address
5. Connect wallet
6. Test small swap
7. Verify transaction on Theta explorer

## 📊 Expected Behavior Summary

| Scenario | Router Config | Console Output | Swap Behavior |
|----------|---------------|----------------|---------------|
| **Correct Setup** | `0x6256...d816` | ✅ Mainnet router correctly configured | ✅ Real transaction sent |
| **Missing Config** | `` (empty) | ❌ Router address not configured | ❌ Swap blocked with error |
| **Mock Address** | `0x000...001` | ❌ Mock router detected | ❌ Swap blocked with error |
| **Wrong Address** | `0xOTHER...` | ⚠️  Does not match expected | ⚠️  Transaction may fail |

## 🔗 Deployment Files

Router address stored in:
- `deployments/router-mainnet.json` - Full deployment record
- `deployments/phase3-mainnet.json` - Phase 3 integration

## 📝 Commit History

Recent router configuration fixes:
- **Latest**: Enhanced debug logging + mock address blocking
- `41f0978`: Reliable router config from VITE -- no mock in production
- `1c5999a`: Real Cosmos LST staking — output to Keplr
- `f9373a0`: Disable Axelar bridging until infrastructure deployed

## ✅ Final Checklist

Before production deployment:

- [ ] `VITE_ROUTER_ADDRESS` set in deployment platform
- [ ] Environment variable value: `0x6256D8A728aA102Aa06B6B239ba1247Bd835d816`
- [ ] Build and deploy triggered
- [ ] Console logs show "✅ Mainnet router correctly configured"
- [ ] No "mock" or "simulation" warnings in console
- [ ] Test swap completes successfully
- [ ] Transaction visible on Theta explorer
- [ ] No mock mode flags in code
- [ ] Real gas estimation working
- [ ] Real transaction confirmation working

---

**Last Updated**: 2025-12-23  
**Router Address**: 0x6256D8A728aA102Aa06B6B239ba1247Bd835d816  
**Network**: Theta Mainnet (361)  
**Status**: ✅ Ready for Production

