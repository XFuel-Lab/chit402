# Known Issues (Diligence)

Honest gaps for auditors, design partners, and Seed diligence. Keep this current.

Last updated: 2026-08-11  
Runtime truth: [RUNTIME_STATE.md](./RUNTIME_STATE.md)

## Production / money

| Issue | Severity | Status |
|-------|----------|--------|
| ~~Receipt `gross_amount` is buyer-declared, not the amount x402 collected~~ | **Critical** | **Fixed 2026-08-11** — gross derives from the settled challenge amount. Historical rows still inflated, see below |
| **Live `/stats` USDC fee totals are ~100x overstated by pre-fix task rows** | **High** | Open — do **not** quote current `/stats` fees in the deck |
| ~~Assurance tier selected from buyer-declared `amount`~~ | High | **Fixed 2026-08-11** — tier floors now read settled gross |
| Provider COGS burns a flat 70% of quote, measured ~21x off actual | High | Open — [SPEND_INTELLIGENCE_THESIS.md](./SPEND_INTELLIGENCE_THESIS.md) |
| ~~Base mainnet x402 facilitator not wired on live demo host~~ | — | **Resolved 2026-08-06** — public `api-testnet` on Base + CDP |
| Payment binding is server-attested (`in_proof: false`) until SP1 guest v2 | Medium | Guest rebuild + new programVKey required |
| OpenAI-compatible `/v1` path is **unmetered** (Phase 1) | Medium | Paid path = `/task-request` + x402 |
| Web2 collect-and-forward custody not counsel-cleared | High if scaled | Do not enable broad OpenAI pass-through revenue yet |

### Receipt gross vs collected payment (Critical)

Two independent numbers are in play on `POST /task-request` and nothing reconciles them:

- **What is charged** — `priceUSDC()` returns `payment.maxAmount` when the caller supplies it, else the flat `X402_USDC_PRICE_DEFAULT` (`10000` = $0.01). See `services/gateway/src/x402-server.js:49-55`.
- **What the receipt reports** — `req.body.amount`, supplied by the caller, drives `calculateTaskFee` and `payment.gross_amount` / `fee_amount` / `net_amount` (`server.js:651-653`, `receipt.js:380-387`).

A caller therefore controls both values independently and can pay $0.01 while minting a signed receipt asserting any gross it likes. Blast radius: signed receipts overstate settled value, `/stats` fee totals include revenue never collected, SP1 proofs bind a payment amount that may be fictional, and tier floors are trivially satisfied.

**Our own flagship demo does this.** `packages/sdk/examples/flagship-demo.ts:88` sets `XFUEL_AMOUNT=1000000` ($1.00) while line 160 pays `maxAmount: usdc.amount` ($0.01), so every receipt it produces claims **$1.00 gross for a $0.01 payment** — under a banner reading "prove every dollar" (line 137).

This is a product-integrity issue, not a rounding nit: it is the one field a price-assurance product cannot get wrong.

**Fixed 2026-08-11.** `runX402Handshake` now returns `settledAmount`, read from the challenge record bound to the payment nonce (captured before `settlePayment` marks it spent). `/task-request` uses that as gross for fee math, `intent.amount`, receipts, and tier floors, and logs a warning when the caller's declaration diverges. The declared `amount` remains authoritative only for legacy TFUEL, which has no settlement to derive from. Regression test: *"settled gross cannot be restated by the paid retry"* in `services/gateway/test/x402-server.test.mjs`.

### Historical `/stats` inflation (open)

The fix stops new bad rows but does not retroactively correct task records already written. Measured on the live testnet host at 2026-08-11T17:02Z:

- USDC rail: **26 tasks, 130,000 base units of fees** ($0.13)
- That averages **5,000 units of fee per task**, which at 50 bps implies **$1.00 gross per task** — the pre-fix demo default
- True fees, had gross been the $0.01 actually paid: 26 × 50 = **1,300 units (~$0.0013)**

So the headline "USDC fees" figure reads about **100x** the amount actually collected, matching the $1.00-declared / $0.01-paid ratio exactly. The 7d panel ($0.03 over 6 USDC tasks) has the same 100x factor.

Treat pre-2026-08-11 USDC fee totals as unusable. Options: backfill `feeAmount` on affected records from their settled payment, or window `/stats` to post-fix tasks. **Do not quote current `/stats` fee figures externally** — including in [FOUNDER_ACTIONS.md](./FOUNDER_ACTIONS.md) item 10 (seed deck).

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
