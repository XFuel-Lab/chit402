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

```bash
# Fund deployer with Base Sepolia ETH, then:
npx hardhat run deploy/base-verifier.cjs --network base-sepolia
```

Set in gateway `.env`:

```bash
ZK_VERIFIER_ADDRESS=0x...   # from manifest
VERIFIER_CHAIN_ID=84532     # 8453 on mainnet
# BASE_RPC_URL=https://sepolia.base.org
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
