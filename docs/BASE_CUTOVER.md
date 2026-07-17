# Base cutover runbook (ADR 0002)

Money + proof home is **Base**. Theta EdgeCloud remains an optional GPU provider.

## 1. Money (Stage A)

1. Create / use a **Safe on Base** (or Base Sepolia for test).
2. Set gateway env (see `services/gateway/.env.base-testnet.example`):
   - `X402_ENABLED=true`
   - `X402_DEFAULT_RAIL=usdc`
   - `X402_FACILITATOR_PROVIDER=x402`
   - `X402_NETWORK=base-sepolia` (or `base`)
   - `X402_PAY_TO=<Safe or Splits address>`
3. Optional: `npm run split:emit` in `services/gateway` then deploy Splits via app.splits.org; set `REVENUE_SPLIT_ADDRESS`.

## 2. Proof home — deploy verifier

**Live on Base mainnet (2026-07-17):**

| Field | Value |
|-------|--------|
| `ZKVerifierSP1` | `0x9373499645292715a2275A78eD65B14215C41c06` |
| Chain | Base `8453` |
| Admin / deployer | `0xe49b47e759Ca01B6D66A49807Bb2aEe31c1243bd` |
| Manifest | `deploy/manifests/base-verifier-base-2026-07-17T08-04-12-891Z.json` |
| Explorer | https://basescan.org/address/0x9373499645292715a2275A78eD65B14215C41c06 |

Set in gateway `.env` / `.env.local`:

```bash
ZK_VERIFIER_ADDRESS=0x9373499645292715a2275A78eD65B14215C41c06
VERIFIER_CHAIN_ID=8453
BASE_RPC_URL=https://mainnet.base.org
```

Optional Sepolia (testnet only):

```bash
npx hardhat run deploy/base-verifier.cjs --network base-sepolia
# VERIFIER_CHAIN_ID=84532
```

Theta testnet verifier addresses under `deploy/manifests/` are **archive only**.

## 3. E2E smoke

```bash
# Gateway with .env.base-testnet
cd services/gateway && npm run m2m-server

# SDK flagship (USDC on Base)
cd packages/sdk
# mock payer:
npx tsx examples/flagship-demo.ts
# real Base Sepolia USDC:
# XFUEL_PAYER_PK=0x... XFUEL_API_URL=http://localhost:3002 npx tsx examples/flagship-demo.ts
```

Expect: quote → pay usdc → settle → `verify_url` receipt. Tier-1 proof optional until prover + verifier wired.

## 4. Legacy

- `/theta-ai/*` routes: legacy names; prefer `/task-request` and `/v1/*` ([providers/edgecloud.md](providers/edgecloud.md)).
- Angel/Believer: retired ([FUNDRAISING_STRUCTURE.md](FUNDRAISING_STRUCTURE.md)).
