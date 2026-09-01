# Spend Intelligence — Product Thesis

Internal product thesis. Not a marketing claim until the gates below are cleared.

> **Superseded in two places (2026-08-12).** This doc argues for **flat per-model-class pricing** and
> for **prepaid credits as the budgeting primitive**. Neither survived. Pricing is now
> **cost-plus** (measured COGS + 10%, `src/pricing.js`, [ADR 0009](./adr/0009-cost-plus-pricing.md)),
> because fixed class prices fail the savings test they were meant to enable. And prepaid credits are ruled out as
> a primary model in [POSITIONING.md](./POSITIONING.md) — deposit-and-draw sells a promise about
> supply we do not own, so a provider price shock lands on us rather than repricing the next call.
> Enterprise BYOK is the one exception. Everything else here — the two-product split, the moat
> argument, the disclosure stance — stands.

Related: [PRIVATE_SPEND_THESIS.md](./PRIVATE_SPEND_THESIS.md), [PROVIDER_FLOAT_TREASURY.md](./PROVIDER_FLOAT_TREASURY.md), [providers/README.md](./providers/README.md), [RECEIPT_SCHEMA_V2.md](./RECEIPT_SCHEMA_V2.md), [KNOWN_ISSUES.md](./KNOWN_ISSUES.md), [ADR 0001](./adr/0001-usdc-revenue-and-router-verifier-positioning.md), [ADR 0005](./adr/0005-provider-float-cogs.md).

## Two products, deliberately separated

**Price assurance — baseline, free, in every receipt.** Proof the buyer got exactly what they paid for: the price quoted was the price charged, the model requested was the model that ran, the provider that served is named, the tokens billed are the tokens the provider billed, and nothing was substituted or added silently. This is not an upsell. Charging for "proof you were not overcharged" implies the free tier might overcharge, which destroys the trust being sold.

**Spend Intelligence — opt-in product.** Aggregation, history, workload breakdowns, and cheaper-route advice. Opt-in matters for a second reason beyond packaging: it makes retention *consented*. "You chose to have your usage metadata kept and analysed" is a far stronger position with a crypto-native buyer than "we analyse everything by default and promise it is only metadata."

## The idea

Agents spend money on inference and cannot see where it goes. XFuel sits in the settlement path across multiple providers, so we can attest what an agent actually got, show what it spent, and route the cheaper way — returning a signed receipt for each decision.

## What is and is not a moat

**The dashboard is not the moat.** Per-token spend breakdowns are table stakes: Helicone, Langfuse, LiteLLM and OpenRouter ship them today, a graph is trivially copyable, and at our volume there is no data network effect to defend. If we position on "we have a usage graph" we lose to incumbents with more traffic.

**The proof is the moat.** Because we hold the money and issue the receipt, we can make a claim no observability vendor can: *we cut your bill by N%, and here is tamper-evident proof of every routing decision and every dollar of provider cost.* A tool that only watches traffic cannot re-route it, and cannot attest to what routing saved.

So the sequencing is: analytics is the hook, automated re-routing is the product, the signed receipt is the defensibility.

| Layer | Who else can do it |
|---|---|
| Token/cost breakdown | Anyone |
| Cross-provider counterfactual pricing | Requires multi-provider rate cards + real usage |
| Act on it — re-route the next call | Requires being in the settlement path |
| Prove the saving cryptographically | Requires issuing the receipt |

This slots directly under the existing positioning: *XFuel is the book. This agent spent Y on this job. You hold hub, model, and amount.* Spend Intelligence is what makes the amount half literal.

## Why we are unusually well positioned

Most of the substrate already exists and was built for other reasons:

| Component | State |
|---|---|
| Per-buyer attribution | `apiKeyHashFromReq` (`buyer-attr.js`) |
| Durable per-task history surviving restarts | `task-store.js` snapshots |
| Authenticated per-key aggregation | `GET /stats/me` |
| `by_provider` / per-rail rollups, 24h + 7d windows | `telemetry.js` |
| Signed, per-task, tamper-evident record | `xfuel.receipt.v3` + `route.provider` |
| Real provider token usage | AkashML adapter (`usage`, `xfuel_source: provider`) |
| Provider rate cards | `CatalogModel.cost` from each hub's `/v1/models` |

`/stats/me` is already the per-agent spend endpoint in skeleton form. The gap is that it aggregates *revenue* (what the buyer paid XFuel), not *cost* (what compute consumed).

## What agents actually want (market evidence, 2026)

x402 carried roughly **165M transactions across 69,000+ agents** (~$50M cumulative) by April 2026, average ticket about **$0.30**. Flat per-call is the established agent-native pattern — CoinGecko's **$0.01 USDC per request** is cited as the canonical implementation because flat pricing is the easiest thing for an agent planner to reason about. XFuel's `$0.01` default is on-pattern.

The decisive finding is that **consumption (per-token) pricing is hostile to the buyer**, and the industry has measured it: growing-context agents replay ~3.6x the input tokens for the same result, and "retry storms, verbose reasoning, and voting ensembles all monetize as your cost." You pay for how the vendor's architecture runs, not for what you got.

Our own measurement is a textbook case: a two-word answer billed **132 output tokens, of which 128 were hidden reasoning**, plus a truncated call that returned nothing and still billed.

**This is why flat per-task pricing is the assurance product, not merely a convenient package.** Under pass-through, waste is revenue and we would profit from the reasoning tax. Under flat pricing we absorb it, so eliminating waste becomes our *margin*. Buyer and seller incentives align structurally, and assurance stops being a promise the buyer has to trust.

Operationally agents also want a price quoted before commitment (`/task-quote` exists; price on `/v1/models` would help), per-task and per-call ceilings in their planner, and **prepaid credit balances with drawdown** — deposit once, deduct per job, hard ceiling, volume discount. "The wallet is the account." That is the buyer-side mirror of the provider floats we already run for COGS.

## Pricing: what we charge today, and why it must change

A full archaeology of the current code (2026-08-11) found **three pricing models coexisting**, none of them reconciled:

| Model | Where | Effect |
|---|---|---|
| Flat per-task USDC, default `10000` ($0.01) | `priceUSDC()` — `x402-server.js:49-55` | What is actually collected |
| 0.5–1.0% fee on a **buyer-declared** `amount` | `calculateTaskFee` — `server.js:297-306` | What the receipt reports |
| Unmetered, synthetic $0.01 receipts | `openai-gateway.js:480` | Free compute on the busiest surface |

Consequences, ranked:

1. **Receipt gross is buyer-declared, not the settled amount.** Critical, and detailed in [KNOWN_ISSUES.md](./KNOWN_ISSUES.md). Must be fixed before any assurance claim ships — a price-assurance product whose price field is self-reported is not a product.
2. **Assurance tiers carry no price premium.** `tier-policy.js:67-84` gates Tier-2/Tier-3 on `amount` floors ($0.01 / $1.00) with no charge difference, so stronger proofs are free and are unlocked by the same self-declared number. That is both revenue left on the table and a cost-attack surface on the prover budget.
3. **Margin varies ~6x by model at one flat price.** GLM-5.2 cost $0.000335 on a call where Llama-3.3-70B would have cost $0.0000554. A reasoning-heavy customer is materially less profitable, and could go negative.
4. **Vestigial pricing from earlier versions of the project** — TFUEL buyer rail, `COMPUTE_BID` escrow, the retired 30/30/25/15 splitter still rendered by the M2M dashboard (`apps/m2m-dashboard/src/utils/api.js:62-67`, contradicting ADR 0001), an unused `serviceType` price key, and `amount` documented as "wei" in MCP while USDC is 6dp.
5. `ai-listener.js:69-70` hardcodes 50 bps, ignoring both `AI_TASK_FEE_BPS` and a request-level `fee_bps`, so two code paths can compute different fees for the same task.

### Recommendation: flat price per model class, plus tiered assurance

The headline from competitive research is that the framing decides the ceiling — a router that resells tokens tops out near a **5%** take rate (OpenRouter, Requesty, Eden AI all converged there; Akash tried 20% and abolished it in March 2026), whereas a per-call agent API anchors at **$0.01** and keeps its margin. We must not be benchmarked as a router. See [ADR 0009](./adr/0009-cost-plus-pricing.md).

A **single** flat price makes Spend Intelligence pointless for the buyer — if every model costs $0.01, "route cheaper" saves them nothing and the entire gain accrues to us. **Pass-through** destroys the incentive alignment above. Flat-per-model-class resolves both:

| Model | Assurance | Buyer savings lever | Margin stability |
|---|---|---|---|
| Single flat price | Strongest | **None** — price is fixed | Poor (~6x swing) |
| **Flat per model class** | Strong | Real — choose a cheaper class | Good |
| Pass-through + % margin | Weakest | Maximal | Buyer eats the reasoning tax |

Price the assurance tier as a second axis (signed / settlement / inference), since it maps to real marginal cost we currently absorb. ~~Keep prepaid credits as the budgeting primitive.~~ — rejected; see the banner above. The budgeting primitive is the per-call ceiling the buyer already sets in the x402 authorization, which caps spend without us holding a balance we owe compute against.

**Disclosure stance (proposed):** merchant, not broker. The buyer is assured about *their* side of the ledger — price known before purchase, nothing added after, and proof of what was delivered. Our cost basis stays internal, exactly as an infrastructure vendor does not publish its input costs. Under flat pricing this is coherent rather than evasive, because the buyer's bill does not vary with our cost. `provider_cogs` therefore remains internal-only and must not be exposed on buyer receipts.

## The gate: true COGS

`provider_cogs.actual` currently copies `estimated`, which is a flat `PROVIDER_COGS_BPS` (70%) of the sale price. Measured live on 2026-08-11 against `zai-org/GLM-5.2`:

| | |
|---|---|
| Sold | $0.010 |
| Float burned | $0.007 (`estimated` = `actual` = `7000`) |
| Actually billed by AkashML | **$0.00033** |
| Error | **~21x over-burn** |
| True gross margin | **96.7%** |

The error runs both ways. Cheap calls over-burn, draining floats ~21x too fast, understating a genuinely excellent margin and tripping false `low_water` refills. Past roughly 2,880 output tokens on GLM-5.2 rates it flips to under-burning and the shortfall is absorbed silently.

**Therefore: no spend product ships on these numbers.** A customer who reconciles our figures against their own provider dashboard and finds them 21x off destroys the credibility the receipts exist to create. Fixing COGS is not a prerequisite in the nice-to-have sense — it is the gate, and it is cheap now that real `usage` and the rate cards are both in hand.

## The artifact that sells it: the counterfactual

Per task, price the same token profile against every provider's published rate card. From the live call above (20 input, 132 output):

| Model | Cost | vs actual |
|---|---|---|
| GLM-5.2 (what ran) | $0.000335 | — |
| Llama-3.3-70B | $0.0000554 | ~6x cheaper |

This is arithmetic over data we already hold, and it produces a concrete per-task line item rather than a vague "consider a smaller model."

**Two honest caveats that must ship with it.**

It is not apples to apples. GLM-5.2 is a reasoning model that spent 128 of its 132 output tokens on hidden `reasoning_content` — only 4 tokens were the answer. A non-reasoning model would not pay that tax at all, so the true saving is likely *larger* than the rate-card delta suggests. But output quality may differ and **we have no eval signal**.

Therefore recommendations are advisory, never a silent auto-downgrade. Quietly degrading a customer's product output to save $0.0003 loses the account far faster than the saving wins it. Auto-routing to a cheaper model requires either explicit opt-in per workload or a quality signal we do not yet have.

## Privacy is the wedge, not the obstacle

"Capture agent data" is the wrong instinct and cuts against [Private Spend](./PRIVATE_SPEND_THESIS.md). Our beachhead — crypto-native agent teams — is precisely the cohort most hostile to a vendor profiling their prompts.

We do not need prompts. Tokens, model, provider, cost, latency and outcome produce every number in this document. `telemetry.js` is already built this way ("no task ids, no senders, no model output"), as is the auditor export ("policy + totals only").

That constraint is a differentiator: **auditable spend without surveillance**, while observability incumbents retain full prompt logs. Any implementation that requires storing prompt or completion text to compute a metric is out of scope by default.

## Surface: API before graph

A graph serves the human who approves the invoice, and is worth having for that. But agents do not read graphs, and agents are the buyer.

The value lands when an agent can read a cheaper-route hint off a response, or call a tool, and re-route itself. We already ship `npx xfuel-mcp` and `packages/agent-skills`, so the agent-native surface is a spend-report tool plus a routing hint — not a web page.

1. **Receipt line** (per task) — true cost + counterfactual. Already-signed envelope; smallest change.
2. **MCP / API** (`get_spend_report`, cheaper-route hint) — where an agent can act autonomously.
3. **Account graph** (extend `/stats/me`) — for the human buying decision.

## Build sequence

| # | Step | Why in this order |
|---|---|---|
| 0 | ~~**Receipt gross = settled x402 amount**~~ | **Shipped 2026-08-11.** Blocking; assurance is meaningless while the price field is buyer-declared |
| 1 | ~~True COGS — real `usage` × rate card into `provider_cogs.actual`~~ | **Shipped 2026-08-12** (`provider-rates.js`, `basis: measured`) |
| 2 | ~~Meter `/v1/chat/completions`~~ | **Shipped 2026-08-12**, behind `X402_METER_V1` — turning it on is a founder call |
| 3 | ~~Price per model class~~ → **metered per-model rate card** + priced assurance tiers | Price shipped; **assurance tiers are still free** |
| 4 | Counterfactual pricer on the receipt | The artifact that demonstrates value, advisory only |
| 5 | Agent surface — MCP spend report + route hint | Where an agent acts on it |
| 6 | Extend `/stats/me` into a spend graph | Human buying decision |
| ~~7~~ | ~~Prepaid credit balance with drawdown~~ | **Rejected** — supply-shock exposure; see the banner above |
| 8 | Opt-in auto-routing on a cost ceiling | Only with explicit opt-in or a quality signal |

Steps 0–2 are correctness work we owe regardless of whether this product ships — step 0 is arguably a live integrity bug rather than a roadmap item. Steps 3–8 are the product.

## Open questions

- ~~**Price points.**~~ Answered by metering: `DEFAULT_RATE_CARD` in `pricing.js` carries a row per model with a floor, so there are no classes to size.
- **Assurance tier pricing.** What does a settlement (SP1) or inference (Tier-3) proof cost us per task, and what is it worth? Today both are free and gated on a self-declared amount. Costed since: an SP1 settlement proof is ~$0.007 on Base, cheap enough to include free ([PRICING_STRATEGY.md](./PRICING_STRATEGY.md)).
- **Quality signal.** Auto-routing needs one. Partially answered: multi-turn agent-loop pass rate separates models where single-turn scores do not, and `xfuel/auto` now routes on request shape off that evidence ([MODEL_QUALITY_EVAL.md](./MODEL_QUALITY_EVAL.md)). Still not a per-call signal, so **auto-downgrade remains off**.
- **Rate-card drift.** Published prices move (GLM-5.2 is currently 45% off). A cached card silently misprices COGS — refresh cadence and a staleness bound are needed.
- **Non-token models.** AkashML publishes a `pricing_config` for models priced on request-level factors rather than tokens. The pricer must handle both or explicitly refuse.
- ~~**Prompt caching.**~~ Measured 2026-08-12 and smaller than modelled: the cache is real (~2–3x on prefill) but **AkashML reports no cached-token field**, so the discount cannot be observed, billed against, or put in a receipt. Roughly 2.5x at an 80% hit rate on models that price cached reads, 1.0x on those that do not ([KNOWN_ISSUES.md](./KNOWN_ISSUES.md)).
- **Retention window.** How long do metadata rows live, and what does the customer-facing retention promise say?

## Status

Thesis only — nothing here is built or promised. Promote to an ADR (0006) once the approach is accepted, since the metadata-only boundary and the advisory-not-automatic stance are architectural commitments rather than implementation details.
