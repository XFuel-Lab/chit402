# XFuel Strategy — Build-From Source

Canonical company strategy. When messaging, GTM, or eng backlog disagree with this file, update this file (or amend in writing) — do not silently fork.

Status: active · Last updated: 2026-08-06  
Related: [POSITIONING.md](./POSITIONING.md) · [PROVIDER_FLOAT_TREASURY.md](./PROVIDER_FLOAT_TREASURY.md) · [adr/0005-provider-float-cogs.md](./adr/0005-provider-float-cogs.md) · [BEACHHEAD_ICP.md](./BEACHHEAD_ICP.md) · [PRIVATE_SPEND_THESIS.md](./PRIVATE_SPEND_THESIS.md) · [RUNTIME_STATE.md](./RUNTIME_STATE.md)

## Company job

XFuel is the **book**: this agent spent Y on this job, and you hold **hub, model, and amount**. Not a smart router. Not a model shop. Agents pay in USDC on Base and Solana; live routes today are Theta and Akash; signed receipt is table stakes.

We are not:

- An agent launchpad or token factory
- A GPU DePIN marketplace (Theta / Akash / Aethir are supply)
- An OpenRouter clone competing on model catalog
- A TEE / zkML company as identity (compose those; sell settlement)

## One line

**XFuel is the book. This agent spent Y on this job. You hold hub, model, and amount.**

Privacy add (when Private Spend is live): *Spend without briefing the frontier lab.*

Locked copy and guardrails: [POSITIONING.md](./POSITIONING.md).

## Elevator

AI agents are starting to spend money on their own. Keys and opaque invoices fail. XFuel is the book: pay per call in USDC via x402 on Base and Solana, and you hold hub, model, and amount. Signed receipt is table stakes — HMAC by default, SP1 settlement proof on demand, Verified Inference for open-weight authenticity when it matters. Not a smart router. Not a model shop.

## Why this wins (market)

| Layer | What is happening | XFuel role |
|-------|-------------------|------------|
| Identity / discovery | ERC-8004, Virtuals EconomyOS, Agentverse | Compose; ship validation adapter |
| Runtime | ElizaOS, GAME, uAgents, MCP | Embed (baseURL / plugin) |
| Payments | x402, Skyfire, Nevermined, CDP | Use rails; do not sell “we do x402” alone |
| **Clearing** | **Gap — siloed credits / OpenRouter bridges** | **Own: route + receipt + Private Spend** |
| Compute | Akash, Theta, Aethir, frontier APIs | Pluggable supply via prepaid floats |
| Verification | Phala, Gensyn REE, EigenAI, zkML | Compose; Tier-3 timeboxed premium SKU |

Payment receipts and TEE attestations exist in silos. The missing object is a **portable, payment-bound, multi-provider settlement receipt** with vendor-blind spend. That is the company.

## Product ladder (anchors)

| Tier | Job | GTM role |
|------|-----|----------|
| **T1** Signed receipt | Route, cost, output hash, verify URL | **Land** — default, every task |
| **T2** SP1 settlement proof | Fees, payment binding, on-chain verify on Base | **Expand** — treasury, diligence, A2A disputes |
| **T3** Verified Inference | Open-weight model authenticity (PoMA) | **Option** — premium SKU; [TIER3_TIMEBOX_DECISION.md](./TIER3_TIMEBOX_DECISION.md) |

Do not claim Tier 2 proves black-box LLM correctness. Do not lead Seed or GTM with unfinished zkLLM.

## Money model

- **Buyer rail:** USDC via x402 on Base only → `X402_PAY_TO` / Safe / Splits v2 ([ADR 0001](./adr/0001-usdc-revenue-and-router-verifier-positioning.md), [ADR 0002](./adr/0002-base-settlement-home.md)).
- **Provider COGS:** Prepaid floats (Theta USDC-preferred, Akash ACT, Web2 credits). Not per-task atomic FX.
- **Decision:** [ADR 0005](./adr/0005-provider-float-cogs.md) · ops detail: [PROVIDER_FLOAT_TREASURY.md](./PROVIDER_FLOAT_TREASURY.md).

Agents never hold TFUEL/AKT to use XFuel. Provider tokens stay back-office.

## Beachhead and GTM

**ICP:** Crypto-native agent teams on Base (USDC / x402). Details and hunt list: [BEACHHEAD_ICP.md](./BEACHHEAD_ICP.md).

### Motions (in priority order)

| # | Motion | Who | Offer |
|---|--------|-----|-------|
| 1 | Framework embed | Eliza / MCP authors | OpenAI baseURL → XFuel; USDC budget + verify_url |
| 2 | Launchpad sidecars | Virtuals *agent teams* (not protocol war) | Escape siloed compute credits; DePIN cost + proofs |
| 3 | Swarm operators | Olas services, Theoriq collectives, ACP job runners | A2A lineage + multi-hop spend receipts |
| 4 | Compute co-sell | Akash / Theta BD | They supply cheap GPUs; we bring Base agent demand |
| 5 | Standards attach | ERC-8004 validation, x402 bazaar | Settlement receipt + validation as trust objects |

**Secondary (later):** Large AI apps bursting to DePIN for cost — auditor exports + Private Spend. Do not lead GTM with broad enterprise RFPs before 3 design partners.

### Win / die tests

| Win | Die |
|-----|-----|
| Partners depend on verify_url + budgets weekly | Receipt-only sidecar with no routing machine |
| DePIN tiers live under USDC quotes | Revert to Theta/TFUEL settlement identity |
| Private Spend + payment-bound proofs as defaults | Lead with unfinished Tier-3 / race TEE brands |
| Schema gravity (others emit our receipt fields) | Compete on model catalog vs OpenRouter |

## Non-goals (this horizon)

- Community / token sale marketing
- Settling buyers in TFUEL, AKT, or other provider gas tokens
- Per-task USDC→TFUEL (or any) bridge on the inference hot path
- Claiming “ZK = private prompts”
- Broad enterprise RFPs before 3 design partners
- Expanding circuit catalog for GTM optics
- Becoming company identity for confidential inference or zkLLM

## Build sequence (eng)

| Phase | What | Done when |
|-------|------|-----------|
| **P0** | Manual prepaid floats; Theta (USDC-preferred) + Akash ACT as real routes; USDC quotes with margin | Paid Base task completes on a DePIN tier |
| **P1** | Provider Float Manager v0; quote blocks if float empty; receipt `provider_cogs` | **Shipped (gateway):** `provider-float.js` + quote/task gate + `provider_cogs` on receipt/verify HTML. Ops: set `PROVIDER_FLOATS_JSON` + `PROVIDER_FLOAT_ENFORCE`; Slack alerts still P2. |
| **P1b** | Honest live catalog + multimodal surfaces | **Shipped (gateway):** `hub-catalog.js` polls Theta `/service/list`; `/v1/models` hub-prefixed ids; no Llama fiction; `/v1/images/generations` + `/v1/audio/transcriptions`; `OPENAI_GATEWAY_ALLOW_FALLBACK=false` for hard-fail. |
| **P2** | Refill bots / runbooks from Safe → provider accounts | Manual refill no longer weekly bottleneck |
| **P3** | Pass-through where providers accept x402/USDC natively | Less float inventory for those tiers |

Parallel (founder/ops, not in the public docs hub): design partners, Private Spend enable, guest v2 payment binding, Safe for `X402_PAY_TO`, counsel on Web2 collect-and-forward, Tier-3 timebox accept.

Live truth: [RUNTIME_STATE.md](./RUNTIME_STATE.md). Seed gates: [SEED_READINESS.md](./SEED_READINESS.md).

## Operating rule

~70% outreach / partner success · ~20% trust ops (floats, guest v2, Safe) · ≤10% Tier-3 / science until Seed gates clear.

North-star metrics: `paid_tasks_7d`, `usdc_fees_7d` from `GET /stats`, plus named design partners with a shared channel.
