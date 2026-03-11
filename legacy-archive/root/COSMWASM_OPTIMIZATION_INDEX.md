# 📖 CosmWasm Optimization & Deployment - Documentation Index

**Problem Solved**: CosmWasm contracts too large (223KB+) for Persistence mainnet deployment  
**Solution Delivered**: Complete optimization pipeline with debugging, testing, and deployment tools  
**Status**: ✅ Ready for production deployment

---

## 🚀 Quick Start (Pick Your Path)

### For First-Time Users
👉 **Start here**: [COSMWASM_OPTIMIZATION_QUICKSTART.md](COSMWASM_OPTIMIZATION_QUICKSTART.md)
- Fast-track instructions
- Copy-paste commands
- Basic troubleshooting

### For Developers Debugging Issues
👉 **Start here**: [COSMWASM_OPTIMIZATION_DEBUG_GUIDE.md](COSMWASM_OPTIMIZATION_DEBUG_GUIDE.md)
- Complete debugging guide (60+ pages)
- All troubleshooting scenarios
- Manual optimization methods
- Security checklist

### For Quick Reference
👉 **Start here**: [COSMWASM_OPTIMIZATION_QUICKREF.md](COSMWASM_OPTIMIZATION_QUICKREF.md)
- One-page reference card
- Quick commands
- Common errors and fixes
- Emergency commands

---

## 📚 Complete Documentation

### 1. **Visual Workflow** 🔄
📊 [COSMWASM_OPTIMIZATION_WORKFLOW.md](COSMWASM_OPTIMIZATION_WORKFLOW.md)
```
├─ Complete deployment flowchart
├─ Step-by-step visualization
├─ Troubleshooting decision tree
└─ One-liner commands
```

### 2. **Quick Start Guide** ⚡
📗 [COSMWASM_OPTIMIZATION_QUICKSTART.md](COSMWASM_OPTIMIZATION_QUICKSTART.md)
```
├─ 5-minute quick start
├─ Essential commands only
├─ Success checklist
└─ Basic troubleshooting
```

### 3. **Debug & Troubleshooting Guide** 🔧
📘 [COSMWASM_OPTIMIZATION_DEBUG_GUIDE.md](COSMWASM_OPTIMIZATION_DEBUG_GUIDE.md)
```
├─ STEP 1: Debug CosmWasm Optimizer
├─ STEP 2: Manual Optimization (Fallback)
├─ STEP 3: Verify Optimized Files
├─ STEP 4: Deploy to Persistence Mainnet
├─ STEP 5: Post-Deployment Testing
├─ Troubleshooting (Common Issues)
└─ Security Checklist
```

### 4. **Complete Summary** 📋
📙 [COSMWASM_OPTIMIZATION_SUMMARY.md](COSMWASM_OPTIMIZATION_SUMMARY.md)
```
├─ What was done
├─ Files created/modified
├─ Technical details
├─ Command reference
├─ Success criteria
└─ Additional resources
```

### 5. **Quick Reference Card** 📕
📕 [COSMWASM_OPTIMIZATION_QUICKREF.md](COSMWASM_OPTIMIZATION_QUICKREF.md)
```
├─ Quick fix commands
├─ Common errors table
├─ Pre-deployment checklist
├─ Emergency commands
└─ One-page reference
```

### 6. **This Index** 📖
📖 [COSMWASM_OPTIMIZATION_INDEX.md](COSMWASM_OPTIMIZATION_INDEX.md) (YOU ARE HERE)
```
├─ Documentation map
├─ Script reference
├─ File structure
└─ Quick navigation
```

---

## 🛠️ Scripts & Tools

### Optimization Scripts

#### Primary Method: Docker Optimizer
```bash
scripts/optimize-cosmwasm-debug.sh
```
- Clears Docker cache automatically
- Runs CosmWasm optimizer (cosmwasm/optimizer:0.16.0)
- Generates detailed logs (`optimizer-debug.log`)
- Creates optimization report (`optimization-report.txt`)
- Validates output sizes

#### Standard Optimizer
```bash
scripts/optimize-cosmwasm.sh
```
- Original optimizer script
- Faster, less verbose
- Good for repeated runs

#### Manual Fallback Methods
```bash
# Bash/Linux/macOS/WSL
scripts/manual-optimize-wasm.sh

# Windows PowerShell
scripts/manual-optimize-wasm.ps1
```
- Uses wasm-opt directly (via Docker or local)
- Fallback when CosmWasm optimizer fails
- Applies all optimization flags
- Works on all platforms

### Testing Scripts

#### Comprehensive WASM Testing
```bash
scripts/test-optimized-wasm.sh
```
- Tests file existence and sizes
- Validates WASM structure
- Checks optimization ratios
- Verifies checksums
- Runs Cargo tests

#### Contract Build
```bash
scripts/build-cosmwasm-contracts.sh
```
- Builds both contracts
- Runs tests
- Generates unoptimized WASMs

### Deployment Scripts

#### Persistence Mainnet Deployment
```bash
scripts/docker-deploy-persistence.sh
```
- **UPDATED**: Uses optimized artifacts/
- **UPDATED**: Explicit gas limits (no --gas auto)
- Validates files before deployment
- Stores code on-chain
- Instantiates contracts
- Saves configuration to .env

---

## 📁 File Structure

### Generated Artifacts
```
artifacts/
├── zk_verifier.wasm          # Optimized ZK verifier (~120 KB)
├── ibc_tfuel_minter.wasm     # Optimized minter (~140 KB)
└── checksums.txt             # SHA256 checksums
```

### Build Output (Unoptimized)
```
target/wasm32-unknown-unknown/release/
├── zk_verifier.wasm          # Unoptimized (~228 KB)
└── ibc_tfuel_minter.wasm     # Unoptimized (~257 KB)
```

### Logs & Reports
```
optimizer-debug.log           # Detailed optimizer logs
optimization-report.txt       # Optimization summary report
```

### Source Contracts
```
cosmwasm/
├── zk-verifier/
│   ├── Cargo.toml           # Already optimized profile
│   └── src/
│       ├── contract.rs      # Main contract logic
│       ├── msg.rs           # Messages
│       └── state.rs         # State management
└── ibc-tfuel-minter/
    ├── Cargo.toml           # Already optimized profile
    └── src/
        ├── contract.rs      # CW20 minter with pause/cap
        ├── msg.rs           # Messages
        └── state.rs         # State management
```

### Documentation
```
COSMWASM_OPTIMIZATION_DEBUG_GUIDE.md      # Full guide (60+ pages)
COSMWASM_OPTIMIZATION_QUICKSTART.md       # Quick start guide
COSMWASM_OPTIMIZATION_SUMMARY.md          # Complete summary
COSMWASM_OPTIMIZATION_QUICKREF.md         # One-page reference
COSMWASM_OPTIMIZATION_WORKFLOW.md         # Visual workflow
COSMWASM_OPTIMIZATION_INDEX.md            # This file
```

---

## 🎯 Common Use Cases

### First-Time Deployment
1. Read: [COSMWASM_OPTIMIZATION_QUICKSTART.md](COSMWASM_OPTIMIZATION_QUICKSTART.md)
2. Run: `./scripts/optimize-cosmwasm-debug.sh`
3. Test: `./scripts/test-optimized-wasm.sh`
4. Deploy: `docker-compose run --rm persistence-deployer /app/scripts/docker-deploy-persistence.sh`

### Docker Optimizer Failing
1. Read: [COSMWASM_OPTIMIZATION_DEBUG_GUIDE.md](COSMWASM_OPTIMIZATION_DEBUG_GUIDE.md) → STEP 2
2. Run: `./scripts/manual-optimize-wasm.sh` (or `.ps1` for Windows)
3. Test: `./scripts/test-optimized-wasm.sh`
4. Deploy: (same as above)

### Deployment Error "Contract Too Large"
1. Read: [COSMWASM_OPTIMIZATION_QUICKREF.md](COSMWASM_OPTIMIZATION_QUICKREF.md) → Common Errors
2. Verify: `ls -lh artifacts/*.wasm` (should be <150 KB)
3. If missing: Run optimization again
4. If too large: Check optimization ran correctly

### Need Quick Command
1. Read: [COSMWASM_OPTIMIZATION_QUICKREF.md](COSMWASM_OPTIMIZATION_QUICKREF.md)
2. Copy-paste one-liner from "Quick Fix" section

### Understanding the Full Process
1. Read: [COSMWASM_OPTIMIZATION_WORKFLOW.md](COSMWASM_OPTIMIZATION_WORKFLOW.md)
2. Follow visual flowchart
3. See all steps and decision points

---

## 🔍 What Each Document Contains

| Document | Length | When to Use | Contains |
|----------|--------|-------------|----------|
| **WORKFLOW.md** | 4 pages | Visual learners | Flowcharts, diagrams, visual workflow |
| **QUICKSTART.md** | 8 pages | First-time users | Fast-track commands, basic steps |
| **DEBUG_GUIDE.md** | 60+ pages | Issues/debugging | Complete troubleshooting, all methods |
| **SUMMARY.md** | 25 pages | Overview/reference | What was done, technical details |
| **QUICKREF.md** | 2 pages | Quick lookup | One-page commands, error table |
| **INDEX.md** | 5 pages | Navigation | Documentation map, file structure |

---

## 💡 Key Concepts

### Why Optimization is Needed
- **Unoptimized**: 223-257 KB (too large for mainnet)
- **Optimized**: 90-150 KB (acceptable for mainnet)
- **Reduction**: 40-50% size decrease
- **Methods**: CosmWasm Docker optimizer OR manual wasm-opt

### What Changed in Deployment Script
- ❌ **Old**: Used `target/wasm32-unknown-unknown/release/*.wasm` (unoptimized)
- ✅ **New**: Uses `artifacts/*.wasm` (optimized)
- ❌ **Old**: Used `--gas auto` (insufficient for large files)
- ✅ **New**: Uses explicit gas limits (1M for store, 400-500K for instantiate)

### Optimization Techniques Applied
1. **Rust Profile**: `opt-level=3`, `lto=true`, `codegen-units=1`
2. **wasm-opt Flags**: `-Oz`, `--signext-lowering`, `--strip-debug`, `--strip-producers`
3. **Result**: Maximum size reduction while maintaining functionality

---

## 🚦 Decision Tree: Which Document to Read?

```
START: I need to...

├─ Deploy for the first time
│  └─► COSMWASM_OPTIMIZATION_QUICKSTART.md
│
├─ Debug an error or issue
│  └─► COSMWASM_OPTIMIZATION_DEBUG_GUIDE.md
│
├─ Understand the full process
│  └─► COSMWASM_OPTIMIZATION_WORKFLOW.md
│
├─ Look up a specific command
│  └─► COSMWASM_OPTIMIZATION_QUICKREF.md
│
├─ See what was done / technical overview
│  └─► COSMWASM_OPTIMIZATION_SUMMARY.md
│
└─ Find the right documentation
   └─► COSMWASM_OPTIMIZATION_INDEX.md (YOU ARE HERE!)
```

---

## ✅ Pre-Flight Checklist

Before you start deployment, verify:

- [ ] **Docker**: Running and accessible (`docker info`)
- [ ] **Contracts**: Built successfully (`ls target/wasm32-unknown-unknown/release/*.wasm`)
- [ ] **Tests**: All passing (`cd cosmwasm/zk-verifier && cargo test`)
- [ ] **Environment**: `.env.docker` has `KEPLR_MNEMONIC` set
- [ ] **Disk Space**: At least 5GB free
- [ ] **Memory**: Docker allocated 8GB+ RAM

---

## 🎉 Ready to Deploy?

### Recommended First-Time Path

1. **Read** (5 min): [COSMWASM_OPTIMIZATION_QUICKSTART.md](COSMWASM_OPTIMIZATION_QUICKSTART.md)

2. **Run** (10 min):
   ```bash
   ./scripts/optimize-cosmwasm-debug.sh && \
   ./scripts/test-optimized-wasm.sh && \
   docker-compose run --rm persistence-deployer \
     /app/scripts/docker-deploy-persistence.sh
   ```

3. **Verify** (2 min):
   - Check `.env` for contract addresses
   - View on Mintscan: https://www.mintscan.io/persistence

4. **Celebrate** 🎊: You've successfully deployed optimized CosmWasm contracts!

---

## 📞 Need Help?

### Troubleshooting Resources
1. Check [COSMWASM_OPTIMIZATION_QUICKREF.md](COSMWASM_OPTIMIZATION_QUICKREF.md) → Common Errors
2. Read [COSMWASM_OPTIMIZATION_DEBUG_GUIDE.md](COSMWASM_OPTIMIZATION_DEBUG_GUIDE.md) → Troubleshooting section
3. Review logs: `optimizer-debug.log` or `optimization-report.txt`
4. Verify prerequisites: Docker, Rust, wasm32 target, disk space

### External Resources
- CosmWasm Optimizer: https://github.com/CosmWasm/optimizer
- Binaryen (wasm-opt): https://github.com/WebAssembly/binaryen
- Persistence Docs: https://docs.persistence.one/
- Mintscan Explorer: https://www.mintscan.io/persistence

---

**Status**: ✅ Complete solution delivered  
**Documentation**: 6 comprehensive guides created  
**Scripts**: 5 optimization/testing/deployment scripts  
**Next Step**: Choose your path above and deploy! 🚀

---

*Last Updated: January 4, 2026*  
*XFuel Protocol - CosmWasm Contract Optimization*

