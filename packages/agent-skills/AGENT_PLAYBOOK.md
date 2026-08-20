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
export XFUEL_API_URL=https://api.xfuel.app
export XFUEL_API_KEY=xfuel-demo
```

Self-host: `cd services/gateway && npm run m2m-server` (port 3002).  
Env matrix: [`_shared/reference/env-and-endpoints.md`](./_shared/reference/env-and-endpoints.md).

## Flow 0 — OpenAI-compatible

```
baseURL = ${XFUEL_API_URL}/v1
```

`GET /v1/models`, `POST /v1/chat/completions` (streaming supported). Receipts in `x-xfuel-*` headers and `xfuel` body field. Docs: [OPENAI_COMPATIBLE_GATEWAY.md](../../docs/OPENAI_COMPATIBLE_GATEWAY.md).

## Flow 0b — MCP

```
npx xfuel-mcp
```

`list_models` then `chat_completions` with `messages`. That is the same unmetered `/v1` door.
Do not call `submit_inference` to try a prompt (402 without a payer).
`pay_with_usdc` is only listed if you set `XFUEL_PAYER_PRIVATE_KEY` — it spends real USDC on Base.

## Flow 1 — Submit inference

Skill: `xfuel-submit-inference`. SDK: `examples/quickstart.ts`.

```
POST /task-request
payment: { rail: "usdc" }
chain_id: "base"
```

Poll `GET /task-status` or use `waitForCompletion`. Share `verify_url`.

`tools`, `tool_choice`, `max_tokens` and `temperature` are accepted here too, so a paid agent loop
works the same as on `/v1`: tool calls come back on `result.tool_calls`, and you feed them into the
next request as an assistant turn plus a `tool` turn. Two things to know — a tool-carrying request
routes `xfuel/auto` to a loop-capable model, and `max_tokens` is what the quote charges you for.

On failure, read `error.code` rather than retrying blindly: `model_not_found` and
`tools_unsupported_on_hub` will not succeed on retry, `no_provider_available` will. A task is never
answered with a synthetic result, so a receipt always corresponds to work that ran.

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

`GET /health` carries a `proofs` block. During onboarding the prover is kept live
(`settlement_proof: "open"`). If it ever reads `"unavailable"`, signed receipts still work;
on-chain proofs will not attach until it is up. `signed_receipts` is always `"always"`.

## Flow 7 — Budget + Private Spend (design partners)

Partner-facing first hour: [docs/DESIGN_PARTNER_ONBOARDING.md](../../docs/DESIGN_PARTNER_ONBOARDING.md).  
Cookbook example: [`examples/private-spend-budget.ts`](../sdk/examples/private-spend-budget.ts).

1. Use the **partner API key** (not the public `xfuel-demo` key).
2. Start on `/v1` (base-URL swap, free signed receipt). Pay with USDC via x402 on `/task-request` when you want a budget — agent holds a wallet; never give OpenAI your org key.
3. Confirm receipt `privacy.mode` is `vendor_blind` when Private Spend is on.
4. Open `verify_url?format=json` or SDK `getReceipt(taskId)` — third parties recompute binding without trusting HTML.
5. Call `GET /stats/me` or SDK `getMyStats()` for **your** paid tasks / USDC fees.
6. Auditor pack: `GET /receipt/:id?format=auditor` or SDK `getAuditorExport(taskId)` — policy + totals, no prompts.

Thesis: [docs/PRIVATE_SPEND_THESIS.md](../../docs/PRIVATE_SPEND_THESIS.md).

Honest trust: Private Spend is **gateway-trusted**. It is not prompt encryption. For content privacy, ask for the confidential / TEE provider tier.

## Flow 8 — Multi-hop / A2A receipt chain

1. `POST /a2a-message` (optional `parent_task_id`, `correlation_id`).
2. Follow-on `POST /task-request` with `parent_task_id` + `a2a_message_id` from the A2A response.
3. Receipt JSON includes `lineage.receipt_chain`.

Example seed: `examples/a2a-swarm.ts` + link fields above.

## Secrets

Never put payer keys in skills or commit them. Prefer agent-side payers and out-of-band signing for on-chain calldata.
