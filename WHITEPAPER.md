# XFuel Protocol — Whitepaper

**Version 2.6 · July 2026**

Verifiable settlement and payments for AI compute.

This document describes protocol design. For live endpoints and what is real versus mock, see [runtime state](docs/RUNTIME_STATE.md). For product messaging, see [positioning](docs/POSITIONING.md).

---

## Abstract

XFuel is a modular settlement layer for AI compute. Agents and applications submit inference tasks; XFuel routes each task to a configured provider, settles fees in USDC via x402 on Base, and returns a verifiable receipt.

Trust is tiered:

1. **Signed receipt** (default) — route, model, cost, and output hash
2. **SP1 settlement proof** (on demand) — fee correctness, payment binding, output commitment, and a single-use nullifier on Base
3. **Verified Inference** (active build) — proof that an exact open-weight model ran on the input (self-owned zkLLM prover)

The product is settlement and proof. Providers (OpenAI-compatible APIs, neoclouds, DePIN GPUs) are pluggable. Money and proof verification live on Base. See [ADR 0002 — Base settlement home](docs/adr/0002-base-settlement-home.md).

---

## Table of Contents

- [1. Introduction](#1-introduction)
- [2. Core Layer](#2-core-layer)
- [3. Trust tiers](#3-trust-tiers)
- [4. Routing and payments](#4-routing-and-payments)
- [5. Revenue](#5-revenue)
- [6. Governance](#6-governance)
- [7. Tokenomics](#7-tokenomics)
- [8. Security](#8-security)
- [9. Roadmap](#9-roadmap)
- [References](#references)

---

## 1. Introduction

AI agents increasingly buy inference with API keys and opaque invoices. XFuel replaces that with budgeted, auditable spend: pay per task in USDC, route to the best available provider, and receive a receipt that can be shared and verified.

Design principles:

- **Modularity** — circuits plug into a Core Layer via events; no shared circuit state
- **Provider-agnostic** — the router selects among configured providers; none is settlement home
- **Base-settled** — USDC and proofs on Base
- **Tiered trust** — proof cost tracks value at risk; scope is stated honestly per tier
- **Token-light** — fees in USDC; XF / veXF for governance when the token exists

---

## 2. Core Layer

The Core Layer is a minimal hub on Base:

| Component | Role |
|-----------|------|
| `ZKVerifierSP1` | SP1 Groth16/PLONK verification, nullifiers, circuit registry |
| USDC fee sink | `X402_PAY_TO` / Splits v2 (protocol Safe) |
| `veXFGovernance` | Vote-escrowed governance (post-TGE) |
| `SP1ProofHooks` | Nullifiers, fee commitments, public-value encoding |
| Gateway | Off-chain routing, payments, proving, receipts (`services/gateway`) |

Circuits are independent modules (inference, A2A, bridge, zkML, DePIN, and others). They emit intents and consume settlement events. Catalog: [circuits guide](docs/CIRCUITS.md).

**Flow:** users and agents → gateway → providers; USDC fee on Base; optional SP1 proof → `ZKVerifierSP1`.

---

## 3. Trust tiers

1. **Signed receipt** (default, live) — route, model, cost, and output hash, signed by XFuel.
2. **SP1 settlement proof** (on demand, live) — fee correctness, payment binding, output-hash commitment, and a single-use nullifier on Base (~25s, ~270K gas).
3. **Verified Inference** (active build) — proves that an exact open-weight model ran on the input via the self-owned zkLLM prover.

Tier 2 proves **settlement**, not that a black-box API computed a model correctly. Tier 3 applies where model weights are available. Details: [Verified Inference tiers](docs/VERIFIED_INFERENCE_TIERS.md).

Live verifier on Base mainnet:

```text
ZKVerifierSP1 = 0x9373499645292715a2275A78eD65B14215C41c06
```

Payment binding (x402 `payment_ref` to task) is server-attested today. In-proof binding activates with the SP1 guest v2 public-values layout (`SP1ProofHooks.encodeAITaskPublicValuesV2`).

Gas benchmarks: [technical specifications](docs/Technical-Specifications.md).

---

## 4. Routing and payments

Tasks enter via `POST /task-request`, the OpenAI-compatible `/v1` surface, MCP, or the SDK. The gateway selects a provider from a configurable list (typically neocloud / OpenAI-compatible, then optional DePIN GPU tiers, then local / last resort).

Default payment rail: **USDC on Base via x402** (agent-side payer, no server keys).

- REST API — [M2M API](docs/M2M_API.md)
- Payments — [x402 adapter](docs/X402_ADAPTER.md)

---

## 5. Revenue

Protocol fees (typically 0.1%–1% by task type) settle in USDC to one Base address (Safe / Splits v2). Downstream distribution is governance-set treasury policy — not a hardcoded per-fee split and not a fixed staker yield.

See [ADR 0001 — USDC revenue](docs/adr/0001-usdc-revenue-and-router-verifier-positioning.md).

---

## 6. Governance

When XF launches on Base, holders lock XF for veXF (Curve-style, up to 3× for a 3-year lock) and vote on circuit priority, fee parameters, treasury policy, large spends, and emergency pause. Implemented in `veXFGovernance.sol`.

Fundraising today is equity-first (SAFE). See [fundraising structure](docs/FUNDRAISING_STRUCTURE.md).

---

## 7. Tokenomics

- **Total supply:** 1,000,000,000 XF
- **Standard:** ERC-20 on Base at TGE
- **TGE:** deferred

Allocation is forward-looking (community, strategic, ecosystem, team, treasury, LP). Utility: governance (veXF) and optional treasury buyback policy. Do not claim fixed fee-share yield to stakers.

---

## 8. Security

- SP1 settlement proofs with nullifier replay protection
- Role-based access, pausability, and circuit breakers on verifiers
- Non-custodial payments (agent signs USDC)
- **Audit Phase 1:** `contracts/core/`, primary inference circuit, `SP1ProofHooks` (Base)
- **Bug bounty:** up to $50,000 — [bug bounty program](docs/bug-bounty.md)

---

## 9. Roadmap

**Now:** security audit of the Base core; Base mainnet x402 facilitator; finish the Tier-3 zkLLM prover (spot-check through on-chain verify).

**Later:** extended circuit audits; veXF live post-TGE; optional cross-chain proof relay; additional provider tiers.

Build history: [CHANGELOG](CHANGELOG.md).  
Tier-3 status: [Verified Inference handoff](docs/VERIFIED_INFERENCE_HANDOFF.md).

---

## References

- [Runtime state](docs/RUNTIME_STATE.md) — as-deployed endpoints
- [Positioning](docs/POSITIONING.md) — messaging
- [Architecture decisions](docs/adr/) — ADRs
- [Circuits](docs/CIRCUITS.md) — circuit catalog
- [Technical specifications](docs/Technical-Specifications.md) — gas / benchmarks
- [References and attribution](docs/REFERENCES-AND-ATTRIBUTION.md) — research credits

https://xfuel.app · https://github.com/XFuel-Lab/xfuel-protocol
