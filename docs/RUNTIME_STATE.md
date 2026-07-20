# Runtime State

As-deployed source of truth. When in-repo config disagrees with this file, this file wins.

Last updated: 2026-07-20

## Current state

- Settlement home: Base (USDC via x402) — [ADR 0002](./adr/0002-base-settlement-home.md)
- Tier 1 signed receipt: live (default)
- Tier 2 SP1 settlement proof: live (AWS ECS prover → Succinct)
- Tier 3 Verified Inference (zkLLM): active build — RAM-bound, CPU-only. See [VERIFIED_INFERENCE_HANDOFF.md](./VERIFIED_INFERENCE_HANDOFF.md)
- Payment binding: server-attested today; in-proof after SP1 guest v2

## Base cutover

Money, proofs, and (later) XF/veXF live on Base. Theta EdgeCloud is an optional GPU provider only.

| Surface | Base |
|---------|------|
| Money | USDC via x402 (`X402_PAY_TO` / Splits v2) |
| Proofs | `ZKVerifierSP1` (Sepolia → mainnet) |
| Token (later) | XF / veXF |

Operator checklist: deploy/point verifier on Base → set gateway `X402_*` and `SP1_PROVER_URL` → clients use `chain_id: "base"` and `payment.rail: "usdc"` → Theta RPC only if using EdgeCloud as a provider tier.

## Live endpoints

ZKVerifierSP1 (Base mainnet 8453):

`0x9373499645292715a2275A78eD65B14215C41c06`

Manifest: `deploy/manifests/base-verifier-base-2026-07-17T08-04-12-891Z.json`  
Admin/deployer: `0xe49b47e759Ca01B6D66A49807Bb2aEe31c1243bd`

SP1 prover (live):

- AWS ECS `xfuel-sp1-prover` (us-east-1)
- ALB: `http://xfuel-sp1-alb-1873465045.us-east-1.elb.amazonaws.com`
- Gateway env: `SP1_PROVER_URL`
- Ingress locked to Lightsail `35.180.10.142/32` only

Demo gateway:

- Host: Lightsail `35.180.10.142`
- App: PM2 `xfuel-m2m` → `services/gateway` → `npm run m2m-server` (port 3002)
- Public: https://api-testnet.xfuel.app

x402:

- Testnet: public `https://x402.org/facilitator` (`X402_NETWORK=base-sepolia`)
- Mainnet facilitator: not provisioned

## Real vs mock

| Capability | Status |
|------------|--------|
| Signed receipt | Real |
| SP1 settlement proof | Real (via AWS prover URL) |
| USDC / x402 Base Sepolia | Real |
| USDC / x402 Base mainnet | Not wired |
| Payment binding in-proof | Partial (server-attested) |
| zkLLM Verified Inference | Active build |
| `services/zkgpt-prover` mock | Dev-only — never demo as a proof |
| ZAN mock facilitator | Dev-only |

## Blockers

- Base mainnet x402 facilitator not provisioned
- SP1 guest v2 needed for in-proof payment binding
- Tier-3 on-chain verify / E2E still in progress (see Verified Inference handoff)

Ignore dead `ZKGPT_PROVER_URL` pointing at `ALB-1-1092545307…` — that ALB is gone. Real prover is `xfuel-sp1-alb-1873465045…` above.

## Redeploy demo gateway

```bash
git pull
# restore services/gateway/.env (keep SP1_PROVER_URL + x402 block)
cd services/gateway && npm install
pm2 delete xfuel-m2m
pm2 start npm --name xfuel-m2m -- run m2m-server
pm2 save
# verify /health includes base
```

## Local gateway

A local `npm run m2m-server` has no prover of its own. Point `SP1_PROVER_URL` at the AWS ALB for real Tier-2 proofs (ALB only accepts the Lightsail IP). Otherwise proofs are regenerable.
