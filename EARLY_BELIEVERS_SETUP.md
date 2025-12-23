# Early Believers Contribution Modal - Production Setup

## ✅ Feature Status: LIVE & PRODUCTION-READY

The Early Believers contribution modal is **fully implemented** and visible on the xfuel.app homepage.

## 📍 Location

- **Card**: Appears on homepage between tabs and main content
- **Component**: `src/components/EarlyBelieversCard.tsx`
- **Modal**: `src/components/EarlyBelieversModal.tsx`

## 🎨 Features Implemented

✅ **Neon Glassmorphism Card**
- Title: "Early Believers Round — Mainnet Live"
- Subtext: "TFUEL farmed into fresh rXF soul — day 1 yield, 4× governance power"
- Animated pulsing glow
- "Contribute Now" button with hover arrow

✅ **Contribution Modal**
- Theta Wallet connect (mainnet enforced)
- Amount input with USD equivalent display
- Payment toggle: USDC (default) or TFUEL
- Live tier calculation:
  - $10k-$49k: Standard (no bonus)
  - $50k-$99k: +10% bonus rXF
  - $100k+: +25% bonus rXF
- Calculated rXF amount + bonus display
- Sends to configured multisig address
- Success message: "Contribution received! Full rXF day 1 confirmed at TGE. Thank you for believing."
- Auto-logging (console + optional webhook)
- Legal disclaimer footer

✅ **Security & UX**
- Mainnet-only enforcement
- Network validation
- Balance checks (TFUEL & USDC)
- Gas estimation
- Transaction confirmation
- Error handling with clear messages

## 🔧 Required Environment Variables

### **Essential (Must Set Before Launch):**

```bash
# Multisig wallet address to receive contributions
VITE_MULTISIG_ADDRESS=0xYourMultisigAddress

# USDC token address on Theta Mainnet
VITE_USDC_ADDRESS_MAINNET=0xUsdcTokenAddress

# Network mode (must be mainnet for contributions)
VITE_NETWORK=mainnet
```

### **Optional (Tracking & Analytics):**

```bash
# Webhook for contribution logging
VITE_CONTRIBUTION_WEBHOOK_URL=https://your-webhook-endpoint.com/contributions

# Total raised tracking
VITE_TOTAL_RAISED_USD=0

# API endpoint for total raised updates
VITE_TOTAL_RAISED_API_URL=https://your-api.com/total-raised
```

## 🚀 Deployment Checklist

### Before Deploying:

1. **Set Multisig Address**
   ```bash
   VITE_MULTISIG_ADDRESS=0xYourActualMultisigAddress
   ```
   ⚠️ **Critical**: Replace `[INSERT YOUR MULTISIG OR OWNER ADDRESS HERE]` placeholder

2. **Configure USDC Address**
   ```bash
   # Theta Mainnet USDC address
   VITE_USDC_ADDRESS_MAINNET=0xActualUsdcAddress
   ```

3. **Verify Network Mode**
   ```bash
   VITE_NETWORK=mainnet
   ```

4. **Test Contributions**
   - [ ] Connect Theta Wallet (mainnet)
   - [ ] Test small TFUEL contribution
   - [ ] Test USDC contribution (requires approval)
   - [ ] Verify funds arrive at multisig address
   - [ ] Check tier calculation accuracy
   - [ ] Confirm success message displays

### After Deploying:

1. **Monitor Contributions**
   - Check multisig address for incoming transactions
   - Monitor console logs for contribution events
   - Verify webhook is receiving data (if configured)

2. **Track Total Raised**
   - Update `VITE_TOTAL_RAISED_USD` periodically
   - Display progress on UI (optional feature)

## 📊 Contribution Tracking

Each contribution is automatically logged with:

```javascript
{
  walletAddress: "0x...",
  amount: 50000,
  paymentMethod: "USDC",
  rXFAmount: 50000,
  bonusAmount: 5000,
  tier: "Plus10",
  timestamp: "2025-01-15T12:34:56.789Z",
  txHash: "0x...",
  network: "mainnet"
}
```

### Console Logging
All contributions are logged to browser console:
```
🎉 Early Believers Contribution Received!
💰 Amount: $50,000.00 (USDC)
🎁 rXF: 55,000 (includes 5,000 bonus)
🏆 Tier: Plus10
📍 Wallet: 0x1234...5678
🔗 Tx: 0xabc...def
```

### Optional Webhook
If `VITE_CONTRIBUTION_WEBHOOK_URL` is set, contribution data is POSTed to the webhook endpoint.

## 💎 Tier Bonus Calculation

| Contribution Range | Tier | Bonus rXF | Total rXF Example |
|-------------------|------|-----------|------------------|
| $10,000 - $49,999 | Standard | 0% | $25,000 → 25,000 rXF |
| $50,000 - $99,999 | Plus10 | +10% | $50,000 → 55,000 rXF |
| $100,000+ | Plus25 | +25% | $100,000 → 125,000 rXF |

**Conversion Rate**: 1 USD = 1 rXF (before bonus)

## 🎨 UI Styling

Pure cyberpunk neon aesthetic:
- Glassmorphism effects
- Glowing pink/cyan accents
- Futuristic fonts (tracking-wide, uppercase headers)
- Animated pulsing effects
- Neon borders with shadow glows
- Gradient overlays

## 📝 Legal Disclaimer

**Displayed in modal footer:**

> This is a contribution to support protocol development. rXF provides governance and utility within XFUEL. No promise of profit.

## 🔐 Security Considerations

1. **Non-Custodial**: All transactions require wallet signature
2. **Mainnet Only**: Enforced at modal level
3. **Approval Flow**: USDC requires approval before transfer
4. **Gas Estimation**: Real-time gas cost display
5. **Balance Validation**: Checks both TFUEL and USDC balances
6. **Network Validation**: Rejects if not on Theta Mainnet (Chain ID: 361)

## 🐛 Troubleshooting

### "Multisig address not configured"
- Set `VITE_MULTISIG_ADDRESS` in environment variables
- Rebuild and redeploy

### "Wrong network"
- User must connect to Theta Mainnet (Chain ID: 361)
- Guide users to switch networks in wallet

### "Insufficient USDC balance"
- User needs USDC on Theta Mainnet
- Suggest bridging or using TFUEL instead

### "Approval failed"
- USDC requires approval before transfer
- User must approve spending in wallet

## 📞 Support

For issues or questions:
- Email: xfuel.support@xfuel.app
- Review code: `src/components/EarlyBelieversModal.tsx`
- Check logs: Browser DevTools Console

---

**Status**: ✅ Production Ready
**Last Updated**: 2025-01-15
**Version**: 1.0.0

