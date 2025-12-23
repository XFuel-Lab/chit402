# Keplr Cosmos LST Staking - Manual Validation Checklist

## Prerequisites
- [ ] Keplr wallet extension installed in browser
- [ ] Test account with some STRD (for fees) and stkATOM/stkTIA tokens on Stride chain
- [ ] Development server running (`npm run dev`)

## Step 1: Install Dependencies
```bash
npm install
```
Verify `@cosmjs/stargate` and `@keplr-wallet/types` are installed.

## Step 2: Test Keplr Connection

### 2.1 Check Keplr Detection
1. Open browser console (F12)
2. Navigate to the app
3. Click "Connect Keplr" button
4. **Expected**: 
   - If Keplr not installed: Alert to install Keplr
   - If Keplr installed: Keplr popup appears asking to connect

### 2.2 Connect Wallet
1. Approve connection in Keplr popup
2. **Expected**:
   - Keplr wallet card appears showing:
     - Truncated address (first 12 chars...last 8 chars)
     - stkATOM balance
     - stkTIA balance
     - "Stake LST" button

### 2.3 Verify Chain Addition
- Check Keplr extension: Stride chain should be added automatically
- Check browser console for any errors during chain suggestion

## Step 3: Test Balance Fetching

### 3.1 Check Balance Display
1. After connecting, verify balances are displayed
2. **Expected**: 
   - Balances show correct amounts (or 0 if none)
   - Balances refresh every 15 seconds (check console logs)

### 3.2 Test Balance Refresh
1. Open browser console
2. Wait 15 seconds after connection
3. **Expected**: Balance refresh logs in console (or silent if no errors)

## Step 4: Test Staking Modal

### 4.1 Open Modal
1. Click "Stake LST" button
2. **Expected**: 
   - Modal opens with cyberpunk neon styling
   - Shows stkATOM and stkTIA selection buttons
   - Close button (X) in top right

### 4.2 Select LST Token
1. Click on stkATOM or stkTIA
2. **Expected**:
   - Selected token is highlighted (purple border/glow)
   - Amount input field appears
   - Available balance shown

### 4.3 Enter Amount
1. Type an amount (e.g., "1.5")
2. Click "MAX" button
3. **Expected**:
   - Amount fills with available balance
   - MAX button works correctly

### 4.4 Validation
1. Try invalid amounts:
   - Negative numbers (should be rejected)
   - Amount > available balance (should show error)
   - Empty amount (Stake button disabled)
2. **Expected**: Proper validation and error messages

## Step 5: Test Transaction Signing

### 5.1 Confirm Transaction
1. Select LST token
2. Enter valid amount (less than available balance)
3. Click "Stake" button
4. **Expected**: 
   - Confirmation screen shows:
     - Amount and token
     - Network (Stride)
     - "Back" and "Confirm & Sign" buttons

### 5.2 Sign Transaction
1. Click "Confirm & Sign"
2. **Expected**:
   - Modal shows "Signing transaction..." with spinner
   - Keplr popup appears asking to approve transaction
   - Transaction details visible in Keplr:
     - Message type: `/cosmos.staking.v1beta1.MsgDelegate`
     - Amount and denom
     - Gas fee
     - Memo: "Stake X stkATOM/stkTIA via XFUEL"

### 5.3 Approve in Keplr
1. Review transaction in Keplr
2. Approve transaction
3. **Expected**:
   - Keplr processes transaction
   - Modal shows success screen with:
     - Green checkmark
     - "Staking Successful!" message
     - Transaction hash displayed
     - Amount received message

### 5.4 Verify Transaction
1. Copy transaction hash
2. Check on Stride explorer: https://www.mintscan.io/stride/txs/{txHash}
3. **Expected**: 
   - Transaction visible on chain
   - Status: Success
   - Shows delegate message

## Step 6: Test Error Handling

### 6.1 Insufficient Balance
1. Try to stake more than available balance
2. **Expected**: Error message "Insufficient balance"

### 6.2 Insufficient Fees
1. If account has no STRD for fees
2. **Expected**: Error about insufficient funds for fees

### 6.3 User Rejection
1. Start transaction
2. Reject in Keplr popup
3. **Expected**: 
   - Error message about user rejection
   - Modal returns to select screen

### 6.4 Network Errors
1. Disconnect internet (or use invalid RPC)
2. Try to connect/stake
3. **Expected**: Appropriate error messages

## Step 7: Test Balance Updates

### 7.1 After Successful Stake
1. Complete a successful stake transaction
2. Wait 2 seconds
3. **Expected**: 
   - Balances refresh automatically
   - Updated balances reflect the staked amount (if delegating reduces available balance)

## Step 8: Console Validation

### 8.1 Check for Errors
1. Open browser console
2. Perform all operations above
3. **Expected**: 
   - No unhandled errors
   - Only expected logs (connection, balance refresh, etc.)

### 8.2 Check Network Requests
1. Open Network tab in DevTools
2. Perform operations
3. **Expected**:
   - RPC calls to Stride chain
   - REST API calls for balances
   - No failed requests (except expected ones)

## Known Issues to Watch For

1. **Validator Address**: Current validator addresses are placeholders. In production, fetch real validators or let users select.

2. **RPC Endpoints**: Current RPC endpoints may need to be updated for production/mainnet.

3. **Gas Estimation**: Fixed at 200,000 gas. May need adjustment based on actual chain requirements.

4. **Chain Info**: Verify chain IDs and RPC endpoints match current Stride/Cosmos Hub mainnet.

## Quick Test Script

Run in browser console after connecting Keplr:

```javascript
// Test Keplr connection
window.keplr ? console.log('✅ Keplr detected') : console.log('❌ Keplr not found');

// Test chain info
import { STRIDE_CHAIN_INFO } from './src/utils/keplr';
console.log('Stride Chain:', STRIDE_CHAIN_INFO);
```

## Success Criteria

✅ All UI elements render correctly
✅ Keplr connection works
✅ Balances fetch and display correctly
✅ Staking modal opens and functions
✅ Transaction signing works
✅ Success/error states display correctly
✅ No console errors
✅ Transaction appears on chain explorer

