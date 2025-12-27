# WalletConnect / Reown Domain Verification Test

## Test 1: Create a BRAND NEW Project ID

### Why?
Your current Project ID (`d132d658c164146b2546d5cd1ede0595`) might have:
- Cached failed verification attempts
- Rate limiting from previous testing
- Incorrect initial configuration

### Steps:

1. **Go to:** https://cloud.reown.com
2. **Click:** "Create New Project"
3. **Name:** "xfuel-test-2" (or anything)
4. **Copy the NEW Project ID** (will be different)

5. **Add domains to NEW project:**
   ```
   http://localhost:3000
   http://localhost:5173
   ```
   
6. **Save and wait 30 seconds** for propagation

7. **Update your .env.local:**
   ```powershell
   Set-Content -Path .env.local -Value "VITE_WALLETCONNECT_PROJECT_ID=YOUR_NEW_PROJECT_ID_HERE"
   ```

8. **Restart server:**
   ```powershell
   Get-Process node -ErrorAction SilentlyContinue | Stop-Process -Force
   npm run dev
   ```

9. **Test immediately:**
   - Open Theta Wallet app
   - Force close app completely
   - Clear app cache (Settings → Apps → Theta Wallet → Clear Cache)
   - Reopen app
   - Try scanning QR code
   - **Check if Connect button is enabled** ✅

---

## Test 2: Check Current Project Verification Status

### In Reown Dashboard:

Look for these sections and report back what you see:

#### A) Domain Status
```
Domains Tab:
- http://localhost:3000 → Status: ___________
- http://localhost:5173 → Status: ___________
- https://xfuel.app → Status: ___________
```

#### B) Project Health
```
Dashboard Overview:
- Monthly Requests: _______ / 1,000,000
- Status: [ ] Active [ ] Rate Limited [ ] Suspended
```

#### C) Authentication Settings
```
If there's an "Authentication" or "Verify" tab:
- Authentication Method: ___________
- Verification Status: ___________
```

---

## Test 3: Browser Console Diagnosis

### When you open the QR modal, check browser console (F12) for:

**Look for these specific errors:**

```javascript
// Good signs (working):
✅ "🔌 WalletConnect v2: Initializing..."
✅ "Project ID: d132d658... ✅"
✅ "📱 WalletConnect URI received"
✅ Status 202 from pulse.walletconnect.org

// Bad signs (verification issues):
❌ "Domain verification failed"
❌ "Project not found"
❌ "Invalid project ID"
❌ Status 403 from pulse.walletconnect.org
❌ "CORS error" from walletconnect.org
```

**Copy any WalletConnect-related errors here:**
```
[Paste errors]
```

---

## Test 4: Mobile Wallet Logs

### In Theta Wallet App:

Some wallet apps show connection logs:

1. **Open Theta Wallet**
2. **Go to Settings** (if available)
3. **Look for:**
   - "Developer Mode" or "Debug Logs"
   - "Connection History"
   - "WalletConnect Sessions"

4. **Try connecting and check logs for:**
   ```
   "Domain verification failed"
   "Project ID not verified"
   "Connection rejected by wallet"
   ```

---

## Expected Results

### If Free Tier is Sufficient (it should be):
- ✅ New Project ID works immediately for localhost
- ✅ Connect button enables in Theta Wallet
- ✅ No verification needed for localhost domains

### If There's a Verification Issue:
- ⚠️ Even new Project ID has disabled Connect button
- ⚠️ Console shows domain errors
- ⚠️ Production domain needs DNS verification

### If You Need Paid Plan (unlikely):
- ❌ Dashboard shows "Rate Limit Exceeded"
- ❌ Console shows 429 errors from Reown
- ❌ "Upgrade Required" message in dashboard

---

## Quick Checklist

Before assuming you need paid:

- [ ] Created a fresh Project ID (not using old one)
- [ ] Added `http://localhost:3000` to Allowed Origins
- [ ] Waited 60 seconds after adding domain
- [ ] Force-closed and cleared Theta Wallet app cache
- [ ] Restarted dev server with new Project ID
- [ ] Tested on actual mobile device (not emulator)
- [ ] Checked browser console for specific errors
- [ ] Verified dashboard shows "Active" status

If ALL of these are checked and Connect button is still disabled:
- Check for console errors from WalletConnect Cloud
- Screenshot your Reown dashboard Domain settings
- Share any mobile wallet error messages

---

## Next Steps

Run **Test 1** first (create new Project ID). This is the fastest way to rule out:
- Cached verification issues
- Rate limiting on old Project ID
- Configuration errors

Report back:
1. New Project ID (first 8 chars only for security)
2. Domain status in dashboard
3. Any console errors
4. Does Connect button work with fresh ID?

