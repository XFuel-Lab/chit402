# Runtime State

As-deployed source of truth. When in-repo config disagrees with this file, this file wins.

Last updated: 2026-08-06

## Current state

- Settlement home: Base (USDC via x402) — [ADR 0002](./adr/0002-base-settlement-home.md)
- Tier 1 signed receipt: live (default)
- Tier 2 SP1 settlement proof: live (AWS ECS prover → Succinct)
- Tier 3 Verified Inference (zkLLM): active build — RAM-bound, CPU-only. See [VERIFIED_INFERENCE_HANDOFF.md](./VERIFIED_INFERENCE_HANDOFF.md)
- Payment binding: server-attested today; in-proof after SP1 guest v2
- **Public Base mainnet x402:** Real (2026-08-06) — flagship smoke `ai-task-1-1786004600540` / tx `0x066caacc…db70`

## Base cutover

Money, proofs, and (later) XF/veXF live on Base. Theta EdgeCloud is an optional GPU provider only.

| Surface | Base |
|---------|------|
| Money | USDC via x402 (`X402_PAY_TO` / Splits v2) |
| Proofs | `ZKVerifierSP1` (mainnet) |
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
- App: **systemd `xfuel-api`** → `/home/ubuntu/xfuel-protocol/services/gateway` → `node src/server.js` (port 3002)
- Install / recover: [deploy/lightsail/README.md](../deploy/lightsail/README.md)
- Public: https://api-testnet.xfuel.app
- **Do not** use `/opt/xfuel-protocol/backend/theta-bridge` or PM2 `xfuel-m2m` (legacy)
- Health fingerprint: `fee_config.revenue_split.model === "usdc-base-splits-v2"` (not the legacy `30% BBB` string)

x402:

- Facilitator: Coinbase CDP `https://api.cdp.coinbase.com/platform/v2/x402` when `X402_NETWORK=base` (+ `CDP_API_KEY_ID` / `CDP_API_KEY_SECRET`)
- Public demo host: **Base mainnet** (`X402_NETWORK=base`, `X402_PAY_TO=0x23f7…7334`)
- Sepolia rollback: `X402_NETWORK=base-sepolia` + `https://x402.org/facilitator` — [MAINNET_X402_CHECKLIST.md](./MAINNET_X402_CHECKLIST.md)

## Real vs mock

| Capability | Status |
|------------|--------|
| Signed receipt | Real |
| SP1 settlement proof | Real (via AWS prover URL) |
| USDC / x402 Base Sepolia | Real (optional / rollback) |
| USDC / x402 Base mainnet | **Real** (public `api-testnet.xfuel.app`, 2026-08-06) |
| Payment binding in-proof | Partial (server-attested; guest v2 pending) |
| zkLLM Verified Inference | Active build |
| `services/zkgpt-prover` mock | Dev-only — never demo as a proof |
| ZAN mock facilitator | Dev-only |

## Blockers

- SP1 guest v2 needed for in-proof payment binding (`payment_binding.in_proof === true`)
- Tier-3 on-chain verify / E2E still in progress (see Verified Inference handoff)
- Private Spend v0 code path shipped (flag off by default) — enable with `PRIVATE_SPEND_ENABLED=true`; see [PRIVATE_SPEND_THESIS.md](./PRIVATE_SPEND_THESIS.md) and [FOUNDER_ACTIONS.md](./FOUNDER_ACTIONS.md)
- Auditor export: `GET /receipt/:taskId?format=auditor` — [RECEIPT_SCHEMA_V2.md](./RECEIPT_SCHEMA_V2.md)
- Tier-3 posture: [TIER3_TIMEBOX_DECISION.md](./TIER3_TIMEBOX_DECISION.md) (narrow SKU)
- Seed scaffold: [SEED_READINESS.md](./SEED_READINESS.md) — design partners + counsel still open

Ignore dead `ZKGPT_PROVER_URL` pointing at `ALB-1-1092545307…` — that ALB is gone. Real prover is `xfuel-sp1-alb-1873465045…` above.

## Redeploy demo gateway

```bash
cd ~/xfuel-protocol
git pull
# ensure services/gateway/.env has X402_NETWORK=base + CDP_* + payTo ≠ deployer
bash deploy/lightsail/install-api.sh
# if port 3002 haunted: sudo reboot
# fingerprint: /health must show usdc-base-splits-v2 (NOT "30% BBB")
```

Legacy (do not use): PM2 `xfuel-m2m`, `/opt/.../theta-bridge`, `xfuel-testnet-api.service`.

## Local gateway

A local `npm run m2m-server` has no prover of its own. Point `SP1_PROVER_URL` at the AWS ALB for real Tier-2 proofs (ALB only accepts the Lightsail IP). Otherwise proofs are regenerable.
