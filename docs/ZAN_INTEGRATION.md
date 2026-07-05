# ZAN Integration Runbook

How XFuel integrates with **ZAN** (Ant Digital Technologies): Node Service (RPC),
PowerZebra (ZK acceleration), and x402 (agent micropayments).

Status legend: ✅ done · 🟡 ready, needs your action · ⛔ blocked on procurement.

---

## 1. ZAN Node Service (RPC) — ✅ verified / ⚠️ no Theta

ZAN exposes JSON-RPC per chain at:

```
https://api.zan.top/node/v1/<ecosystem>/<network>/<API_KEY>
```

### Verified finding (2026-07) — ZAN does **not** support Theta

We tested a real ZAN key against `verify-rpc.cjs` and direct probes. **ZAN Node
Service has no Theta ecosystem** — `.../node/v1/theta/mainnet/<KEY>` returns:

```
HTTP 400  {"error":{"code":-32600,"message":"request check; ecosystem not supported"}}
```

ZAN is a *strategic validator* for Theta (staking), **not** a Theta RPC provider.
The Theta core path therefore stays on the **public ETH-RPC adaptor** (verified
healthy: mainnet 361 / testnet 365). Do **not** set `ZAN_THETA_RPC_URL` to a ZAN
shared-catalog URL — a dead primary would force a failover on every call.

### What the key *does* work for (same key, verified)

ZAN uses one key across all supported ecosystems. Our probe of the provided key:

| Ecosystem | Endpoint | Result |
|-----------|----------|--------|
| Ethereum | `.../eth/mainnet/<KEY>` | ✅ chainId 1 |
| Base | `.../base/mainnet/<KEY>` | ✅ chainId 8453 |
| BSC | `.../bsc/mainnet/<KEY>` | ✅ chainId 56 |
| Polygon | `.../polygon/mainnet/<KEY>` | ✅ chainId 137 |
| Arbitrum | `.../arbitrum/mainnet/<KEY>` | ⚠️ "ecosystem not supported" (slug/enablement) |
| Theta | `.../theta/*` | ❌ not supported |

Full supported list: ETH, BSC, Polygon, Optimism, Arbitrum, Base, Solana,
Bitcoin, TON, Tron, Sui, Aptos, zkSync, Starknet (20+). Bittensor EVM (964/945)
is **not** in the catalog — keep `https://lite.chain.opentensor.ai` or request a
dedicated node.

### Where these EVM legs map in XFuel (forward-looking — no raw-RPC consumer yet)

| ZAN leg | XFuel use | Current consumer |
|---------|-----------|------------------|
| Ethereum L1 | Hyperlane infra / future ISM | `.hyperlane/chains.yaml` (relayer runs against Bittensor today, not ETH) |
| Base | x402 USDC settlement | x402 adapter uses a **facilitator gateway** (`ZAN_X402_GATEWAY_URL`), not raw Base RPC |

> There is currently **no code path that reads a raw ZAN EVM RPC**, so we did not
> add dead `ZAN_*_RPC_URL` env vars. When x402 goes live (§3) or an ETH/Base
> settlement read is introduced, wire the verified endpoint at that point.

### Steps (any premium/dedicated Theta endpoint, e.g. a ZAN dedicated node)

The `ZAN_THETA_RPC_URL` plumbing in `config.js` remains generic and useful for a
Theta-capable premium endpoint (prepended as primary, public fallback retained):

```bash
# ONLY if you have a Theta-capable endpoint (dedicated node / other provider):
node scripts/verify-rpc.cjs "<url>"            # must show chainId 361 (or 365)
ZAN_THETA_RPC_URL=<verified-theta-endpoint>    # backend prepends it as primary
node -e "import('./backend/theta-bridge/src/config.js').then(m=>console.log(m.default.theta.rpcUrls))"
```

> Never make any single provider a point of failure: always keep a public Theta
> endpoint in the failover list (the backend does this automatically).

---

## 2. ZAN PowerZebra (ZK acceleration) ⛔ (procurement) / 🟡 (code path)

PowerZebra accelerates the kernels SP1 proving depends on (MSM, NTT, H_Poly,
Transpose; up to ~50x kernel / ~5x end-to-end) via GPU libraries + ZK-friendly
cloud GPU servers. **Prover-side only** — `ZKVerifierSP1.sol` verifies
Groth16/PLONK and is proof-system-agnostic, so **no contract redeploy and no
change to audit scope.**

### What's blocked

PowerZebra is currently "Contact Us" on zan.top — you don't have a provisioned
GPU server/endpoint yet. The live cutover is blocked until ZAN provisions access.

### Outreach spec — send this to ZAN

> We run the SP1 (Succinct) zkVM to prove AI-inference tasks, wrapping to
> Groth16/PLONK for on-chain settlement on Theta (~270K gas/proof). We want to
> accelerate proving with PowerZebra. Please advise on:
> 1. A **ZK-friendly cloud GPU server** (your Spec 2/3, 4×GPU) we can run our SP1
>    CUDA host on (`sp1-cuda` / `sp1-gpu-prover`, CUDA 12.x, Rust).
> 2. Whether PowerZebra exposes a **drop-in accelerated backend** for SP1's
>    MSM/NTT/Groth16-wrap (Icicle-style backend selection), or if acceleration is
>    delivered purely as GPU server capacity.
> 3. Pricing tiers and FPGA IP availability.
> 4. A short PoC: benchmark our proof workload on your hardware vs our current host.

### Two integration approaches (build once provisioned)

- **A. Host on ZAN GPU via `SP1_PROVER=zan` (scaffolded ✅, flag-gated, default off):**
  the backend prover client now selects its backend at runtime through
  `resolveProverConfig()` in `backend/theta-bridge/src/sp1-prover-client.js`. Point it
  at a ZAN-hosted SP1 endpoint (same wire protocol) and the current CUDA endpoint is
  retained as an **automatic fallback** — enabling ZAN is safe/reversible.

  ```bash
  SP1_PROVER=zan
  ZAN_PROVER_URL=https://<sp1-host-on-zan-powerzebra>
  ZAN_PROVER_API_KEY=<key>            # sent as x-api-key (ZAN_PROVER_API_KEY_HEADER to override)
  SP1_PROVER_URL=https://<edgecloud-sp1-host>   # kept as automatic fallback
  ```

  Default (`SP1_PROVER=cuda` or unset) is unchanged: CUDA primary + optional
  `SP1_FALLBACK_URL`. Covered by `test/prover-config.test.mjs`.

- **B. Accelerated in-process backend (deeper, future):** add a `zan` arm to the Rust
  host's own selector loading PowerZebra libs directly (kernel-level acceleration
  rather than a separate HTTP host):

  ```bash
  ZAN_ZK_BACKEND_DIR=/opt/powerzebra
  ```

  Touches: `sp1-prover/host/src/main.rs`, `sp1-prover/Dockerfile`, deploy scripts.
  Reversible (flag-gated, fallback intact). Pursue only if approach A's HTTP overhead
  is material.

### Benchmark harness (do this regardless)

Capture a **baseline now** with the current prover so the PowerZebra A/B has a
control. Extend `backend/theta-bridge/scripts/benchmark-prover.js` to emit
proving time + $/proof. Gas is unchanged (verifier is agnostic). This artifact is
strong for grants + WHITEPAPER §12 research track (sits alongside Interstellar).

---

## 3. ZAN x402 (agent micropayments) 🟡 (Phase 3 evaluation)

ZAN ships **x402**: wallet-as-identity, machine-parseable 402 challenges, USDC
settlement on Base/Solana, agent-native credits. XFuel already has "x402-style"
channels (`A2ACircuit.openChannel/claimChannel`, `createEscrow/claimEscrow`).

Opportunity: adopt ZAN x402 as the **standardized payment interface** in front of
XFuel's channels for instant interop with any x402-speaking agent. Scope in
Phase 3. Settlement on Base would use your ZAN Base RPC key (§1).

---

## What we need from you (action list)

| # | Action | Unblocks |
|---|--------|----------|
| 1 | ~~Use ZAN for Theta RPC~~ — ❌ **not possible**: ZAN has no Theta ecosystem (verified). Theta stays on public ETH-RPC (361/365, ✅ healthy). **Clear the broken `ZAN_THETA_RPC_URL` from your `.env`.** | Correct core RPC path |
| 2 | ZAN key verified for ETH/Base/BSC/Polygon. Decide where to apply it (see §1 map) — likely x402 gateway (§3) when provisioned | Cross-chain / settlement legs |
| 3 | Send the **PowerZebra outreach** message above to ZAN | Phase 2 GPU proving |
| 4 | ~~Publish SDK~~ — ✅ **done**: `xfuel-sdk@0.1.0` live on npm (Apache-2.0) | SDK adoption |
| 5 | Confirm whether x402 is one of your 3 keys; provision the ZAN x402 gateway | Phase 3 payment rail |

> Do not paste API keys into chat. Put them in `backend/theta-bridge/.env`
> (gitignored) and run the verifier locally; share only the `verify-rpc.cjs` output.
