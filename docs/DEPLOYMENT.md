# Deployment

Deploy the Base-settled core, Verified Inference surfaces, and the agent gateway.

As-deployed topology: [RUNTIME_STATE.md](./RUNTIME_STATE.md).

## Prerequisites

- Node.js 20+, npm 10+
- Hardhat
- Funded deployer on Base (or Base Sepolia)
- Root `.env.local` (see `.env.deploy.example`)

## Environment (minimal)

```
DEPLOYER_PRIVATE_KEY=0x...
ADMIN_ADDRESS=0x...
SP1_GATEWAY_ADDRESS=0x...          # 0x0 for mock
X402_PAY_TO=0x...                  # Base USDC fee sink
XF_TOKEN_ADDRESS=0x...             # optional, post-TGE
```

Gateway payment / prover vars: [X402_ADAPTER.md](./X402_ADAPTER.md), [RUNTIME_STATE.md](./RUNTIME_STATE.md).

## Go-forward scripts

| Script | Purpose |
|--------|---------|
| `deploy/base-verifier.cjs` | `ZKVerifierSP1` on Base |
| `deploy/model-registry.cjs` | PoMA ModelRegistry |
| `deploy/provider-staking.cjs` | Provider staking / slash |
| `deploy/erc8004-adapter.cjs` | ERC-8004 validation adapter |
| `deploy/register-model.cjs` | Register a model commitment |
| `deploy/ecs/` | SP1 prover AWS task def |

Manifests: `deploy/manifests/` (live Base only — e.g. `base-verifier-*.json`). Historical Theta/Believer/activation/phase/Hyperlane JSON lives under `deploy/legacy/manifests/`.

## Base

```bash
npx hardhat run deploy/base-verifier.cjs --network base-sepolia
npx hardhat run deploy/base-verifier.cjs --network base
```

Live mainnet verifier: `0x9373499645292715a2275A78eD65B14215C41c06` (8453).

## Gateway

```bash
cd services/gateway
npm install
npm run m2m-server
```

Production demo box uses PM2 app `xfuel-m2m` — [RUNTIME_STATE.md](./RUNTIME_STATE.md). The live box is Lightsail — [deploy/lightsail/README.md](../deploy/lightsail/README.md).

Production (`NODE_ENV=production`) refuses to boot unless both anchor gas caps are integers. There is no skip flag. Development and test may leave them unset, and unset means no cap.

| Var | Value to set |
|-----|----------------|
| `ANCHOR_MAX_FEE_WEI` | `20000000000` (20 gwei) |
| `ANCHOR_MAX_PRIORITY_WEI` | `2000000000` (2 gwei) |

Normal Base fees are well under 1 gwei. 20 gwei is a generous multiple of that. The anchor uses 100,000 gas, so this bounds one anchor at 0.002 ETH and a full drain takes many anchors (25 at the cap for a 0.05 ETH float). Set both lower for a thinner wallet. Raise them only when anchors stay pending with `anchor_fee_cap` during a real fee spike. A quote above either cap is not signed.

## Verify

```bash
npm run verify:base      # live Base verifier manifest
npm run verify:testnet   # historical Theta testnet (legacy)
npm run verify:mainnet   # historical Theta mainnet (legacy)
```

## Legacy (Theta / splitter / Believer)

Historical full-stack scripts and Theta manifests: [`deploy/legacy/`](../deploy/legacy/README.md). Not the product fee path.
