# 🚀 CosmWasm Optimization & Deployment Quick Start

This guide provides the fastest path to optimize and deploy your contracts.

## Current Status

**Unoptimized Sizes** (from target/):
- `zk_verifier.wasm`: 228 KB ❌
- `ibc_tfuel_minter.wasm`: 257 KB ❌

**Target**: <150 KB each for mainnet deployment

---

## Quick Commands

### Windows (PowerShell)

```powershell
# Option 1: Try Docker optimizer first
bash scripts/optimize-cosmwasm-debug.sh

# Option 2: If Docker optimizer fails, use manual method
.\scripts\manual-optimize-wasm.ps1

# Deploy
docker-compose run --rm persistence-deployer /app/scripts/docker-deploy-persistence.sh
```

### Linux/macOS/WSL (Bash)

```bash
# Option 1: Try Docker optimizer first
./scripts/optimize-cosmwasm-debug.sh

# Option 2: If Docker optimizer fails, use manual method
./scripts/manual-optimize-wasm.sh

# Deploy
docker-compose run --rm persistence-deployer /app/scripts/docker-deploy-persistence.sh
```

---

## 📝 Before You Start

1. **Check Docker is running**:
   ```bash
   docker --version
   docker info
   ```

2. **Set up environment** (`.env.docker`):
   ```bash
   KEPLR_MNEMONIC="your twelve word mnemonic phrase here..."
   ```

3. **Fund your wallet**:
   - Get address: Run deployment once (it will show your address)
   - Fund with 1+ XPRT from faucet or exchange
   - Mainnet: https://www.mintscan.io/persistence

---

## Step-by-Step Process

### 1️⃣ Optimize Contracts

**Try Docker Optimizer First** (Recommended):
```bash
./scripts/optimize-cosmwasm-debug.sh
```

This will:
- Clear old Docker caches
- Run CosmWasm optimizer in Docker
- Generate optimized WASMs in `artifacts/`
- Create checksums and report

**If optimizer fails**, use manual fallback:
```bash
# Bash
./scripts/manual-optimize-wasm.sh

# PowerShell
.\scripts\manual-optimize-wasm.ps1
```

### 2️⃣ Verify Output

Check that files are created and sized correctly:

```bash
# Bash
ls -lh artifacts/*.wasm

# PowerShell
Get-ChildItem artifacts\*.wasm | Format-Table Name, Length
```

Expected:
- `artifacts/zk_verifier.wasm` (~90-140 KB)
- `artifacts/ibc_tfuel_minter.wasm` (~100-150 KB)

### 3️⃣ Deploy to Persistence

```bash
docker-compose run --rm persistence-deployer /app/scripts/docker-deploy-persistence.sh
```

Monitor for:
- ✅ Wallet imported
- ✅ Balance checked (need 1+ XPRT)
- ✅ ZK Verifier stored (Code ID)
- ✅ Minter stored (Code ID)
- ✅ Both instantiated (Contract addresses)

### 4️⃣ Verify on Explorer

Check your deployment:
- **Explorer**: https://www.mintscan.io/persistence
- Search for your deployer address
- View transactions and contract addresses

---

## 🐛 Troubleshooting

### Error: "Docker not running"
```bash
# Start Docker Desktop
# Then retry optimization
```

### Error: "Contract too large" (code 4)
```bash
# Verify you're using artifacts/, not target/
ls -lh artifacts/zk_verifier.wasm  # Should be <150 KB

# If still too large, check optimization ran:
cat optimizer-debug.log | grep -i error
```

### Error: "Out of gas" (gas 799,120)
This means the script is working correctly now! The updated script uses:
- `--gas 1000000` for code storage
- `--gas 400000` for ZK verifier init
- `--gas 500000` for minter init

### Error: "Insufficient funds"
```bash
# Fund your wallet with XPRT
# Get address from deployment output
# Use Keplr or exchange to send 1+ XPRT
```

### Optimizer timeout/failure
```bash
# Clean everything and retry
rm -rf artifacts/*.wasm
docker volume rm xfuel-protocol_cache registry_cache

# Try manual optimization instead
./scripts/manual-optimize-wasm.sh
```

---

## 📋 Files Generated

After optimization:
```
artifacts/
├── zk_verifier.wasm          # Optimized ZK verifier
├── ibc_tfuel_minter.wasm     # Optimized minter
└── checksums.txt             # SHA256 checksums

optimizer-debug.log           # Detailed logs (if using debug script)
optimization-report.txt       # Summary report (if using debug script)
```

After deployment:
```
.env                         # Updated with contract addresses
```

Look for these in `.env`:
```bash
PERSISTENCE_DEPLOYER=persistence1...
ZK_VERIFIER_CODE_ID=123
MINTER_CODE_ID=124
ZK_VERIFIER_ADDRESS=persistence1...
IBCTFUEL_MINTER_ADDRESS=persistence1...
```

---

## 🧪 Testing

### Test mint function:
```bash
docker-compose --profile test up test-persistence-mint
```

### Test pause/unpause:
```bash
# Pause
persistenceCore tx wasm execute $IBCTFUEL_MINTER_ADDRESS \
  '{"pause":{}}' \
  --from deployer --keyring-backend test \
  --gas 150000 --gas-prices 0.025uxprt \
  --chain-id core-1 --node https://rpc.core.persistence.one:443 --yes

# Check status
persistenceCore query wasm contract-state smart $IBCTFUEL_MINTER_ADDRESS \
  '{"is_paused":{}}' \
  --node https://rpc.core.persistence.one:443
```

---

## 📚 Full Documentation

For detailed troubleshooting and explanations, see:
- **Full Guide**: `COSMWASM_OPTIMIZATION_DEBUG_GUIDE.md`
- **Contract Docs**: `cosmwasm/README.md`

---

## ⚡ One-Liner (Advanced)

If you've done this before and just want to run everything:

```bash
# Clean, optimize, deploy (choose Docker or manual)
rm -rf artifacts/*.wasm && \
./scripts/optimize-cosmwasm-debug.sh && \
docker-compose run --rm persistence-deployer /app/scripts/docker-deploy-persistence.sh

# OR with manual optimization
rm -rf artifacts/*.wasm && \
./scripts/manual-optimize-wasm.sh && \
docker-compose run --rm persistence-deployer /app/scripts/docker-deploy-persistence.sh
```

---

## 🎯 Success Checklist

- [ ] Docker running
- [ ] Contracts built (in `target/`)
- [ ] Contracts optimized (<150 KB in `artifacts/`)
- [ ] Checksums generated
- [ ] .env.docker has KEPLR_MNEMONIC
- [ ] Wallet funded with 1+ XPRT
- [ ] Deployment successful (addresses in .env)
- [ ] Verified on Mintscan explorer
- [ ] Mint function tested

---

**Ready?** Start with Step 1️⃣ above! 🚀

