# XFuel Protocol Mobile - Test Suite for Theta Testnet

## Overview

Comprehensive testing guide for the XFuel Protocol mobile app on Theta Testnet. This document covers wallet integration, swap functionality, UI/UX flows, and luxury features.

## Prerequisites

- Theta Wallet mobile app installed
- Theta Testnet test TFUEL (from faucet)
- Expo Go app (for testing)
- Physical device or emulator

## Setup

### 1. Install Dependencies

```bash
cd edgefarm-mobile
npm install
```

### 2. Configure Environment

Create `app.json` with testnet configuration:

```json
{
  "expo": {
    "extra": {
      "routerAddress": "0xYourRouterAddress",
      "apiUrl": "https://api-testnet.xfuel.app",
      "thetaMainnetRpc": "https://eth-rpc-api-testnet.thetatoken.org/rpc",
      "thetaMainnetChainId": 365,
      "thetaExplorerUrl": "https://testnet-explorer.thetatoken.org"
    }
  }
}
```

### 3. Start Development Server

```bash
npm start
```

## Test Cases

### A. Wallet Connection Tests

#### A1: Smart Connect (AI-Powered)
**Objective:** Test automatic session restoration and AI-powered connection method prediction.

**Steps:**
1. Launch app for first time
2. Navigate to Swap screen
3. Tap "Smart Connect" button
4. Approve connection in Theta Wallet
5. Close app completely
6. Reopen app
7. Verify auto-reconnect happens (check for "Session restored" toast)

**Expected Result:**
- First connection: WalletConnect modal appears with QR code
- Deep link attempts to open Theta Wallet app
- After approval, wallet connected with address displayed
- On relaunch, session automatically restored within 2 seconds
- Success haptic feedback (light → medium → success sequence)

**Pass Criteria:**
- ✅ Connection successful on first attempt
- ✅ Session persists across app restarts
- ✅ Auto-reconnect works within 2 seconds
- ✅ No QR flash on subsequent launches

#### A2: WalletConnect v2 Fallback
**Objective:** Test WalletConnect v2 integration with proper deep linking.

**Steps:**
1. Clear app data/storage
2. Launch app
3. Navigate to Swap screen
4. Tap "Smart Connect"
5. If deep link fails, scan QR code manually
6. Approve in Theta Wallet

**Expected Result:**
- QR code displays if deep link unavailable
- QR code is scannable
- Connection establishes within 10 seconds
- No error toasts or crashes

**Pass Criteria:**
- ✅ QR code renders correctly
- ✅ Connection via QR successful
- ✅ Proper error handling if rejected

#### A3: Biometric Authentication
**Objective:** Test Face ID/Touch ID wallet unlock.

**Steps:**
1. Connect wallet via Smart Connect
2. Navigate to Profile screen
3. Enable biometric authentication
4. Close app
5. Reopen app
6. Verify biometric prompt appears
7. Authenticate with Face ID/Touch ID

**Expected Result:**
- Biometric settings toggle available
- Prompt shows correct type (Face ID or Touch ID)
- Tesla key fob haptic sequence on success (light → medium → success)
- Session unlocked after successful auth

**Pass Criteria:**
- ✅ Biometric prompt appears
- ✅ Authentication successful
- ✅ Proper haptic feedback
- ✅ Graceful fallback if biometric fails

### B. Swap Functionality Tests

#### B1: LST Carousel Selection
**Objective:** Test infinite carousel with parallax effects and AI recommendations.

**Steps:**
1. Connect wallet
2. Navigate to Swap screen
3. Scroll through LST carousel
4. Observe parallax animations
5. Tap to select different LSTs
6. Verify AI recommendation badge appears

**Expected Result:**
- Carousel scrolls smoothly at 60fps
- Cards scale and fade with parallax
- AI recommendation shows highest APY LST by default
- Selection haptic on tap (medium impact)
- Selected LST highlights with glow effect

**Pass Criteria:**
- ✅ Smooth 60fps carousel
- ✅ Parallax animations working
- ✅ AI badge shows for recommended LST
- ✅ Selection updates preview correctly

#### B2: Swap Amount Slider
**Objective:** Test amount selection with haptic feedback.

**Steps:**
1. Connect wallet with test TFUEL
2. Drag swap percentage slider
3. Verify haptic feedback on value change
4. Set to 100%
5. Verify preview updates in real-time

**Expected Result:**
- Slider moves smoothly
- Haptic selection feedback on every change
- TFUEL amount updates instantly
- Preview card shows estimated LST amount
- Daily yield calculation displays

**Pass Criteria:**
- ✅ Slider responsive
- ✅ Haptic feedback on every change
- ✅ Real-time preview updates
- ✅ Calculations accurate

#### B3: Swap Execution
**Objective:** Test full swap flow with confetti celebration.

**Steps:**
1. Connect wallet
2. Select swap amount (e.g., 10 TFUEL)
3. Select target LST (e.g., stkXPRT)
4. Tap "Swap & Compound" button
5. Approve transaction in Theta Wallet
6. Wait for confirmation
7. Observe confetti animation
8. Verify success toast

**Expected Result:**
- "Swapping..." status with loading state
- Hypercar rev haptic sequence (light → medium → heavy x2)
- Success toast: "Swapped to stkXPRT! Now earning 25.7% APY"
- Confetti animation fires (200 particles)
- Transaction hash link appears
- Balance refreshes after 3 seconds

**Pass Criteria:**
- ✅ Swap completes successfully
- ✅ Confetti animation plays
- ✅ Success haptic sequence
- ✅ Balance updates
- ✅ Explorer link works

#### B4: Swap Error Handling
**Objective:** Test error scenarios (insufficient funds, network errors).

**Steps:**
1. Set swap amount > wallet balance
2. Tap "Swap & Compound"
3. Verify insufficient funds error
4. Disconnect internet
5. Attempt swap
6. Verify network error toast

**Expected Result:**
- Insufficient funds: "Insufficient TFUEL balance" warning toast
- Network error: "Network error. Please check your connection." toast
- Error haptic feedback (error notification)
- No crash or frozen UI

**Pass Criteria:**
- ✅ Proper error messages
- ✅ Error haptics
- ✅ UI remains responsive
- ✅ Can retry after fixing issue

### C. CockPit Dashboard Tests

#### C1: Animated Gauges
**Objective:** Test circular gauge animations with pulsing glows.

**Steps:**
1. Navigate to Home screen
2. Observe TFUEL balance gauge
3. Observe revenue velocity gauge
4. Observe blended APY gauge
5. Pull to refresh
6. Verify gauges animate to new values

**Expected Result:**
- Gauges render with smooth 60fps animations
- Progress circles fill with spring animation
- Glow pulses subtly (2.2s cycle)
- Values update with spring physics
- Shadow effects visible

**Pass Criteria:**
- ✅ All gauges render correctly
- ✅ Smooth 60fps animations
- ✅ Pulsing glows working
- ✅ Values update correctly

#### C2: Velocity Gauge
**Objective:** Test revenue velocity indicator with trend arrow.

**Steps:**
1. Navigate to Home screen
2. Observe velocity gauge
3. Verify arrow rotation based on trend
4. Check daily revenue display
5. Verify "Accelerating" or "Slowing" label

**Expected Result:**
- Arrow rotates -45° to +45° based on velocity
- Green color for positive trend
- Pink color for negative trend
- Daily revenue in center
- Smooth rotation animation

**Pass Criteria:**
- ✅ Arrow rotates correctly
- ✅ Colors match trend
- ✅ Daily revenue accurate
- ✅ Smooth animations

#### C3: Expandable Metric Cards
**Objective:** Test sub-panel expansion with detailed metrics.

**Steps:**
1. Tap "TOTAL VALUE" metric card
2. Verify expansion animation
3. Check LST breakdown display
4. Tap chevron to collapse
5. Verify collapse animation

**Expected Result:**
- Card expands smoothly with spring animation
- Chevron rotates 180°
- LST breakdown shows all positions
- Collapse animation mirrors expansion
- Haptic feedback on tap

**Pass Criteria:**
- ✅ Smooth expansion/collapse
- ✅ Chevron rotates
- ✅ Breakdown displays correctly
- ✅ Haptic feedback

### D. Luxury Features Tests

#### D1: Daily Streak Tracker
**Objective:** Test gamified streak system with badge unlocks.

**Steps:**
1. Launch app for first time
2. Verify daily check-in occurs
3. Check for streak badge on Home screen
4. Close app and wait 24 hours
5. Reopen app next day
6. Verify streak increments
7. Reach 7-day streak
8. Verify "Orbit Achiever" badge unlock

**Expected Result:**
- First day: "1-Day Streak" badge appears
- Badge unlock alert for "Mars Recruit" (1 day)
- Next day: Streak increments to 2
- At 7 days: Epic badge unlock animation
- Success haptics (heavy → heavy → success)
- Badge displayed on Home screen

**Pass Criteria:**
- ✅ Streak persists correctly
- ✅ Badge unlocks at milestones
- ✅ Alert shows badge info
- ✅ Haptic celebration sequence

#### D2: Crew Mode Sharing
**Objective:** Test social sharing with Tesla referral vibes.

**Steps:**
1. Navigate to Profile screen
2. Tap "Share with Crew" button
3. Verify share sheet opens
4. Check share message format
5. Share via any app (Messages, Twitter, etc.)

**Expected Result:**
- Share sheet opens
- Message includes: total yield, APY, streak, referral code
- Format: "🚀 I'm earning X% APY with XFuel Protocol..."
- Success haptic on share completion

**Pass Criteria:**
- ✅ Share sheet opens
- ✅ Message formatted correctly
- ✅ Share completes
- ✅ Haptic feedback

#### D3: Voice Commands
**Objective:** Test hands-free navigation (mock/simulated).

**Steps:**
1. Navigate to Home screen
2. Tap voice command button (mic icon)
3. Simulate voice command: "show my yields"
4. Verify spoken response
5. Try command: "navigate to swap"
6. Verify navigation occurs

**Expected Result:**
- Mic button activates (purple glow)
- Command parsed correctly
- Spoken response: "Showing your yields."
- Navigation executes
- Haptic feedback on command

**Pass Criteria:**
- ✅ Voice listener activates
- ✅ Commands parsed correctly
- ✅ Actions execute
- ✅ Voice feedback works

### E. Performance Tests

#### E1: Load Time
**Objective:** Measure app launch to interactive time.

**Steps:**
1. Close app completely
2. Launch app
3. Time from splash to Home screen
4. Verify < 2 seconds

**Expected Result:**
- Splash screen: < 500ms
- Font loading: < 300ms
- Home screen render: < 1200ms
- Total: < 2000ms

**Pass Criteria:**
- ✅ Launch under 2 seconds
- ✅ No loading spinners on first screen
- ✅ Smooth transition

#### E2: Animation Performance
**Objective:** Verify 60fps for all animations.

**Steps:**
1. Enable performance monitor (Expo dev tools)
2. Navigate between screens
3. Scroll carousel
4. Expand metric cards
5. Monitor FPS counter

**Expected Result:**
- FPS stays at 60 during all animations
- No frame drops during gestures
- Smooth transitions

**Pass Criteria:**
- ✅ 60fps maintained
- ✅ No jank or stutters
- ✅ Memory usage stable

## Test TFUEL Faucet

If you run out of test TFUEL during testing:

```
https://faucet.testnet.theta.org/request?address=YOUR_ADDRESS
```

## Automated Testing (Future)

For automated E2E testing, consider:
- Detox (React Native E2E testing)
- Appium (Cross-platform mobile testing)
- Expo Testing Library (Component testing)

## Bug Reporting

Report issues with:
- Device model & OS version
- Steps to reproduce
- Expected vs actual behavior
- Screenshots/screen recording
- Console logs

## Success Criteria Summary

**Must Pass:**
- ✅ All wallet connection methods work
- ✅ Swaps execute successfully
- ✅ All animations at 60fps
- ✅ Session persistence works
- ✅ Biometric auth works (if available)
- ✅ No crashes or freezes
- ✅ Error handling graceful

**Nice to Have:**
- Voice commands functional
- Badge unlocks working
- Crew mode sharing works
- All micro-interactions perfect

---

**Last Updated:** December 2025  
**Version:** 1.0.0 Pro

