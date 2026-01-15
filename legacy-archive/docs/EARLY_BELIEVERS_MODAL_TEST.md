# Early Believers Modal - Comprehensive Test Guide

This document provides a complete testing guide for the Early Believers contribution modal on xfuel.app.

## Table of Contents

1. [Local Development Setup](#local-development-setup)
2. [Automated Tests](#automated-tests)
3. [Manual Testing Guide](#manual-testing-guide)
4. [Test Scenarios](#test-scenarios)
5. [Troubleshooting](#troubleshooting)

## Local Development Setup

### Prerequisites

- Node.js >= 24.0.0
- npm >= 10.0.0
- Theta Wallet or MetaMask browser extension
- Access to Theta Mainnet (Chain ID: 361)

### Environment Configuration

Ensure your `.env` file contains:

```bash
VITE_MULTISIG_ADDRESS=0x9D6fC5EEa264182783Da01Bcfc135E52bE7bF257
VITE_USDC_ADDRESS_MAINNET=0x9D6fC5EEa264182783Da01Bcfc135E52bE7bF257
VITE_CONTRIBUTION_WEBHOOK_URL=https://hooks.zapier.com/hooks/catch/25764894/uakt9ir/
```

### Start Development Server

```bash
npm install
npm run dev
```

The app will be available at `http://localhost:5173` (or the port Vite assigns).

## Automated Tests

### Run Unit Tests (Jest)

```bash
npm test
```

Tests the component logic, tier calculations, and wallet connection handling.

### Run E2E Tests (Cypress)

```bash
# Interactive mode
npm run test:e2e

# Headless mode
npm run test:e2e:headless
```

Tests the full user flow including modal interactions.

### Test Coverage

```bash
npm test -- --coverage
```

## Manual Testing Guide

### Test 1: Homepage Card Visibility

**Steps:**
1. Navigate to `http://localhost:5173`
2. Scroll to find the "Early Believers Round — Mainnet Live" card
3. Verify card displays:
   - Title: "Early Believers Round — Mainnet Live"
   - Subtext: "TFUEL farmed into fresh rXF soul — day 1 yield, 4× governance power"
   - "Contribute Now" button visible
   - Tier bonus information visible

**Expected Result:**
- Card is prominently displayed
- All text is readable
- Button is clickable

---

### Test 2: Modal Opens on Card Click

**Steps:**
1. Click the "Contribute Now" button on the card
2. Verify modal opens in full-screen overlay

**Expected Result:**
- Modal appears with dark overlay background
- Modal content is centered and visible
- Close button (X) or click-outside-to-close works

---

### Test 3: Wallet Connection - Mainnet Enforcement

#### 3a. Connect on Mainnet (Success)

**Steps:**
1. Open modal
2. Click "Connect Theta Wallet"
3. Approve connection in wallet extension
4. Verify wallet is connected

**Expected Result:**
- Wallet connects successfully
- Connected wallet address is displayed (truncated format)
- TFUEL balance is shown
- USDC balance is shown (if USDC address configured)
- No network error message

#### 3b. Wrong Network Detection

**Steps:**
1. Switch wallet to Theta Testnet (Chain ID: 365) or another network
2. Open modal
3. Click "Connect Theta Wallet"
4. Approve connection

**Expected Result:**
- Network error message appears: "Please switch to Theta Mainnet (Chain ID: 361)"
- "Switch to Theta Mainnet" button is visible
- Clicking the button prompts wallet to switch networks

#### 3c. Wallet Connection Rejection

**Steps:**
1. Open modal
2. Click "Connect Theta Wallet"
3. Reject the connection in wallet popup

**Expected Result:**
- Modal remains open
- "Connect Theta Wallet" button is still visible
- No error state (graceful handling)

---

### Test 4: Minimum Contribution ($100)

**Steps:**
1. Connect wallet
2. Enter amount: `50` (USDC)
3. Observe validation

**Expected Result:**
- Warning message: "Minimum contribution is $100 USD. Your contribution of $50.00 USD is below the minimum."
- "Contribute Now" button is disabled
- Label shows "(Minimum: $100)"

**Steps:**
1. Enter amount: `100` (USDC)
2. Verify button becomes enabled

**Expected Result:**
- No warning message
- "Contribute Now" button is enabled
- Can proceed with contribution

---

### Test 5: Amount Input and Tier Calculation

#### 4a. Standard Tier (< $50k)

**Steps:**
1. Connect wallet (on mainnet)
2. Enter amount: `10000` (USDC)
3. Observe tier calculation section

**Expected Result:**
- Tier shows: "Standard"
- No bonus displayed
- Total rXF = Contribution amount (1:1 ratio)
- Hint text: "$50k-$99k: +10% bonus rXF | $100k+: +25% bonus rXF"

#### 4b. +10% Bonus Tier ($50k-$99k)

**Steps:**
1. Connect wallet
2. Enter amount: `60000` (USDC)
3. Observe tier calculation

**Expected Result:**
- Tier shows: "+10% bonus rXF"
- Bonus (10%) line appears with calculated bonus amount
- Total rXF = Contribution + 10% bonus
- Example: $60,000 → $6,000 bonus → $66,000 total rXF

#### 4c. +25% Bonus Tier ($100k+)

**Steps:**
1. Connect wallet
2. Enter amount: `150000` (USDC)
3. Observe tier calculation

**Expected Result:**
- Tier shows: "+25% bonus rXF"
- Bonus (25%) line appears
- Total rXF = Contribution + 25% bonus
- Example: $150,000 → $37,500 bonus → $187,500 total rXF

#### 4d. Live Tier Updates

**Steps:**
1. Connect wallet
2. Enter `30000` → verify Standard
3. Change to `60000` → verify +10%
4. Change to `120000` → verify +25%
5. Change back to `20000` → verify Standard

**Expected Result:**
- Tier updates instantly as amount changes
- Calculations are accurate
- UI reflects correct tier color coding

---

### Test 6: Payment Method Toggle

#### 5a. USDC (Default)

**Steps:**
1. Connect wallet
2. Verify USDC button is selected (highlighted)
3. Enter amount in USDC

**Expected Result:**
- USDC button has active styling (cyan border, glow)
- Input accepts decimal values (e.g., 1000.50)
- Amount is treated as USD value directly

#### 5b. TFUEL Toggle

**Steps:**
1. Connect wallet
2. Click "TFUEL" button
3. Verify TFUEL is selected
4. Enter amount in TFUEL

**Expected Result:**
- TFUEL button becomes active
- USDC button becomes inactive
- Input accepts TFUEL amounts
- USD equivalent is displayed below input (e.g., "≈ $50.00 USD")
- USD equivalent updates based on live TFUEL price

#### 5c. Toggle Between Methods

**Steps:**
1. Enter `1000` USDC
2. Switch to TFUEL
3. Verify amount clears or converts appropriately
4. Switch back to USDC

**Expected Result:**
- Amount input behavior is consistent
- Tier calculations update based on USD value
- No errors when toggling

---

### Test 7: Payment Transaction - TFUEL

#### 6a. Successful TFUEL Transaction

**Prerequisites:**
- Wallet connected on mainnet
- Sufficient TFUEL balance (amount + gas)
- Test with small amount first (e.g., 0.1 TFUEL)

**Steps:**
1. Connect wallet
2. Select TFUEL payment method
3. Enter small test amount: `0.1`
4. Verify multisig address is displayed
5. Click "Contribute Now"
6. Approve transaction in wallet
7. Wait for confirmation

**Expected Result:**
- Transaction is sent to correct multisig address
- Transaction hash is displayed
- Link to Theta Explorer is provided
- Success screen appears with exact message:
  > "Contribution received! You will receive full soulbound rXF day 1 at TGE with immediate yield, 4× governance votes, and priority spin-outs. Redeem transferable XF after 12 months. Thank you for believing."
- Modal auto-closes after 5 seconds

#### 6b. Insufficient Balance Error

**Steps:**
1. Connect wallet with low balance
2. Enter amount greater than balance
3. Click "Contribute Now"

**Expected Result:**
- Error message: "Insufficient TFUEL balance. Please ensure you have enough for the transaction and gas fees."
- Error is clearly displayed
- User can correct amount and retry

#### 6c. Transaction Rejection

**Steps:**
1. Enter valid amount
2. Click "Contribute Now"
3. Reject transaction in wallet popup

**Expected Result:**
- Error message: "Transaction rejected by user"
- Modal remains open
- User can retry

---

### Test 8: Payment Transaction - USDC

#### 7a. Successful USDC Transaction

**Prerequisites:**
- USDC address configured in `.env`
- Wallet has USDC balance
- USDC approval may be required first

**Steps:**
1. Connect wallet
2. Select USDC payment method
3. Enter test amount: `10` (USDC)
4. Click "Contribute Now"
5. Approve USDC if prompted
6. Approve transfer transaction
7. Wait for confirmation

**Expected Result:**
- Approval transaction completes first (if needed)
- Transfer transaction completes
- Success screen appears
- Transaction hash displayed

#### 7b. USDC Approval Flow

**Steps:**
1. Connect wallet with USDC
2. Enter amount
3. Click "Contribute Now"
4. Observe approval step

**Expected Result:**
- Status shows "Approving USDC..."
- After approval, status shows "Sending USDC..."
- Flow is smooth and clear

---

### Test 9: Webhook Logging

#### 8a. Console Logging

**Steps:**
1. Open browser DevTools Console (F12)
2. Complete a successful contribution
3. Check console output

**Expected Result:**
- Console log appears: `📝 Early Believer Contribution:`
- Log includes:
  - wallet address
  - amount
  - paymentMethod (USDC or TFUEL)
  - usdValue
  - tfuelPrice (if TFUEL)
  - timestamp
  - txHash
  - tier
  - tierBonus
  - totalRXF
  - network

#### 8b. Webhook POST (Zapier)

**Prerequisites:**
- Webhook URL configured in `.env`
- Access to Zapier webhook logs

**Steps:**
1. Complete a successful contribution
2. Check Zapier webhook logs

**Expected Result:**
- POST request received at webhook URL
- Payload matches console log structure
- Webhook succeeds (200 response)
- Data is captured in Airtable/Google Sheet (if configured)

#### 8c. Webhook Failure Handling

**Steps:**
1. Temporarily break webhook URL in `.env` (invalid URL)
2. Complete contribution
3. Check console

**Expected Result:**
- Console log still appears (fallback)
- Webhook error is logged but doesn't block success
- User experience is unaffected

---

### Test 10: Error Handling

#### 9a. Network Errors

**Steps:**
1. Disconnect internet
2. Attempt transaction
3. Reconnect and retry

**Expected Result:**
- Clear error message about network issues
- User can retry after reconnection

#### 9b. Transaction Revert

**Steps:**
1. Use a contract that will revert
2. Attempt transaction

**Expected Result:**
- Error message: "Transaction reverted. Please check the amount and try again."
- Clear guidance for user

#### 9c. Wrong Network Persistence

**Steps:**
1. Switch to wrong network
2. Try to contribute
3. Verify network check persists

**Expected Result:**
- Network error always shown when on wrong network
- Switch button always available
- Cannot proceed until on correct network

---

### Test 11: Disclaimer and Safety

**Steps:**
1. Open modal
2. Scroll to bottom
3. Read disclaimer footer

**Expected Result:**
- Disclaimer text is visible:
  > "This is a contribution to support protocol development. rXF provides governance and utility within XFUEL. No promise of profit."
- No investment language anywhere in modal
- Emphasis on utility: yield, governance, spin-outs

---

## Test Scenarios

### Scenario 1: First-Time User Flow

1. User visits homepage
2. Sees Early Believers card
3. Clicks "Contribute Now"
4. Connects wallet (on mainnet)
5. Enters $75,000 USDC
6. Sees +10% bonus tier
7. Submits contribution
8. Sees success message
9. Webhook logs contribution

**Success Criteria:**
- All steps complete without errors
- Tier calculation is correct ($75k → $7.5k bonus → $82.5k total)
- Transaction succeeds
- Webhook receives data

---

### Scenario 2: TFUEL Contribution with Price Fluctuation

1. User connects wallet
2. Selects TFUEL
3. Enters 10,000 TFUEL
4. Sees USD equivalent (e.g., $500 at $0.05/TFUEL)
5. Price updates to $0.06/TFUEL
6. USD equivalent updates to $600
7. Tier changes from Standard to +10% bonus
8. User submits

**Success Criteria:**
- Price updates are reflected
- Tier updates correctly
- Transaction uses current price for calculations

---

### Scenario 3: High-Value Contribution

1. User connects wallet
2. Enters $150,000 USDC
3. Sees +25% bonus tier
4. Verifies total: $187,500 rXF
5. Submits contribution
6. Success screen appears

**Success Criteria:**
- Tier correctly shows +25%
- Calculation is accurate
- Transaction succeeds
- Webhook logs with correct tier data

---

## Troubleshooting

### Issue: Modal doesn't open

**Solutions:**
- Check browser console for errors
- Verify EarlyBelieversCard component is rendered
- Check that `showEarlyBelieversModal` state is managed correctly

### Issue: Wallet won't connect

**Solutions:**
- Verify Theta Wallet or MetaMask is installed
- Check browser extension permissions
- Try refreshing the page
- Check console for connection errors

### Issue: Wrong network error persists

**Solutions:**
- Manually switch to Theta Mainnet in wallet
- Click "Switch to Theta Mainnet" button in modal
- Verify Chain ID is 361 (0x169 in hex)

### Issue: Transaction fails

**Solutions:**
- Check wallet has sufficient balance (amount + gas)
- Verify multisig address is correct in `.env`
- Check network is Theta Mainnet
- Review transaction in Theta Explorer

### Issue: Webhook not receiving data

**Solutions:**
- Verify `VITE_CONTRIBUTION_WEBHOOK_URL` in `.env`
- Check Zapier webhook is active
- Review browser console for webhook errors
- Verify CORS settings if using custom endpoint

### Issue: Tier calculation incorrect

**Solutions:**
- Verify amount is in correct currency (USDC vs TFUEL)
- Check TFUEL price is fetching correctly
- Verify USD conversion is accurate
- Review tier thresholds: $50k (10%), $100k (25%)

---

## Test Checklist

Use this checklist for comprehensive testing:

- [ ] Homepage card visible
- [ ] Modal opens on click
- [ ] Wallet connects on mainnet
- [ ] Wrong network detected
- [ ] Network switch works
- [ ] Amount input accepts values
- [ ] Standard tier (< $50k) displays correctly
- [ ] +10% tier ($50k-$99k) displays correctly
- [ ] +25% tier ($100k+) displays correctly
- [ ] Tier updates live as amount changes
- [ ] USDC payment method works
- [ ] TFUEL payment method works
- [ ] Toggle between methods works
- [ ] TFUEL transaction succeeds
- [ ] USDC transaction succeeds
- [ ] Insufficient balance error shown
- [ ] Transaction rejection handled
- [ ] Success screen displays
- [ ] Console logging works
- [ ] Webhook POST succeeds
- [ ] Disclaimer footer visible
- [ ] No investment language present
- [ ] Modal closes on success
- [ ] Error messages are clear
- [ ] Multisig address displayed correctly

---

## Production Testing

Before deploying to production:

1. **Test on Mainnet with Small Amounts**
   - Use test wallet with minimal funds
   - Send 0.1 TFUEL or 1 USDC
   - Verify transaction succeeds
   - Check webhook receives data

2. **Verify Environment Variables**
   - `VITE_MULTISIG_ADDRESS` is correct production address
   - `VITE_USDC_ADDRESS_MAINNET` is correct USDC contract
   - `VITE_CONTRIBUTION_WEBHOOK_URL` is active

3. **Check Webhook Integration**
   - Test webhook with sample data
   - Verify data appears in Airtable/Google Sheet
   - Confirm all fields are captured

4. **Security Review**
   - No sensitive data in console logs
   - Multisig address is verified
   - Disclaimer is present and accurate

5. **Performance Testing**
   - Modal opens quickly
   - Tier calculations are instant
   - No lag when typing amounts
   - Webhook doesn't block UI

---

## Support

For issues or questions:
- Check browser console for errors
- Review transaction on [Theta Explorer](https://explorer.thetatoken.org)
- Verify environment variables are set correctly
- Check webhook logs in Zapier dashboard

