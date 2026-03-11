# 🚀 Swap Flow Mainnet Testing Guide

**XFuel Protocol - Live Beta on Theta Mainnet**  
**Version:** 1.0.0  
**Date:** December 27, 2025

---

## ⚠️ CRITICAL SAFETY NOTICE

**YOU ARE TESTING ON LIVE MAINNET WITH REAL FUNDS**

- ❌ Contracts are **UNAUDITED** - use at your own risk
- 🛡️ Safety limits enforced: **1,000 TFUEL/swap, 5,000 TFUEL total/user**
- 🔒 Emergency pause/kill switches active
- 💰 Start with **small amounts** (<100 TFUEL) for initial tests

---

## 🎯 Testing Objectives

This guide ensures swap functionality is **bulletproof** for live mainnet beta:

1. ✅ **Zero-friction swap flow** (connect → swap → stake in <60s)
2. ✅ **Comprehensive error handling** (network, balance, RPC, Stride init)
3. ✅ **Auto-recovery** (nonce errors, sequence mismatches)
4. ✅ **Seamless Stride initialization** (guided Osmosis flow)
5. ✅ **Clear UX** (loading states, progress bars, confetti, toasts)

---

## 📋 Manual E2E Test Checklist

### Test Environment Setup

**Required:**
- Theta Wallet or MetaMask with TFUEL on Theta Mainnet
- Keplr wallet (for Cosmos LST staking)
- Desktop browser (Chrome/Brave recommended) or Mobile (iOS/Android)

**Network:**
- Theta Mainnet (Chain ID: 361)
- RPC: `https://eth-rpc-api.thetatoken.org/rpc`

---

### Test Case 1: First-Time User - Full Flow

**Objective:** Validate complete swap-to-stake flow for new user

**Steps:**
1. **Connect Wallet**
   - [ ] Click "Connect Wallet"
   - [ ] Select MetaMask or Theta Wallet
   - [ ] Verify address displays correctly (truncated)
   - [ ] Verify TFUEL balance loads within 3 seconds

2. **Select Swap Amount**
   - [ ] Try percentage buttons (25%, 50%, 75%, 100%)
   - [ ] Verify computed TFUEL amount updates instantly
   - [ ] Verify estimated LST output displays
   - [ ] Verify APY shows for selected LST

3. **Select LST Target**
   - [ ] Click LST dropdown
   - [ ] Select `stkXPRT` (recommended for first test)
   - [ ] Verify APY updates
   - [ ] Verify estimated daily yield displays

4. **Execute Swap**
   - [ ] Click "Swap & Stake" button
   - [ ] Verify beta limit check passes (amount <1000 TFUEL)
   - [ ] Verify loading state shows "Swapping..."
   - [ ] Approve transaction in wallet
   - [ ] Wait for confirmation (~6-10 seconds on Theta)
   - [ ] Verify success message displays
   - [ ] Verify confetti animation triggers
   - [ ] Verify transaction hash link to explorer works

5. **Stride LST Staking (Auto-Triggered)**
   - [ ] Verify "Preparing stkXPRT staking..." message
   - [ ] Keplr popup should appear for signature
   - [ ] **If Stride account uninitialized:** See Test Case 4
   - [ ] **If account initialized:** Sign transaction
   - [ ] Verify success message: "✅ X.XX stkXPRT received in Keplr"
   - [ ] Verify double confetti animation
   - [ ] Check Keplr wallet - LST balance should update

**Expected Duration:** 30-60 seconds (with initialized Stride account)

**Success Criteria:**
- ✅ Swap completes on Theta (tx confirmed)
- ✅ LST tokens appear in Keplr wallet
- ✅ No errors displayed
- ✅ User balance updates correctly

---

### Test Case 2: Insufficient Balance Error

**Objective:** Validate error handling for insufficient TFUEL

**Steps:**
1. Connect wallet with low TFUEL balance (<10 TFUEL)
2. Try to swap more than available balance
3. Click "Swap & Stake"

**Expected Behavior:**
- [ ] Error message: "❌ Insufficient balance. Need X.XX TFUEL (including gas)."
- [ ] Status resets to idle after 5 seconds
- [ ] No transaction attempted

---

### Test Case 3: Beta Limit Exceeded

**Objective:** Validate mainnet safety limits enforcement

**Steps:**
1. Connect wallet
2. Try to swap >1,000 TFUEL in single transaction
3. Click "Swap & Stake"

**Expected Behavior:**
- [ ] Error message: "❌ Swap amount exceeds maximum of 1000 TFUEL per transaction"
- [ ] Transaction blocked
- [ ] Status resets after 5 seconds

**Alternate Test (Total Limit):**
1. Make multiple swaps totaling >5,000 TFUEL
2. Attempt another swap

**Expected:**
- [ ] Error: "❌ Total limit exceeded. You have X.XX TFUEL remaining (5000 TFUEL total limit)"

---

### Test Case 4: Stride Account Initialization (Seamless Flow)

**Objective:** Validate Tesla-style zero-friction Stride setup

**Prerequisites:**
- Fresh Keplr wallet with no prior Stride transactions
- OR test Stride address with zero balance

**Steps:**
1. Complete Test Case 1 (steps 1-4) - swap executes successfully
2. When Keplr staking fails with "account not found" error:

**Stride Init Modal Should Appear:**
- [ ] Modal displays: "Unlock Stride — 10s Setup"
- [ ] Shows 3-step guide (Osmosis swap → Confirm → Auto-verify)
- [ ] Displays your Stride address
- [ ] Shows "Get 0.5 STRD on Osmosis" button

3. Click "Get 0.5 STRD on Osmosis"
   - [ ] New window opens to Osmosis DEX
   - [ ] Pre-filled: 0.5 STRD from ATOM
   - [ ] Keplr connects automatically

4. Complete Osmosis Swap
   - [ ] Approve swap in Keplr
   - [ ] Wait ~10-20 seconds for confirmation

5. Auto-Verification
   - [ ] Modal shows "Verifying Activation..." with progress bar
   - [ ] Polls every 5 seconds (up to 5 minutes)
   - [ ] Success message: "Stride Activated! 🚀"
   - [ ] Confetti animation triggers
   - [ ] Modal auto-closes
   - [ ] Staking retries automatically

**Expected Duration:** <60 seconds from modal open to staking complete

**Success Criteria:**
- ✅ Osmosis swap completes
- ✅ Stride account activated (verified via API)
- ✅ Original LST staking completes automatically
- ✅ No manual intervention required

**Fallback Test (Manual Path):**
- [ ] Click "I'll send STRD manually" in modal
- [ ] Manual instructions display with Stride address
- [ ] "I Sent STRD — Verify" button re-checks account

---

### Test Case 5: Network Errors & Auto-Retry

**Objective:** Validate resilience to RPC/network failures

**Steps:**
1. Disconnect internet mid-swap OR
2. Use Theta RPC during high load

**Expected Behavior:**
- [ ] Error: "🌐 Network error. Please check your connection and try again."
- [ ] Status message persists for 10 seconds (user can read it)
- [ ] User can retry manually

**Nonce/Sequence Error Test:**
1. Submit two rapid swaps from same wallet
2. Second swap may hit nonce conflict

**Expected:**
- [ ] Error: "🔄 Transaction sequence error. Refreshing and retrying..."
- [ ] Auto-retries after 2 seconds
- [ ] If retry succeeds: swap completes
- [ ] If retry fails: clear error message shown

---

### Test Case 6: User Rejection (Wallet Cancel)

**Objective:** Validate graceful handling of user-cancelled transactions

**Steps:**
1. Click "Swap & Stake"
2. **Reject transaction** in wallet popup

**Expected Behavior:**
- [ ] Error: "❌ Transaction rejected by user"
- [ ] Status resets to idle after 10 seconds
- [ ] No residual loading states
- [ ] User can retry immediately

---

### Test Case 7: Multiple LST Targets

**Objective:** Test all supported LST options

**Test Each:**
1. [ ] **stkXPRT** (Persistence) - 25.7% APY
2. [ ] **stkATOM** (Cosmos Hub) - 19.5% APY
3. [ ] **stkTIA** (Celestia) - 15.2% APY
4. [ ] **stkOSMO** (Osmosis) - 18.1% APY

**For Each LST:**
- [ ] Swap 50-100 TFUEL
- [ ] Verify correct LST received in Keplr
- [ ] Verify APY displays correctly
- [ ] Verify staking completes on Stride

---

### Test Case 8: Mobile Testing

**Objective:** Validate mobile web experience

**Devices:** iOS (Safari), Android (Chrome)

**Steps:**
1. [ ] Connect via WalletConnect or MetaMask mobile
2. [ ] Swap 100 TFUEL → stkXPRT
3. [ ] Verify mobile-optimized UI (touch targets >44px)
4. [ ] Verify confetti and animations render smoothly
5. [ ] Verify Keplr mobile deep-linking works

**Success Criteria:**
- ✅ Entire flow works on mobile
- ✅ No layout breaks or overlapping elements
- ✅ Deep-linking to Keplr/Osmosis works

---

### Test Case 9: Repeat User (With Swap History)

**Objective:** Validate state persistence and limit tracking

**Steps:**
1. Connect wallet that has previous swaps
2. Check profile tab
   - [ ] Verify swap history displays
   - [ ] Verify remaining allowance shows correctly
3. Attempt swap near limit
   - [ ] If <1000 TFUEL remaining: test partial swap
   - [ ] If at 5000 TFUEL limit: verify block with clear message

---

### Test Case 10: Beta Banner Visibility

**Objective:** Ensure warning banner always visible on mainnet

**Steps:**
1. Load app on Theta Mainnet
2. Check top of page

**Expected:**
- [ ] Banner displays: "🚨 Live Mainnet Beta Testing - Unaudited Contracts"
- [ ] Shows safety limits: "Max 1,000 TFUEL/swap • 5,000 TFUEL total/user"
- [ ] Banner is **NON-DISMISSIBLE** (no X button, only info icon)
- [ ] Banner persists across page refreshes
- [ ] Banner has pulsing warning icon

---

## 🔍 Post-Test Validation

After completing all test cases, verify:

### On-Chain Verification
1. **Theta Explorer:**
   - [ ] All swap transactions confirmed
   - [ ] Router contract received TFUEL
   - [ ] No failed/reverted transactions (except intentional rejections)

2. **Stride/Mintscan:**
   - [ ] LST delegation transactions confirmed
   - [ ] Correct amounts received
   - [ ] Staking rewards accruing

3. **Wallet Balances:**
   - [ ] TFUEL balance decreased by (swap amount + gas)
   - [ ] LST balance in Keplr matches expected amount
   - [ ] No "stuck" transactions

### UX Validation
- [ ] All loading states clear and informative
- [ ] No orphaned error messages
- [ ] Confetti triggers only on success
- [ ] Transaction links work
- [ ] Status resets properly after errors

---

## 🐛 Bug Reporting

If you encounter issues, capture:

1. **Browser Console Logs**
   - Press F12 → Console tab
   - Copy all red errors and warnings

2. **Transaction Details**
   - Wallet address (can be truncated)
   - Transaction hash (if available)
   - Amount and LST target
   - Network (Theta Mainnet Chain ID 361)

3. **Reproduction Steps**
   - Exact sequence that triggered bug
   - Wallet used (MetaMask/Theta Wallet/WalletConnect)
   - Device/browser (e.g., Chrome 120 on Windows 11)

4. **Screenshots/Screen Recording**
   - Capture error modals, status messages
   - GIFs help diagnose UX issues

**Report to:** GitHub Issues or dev team channel

---

## ✅ Definition of Done

Swap flow is **production-ready** when:

- ✅ All 10 test cases pass without critical errors
- ✅ Error handling covers 100% of known failure modes
- ✅ Stride initialization flow works seamlessly (<60s)
- ✅ Mobile experience is smooth (60fps animations)
- ✅ Beta limits enforced correctly (client + contract)
- ✅ No "userAddress is undefined" errors
- ✅ Auto-retry works for sequence errors
- ✅ Beta banner non-dismissible on mainnet
- ✅ Users can complete full flow without external docs

---

## 🚀 Performance Benchmarks

Target metrics for mainnet:

| Metric | Target | Acceptable | Critical |
|--------|--------|-----------|----------|
| **Wallet Connect** | <2s | <5s | >10s |
| **Swap Tx Confirmation** | <8s | <15s | >30s |
| **Stride Staking** | <10s | <20s | >45s |
| **Full Flow (end-to-end)** | <30s | <60s | >2min |
| **Stride Init (with Osmosis)** | <60s | <90s | >3min |
| **Error Message Display** | Instant | <1s | >2s |
| **UI Responsiveness** | 60fps | 30fps | <30fps |

---

## 📞 Support Resources

- **Docs:** `docs/UNIFIED_DEPLOYMENT_GUIDE.md`
- **Architecture:** `STRIDE_IMPLEMENTATION_SUMMARY.md`
- **Quick Ref:** `QUICK_REFERENCE.md`
- **Theta Explorer:** https://explorer.thetatoken.org
- **Stride/Mintscan:** https://www.mintscan.io/stride
- **Osmosis:** https://app.osmosis.zone

---

**Built with 🚀 by XFuel Labs**  
**Audacity Level: Elon Musk**  
**Execution Speed: Ludicrous Mode**  
**Testing Philosophy: Ship Fast, Test Hard, Fix Faster**


