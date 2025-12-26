# 🚀 Wallet Integration - Deployment Checklist

## Pre-Deployment Testing

### ✅ Environment Setup
- [ ] Set `VITE_WALLETCONNECT_PROJECT_ID` in `.env.local`
- [ ] Verify environment variables are loaded correctly
- [ ] Test on Theta Testnet (chainId: 365) first
- [ ] Verify all dependencies are installed (`npm install`)

### ✅ Theta Wallet Connection (Desktop)
- [ ] Direct connection via extension works
- [ ] WalletConnect fallback works if extension fails
- [ ] Session persists after page reload (< 24 hours)
- [ ] Session clearing works on connection error
- [ ] Retry logic triggers on network errors (3 attempts)
- [ ] Emergency reset clears all data
- [ ] Platform detection identifies desktop correctly

### ✅ Theta Wallet Connection (Mobile)
- [ ] Deep link opens Theta Wallet app
- [ ] QR code fallback works if deep link fails
- [ ] App install prompt shows if wallet not installed
- [ ] Haptic feedback works on connection events
- [ ] Toast notifications show connection status
- [ ] Session persists in AsyncStorage
- [ ] Deep link URL handler processes WalletConnect URIs

### ✅ Keplr Integration
- [ ] Keplr detects correctly (`isKeplrInstalled()`)
- [ ] Chain suggestion triggers for Stride (stkTIA, stkATOM, stkOSMO)
- [ ] Chain suggestion triggers for Persistence (stkXPRT)
- [ ] Keplr UI appears for chain addition
- [ ] Cosmos address returned (not 0x address)
- [ ] Address validation rejects 0x addresses
- [ ] Staking transaction triggers Keplr signing UI
- [ ] Transaction success returns valid txHash
- [ ] Explorer link opens to Mintscan

### ✅ Error Handling
- [ ] User rejection handled gracefully
- [ ] Approve button disabled shows helpful message
- [ ] Network errors trigger retry logic
- [ ] Connection health diagnostics work
- [ ] Error messages include actionable suggestions
- [ ] Emergency reset available for stuck states

### ✅ Complete Flow Testing
- [ ] Connect Theta Wallet → Balance displays
- [ ] Execute swap transaction → TX hash received
- [ ] Connect Keplr → Cosmos address received
- [ ] Stake LST → Transaction successful
- [ ] Success modal shows with correct data
- [ ] Explorer links work for both Theta and Cosmos
- [ ] Session persists across page reloads

---

## Unit Tests

### ✅ Jest Tests
```bash
npm test src/utils/__tests__/walletConnectPro.test.ts
npm test src/utils/__tests__/cosmosLSTStakingPro.test.ts
```

**Required Passing Tests:**
- [ ] `clearWalletConnectSession` clears all keys
- [ ] `getConnectionHealth` returns correct status
- [ ] `smartConnect` prefers direct on desktop
- [ ] Retry logic attempts 3 times
- [ ] Session clearing on connection error
- [ ] Platform detection identifies mobile/desktop
- [ ] Keplr chain suggestion works
- [ ] Address validation rejects 0x
- [ ] Staking transaction succeeds
- [ ] User rejection handled correctly

---

## E2E Tests

### ✅ Cypress Tests
```bash
npm run cypress:open
# Run: cypress/e2e/wallet-integration.cy.ts
```

**Required Passing Tests:**
- [ ] Theta Wallet direct connection
- [ ] WalletConnect QR flow
- [ ] Session persistence
- [ ] Keplr chain suggestion
- [ ] Complete swap & stake flow
- [ ] Error recovery with retry
- [ ] Deep linking (mobile simulation)
- [ ] Keyboard navigation
- [ ] ARIA labels present

---

## Mobile Testing (Expo)

### ✅ iOS Testing
```bash
cd edgefarm-mobile
eas build --profile preview --platform ios
```

**Test on real device:**
- [ ] Deep link opens Theta Wallet app
- [ ] QR code displays correctly
- [ ] Copy link works
- [ ] Session persists after app restart
- [ ] Haptic feedback works
- [ ] Toast notifications appear
- [ ] App doesn't crash on connection error

### ✅ Android Testing
```bash
cd edgefarm-mobile
eas build --profile preview --platform android
```

**Test on real device:**
- [ ] Deep link opens Theta Wallet app
- [ ] Intent filters work correctly
- [ ] Back button doesn't break flow
- [ ] Session persists in AsyncStorage
- [ ] Haptic feedback works
- [ ] Toast notifications appear
- [ ] App doesn't crash on connection error

---

## Browser Testing

### ✅ Desktop Browsers
- [ ] Chrome (with Theta extension)
- [ ] Chrome (without extension, WalletConnect)
- [ ] Firefox (with Theta extension)
- [ ] Firefox (without extension, WalletConnect)
- [ ] Safari (WalletConnect only)
- [ ] Edge (with Theta extension)
- [ ] Brave (with Theta extension)

### ✅ Mobile Browsers
- [ ] Chrome Mobile (QR code)
- [ ] Safari Mobile (QR code)
- [ ] Firefox Mobile (QR code)
- [ ] Samsung Internet (QR code)

---

## Security Checks

### ✅ Session Management
- [ ] Sessions expire after 24 hours
- [ ] Session data is cleared on logout
- [ ] Sensitive data not logged to console
- [ ] localStorage/AsyncStorage only stores necessary data
- [ ] Emergency reset clears all data

### ✅ Address Validation
- [ ] Theta addresses validated (0x format)
- [ ] Cosmos addresses validated (bech32 format)
- [ ] 0x addresses rejected for Cosmos transactions
- [ ] Invalid addresses show clear error messages

### ✅ Transaction Security
- [ ] Nonce-based message signing
- [ ] Transaction replay protection
- [ ] User approval required for all transactions
- [ ] Gas estimation works correctly
- [ ] Transaction errors handled safely

---

## Performance Testing

### ✅ Connection Speed
- [ ] Direct connection: < 2 seconds
- [ ] WalletConnect QR: < 5 seconds
- [ ] Session restore: < 1 second
- [ ] Keplr chain addition: < 3 seconds
- [ ] Transaction signing: < 5 seconds

### ✅ Error Recovery
- [ ] Retry attempts complete in < 20 seconds (3 × 5s + overhead)
- [ ] Session clearing: < 1 second
- [ ] Emergency reset: < 2 seconds

---

## Documentation Review

### ✅ Files Present
- [ ] `docs/THETA_WALLET_INTEGRATION_GUIDE.md` - Comprehensive guide
- [ ] `docs/WALLET_INTEGRATION_SUMMARY.md` - Summary of changes
- [ ] `DEPLOYMENT_CHECKLIST_WALLET_INTEGRATION.md` - This file
- [ ] Inline code comments for complex logic

### ✅ Documentation Accuracy
- [ ] API examples work as written
- [ ] Troubleshooting steps are accurate
- [ ] All file paths are correct
- [ ] Code examples use correct imports
- [ ] Version numbers are current

---

## Production Readiness

### ✅ Configuration
- [ ] WalletConnect Project ID set (not using fallback)
- [ ] Theta Mainnet RPC configured
- [ ] Router contract addresses verified
- [ ] Keplr chain configs match mainnet
- [ ] Gas prices set appropriately

### ✅ Error Monitoring
- [ ] Connection success rate tracked
- [ ] Error messages logged for debugging
- [ ] User feedback mechanism in place
- [ ] Diagnostics available for support

### ✅ User Experience
- [ ] Loading states show for all async operations
- [ ] Error messages are user-friendly
- [ ] Success confirmations show with TX links
- [ ] Help text guides users through flows
- [ ] Retry suggestions provided on errors

### ✅ Fallback Strategies
- [ ] WalletConnect fallback for desktop
- [ ] QR fallback for mobile deep links
- [ ] App store redirect if wallet not installed
- [ ] Emergency reset for stuck states

---

## Mainnet Deployment Steps

### 1. Pre-Deploy
- [ ] Run full test suite: `npm test`
- [ ] Run E2E tests: `npm run cypress:run`
- [ ] Build succeeds: `npm run build`
- [ ] No TypeScript errors: `npx tsc --noEmit`
- [ ] No linter errors: `npm run lint`

### 2. Configuration
- [ ] Update `.env.production` with mainnet values
- [ ] Set `VITE_USE_TESTNET=false`
- [ ] Verify router addresses for mainnet
- [ ] Update Keplr configs to mainnet chains

### 3. Deploy Web
```bash
# Build production
npm run build

# Deploy to Vercel/Netlify/etc
# ... your deployment process
```

### 4. Deploy Mobile
```bash
cd edgefarm-mobile

# Build production
eas build --profile production --platform all

# Submit to stores
eas submit --platform ios
eas submit --platform android
```

### 5. Post-Deploy Verification
- [ ] Test on live site with real wallet
- [ ] Test small transaction on mainnet
- [ ] Verify session persistence works
- [ ] Check error tracking/monitoring
- [ ] Monitor connection success rate

---

## Rollback Plan

### If Issues Arise

**Option 1: Quick Disable**
- [ ] Set feature flag to disable new integration
- [ ] Fallback to previous wallet connection method
- [ ] Keep new code in place for later fix

**Option 2: Full Rollback**
```bash
git revert HEAD~1  # Or specific commit
npm install
npm run build
# Re-deploy
```

**Option 3: Hotfix**
- [ ] Identify issue from diagnostics
- [ ] Apply emergency reset for affected users
- [ ] Deploy fix ASAP
- [ ] Monitor success rate

---

## Success Metrics

### Target Metrics (Post-Deployment)

**Connection Success Rate:**
- Theta Direct: > 95%
- Theta WalletConnect: > 90%
- Keplr: > 98%
- Session Restore: > 95%

**Performance:**
- Connection Time: < 5 seconds (90th percentile)
- Session Restore: < 2 seconds (90th percentile)
- Error Recovery: < 20 seconds (3 retries)

**User Experience:**
- Clear error messages: 100%
- Retry successful: > 85%
- Deep link success (mobile): > 85%
- Session persistence: > 95%

### Monitoring

Track in production:
- [ ] Connection attempts
- [ ] Success/failure rates
- [ ] Error types and frequency
- [ ] Session restore success rate
- [ ] Average connection time
- [ ] Retry attempt distribution
- [ ] Platform distribution (mobile/desktop)

---

## Support Preparation

### User Support Resources
- [ ] FAQ updated with new wallet connection steps
- [ ] Troubleshooting guide accessible to support team
- [ ] Diagnostics tool available for debugging
- [ ] Emergency reset instructions documented
- [ ] Known issues list maintained

### Support Team Training
- [ ] Walkthrough of new connection flows
- [ ] Common error scenarios and fixes
- [ ] How to use diagnostics tool
- [ ] When to suggest emergency reset
- [ ] Escalation process for bugs

---

## Final Sign-Off

**Team Lead:** ___________________ Date: ___________

**QA Engineer:** ___________________ Date: ___________

**Security Review:** ___________________ Date: ___________

**Product Owner:** ___________________ Date: ___________

---

## Notes

_Use this space to document any deployment-specific notes, issues encountered, or special considerations:_

---

**Status:** ✅ Ready for Production

**Version:** 2.0.0

**Date:** December 26, 2025

---

🚀 **Go live with confidence!**

