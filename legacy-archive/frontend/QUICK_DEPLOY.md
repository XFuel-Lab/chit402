# Quick Production Deployment - Early Believers Modal

## 🚀 Fast Track Deployment

### 1. Verify Environment Variables

Make sure these are set in your production environment (Vercel, Netlify, etc.):

```bash
VITE_MULTISIG_ADDRESS=0x9D6fC5EEa264182783Da01Bcfc135E52bE7bF257
VITE_USDC_ADDRESS_MAINNET=0x9D6fC5EEa264182783Da01Bcfc135E52bE7bF257
VITE_CONTRIBUTION_WEBHOOK_URL=https://hooks.zapier.com/hooks/catch/25764894/uakt9ir/
```

### 2. Build & Deploy

**Option A: Vercel (Recommended)**
```bash
# If using Vercel CLI
vercel --prod

# Or just push to main (if auto-deploy enabled)
git push origin main
```

**Option B: Manual Build**
```bash
# Build
npm run build

# Test locally
npm run preview

# Deploy dist/ folder to your hosting
```

### 3. Post-Deployment Test

1. Visit your production site
2. Click "Contribute Now" on Early Believers card
3. Connect wallet (should be on Theta Mainnet)
4. Test with small amount (0.1 TFUEL)
5. Verify:
   - ✅ Transaction succeeds
   - ✅ Success screen appears
   - ✅ Webhook receives data
   - ✅ Transaction visible on explorer

## ✅ Build Status

**Last Build:** ✅ Successful
- Build completed in 11.12s
- Output: `dist/` folder ready
- Bundle size: ~590 KB (gzipped: ~183 KB)

## 📋 Pre-Deployment Checklist

- [x] Code tested and working
- [x] Build succeeds
- [ ] Environment variables set in production
- [ ] Multisig address verified
- [ ] Webhook URL active
- [ ] Ready to deploy

## 🔗 Important Links

- **Explorer:** https://explorer.thetatoken.org
- **Multisig:** `0x9D6fC5EEa264182783Da01Bcfc135E52bE7bF257`
- **Full Guide:** `PRODUCTION_DEPLOYMENT_EARLY_BELIEVERS.md`

---

**Ready to deploy!** 🎉

