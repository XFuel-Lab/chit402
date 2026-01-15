# 🚀 XFuelLab ZK Pivot - One-Page Quick Reference

## ⚡ Quick Push (One Command)

**Linux/Mac**: `bash zk-pivot-push.sh`  
**Windows**: `zk-pivot-push.bat`

---

## 📝 Manual Git Commands

```bash
git branch zk-bridge && git switch zk-bridge
git add .
git commit -m "ZK pivot: Add CosmWasm, whitepaper v3.0, scripts"
git push origin zk-bridge
```

---

## 📦 What's Being Pushed

### New Files:
- `cosmwasm/zk-verifier/` - ZK-SNARK verifier (Rust + .wasm)
- `cosmwasm/ibc-tfuel-minter/` - ibcTFUEL token (Rust + .wasm)
- `scripts/build-cosmwasm-contracts.sh`
- `scripts/optimize-cosmwasm.sh`
- `scripts/deploy-zkbridge.cjs`
- `scripts/test-cosmwasm.sh`

### Updated Files:
- `README.md` - Added ZK bridge section (~150 lines)
- `docs/XFUEL-Hybrid-Tokenomics-Whitepaper-v3.md` - Already complete

---

## 🔗 GitHub PR Template

**Title**:
```
ZK Pivot: CosmWasm Contracts, Whitepaper v3.0 Ferrari Edition, Deployment Infrastructure
```

**Key Points** (full description in `PR_GUIDE.md`):
- 🆕 ZK verifier + IBC TFUEL minter (CosmWasm)
- 📄 Whitepaper v3.0 with Ferrari hybrid (30/30/25/15)
- 🔧 Deployment scripts (build, optimize, deploy, test)
- 📝 README with live addresses (VaultFactory: 0xB0a266...)
- ⚠️ Pre-audit disclaimer (beta status)

---

## 🏗️ ZK Bridge Architecture (Summary)

```
Theta Deposit (2-6s)
  ↓
ZK Proof Generation (1.5s)
  ↓
Persistence Verification (0.5s)
  ↓
IBC Transfer (0.5s)
  ↓
LST Swap + Stake (1s)
  
Total: < 4 seconds
```

---

## 🔐 Live Addresses

**Theta Mainnet**:
- VaultFactory: `0xB0a266...`

**Persistence Mainnet**:
- ZKVerifier: `persistence1...`
- ibcTFUEL: `persistence1...`
- IBC: `channel-190`

---

## ⚠️ Pre-Audit Status

**Beta Launch** - Full CertiK audit post-traction  
Use at your own risk

---

## ✅ Quick Checklist

- [ ] Run push script or manual commands
- [ ] Verify branch `zk-bridge` on GitHub
- [ ] Create PR with title/description from `PR_GUIDE.md`
- [ ] Add labels: `enhancement`, `documentation`, `ZK-bridge`
- [ ] Request team review
- [ ] Wait for CI/CD to pass
- [ ] Merge to `main` after approval

---

## 📚 Full Documentation

- **Detailed Guide**: `GIT_WORKFLOW_QUICK_REF.md`
- **PR Template**: `PR_GUIDE.md`
- **Complete Summary**: `ZK_PIVOT_DEPLOYMENT_SUMMARY.md`
- **README Section**: `README_ZK_BRIDGE_SECTION.md`

---

**Questions?** Check the full guides or ask in team chat!

