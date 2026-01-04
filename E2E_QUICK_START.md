# 🚀 XFUEL E2E Testing - Quick Reference

## One-Command Deploy

```powershell
.\deploy-e2e-testing.ps1
```

That's it! This will:
- ✅ Install Redis (if needed)
- ✅ Deploy VaultFactory contract
- ✅ Configure backend
- ✅ Start all services
- ✅ Run health checks

---

## Run Tests

```powershell
# Interactive (recommended for development)
.\run-e2e-tests.ps1

# Headless (for CI/CD)
.\run-e2e-tests.ps1 -Headless

# Specific suite
.\run-e2e-tests.ps1 -Suite backend
.\run-e2e-tests.ps1 -Suite frontend
.\run-e2e-tests.ps1 -Suite visual

# Specific test file
.\run-e2e-tests.ps1 -Spec "cypress/e2e/zk-bridge-e2e.cy.ts"
```

---

## Test Locally (No Mainnet)

```powershell
# Deploy to local Hardhat network
.\deploy-e2e-testing.ps1 -LocalTest

# Run tests against local network
.\run-e2e-tests.ps1 -Suite all
```

---

## Health Checks

```powershell
# Frontend
curl http://localhost:3000

# Backend
curl http://localhost:3001/health

# Redis
redis-cli ping
```

---

## Common Issues

### Redis Not Running
```powershell
redis-server
```

### Backend Not Starting
```powershell
cd backend\theta-bridge
npm run dev
```

### Frontend Port 3000 Busy
```powershell
netstat -ano | findstr :3000
taskkill /PID <PID> /F
npm run dev
```

---

## File Structure

```
xfuel-protocol/
├── deploy-e2e-testing.ps1          ← Deploy script
├── run-e2e-tests.ps1               ← Test runner
├── E2E_TESTING_DEPLOYMENT_GUIDE.md ← Full guide
├── cypress/
│   ├── e2e/
│   │   ├── zk-bridge-e2e.cy.ts     ← Backend tests
│   │   ├── wallet-integration.cy.ts
│   │   ├── mainnet-beta.cy.ts
│   │   └── swap.cy.ts
│   ├── videos/                      ← Test recordings
│   └── screenshots/                 ← Test screenshots
├── backend/
│   └── theta-bridge/
│       ├── src/                     ← Backend service
│       ├── .env                     ← Config (git-ignored)
│       └── test-e2e-quick.js        ← Backend test
└── scripts/
    └── deploy-vault-factory.cjs     ← Contract deployment
```

---

## Environment Setup

### Required in `.env` (project root)
```env
THETA_MAINNET_PRIVATE_KEY=0x...
```

### Required in `backend/theta-bridge/.env`
```env
VAULT_FACTORY_ADDRESS=0x...
RELAYER_PRIVATE_KEY=0x...
THETA_RPC_URLS=https://eth-rpc-api.thetatoken.org/rpc
REDIS_URL=redis://localhost:6379
```

---

## Memarai Setup (Visual Testing)

```powershell
# 1. Initialize
memarai init

# 2. Configure project
# Edit memarai.config.json

# 3. Run visual tests
.\run-e2e-tests.ps1 -Suite visual -Headless

# 4. View results
memarai dashboard
```

---

## Test Suites

| Suite | Tests |
|-------|-------|
| `backend` | ZK bridge integration |
| `frontend` | UI and wallet tests |
| `integration` | End-to-end flows |
| `visual` | Screenshot comparisons |
| `all` | Everything |

---

## Success Criteria

- ✅ Redis: `redis-cli ping` returns `PONG`
- ✅ Backend: `curl localhost:3001/health` returns 200
- ✅ Frontend: `curl localhost:3000` returns 200
- ✅ Tests: All Cypress tests pass
- ✅ Memarai: No visual regressions

---

## Next Steps After Testing

1. Review test reports
2. Check Memarai for visual changes
3. Fix any failures
4. Deploy to production
5. Monitor logs

---

## Get Help

- **Full Guide:** `E2E_TESTING_DEPLOYMENT_GUIDE.md`
- **Backend Guide:** `backend/theta-bridge/WINDOWS_QUICK_START.md`
- **Cypress Guide:** `CYPRESS_TESTING_GUIDE.md`

---

**Ready?** Run: `.\deploy-e2e-testing.ps1` 🚀

