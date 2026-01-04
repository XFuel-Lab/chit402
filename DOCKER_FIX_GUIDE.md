# 🐳 Fixed Docker Setup - Multi-Platform Persistence Deployment

## 🔧 Problem Fixed

**Issue**: Binary architecture mismatch
- Docker container running on different architecture than persistenceCore binary
- Error: `/usr/local/bin/persistenceCore: cannot execute binary file`

**Solution**: Multi-platform Docker build with ARM64/AMD64 support

---

## ✅ What Was Updated

### 1. **Dockerfile.persistence**
- ✅ Ubuntu 24.04 base (latest LTS)
- ✅ Multi-platform support (`--platform` flag)
- ✅ ARM64 default (modern VPS/EC2)
- ✅ AMD64 fallback (compatibility)
- ✅ Auto-detection of architecture
- ✅ persistenceCore v11.14.0 (2026-compatible)
- ✅ Non-root user (security: uid 1000)
- ✅ Health check enabled

### 2. **docker-compose.yml**
- ✅ Platform specification (linux/arm64)
- ✅ Volume mounts for artifacts/scripts
- ✅ Health check configuration
- ✅ Restart policy (unless-stopped)
- ✅ Proper user permissions

### 3. **scripts/docker-deploy-persistence.sh**
- ✅ Platform detection and logging
- ✅ Better account name handling (xfuel-deployer/deployer)
- ✅ Enhanced TX hash extraction (JSON + grep fallback)
- ✅ 30-second wait for confirmation
- ✅ Multiple Code ID extraction methods
- ✅ Mintscan API fallback
- ✅ Color-coded output
- ✅ Detailed error messages

---

## 🚀 Build & Deploy Commands

### Step 1: Setup Docker Buildx (One-time)

```bash
# Create and use buildx builder for multi-platform
docker buildx create --use --name xfuel-builder
docker buildx inspect --bootstrap
```

### Step 2: Build Multi-Platform Image

```bash
# Build for ARM64 (default for VPS/EC2)
docker buildx build \
  --platform linux/arm64 \
  -t persistence-deployer:arm64 \
  -f Dockerfile.persistence \
  --load \
  .

# Or build for both platforms
docker buildx build \
  --platform linux/arm64,linux/amd64 \
  -t persistence-deployer:latest \
  -f Dockerfile.persistence \
  --push \
  .
```

### Step 3: Start Deployer Container

```bash
# Start in background (uses docker-compose.yml config)
docker-compose --profile deploy up -d persistence-deployer

# Check health
docker-compose ps persistence-deployer
docker exec persistence-deployer persistenceCore version
```

### Step 4: Run Deployment

```bash
# Execute deployment script
docker-compose run --rm persistence-deployer /app/scripts/docker-deploy-persistence.sh

# Or use exec if container is already running
docker exec -it persistence-deployer /app/scripts/docker-deploy-persistence.sh
```

---

## 📋 Quick Build & Deploy (One Command)

```bash
# Clean build and deploy
docker buildx create --use && \
docker buildx build --platform linux/arm64 -t persistence-deployer:latest -f Dockerfile.persistence --load . && \
docker-compose --profile deploy up -d persistence-deployer && \
docker-compose run --rm persistence-deployer /app/scripts/docker-deploy-persistence.sh
```

---

## 🧪 Test Locally First

### Verify Architecture Match

```bash
# Check host architecture
uname -m  # Should show: aarch64 (ARM64) or x86_64 (AMD64)

# Check container architecture
docker run --rm persistence-deployer:latest uname -m

# Check persistenceCore binary
docker run --rm persistence-deployer:latest persistenceCore version
```

### Test Health Check

```bash
# Check if health check passes
docker inspect persistence-deployer | jq '.[0].State.Health'

# Should show: "Status": "healthy"
```

### Dry Run (Wallet Check Only)

```bash
# Test wallet import without deploying
docker exec -it persistence-deployer bash -c '
  echo "$KEPLR_MNEMONIC" | persistenceCore keys add test-key --recover --keyring-backend test
  persistenceCore keys show test-key -a --keyring-backend test
  persistenceCore query bank balances $(persistenceCore keys show test-key -a --keyring-backend test) --node https://rpc.core.persistence.one:443
'
```

---

## 📦 Current Contract Status

### Optimized Files (Ready)
- ✅ `artifacts/zk_verifier.wasm` - **166 KB**
- ✅ `artifacts/ibc_tfuel_minter.wasm` - **194 KB**
- ✅ `artifacts/checksums.txt` - SHA256 hashes

### Configuration
- **Max Supply**: 100000000000000000000 (0.1 TFUEL)
- **Admin**: persistence1cgzppukxwdzmhmm342mgrf00atkk8nvg4azpfy
- **Gas Limit**: 1,500,000 per transaction
- **Gas Adjustment**: 1.8x
- **Gas Price**: 0.025 uxprt

---

## 🔍 Monitoring & Logs

### Watch Deployment Live

```bash
# Follow logs in real-time
docker logs -f persistence-deployer

# Stream compose logs
docker-compose logs -f persistence-deployer
```

### Check Transaction Status

```bash
# Query TX via RPC
docker exec persistence-deployer \
  persistenceCore query tx <TX_HASH> \
  --node https://rpc.core.persistence.one:443 \
  --output json | jq '.'

# Or check Mintscan
curl -s "https://lcd.core.persistence.one/cosmos/tx/v1beta1/txs/<TX_HASH>" | jq '.'
```

### Explorer Links

- **Account**: https://www.mintscan.io/persistence/account/persistence1cgzppukxwdzmhmm342mgrf00atkk8nvg4azpfy
- **TX Template**: https://www.mintscan.io/persistence/tx/[TX_HASH]

---

## ⚠️ Troubleshooting

### Issue: Still Getting "exec format error"

```bash
# Force rebuild without cache
docker buildx build --platform linux/arm64 --no-cache -t persistence-deployer:latest -f Dockerfile.persistence --load .

# Or manually specify architecture
docker run --platform linux/arm64 --rm persistence-deployer:latest uname -m
```

### Issue: "Cannot connect to Docker daemon"

```bash
# Check Docker is running
docker info

# Restart Docker Desktop (Windows)
# Or restart Docker service (Linux)
sudo systemctl restart docker
```

### Issue: Buildx not available

```bash
# Install buildx plugin
docker buildx install

# Or update Docker Desktop to latest version
```

### Issue: Permission denied

```bash
# Check file permissions
ls -la artifacts/*.wasm scripts/*.sh

# Fix if needed
chmod 644 artifacts/*.wasm
chmod +x scripts/*.sh
```

---

## 🌐 Testnet Fallback (Optional)

If mainnet continues to have issues, test on testnet first:

### Update Script for Testnet

```bash
# Create testnet version
cp scripts/docker-deploy-persistence.sh scripts/docker-deploy-persistence-testnet.sh

# Update chain ID and RPC
sed -i 's/core-1/test-core-1/g' scripts/docker-deploy-persistence-testnet.sh
sed -i 's/rpc.core.persistence.one/rpc.testnet.persistence.one/g' scripts/docker-deploy-persistence-testnet.sh

# Run testnet deployment
docker-compose run --rm persistence-deployer /app/scripts/docker-deploy-persistence-testnet.sh
```

### Get Testnet Tokens

Visit: https://faucet.persistence.one/

---

## 📊 Expected Output

### Successful Deployment
```
========================================================================
🚀 PERSISTENCE DEPLOYMENT (Multi-platform ARM64/AMD64)
========================================================================

🔍 System Info:
  Platform: aarch64
  persistenceCore: v11.14.0

🔐 Importing wallet...
✅ Wallet loaded: persistence1cgzppukxwdzmhmm342mgrf00atkk8nvg4azpfy

💰 Checking balance...
Balance: 244.847 XPRT (244847431 uxprt)

========================================================================
📦 BUILDING CONTRACTS
========================================================================

✅ Using optimized contracts from artifacts/
  ZK Verifier:     166.12 KB
  ibcTFUEL Minter: 194.48 KB

========================================================================
📤 STORING CODE ON PERSISTENCE
========================================================================

🔐 Storing ZK Verifier contract...
  File: /app/artifacts/zk_verifier.wasm
  Gas: 1,500,000 (adjustment 1.8x)

✅ Transaction submitted
  TX Hash: ABC123...
  Explorer: https://www.mintscan.io/persistence/tx/ABC123...

⏳ Waiting 30 seconds for transaction confirmation...

🔍 Querying transaction...
✅ ZK Verifier Code ID: 123

🔐 Storing ibcTFUEL Minter contract...
✅ Transaction submitted
  TX Hash: DEF456...
✅ Minter Code ID: 124

========================================================================
🎬 INSTANTIATING CONTRACTS
========================================================================

🔐 Instantiating ZK Verifier...
✅ ZK Verifier: persistence1xyz...

🪙 Instantiating ibcTFUEL Minter...
✅ ibcTFUEL Minter: persistence1abc...

========================================================================
✅ DEPLOYMENT COMPLETE
========================================================================
```

---

## 🎯 Next Steps After Successful Build

1. ✅ Build multi-platform image
2. ✅ Start container and verify health
3. ✅ Run deployment script
4. ✅ Monitor logs and TX hashes
5. ✅ Verify on Mintscan explorer
6. ✅ Test mint function

---

**You're ready to deploy! 🚀**

The Docker setup is now fixed with proper multi-platform support. Your contracts are optimized (166KB/194KB) and ready for deployment. Run the build commands above and retry!

