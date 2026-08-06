# Private Spend — Privacy Thesis

Internal product thesis (Sprint 1). Not a marketing claim until Private Spend v0 ships.

Related: [POSITIONING.md](./POSITIONING.md), [BEACHHEAD_ICP.md](./BEACHHEAD_ICP.md), [RECEIPT_SCHEMA_V2.md](./RECEIPT_SCHEMA_V2.md).

## Problem

Frontier AI providers see more than prompts. With a customer API key they observe:

- Model mix and version adoption
- Spend volume and timing
- Agent / app topology (how many keys, which products)
- Multi-homing and competitive evaluation

That telemetry is asymmetric power: pricing, rate limits, product steering, and competitive intelligence. Enterprises and serious crypto teams increasingly treat this as a strategic risk — not only a GDPR/prompt-privacy issue.

## What XFuel is not claiming

| Claim | Status |
|-------|--------|
| “ZK means your prompts are private” | **False** if the provider still sees plaintext |
| “We are a confidential LLM / TEE company” | **Out of scope** as identity — compose Phala-class tiers later |
| “On-chain settlement hides all spend” | **False** without commitments / batching |

## Three layers

1. **Content privacy** — prompts/outputs. Compose TEE / local / open-weight. Not Sprint 1.
2. **Spend / usage privacy** — who sees the spend graph. **XFuel wedge.**
3. **Settlement privacy** — what the chain reveals. Extend Tier-2 with commitments later.

## Product: Private Spend

### v0 (Sprint 2 target)

- Buyer pays XFuel via x402 (USDC budget).
- Gateway routes using **XFuel-held / pooled provider credentials**.
- Provider sees XFuel traffic, not the end-customer org identity.
- Buyer receives signed receipts + **buyer-only** usage analytics.
- Docs state the trust shift: telemetry moves to XFuel unless minimized / TEE’d later.

### v1 (Sprint 4 target)

- Selective disclosure export: auditor sees policy + totals, not raw prompts.
- Policy caps / allowlists on the budget.
- Explicit retention / log-minimization policy.

### Later

- Confidential route: TEE provider tier wrapped with XFuel settlement receipt.
- Shielded / batched settlement amounts on Base.

## Positioning line (when v0 is live)

Keep: *Route any model. Prove every dollar.*  
Add: *Spend without briefing the frontier lab.*

## Trust boundary (must stay in docs)

```
Buyer ──x402──► XFuel gateway ──provider key──► OpenAI / neocloud / …
                 │
                 ├── signed / SP1 receipt → buyer, optional chain
                 └── usage analytics → buyer only (v0)
```

v0 is **gateway-trusted**. Do not market it as trustless privacy.

## Engineering notes (forward)

- Feature flag: `PRIVATE_SPEND_ENABLED`
- Separate provider credential pool from any customer-supplied keys
- Receipt fields: `privacy.mode = vendor_blind`, no provider-side customer id
- Never forward buyer org metadata in provider request headers
- Log policy: no prompt bodies in long-term storage by default when Private Spend is on

## Decision

Ship Private Spend as a **named product mode**, not a blog footnote. It differentiates XFuel from OpenRouter-class routers and complements settlement proofs without waiting on Tier-3 zkLLM.

## Implementation status (Sprint 2)

| Piece | Status |
|-------|--------|
| `PRIVATE_SPEND_ENABLED` config | Live in gateway |
| Task `meta.apiKeyHash` + `privacyMode` | Live on `/task-request` + OpenAI path |
| Receipt `privacy` block | Live |
| Buyer `GET /stats/me` | Live |
| SDK `getReceipt` / `getMyStats` | Live |
| TEE / content privacy | Not in v0 — compose later |
| Metered OpenAI path via x402 | Still Phase 1 unmetered — use `/task-request` for paid Private Spend |

Founder enablement: [FOUNDER_ACTIONS.md](./FOUNDER_ACTIONS.md).
