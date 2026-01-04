# XFuelLab ZK Pivot - Git Workflow Quick Reference

## 🎯 Purpose
Push all ZK bridge pivot changes to GitHub in a new `zk-bridge` branch, including:
- CosmWasm contracts (ZK verifier + IBC TFUEL minter)
- Whitepaper v3.0 with Ferrari hybrid tokenomics
- Deployment/optimization scripts
- Updated README with live contract addresses

---

## ⚡ Quick Start (One Command)

### Linux/Mac:
```bash
bash zk-pivot-push.sh
```

### Windows:
```cmd
zk-pivot-push.bat
```

---

## 📝 Manual Workflow (Step-by-Step)

### 1. Create and Switch to New Branch
```bash
git branch zk-bridge
git switch zk-bridge
```

### 2. Stage All Changes
```bash
git add .
```

### 3. Commit with Detailed Message
```bash
git commit -m "ZK pivot: Add CosmWasm contracts, whitepaper v3.0, deployment scripts

- Added ZK-SNARK verifier CosmWasm contract (cosmwasm/zk-verifier)
- Added IBC TFUEL minter CosmWasm contract (cosmwasm/ibc-tfuel-minter)
- Added compiled .wasm binaries for Persistence deployment
- Updated WHITEPAPER v3.0 with Ferrari hybrid tokenomics & ZK-SNARKs
- Added deployment/optimization scripts (scripts/)
- Updated README.md with ZK bridge architecture and live contract addresses
- Added VaultFactory deployment summary (0xB0a266...)
- Noted pre-audit status in documentation

Technical details:
- ZK proof verification in ~50ms constant time
- Sub-4s settlement: deposit (2s) + proof (1.5s) + verify (0.5s)
- IBC channel-190 integration for ibcTFUEL minting
- Hybrid revenue splits: 30% BBB, 30% LP, 25% veXF yields, 15% treasury
- Governance extras: quarterly opt-in votes with rXF bonuses

Pre-audit note: Minimal beta launch; full CertiK audit post-traction."
```

### 4. Push to Remote
```bash
git push origin zk-bridge
```

---

## 🔗 Create GitHub Pull Request

### PR Title:
```
ZK Pivot: CosmWasm Contracts, Whitepaper v3.0 Ferrari Edition, Deployment Infrastructure
```

### PR Description:
Use the content from `PR_GUIDE.md` (full template provided)

### Key Highlights for PR:
- 🆕 **CosmWasm Contracts**: ZK verifier + IBC TFUEL minter with .wasm binaries
- 📄 **Whitepaper v3.0**: Ferrari hybrid tokenomics (30/30/25/15 splits)
- 🔧 **Scripts**: Build, optimize, deploy, test
- 📝 **README**: ZK bridge section with live addresses
- ⚠️ **Pre-Audit**: Beta status clearly noted

---

## 📦 What's Included in This Push

### New Files:
```
cosmwasm/
├── zk-verifier/
│   ├── src/
│   │   ├── contract.rs      # Main contract logic
│   │   ├── msg.rs           # Message definitions
│   │   ├── state.rs         # State management
│   │   └── error.rs         # Error handling
│   ├── Cargo.toml
│   └── target/release/*.wasm
│
└── ibc-tfuel-minter/
    ├── src/
    │   ├── contract.rs
    │   ├── msg.rs
    │   ├── state.rs
    │   └── error.rs
    ├── Cargo.toml
    └── target/release/*.wasm

scripts/
├── build-cosmwasm-contracts.sh
├── optimize-cosmwasm.sh
├── deploy-zkbridge.cjs
└── test-cosmwasm.sh
```

### Updated Files:
```
README.md                                      # Added ZK bridge section
docs/XFUEL-Hybrid-Tokenomics-Whitepaper-v3.md # Already exists (full v3.0)
```

---

## 🧪 Verification Checklist

Before pushing:
- [ ] All CosmWasm contracts compile: `cargo build --release`
- [ ] WASM files exist in `target/release/`
- [ ] Scripts are executable: `chmod +x scripts/*.sh`
- [ ] README.md renders correctly
- [ ] Whitepaper v3.0 has Ferrari content
- [ ] Pre-audit disclaimer is prominent

After pushing:
- [ ] GitHub shows new `zk-bridge` branch
- [ ] All files uploaded successfully
- [ ] PR template ready in `PR_GUIDE.md`
- [ ] No merge conflicts with `main`

---

## 🚨 Troubleshooting

### Issue: Branch already exists
```bash
# Delete local branch
git branch -D zk-bridge

# Delete remote branch (if needed)
git push origin --delete zk-bridge

# Start fresh
bash zk-pivot-push.sh
```

### Issue: Merge conflicts
```bash
# Update from main first
git fetch origin
git merge origin/main

# Resolve conflicts, then
git add .
git commit -m "Merge main into zk-bridge"
git push origin zk-bridge
```

### Issue: Large .wasm files
```bash
# Check file sizes
find cosmwasm -name "*.wasm" -exec ls -lh {} \;

# If > 100MB, use Git LFS
git lfs track "*.wasm"
git add .gitattributes
```

---

## 📋 Post-Push Checklist

1. **GitHub PR**:
   - [ ] Created from `zk-bridge` to `main`
   - [ ] Used title/description from `PR_GUIDE.md`
   - [ ] Added labels: `enhancement`, `documentation`, `ZK-bridge`

2. **Documentation**:
   - [ ] README.md ZK bridge section renders correctly
   - [ ] All whitepaper links work
   - [ ] Contract addresses are visible

3. **Testing**:
   - [ ] CosmWasm contracts compile on CI
   - [ ] Deployment scripts have correct paths
   - [ ] No linting errors

4. **Communication**:
   - [ ] Team notified in Discord/Slack
   - [ ] Beta testers invited to review
   - [ ] Community announcement drafted

---

## 🎯 Success Criteria

✅ **You're done when:**
- New `zk-bridge` branch exists on GitHub
- PR is created with full description
- All files pushed successfully
- CI/CD passes (if configured)
- Team is ready to review

---

## 📚 Reference Files

- `zk-pivot-push.sh` - Bash script (Linux/Mac)
- `zk-pivot-push.bat` - Batch script (Windows)
- `PR_GUIDE.md` - Full PR template with description
- `README_ZK_BRIDGE_SECTION.md` - README content reference
- `docs/XFUEL-Hybrid-Tokenomics-Whitepaper-v3.md` - Whitepaper v3.0

---

## 💡 Tips for First-Time Devs

1. **Before Pushing**:
   - Run `git status` to see what will be committed
   - Use `git diff` to review changes
   - Test scripts locally first

2. **Commit Message**:
   - First line: Short summary (< 72 chars)
   - Body: Bullet points with details
   - Footer: Pre-audit disclaimer

3. **Branch Naming**:
   - Use kebab-case: `zk-bridge` not `ZK_Bridge`
   - Be descriptive but concise

4. **PR Best Practices**:
   - Use checkboxes `- [ ]` for review items
   - Link related issues
   - Add screenshots if UI changes
   - Request specific reviewers

---

**Need help?** Check [GitHub docs](https://docs.github.com/en/pull-requests) or ask in team chat.

