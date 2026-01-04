# 🚀 CosmWasm Optimization & Deployment - Quick Reference Card

## Current Problem
- **zk_verifier.wasm**: 228 KB ❌ (Too large)
- **ibc_tfuel_minter.wasm**: 257 KB ❌ (Too large)
- **Target**: <150 KB each ✅

## Quick Fix (Choose One Method)

### Method 1: Docker Optimizer (Recommended)
```bash
# Clean, optimize, test, deploy
./scripts/optimize-cosmwasm-debug.sh && \
./scripts/test-optimized-wasm.sh && \
docker-compose run --rm persistence-deployer /app/scripts/docker-deploy-persistence.sh
```

### Method 2: Manual Optimization (Fallback)
```bash
# Bash/Linux/macOS
./scripts/manual-optimize-wasm.sh && \
./scripts/test-optimized-wasm.sh && \
docker-compose run --rm persistence-deployer /app/scripts/docker-deploy-persistence.sh
```

```powershell
# Windows PowerShell
.\scripts\manual-optimize-wasm.ps1
.\scripts\test-optimized-wasm.sh
docker-compose run --rm persistence-deployer /app/scripts/docker-deploy-persistence.sh
```

## Verify Success

### Check Optimized Sizes
```bash
ls -lh artifacts/*.wasm
# Should show ~90-150 KB for each file
```

### Check Deployment
```bash
# Look for these in .env after deployment
grep "VERIFIER_ADDRESS\|MINTER_ADDRESS" .env

# Verify on explorer
echo "https://www.mintscan.io/persistence/account/$ZK_VERIFIER_ADDRESS"
```

## Common Errors

| Error | Fix |
|-------|-----|
| "Docker not running" | Start Docker Desktop |
| "Contract too large" (code 4) | Run optimization scripts above |
| "Insufficient funds" | Fund wallet with 1+ XPRT |
| "Permission denied" | Run as Administrator (Windows) |
| Optimizer timeout | Use manual method instead |

## Files Created
- ✅ `artifacts/zk_verifier.wasm` (~120 KB)
- ✅ `artifacts/ibc_tfuel_minter.wasm` (~140 KB)
- ✅ `artifacts/checksums.txt`

## Expected Output
```
✅ ZK Verifier Code ID: 123
✅ Minter Code ID: 124
✅ ZK Verifier: persistence1xyz...
✅ ibcTFUEL Minter: persistence1abc...
```

## Documentation
- **Full Guide**: `COSMWASM_OPTIMIZATION_DEBUG_GUIDE.md` (comprehensive, 60+ pages)
- **Quick Start**: `COSMWASM_OPTIMIZATION_QUICKSTART.md` (step-by-step)
- **Summary**: `COSMWASM_OPTIMIZATION_SUMMARY.md` (overview)
- **This Card**: `COSMWASM_OPTIMIZATION_QUICKREF.md` (one-page reference)

## Pre-Deployment Checklist
- [ ] Docker running: `docker info`
- [ ] Contracts built: `ls target/wasm32-unknown-unknown/release/*.wasm`
- [ ] Contracts optimized: `ls artifacts/*.wasm` (<150 KB each)
- [ ] Tests passing: `./scripts/test-optimized-wasm.sh`
- [ ] Environment set: `.env.docker` has `KEPLR_MNEMONIC`
- [ ] Wallet funded: 1+ XPRT on Persistence mainnet

## Emergency Commands

### Start Over
```bash
# Clean everything
rm -rf artifacts/*.wasm
docker volume rm xfuel-protocol_cache registry_cache 2>/dev/null || true

# Rebuild
./scripts/build-cosmwasm-contracts.sh
./scripts/optimize-cosmwasm-debug.sh
```

### Check Status
```bash
# Size check
du -h artifacts/*.wasm target/wasm32-unknown-unknown/release/*.wasm

# Docker check
docker --version && docker info

# Wallet check
docker-compose run --rm persistence-deployer \
  persistenceCore keys list --keyring-backend test
```

## Need Help?
1. Check logs: `optimizer-debug.log`
2. Read troubleshooting: `COSMWASM_OPTIMIZATION_DEBUG_GUIDE.md` (Section 🐛)
3. Verify prerequisites: Docker 20+, 8GB+ RAM, 5GB+ disk space

---

**Ready to deploy?** Run Method 1 or Method 2 above! 🚀

