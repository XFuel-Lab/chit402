# Early Believers Modal - Production Deployment Guide

## Pre-Deployment Checklist

### ✅ 1. Environment Variables Verification

Ensure these environment variables are set in your production environment:

```bash
# Required for Early Believers Modal
VITE_MULTISIG_ADDRESS=0x9D6fC5EEa264182783Da01Bcfc135E52bE7bF257
VITE_USDC_ADDRESS_MAINNET=0x9D6fC5EEa264182783Da01Bcfc135E52bE7bF257
VITE_CONTRIBUTION_WEBHOOK_URL=https://hooks.zapier.com/hooks/catch/25764894/uakt9ir/
```

**Verification Steps:**
- [ ] Verify multisig address is correct and has proper permissions
- [ ] Verify USDC address is the correct Theta Mainnet USDC contract
- [ ] Test webhook URL is active and receiving data
- [ ] Confirm all addresses are on Theta Mainnet (Chain ID: 361)

### ✅ 2. Code Verification

- [ ] All tests pass: `npm test`
- [ ] No linting errors: `npm run lint`
- [ ] Build succeeds without errors: `npm run build`
- [ ] Preview build works: `npm run preview`

### ✅ 3. Functionality Testing

**Network & Wallet:**
- [ ] Wallet connection works on Theta Mainnet
- [ ] Network switching works correctly
- [ ] Wrong network detection shows proper warning
- [ ] Network check only runs after wallet connects (no premature warnings)

**Transactions:**
- [ ] TFUEL transactions submit successfully
- [ ] USDC transactions work (if applicable)
- [ ] Transaction receipt handling works (including RPC error fallback)
- [ ] Success screen displays correctly
- [ ] Transaction hash links to explorer work

**Tier Calculations:**
- [ ] Standard tier (< $50k) displays correctly
- [ ] +10% bonus tier ($50k-$99k) calculates correctly
- [ ] +25% bonus tier ($100k+) calculates correctly
- [ ] TFUEL price fetching works
- [ ] USD conversion is accurate

**Error Handling:**
- [ ] Insufficient balance errors display correctly
- [ ] Transaction rejection handled gracefully
- [ ] RPC errors don't block successful transactions
- [ ] Network errors are clear and actionable

### ✅ 4. Security Review

- [ ] No sensitive data in console logs (production build drops console)
- [ ] Multisig address is verified and correct
- [ ] No hardcoded private keys or secrets
- [ ] Disclaimer is present and accurate
- [ ] No investment language (compliance check)

### ✅ 5. Performance

- [ ] Modal opens quickly (< 500ms)
- [ ] Tier calculations are instant
- [ ] No lag when typing amounts
- [ ] Webhook doesn't block UI
- [ ] Build size is optimized

## Deployment Steps

### Option 1: Vercel Deployment

1. **Set Environment Variables in Vercel:**
   ```bash
   # In Vercel Dashboard → Settings → Environment Variables
   VITE_MULTISIG_ADDRESS=0x9D6fC5EEa264182783Da01Bcfc135E52bE7bF257
   VITE_USDC_ADDRESS_MAINNET=0x9D6fC5EEa264182783Da01Bcfc135E52bE7bF257
   VITE_CONTRIBUTION_WEBHOOK_URL=https://hooks.zapier.com/hooks/catch/25764894/uakt9ir/
   ```

2. **Deploy:**
   ```bash
   # If using Vercel CLI
   vercel --prod
   
   # Or push to main branch (if auto-deploy is enabled)
   git push origin main
   ```

### Option 2: Manual Build & Deploy

1. **Build for Production:**
   ```bash
   npm run build
   ```
   This creates an optimized build in the `dist/` directory.

2. **Test the Build Locally:**
   ```bash
   npm run preview
   ```
   Visit `http://localhost:3000` and test the modal.

3. **Deploy `dist/` folder:**
   - Upload `dist/` contents to your hosting provider
   - Ensure environment variables are set in your hosting platform
   - Configure your server to serve `index.html` for all routes (SPA routing)

### Option 3: Docker Deployment

1. **Create Dockerfile (if not exists):**
   ```dockerfile
   FROM node:20-alpine AS builder
   WORKDIR /app
   COPY package*.json ./
   RUN npm ci
   COPY . .
   RUN npm run build

   FROM nginx:alpine
   COPY --from=builder /app/dist /usr/share/nginx/html
   COPY nginx.conf /etc/nginx/conf.d/default.conf
   EXPOSE 80
   CMD ["nginx", "-g", "daemon off;"]
   ```

2. **Build and Deploy:**
   ```bash
   docker build -t xfuel-protocol .
   docker run -p 80:80 -e VITE_MULTISIG_ADDRESS=... xfuel-protocol
   ```

## Post-Deployment Verification

### Immediate Checks (Within 5 minutes)

1. **Smoke Test:**
   - [ ] Site loads correctly
   - [ ] Early Believers card is visible
   - [ ] Modal opens when clicking "Contribute Now"
   - [ ] No console errors in browser DevTools

2. **Wallet Connection:**
   - [ ] Connect wallet button works
   - [ ] Wallet connects successfully
   - [ ] Network check works correctly
   - [ ] Balances display correctly

3. **Transaction Test (Small Amount):**
   - [ ] Submit a small test transaction (0.1 TFUEL)
   - [ ] Transaction succeeds
   - [ ] Success screen appears
   - [ ] Webhook receives data (check Zapier logs)
   - [ ] Transaction appears on Theta Explorer

### Extended Testing (Within 24 hours)

1. **Monitor:**
   - [ ] Check webhook logs for all contributions
   - [ ] Verify transactions on Theta Explorer
   - [ ] Check for any error reports
   - [ ] Monitor multisig address for incoming funds

2. **Edge Cases:**
   - [ ] Test with different wallet providers
   - [ ] Test network switching during transaction
   - [ ] Test with slow network connections
   - [ ] Test with very large amounts

## Rollback Plan

If issues are discovered:

1. **Quick Rollback:**
   ```bash
   # Revert to previous deployment
   git revert HEAD
   git push origin main
   # Or redeploy previous build
   ```

2. **Disable Modal (if needed):**
   - Comment out EarlyBelieversCard in App.tsx
   - Redeploy immediately

3. **Emergency Contacts:**
   - Development team
   - Multisig signers (if funds need to be moved)

## Monitoring & Alerts

### Key Metrics to Monitor:

1. **Transaction Success Rate:**
   - Track successful vs failed transactions
   - Monitor RPC error rates

2. **Webhook Delivery:**
   - Ensure webhook is receiving all contributions
   - Set up alerts for webhook failures

3. **User Errors:**
   - Monitor console errors
   - Track user-reported issues

4. **Funds Received:**
   - Monitor multisig address balance
   - Verify all transactions are received

## Support & Documentation

- **Test Guide:** `docs/EARLY_BELIEVERS_MODAL_TEST.md`
- **Explorer:** https://explorer.thetatoken.org
- **Webhook Dashboard:** Check Zapier dashboard for logs

## Production URLs

- **Main Site:** [Your production URL]
- **Explorer:** https://explorer.thetatoken.org
- **Multisig Address:** `0x9D6fC5EEa264182783Da01Bcfc135E52bE7bF257`

---

## Quick Deploy Command

```bash
# 1. Verify environment variables
echo $VITE_MULTISIG_ADDRESS
echo $VITE_USDC_ADDRESS_MAINNET
echo $VITE_CONTRIBUTION_WEBHOOK_URL

# 2. Run tests
npm test

# 3. Build
npm run build

# 4. Preview (optional)
npm run preview

# 5. Deploy (example for Vercel)
vercel --prod
```

---

**Last Updated:** [Current Date]
**Deployed By:** [Your Name]
**Version:** 1.0.0

