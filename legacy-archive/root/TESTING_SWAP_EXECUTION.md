# Testing Real Swap Execution on xfuel.app

This guide covers how to test the real mainnet swap execution after removing mock mode.

## 🚀 Quick Start Testing

### Prerequisites

1. **Theta Wallet Extension** installed in browser
2. **Mainnet TFUEL** in your wallet (for real transactions)
3. **Router Contract** deployed at `0x6256D8A728aA102Aa06B6B239ba1247Bd835d816`

### Option 1: Local Development Testing

```bash
# Start local dev servers
npm run dev:local
# OR
start-local.bat  # Windows
```

Then open: `http://localhost:5173`

### Option 2: Production Testing

Test directly on `xfuel.app` with production router.

---

## 📋 Test Scenarios

### ✅ Test 1: Basic Swap Flow (Happy Path)

**Steps:**
1. Open the app (`http://localhost:5173` or `https://xfuel.app`)
2. Click "Connect Theta Wallet"
3. Approve wallet connection in Theta Wallet extension
4. Wait for balance to load (should show TFUEL balance)
5. Enter swap amount (e.g., `0.1` TFUEL) or use percentage button (25%, 50%, 100%)
6. Select LST target from dropdown (e.g., `stkTIA`, `stkATOM`, `stkXPRT`)
7. Click "Swap & Stake" button
8. Approve transaction in Theta Wallet popup
9. Wait for transaction confirmation (~2.8s on Theta)

**Expected Results:**
- ✅ Status message: `✅ Swap executed — [LST] — earning [APY]% APY`
- ✅ Cyberpunk-styled transaction hash box appears with:
  - Gradient background (cyan to purple)
  - "Transaction Hash" label with hover glow
  - Full transaction hash displayed
  - "View on Theta Explorer →" link
- ✅ Confetti animation triggers
- ✅ Balance updates after ~2 seconds
- ✅ Transaction appears in "Recent Swaps" history

**Verify:**
- Transaction hash is clickable and opens Theta Explorer
- Explorer shows successful transaction
- Transaction includes correct:
  - From: Your wallet address
  - To: `0x6256D8A728aA102Aa06B6B239ba1247Bd835d816`
  - Value: Your swap amount
  - Gas used: ~500,000 or less

---

### ✅ Test 2: Slippage Protection

**Steps:**
1. Connect wallet with sufficient balance
2. Enter a large amount (e.g., `10` TFUEL)
3. Set slippage tolerance to `0.5%` (default)
4. Click "Swap & Stake"
5. Approve transaction

**Expected Results:**
- Transaction succeeds if slippage is within tolerance
- If slippage too high, contract reverts with `SLIPPAGE_TOO_HIGH` error
- `minAmountOut` is calculated correctly: `(amount * 95% * (100% - slippage%))`

**Check Console:**
```javascript
📤 Sending transaction: {
  router: "0x6256...",
  amount: "10000000000000000000",  // 10 TFUEL in wei
  minAmountOut: "9450000000000000000",  // Should be ~9.45 TFUEL
  slippageTolerance: "0.5%"
}
```

---

### ✅ Test 3: Insufficient Balance

**Steps:**
1. Connect wallet with low balance (< 0.1 TFUEL)
2. Try to swap more than available balance
3. Click "Swap & Stake"

**Expected Results:**
- ❌ Error message: `Insufficient TFUEL balance. Get test TFUEL from faucet.`
- Transaction is not sent
- Balance check happens before transaction attempt

---

### ✅ Test 4: Transaction Rejection

**Steps:**
1. Connect wallet
2. Enter valid swap amount
3. Click "Swap & Stake"
4. **Reject** the transaction in Theta Wallet popup

**Expected Results:**
- ❌ Error message: `Transaction rejected by user`
- No transaction hash
- Status returns to idle after timeout

---

### ✅ Test 5: Gas Estimation & Execution

**Steps:**
1. Connect wallet
2. Enter swap amount
3. Click "Swap & Stake"
4. Monitor console logs

**Expected Results:**
- Gas limit set to `500000`
- Transaction confirms within ~2.8 seconds (Theta finality)
- Receipt shows `status: 1` (success)
- Fast polling fallback works if `tx.wait()` times out

**Check Console:**
```javascript
✅ Transaction sent: 0x...
⏳ Waiting for transaction confirmation (Theta ~2.8s finality)...
✅ Transaction confirmed: {
  hash: "0x...",
  blockNumber: 12345,
  status: 1
}
```

---

### ✅ Test 6: Multiple Swaps in Sequence

**Steps:**
1. Connect wallet
2. Make first swap (e.g., `0.1` TFUEL → `stkTIA`)
3. Wait for success
4. Immediately make second swap (e.g., `0.05` TFUEL → `stkATOM`)

**Expected Results:**
- Both transactions succeed
- Both appear in "Recent Swaps" history
- Balance updates correctly after each swap
- Nonce handling works correctly (no duplicate nonce errors)

---

### ✅ Test 7: Network Verification

**Steps:**
1. Open browser console
2. Connect wallet
3. Check network connection

**Expected Results:**
- Network should be Theta Mainnet (Chain ID: 361)
- RPC URL: `https://eth-rpc-api.thetatoken.org/rpc`
- Explorer URL: `https://explorer.thetatoken.org`

**Verify in Console:**
```javascript
// Check router address
console.log(ROUTER_ADDRESS)  // Should be: 0x6256D8A728aA102Aa06B6B239ba1247Bd835d816

// Verify contract exists
const provider = new ethers.BrowserProvider(window.theta)
const code = await provider.getCode(ROUTER_ADDRESS)
console.log(code !== '0x')  // Should be: true
```

---

### ✅ Test 8: Error Handling - Contract Not Found

**Steps:**
1. Temporarily set wrong router address in `.env`:
   ```bash
   VITE_ROUTER_ADDRESS=0x0000000000000000000000000000000000000000
   ```
2. Restart dev server
3. Try to swap

**Expected Results:**
- ❌ Error: `No contract found at router address 0x0000...`
- Transaction is not attempted
- Simulation fallback can be enabled via "Sim On" button

---

### ✅ Test 9: Simulation Mode Fallback (Optional)

**Steps:**
1. Connect wallet
2. Click "Sim On" button (top right, purple button)
3. Enter swap amount
4. Click "Swap & Stake"

**Expected Results:**
- ✅ Uses backend API simulation (`/api/swap`)
- ✅ Status message shows `(Simulated)`
- ✅ No real transaction on-chain
- ✅ Fake transaction hash generated

---

### ✅ Test 10: Transaction History

**Steps:**
1. Make several swaps (mix of real and simulated if enabled)
2. Check "Recent Swaps" section

**Expected Results:**
- Shows last 5 swaps
- Each entry shows:
  - Amount swapped
  - Target LST
  - Transaction hash (clickable)
  - Timestamp
  - "Simulated" badge if applicable

---

## 🔍 Manual Verification Checklist

### Before Testing
- [ ] Theta Wallet extension installed and unlocked
- [ ] Wallet has sufficient TFUEL balance (> 0.1 TFUEL)
- [ ] Network is Theta Mainnet (not testnet)
- [ ] Router address is correct: `0x6256D8A728aA102Aa06B6B239ba1247Bd835d816`
- [ ] No mock mode references in code (verify in console)

### During Swap
- [ ] Wallet popup appears when clicking "Swap & Stake"
- [ ] Transaction details shown correctly:
  - To: Router address
  - Value: Swap amount
  - Gas: ~500,000
- [ ] Transaction confirms quickly (~2-3 seconds)

### After Swap
- [ ] Success message appears
- [ ] Transaction hash box with cyberpunk styling visible
- [ ] Explorer link works
- [ ] Balance updates (check after 2 seconds)
- [ ] Transaction appears in history
- [ ] Confetti animation plays

### Console Verification
- [ ] No mock mode warnings
- [ ] Router address logged: `0x6256...`
- [ ] `minAmountOut` calculated correctly
- [ ] Transaction hash logged
- [ ] Receipt status: `1` (success)

### Explorer Verification
- [ ] Transaction hash opens Theta Explorer
- [ ] Transaction shows as "Success"
- [ ] Correct `from` address (your wallet)
- [ ] Correct `to` address (router)
- [ ] Correct `value` (swap amount)
- [ ] Gas used is reasonable

---

## 🐛 Troubleshooting

### Issue: "No router address configured"
**Solution:** 
- Check `.env` file has `VITE_ROUTER_ADDRESS=0x6256D8A728aA102Aa06B6B239ba1247Bd835d816`
- Or verify default in `src/config/thetaConfig.ts`
- Restart dev server after changing `.env`

### Issue: "Transaction rejected by user"
**Solution:**
- This is expected if you reject in wallet popup
- Just try again and approve the transaction

### Issue: "Insufficient TFUEL balance"
**Solution:**
- Add more TFUEL to your wallet
- On testnet: Use faucet at `https://faucet.testnet.theta.org/request`
- On mainnet: Purchase TFUEL or receive from another wallet

### Issue: "Transaction confirmation timeout"
**Solution:**
- Check Theta network status
- Verify RPC endpoint is accessible
- Fast polling fallback should catch it (~5 seconds max)

### Issue: "No contract found at router address"
**Solution:**
- Verify router is deployed at that address
- Check Theta Explorer: `https://explorer.thetatoken.org/address/0x6256D8A728aA102Aa06B6B239ba1247Bd835d816`
- Ensure you're on mainnet (not testnet)

### Issue: Swap succeeds but no success UI
**Solution:**
- Check browser console for errors
- Verify transaction hash is set: `setTxHash(tx.hash)`
- Check `swapStatus === 'success'` condition in render

---

## 🔬 Automated Testing

### Run Unit Tests
```bash
npm test
```

### Run Contract Tests
```bash
npm run test:contracts
```

### Run E2E Tests (Cypress)
```bash
# Interactive
npm run test:e2e

# Headless
npm run test:e2e:headless
```

**Note:** E2E tests currently mock wallet, update `cypress/e2e/swap.cy.ts` for real wallet testing.

---

## 📊 Success Metrics

A successful test should show:
- ✅ Zero mock mode references in code/logs
- ✅ Real transactions on Theta Mainnet
- ✅ Transaction hashes are valid and confirmable
- ✅ Explorer links work correctly
- ✅ Cyberpunk-styled success UI renders
- ✅ Balance updates after transactions
- ✅ Error handling works for edge cases

---

## 🔗 Useful Links

- **Theta Explorer:** https://explorer.thetatoken.org
- **Router Address:** https://explorer.thetatoken.org/address/0x6256D8A728aA102Aa06B6B239ba1247Bd835d816
- **Theta RPC:** https://eth-rpc-api.thetatoken.org/rpc
- **Theta Wallet:** https://thetawallet.io/

---

## 💡 Pro Tips

1. **Start Small:** Test with `0.01` TFUEL first before larger amounts
2. **Check Explorer First:** Before testing, verify router contract exists on explorer
3. **Monitor Console:** Keep browser console open to see all logs
4. **Testnet First:** Consider testing on testnet first (change `VITE_NETWORK=testnet`)
5. **Gas Optimization:** Monitor gas usage - should be < 500k gas per swap

---

## ✅ Final Verification

After completing all tests, verify:

```bash
# 1. No mock references
grep -r "MOCK_ROUTER\|mockMode\|MOCK_MODE" src/ --exclude-dir=node_modules

# 2. Router address is correct
grep "0x6256D8A728aA102Aa06B6B239ba1247Bd835d816" src/config/thetaConfig.ts

# 3. Build succeeds
npm run build

# 4. All tests pass
npm test
```

**Expected:** Only references in comments or test files, build succeeds, tests pass.

---

**Ready to test?** Start with Test 1 (Basic Swap Flow) and work through the scenarios systematically! 🚀

