# XFuel Protocol — Deployment Guide

> Complete deployment reference for testnet, mainnet, and local environments.

**Back to:** [README.md](../README.md)

---

## Prerequisites

1. Node.js 20+ and npm 10+
2. Hardhat (`npx hardhat --version`)
3. Funded wallet on target network
4. `.env.local` configured (see below)

---

## Environment Variables

Create `.env.local` in the project root:

```bash
DEPLOYER_PRIVATE_KEY=0x...
ADMIN_ADDRESS=0x...              # Multisig admin (receives DEFAULT_ADMIN_ROLE)
BBB_ADDRESS=0x...                # Buyback-burn recipient
GET_ADDRESS=0x...                # Growth & Expansion Treasury
STAKER_ADDRESS=0x...             # veXF staker rewards
TREASURY_ADDRESS=0x...           # Protocol treasury
STAKE_POOL_ADDRESS=0x...         # Fee-to-Stake pool
SP1_GATEWAY_ADDRESS=0x...        # SP1 Verifier Gateway (0x0 for mock)
XF_TOKEN_ADDRESS=0x...           # XF token for veXFGovernance (optional)
# Jackpot feature has been removed from Phase 1 scope.
```

---

## Deployment Scripts

| Script | Description |
|--------|------------|
| `deploy/deploy-core.cjs` | Deploy Core Layer: CoreRevenueSplitter + ZKVerifierSP1 |
| `deploy/deploy-circuits.cjs` | Deploy all 16 circuits + auto-grant CIRCUIT_ROLE |
| `deploy/deploy-full.cjs` | One-shot: Core + all circuits + role configuration + manifest |
| `deploy/testnet.cjs` | Testnet: Core + circuits + roles + smoke tests |
| `deploy/mainnet.cjs` | **Production**: Core + circuits + admin transfer + health checks + manifest |

---

## Local Development

```bash
# Deploy to Hardhat local network (instant, 10K ETH balance, no real funds)
npx hardhat run deploy/deploy-full.cjs

# Full orchestrated activation
npx hardhat run activation/public-activation.cjs
# → Manifest saved to deploy/manifests/activation-*.json
```

---

## Theta Testnet

**Network config:**
- RPC: `https://eth-rpc-api-testnet.thetatoken.org/rpc`
- Chain ID: 365
- Faucet: thirdweb (0.01 TFUEL / 24h)
- Explorer: `https://testnet-explorer.thetatoken.org`
- Min balance: 0.5 TFUEL

```bash
# Core + circuits + smoke tests
npx hardhat run deploy/testnet.cjs --network theta-testnet

# Full activation (16 circuits + BelieverRound + campaign output)
npx hardhat run activation/public-activation.cjs --network theta-testnet

# Launch BelieverRound
npx hardhat run believer/launch-round.cjs --network theta-testnet
```

### Testnet Activation Phases

1. **Pre-flight** — balance check, chain ID verification
2. **Core Layer** — CoreRevenueSplitter + ZKVerifierSP1
3. **Circuits (16)** — all circuits with gas tracking
4. **BelieverRound** — on-chain vesting contract
5. **Role Grants** — CIRCUIT_ROLE assigned + verified
6. **Smoke Tests** — 17 tests: CIRCUIT_ID reads + splitter shares + BelieverRound + ZKVerifier
7. **Dashboard Manifest** — JSON output for dashboard loading
8. **Campaign Output** — ready-to-post X/Twitter + Discord announcement

---

## Theta Mainnet

**Network config:**
- RPC: `https://eth-rpc-api.thetatoken.org/rpc`
- Chain ID: 361
- Min balance: 50 TFUEL (checked by pre-flight)

```bash
# Full mainnet activation (9 phases, 20 contracts, admin transfer, health checks)
npx hardhat run activation/mainnet-activation.cjs --network theta-mainnet

# With continuous monitoring
ENABLE_MONITORING=true npx hardhat run activation/mainnet-activation.cjs --network theta-mainnet
```

### Mainnet Activation Phases

1. **Pre-flight** — balance >= 50 TFUEL, chain ID 361, address validation
2. **Core Layer** — Splitter + ZKVerifier + optional veXFGovernance
3. **Circuits (16)** — all modular circuits with gas tracking
4. **BelieverRound** — on-chain vesting contract
5. **Role Grants** — 16/16 CIRCUIT_ROLE verified
6. **Admin Transfer** — deployer → multisig (renounces deployer admin)
7. **Smoke Tests** — 19/19 contract validation
8. **Health Checks** — on-chain code verification + ThetaScan API
9. **Manifest** — JSON output + campaign summary

### Mainnet Features

- Pre-flight checks (50+ TFUEL balance, chain ID 361 verification)
- veXFGovernance deployment alongside Core Layer
- Admin transfer: deployer → multisig (DEFAULT_ADMIN_ROLE)
- Automated smoke tests on all 16 circuits
- JSON manifest saved to `deploy/manifests/mainnet-{timestamp}.json`

---

## Post-Deployment Checklist

| Step | Action |
|------|--------|
| 1 | Verify all contracts on [Theta Explorer](https://explorer.thetatoken.org) |
| 2 | Confirm multisig admin has DEFAULT_ADMIN_ROLE |
| 3 | Configure RELAYER_ROLE / SOLVER_ROLE on each circuit |
| 4 | Set production SP1 Gateway address |
| 5 | Announce deployment to community |

```bash
# Run deployment validation tests
npx hardhat test test/optimizations/Deploy.system.test.cjs
```

---

## CosmWasm Deployment (Cosmos)

### Phase D: Bridge Contracts (Q2 2026)

| Step | Contract | Chain | Audit |
|------|----------|-------|-------|
| 1 | VaultFactory.sol | Theta mainnet | CertiK required |
| 2 | RevenueSplitter.sol | Theta mainnet | CertiK required |
| 3 | ZKVerifier.wasm | Osmosis mainnet | CertiK required |
| 4 | ibcTFUEL.wasm | Osmosis mainnet | CertiK required |
| 5 | FeeCollector.wasm | Osmosis mainnet | CertiK required |

```bash
# Build optimized WASM
cd cosmwasm-contracts/persistence-minter
docker run --rm -v "$(pwd)":/code cosmwasm/optimizer:0.15.0

# Store code on Osmosis
osmosisd tx wasm store artifacts/*.wasm --from deployer --gas auto

# Instantiate
osmosisd tx wasm instantiate $CODE_ID \
  '{"admin":"osmo1...","mock_mode":false}' \
  --label "XFuel-ZKVerifier" --from deployer --gas auto
```

---

## Frontend Deployment

```bash
# Vercel
npm run build && vercel --prod

# Self-hosted
npm run build
# Serve the dist/ directory
```

---

## Backend Deployment

```bash
cd backend/theta-bridge
npm install

# PM2 (production)
pm2 start ecosystem.config.cjs

# Docker/Kubernetes
# See backend/theta-bridge/deployment.yaml
```

---

## Monitoring

### Dashboard

```bash
# Open dashboard
npx serve dashboard -l 3000
# → http://localhost:3000
# Load manifest: deploy/manifests/*.json
# Start event listener for live activity
```

### Fee Analytics

```bash
cd backend/theta-bridge

# Prometheus + Grafana
node src/fee-analytics.js --format prometheus --watch --port 9100

# One-shot report
node src/fee-analytics.js --chain all --period 24h --format json --output daily-report.json
```

### BelieverRound Monitoring

```bash
# One-shot status
node believer/monitoring-script.cjs

# Continuous with Discord webhook
node believer/monitoring-script.cjs --watch --webhook https://discord.com/api/webhooks/...

# CSV export
node believer/monitoring-script.cjs --csv
```

### Health Checks

```bash
# With ThetaScan API integration
ENABLE_MONITORING=true MONITOR_INTERVAL_MS=30000 \
  npx hardhat run deploy/mainnet.cjs --network theta-mainnet
```

Features: on-chain code verification, balance reads, ThetaScan API cross-reference, optional continuous monitoring loop.

---

## Mock Mode

For development without live ZK infrastructure:

```bash
# EVM: Deploy with mock mode (SP1 verifier = zero address)
npx hardhat run scripts/deploy-core-layer.js --network hardhat

# WASM: Instantiate with mock mode
osmosisd tx wasm instantiate $CODE_ID \
  '{"admin":"osmo1...","mock_mode":true}' \
  --from deployer --gas auto

# Backend mock mode
export MOCK_MODE=true
npm run dev
```

See also: [MOCK_TESTING_PLAN.md](../MOCK_TESTING_PLAN.md) and [MOCK_TESTING_COMPLETE.md](../MOCK_TESTING_COMPLETE.md)
