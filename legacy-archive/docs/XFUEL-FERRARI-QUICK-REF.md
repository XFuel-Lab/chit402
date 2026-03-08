# XFUEL Ferrari Tokenomics - Quick Reference

**Version 3.0 | January 2026**

---

## 🏎️ Ferrari Model at a Glance

**Hybrid tokenomics with 4-way revenue distribution:**

```
Protocol Revenue (100%)
├─ 30% BBB (Buyback-Burn-Boost)
│  ├─ 70% Burned (deflationary)
│  └─ 30% Added to LP (liquidity boost)
│
├─ 30% LP Funding (Governance-Voted)
│  ├─ 70% Reinvested (compound existing LPs)
│  └─ 30% New pools (voted by community)
│
├─ 25% veXF Yields (Direct USDC Returns)
│  ├─ 70% Distributed to holders
│  └─ 30% Reverse-burn to RevSplitter
│
└─ 15% Treasury (3 Vaults)
   ├─ 40% Builder Vault (micro-grants)
   ├─ 35% Acquisition Vault (buy protocols)
   └─ 25% Moonshot Vault (R&D experiments)
```

---

## 💰 Revenue Sources

| Source | Rate | Est. Year 3 |
|--------|------|-------------|
| Swap fees | 0.3-0.5% | $150-250K |
| Bridge fees | 0.1% | $50-80K |
| Yield cuts | 3-5% | $120-200K |
| Lottery rake | 5-10% | $30-50K |
| **Total** | - | **$350-580K** |

---

## 🔒 Wallet Setup

| Wallet | Use Case | Required? |
|--------|----------|-----------|
| **Theta Web Wallet** | Main TFUEL operations | ✅ Primary |
| **Keplr Wallet** | LST staking (Cosmos) | ✅ For staking |
| **MetaMask** | Development/testing | Optional |

### Quick Setup:
1. **Theta Web Wallet**: thetatoken.org/wallet
2. **Keplr**: keplr.app/download
3. **Connect**: xfuel.app → "Connect Wallets"

---

## 📊 veXF Multipliers

**Base**: 1× to 4× (lock duration)
- 1 year = 1× veXF
- 2 years = 2× veXF
- 3 years = 3× veXF
- 4 years = 4× veXF

**Bonuses:**
- **Theta Pulse Proof**: +1× to +3× (prove Edge Node earnings)
- **rXF Lock**: +4× (lock rXF receipts 365 days)
- **LP Provider**: +0.5× (provide >$10K liquidity)

**Max Multiplier: 11.5×**
- Example: 10,000 XF locked 4 years + Tier 3 Pulse + rXF + LP = 115,000 veXF

---

## 🔄 Yields Loop (Sustainability)

**30/70 Split on veXF Yields:**
- 70% → Direct to holders (USDC airdrops)
- 30% → Reverse-burn to RevSplitter (recirculates)

**Effect:**
- Creates compounding flywheel
- Increases BBB buybacks (more burn)
- Deepens LP liquidity (less slippage)
- Boosts next yield distribution (snowball)

**Example:**
- Month 1 revenue: $100K
- veXF allocation: $25K (25%)
- Holders receive: $17.5K (70%)
- Reverse-burn: $7.5K (30%) → reenters RevSplitter
- Next cycle: $107.5K effective revenue → loop continues

---

## 🎁 Governance Extras (Monthly Opt-In)

**Budget**: 5-10% of LP revenue per month

**Reward Options (Voted by veXF holders):**
1. **NFT Lottery**: 10-15 limited NFTs raffled to voters
2. **Bonus Airdrops**: Extra 10% veXF yield for active voters
3. **Milestone Tokens**: XF bonuses at TVL milestones
4. **Early Access**: Beta test new features (ZK rollup, AI optimizer)

**Eligibility**: Must vote on ≥1 proposal per month

---

## 🎯 Milestone Rewards

### TVL Milestones

| Milestone | Reward | Distribution |
|-----------|--------|--------------|
| $100K | 250 XF airdrop | Pro-rata to veXF |
| $500K | 500 XF + 10 NFTs | Pro-rata + lottery |
| $1M | 1,000 XF + early rXF | Pro-rata + snapshot |
| $5M | 2,500 XF + 2× LP rewards | Pro-rata + bonus |
| $10M | 5,000 XF + founder NFT | All holders |

### Volume Milestones

| Milestone | Effect |
|-----------|--------|
| $1M monthly | Fee reduction event (0.2% for 48h) |
| $5M monthly | Bonus 5% veXF yield |
| $10M monthly | Treasury buyback ($25K extra BBB) |

---

## 🛡️ Risk Mitigation Summary

### Technical Risks

| Risk | Severity | Mitigation |
|------|----------|------------|
| ZK proof forgery | 🔴 Critical | Groth16 security + Merkle verification + nonce tracking |
| IBC relayer failure | 🟡 Medium | 5 redundant relayers + auto-restart + timeout refunds |
| Smart contract exploit | 🔴 Critical | 3 audits + $500K bounty + emergency pause + insurance fund |

### Economic Risks

| Risk | Severity | Mitigation |
|------|----------|------------|
| ibcTFUEL depeg | 🟡 Medium | Arbitrage incentives + circuit breaker + redemption guarantee |
| XF death spiral | 🟡 Medium | USDC yields (no sell pressure) + buyback floor + lock incentives |

### Regulatory Risks

| Risk | Severity | Mitigation |
|------|----------|------------|
| Securities classification | 🟡 Medium | Utility focus + decentralization + legal opinion + geofencing |

---

## 📈 5-Year Projections

### Revenue Growth

| Year | TVL | Monthly Volume | Annual Revenue |
|------|-----|----------------|----------------|
| 1 | $5M | $500K | $18K |
| 2 | $20M | $2M | $72K |
| 3 | $50M | $5M | $180K |
| 4 | $100M | $10M | $360K |
| 5 | $200M | $20M | $720K |

### Cumulative Burn (BBB)

| Year | BBB Budget | XF Burned | Cumulative | % Supply |
|------|------------|-----------|------------|----------|
| 1 | $5.4K | 3,780 | 3,780 | 0.004% |
| 2 | $21.6K | 10,080 | 13,860 | 0.014% |
| 3 | $54K | 18,900 | 32,760 | 0.033% |
| 4 | $108K | 27,491 | 60,251 | 0.060% |
| 5 | $216K | 43,200 | 103,451 | 0.103% |

### veXF Yields (4-year lock, 10K XF stake)

| Year | Annual Yield | Yield % | Total Return |
|------|--------------|---------|--------------|
| 1 | $360 | 3.6% | $360 |
| 2 | $1,440 | 9.6% | $1,800 |
| 3 | $3,600 | 18% | $5,400 |
| 4 | $7,200 | 26% | $12,600 |
| 5 | $14,400 | 41% | $27,000 |

**5-Year ROI**: 416% (base case) | 150% (bear) | 950% (bull)

---

## 🚀 Roadmap Summary

- **Q2 2025**: ZK bridge launch (testnet)
- **Q3 2025**: Yield automation (LST swaps)
- **Q4 2025**: Ferrari tokenomics (30/30/25/15)
- **Q1 2026**: Yields loop (30% reverse-burn)
- **Q2 2026**: Decentralization (admin keys to DAO)
- **Q3-Q4 2026**: Expansion (Ethereum bridge, AI optimizer, ZK rollup)

---

## 📞 Quick Links

- **Website**: https://xfuel.app
- **Full Whitepaper**: [WHITEPAPER.md](./WHITEPAPER.md) *(coming soon - run polish script)*
- **ZK Overhaul**: [ZK_OVERHAUL_SUMMARY.md](./overhaul/ZK_OVERHAUL_SUMMARY.md) ⚡
- **GitHub**: https://github.com/XFuel-Lab/xfuel-protocol
- **Bug Bounty**: https://immunefi.com/bounty/xfuel
- **Twitter**: [@XFuelLab](https://twitter.com/XFuelLab)

---

## ⚠️ Disclaimer

Experimental software with risks. No guarantees of returns. DYOR. Never invest more than you can lose.

---

**Version**: 3.0 (Ferrari Edition)  
**Date**: January 2026  
**Status**: ✅ Ready for Review

