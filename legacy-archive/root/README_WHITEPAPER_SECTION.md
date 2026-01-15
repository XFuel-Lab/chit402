# README.md Update - Add Whitepaper Section

Add this section after the "ZK Bridge Architecture" section in README.md (around line 200):

---

## 📄 Latest Whitepaper v3.0

**XFUEL Protocol: Ferrari Hybrid Tokenomics Edition**

Read the complete technical whitepaper: **[docs/WHITEPAPER.md](docs/WHITEPAPER.md)**

### What's Inside

**Ferrari Hybrid Tokenomics**
- **30/70 Recycle Loop**: 30% of veXF yields reverse-burn back to RevenueSplitter, 70% reinvested in LP for sustainability
- **30/30/25/15 Revenue Splits**: 
  - 30% BBB (Buyback-Burn-Boost) - Deflationary pressure
  - 30% LP Funding - Governance-voted liquidity provisioning
  - 25% veXF Yields - Direct returns to locked token holders (USDC stable + TFUEL options)
  - 15% Treasury - Innovation experiments, audits, strategic partnerships

**veXF Governance Extras**
- **Quarterly Opt-In Votes**: 5-10% of LP revenue for community initiatives
- **rXF Bonuses**: 0.5-2x multipliers for active voters
- **NFT Rewards**: Exclusive governance NFTs for participation milestones
- **Airdrop Pools**: Community incentive programs

**ZK-SNARK Bridge**
- Sub-4 second settlement (deposit 2-6s → proof 1.5s → verify 0.5s → IBC 0.5s → swap 1s)
- Groth16 proof system with BN254 elliptic curve
- Cryptographic security without trust assumptions
- IBC channel-190 for native Cosmos interoperability

### Live Contract Addresses

**Theta Mainnet** (Chain ID: 361)
```
VaultFactory:      0xB0a266...  (Main deposit contract)
XFUELRouter:       (see config)
RevenueSplitter:   (30/30/25/15 distribution)
TreasuryBackstop:  (IL insurance)
```

**Persistence Mainnet** (core-1)
```
ZKVerifier:        persistence1...  (ZK proof verification)
ibcTFUEL:          persistence1...  (CW20 token)
IBC Channel:       channel-190
```

### Pre-Audit Status

⚠️ **IMPORTANT**: Current deployment is a **minimal beta launch** for traction validation.

- Smart contracts deployed for testing and community feedback
- Use at your own risk during beta phase
- **Full CertiK audit scheduled post-traction milestone**
- Security measures in place: ZK proofs, non-custodial, IBC protocol, access controls

**We welcome security researchers!** Report vulnerabilities to security@xfuel.app

### Technical Documentation

**Core Whitepapers**:
- **Main Whitepaper v3.0**: [docs/WHITEPAPER.md](docs/WHITEPAPER.md) - Complete Ferrari hybrid tokenomics
- **ZK Bridge Technical**: [docs/whitepaper/XFUEL-ZK-Bridge-Whitepaper.md](docs/whitepaper/XFUEL-ZK-Bridge-Whitepaper.md) - Deep dive on cryptography

**Quick References**:
- [docs/XFUEL-FERRARI-QUICK-REF.md](docs/XFUEL-FERRARI-QUICK-REF.md) - One-page Ferrari summary
- [ZK_BRIDGE_QUICK_REFERENCE.md](ZK_BRIDGE_QUICK_REFERENCE.md) - Quick start guide
- [ZK_BRIDGE_DELIVERY_SUMMARY.md](ZK_BRIDGE_DELIVERY_SUMMARY.md) - Implementation overview

### Community & Updates

- **Discord**: [XFuelLab Server] - Join for early access and community testing
- **Twitter**: [@xfuel_protocol] - Follow for launch updates
- **Medium**: [xfuel.medium.com] - Deep dives and analysis
- **GitHub**: [github.com/XFuel-Lab/xfuel-protocol] - Contribute!

---

