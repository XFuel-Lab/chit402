# XFUEL Whitepaper

## Latest Version: v2.0 (ZK Bridge Edition)

**December 29, 2025**

---

## 📄 Documents

### Main Whitepaper
- **Markdown:** [XFUEL-ZK-Bridge-Whitepaper.md](XFUEL-ZK-Bridge-Whitepaper.md) (comprehensive technical document)
- **PDF:** [XFUEL-ZK-Bridge-Whitepaper.pdf](XFUEL-ZK-Bridge-Whitepaper.pdf) (download for offline reading)
- **HTML Preview:** [XFUEL-ZK-Bridge-Whitepaper.html](XFUEL-ZK-Bridge-Whitepaper.html) (browser-friendly version)

### Supporting Documents
- **Quick Overview:** [whitepaper-content.md](whitepaper-content.md) (condensed version)
- **Medium Publication:** [XFUEL-Whitepaper-Medium.md](XFUEL-Whitepaper-Medium.md) (optimized for Medium.com)
- **Legacy Version:** [../whitepaper.md](../whitepaper.md) (v1.0 - redirects to new version)

---

## 🆕 What's New in v2.0?

### Major Additions
1. **Zero-Knowledge Proof System (Section 3.2)**
   - Circom circuit implementation
   - Groth16 ZK-SNARK specifications
   - Proof generation & verification flow
   - 192-byte proofs with <50ms verification

2. **Non-Connect Deposit Flow (Section 3.1)**
   - Manual QR code deposits (no wallet extensions)
   - Backend listener architecture
   - Recipient address extraction from tx.data
   - 6-second block confirmations

3. **IBC Integration & ibcTFUEL Minting (Section 3.3)**
   - IBC channel-190 specifications
   - 1:1 TFUEL peg mechanism
   - CW20 token on Persistence (Cosmos)
   - Cross-chain transfer protocol

4. **Comprehensive Risk Analysis (Section 7)**
   - Technical risks (ZK proof forgery, IBC relayer failure, smart contract exploits)
   - Economic risks (depeg scenarios, LST failures, governance attacks)
   - Regulatory risks (securities classification, AML/KYC, sanctions)
   - Operational risks (backend compromise, phishing, dependencies)
   - **30+ risk scenarios** with severity ratings and mitigations

5. **Yield Optimization Engine (Section 3.5)**
   - Multi-LST strategy (stkTIA, stkATOM, stkXPRT, pSTAKE BTC)
   - Weekly rebalancing logic
   - Oracle integration (Chainlink, Band, Pyth)
   - Auto-compounding mechanics

6. **Security Model (Section 6)**
   - Cryptographic guarantees (soundness, Merkle root verification, nonce tracking)
   - IBC security assumptions
   - Smart contract audit status
   - Emergency circuit breakers

### Preserved from v1.0
- **Tokenomics (Section 5):** 100M XF supply, 90/10 revenue split, veXF governance
- **Revenue Flow:** 50% direct yield, 25% buyback-burn, 15% rXF minting, 10% treasury
- **Innovation Treasury:** Builder, Acquisition, Moonshot vaults
- **Theta Pulse Proof Staking:** Edge Node earnings verification
- **Cybernetic Fee Switch:** Governance-controlled fee modes

---

## 📊 Key Metrics

| Metric | Value |
|--------|-------|
| **Bridge Finality** | < 4 seconds (ZK proof + IBC) |
| **Target APY** | 30-38% (Cosmos LSTs) |
| **Security Model** | ZK-SNARKs + IBC light client |
| **XF Total Supply** | 100,000,000 (fixed) |
| **Revenue Split** | 90% veXF holders, 10% treasury |
| **Buyback-Burn** | 25% of revenue |

---

## 🔧 Generating the PDF

### Prerequisites
```bash
npm install -g marked puppeteer
```

### Generate PDF
```bash
cd docs/whitepaper
node generate-pdf-v2.mjs
```

**Output:**
- `XFUEL-ZK-Bridge-Whitepaper.pdf` (A4, optimized for printing)
- `XFUEL-ZK-Bridge-Whitepaper.html` (preview in browser)

---

## 📚 Document Structure

```
docs/whitepaper/
├── XFUEL-ZK-Bridge-Whitepaper.md    # Main document (11 sections)
├── XFUEL-ZK-Bridge-Whitepaper.pdf   # PDF version (generated)
├── XFUEL-ZK-Bridge-Whitepaper.html  # HTML preview (generated)
├── whitepaper-content.md             # Condensed overview
├── XFUEL-Whitepaper-Medium.md       # Medium publication version
├── generate-pdf-v2.mjs              # PDF generation script
├── README.md                         # This file
└── diagrams/                         # SVG diagrams
    ├── revenue-flow.svg
    └── innovation-flywheel.svg
```

---

## 🔗 External Links

- **Website:** https://xfuel.app
- **GitHub:** https://github.com/XFuel-Lab/xfuel-protocol
- **Twitter:** [@XFUEL](https://twitter.com/XFUEL)
- **Docs:** https://docs.xfuel.app

---

## 📖 Table of Contents (Full Whitepaper)

1. Introduction & Vision
2. The Opportunity
3. Technical Architecture
   - 3.1 Non-Connect Deposit Flow
   - 3.2 Zero-Knowledge Proof System
   - 3.3 IBC Integration & ibcTFUEL Minting
   - 3.4 Smart Contract Layer
   - 3.5 Yield Optimization Engine
4. ibcTFUEL Tokenomics
5. XF Governance Token Tokenomics
6. Security Model & Cryptographic Guarantees
7. **Risks & Mitigations** (NEW)
8. Governance & Sustainability
9. Roadmap
10. Conclusion
11. References & Appendices

---

## 📄 License

**Creative Commons BY-NC-SA 4.0**

You are free to:
- Share — copy and redistribute the material
- Adapt — remix, transform, and build upon the material

Under the following terms:
- Attribution — credit XFUEL Core Team
- NonCommercial — not for commercial purposes
- ShareAlike — distribute under same license

---

## ⚠️ Disclaimer

This whitepaper is for informational purposes only and does not constitute financial, legal, or investment advice. XFUEL is experimental software with inherent risks. Users assume all risks. Always do your own research.

---

**Prepared by XFUEL Core Team**  
**Version 2.0 — December 29, 2025**
