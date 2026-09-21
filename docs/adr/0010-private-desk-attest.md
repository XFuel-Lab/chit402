# ADR 0010 — Private Desk and Private + Attest

Status: accepted (2026-09-21)  
Related: [PRIVATE_SPEND_THESIS.md](../PRIVATE_SPEND_THESIS.md), [ADR 0009](./0009-cost-plus-pricing.md), Phase 0 note `PRIVATE-DESK-ATTEST-PHASE0.md`.

## Context

Buyers want vendor-blind routing (gateway-pooled credentials) with a signed receipt they hold, and optionally a third-party-verifiable Tier-2 SP1 settlement proof. Public routing stays cost + 1% with a $0.002 hop floor.

## Decision

Two named SKUs on the live `/v1` door (and task meta on `/task-request`):

| SKU | Wire `xfuel.privacy_product` | Price | Proof |
|-----|------------------------------|-------|-------|
| **Private Desk** | `private_desk` | cost + 1% (same `fee_bps` 100 door) | Tier-1 JWS only |
| **Private + Attest** | `private_attest` | cost + 1% + **$0.10** Tier-2 (`tier2_proof` on quote/receipt) | Tier-2 SP1 required |

Receipt fields:

- `privacy.mode = vendor_blind` for both SKUs
- `privacy.product` = `private_desk` | `private_attest`
- `privacy.attest = tier2` only for Attest
- verify_url chrome: human labels **Private Desk** / **Private + Attest**

**Trust boundary (Desk):** gateway-trusted vendor-blind routing — not trustless, not prompt-private, not ZK-for-content.

**Attest:** fail closed if the prover is unavailable, the API key cannot prove, or `payment_binding.in_proof` is missing after the synchronous prove step. No successful Attest response without in-proof binding.

Possession sessions and `PRIVATE_SPEND_ENABLED=true` continue to imply **Private Desk** when no explicit product is set.

## Consequences

- Quoting adds `proof_tier: settlement` (and `tier2` line item) when `private_attest` is requested.
- Existing public and Bankr paths unchanged when the product field is omitted.
- www pricing names both SKUs; Attest may be allowlist-gated in production (`PROVER_ALLOW_KEYS`).
