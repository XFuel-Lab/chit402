# 🐳 Docker Deployment System

Complete Docker-based deployment for XFuel Protocol Persistence contracts - works on Windows, Mac, and Linux!

## 📁 Files in This System

### Core Docker Files
- `Dockerfile.persistence` - Docker image with all Persistence tools
- `docker-compose.yml` - Service orchestration (backend + Persistence deployer)
- `env.docker.example` - Template for environment configuration
- `.env.docker` - Your actual config (gitignored, create from example)

### Deployment Scripts
- `scripts/docker-deploy-persistence.sh` - Main deployment script
- `scripts/docker-test-mint.sh` - Test minting ibcTFUEL
- `deploy-persistence.ps1` - Windows PowerShell helper

### Documentation
- `DOCKER_DEPLOYMENT_GUIDE.md` - Complete guide with troubleshooting
- `DOCKER_QUICK_START.md` - 2-minute quick start
- `LAUNCH_PLAN_NEXT_STEPS.md` - Updated with Docker route

## 🚀 Quick Start

### 1. Install Docker Desktop

**Windows/Mac:**
- Download: https://www.docker.com/products/docker-desktop/
- Install and restart

**Linux:**
```bash
curl -fsSL https://get.docker.com -o get-docker.sh
sudo sh get-docker.sh
sudo usermod -aG docker $USER
# Log out and back in
```

### 2. Configure

```bash
# Copy template
cp env.docker.example .env.docker

# Edit with your Keplr mnemonic
# Windows: notepad .env.docker
# Linux/Mac: nano .env.docker
```

### 3. Deploy

**Easy Mode (Windows):**
```powershell
powershell -ExecutionPolicy Bypass -File .\deploy-persistence.ps1
# Choose option 7 (Full deployment)
```

**Manual Mode (All platforms):**
```bash
# Build image
docker-compose build persistence-deployer

# Deploy contracts
docker-compose --profile deploy up deploy-persistence

# Test mint
docker-compose --profile test up test-persistence-mint
```

### 4. Verify

```bash
# Check deployed addresses
cat .env | grep PERSISTENCE

# Should show:
# PERSISTENCE_DEPLOYER=persistence1...
# ZK_VERIFIER_ADDRESS=persistence1...
# IBCTFUEL_MINTER_ADDRESS=persistence1...
```

## 🎯 What This System Does

### Image Build
The Docker image includes:
- Ubuntu 22.04 base
- Rust toolchain + wasm32 target
- Node.js 18
- persistenceCore CLI
- CosmWasm optimizer tools
- Your project code

### Deployment Process
1. Imports your Keplr wallet (from mnemonic)
2. Checks XPRT balance (needs ~1 XPRT)
3. Builds/optimizes CosmWasm contracts
4. Stores contracts on Persistence mainnet
5. Instantiates ZK Verifier and ibcTFUEL Minter
6. Saves addresses to `.env` file

### Testing
- Generates mock ZK proof
- Tests mint operation
- Verifies balance increase
- Logs all metrics

## 📊 Docker Services

### `persistence-deployer`
Base service with all tools and project code.

**Usage:**
```bash
# Interactive shell
docker-compose run --rm persistence-deployer

# Inside container:
persistenceCore status
persistenceCore keys list --keyring-backend test
./scripts/docker-deploy-persistence.sh
```

### `deploy-persistence` (profile: deploy)
Runs full deployment automatically.

**Usage:**
```bash
docker-compose --profile deploy up deploy-persistence
```

### `test-persistence-mint` (profile: test)
Tests minting ibcTFUEL.

**Usage:**
```bash
docker-compose --profile test up test-persistence-mint
```

## 🔧 Common Commands

### View Logs
```bash
# Follow deployment logs
docker-compose --profile deploy logs -f deploy-persistence

# View all logs
docker-compose logs

# Search for errors
docker-compose logs | grep -i error
```

### Rebuild Image
```bash
# Quick rebuild
docker-compose build persistence-deployer

# Full rebuild (no cache)
docker-compose build --no-cache persistence-deployer
```

### Clean Up
```bash
# Stop containers
docker-compose down

# Remove volumes
docker-compose down -v

# Remove everything including images
docker-compose down --rmi all -v
```

### Debug
```bash
# Start interactive shell
docker-compose run --rm persistence-deployer bash

# Check wallet
persistenceCore keys list --keyring-backend test

# Check balance
persistenceCore query bank balances persistence1... 

# Check network
persistenceCore status
```

## 🔒 Security Notes

### Mnemonic Safety
- `.env.docker` is in `.gitignore` - never committed
- Use a dedicated deployer wallet (not your main Keplr)
- Fund only what you need (1-2 XPRT)
- Rotate wallet after deployment

### Container Security
- Containers don't expose any ports (closed by default)
- Wallet keyring uses "test" backend (file-based, for automation)
- Remove containers after deployment: `docker-compose down --rmi all`

### Production Deployment
- Start with simulation mode (default in scripts)
- Test on testnet first
- Use multisig for contract admin
- Enable pause on minter
- Start with minimal caps

## 💰 Cost Breakdown

| Operation | Gas | XPRT Cost | USD Cost |
|-----------|-----|-----------|----------|
| Store ZK Verifier | ~2M | 0.05 | $0.012 |
| Store Minter | ~2M | 0.05 | $0.012 |
| Instantiate ZK | ~500k | 0.0125 | $0.003 |
| Instantiate Minter | ~500k | 0.0125 | $0.003 |
| **Total** | **~5M** | **~0.13** | **~$0.03** |

**Recommended:** Fund wallet with 1 XPRT for safety buffer.

## 🐛 Troubleshooting

### Docker not found
```bash
# Install Docker Desktop
# https://www.docker.com/products/docker-desktop/
```

### Container won't start
```bash
# Check .env.docker exists
ls -la .env.docker

# Check mnemonic is set
grep KEPLR_MNEMONIC .env.docker

# Check Docker is running
docker ps
```

### Insufficient balance
```bash
# Get your deployer address from logs
# Send XPRT from exchange or another wallet
# Osmosis DEX: osmosis.zone
```

### Build fails
```bash
# Clear Docker cache
docker system prune -a

# Rebuild
docker-compose build --no-cache persistence-deployer
```

### Scripts not executable
```bash
# Fix permissions in container
docker-compose run --rm persistence-deployer bash -c "chmod +x /app/scripts/*.sh"
```

## 📚 Additional Resources

- **Full Guide:** `DOCKER_DEPLOYMENT_GUIDE.md`
- **Quick Start:** `DOCKER_QUICK_START.md`
- **E2E Testing:** `STEP5_E2E_BRIDGE_TEST_GUIDE.md`
- **Launch Plan:** `LAUNCH_PLAN_NEXT_STEPS.md`

## ✅ Success Checklist

After running deployment:

- [ ] Docker image built successfully
- [ ] Wallet imported (check logs for "Wallet loaded")
- [ ] Balance > 1 XPRT
- [ ] Contracts stored (Code IDs in logs)
- [ ] Contracts instantiated (Addresses in logs)
- [ ] Addresses saved to `.env`
- [ ] Mint test passed
- [ ] Ready for E2E testing

## 🎉 You Did It!

If you see addresses in your `.env` file, **you've successfully deployed Persistence contracts!**

Next: Run full E2E bridge test → `STEP5_E2E_BRIDGE_TEST_GUIDE.md`

---

**Questions?** Check `DOCKER_DEPLOYMENT_GUIDE.md` for detailed troubleshooting.

