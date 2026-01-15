# Stride Initialization Flow - Testnet Validation Guide
**Tesla-Style: Zero-Friction Testing**

## 🧪 Testnet Setup

### Prerequisites
1. **Keplr Wallet** installed (Chrome/Brave extension)
2. **Stride Testnet** added to Keplr
3. **Test ATOM** from Cosmos Hub testnet faucet
4. **Theta Testnet TFUEL** from https://faucet.thetatoken.org

### Add Stride Testnet to Keplr
```javascript
// Run in browser console on https://app.xfuel.local
await window.keplr.experimentalSuggestChain({
  chainId: 'stride-testnet-1',
  chainName: 'Stride Testnet',
  rpc: 'https://stride-testnet-rpc.polkachu.com',
  rest: 'https://stride-testnet-api.polkachu.com',
  bip44: { coinType: 118 },
  bech32Config: {
    bech32PrefixAccAddr: 'stride',
    bech32PrefixAccPub: 'stridepub',
    bech32PrefixValAddr: 'stridevaloper',
    bech32PrefixValPub: 'stridevaloperpub',
    bech32PrefixConsAddr: 'stridevalcons',
    bech32PrefixConsPub: 'stridevalconspub',
  },
  currencies: [{ coinDenom: 'STRD', coinMinimalDenom: 'ustrd', coinDecimals: 6 }],
  feeCurrencies: [{ coinDenom: 'STRD', coinMinimalDenom: 'ustrd', coinDecimals: 6 }],
  stakeCurrency: { coinDenom: 'STRD', coinMinimalDenom: 'ustrd', coinDecimals: 6 },
  gasPriceStep: { low: 0.001, average: 0.0025, high: 0.004 },
})
```

---

## 🎯 Test Scenarios

### Scenario 1: New Stride Account (Uninitialized)
**Expected Flow:**
1. User swaps TFUEL → stkATOM on Theta Testnet
2. Swap succeeds, attempts Cosmos staking
3. **StrideInitModal auto-triggers** (detects uninitialized account)
4. Modal shows:
   - "Unlock Stride — 10s Setup" headline
   - 3-step guide with progress indicators
   - "Get 0.5 STRD on Osmosis" button (pre-filled URL)
5. User clicks → Opens Osmosis testnet with pre-filled swap
6. User completes swap in Keplr
7. **Auto-detection polling** starts (checks every 5s)
8. Progress bar animates: "~10s remaining"
9. Account detected → Success checkmark → Modal auto-closes
10. Retry staking → Succeeds → Confetti + success toast

**Validation Checkpoints:**
- [ ] Modal triggers automatically (no manual intervention)
- [ ] Osmosis URL pre-filled: `?from=ATOM&to=STRD&amount=0.5`
- [ ] Polling detects account within 15-30s of STRD transfer
- [ ] Retry staking completes successfully
- [ ] No browser refresh required

---

### Scenario 2: Existing Stride Account (Initialized)
**Expected Flow:**
1. User swaps TFUEL → stkTIA on Theta Testnet
2. Swap succeeds, attempts Cosmos staking
3. **No modal shown** (account already has STRD balance)
4. Keplr signing popup appears immediately
5. User approves → Staking succeeds → Success toast

**Validation Checkpoints:**
- [ ] No StrideInitModal shown
- [ ] Direct to Keplr signing popup
- [ ] Staking completes in <10s

---

### Scenario 3: User Manual Setup
**Expected Flow:**
1. StrideInitModal shown (uninitialized account)
2. User clicks "I'll send STRD manually"
3. Modal switches to manual instructions view
4. User copies Stride address, sends STRD from exchange/wallet
5. User clicks "I Sent STRD — Verify"
6. System checks account → Success or "Not yet detected, try again"

**Validation Checkpoints:**
- [ ] Manual flow accessible via footer button
- [ ] Address displayed correctly (full bech32)
- [ ] Verify button triggers immediate check
- [ ] User can retry multiple times

---

### Scenario 4: Mobile Flow (Expo App)
**Expected Flow:**
1. User swaps TFUEL → stkXPRT on mobile
2. StrideInitModal shown (mobile-optimized)
3. **Haptic feedback** on button taps (Medium impact)
4. **Reanimated pulse** animation on sparkles icon
5. Taps "Get 0.5 STRD" → Opens Osmosis in mobile browser
6. Progress bar with **gradient animation** (smooth pulse)
7. Success → **Vibration pattern** (0-100-50-100ms) + green checkmark
8. Modal closes with spring animation

**Validation Checkpoints:**
- [ ] Haptics work on iOS/Android physical device
- [ ] Animations smooth (60fps, no jank)
- [ ] Deep-linking back to app works
- [ ] Osmosis mobile site is responsive

---

## 🔬 Manual Testing Script

### Step-by-Step Test (Web)
```bash
# 1. Start local testnet environment
npm run start:testnet

# 2. Open browser, connect Keplr
open http://localhost:5173

# 3. Connect Theta Wallet (testnet)
# Get testnet TFUEL: https://faucet.thetatoken.org

# 4. Perform swap
# Select stkATOM, 10 TFUEL

# 5. Observe StrideInitModal trigger
# Screenshot modal for docs

# 6. Complete Osmosis swap
# Use testnet faucet ATOM

# 7. Watch auto-detection
# Should complete in ~15s

# 8. Verify retry staking
# Check Mintscan: https://testnet.mintscan.io/stride-testnet/txs/{TX_HASH}
```

### Step-by-Step Test (Mobile)
```bash
# 1. Build Expo dev client
cd edgefarm-mobile
eas build --profile development --platform ios

# 2. Install on physical device
eas build:run -p ios

# 3. Enable haptics debugging
# Settings → Accessibility → Touch → System Haptics: ON

# 4. Perform swap, trigger modal
# Record screen for animation review

# 5. Test haptic patterns
# Button taps should feel tactile
# Success vibration should be distinct

# 6. Verify performance
# Animations should be 60fps
# No frame drops on modal transitions
```

---

## 📊 Success Metrics

### Performance Targets
- **Modal load time:** <200ms
- **Osmosis URL generation:** <50ms
- **Account detection:** 10-30s (avg 15s)
- **Retry staking:** <8s
- **Mobile animations:** 60fps (no jank)

### User Experience Targets
- **Zero manual steps** for 90% of users
- **No refresh required** (100% automated)
- **<3 taps** from modal to staking complete
- **Clear progress** at every step (no "what's happening?" confusion)

---

## 🐛 Known Issues & Fallbacks

### Issue: Osmosis testnet slow
**Fallback:** Show estimated wait time, allow manual setup

### Issue: RPC rate limits
**Fallback:** Exponential backoff, max 60 attempts

### Issue: Keplr signing timeout
**Fallback:** Retry button, clear error message

### Issue: Mobile deep-linking breaks
**Fallback:** Show QR code for desktop Keplr

---

## ✅ Testnet Validation Checklist

- [ ] StrideInitModal triggers correctly (uninitialized accounts)
- [ ] Osmosis swap URL pre-fills correctly
- [ ] Auto-detection polling works (5s intervals, max 5min)
- [ ] Progress bar animates smoothly
- [ ] Success state shows correctly (checkmark + confetti)
- [ ] Retry staking completes after initialization
- [ ] Manual setup flow works (copy address, verify)
- [ ] Mobile haptics work on physical device
- [ ] Mobile animations are 60fps
- [ ] No console errors in browser/Expo logs
- [ ] All flows complete in <60s total

---

## 🚀 Post-Validation: Deploy to Mainnet

Once testnet validation passes:

1. Update `src/utils/cosmosLSTStaking.ts`:
   - Change `STRIDE_CHAIN_ID` to `'stride-1'`
   - Change RPC to mainnet: `https://stride-rpc.polkachu.com`
   
2. Deploy StrideInitModal to production:
   ```bash
   npm run build
   vercel --prod
   ```

3. Monitor first 100 mainnet users:
   - Success rate (target: >95%)
   - Average time to complete (target: <30s)
   - Modal abandonment rate (target: <10%)

---

**Testing Status: Ready for Testnet Validation**
**Target Completion: 1-2 hours manual testing**
**Confidence Level: 🚀 Musk-Approved**

