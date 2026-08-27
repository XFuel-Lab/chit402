# Seed Deck Outline (Live Metrics Only)

Paste into Pitch / Gamma / slides. Do **not** invent volume numbers — pull from `GET /stats?format=json` after mainnet.

Related: [STRATEGY.md](./STRATEGY.md), [SEED_READINESS.md](./SEED_READINESS.md), [POSITIONING.md](./POSITIONING.md), [KNOWN_ISSUES.md](./KNOWN_ISSUES.md).

Use [STRATEGY.md](./STRATEGY.md) language: XFuel is the book (hub, model, amount); DePIN as supply; tiers as ladder. Not a smart router. Not a model shop.

---

## Slide 1 — Problem

**Agents spend money. API keys and opaque invoices do not scale.**

- Autonomous agents need budgets, not shared org credentials
- Cheap DePIN GPUs fragment supply; frontier labs observe spend topology
- Finance / treasury need exportable receipts, not Discord screenshots

## Slide 2 — Insight

**Payments commoditized (x402). The clearing layer did not.**

- Coinbase / Stripe / platforms own rails; GPU markets own supply
- XFuel is the book above both: this agent spent Y on this job; you hold hub, model, and amount

## Slide 3 — Product

**XFuel is the book. This agent spent Y on this job. You hold hub, model, and amount.**  
*(When Private Spend live: Spend without briefing the frontier lab.)*

| Layer | What |
|-------|------|
| Gateway | OpenAI-compatible + `/task-request` + MCP/SDK |
| Money | USDC via x402 on Base (provider COGS = prepaid floats) |
| Trust | Signed receipt → SP1 settlement proof on demand → Tier-3 option |
| Privacy | Private Spend (vendor-blind) — gateway-trusted |

## Slide 4 — Proof (fill live)

| Artifact | Value |
|----------|-------|
| Verifier (Base) | `0x9373499645292715a2275A78eD65B14215C41c06` |
| Public API | `https://api.xfuel.app` |
| Paid tasks (7d) | `[from /stats north_star.paid_tasks_7d]` |
| USDC fees (7d) | `[from /stats north_star.usdc_fees_7d]` |
| Design partners | `[N named]` |

Demo: SDK `private-spend-budget.ts` or flagship demo. Auditor: `?format=auditor`.

**Do not show:** mock facilitator as production; Tier-3 as live; Theta as settlement home.

## Slide 5 — GTM

Beachhead: **crypto-native agent teams on Base** (x402 / CDP familiar). See [STRATEGY.md](./STRATEGY.md) motions.

- Eliza / MCP embed · Virtuals agent sidecars · swarm operators · Akash/Theta co-sell
- 10 outreach → 3 design partners · install &lt; 1 day
- Expand → A2A multi-hop receipt chains

## Slide 6 — Moat path (honest)

1. Routing machine + payment-bound settlement proofs (guest v2)
2. Private Spend + selective disclosure
3. Provider floats under USDC quotes (DePIN cost edge without buyer FX)
4. Tier-3 Verified Inference as **premium SKU** (timeboxed; open-weight) — not company identity

Compose TEE providers for content privacy; do not race EigenAI on latency.

## Slide 7 — Ask

Equity-first SAFE (USDC) + token warrant · See [FUNDRAISING_STRUCTURE.md](./FUNDRAISING_STRUCTURE.md)

**Use of funds:** mainnet payments ops, design partners, audit, staging HA, counsel.

**Milestones:** mainnet USDC fees → audit underway → Seed unlock.

## Appendix (optional)

- Known issues one-pager
- Trust tier honesty table
- Architecture: agent → gateway → provider; USDC on Base; optional SP1
