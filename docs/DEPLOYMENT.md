# Deployment

Deploy the Base-settled core, optional networks, and the agent gateway.

As-deployed topology: [RUNTIME_STATE.md](./RUNTIME_STATE.md).

## Prerequisites

- Node.js 20+, npm 10+
- Hardhat
- Funded deployer on the target network
- Root `.env.local` (or network-specific env)

## Environment (minimal)

```
DEPLOYER_PRIVATE_KEY=0x...
ADMIN_ADDRESS=0x...
SP1_GATEWAY_ADDRESS=0x...          # 0x0 for mock
X402_PAY_TO=0x...                  # Base USDC fee sink
XF_TOKEN_ADDRESS=0x...             # optional, post-TGE
```

Gateway payment / prover vars: see [X402_ADAPTER.md](./X402_ADAPTER.md) and [RUNTIME_STATE.md](./RUNTIME_STATE.md).

## Scripts

| Script | Purpose |
|--------|---------|
| `deploy/base-verifier.cjs` | `ZKVerifierSP1` on Base |
| `deploy/deploy-core.cjs` | Core contracts |
| `deploy/deploy-circuits.cjs` | Circuit contracts |
| `deploy/deploy-full.cjs` | Core + circuits + roles + manifest |
| `deploy/testnet.cjs` | Testnet deploy + smoke tests |
| `deploy/mainnet.cjs` | Production checks + manifest |

Manifests land in `deploy/manifests/`.

## Local

```
npx hardhat run deploy/deploy-full.cjs
```

## Base

```
npx hardhat run deploy/base-verifier.cjs --network base-sepolia
npx hardhat run deploy/base-verifier.cjs --network base
```

Live mainnet verifier: `0x9373499645292715a2275A78eD65B14215C41c06` (8453).

## Gateway

```
cd services/gateway
npm install
npm run m2m-server
```

Production demo box uses PM2 app `xfuel-m2m` — see [RUNTIME_STATE.md](./RUNTIME_STATE.md).

## Optional networks

Historical Theta / Bittensor / CosmWasm scripts remain under `deploy/` for provider or cross-chain experiments. Settlement home is Base ([ADR 0002](./adr/0002-base-settlement-home.md)).

## Verify

```
node scripts/verify-deployment.cjs --manifest deploy/manifests/<manifest>.json
```
