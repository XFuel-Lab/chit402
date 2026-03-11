# 🐳 DOCKER QUICK START - 2 Minutes to Deploy

Deploy Persistence contracts from Windows in 2 minutes!

---

## ⚡ FASTEST PATH

### 1️⃣ Install Docker Desktop (if needed)

```powershell
# Check if Docker is installed
docker --version

# If not found, download and install:
# https://www.docker.com/products/docker-desktop/
# Then restart your computer
```

### 2️⃣ Configure Your Wallet

```powershell
# Copy template
copy env.docker.example .env.docker

# Edit with your Keplr mnemonic
notepad .env.docker
```

**In `.env.docker`, update line 6:**
```bash
KEPLR_MNEMONIC="your twelve word mnemonic from keplr wallet goes here"
```

Save and close.

### 3️⃣ Run the Helper Script

```powershell
# Run the deployment wizard
powershell -ExecutionPolicy Bypass -File .\deploy-persistence.ps1
```

**Select option 7** (Full deployment)

That's it! ✅

---

## 📋 MANUAL DEPLOYMENT (Alternative)

If you prefer running commands directly:

```powershell
# 1. Build image
docker-compose build persistence-deployer

# 2. Deploy contracts
docker-compose --profile deploy up deploy-persistence

# 3. Test mint
docker-compose --profile test up test-persistence-mint

# Done!
```

---

## ✅ VERIFY SUCCESS

After deployment, check your `.env` file:

```powershell
type .env | findstr PERSISTENCE
```

You should see:
```bash
PERSISTENCE_DEPLOYER=persistence1abc...
ZK_VERIFIER_ADDRESS=persistence1zkverifier...
IBCTFUEL_MINTER_ADDRESS=persistence1minter...
```

✅ Contracts deployed!

---

## 🎯 NEXT STEPS

1. **Run E2E Test**: `STEP5_E2E_BRIDGE_TEST_GUIDE.md`
2. **Test Ferrari Metrics**: Verify 30/70 splits
3. **Go Live**: Minimal caps, pause enabled

---

## 🐛 TROUBLESHOOTING

### Docker not found?
Install: https://www.docker.com/products/docker-desktop/

### Need XPRT?
Your Keplr address needs ~1 XPRT ($0.25 USD) for gas.
Get it from Osmosis DEX or exchanges.

### Container won't start?
```powershell
# Check Docker Desktop is running (whale icon in system tray)
docker ps

# Check logs
docker-compose logs persistence-deployer
```

### More help?
See full guide: `DOCKER_DEPLOYMENT_GUIDE.md`

---

**That's it! Deploy in 2 minutes. 🚀**

