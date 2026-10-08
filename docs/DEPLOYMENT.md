# Deployment

Deploy the Base-settled core, Verified Inference surfaces, and the agent gateway.

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

Gateway payment / prover vars: [X402_ADAPTER.md](./X402_ADAPTER.md).

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

## Receipt shell rollout

Public `GET /receipt/:id` is an unsigned shell. The holder JWS stays on the owner view. Ship in this order:

1. Publish the `@xfuel/verify` candidate **0.3.4** (not published yet) and confirm with `npm view @xfuel/verify version`. npm **0.3.3** already rejects an untrusted issuer key on a full receipt. 0.3.4 is the candidate that also refuses VERIFIED when a shell's tree head is unsigned or missing, and that builds the shell from signed JWS claims only.
2. Before `ISSUER_ROOT_ENABLED=true`, set `RECEIPT_SALT_DIR` and exactly one wrap-key source: `RECEIPT_SALT_WRAP_KEYS`, `RECEIPT_SALT_WRAP_KEY_FILE`, or `SALT_WRAP_KEY`. The wrap key file lives outside the salt data directory. The wrap key is not the issuer key.
3. Put `OWNER_VIEW_DB` on a persistent volume so owner-view nonces survive a restart.
4. Deploy the gateway that returns the shell on the public verify URL and keeps the JWS on the owner view.
5. Update partner docs after those are live.

## Gateway

```bash
cd services/gateway
npm install
npm run m2m-server
```

Production process names live in untracked host config. See `deploy/lightsail/`.

## Verify

```bash
npm run verify:base      # live Base verifier manifest
npm run verify:testnet   # historical Theta testnet (legacy)
npm run verify:mainnet   # historical Theta mainnet (legacy)
```

## Legacy (Theta / splitter / Believer)

Historical full-stack scripts and Theta manifests: [`deploy/legacy/`](../deploy/legacy/README.md). Not the product fee path.
