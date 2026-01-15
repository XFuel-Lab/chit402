# 🚨 XFuel Protocol - Mainnet Beta Testing Guide

## ⚠️ CRITICAL: Live Testing with Safety Guardrails

XFuel Protocol is now live on **Theta Mainnet** in **BETA TESTING MODE**. This is a functional rail for funding security audits, not a fully audited production system.

### 🛡️ Safety Limits (Hardcoded)

| Limit Type | Amount | Enforcement |
|------------|--------|-------------|
| **Max Per Swap** | 1,000 TFUEL | Smart contract + UI |
| **Total Per User** | 5,000 TFUEL | Smart contract + UI + Local tracking |
| **Approval Type** | Exact amount | No unlimited approvals |

### 🚫 Risk Warnings

```
⚠️  SWAP AT YOUR OWN RISK ⚠️

- Contracts are UNAUDITED
- Bugs may result in loss of funds
- No insurance or recovery mechanism
- Beta testing only - not production ready
```

---

## 🎯 Purpose

Generate real-world transaction volume and revenue to fund:
1. **Smart Contract Audits** (Certik, OpenZeppelin, etc.)
2. **Security Bounties** (ImmuneFi, HackerOne)
3. **Penetration Testing**

---

## 🏗️ Architecture

### Smart Contracts (Solidity)

**Updated Contracts:**
- `contracts/RevenueSplitter.sol` - Revenue distribution with limits
- `contracts/BuybackBurner.sol` - Buyback mechanism with limits

**New Features:**
```solidity
// Per-swap limit
uint256 public maxSwapAmount = 1000 * 1e18;  // 1,000 TFUEL

// Total user limit
uint256 public totalUserLimit = 5000 * 1e18;  // 5,000 TFUEL
mapping(address => uint256) public userTotalSwapped;

// Emergency controls
bool public paused;  // Kill switch

// Admin functions
function updateSwapLimits(uint256 _max, uint256 _total) external onlyOwner
function setPaused(bool _paused) external onlyOwner
function resetUserSwapTotal(address user) external onlyOwner
```

**Events for Monitoring:**
```solidity
event UserSwapRecorded(address indexed user, uint256 amount, uint256 totalSwapped);
event SwapLimitUpdated(uint256 maxSwapAmount, uint256 totalUserLimit);
event PauseToggled(bool paused);
```

### Web UI (React + Vite)

**New Components:**
- `src/components/BetaBanner.tsx` - Persistent warning banner
- `src/utils/swapLimits.ts` - Client-side limit enforcement

**Banner Display:**
```tsx
// Fixed top banner on mainnet only
<BetaBanner network={APP_CONFIG.NETWORK} />
```

**Limit Enforcement:**
```typescript
// Validate before swap
const validation = validateSwapLimits(userAddress, amount)
if (!validation.valid) {
  showError(validation.error)
  return
}

// Update after successful swap
updateUserSwapTotal(userAddress, amount)
```

### Mobile UI (Expo + React Native)

**New Components:**
- `edgefarm-mobile/src/components/BetaBanner.tsx` - Mobile banner with haptics
- `edgefarm-mobile/src/lib/swapLimits.ts` - AsyncStorage tracking

**Haptic Feedback:**
```typescript
// Warning haptic on banner load
Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning)
```

---

## 🚀 Deployment

### 1. Deploy Contracts to Mainnet

```bash
# Set environment variable
export THETA_MAINNET_PRIVATE_KEY="your_private_key"

# Run deployment script
./scripts/deploy-mainnet.sh
```

**What it deploys:**
- RevenueSplitter (with limits)
- BuybackBurner (with limits)
- veXF, rXF, mock tokens

**Post-deployment:**
```bash
# Save contract addresses
export VITE_ROUTER_ADDRESS="0x..."
export VITE_NETWORK="mainnet"
```

### 2. Deploy Web UI

Update `.env` (or Vercel environment variables):
```env
VITE_ROUTER_ADDRESS=0x1234...  # From deployment
VITE_NETWORK=mainnet
VITE_API_URL=https://api.xfuel.io  # Backend API
```

Deploy to Vercel:
```bash
vercel --prod
```

### 3. Deploy Mobile App

Build mainnet version:
```bash
cd edgefarm-mobile

# iOS
eas build --profile mainnet --platform ios

# Android
eas build --profile mainnet --platform android
```

**EAS Configuration (`eas.json`):**
```json
{
  "build": {
    "mainnet": {
      "env": {
        "EXPO_PUBLIC_NETWORK": "mainnet"
      },
      "channel": "mainnet-beta"
    }
  }
}
```

---

## 🧪 Testing

### E2E Tests (Cypress)

```bash
# Run mainnet beta tests
npm run cypress:open

# Specific test file
npx cypress run --spec "cypress/e2e/mainnet-beta.cy.ts"
```

**Test Coverage:**
- ✅ Beta banner display/dismiss
- ✅ Per-swap limit (1,000 TFUEL)
- ✅ Total user limit (5,000 TFUEL)
- ✅ Emergency pause enforcement
- ✅ No unlimited approvals

### Manual Testing Checklist

- [ ] Banner displays on mainnet only
- [ ] Banner dismisses correctly
- [ ] Swap rejected at 1,001 TFUEL
- [ ] Swap accepted at 999 TFUEL
- [ ] Total limit enforced after multiple swaps
- [ ] Remaining allowance displayed
- [ ] Transaction logs to Theta Explorer
- [ ] Emergency pause stops swaps

---

## 📊 Monitoring

### Contract Events

Monitor on Theta Explorer:
```
https://explorer.thetatoken.org/account/<contract_address>
```

**Key Events:**
```solidity
UserSwapRecorded(user, amount, totalSwapped)  // Track user activity
RevenueSplit(veXF, buyback, rXF, treasury)    // Monitor revenue
PauseToggled(paused)                           // Emergency actions
```

### Analytics Dashboard

Track metrics:
- Total swaps executed
- Revenue collected
- Users by limit tier (0-1K, 1K-5K)
- Average swap size
- Gas costs

### Logs

Enable verbose logging:
```typescript
console.log('✅ [BETA] Swap limit check passed')
console.log('💰 [BETA] Remaining allowance:', remaining.toFixed(2))
```

---

## 🛑 Emergency Procedures

### Pause Protocol (Kill Switch)

**From Owner Wallet:**
```typescript
// Connect to RevenueSplitter
const contract = new ethers.Contract(REVENUE_SPLITTER_ADDRESS, ABI, signer)

// Pause immediately
await contract.setPaused(true)

// Verify
const isPaused = await contract.paused()
console.log('Protocol paused:', isPaused)
```

**What it does:**
- ❌ All swaps rejected
- ❌ Revenue splits blocked
- ✅ Emergency withdrawals still work

### Update Limits

**Decrease limits if issues arise:**
```typescript
// Lower to 500 TFUEL max, 2,000 total
await contract.updateSwapLimits(
  ethers.parseEther("500"),
  ethers.parseEther("2000")
)
```

### Reset User Total

**For exceptions (refunds, bugs):**
```typescript
await contract.resetUserSwapTotal("0x...")
```

---

## 🔐 Security Measures

### Implemented

- ✅ Reentrancy guards (OpenZeppelin)
- ✅ Ownable access control
- ✅ No unlimited approvals
- ✅ Per-swap + total user limits
- ✅ Emergency pause/kill switch
- ✅ Event logging for transparency
- ✅ UUPS upgradeable (fix bugs without redeploy)

### Not Implemented (Awaiting Audit)

- ⚠️ Formal verification
- ⚠️ Economic attack vectors
- ⚠️ Oracle manipulation checks
- ⚠️ Flash loan protections
- ⚠️ Cross-chain bridge risks

---

## 📞 Support & Reporting

### Report Bugs

**Critical (funds at risk):**
1. Email: security@xfuel.io
2. Discord: @xfuel-emergency
3. Call emergency pause immediately

**Non-critical:**
- GitHub Issues: https://github.com/XFuel-Lab/xfuel-protocol/issues
- Discord: #mainnet-beta channel

### User Support

**Limit Issues:**
- Users hitting 5K total: Expected behavior
- Incorrect tracking: Check localStorage/AsyncStorage, may need reset

**Transaction Issues:**
- Failed swaps: Check Theta Explorer for revert reason
- Gas too high: Use default gas limit (200K + 10% buffer)

---

## 💰 Revenue Allocation

From swaps, revenue splits:
- **50%** → veXF holders (yield)
- **25%** → Buyback & burn XF
- **15%** → rXF minting
- **10%** → Treasury

**Audit Funding Target:** $50,000 USDC
- Estimated swaps needed: ~5,000 swaps @ 100 TFUEL avg
- Timeline: 4-8 weeks

---

## 🚧 Roadmap Post-Beta

1. **Security Audit** (Certik, OpenZeppelin) - 6-8 weeks
2. **Bug Fixes** from audit findings
3. **Limit Removal** after audit approval
4. **Full Production Launch** with unlimited swaps
5. **Chainalysis Integration** for compliance
6. **Insurance Coverage** (Nexus Mutual, etc.)

---

## 📜 Legal Disclaimer

```
THIS SOFTWARE IS PROVIDED "AS IS" WITHOUT WARRANTY OF ANY KIND.

USE AT YOUR OWN RISK. The XFuel Protocol is in BETA TESTING and has NOT
been audited by professional security firms. Bugs may exist that could
result in loss of funds. By using this protocol, you acknowledge:

1. You understand the risks of unaudited smart contracts
2. You will not swap more than you can afford to lose
3. The team is not liable for any losses
4. This is experimental software for testing purposes

NO INVESTMENT ADVICE. This is not financial advice. Cryptocurrency
swaps involve substantial risk. Consult a financial advisor.
```

---

## 👥 Contributors

- **Smart Contracts:** Solidity with OpenZeppelin
- **Web UI:** React + TypeScript + Tailwind
- **Mobile UI:** React Native + Expo
- **Deployment:** Hardhat + EAS

---

## 📄 License

MIT License - See LICENSE file

---

**Questions?** Join our Discord: https://discord.gg/xfuel

**Docs:** https://docs.xfuel.io/mainnet-beta

**Explorer:** https://explorer.thetatoken.org

---

Last Updated: December 26, 2025

