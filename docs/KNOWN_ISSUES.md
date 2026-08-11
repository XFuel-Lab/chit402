# Known Issues (Diligence)

Honest gaps for auditors, design partners, and Seed diligence. Keep this current.

Last updated: 2026-08-06  
Runtime truth: [RUNTIME_STATE.md](./RUNTIME_STATE.md)

## Production / money

| Issue | Severity | Status |
|-------|----------|--------|
| ~~Base mainnet x402 facilitator not wired on live demo host~~ | — | **Resolved 2026-08-06** — public `api-testnet` on Base + CDP |
| Payment binding is server-attested (`in_proof: false`) until SP1 guest v2 | Medium | Guest rebuild + new programVKey required |
| OpenAI-compatible `/v1` path is **unmetered** (Phase 1) | Medium | Paid path = `/task-request` + x402 |
| Web2 collect-and-forward custody not counsel-cleared | High if scaled | Do not enable broad OpenAI pass-through revenue yet |

## Trust / product honesty

| Issue | Severity | Status |
|-------|----------|--------|
| Tier-2 does **not** prove black-box LLM correctness | — | Documented; do not overclaim |
| Private Spend is **gateway-trusted**, not prompt encryption | — | Thesis + receipts state this |
| Tier-3 Verified Inference not E2E on-chain | Medium (moat timeline) | Narrowed: [TIER3_TIMEBOX_DECISION.md](./TIER3_TIMEBOX_DECISION.md) |
| Confidential / TEE provider tier is opt-in stub | Low | Needs `CONFIDENTIAL_PROVIDER_*` env |

## Ops

| Issue | Severity | Status |
|-------|----------|--------|
| Demo gateway is single Lightsail + IP-locked prover ALB | Medium | Staging SLA draft; not enterprise HA |
| Prover may be scaled to 0 (cost) → proofs gated | Medium | Document for partners |
| A2A message store is in-memory (not durable like task receipts) | Low | Receipt lineage on tasks is durable |

## Narrative residue

| Issue | Severity | Status |
|-------|----------|--------|
| Legacy Theta / Believer decks (removed; in git history) | Low | Do not use for fundraising; go-forward = POSITIONING.md |
| Public marketing site may still need scrub | Medium | Founder: site/deck pass |

## Not bugs

- TFUEL rail exists as optional fallback only when explicitly enabled.
- Theta EdgeCloud remains an optional GPU provider, not settlement home.
