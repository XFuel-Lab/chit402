---
title: "XFuel Protocol: Ferrari Hybrid Tokenomics Edition"
subtitle: "Version 3.0 - Post-ZK Overhaul"
author: "XFuel Lab"
date: "January 2026"
geometry: "margin=1in"
fontsize: 11pt
documentclass: article
header-includes:
  - \usepackage{fancyhdr}
  - \pagestyle{fancy}
  - \fancyhead[L]{XFuel Protocol}
  - \fancyhead[R]{v3.0 Ferrari Edition}
  - \fancyfoot[C]{\thepage}
toc: true
toc-depth: 3
---

# Cover Page

\begin{center}

\vspace*{2cm}

{\Huge \textbf{XFuel Protocol}}

\vspace{0.5cm}

{\LARGE Ferrari Hybrid Tokenomics Edition}

\vspace{0.5cm}

{\large Version 3.0 - Post-ZK Overhaul}

\vspace{2cm}

{\Large 🏎️ 🚀 ⚡}

\vspace{1cm}

{\large \textbf{XFuel Lab}}

\vspace{0.5cm}

January 2026

\vspace{2cm}

\textbf{Status:} Production Ready - Awaiting CertiK Audit

\vspace{1cm}

\textit{Sub-4s Settlements | Zero-Knowledge Security | Sustainable Tokenomics}

\vspace{2cm}

{\small Live: \texttt{xfuel.app} | GitHub: \texttt{github.com/XFuel-Lab/xfuel-protocol}}

\end{center}

**Prefer the interactive version?**  
Read online: [docs/WHITEPAPER.md](https://github.com/XFuel-Lab/xfuel-protocol/blob/main/docs/WHITEPAPER.md)

**Document Info:**
- **Generated:** January 5, 2026  
- **Source:** Markdown (always check repo for latest updates)  
- **License:** MIT License  
- **Contact:** hello@xfuel.app | security@xfuel.app

# Abstract

XFuel Protocol introduces a **zero-knowledge powered bridge** between Theta and Cosmos ecosystems, enabling **sub-4-second settlements** for TFUEL → LST atomic swaps with automated yield optimization. The protocol implements **Ferrari Hybrid Tokenomics**, a novel 4-way revenue distribution model (30/30/25/15) with a 30% reverse-burn sustainability loop, creating a self-reinforcing economic flywheel.

Following our January 2026 ZK overhaul, XFuel achieves:

- **<4s end-to-end finality** (73% faster than pre-overhaul)
- **Groth16 ZK-SNARKs** for cryptographic security (2^-128^ soundness)
- **Parallel proof/IBC processing** (2.5x throughput increase)
- **1:1 cryptographic peg** maintenance
- **Automated circuit breakers** for emergency protection

This whitepaper presents the complete technical architecture, tokenomics model, security analysis, and roadmap for the XFuel Protocol.

**Live:** [xfuel.app](https://xfuel.app) | **GitHub:** [XFuel-Lab/xfuel-protocol](https://github.com/XFuel-Lab/xfuel-protocol)

# 1. Introduction

## 1.1 Problem Statement

Cross-chain DeFi faces three fundamental challenges:

1. **Trust Assumptions**: Traditional bridges rely on centralized relayers or multisig validators, introducing custody risk and single points of failure.

2. **Poor Performance**: Existing bridges suffer from high latency (10-30s settlements), limiting user experience and capital efficiency.

3. **Unsustainable Tokenomics**: Most DeFi protocols use single-purpose revenue models (all to treasury, all to LPs, or all to token holders), creating one-way value drains that cannot sustain long-term growth.

## 1.2 Solution Overview

XFuel Protocol addresses these challenges through:

**Zero-Knowledge Bridge:**

- Groth16 ZK-SNARKs for cryptographic proof validation
- No trust assumptions (cryptographic security guarantees)
- Sub-4-second finality (1.5s proof + 50ms verification)
- Native IBC integration for Cosmos interoperability

**Ferrari Hybrid Tokenomics:**

- 4-way revenue distribution: 30% BBB, 30% LP, 25% veXF, 15% Treasury
- 30% reverse-burn sustainability loop (recirculating yields)
- Multi-factor veXF multipliers (up to 11.5x)
- Monthly governance extras (5-10% LP revenue)

## 1.3 Key Innovations

1. **Trustless Cross-Chain Swaps**: First TFUEL → Cosmos LST bridge using ZK proofs
2. **Sub-4s Finality**: Fastest bridge settlement in the Theta ecosystem
3. **Sustainable Tokenomics**: Self-reinforcing flywheel that compounds over time
4. **Manual-First UX**: No wallet extensions required (QR code deposits)
5. **Automated Yield Optimization**: Routing to highest-yielding LSTs (30-38% APY)

# 2. Architecture

## 2.1 System Overview

XFuel operates as a three-layer system connecting Theta (EVM), Backend (ZK Proof), and Persistence (CosmWasm).

**Architecture Diagram:**

```
┌─────────────────────────────────────────────────────┐
│              XFUEL PROTOCOL                         │
├─────────────────────────────────────────────────────┤
│  THETA → BACKEND (ZK Proof) → PERSISTENCE          │
│  VaultFactory → Groth16 → ZKVerifier               │
│  RevenueSplitter → snarkjs → ibcTFUEL              │
└─────────────────────────────────────────────────────┘
```

## 2.2 Component Details

### 2.2.1 Theta Layer (Smart Contracts)

**VaultFactory** (`0xB0a26600074dADC69186632a1B8dFd7c3146Ce56`)

- Manages deposit vaults per user
- Locks TFUEL with Merkle proof generation
- Handles unwrap operations (burn → release)
- Emits events for backend detection

**RevenueSplitter** (`0x1C4CEbbb4Cfa7fdb546424F21CF706c48C478EE6`)

- Implements Ferrari 30/30/25/15 splits
- Processes 0.5% bridge fees
- Routes 30% reverse-burn from veXF yields
- Distributes to BBB, LP, veXF, Treasury

### 2.2.2 Backend Layer (Node.js Services)

**ZK Prover:**

- Circom circuit compilation
- Witness generation (~500ms)
- Groth16 proof computation (~1000ms)
- Proof serialization and submission

### 2.2.3 Persistence Layer (CosmWasm Contracts)

**ZKVerifier.wasm:** Groth16 proof verification in 50ms constant time

**ibcTFUEL.wasm:** CW20 wrapped token with 1:1 peg

**IBC Channel-190:** Native Cosmos interoperability

## 2.3 Post-Overhaul Notes

**Completed:** January 4, 2026

The ZK bridge overhaul transformed XFuel from a trust-based system to a fully cryptographic, zero-knowledge protocol.

### Performance Improvements

| Metric | Pre-Overhaul | Post-Overhaul | Improvement |
|--------|--------------|---------------|-------------|
| **Settlement Time** | 10-15 seconds | <4 seconds | **73% faster** |
| **Proof Generation** | N/A (trusted) | 1.5s | New capability |
| **Proof Verification** | N/A | 50ms constant | New capability |
| **Throughput** | 6 tx/min | 15 tx/min | **2.5x increase** |
| **Security Model** | Trust-based | Zero-knowledge | Trustless |

# 3. Zero-Knowledge Bridge

## 3.1 ZK-SNARK Overview

XFuel uses **Groth16**, a pairing-based ZK-SNARK system, for deposit validation. Groth16 provides:

- **Succinctness**: Constant-size proofs (192 bytes)
- **Efficiency**: Fast verification (50ms constant)
- **Security**: Computational soundness (2^-128^)
- **Non-interactivity**: No back-and-forth required

## 3.2 Circuit Design

The Circom circuit validates deposits by checking:

1. Depositor address (160 bits)
2. TFUEL amount (256 bits)
3. Unique nonce
4. Merkle proof of inclusion
5. Amount bounds (0.1-100 TFUEL)

## 3.3 Proof Generation Flow

1. **DETECT DEPOSIT** (2s avg) - Backend listener catches event
2. **GENERATE WITNESS** (500ms) - Extract deposit data
3. **COMPUTE PROOF** (1000ms) - Groth16 proof generation
4. **SERIALIZE** (50ms) - Convert to JSON format

**TOTAL:** ~1.5 seconds

## 3.4 Verification Process

On-chain verification in CosmWasm:

1. Load verification key (cached)
2. Validate nonce uniqueness
3. Verify pairing equation (50ms)
4. Mark nonce as used
5. Mint ibcTFUEL 1:1

## 3.5 Security Properties

- **Soundness**: Probability of forging proof < 2^-128^
- **Zero-Knowledge**: Verifier learns nothing beyond validity
- **Completeness**: Valid deposits always verify
- **Non-Malleability**: Proofs cannot be modified

## 3.6 IBC Integration

**Channel-190** (Theta ↔ Persistence):

Native Cosmos interoperability via IBC protocol with:

- 10-minute timeout
- Automatic refund on failure
- Multi-hop routing support
- Battle-tested IBC security

# 4. Ferrari Hybrid Tokenomics

## 4.1 The Ferrari Model

Named for its **precision engineering**, the Ferrari model balances four competing forces like pistons in an engine:

1. **Deflation** (BBB): Reduces supply → scarcity → price appreciation
2. **Liquidity** (LP Funding): Deepens pools → less slippage → better UX
3. **Yields** (veXF): Rewards holders → incentivizes locks → less sell pressure
4. **Innovation** (Treasury): Funds R&D → new features → more users → more revenue

## 4.2 Revenue Distribution (30/30/25/15)

### Protocol Revenue Split

| Allocation | Percentage | Purpose |
|------------|------------|---------|
| **BBB** | 30% | Buyback-Burn-Boost (70% burned, 30% to LP) |
| **LP Funding** | 30% | Governance-voted liquidity (70% reinvest, 30% new pools) |
| **veXF Yields** | 25% | Direct USDC returns (70% distributed, 30% reverse-burn) |
| **Treasury** | 15% | 3 vaults: Builder/Acquisition/Moonshot |

## 4.3 The 30% Reverse-Burn Loop

**Key Innovation**: 30% of veXF yields return to the RevenueSplitter, creating a compounding flywheel.

**Example Calculation:**

- Month 1: $100K revenue
- veXF allocation: $25K (25%)
- Distributed: $17.5K (70%)
- Reverse-burn: $7.5K (30%) → back to RevSplitter
- Month 2: $107.5K effective revenue (+7.5%)

**Effect:** Revenue compounds ~7.5% per cycle. After 12 months: ~138% of base revenue.

## 4.4 Comparison to Traditional Models

| Feature | Traditional | Uniswap | Curve | **Ferrari** |
|---------|-------------|---------|-------|------------|
| Revenue Split | 100% Treasury | 100% LPs | 50/50 | **30/30/25/15** |
| Deflation | None/Manual | None | None | **70% BBB burned** |
| Holder Yields | Emissions | None | Vote bribes | **25% USDC direct** |
| Sustainability | Depletes | Fee-dependent | Self-sustaining | **Compounding loop** |
| Treasury | Spent | None | None | **15% accumulated** |

# 5. Governance & veXF

## 5.1 veXF Token

**veXF** (vote-escrowed XF) is the governance token earned by locking XF tokens.

### Base Multipliers (lock duration)

- 1 year lock = 1× veXF
- 2 year lock = 2× veXF
- 3 year lock = 3× veXF
- 4 year lock = 4× veXF

### Bonus Multipliers (stackable)

- **Theta Pulse Proof**: +1× to +3× (prove Edge Node earnings)
- **rXF Lock**: +4× (lock revenue receipts 365 days)
- **LP Provider**: +0.5× (provide >$10K liquidity)

**Maximum Multiplier: 11.5×**

*Example:* 10,000 XF locked 4 years + Tier 3 Pulse + rXF + LP = **115,000 veXF**

## 5.2 Governance Powers

veXF holders vote on:

- Protocol parameters (fees, splits, integrations)
- LP funding allocation (which pools, new pools)
- Treasury spending (grants, acquisitions, R&D)
- Governance extras (monthly opt-in rewards)

## 5.3 Governance Extras (Monthly Opt-In)

**Budget:** 5-10% of LP revenue per month

**Reward Options:**

1. **NFT Lottery**: 10-15 limited NFTs raffled to voters
2. **Bonus Airdrops**: Extra 10% veXF yield for active voters
3. **Milestone Tokens**: XF bonuses at TVL milestones
4. **Early Access**: Beta test new features

**Eligibility:** Must vote on ≥1 proposal per month

**Target:** 50-60% participation (vs 10-15% industry average)

## 5.4 rXF Revenue Receipts

**rXF** tokens are minted when veXF yields are distributed, representing revenue claims.

**Mechanics:**

- 1 rXF = $1 of past protocol revenue
- Can be locked for +4× veXF multiplier
- Tradeable (creates revenue futures market)
- Redeemable for USDC at any time (if unlocked)

# 6. Revenue Model

## 6.1 Revenue Sources

| Source | Rate | Estimated Year 3 Revenue |
|--------|------|--------------------------|
| **Swap Fees** | 0.3-0.5% | $150K-250K |
| **Bridge Fees** | 0.5% | $50K-80K |
| **Yield Cuts** | 3-5% | $120K-200K |
| **Lottery Rake** | 5-10% | $30K-50K |
| **TOTAL** | - | **$350K-580K annually** |

## 6.2 Fee Breakdown

**Swap Fees (0.3-0.5%):**

- TFUEL → ibcTFUEL: 0.5%
- ibcTFUEL → LST: 0.3%
- Collected by XFUELRouter
- Sent to RevenueSplitter every 24h

**Bridge Fees (0.5%):**

- Charged on Theta deposit
- Example: Deposit 1 TFUEL → 0.995 TFUEL locked, 0.005 to fees
- Collected by VaultFactory

**Yield Cuts (3-5%):**

- Performance fee on LST staking rewards
- Example: User earns 35% APY → Protocol takes 3.5% → User keeps 31.5%
- Only charged on positive returns

# 7. Technical Implementation

## 7.1 Smart Contracts (Solidity)

Key contracts on Theta mainnet with security features:

- Reentrancy guards
- Access controls (multisig)
- Emergency pause mechanisms
- 24h timelock on parameter changes

## 7.2 CosmWasm Contracts (Rust)

Deployed on Persistence (core-1):

- ZKVerifier: Groth16 verification in constant time
- ibcTFUEL: CW20 token with 1:1 peg guarantee
- IBC Channel-190: Standard ICS-20 token transfers

## 7.3 Backend Services (TypeScript)

- IBC Listener: Monitors Theta deposits every 2 seconds
- ZK Prover: Generates proofs using Circom/snarkjs
- IBC Router: Handles cross-chain messages
- Yield Optimizer: Routes to highest APY LSTs

# 8. Risk Analysis & Mitigation

## 8.1 Technical Risks

### ZK Proof Forgery

| Risk | Severity | Mitigation |
|------|----------|------------|
| Attacker generates valid proof for invalid deposit | 🔴 Critical | Groth16 security (2^-128^), Merkle verification, nonce tracking |

### IBC Relayer Failure

| Risk | Severity | Mitigation |
|------|----------|------------|
| Relayer downtime prevents transfers | 🟡 Medium | 5 redundant relayers, auto-restart, timeout refunds |

### Smart Contract Exploits

| Risk | Severity | Mitigation |
|------|----------|------------|
| Bug allows theft/manipulation | 🔴 Critical | 3 audits (planned), $500K bug bounty, emergency pause, insurance fund |

## 8.2 Economic Risks

### ibcTFUEL Depeg

| Risk | Severity | Mitigation |
|------|----------|------------|
| ibcTFUEL trades below 1:1 with TFUEL | 🟡 Medium | Arbitrage incentives, circuit breaker at 0.5%, treasury support |

### XF Death Spiral

| Risk | Severity | Mitigation |
|------|----------|------------|
| Token price crashes, triggering sell cascade | 🟡 Medium | USDC yields (no sell pressure), buyback floor, lock incentives |

## 8.3 Regulatory Risks

### Securities Classification

| Risk | Severity | Mitigation |
|------|----------|------------|
| XF token classified as security | 🟡 Medium | Utility focus, decentralization roadmap, legal opinion, geofencing |

# 9. Economic Model & Projections

## 9.1 Revenue Growth Scenarios

**Base Case Assumptions:**

- 200% annual TVL growth (Year 1-3)
- 10% monthly volume
- 0.4% average fees
- 35% LST APY

### Base Case Projections

| Year | TVL | Monthly Volume | Annual Revenue |
|------|-----|----------------|----------------|
| **1** | $5M | $500K | $18K |
| **2** | $20M | $2M | $72K |
| **3** | $50M | $5M | $180K |
| **4** | $100M | $10M | $360K |
| **5** | $200M | $20M | $720K |

### Cumulative Metrics (5 Years)

| Metric | Total |
|--------|-------|
| **Total Revenue** | $1.35M |
| **XF Burned** | 103,451 tokens (0.103% supply) |
| **LP Depth Added** | $405K |
| **veXF Yields Paid** | $337.5K |
| **Treasury Accumulated** | $202.5K |

## 9.2 Token Economics

**XF Token Supply:** 100,000,000 (fixed, no emissions)

**Distribution:**

- 30% (30M): BBB Reserve
- 25% (25M): LP Funding
- 20% (20M): veXF Yield Reserve
- 10% (10M): Early Believers (vested 24 months)
- 10% (10M): Team (vested 48 months, 12-month cliff)
- 5% (5M): Treasury Operations

## 9.3 veXF Yield Projections

**Scenario:** 10,000 XF locked for 4 years (40,000 veXF)

| Year | Protocol Revenue | Annual Yield | Yield % |
|------|------------------|--------------|---------|
| 1 | $18K | $360 | 3.6% |
| 2 | $72K | $1,440 | 14.4% |
| 3 | $180K | $3,600 | 36% |
| 4 | $360K | $7,200 | 72% |
| 5 | $720K | $14,400 | 144% |

**5-Year Total Return:** $27,000 on $10K stake = **270% ROI**

# 10. Roadmap

## 10.1 Q1 2026 (Current)

**Status:** ✅ **Complete**

- ✅ ZK bridge overhaul (Groth16 SNARKs)
- ✅ Sub-4s settlements achieved
- ✅ Ferrari tokenomics deployed
- ✅ Beta mainnet launch (Jan 4)
- ⏳ CosmWasm governance whitelist (pending)

## 10.2 Q2 2026

**Focus:** Security & Scale

- 🎯 CertiK comprehensive audit
- 🎯 Bug bounty launch ($500K pool)
- 🎯 Additional LST integrations (stkATOM, stkOSMO, milkTIA)
- 🎯 Mainnet v1.0 (remove beta limits)
- 🎯 Mobile app optimization

**Targets:** $5M TVL, 1,000 users, 10,000+ transactions

## 10.3 Q3 2026

**Focus:** Expansion & Automation

- 🎯 Ethereum bridge (WETH → stkETH)
- 🎯 AI yield optimizer (ML-powered APY prediction)
- 🎯 Governance DAO transition (admin keys to DAO)
- 🎯 Cross-chain DEX aggregation

**Targets:** $20M TVL, 3 chains, 8+ LSTs

## 10.4 Q4 2026

**Focus:** Scale & Innovation

- 🎯 ZK rollup layer (10x throughput, <1s settlements)
- 🎯 Institutional features (KYC/AML optional, custody solutions)
- 🎯 NFT marketplace (trade governance NFTs)
- 🎯 Mobile DEX (native iOS/Android)

**Targets:** $50M+ TVL, 10,000+ users, fully decentralized governance

## 10.5 2027+ Vision

- Multi-chain ZK bridge (any EVM → any Cosmos)
- Intent-based architecture
- Account abstraction
- $100M+ TVL, $500K+ annual revenue

# 11. Conclusion

## 11.1 Summary of Innovations

XFuel Protocol introduces several industry-first innovations:

1. **Zero-Knowledge Theta Bridge**: First trustless bridge from Theta to Cosmos using ZK-SNARKs
2. **Ferrari Hybrid Tokenomics**: Novel 4-way revenue distribution with reverse-burn loop
3. **Multi-Factor veXF System**: Up to 11.5× voting multipliers
4. **Manual-First UX**: QR code deposits, no wallet extensions
5. **Automated Yield Optimization**: ML-powered routing

## 11.2 Key Value Propositions

**For Users:**

- Fast (<4s), secure (ZK proofs), easy (no extensions)
- 30-38% APY on TFUEL
- Non-custodial

**For XF Holders:**

- Real yield (USDC revenue share)
- Deflation (30% revenue to buyback-burn)
- Sustainability (reverse-burn compounds)

**For Liquidity Providers:**

- Deep liquidity (30% revenue reinvested)
- IL protection (treasury backstop)
- LP rewards (veXF bonus multiplier)

## 11.3 Competitive Advantages

XFuel is the fastest, most secure, and most sustainable bridge in the Theta ecosystem, with Ferrari tokenomics that compound value over time.

## 11.4 Risk Acknowledgment

XFuel Protocol is experimental software with inherent risks:

- Pre-audit status (awaiting CertiK)
- Novel technology not battle-tested at scale
- Market risk (crypto volatility)
- Regulatory uncertainty

**Users should only deposit amounts they can afford to lose.**

## 11.5 Call to Action

**Join the Ferrari Revolution:**

1. Try the Beta: [xfuel.app](https://xfuel.app)
2. Lock for veXF: Earn governance + USDC yields
3. Provide Liquidity: Get LP bonus multiplier
4. Vote on Proposals: Shape the future
5. Report Bugs: Help secure the protocol

**The Ferrari is engineered for precision - so is our protocol.** 🏎️

# 12. References

### Academic Papers

1. Groth, J. (2016). "On the Size of Pairing-Based Non-interactive Arguments." *Advances in Cryptology – EUROCRYPT 2016*

2. Barreto, P. S. L. M., & Naehrig, M. (2006). "Pairing-Friendly Elliptic Curves of Prime Order."

3. iden3 team. (2020). "Circom: A Circuit Compiler for Zero-Knowledge Proofs."

4. Cosmos Network. (2021). "Inter-Blockchain Communication Protocol."

### XFuel Resources

12. **XFuel GitHub Repository**  
    https://github.com/XFuel-Lab/xfuel-protocol

13. **ZK Overhaul Summary**  
    XFuel Team. (2026). "Zero-Knowledge Bridge Overhaul."

14. **Ferrari Quick Reference**  
    XFuel Team. (2026). "Ferrari Tokenomics Quick Guide."

# 13. Glossary

**APY (Annual Percentage Yield)**: Annualized return including compound interest

**BBB (Buyback-Burn-Boost)**: XFuel's deflationary mechanism (30% revenue)

**BN254**: Elliptic curve for pairing-based cryptography (128-bit security)

**Circuit Breaker**: Automated safety mechanism pausing operations on anomalies

**Circom**: Domain-specific language for ZK proof circuits

**Cosmos**: Ecosystem of interoperable blockchains via IBC

**CosmWasm**: Smart contract platform for Cosmos (Rust → WebAssembly)

**CW20**: Fungible token standard on CosmWasm (analogous to ERC-20)

**Groth16**: Efficient ZK proof system (192-byte proofs, 50ms verification)

**IBC (Inter-Blockchain Communication)**: Protocol for trustless blockchain communication

**ibcTFUEL**: Wrapped TFUEL on Persistence (1:1 peg, CW20 token)

**LST (Liquid Staking Token)**: Tradeable token representing staked assets (stkTIA, stkATOM)

**Merkle Proof**: Cryptographic proof of element inclusion in tree

**Nonce**: Unique number used once (prevents replay attacks)

**Pairing**: Bilinear map enabling advanced elliptic curve protocols

**Persistence (core-1)**: Cosmos blockchain hosting XFuel's CosmWasm contracts

**Reverse-Burn**: XFuel innovation where 30% of veXF yields recirculate

**RevenueSplitter**: Contract distributing revenue (30/30/25/15 model)

**rXF (Revenue Receipts)**: Tokens representing past revenue claims (+4× veXF bonus if locked)

**Soundness**: ZK property that false statements cannot be proven

**TFUEL**: Native gas token of Theta blockchain

**Theta**: Blockchain optimized for video streaming and edge computing

**TVL (Total Value Locked)**: Sum of all assets in protocol (USD)

**veXF (vote-escrowed XF)**: Governance token from locking XF (non-transferable)

**VaultFactory**: Main Theta contract managing deposits and TFUEL locking

**Witness**: Private inputs to ZK proof circuit (known to prover only)

**XF**: Native governance token (100M fixed supply)

**ZK-SNARK**: Zero-Knowledge Succinct Non-Interactive Argument of Knowledge

**Zero-Knowledge**: Proof reveals nothing beyond statement truth

# Appendix A: Contract Addresses

## Theta Mainnet (Chain ID: 361)

```
VaultFactory:       0xB0a26600074dADC69186632a1B8dFd7c3146Ce56
RevenueSplitter:    0x1C4CEbbb4Cfa7fdb546424F21CF706c48C478EE6
XFUELRouter:        (pending deployment)
TreasuryBackstop:   (pending deployment)
```

## Persistence Mainnet (core-1)

```
ZKVerifier:         persistence1... (awaiting governance whitelist)
ibcTFUEL:           persistence1... (awaiting governance whitelist)
IBC Channel:        channel-190
```

**Latest Deployment Transaction:**  
`1640372708F6E57D9FEB1006368B106BF7C18BDB056A471F5A98CB6878A6E1D9`

# Appendix B: Performance Benchmarks

## Local Testnet (100 transactions)

| Metric | Min | Average | Max | Std Dev |
|--------|-----|---------|-----|---------|
| Proof Generation | 1.2s | 1.5s | 2.1s | 0.15s |
| Verification | 45ms | 50ms | 65ms | 5ms |
| E2E Settlement | 3.2s | 3.8s | 4.5s | 0.3s |
| Success Rate | - | 99.8% | - | - |

## Mainnet Beta (10 transactions)

- Average Proof Generation: 1.48s
- Average Verification: 52ms
- Average IBC Transfer: 480ms
- Average E2E Settlement: 3.7s
- Success Rate: 100%

# Appendix C: FAQ

**Q: Is XFuel safe to use?**  
A: XFuel is currently in beta and has not yet been audited. Use at your own risk with small amounts. Full CertiK audit scheduled Q2 2026.

**Q: How fast are cross-chain transfers?**  
A: <4 seconds from Theta deposit to Cosmos LST receipt (average 3.8s in testing).

**Q: What's the minimum deposit?**  
A: 0.1 TFUEL (to cover gas fees and maintain economic viability).

**Q: Can I withdraw my TFUEL?**  
A: Yes, burn your ibcTFUEL on Persistence to unwrap TFUEL on Theta. You receive 70% directly, 30% is recycled to the protocol.

**Q: What yields can I expect?**  
A: LST staking yields are 30-38% APY (market-dependent). veXF holders also earn USDC revenue share (3.6-144% APY depending on protocol growth).

**Q: Is there a lock-up period?**  
A: No lock-up for bridge transfers. veXF requires voluntary locks (1-4 years) for governance and yields.

---

**Document Version:** 3.0 (Ferrari Edition - Post-ZK Overhaul)  
**Last Updated:** January 5, 2026  
**Status:** 🏎️ Production Ready - Awaiting CertiK Audit

**Contact:**

- **Website:** [xfuel.app](https://xfuel.app)
- **GitHub:** [github.com/XFuel-Lab/xfuel-protocol](https://github.com/XFuel-Lab/xfuel-protocol)
- **Security:** security@xfuel.app
- **General:** hello@xfuel.app

---

⚠️ **Disclaimer**: This whitepaper is for informational purposes only and does not constitute financial advice, investment recommendation, or an offer to sell securities. XFuel Protocol is experimental software with inherent risks. Cryptocurrency investments are highly volatile and may result in total loss. Users should conduct their own research and consult with qualified professionals before making any investment decisions. Past performance does not guarantee future results. The XFuel team makes no warranties or representations regarding the accuracy or completeness of this document. All forward-looking statements are subject to risks and uncertainties. Use the protocol at your own risk and only with funds you can afford to lose.

---

© 2026 XFuel Protocol. Licensed under MIT License.

---

**Generated from Markdown source** - Always check [GitHub repository](https://github.com/XFuel-Lab/xfuel-protocol) for latest updates.

