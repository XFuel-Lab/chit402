# Pricing Strategy

**Superseded 2026-08-15 by [ADR 0009](./adr/0009-cost-plus-pricing.md): live pricing is measured provider COGS + 10%, not the rate card.** This file is the research log that led there and still holds the market evidence, the floor arithmetic, the proof-cost measurement and the savings-benchmark rules. Where it describes the rate card as shipped, read that as history — the card survives behind `X402_COST_PLUS=false`. For what is actually charged today see the ADR and [RUNTIME_STATE.md](./RUNTIME_STATE.md).

**Shipped 2026-08-12:** tasks are metered against a rate card (`services/gateway/src/pricing.js`) instead of charged a flat `$0.01`. Sections below marked *superseded* record reasoning that did not survive later research; they are kept because the reasons they failed are the useful part.

Related: [SPEND_INTELLIGENCE_THESIS.md](./SPEND_INTELLIGENCE_THESIS.md) · [PROVIDER_FLOAT_TREASURY.md](./PROVIDER_FLOAT_TREASURY.md) · [VERIFIED_INFERENCE_TIERS.md](./VERIFIED_INFERENCE_TIERS.md) · [ADR 0001](./adr/0001-usdc-revenue-and-router-verifier-positioning.md) · [KNOWN_ISSUES.md](./KNOWN_ISSUES.md)

## The decision that matters more than the number

There are two price ceilings in this market and the one that applies to us depends on how we are described, not on what we build.

| Framing | Ceiling | Evidence |
|---|---|---|
| **A router that resells tokens** | **~5%** | OpenRouter 5% (crypto top-up), Requesty 5%, Eden AI 5.5%, NanoGPT 0% base. Every independent player converged here |
| **A per-call agent API** | **$0.01/call, margin is ours** | CoinGecko $0.01 USDC/request is the canonical x402 implementation; network average ticket ~$0.30 |

At $0.01 against a measured $0.000335 of provider spend, we run a ~30x markup (96.7% gross margin). Adopting OpenRouter's structure — pass tokens through, take 5% — would cut revenue per call to roughly **$0.0000168, about 600x less**. A 5% take rate does support a venture-scale business, but OpenRouter needs ~250 trillion tokens/month to get there.

**So the first rule is positioning: XFuel is a merchant that sells verified calls at a price, not an intermediary taking a cut.** Two things in our own materials currently invite the wrong benchmark and should change:

- We describe a **"0.5% protocol fee."** That language anchors buyers to the 5% router band, and invites the question of why our economics look nothing like 0.5%. It is also economically decorative: 50 base units on a $0.01 task is **$0.00005**, while the actual margin is $0.0096. The fee is not the business; the price is.
- Anything that reads as *a percentage skim on provider cost* competes in a band that tops out at 5% and has a failure proof at 20%: **Akash charged 4% AKT / 20% USDC on lease settlement and abolished it in March 2026** (AEP-23, AEP-76), on the grounds that the fees were negligible against network revenue while distorting settlement. Nobody in decentralised compute extracts double digits on top of provider price.

## Floor: $0.01 is correct, and it is arithmetic

Coinbase's facilitator charges **$0.001 per settled transaction** (first 1,000/month free), so settlement cost as a share of revenue is:

| Sale price | Facilitator fee as % of revenue |
|---|---|
| $0.001 | 100% |
| $0.005 | 20% |
| **$0.01** | **10%** |
| $0.02 | 5% |
| $0.05 | 2% |

CDP's own seller guidance says it outright: a $0.001 endpoint nets nothing. This is why the ecosystem clusters at $0.01 — and why sub-cent pricing needs deferred or batched settlement first (Cloudflare's Deferred Payment Scheme exists for exactly this). Our accidental $0.01 is the right floor. **$0.02 is the comfortable floor.**

## Recommendation: flat price per model class, plus a priced assurance axis

A *single* flat price makes Spend Intelligence worthless to the buyer — if every model costs $0.01, routing cheaper only widens our margin. Pass-through destroys incentive alignment, because waste becomes revenue. Flat-per-class resolves both while fixing the ~6x margin swing between GLM-5.2 and Llama-3.3-70B.

### Correction (2026-08-12): fixed class prices fail the savings test

Modelling the class prices against real rate cards found a gap. At $0.01 / $0.02 / $0.05, **a buyer pays more with XFuel than going straight to a centralised host** on every job size below "long":

| Job (Llama 3.3 70B) | Our COGS (AkashML) | Flat class price | Buyer direct (Together) | Buyer outcome |
|---|---|---|---|---|
| 500 in / 150 out | $0.000125 | $0.01 | $0.00057 | **17x worse** |
| 8k in / 2k out | $0.00184 | $0.02 | $0.0088 | **2.3x worse** |
| 32k in / 8k out | $0.00736 | $0.02 | $0.0352 | 43% better |

The DePIN cost advantage is real — Llama 3.3 70B is ~79% cheaper on AkashML than Together — but under flat pricing **100% of it becomes our margin and none reaches the buyer**. A "here's what you saved" benchmark built honestly would print a negative number for most calls.

### Superseded: `price = max(floor, min(k × COGS, cap × direct))`

The cost-plus multiple `k` was the recommendation until the cost curve was measured. **Price per task in this market falls 5–10x a year** (MIT/Thompson, at fixed benchmark performance on the Pareto frontier), of which ~3x is algorithmic rather than competitive. At 5x, a fixed markup loses ~14% of its absolute value every month. Cost-plus inherits the deflation and none of the upside, so deriving price from COGS — even privately — was the wrong instrument. See `canvases/pricing-architecture.canvas.tsx`.

### Shipped: a rate card we own, metered per request, with a floor

`services/gateway/src/pricing.js`:

```
price = max( floor , prompt_tokens × rate.in + max_tokens × rate.out )
```

| Component | Default | Why |
|---|---|---|
| **`rate.in`** | $0.30 / 1M tokens | Retail, **not** a markup on COGS. Set so a median agent call lands near $0.02 — the median priced x402 route. Every efficiency we find, we keep |
| **`rate.out`** | $0.90 / 1M tokens | 3x input, matching the shape of published cards |
| **Floor** | $0.01 | Settlement costs money regardless of token count. The facilitator takes $0.001/tx, so a sub-floor task nets negative however cheap its tokens were |

Worked against the measured workload shapes, at AkashML Llama 3.3 70B COGS:

| Workload | Prompt | Output | We charge | COGS | Old flat price |
|---|---|---|---|---|---|
| Chat ping | 750 | 105 | $0.010 (floor) | $0.0001 | $0.01 |
| **Agent call (median)** | 68,000 | 247 | **$0.021** | $0.0089 | $0.01 — **broke even at ~2.2M calls/mo** |
| Agent call (P90) | 94,000 | 580 | $0.029 | $0.0125 | $0.01 — loss-making |

Configuration: `X402_USDC_RATE_CARD` (per model family, longest-prefix match), `X402_USDC_FLOOR`, and `X402_USDC_PRICES` for a hand-set flat price that overrides the card. Repricing is deliberate and short-notice — a card decoupled from COGS captures deflation but is fatal in a supply spike, and x402's per-request settlement is what keeps our repricing latency near zero.

#### One row is not enough: the default model was 4.6x underwater

Metering fixed the price and left the card's *shape* wrong. A single `default` row charged the same for every model while AkashML's catalogue spans **$0.037/M to $1.40/M input, a 38x range**, so the row was set for the cheap end and GLM-5.2 was sold at **$0.021 against $0.096 of cost — a $0.075 loss on every median agent call**, worse per call than the flat price it replaced. GLM-5.2 is what both `AKASHML_DEFAULT_MODEL` and `xfuel/auto` resolve to, so the unmodified default path was the loss-making one. Fixed with a per-model row; the default path now returns +$0.112.

This is still not cost-plus. The card does not track COGS as it drifts, and every efficiency we find we keep. Tiers exist because a frontier-class model is a genuinely different product from a small one — which is why every published card has them — not because we recompute a markup.

Two residual holes. A newly-listed dear model falls to the cheap default row until someone adds one, so the backstop is a runtime warning when measured COGS exceeds the settled price (`_warnIfBelowCost`), which catches the loss only after we have taken it. And GLM now costs a buyer **$0.21 against $0.021 for everything else**, which makes routing agent work to it a live commercial choice rather than a hidden subsidy — see the open decision below.

#### The rows only bite if the alias is resolved first

Per-model rows fixed the loss for a caller who *names* GLM-5.2, and nobody does — the documented default is `model_id: "xfuel/auto"`. Pricing ran before routing resolved it, matched `model_id` verbatim, missed every row, and quoted the cheap default for whatever it went on to serve. **The $0.075 loss stayed live on the only path a real caller takes** for a day after being marked fixed, and the unit tests missed it because they priced concrete model ids.

The quote now resolves the alias through the live catalog before pricing (`resolvePricingModel`), using the same request-shape classification routing uses, so the 402 challenge and the settled amount cannot disagree. One consequence is worth stating plainly to buyers rather than hiding: **the same alias is two prices**, ~$0.021 for a short completion and ~$0.21 for agent work, because the shape decides the model. `/task-quote` returns `requested_model` and `priced_model` so the number is explainable.

#### COGS is measured now, not guessed

Margin figures were previously unknowable, because COGS was `gross × 70%` — a share of our own price rather than of the work, circular and wrong by 1.65x to 5.6x. `src/provider-rates.js` prices real tokens at the provider's published per-token rate, read at runtime from the catalogue rather than hardcoded (the table changes: cache-read rates exist on some models and not others, and appeared on one mid-research). Receipts and float burns carry `basis: 'measured' | 'estimated'` so the two are never conflated.

Both hubs are covered. Theta's rate is published too — `cost` over `cost_divisor`, in the unit its `instructions` field names — but **denominated in US cents, which the API never states**; TFUEL is the natural guess and is wrong by ~110x. See [KNOWN_ISSUES.md](./KNOWN_ISSUES.md) for how the unit was pinned. With Theta read correctly, all eight live chat models clear cost at 1.52x to 7.90x, and `theta/glm_5_2` — which `xfuel/auto` preferred *before* the Akash copy at the time — turned out to be the dearest model in the catalogue at $0.106 per median agent call. It is priced, and no longer preferred.

**`payment.maxAmount` no longer sets the price.** It was returned verbatim, so a buyer could name one base unit for a 68k-token job. It is now a ceiling they meet or decline.

Two things metering does not yet do. Output is quoted at the `max_tokens` **ceiling**, because the `exact` scheme prices before the work runs — the `upto` scheme would settle actual output and refund the difference. And prompt tokens are estimated at ~4 chars/token rather than tokenised, which is proportional but not exact.

~~Still open: `/.well-known/x402` advertises only the default price and `/v1/models` carries no price at all.~~ **Closed 2026-08-15.** `/.well-known/x402` publishes a `pricing` descriptor (basis, fee bps, floor, Tier-2 price) and `/v1/models` carries a per-model `pricing` block, so an agent can plan before committing. `_verify_deploy.mjs` asserts the advertised basis is the one `/task-quote` prices with.

### Metering `/v1` — built, and deliberately not switched on

`/v1/chat/completions` is the busiest surface and has always been free, so metering `/task-request` alone earns nothing: the traffic goes through the unmetered door. It is now payable over x402 behind `X402_METER_V1`, priced by the same rate card, with the demo key and `X402_METER_V1_EXEMPT_KEYS` exempt. An unpaid call gets a 402 whose body carries both the x402 `accepts` array and an OpenAI-shaped `error`, so either kind of client can read it. Every `/v1` task now records its token usage whether or not it was charged.

**The flag is off, and turning it on is a commercial decision, not a deploy.** A plain OpenAI SDK cannot satisfy a 402 — the whole point of the OpenAI-compatible surface is that any client works unmodified, and metering it means only x402-aware callers can use it. The options are to keep `/v1` free as a funnel and meter `/task-request`, to meter `/v1` and accept that it serves x402 clients only, or to keep a free tier per key and charge above it. Worth noting the third reintroduces account balances, which the supply-shock analysis argues against.

### Assurance axis: start charging for proofs

Verifiability does **not** command a multiple. Measured TEE premiums land at **10–20%**: GLM-5.2 on Tinfoil vs Together is +13.5%, confidential cloud instances run +10.0% to +18.7%, GPU-level TEE +35%. Nobody in the market sells attestation as a separate line item — the [Confidential Inference directory](https://confidentialinference.net/) has 8 providers and 50 models, none charging an attestation fee. HULDR, the closest analogue to our receipt product, states its model in the negative: revenue is provider stake yield, not call fees.

### Settlement proofs cost $0.050 each — measured, and ~7x the old estimate

**Measured 2026-08-14** from a real request on the Succinct explorer, replacing the
$0.007 self-hosted estimate this section used to carry. Request
`0x073ef49f…384fb8b`, `sp1-v6.1.0`, auction strategy:

| Field | Value |
|---|---|
| Gas used | 58,698 PGU |
| Base fee | 0.341064 PROVE |
| Total fee | 0.341064000000058698 PROVE |
| **Variable component** | **0.000000000058698 PROVE — about $8.6 × 10⁻¹²** |
| **Cost per request** | **≈ $0.050** at PROVE $0.147 |

**The cost is entirely fixed per request.** The variable part is eleven orders of
magnitude below the base fee, so Succinct's "fixed overhead dominates for small
circuits" is not an approximation here — PGU count is irrelevant to what we pay.
Our circuit is 58,698 PGU, far below the 2M this doc previously assumed, and
shrinking it further would save nothing.

That single fact determines the entire economics: **cost per settlement is the
base fee divided by batch size, and nothing else.**

| Batch size | Cost per settlement | Against a $0.0094 platform fee |
|---|---|---|
| **1 — what we actually pay** | **$0.0500** | **5.3x the whole fee** |
| 5 | $0.0100 | 1.06x — still underwater |
| 10 | $0.0050 | 53% of the fee |
| 20 (host maximum) | $0.0025 | 27% of the fee |

**Break-even is batch 6** on a median agent call. Below that, a bundled Tier-2
proof costs more than the entire 10% fee on the call it attests.

**Only the first row is real today, and no setting changes it.** AI-task
settlement proofs cannot be batched at all. `ai-listener.js` calls
`generateProof(request, true)` — `urgent` — which bypasses the queue, and it has
to: in the host, `parse_request_to_batch` handles `ai_task` only in the `Single`
branch, while the `Batch` branch parses `ForwardDeposit` and demands
`merkle_proof` / `identity_secret`. The batch queue, `minBatchSize` and
`SP1_BATCH_TIMEOUT_MS` only ever served legacy TFUEL deposit proofs.

Batching AI tasks means extending the guest's `Batch` branch to accept
`ai_tasks` — a new ELF, therefore a new **vKey**, therefore a vKey update in
`ZKVerifierSP1` on Base. The rows above are the prize for doing that work, not a
description of today. Guest v2 has moved from a nice-to-have to the gating item
for Tier-2 economics.

Two consequences for pricing:

- **Tier-2 cannot be free on every call.** A floor-priced call collects $0.01 in
  total; one unbatched proof against it costs $0.050. That is five times the
  entire payment, not five times the margin.
- **Tier-2 can be bundled above a COGS threshold**, where 10% of provider cost
  comfortably exceeds the amortised proof. This is what `tier2Min` should be
  re-based on — see the open item below.

**We are structurally short PROVE.** Proof COGS is denominated in a token sitting
at its all-time low ($0.1439, set 2026-08-13) after falling ~86% in a year. At
its 1-year-ago price of $1.41 the same proof costs **$0.48**, and batch-20
amortisation only brings that to $0.024 — still 2.6x the platform fee on a median
call. Any decision to bundle Tier-2 free is a bet that PROVE stays cheap.

**Still open:** the measured request used `.compressed()` (the host calls
`prove(...).compressed()`), which is a STARK, not the Groth16 wrap that
`ZKVerifierSP1` verifies on Base. On-chain settlement adds a Groth16 wrap plus
Base calldata gas on top of the $0.050. That figure is not yet measured.

### Full zkML is not a product in 2026, at any price

**Nobody has proven a 1B–8B forward pass.** The 2026 frontier is GPT-2 at 124M parameters (~$0.15–$0.40 per 512-token completion) and Gemma 3 at 270M (~$0.95). Lagrange lists Llama-class models as "in active development".

Against ~$0.0002 of provider spend for a 512-token GPT-OSS-120B completion, that is **~1,000–5,000x the COGS of the call being attested** — and for a model 500x smaller than the ones we actually route. The "60x" figure below was wrong by more than an order of magnitude, which *strengthens* the case for keeping Tier 3c out of the price list entirely.

**The tier we are missing is staked spot-check.** Hyperbolic runs Proof of Sampling in production across a billion tokens daily for 40,000+ developers; Gensyn's Verde ships refereed delegation at roughly 2.6x overhead. The peer-reviewed result worth internalising: **the sampling rate is not the security parameter — the slash is.** A very low sample rate still yields a Nash equilibrium provided the stake is large enough relative to the reward. At p=1% with single-forward-pass verification, overhead is about +0.1%: three orders of magnitude cheaper than zkML, and it is what the two largest verifiable-compute networks actually run.

We currently give proofs away, gated on an amount the buyer used to declare themselves. The gate is now fixed (receipts derive gross from the settled payment), but the price is still zero:

Our tier numbering is **off by one** from how it is often discussed informally — worth fixing before pricing it. `VERIFIED_INFERENCE_TIERS.md` is authoritative: Tier 1 `signed`, Tier 2 `settlement` (SP1), Tier 3 `inference` (3a `tee`, 3b `zk-spotcheck`, 3c `zk-full`).

The pricing *shape* differs by tier, because only one of them scales with job size:

| Tier | Cost multiplier on inference COGS | Shippable 2026? | Proposed |
|---|---|---|---|
| **1 `signed`** | ~1.0x | Live | **Free, permanently.** Baseline assurance, never an upsell |
| **2 `settlement`** (SP1) | **$0.050 flat, unbatchable** | Live | **Opt-in at a flat $0.08** (`X402_TIER2_PROOF_UNITS`). Bundling waits on Guest v2 batching |
| **3a `tee`** | 1.0–1.2x | Via Phala / Tinfoil | Pass through the 0–20% premium |
| **3b `zk-spotcheck`** | **1 + p × ~0.1** | Yes — production elsewhere | **Cost-plus % on the sampled fraction.** The live option |
| **3c `zk-full`** | **~1,000–5,000x** | **No** | **Not a product.** Research only |

**Why a percentage is wrong for Tier 2.** An SP1 settlement proof attests fee arithmetic and a payment binding — the same circuit whether the job was $0.01 or $1.00. The measurement above makes this concrete rather than theoretical: cost is fixed per *request*, independent even of PGU count, so a percentage would undercharge on small jobs and overcharge on large ones for byte-identical work.

**What a percentage is right for is the *gate*, not the price.** Proof cost is flat, so recover it flat — but decide *whether* to bundle by comparing the amortised proof against the fee the call earns. That is a percentage-of-COGS comparison, and it is why `tier2Min` belongs in COGS terms.

**Why a percentage is right for Tier 3b.** Spot-check cost scales with the sampled fraction and the size of the calls sampled, so cost-plus keeps us whole and the sample rate is a dial we control.

Marlin prices `/v1/chat/premium` at $1.00 USDC via x402, so a proof add-on in this band is within observed norms. Tier conversion is also how we *measure* willingness-to-pay for verifiability — no published WTP figure for verifiable inference exists, which is the strongest argument for a tier gate over a guessed surcharge.

### The savings benchmark — and why "DePIN savings" is the wrong frame

**DePIN is not the price floor.** Verified against OpenRouter's live API on 2026-08-12:

| Model | We pay (AkashML) | Cheapest route | Hyperscaler | Verdict |
|---|---|---|---|---|
| Llama 3.3 70B | $0.13 / $0.40 | **$0.10 / $0.32** | Bedrock $0.72 / $0.72 | **We are ~25–30% above floor** |
| GLM-5.2 | $0.77 / $2.42 | $0.50 / $3.15 | Fireworks $2.10 / $6.60 | Dearer input, **cheaper output** — wins on reasoning-shaped work |
| GPT-OSS 120B | $0.037 / — | $0.03 / $0.17 | Consensus $0.15 / $0.60 | Cleanest benchmark model; **AkashML now lists it and we route it** |

DePIN comfortably beats hyperscalers and loses to the best aggregator routes. So the honest claim is not "decentralised GPUs are cheaper" — it is **"we route to whoever is actually cheapest, and prove which one ran."** That is a better story, and it makes the benchmark a forcing function on our own procurement rather than a marketing line.

A secondary source reported GLM-5.2 at $0.07/$0.22, which would have put AkashML 11x above the floor. The live API says $0.50/$3.15 — **that claim was wrong** and is worth remembering as a caution about pricing aggregator blogs.

Rules that keep the benchmark honest:

- **Same model, same token counts, same date.** Comparing our Llama-70B to a frontier model would be flattering and is the standard way these benchmarks lose credibility.
- **Publish the baseline as `{host, model, date, quantisation, context cap}`** and pick the **cheapest credible** same-model host, not the most flattering. DeepInfra shows $0.10 and $0.23 for the same model across trackers — that is an SKU difference, and quoting the low one without naming the SKU is how this goes wrong.
- **Show a negative saving when there is one**, or suppress the line on floor-regime calls. Never round a loss to zero.
- **Reference rate cards need an owner and a refresh job.** Stale baselines are the failure mode.

**The strongest available caution:** LLMRouterBench (Jan 2026, 400k+ instances, 21 datasets, 33 models) found several routing methods — *including OpenRouter's commercial router, at −24.7%* — fail to beat simply picking the best single model. The honest ceiling for a routing-savings claim is ~31.7% at matched performance, with 20–25% typical, against the 85–98% figures still circulating from 2024-era results. Note also that the vendors best placed to publish a counterfactual (Vercel AI Gateway, Cloudflare AI Gateway, OpenRouter) all show spend and decline to show savings, and that Akash's own "$1.33/hr vs $3.93 AWS" claim is documented by independent researchers as unverifiable because the AWS SKU was never specified — a cautionary example inside our own supply chain.

What makes our version defensible is narrow but real: every other vendor compares a *modelled* counterfactual against a *modelled* baseline. Our receipt binds an attested, actually-settled payment to the route that actually ran. Not "trust us on price" but "here is the counterfactual, verify it yourself" — which only holds if we pick the baseline honestly.

**Model choice matters too.** Llama 3.3 70B hit its deprecation date on 2026-07-19, so it is a poor flagship — and a multi-turn agent-loop eval since found it cannot complete an agent loop at all (0/6), which retired it as the default. GPT-OSS 120B has a hard consensus price of $0.15/$0.60 across Groq, Together, Fireworks, Azure and Bedrock, which makes it the cleanest reference we have, and AkashML now lists it, so the benchmark model and a routable model are finally the same thing.

### Spend Intelligence: a plan, not a percentage

**Nobody prices analytics as a share of the spend it observes** — it is per-event or flat, universally. Entry paid tiers cluster tightly at **$29–$79/month** (Langfuse Core $29, Portkey Production $49, Helicone Pro $79, LangSmith Plus $39/seat), with free tiers at 10k–50k events.

The profitable gate is **compliance, not the dashboard**: Helicone steps $79 → $799 for SOC-2/HIPAA, Langfuse $29 → $199. Our thesis already argues the dashboard is not the moat; the market agrees and prices it near zero.

| Tier | Price | Contents |
|---|---|---|
| Included | free | Per-task receipt, **SP1 settlement proof**, **per-call savings benchmark**, `/stats/me` current-window totals |
| **Spend Intelligence** | **$29–$49/mo** | History, per-workload breakdowns, cross-call aggregation, cheaper-route hints |
| **Audit-grade** | **$199–$799/mo** | Long retention, exports, tamper-evident trail, compliance attestations |

The counterfactual moved **out** of the paid tier. Once the savings cap is enforced, the per-call comparison is the proof that our price is fair, so it belongs on every receipt for free — the paid tier sells *aggregation over time*, not the individual number.

Worth noting: a monthly subscription fits the human who approves the invoice, not an anonymous agent. Consider a usage-metered equivalent for pure-agent buyers — and note that with the savings cap doing the assurance work, a subscription may not be needed at all.

**Gain-share on proven savings** is the one place our receipt is genuinely unique — Vertice contractually guarantees a 20% software-spend saving and cannot prove it, whereas we could. Hold it until the counterfactual pricer is trustworthy, because without a quality signal a "saving" may be a quality regression in disguise.

## Rejected, and why

| Option | Verdict |
|---|---|
| **Prepaid credits + 5% top-up fee** (OpenRouter / Eden AI) | **Not as the primary model.** ~600x less revenue per call, needs OpenRouter-scale volume, puts the reasoning tax back on the buyer, and benchmarks us directly against a company with 8M developers. Viable only as an enterprise BYOK option |
| **Sub-cent per-call pricing** | **Unblocked, not yet scheduled.** This was rejected because CDP's `batch-settlement` was not registered server-side. Asking CDP directly on 2026-08-12 says otherwise: `batch-settlement` **is live on Base mainnet** (`receiverAuthorizer 0x3721824a31197dcDD2984cF43b92B6cc8A87c0Fb`), as is `upto`. Both are x402 v2-only, so the v2 migration is the real prerequisite — see [X402_SCHEME_MIGRATION.md](./X402_SCHEME_MIGRATION.md) |
| **Publishing a percentage skim on provider cost** | **No — and this is a framing rule, not a mechanism rule.** Deriving price from cost internally (the `k × COGS` multiple) is fine and is what protects margin. *Advertising* a percentage over provider cost is not: it re-anchors us to the 5% router band and invites "why not 1.05x like OpenRouter?". Akash's abandoned 20% is the existence proof. Publish the price and the saving against the buyer's alternative; the cost basis and the multiple stay internal |
| **Volume discounts on a published schedule** | **No.** OpenRouter states plainly it offers none; Requesty has no minimum. Discount at the enterprise contract instead |

## Open decisions

0. **The cheap tier has a floor falling toward zero.** Sub-4B models — the only class the old flat $0.01 was profitable on — are the exact class becoming free on the buyer's own hardware. Apple runs a ~3B model on-device and routes only ~20% of requests to its servers. Any pricing that leans on small-model volume is leaning on a tier with a disappearing willingness to pay; the rate card should earn on long-context agent traffic, which is where the floor binds least. See [providers/README.md](./providers/README.md).

1. **What should `xfuel/auto` default to? — decided twice on 2026-08-12, and the second answer stands.** Single-turn primitives found all three candidates at 27/27, so the default moved to the cheapest and fastest (Llama 3.3 70B). A multi-turn agent loop then found the opposite: over 18 runs, **GLM-5.2 completed 6/6, GPT-OSS-120B 3/6, and Llama 0/6** — Llama makes three correct tool calls and then abandons the loop to emit Python, and a corrective system prompt only reaches 2/6 ([MODEL_QUALITY_EVAL.md](./MODEL_QUALITY_EVAL.md)). Our beachhead is agent teams, so the default is back on `akash/zai-org/GLM-5.2`. **This is the open commercial question**: the buyer now pays **$0.21 against $0.021** per median agent call. Per *completed loop* the gap is far narrower, because GLM finishes in half the turns using parallel tool calls, but that is measured on small-context turns and does not transfer to the 68k shape. `XFUEL_AUTO_MODEL` flips it without a deploy; GPT-OSS-120B at 5/6 with a system prompt is the defensible cost-led alternative, at 3.5x the latency.

   A second-order effect worth noting: **GLM-5.2 is one of only three models that price cached reads** ($1.40/M fresh against $0.26/M cached, 5.4x), where Llama and GPT-OSS price none. Agent loops resend the conversation every turn, so the default route is now the one where caching could pay — except AkashML does not report cache hits, so the discount is unobservable and unbillable (`scripts/dev/_cache_gate.mjs`). table changes — read them from `/v1/models` at runtime, never hardcode.
2. **Reference rate cards need an owner.** The savings cap and the benchmark both depend on knowing what a centralised host charges. Stale baselines make the claim misleading, so this needs a refresh job and a named source per model.
3. **Confirm Succinct's per-proof base fee** (`GetProofRequestParams`) — it is the whole cost for a circuit our size and it is unpublished.
2. **Does the revenue split base need to change?** ADR 0001 splits the *fee* 40/35/25. At 50 bps on a $0.01 task the buyback bucket receives **$0.0000175 per task** — 1M tasks/month funds $17.50 of buyback, while gross margin on the same volume is roughly $18,000. If the token thesis depends on that split, the base has to be gross margin, not the nominal fee. This needs an explicit call.
2. **Class boundaries will be gamed.** Which model sits in which class, and what happens when a provider re-prices under us?
3. **Envelope enforcement.** Refuse over-envelope calls, or auto-escalate to metered `upto` with the agent's consent?
4. **Unmetered `/v1`.** The busiest surface is free. Metering it is prerequisite to any of this producing revenue.
5. **True COGS remains the gate.** The flat 70% estimate is ~21x off measured actuals, so every margin number above is directional until real usage flows into `provider_cogs.actual`.

## Prerequisites

| # | Item | Status |
|---|---|---|
| 0 | Receipt gross derives from settled payment | **Done** 2026-08-11 |
| 1 | Capture real token usage per task (`src/usage.js`, `/stats.tokens`) | **Done** 2026-08-12 |
| 1b | True COGS from real provider usage, once traffic accumulates | Open — blocking gate |
| 2 | Meter `/v1/chat/completions` | **Built** 2026-08-12 (`X402_METER_V1`, default off) — enabling it is a founder call, see below |
| 3 | Rate card replaces the flat price | **Done** 2026-08-12 (`src/pricing.js`) — superseded by cost-plus, [ADR 0009](./adr/0009-cost-plus-pricing.md) |
| 4 | Advertise per-model price on `/.well-known/x402` and `/v1/models` | **Done** 2026-08-15 |
| 5 | Price the assurance tiers | **Tier 2 done** 2026-08-15 — opt-in, flat $0.08, measured against $0.050 of cost. Tier 3b spot-check is the one still to price |
| 6 | Confirm Succinct per-proof base fee via `GetProofRequestParams` | Open — ~20 min, closes the last cost unknown |
| 7 | Add a provider that reaches the floor on Llama 3.3 70B / serves GPT-OSS 120B | Open — procurement gate on the savings claim |
