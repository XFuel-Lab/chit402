# Mainnet x402 Checklist

Operator runbook to turn on **real USDC fees on Base mainnet**. Sprint 1 money path.

Related: [X402_ADAPTER.md](./X402_ADAPTER.md), [RUNTIME_STATE.md](./RUNTIME_STATE.md), [ADR 0001](./adr/0001-usdc-revenue-and-router-verifier-positioning.md), [LEGAL_LAUNCH_CHECKLIST.md](./LEGAL_LAUNCH_CHECKLIST.md).

## Why this matters

Public `https://x402.org/facilitator` is **Base Sepolia only**. Mainnet settlement uses the Coinbase CDP facilitator:

`https://api.cdp.coinbase.com/platform/v2/x402`

Gateway code already speaks the standard x402 `/verify` + `/settle` protocol and mints CDP EdDSA JWTs when `CDP_API_KEY_ID` + `CDP_API_KEY_SECRET` are set (`services/gateway/src/cdp-jwt.js`).

## Prerequisites

- [ ] Coinbase CDP project with Secret API Key (ID + Secret)
- [ ] Base mainnet receiving address — prefer a **Safe** (or Splits v2) as `X402_PAY_TO`
- [ ] Counsel note started for collect-and-forward / money-transmission if Web2 providers are paid from XFuel balances ([LEGAL_LAUNCH_CHECKLIST.md](./LEGAL_LAUNCH_CHECKLIST.md))
- [ ] Demo / production gateway host can reach CDP (`api.cdp.coinbase.com`)

## Env block (production)

```bash
X402_ENABLED=true
X402_DEFAULT_RAIL=usdc
X402_FACILITATOR_PROVIDER=x402
X402_NETWORK=base
# Optional explicit URL — if unset and network=base, gateway defaults to CDP:
# X402_FACILITATOR_URL=https://api.cdp.coinbase.com/platform/v2/x402
X402_PAY_TO=0x<SAFE_OR_SPLITS_ON_BASE>
X402_USDC_PRICE_DEFAULT=10000
X402_FALLBACK_TFUEL=false

CDP_API_KEY_ID=...
CDP_API_KEY_SECRET=...

# Fee sink alias (optional; falls back to X402_PAY_TO)
REVENUE_SPLIT_ADDRESS=0x<SAME_OR_SPLITS>
REVENUE_NETWORK=base
```

Do **not** put CDP secrets in git. Rotate if leaked.

## Safe / fee sink

1. Create or reuse a Safe on Base (chain ID `8453`).
2. Set `X402_PAY_TO` to that Safe (or a Splits v2 contract owned by the Safe).
3. Document signers + threshold in the ops vault (1Password / Bitwarden).
4. Smoke: send a tiny USDC transfer to the Safe; confirm in Basescan.

## Verification steps

```bash
# From services/gateway with prod env loaded:
# 1) Health shows base + x402 enabled
curl.exe -s https://api.xfuel.app/health   # or your prod host

# 2) Paid task without payment → 402 challenge with network=base
# 3) Agent signs EIP-3009 USDC auth (xfuel-sdk onchain payer) and retries
# 4) Confirm USDC landed at X402_PAY_TO on Basescan
# 5) Receipt includes payment_ref (network:txHash)
```

SDK smoke (local):

```bash
cd packages/sdk
# Point at gateway with mainnet x402 env; use a funded Base USDC wallet
npx tsx examples/flagship-demo.ts
```

## Done when

| Check | Pass |
|-------|------|
| `X402_NETWORK=base` on live gateway | |
| CDP JWT auth succeeds (`/verify` not 401) | |
| USDC fee tx visible on Basescan to `X402_PAY_TO` | |
| RUNTIME_STATE updated: mainnet x402 = Real | |
| No mock facilitator in prod env | |

## After go-live

1. Update [RUNTIME_STATE.md](./RUNTIME_STATE.md) — flip “USDC / x402 Base mainnet” to Real; remove facilitator blocker.
2. Keep testnet demo on Sepolia if desired (separate host or env).
3. Do not enable broad Web2 collect-and-forward revenue until counsel signs off.

## Rollback

```bash
X402_NETWORK=base-sepolia
# unset CDP keys or leave them
X402_FACILITATOR_URL=https://x402.org/facilitator
```

Or `X402_ENABLED=false` to stop charging.
