# Quick Validation Guide - Keplr LST Staking

## Quick Start

1. **Install dependencies** (if not already done):
   ```bash
   npm install
   ```

2. **Start dev server**:
   ```bash
   npm run dev
   ```

3. **Open browser** with Keplr extension installed

## Quick Test Flow

### 1. Connect Keplr (30 seconds)
- Open app in browser
- Click "Connect Keplr" button
- Approve in Keplr popup
- ✅ Should see: Keplr wallet card with address and balances

### 2. Test Staking Modal (1 minute)
- Click "Stake LST" button
- ✅ Should see: Modal opens with stkATOM/stkTIA options
- Select a token
- ✅ Should see: Amount input appears with available balance
- Enter amount (or click MAX)
- Click "Stake"
- ✅ Should see: Confirmation screen

### 3. Test Transaction (2 minutes)
- Click "Confirm & Sign"
- ✅ Should see: "Signing transaction..." spinner
- ✅ Should see: Keplr popup with transaction details
- Review transaction in Keplr:
  - Message: `/cosmos.staking.v1beta1.MsgDelegate`
  - Amount: Your entered amount
  - Fee: Calculated gas fee
  - Memo: "Stake X stkATOM/stkTIA via XFUEL"
- Approve in Keplr
- ✅ Should see: Success screen with transaction hash

### 4. Verify on Chain (1 minute)
- Copy transaction hash from success screen
- Visit: https://www.mintscan.io/stride/txs/{txHash}
- ✅ Should see: Transaction on chain with success status

## Common Issues & Fixes

### Issue: "Keplr not installed"
**Fix**: Install Keplr extension from https://www.keplr.app/

### Issue: "Failed to connect Keplr wallet"
**Check**:
- Browser console for errors
- Keplr extension is enabled
- Try refreshing page

### Issue: "Insufficient balance"
**Fix**: Ensure account has:
- stkATOM or stkTIA tokens to stake
- STRD tokens for gas fees

### Issue: "Transaction failed"
**Check**:
- Browser console for error details
- Keplr popup for specific error
- Account has enough STRD for fees
- Validator address is valid (may need to update in code)

### Issue: Balances not showing
**Check**:
- Browser console for API errors
- RPC endpoint is accessible
- Account actually has tokens

## Browser Console Checks

Open DevTools (F12) and check:

1. **No errors on page load**
2. **After connecting Keplr**:
   ```javascript
   // Should see connection logs
   ```

3. **After clicking Stake LST**:
   ```javascript
   // Should see modal opening
   ```

4. **During transaction**:
   ```javascript
   // Should see: "Signing transaction..."
   // Then Keplr popup appears
   ```

5. **After transaction**:
   ```javascript
   // Should see success or error message
   // Check Network tab for RPC calls
   ```

## Expected Console Output

**Good flow** (no errors):
```
✅ Keplr connection successful
✅ Balance fetched: stkATOM: X, stkTIA: Y
✅ Transaction signed
✅ Transaction hash: ABC123...
```

**Error flow** (check these):
```
❌ Keplr connection error: [error message]
❌ Balance fetch error: [error message]
❌ Staking transaction error: [error message]
```

## Quick Validation Checklist

- [ ] Keplr connects successfully
- [ ] Balances display correctly
- [ ] Staking modal opens
- [ ] Can select LST token
- [ ] Amount input works
- [ ] MAX button works
- [ ] Validation works (negative amounts rejected)
- [ ] Confirmation screen shows correct info
- [ ] Keplr popup appears for signing
- [ ] Transaction details correct in Keplr
- [ ] Transaction succeeds
- [ ] Success screen shows transaction hash
- [ ] Transaction visible on chain explorer
- [ ] Balances refresh after transaction

## Test with Small Amount First

**Recommended**: Test with a small amount first (e.g., 0.1 stkATOM) to verify everything works before staking larger amounts.

## Need Help?

Check:
1. Browser console for errors
2. Network tab for failed requests
3. Keplr extension logs
4. `VALIDATION_CHECKLIST.md` for detailed steps

