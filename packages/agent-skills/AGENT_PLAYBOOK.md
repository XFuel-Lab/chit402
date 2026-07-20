# Agent Playbook

End-to-end flows for agents using XFuel. Skills: [README.md](./README.md). SDK examples: [../sdk/examples/](../sdk/examples/).

As-deployed reality: [docs/RUNTIME_STATE.md](../../docs/RUNTIME_STATE.md).

## Mental model

1. Submit a task → router picks a provider  
2. Settle → USDC via x402 on Base (default)  
3. Receive a receipt → Tier 1 signed (default) or Tier 2 SP1 settlement proof  
4. Optional → A2A / swarm coordination  

Skills never hold private keys. USDC payers are agent-side.

Do not claim Tier 2 proves black-box model correctness. Tier 3 (zkLLM) is an active build.

## Setup

```
npm install xfuel-sdk
export XFUEL_API_URL=https://api-testnet.xfuel.app
export XFUEL_API_KEY=xfuel-demo
```

Self-host: `cd services/gateway && npm run m2m-server` (port 3002).  
Env matrix: [`_shared/reference/env-and-endpoints.md`](./_shared/reference/env-and-endpoints.md).

## Flow 0 — OpenAI-compatible

```
baseURL = ${XFUEL_API_URL}/v1
```

`GET /v1/models`, `POST /v1/chat/completions` (streaming supported). Receipts in `x-xfuel-*` headers and `xfuel` body field. Docs: [OPENAI_COMPATIBLE_GATEWAY.md](../../docs/OPENAI_COMPATIBLE_GATEWAY.md).

## Flow 1 — Submit inference

Skill: `xfuel-submit-inference`. SDK: `examples/quickstart.ts`.

```
POST /task-request
payment: { rail: "usdc" }
chain_id: "base"
```

Poll `GET /task-status` or use `waitForCompletion`. Share `verify_url`.

## Flow 2 — Pay USDC (x402)

Skill / SDK payer path. Example: `examples/pay-with-usdc.ts`.  
Reference: [`_shared/reference/payments-x402.md`](./_shared/reference/payments-x402.md).

## Flow 3 — Verify settlement proof

Skill: `xfuel-verify-proof`. Example: `examples/pay-prove-verify.ts`.  
Checks proof outcome + payment binding; optional on-chain nullifier read.

## Flow 4 — A2A bid / settle

Skill: `xfuel-a2a-bid`. Example: `examples/a2a-swarm.ts`.

## Flow 5 — Swarm

Skill: `xfuel-swarm-coordinate`. Example: `examples/swarm-coordinate.ts`.  
Lifecycle: form → join (≤18) → settle members → dissolve.

## Flow 6 — Route / health

Skill: `xfuel-route-compute`. Also `GET /health`, `POST /task-quote`.

## Secrets

Never put payer keys in skills or commit them. Prefer agent-side payers and out-of-band signing for on-chain calldata.
