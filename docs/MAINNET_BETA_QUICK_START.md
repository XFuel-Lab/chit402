# 🚀 XFuel Mainnet Beta - Quick Start Guide

**Goal:** Deploy live mainnet testing in under 1 hour.

---

## Prerequisites ✅

- [x] Node.js 18+ installed
- [x] npm/yarn installed  
- [x] Theta Mainnet wallet with 100+ TFUEL
- [x] Vercel account (for web deployment)
- [x] EAS CLI installed: `npm install -g eas-cli`

---

## Step 1: Deploy Smart Contracts (15 min)

```bash
# 1. Set your private key
export THETA_MAINNET_PRIVATE_KEY="your_private_key_here"

# 2. Install dependencies
npm install

# 3. Compile contracts
npx hardhat compile

# 4. Deploy to Theta Mainnet
./scripts/deploy-mainnet.sh
# Follow prompts, type "yes" to confirm

# 5. Save contract addresses from output
# Example output:
#   RevenueSplitter: 0x1234...
#   BuybackBurner: 0x5678...
```

**Expected Gas Cost:** ~50 TFUEL

---

## Step 2: Deploy Web UI (10 min)

```bash
# 1. Update .env with contract addresses
cat > .env << EOF
VITE_ROUTER_ADDRESS=0x1234...  # From Step 1
VITE_NETWORK=mainnet
VITE_API_URL=https://api.xfuel.io
EOF

# 2. Test locally
npm run dev
# Visit http://localhost:5173
# Verify banner displays "Live Mainnet Testing"

# 3. Build for production
npm run build

# 4. Deploy to Vercel
vercel --prod
# Or push to main branch (auto-deploy on Vercel)
```

**Verification:**
- [ ] Banner displays on mainnet
- [ ] Banner dismisses on click
- [ ] Swap button shows "Swap Now"

---

## Step 3: Deploy Mobile UI (15 min)

```bash
# 1. Navigate to mobile directory
cd edgefarm-mobile

# 2. Install dependencies
npm install

# 3. Login to EAS
eas login

# 4. Build mainnet version
eas build --profile mainnet --platform all
# This takes 10-15 minutes

# 5. Publish update (faster alternative)
eas update --branch mainnet-beta
```

**Verification:**
- [ ] Banner displays with haptics
- [ ] Network shows as "mainnet"
- [ ] Swap limits displayed correctly

---

## Step 4: Test Live (10 min)

### Web Testing

```bash
# 1. Connect Theta Wallet
# Click "Connect Wallet" on web UI

# 2. Try invalid swap (should fail)
# Enter 1,500 TFUEL → Click Swap
# Expected: "❌ Swap amount exceeds maximum of 1,000 TFUEL"

# 3. Try valid swap (should work)
# Enter 10 TFUEL → Click Swap
# Expected: Transaction executes

# 4. Check Theta Explorer
# View transaction: https://explorer.thetatoken.org/tx/<hash>
```

### Mobile Testing

```bash
# 1. Open app via Expo Go or TestFlight
# Scan QR code from EAS build

# 2. Verify banner displays
# Should show warning with haptic feedback

# 3. Test swap limits
# Same as web testing above
```

### Verification Checklist

- [ ] Banner displays on mainnet only
- [ ] Swap rejected at 1,001 TFUEL
- [ ] Swap accepted at 999 TFUEL
- [ ] Transaction shows on Theta Explorer
- [ ] Remaining allowance displayed in console
- [ ] Emergency pause works (owner only)

---

## Step 5: Monitor (Ongoing)

### Theta Explorer

Monitor contract events:
```
https://explorer.thetatoken.org/account/<RevenueSplitter_address>
```

**Key Events:**
- `UserSwapRecorded` - Track user activity
- `RevenueSplit` - Monitor revenue distribution
- `PauseToggled` - Emergency actions

### Console Logs

Check browser/app console for:
```javascript
✅ [BETA] Swap limit check passed
💰 [BETA] Remaining allowance: 4,500.00 TFUEL
```

### Analytics

Track metrics:
- Total swaps: Check `totalRevenueCollected` on contract
- Unique users: Count distinct addresses in events
- Average swap: `totalRevenue / swapCount`

---

## 🛑 Emergency Procedures

### Pause Protocol (Immediate)

```bash
# 1. Connect owner wallet
# 2. Call setPaused(true) on RevenueSplitter
npx hardhat console --network theta-mainnet

# In console:
const RevenueSplitter = await ethers.getContractFactory("RevenueSplitter")
const contract = await RevenueSplitter.attach("0x...")
await contract.setPaused(true)
```

### Lower Limits (If needed)

```bash
# Lower to 500 TFUEL/swap, 2,000 TFUEL/user
await contract.updateSwapLimits(
  ethers.parseEther("500"),
  ethers.parseEther("2000")
)
```

---

## 📊 Success Metrics

### Day 1 Goals
- [ ] 10+ swaps executed
- [ ] 0 critical bugs
- [ ] Emergency pause tested

### Week 1 Goals
- [ ] 100+ swaps executed
- [ ] $500+ revenue collected
- [ ] User feedback collected

### Month 1 Goals
- [ ] 1,000+ swaps executed
- [ ] $10,000+ revenue collected
- [ ] Audit funding secured

---

## 🐛 Troubleshooting

### Contract Deployment Failed
```bash
# Check balance
npx hardhat console --network theta-mainnet
> await ethers.provider.getBalance("your_address")

# Increase gas price if needed
# Edit hardhat.config.cjs:
gasPrice: 4000000000000  // 4000 Gwei minimum
```

### Banner Not Showing
```bash
# Check network config
console.log(APP_CONFIG.NETWORK)  // Should be "mainnet"

# Check .env file
cat .env | grep VITE_NETWORK  // Should be "mainnet"
```

### Swap Rejected
```bash
# Check user's total
localStorage.getItem('xfuel_user_swap_total')

# Reset if needed (owner only)
await contract.resetUserSwapTotal("0x...")
```

### Mobile Build Failed
```bash
# Check EAS credentials
eas whoami

# Rebuild from scratch
eas build --clear-cache --profile mainnet --platform all
```

---

## 📞 Get Help

**Emergency:** security@xfuel.io  
**Discord:** #mainnet-beta  
**GitHub:** https://github.com/XFuel-Lab/xfuel-protocol/issues

---

## ✅ Deployment Complete!

Your mainnet beta is now live. Next steps:

1. **Announce** on Discord/Twitter
2. **Monitor** closely for 24-48 hours
3. **Collect** user feedback
4. **Iterate** on UX/limits
5. **Fund** security audit with revenue

---

**Estimated Total Time:** 50 minutes  
**Gas Cost:** ~50 TFUEL  
**Ready to Launch:** YES ✅

---

Last Updated: December 26, 2025

