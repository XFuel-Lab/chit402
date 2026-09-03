# Chit402 Strategy — Build-From Source

Canonical company strategy. When messaging, GTM, or eng backlog disagree with this file, update this file (or amend in writing) — do not silently fork.

Status: active · Last updated: 2026-09  
Related: [POSITIONING.md](./POSITIONING.md) · [PROVIDER_FLOAT_TREASURY.md](./PROVIDER_FLOAT_TREASURY.md) · [adr/0005-provider-float-cogs.md](./adr/0005-provider-float-cogs.md) · [BEACHHEAD_ICP.md](./BEACHHEAD_ICP.md) · [PRIVATE_SPEND_THESIS.md](./PRIVATE_SPEND_THESIS.md) · [RUNTIME_STATE.md](./RUNTIME_STATE.md)

## Company job

Chit402 is the **book**: this agent spent Y on this job, and you hold **hub, model, and amount**. Not a smart router. Not a model shop. The product is the collected spend receipt — possession + lineage for the principal who funds the agent. Agents pay in USDC on Base; signed receipt is table stakes.

The product is the collected row — sidecar + ingest if you already pay a provider. Without a collected USDC `payment.ref` the receipt is client-attested only.

We are not:

- A GPU DePIN marketplace (Theta, Akash, Aethir are supply behind the row)
- A chat-completions router competing on model catalog
- A TEE / zkML company as identity (compose those; sell settlement)

## One line

**Chit402 is the book. This agent spent Y on this job. You hold hub, model, and amount.**

Privacy add (when Private Spend is live): *Spend without briefing the frontier lab.*

Locked copy and guardrails: [POSITIONING.md](./POSITIONING.md).

## Elevator

AI agents are starting to spend money on their own. Keys and opaque invoices fail. Chit402 is the book: pay per call in USDC via x402 on Base, and you hold hub, model, and amount. Signed receipt is table stakes — HMAC by default, SP1 settlement proof on demand. The wire is chat-completions; any Grok-class or dePIN agent can point `baseURL` here and get a receipt.

## ICP

Multi-hop spenders. dePIN agent teams. Grok-class frontier operators. Crypto-native agent teams on Base (USDC / x402). Details: [BEACHHEAD_ICP.md](./BEACHHEAD_ICP.md).

## Product ladder

| Tier | Job | GTM role |
|------|-----|----------|
| **T1** Signed receipt | Route, cost, output hash, verify URL | **Land** — default, every task |
| **T2** SP1 settlement proof | Fees, payment binding, on-chain verify on Base | **Expand** — treasury, diligence, A2A disputes |
| **T3** Verified Inference | Open-weight model authenticity (PoMA) | **Option** — premium SKU |

Do not claim Tier 2 proves black-box LLM correctness.

## Money model

- **Buyer rail:** USDC via x402 on Base only → `X402_PAY_TO` / Safe / Splits v2 ([ADR 0001](./adr/0001-usdc-revenue-and-router-verifier-positioning.md), [ADR 0002](./adr/0002-base-settlement-home.md)).
- **Provider COGS:** Prepaid floats. Not per-task atomic FX.
- **Decision:** [ADR 0005](./adr/0005-provider-float-cogs.md) · ops detail: [PROVIDER_FLOAT_TREASURY.md](./PROVIDER_FLOAT_TREASURY.md).

Agents never hold provider tokens to use XFuel. Provider tokens stay back-office.

## Win / die tests

| Win | Die |
|-----|-----|
| Partners depend on verify_url + budgets weekly | Receipt-only sidecar with no ingest |
| DePIN tiers live under USDC quotes | Become identity for provider networks |
| Private Spend + payment-bound proofs as defaults | Lead with unfinished Tier-3 / race TEE brands |
| Schema gravity (others emit our receipt fields) | Compete on model catalog |

## Non-goals (this horizon)

- Settling buyers in provider gas tokens
- Per-task USDC→provider-token bridge on the inference hot path
- Claiming "ZK = private prompts"
- Becoming company identity for zkLLM

## Operating rule

Live truth: [RUNTIME_STATE.md](./RUNTIME_STATE.md).
