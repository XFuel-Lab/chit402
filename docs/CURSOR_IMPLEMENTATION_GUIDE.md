# XFuel Protocol - Quick Implementation Guide

## 🚀 For Cursor AI Assistant

This guide helps Cursor (with Sonnet 4.5) implement the WalletConnect v2 refactor and mobile UI improvements.

---

## ✅ Completed Implementations

### 1. WalletConnect v2 Integration ✓

**Files Created/Modified:**
- `src/providers/WalletProvider.tsx` - Unified wallet context with nonce security
- `src/utils/walletConnect.ts` - Enhanced WC v2 setup with mobile deep linking
- `edgefarm-mobile/src/lib/thetaWallet.ts` - Mobile wallet integration with security

**Key Features:**
- ✅ Auto-detection of Theta Wallet extension
- ✅ WalletConnect v2 QR modal
- ✅ Deep linking for mobile apps (`theta://wc`)
- ✅ Nonce-based replay attack prevention
- ✅ Session management and auto-reconnection
- ✅ Multi-provider support (Theta, MetaMask, WalletConnect)

### 2. Security Enhancements ✓

**Files Created/Modified:**
- `server/validation/swapValidation.js` - Input validation utilities
- `server/api/swap.js` - Enhanced swap endpoint with validation

**Key Features:**
- ✅ Address format validation (0x[40 hex chars])
- ✅ Amount bounds checking (0 < amount <= 1M)
- ✅ LST whitelist validation
- ✅ Timestamp validation (5-minute window)
- ✅ Balance verification
- ✅ Nonce tracking for replay prevention

### 3. Documentation ✓

**Files Created:**
- `docs/WALLETCONNECT_V2_GUIDE.md` - Comprehensive implementation guide
- This file - Quick reference for AI assistants

---

## 📋 Remaining Tasks

### 1. Integrate WalletProvider into Web App

**File to Modify:** `src/main.tsx`

```typescript
import { WalletProvider } from './providers/WalletProvider'

// Wrap App with WalletProvider
<WalletProvider>
  <App />
</WalletProvider>
```

**File to Modify:** `src/App.tsx`

Replace current wallet state management with:

```typescript
import { useWallet } from './providers/WalletProvider'

function App() {
  const { wallet, connectWallet, disconnectWallet, sendTransaction, isConnecting, error } = useWallet()
  
  // Remove old wallet state
  // Use wallet context instead
}
```

### 2. Update Tests

**File to Modify:** `src/App.test.tsx`

```typescript
import { WalletProvider } from './providers/WalletProvider'

// Wrap component in test
render(
  <WalletProvider>
    <App />
  </WalletProvider>
)
```

**File to Modify:** `cypress/e2e/swap.cy.ts`

Add tests for:
- WalletConnect connection flow
- Nonce validation
- Error handling
- Mobile deep linking (if testable)

### 3. Performance Optimizations (Optional)

**Lazy Loading Components:**

```typescript
// src/App.tsx
const CreatePoolModal = React.lazy(() => import('./components/CreatePoolModal'))
const EarlyBelieversModal = React.lazy(() => import('./components/EarlyBelieversModal'))

// Use with Suspense
<Suspense fallback={<LoadingSpinner />}>
  <CreatePoolModal />
</Suspense>
```

**Code Splitting:**

```typescript
// vite.config.ts
build: {
  rollupOptions: {
    output: {
      manualChunks: {
        'vendor': ['react', 'react-dom'],
        'ethers': ['ethers'],
        'walletconnect': ['@walletconnect/ethereum-provider'],
      }
    }
  }
}
```

### 4. Mobile UI Enhancements (Optional)

Current mobile UI is already well-structured. Potential improvements:

**Add Stack Navigator for Modals:**

```typescript
// edgefarm-mobile/App.tsx
import { createStackNavigator } from '@react-navigation/stack'

const Stack = createStackNavigator()

function App() {
  return (
    <Stack.Navigator>
      <Stack.Screen name="Main" component={MainTabs} />
      <Stack.Screen 
        name="SwapConfirm" 
        component={SwapConfirmModal} 
        options={{ presentation: 'modal' }}
      />
    </Stack.Navigator>
  )
}
```

**Enhance Haptics:**

Already implemented in `SwapScreen.tsx`. Consider adding to:
- LST selection
- Wallet connection success/failure
- Pull-to-refresh

---

## 🧪 Testing Checklist

### Web Testing

- [ ] Theta Wallet extension connection
- [ ] WalletConnect QR scan on mobile
- [ ] MetaMask with Theta RPC
- [ ] Balance display after connection
- [ ] Swap simulation with validation
- [ ] Nonce updates after signature
- [ ] Error handling (rejected tx, insufficient balance)
- [ ] Reconnection after page refresh

### Mobile Testing

- [ ] Deep link opens Theta Wallet app
- [ ] QR fallback if app not installed
- [ ] App store redirect if wallet missing
- [ ] Connection success feedback
- [ ] Balance refresh on pull-down
- [ ] Haptic feedback on interactions
- [ ] Swap flow from start to confetti
- [ ] Error states display correctly

### Security Testing

- [ ] Invalid addresses rejected
- [ ] Negative amounts rejected
- [ ] Amounts > balance rejected
- [ ] Invalid LST symbols rejected
- [ ] Expired timestamps rejected
- [ ] Nonce prevents replay (sign same message twice)
- [ ] SQL injection attempts fail
- [ ] XSS attempts sanitized

---

## 🔧 Environment Setup

### Required Environment Variables

**Web (.env.local):**
```bash
VITE_WALLETCONNECT_PROJECT_ID=your_project_id_from_walletconnect_com
VITE_ROUTER_ADDRESS=0x... # Theta Mainnet router
VITE_TIP_POOL_ADDRESS=0x... # Theta Mainnet tip pool
VITE_API_URL=http://localhost:3001 # or production URL
```

**Mobile (edgefarm-mobile/.env):**
```bash
EXPO_PUBLIC_API_URL=http://localhost:3001 # or production URL
EXPO_PUBLIC_ROUTER_ADDRESS=0x...
```

**Backend:**
```bash
SIMULATION_MODE=true # Set to false for production
PORT=3001
```

---

## 📦 Dependencies Check

### Web Dependencies (package.json)

Already installed:
- ✅ `@walletconnect/ethereum-provider@^2.23.1`
- ✅ `ethers@^6.13.0`
- ✅ `react@^18.2.0`
- ✅ `zustand@^5.0.9`

### Mobile Dependencies (edgefarm-mobile/package.json)

Already installed:
- ✅ `@thetalabs/theta-js@^0.0.86`
- ✅ `@thetalabs/theta-wallet-connect@^0.0.18`
- ✅ `@react-navigation/native@^7.1.25`
- ✅ `expo-haptics@~15.0.8`
- ✅ `react-native-confetti-cannon@^1.5.2`

---

## 🚨 Common Issues & Fixes

### Issue: "Project ID not configured"

**Fix:**
```bash
# Create .env.local
echo "VITE_WALLETCONNECT_PROJECT_ID=d132d658c164146b2546d5cd1ede0595" > .env.local

# Restart dev server
npm run dev
```

### Issue: Deep link not working on mobile

**Fix:**
```json
// edgefarm-mobile/app.json
{
  "expo": {
    "scheme": "xfuel",
    "android": {
      "intentFilters": [
        {
          "action": "VIEW",
          "data": [
            {
              "scheme": "theta"
            }
          ]
        }
      ]
    }
  }
}
```

### Issue: Nonce mismatch errors

**Fix:** Ensure nonce is regenerated after each signature:

```typescript
// After signing
setWallet(prev => ({ ...prev, nonce: generateNonce() }))
```

### Issue: Balance not updating

**Fix:** Call refreshBalance after transactions:

```typescript
await sendTransaction(tx)
await refreshBalance() // Add this
```

---

## 🎯 Success Criteria

### Web App

- ✅ Connect wallet in < 2 seconds (extension)
- ✅ QR scan works on mobile
- ✅ Swap execution < 4 seconds (Theta testnet)
- ✅ No console errors in production build
- ✅ Lighthouse score > 90

### Mobile App

- ✅ Deep link opens wallet app
- ✅ Connection feedback within 1 second
- ✅ Haptics on all interactions
- ✅ Pull-to-refresh updates data
- ✅ Confetti on swap success
- ✅ No crashes on low-end devices

### Security

- ✅ All inputs validated
- ✅ Replay attacks prevented (nonce)
- ✅ No sensitive data in logs
- ✅ HTTPS enforced in production
- ✅ CSP headers configured

---

## 📝 Next Steps for Cursor

### Priority 1: Integration

1. Wrap main app with `WalletProvider` in `src/main.tsx`
2. Update `src/App.tsx` to use `useWallet()` hook
3. Remove old wallet state management code
4. Test wallet connection flow

### Priority 2: Testing

1. Run existing tests: `npm test`
2. Fix any breaking tests
3. Add new tests for WalletProvider
4. Run E2E tests: `npm run test:e2e`

### Priority 3: Documentation

1. Update README.md with new setup steps
2. Add inline code comments for complex logic
3. Create video walkthrough (optional)

### Priority 4: Deployment

1. Test on Theta Testnet
2. Deploy to Vercel staging
3. User acceptance testing
4. Deploy to production

---

## 🤖 AI Assistant Prompt Template

For continuing this work, use this prompt:

```
I'm working on XFuel Protocol. I've completed:
1. WalletConnect v2 integration (see src/providers/WalletProvider.tsx)
2. Security enhancements (see server/api/swap.js)
3. Mobile wallet improvements (see edgefarm-mobile/src/lib/thetaWallet.ts)

Next steps:
1. Integrate WalletProvider into main app (src/main.tsx, src/App.tsx)
2. Update tests to work with new provider
3. Test full swap flow on Theta testnet

Please help me integrate the WalletProvider into the existing App component,
ensuring backward compatibility with current functionality.

Refer to docs/WALLETCONNECT_V2_GUIDE.md for implementation details.
```

---

**Generated by:** Cursor AI with Claude Sonnet 4.5  
**Date:** December 25, 2025  
**Version:** 1.0.0

