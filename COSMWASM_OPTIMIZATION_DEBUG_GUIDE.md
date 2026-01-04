# 🔧 CosmWasm Contract Optimization & Deployment Debug Guide

**Problem**: Contracts too large for mainnet (223KB+ unoptimized) - Need <150KB for production  
**Status**: Tests 100% passing ✅ | Build OK ✅ | Optimizer failing ⚠️  
**Target**: Optimize to <150KB and deploy to Persistence mainnet

---

## 📊 Current State

### Contract Sizes (Unoptimized)
- **zk_verifier.wasm**: 228,157 bytes (~223 KB) ❌
- **ibc_tfuel_minter.wasm**: 263,166 bytes (~257 KB) ❌

### Target Sizes (Optimized)
- **zk_verifier.wasm**: <150 KB ✅
- **ibc_tfuel_minter.wasm**: <150 KB ✅

### Deployment Error
```
Error: code 4, gas 799,120 - Contract too large or gas exceeded
```

---

## 🔍 STEP 1: Debug CosmWasm Optimizer (Docker)

The CosmWasm optimizer Docker image may be failing due to cache issues, Rust version mismatches (2026 = Rust 1.74+), or volume mount problems.

### Option A: Clean Cache and Rerun

```bash
# 1. Remove old Docker volumes (cache)
docker volume ls | grep cache
docker volume rm xfuel-protocol_cache
docker volume rm registry_cache

# 2. Clean artifacts
rm -rf artifacts/*.wasm
mkdir -p artifacts

# 3. Rerun optimizer with verbose logs
docker run --rm -v "$(pwd)":/code \
  --mount type=volume,source="$(basename "$(pwd)")_cache",target=/target \
  --mount type=volume,source=registry_cache,target=/usr/local/cargo/registry \
  cosmwasm/optimizer:0.16.0 2>&1 | tee optimizer-debug.log

# 4. Check for errors
cat optimizer-debug.log | grep -i "error\|fail\|panic"
```

**Windows PowerShell Alternative:**
```powershell
# Clean cache volumes
docker volume ls | Select-String cache
docker volume rm xfuel-protocol_cache
docker volume rm registry_cache

# Run optimizer
docker run --rm -v "${PWD}:/code" `
  --mount type=volume,source="xfuel-protocol_cache",target=/target `
  --mount type=volume,source=registry_cache,target=/usr/local/cargo/registry `
  cosmwasm/optimizer:0.16.0
```

### Option B: Use Script with Cache Reset

```bash
# Run the provided debug script
./scripts/optimize-cosmwasm-debug.sh
```

### Common Optimizer Errors & Fixes

| Error | Cause | Fix |
|-------|-------|-----|
| `Rust version mismatch` | Optimizer uses older Rust | Update optimizer: `cosmwasm/optimizer:0.16.1` |
| `Permission denied` | Volume mount issues | Run with `--privileged` flag or check Docker Desktop settings |
| `Dependency conflict` | Cargo.lock mismatch | Delete `cosmwasm/*/Cargo.lock` and rebuild |
| `Out of memory` | Docker memory limit | Increase Docker Desktop memory to 8GB+ |

---

## 🛠️ STEP 2: Manual Optimization (Fallback)

If Docker optimizer fails, use manual `wasm-opt` from Binaryen toolchain.

### Install wasm-opt

#### Option 1: Docker Container (Recommended for Windows)
```bash
# Use emscripten image with wasm-opt pre-installed
docker run -it --rm -v "${PWD}:/app" -w /app emscripten/emsdk:3.1.50 bash

# Inside container:
wasm-opt --version
```

#### Option 2: Local Installation (Linux/WSL)
```bash
# Ubuntu/Debian
sudo apt update
sudo apt install -y binaryen

# Verify
wasm-opt --version
```

#### Option 3: Local Installation (Windows)
```powershell
# Using Scoop
scoop install binaryen

# Or download from: https://github.com/WebAssembly/binaryen/releases
# Extract and add to PATH
```

### Run Manual Optimization

Create the optimization script:

```bash
./scripts/manual-optimize-wasm.sh
```

Or run commands directly:

```bash
# Create output directory
mkdir -p artifacts

# Optimize ZK Verifier
wasm-opt -Oz --signext-lowering \
  target/wasm32-unknown-unknown/release/zk_verifier.wasm \
  -o artifacts/zk_verifier.wasm

# Optimize ibcTFUEL Minter
wasm-opt -Oz --signext-lowering \
  target/wasm32-unknown-unknown/release/ibc_tfuel_minter.wasm \
  -o artifacts/ibc_tfuel_minter.wasm

# Check sizes
ls -lh artifacts/*.wasm
wc -c artifacts/zk_verifier.wasm | awk '{printf "ZK Verifier: %.2f KB\n", $1/1024}'
wc -c artifacts/ibc_tfuel_minter.wasm | awk '{printf "Minter: %.2f KB\n", $1/1024}'
```

**Windows PowerShell:**
```powershell
# Using Docker
docker run --rm -v "${PWD}:/app" -w /app emscripten/emsdk:3.1.50 bash -c @"
wasm-opt -Oz --signext-lowering \
  target/wasm32-unknown-unknown/release/zk_verifier.wasm \
  -o artifacts/zk_verifier.wasm && \
wasm-opt -Oz --signext-lowering \
  target/wasm32-unknown-unknown/release/ibc_tfuel_minter.wasm \
  -o artifacts/ibc_tfuel_minter.wasm
"@

# Check sizes
Get-ChildItem artifacts\*.wasm | Select-Object Name, @{Name="Size_KB";Expression={[math]::Round($_.Length/1KB,2)}}
```

### wasm-opt Optimization Flags

| Flag | Description | Impact |
|------|-------------|--------|
| `-Oz` | Maximum size optimization | Best compression, slower build |
| `-O3` | High optimization | Balanced speed/size |
| `--signext-lowering` | Sign extension lowering | Required for older VMs |
| `--strip-debug` | Remove debug info | Reduces size ~10% |
| `--strip-producers` | Remove producer info | Small size reduction |

**Recommended for mainnet:**
```bash
wasm-opt -Oz --signext-lowering --strip-debug --strip-producers \
  input.wasm -o output.wasm
```

---

## 📦 STEP 3: Verify Optimized Files

### Check File Sizes
```bash
# Bash
ls -lh artifacts/*.wasm
du -h artifacts/*.wasm

# PowerShell
Get-ChildItem artifacts\*.wasm | Format-Table Name, Length, @{Name="KB";Expression={[math]::Round($_.Length/1KB,2)}}
```

### Expected Results
- Each contract should be **<150 KB** (ideal: 100-130 KB)
- Reduction of **40-60%** from unoptimized size

### Validate WASM Structure
```bash
# Check if WASM is valid
wasm-validate artifacts/zk_verifier.wasm
wasm-validate artifacts/ibc_tfuel_minter.wasm

# Or using Docker
docker run --rm -v "${PWD}:/app" -w /app emscripten/emsdk:3.1.50 \
  wasm-validate /app/artifacts/zk_verifier.wasm
```

### Run Tests on Optimized Code
```bash
# The optimized WASM should still pass all tests
cd cosmwasm/zk-verifier
cargo test --release

cd ../ibc-tfuel-minter
cargo test --release
```

---

## 🚀 STEP 4: Deploy to Persistence Mainnet

### Update Deployment Script

The deployment script needs to use **optimized** WASM files from `artifacts/` instead of unoptimized files from `target/`.

Edit `scripts/docker-deploy-persistence.sh`:

```bash
# OLD (Lines 75-83)
ZK_STORE_RESULT=$(persistenceCore tx wasm store /app/target/wasm32-unknown-unknown/release/zk_verifier.wasm \
  --from deployer \
  --gas auto --gas-adjustment 1.5 \
  ...

# NEW (Use optimized files)
ZK_STORE_RESULT=$(persistenceCore tx wasm store /app/artifacts/zk_verifier.wasm \
  --from deployer \
  --gas 1000000 --gas-adjustment 1.5 \
  ...
```

### Run Updated Deployment

```bash
# Using Docker Compose
docker-compose run --rm persistence-deployer /app/scripts/docker-deploy-persistence.sh

# Or direct Docker
docker run --rm -v "${PWD}:/app" \
  -v persistence-data:/root/.persistenceCore \
  --env-file .env.docker \
  persistence-deployer:latest \
  /app/scripts/docker-deploy-persistence.sh
```

### Monitor Deployment

1. **Check transaction status**:
```bash
# Wait for TX confirmation (6-10 seconds)
persistenceCore query tx <TX_HASH> --node https://rpc.core.persistence.one:443
```

2. **Verify code upload**:
```bash
# Check code ID
persistenceCore query wasm list-code --node https://rpc.core.persistence.one:443

# Get code info
persistenceCore query wasm code <CODE_ID> --node https://rpc.core.persistence.one:443
```

3. **Check on explorer**:
- Mintscan: https://www.mintscan.io/persistence/tx/<TX_HASH>
- Code ID: https://www.mintscan.io/persistence/wasm/code/<CODE_ID>

### Gas Estimation

| Operation | Estimated Gas | Cost (0.025 uxprt/gas) |
|-----------|---------------|------------------------|
| Store Code (150KB) | ~800,000 | 0.02 XPRT |
| Instantiate ZK | ~200,000 | 0.005 XPRT |
| Instantiate Minter | ~250,000 | 0.006 XPRT |
| **Total** | ~1,250,000 | **0.031 XPRT** |

**Recommended wallet balance**: 1+ XPRT (~$0.10-0.20)

---

## 🧪 STEP 5: Post-Deployment Testing

### Test Contract Instantiation
```bash
# Query contract info
persistenceCore query wasm contract <CONTRACT_ADDRESS> \
  --node https://rpc.core.persistence.one:443

# Query contract state
persistenceCore query wasm contract-state smart <CONTRACT_ADDRESS> \
  '{"get_config":{}}' \
  --node https://rpc.core.persistence.one:443
```

### Test Mint Function (0.1 TFUEL cap)
```bash
# Mint test (via ZK proof)
persistenceCore tx wasm execute <MINTER_ADDRESS> \
  '{"mint":{"recipient":"<ADDR>","amount":"100000000000000000","proof":"<PROOF>"}}' \
  --from deployer \
  --gas 300000 \
  --gas-prices 0.025uxprt \
  --chain-id core-1 \
  --node https://rpc.core.persistence.one:443 \
  --keyring-backend test \
  --yes
```

### Test Pause/Unpause (Admin only)
```bash
# Pause minting
persistenceCore tx wasm execute <MINTER_ADDRESS> \
  '{"pause":{}}' \
  --from deployer \
  --gas 150000 \
  --gas-prices 0.025uxprt \
  --chain-id core-1 \
  --node https://rpc.core.persistence.one:443 \
  --keyring-backend test \
  --yes

# Verify paused state
persistenceCore query wasm contract-state smart <MINTER_ADDRESS> \
  '{"is_paused":{}}' \
  --node https://rpc.core.persistence.one:443
```

---

## 🐛 Troubleshooting Common Issues

### Issue 1: "Code too large" error (code 4)
**Solution**: Ensure using **optimized** WASM from `artifacts/`, not `target/`
```bash
# Check file being uploaded
ls -lh artifacts/zk_verifier.wasm  # Should be <150KB
```

### Issue 2: Gas exceeded (799,120 limit)
**Solution**: Increase gas limit and adjustment
```bash
--gas 1500000 --gas-adjustment 1.8
```

### Issue 3: "out of gas" during instantiation
**Solution**: Use higher gas for complex instantiation
```bash
--gas 500000  # For ZK verifier init
--gas 600000  # For Minter init (has CW20 setup)
```

### Issue 4: Docker optimizer timeout
**Solution**: Increase Docker timeout or use manual optimization
```bash
# Add timeout to docker run
docker run --rm --stop-timeout 600 ...
```

### Issue 5: Permission denied (Windows Docker)
**Solution**: Run PowerShell as Administrator or enable WSL2 backend
```powershell
# Check Docker backend
docker version | Select-String "OS/Arch"

# Should show: linux/amd64 (WSL2) not windows/amd64
```

---

## 📋 Quick Reference Commands

### Check Current Sizes
```bash
# Unoptimized
ls -lh target/wasm32-unknown-unknown/release/*.wasm

# Optimized
ls -lh artifacts/*.wasm
```

### Full Optimization Pipeline (Bash)
```bash
# 1. Clean
rm -rf artifacts/*.wasm
docker volume rm xfuel-protocol_cache registry_cache 2>/dev/null || true

# 2. Build
./scripts/build-cosmwasm-contracts.sh

# 3. Optimize (Docker method)
./scripts/optimize-cosmwasm.sh

# OR Manual method
./scripts/manual-optimize-wasm.sh

# 4. Verify
ls -lh artifacts/*.wasm

# 5. Deploy
docker-compose run --rm persistence-deployer /app/scripts/docker-deploy-persistence.sh
```

### Full Pipeline (PowerShell)
```powershell
# 1. Clean
Remove-Item artifacts\*.wasm -ErrorAction SilentlyContinue
docker volume rm xfuel-protocol_cache registry_cache

# 2. Build (using Git Bash or WSL)
bash scripts/build-cosmwasm-contracts.sh

# 3. Optimize
docker run --rm -v "${PWD}:/app" -w /app emscripten/emsdk:3.1.50 bash -c "
  wasm-opt -Oz --signext-lowering target/wasm32-unknown-unknown/release/zk_verifier.wasm -o artifacts/zk_verifier.wasm &&
  wasm-opt -Oz --signext-lowering target/wasm32-unknown-unknown/release/ibc_tfuel_minter.wasm -o artifacts/ibc_tfuel_minter.wasm
"

# 4. Verify
Get-ChildItem artifacts\*.wasm

# 5. Deploy
docker-compose run --rm persistence-deployer /app/scripts/docker-deploy-persistence.sh
```

---

## 🎯 Success Criteria

✅ **Optimization Success**:
- zk_verifier.wasm: <150 KB
- ibc_tfuel_minter.wasm: <150 KB
- Both pass `wasm-validate`
- Cargo tests pass

✅ **Deployment Success**:
- Code stored on-chain (code IDs obtained)
- Contracts instantiated (contract addresses obtained)
- Visible on Mintscan explorer
- Query functions work

✅ **Functional Testing**:
- Mint function works (within 0.1 TFUEL cap)
- Pause/unpause works
- ZK verification passes
- No gas errors

---

## 📚 Additional Resources

- **CosmWasm Optimizer**: https://github.com/CosmWasm/optimizer
- **Binaryen (wasm-opt)**: https://github.com/WebAssembly/binaryen
- **Persistence Docs**: https://docs.persistence.one/
- **Mintscan Explorer**: https://www.mintscan.io/persistence
- **RPC Endpoint**: https://rpc.core.persistence.one:443

---

## 🔐 Security Checklist (First-Time Deployment)

- [ ] Using **testnet** mnemonic (NEVER mainnet private keys in `.env`)
- [ ] Max supply set to conservative limit (0.1 TFUEL = 100000000000000000 wei)
- [ ] Pause function restricted to admin only
- [ ] ZK verifier uses mock Groth16 (understand limitations)
- [ ] Nonce tracking enabled (replay protection)
- [ ] Contract admin set correctly (`DEPLOYER_ADDR`)
- [ ] Sufficient testnet tokens (1+ XPRT)

---

**Next Steps**: Proceed to STEP 1 and debug the optimizer, then follow through to deployment.

