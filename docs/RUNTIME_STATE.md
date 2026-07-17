# XFuel — Runtime State (as-deployed source of truth)

> **Agents & humans: read this FIRST.** This file describes the system **as
> actually deployed and operated today** — not the aspirational design in the
> whitepaper/ADRs. When in-repo config (e.g. `.env`) disagrees with this file,
> **this file wins**; fix the config. Keep it updated whenever infra changes.
>
> Last updated: 2026-07-17

---

## TL;DR current state

- **Settlement home:** Base (USDC via x402). Money + proof anchor live on Base.
- **Tier 1 — signed receipt:** LIVE (default, every task).
- **Tier 2 — ZK settlement proof (SP1):** LIVE. Proven on a dedicated **AWS
  container prover**, validated on **Succinct**. This is the "light" prover.
- **Tier 3 — ZK proof-of-inference (zkGPT):** ROADMAP / BLOCKED on GPU capacity
  (see "Known blockers"). **The local zkGPT mock is dev-only — never a demo/live path.**
- **Payment binding (x402 → task):** server-attested (`in_proof:false`); flips to
  in-proof only after the SP1 guest ships the v2 public-values layout (new `programVKey`).

---

## Live endpoints & hosts

| Component | Where | Notes |
|-----------|-------|-------|
| `ZKVerifierSP1` | Base mainnet `0x9373499645292715a2275A78eD65B14215C41c06` (chain 8453) | Admin/deployer `0xe49b47e759Ca01B6D66A49807Bb2aEe31c1243bd`. Manifest: `deploy/manifests/base-verifier-base-2026-07-17T08-04-12-891Z.json` |
| **SP1 prover (LIVE, "light")** | AWS ECS `xfuel-sp1-prover` (us-east-1, acct 187510174358) → validated on Succinct | Behind ALB **`http://xfuel-sp1-alb-1873465045.us-east-1.elb.amazonaws.com`** (port 80, service `sp1-prover`, target group `xfuel-sp1-tg`). Gateway var: `SP1_PROVER_URL`. **Ingress locked to `35.180.10.142/32` (Lightsail) only** — not reachable from laptops/other IPs by design. |
| **Demo / showcase gateway** | AWS Lightsail `35.180.10.142` (internal `172.26.5.141`) | The showcase gateway. **Too small to run the prover** — it calls the ALB above via `SP1_PROVER_URL`. Only host allowed to reach the prover, so real Tier-2 proofs happen here (not locally). ✅ **CURRENT — see Deployment status below.** |

### Deployment status (Lightsail demo box) — as of 2026-07-17 (updated after deploy)

- **Repo:** `/home/ubuntu/xfuel-protocol` on branch `main`, now at the merged
  `Feat/base-home-rehome (#130)` (base `chain_id` + live x402). `/health` reports
  `chains:[…,"base",…]`.
- **Running:** `services/gateway` via **PM2** app **`xfuel-m2m`** (`pm2 start npm
  --name xfuel-m2m -- run m2m-server`, cwd `services/gateway`, PORT 3002). `pm2 save`
  persisted; PM2 God Daemon is managed by systemd (auto-restart + survives reboot).
  - PM2 was invoked via an **npx cache** (`~/.npm/_npx/5f7878ce38f1eb13/…/pm2/lib/binaries/CLI.js`),
    not a global install — fragile if the npx cache is pruned. Hardening TODO:
    `npm i -g pm2` and re-`pm2 save`.
  - Stale, **unused** `ecosystem.config.js` at repo root (`xfuel-backend`, port 3000,
    `backend/theta-bridge/server.js`) does **not** match the live app — ignore it.
- **Env:** `services/gateway/.env` — migrated from the old `backend/theta-bridge/.env`
  (kept `SP1_PROVER_URL=…alb-1873465045…`), plus the x402 block appended
  (`X402_ENABLED=true`, `X402_FACILITATOR_PROVIDER=x402`, `X402_NETWORK=base-sepolia`,
  `X402_PAY_TO`, `X402_PROOF_BINDING=true`). Backup at `~/gateway.env.bak`.
- **Pre-restructure state (historical):** was running `node src/server.js` from
  `backend/theta-bridge/` (up since Jul 09, commit `196a703`) with no x402 config —
  replaced by the deploy above.
- **Redeploy recipe:** `cp backend/theta-bridge/.env ~/gateway.env.bak` (if present) →
  `git pull` main → restore `.env` to `services/gateway/.env` → `npm install` in
  `services/gateway` → `pm2 delete xfuel-m2m && cd services/gateway && pm2 start npm
  --name xfuel-m2m -- run m2m-server && pm2 save` → verify `base` in `/health`.
| x402 facilitator (testnet) | public `https://x402.org/facilitator` | Base Sepolia, no API key. `X402_FACILITATOR_PROVIDER=x402`. |
| x402 facilitator (mainnet) | **not provisioned** | Needs a mainnet-capable facilitator (e.g. Coinbase CDP: `X402_FACILITATOR_URL` + `X402_FACILITATOR_API_KEY`, `X402_NETWORK=base`). |

---

## Real vs mock vs roadmap

| Capability | Status | Detail |
|------------|--------|--------|
| Signed receipt (Tier 1) | ✅ real | `services/gateway/src/receipt.js`; every task. |
| SP1 settlement proof (Tier 2) | ✅ real | AWS prover → Succinct. Set `SP1_PROVER_URL` to the AWS container. |
| USDC / x402 payment (Base Sepolia) | ✅ real | Public x402.org facilitator; agent signs EIP-3009. |
| USDC / x402 payment (Base mainnet) | ⛔ not wired | Needs CDP (or other mainnet) facilitator + funded mainnet treasury. |
| Payment binding | 🟡 partial | Server-attested today; in-proof pending SP1 guest v2 (`X402_PROOF_BINDING`). |
| zkGPT proof-of-inference (Tier 3) | 🟡 roadmap/blocked | GPU capacity blocker (below). |
| zkGPT **mock** prover | 🧪 dev-only | `services/zkgpt-prover/mock-server.cjs`. For plumbing tests ONLY. Do not present as a proof. |
| ZAN mock x402 facilitator | 🧪 dev-only | `services/gateway/src/x402-mock-facilitator.js`. Local handshake tests only. |

---

## Known blockers / open threads

- **zkGPT GPU capacity:** could not secure enough GPU to run the zkGPT prover on
  Theta EdgeCloud or AWS (failed even on the largest available instance). Tier-3
  proof-of-inference is parked on this. Dedicated design discussion pending
  (candidate topics: right-sizing, alternative proving backends, partial/streamed
  proving, batching, or a different Tier-3 approach).
- **Payment binding in-proof:** waiting on the SP1 guest v2 public-values layout
  (adds the 13th `paymentCommitment` field → new `programVKey`).

---

## Known-dead / stale config to IGNORE

- `ZKGPT_PROVER_URL=http://ALB-1-1092545307.us-east-1.elb.amazonaws.com` — **dead**
  (DNS unresolvable; a *different, old* ALB). Do not chase it; do not treat its
  absence as "no prover." The real prover is `xfuel-sp1-alb-1873465045...` above.

## How to re-derive the prover URL (if it changes)

Read-only AWS is enough (`aws sts get-caller-identity` → acct 187510174358):

```
aws ecs describe-services --cluster xfuel-sp1-prover --services sp1-prover \
  --region us-east-1 --query "services[0].loadBalancers"
# → targetGroupArn → describe-target-groups → LoadBalancerArns[0]
# → describe-load-balancers → DNSName  (that's SP1_PROVER_URL host)
```

---

## Local dev quickstart (what an agent should assume locally)

- A **local** gateway (`npm run m2m-server` in `services/gateway`) has **no prover
  of its own**. To exercise real Tier-2 proofs locally, point `SP1_PROVER_URL` at
  the AWS container. Otherwise proofs are "regenerable" (settlement still works).
- For a live/demo showcase, use the **Lightsail gateway**, not a laptop.
- The zkGPT mock is only for verifying the proof *plumbing* — it must never appear
  in a demo or be described as a real proof.
