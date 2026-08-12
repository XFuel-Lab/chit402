# Pricing Strategy

Proposed. Numbers here are recommendations for decision, not shipped prices — today's live behaviour is a single flat `$0.01` (`X402_USDC_PRICE_DEFAULT`).

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

### Price schedule (revised)

```
price = max( $0.01 floor , min( k × COGS , cap × direct_price ) )
```

Three regimes, each with a job to do:

| Component | Default | Purpose |
|---|---|---|
| **Floor** | $0.01 | Settlement economics — the facilitator takes $0.001/tx, so below this 10%+ of revenue goes to settlement |
| **Multiple `k`** | 2.5x COGS | Guarantees margin never falls below 1.5x cost. This is the "percentage on bigger jobs" |
| **Cap** | 0.7 × direct | Makes the DePIN savings claim structurally true rather than a marketing assertion |

**A single global multiple does not work**, which is why the cap is load-bearing. The DePIN discount is not uniform: Llama 3.3 70B is ~79% below Together, but GLM-5.2 is only ~45% below. Applying 2.5x cost-plus to a GLM-5.2 standard job gives $0.0275 against a $0.02 direct price — we would overcharge relative to the buyer's alternative while believing we were being fair. The cap catches it.

Model **classes survive as COGS bands** (which rate card applies), not as fixed price points. Token envelopes are no longer needed to prevent context-stuffing losses, because cost-plus scales with the job automatically — though a ceiling is still worth keeping as abuse protection.

Where the floor binds (small jobs), **we should make no savings claim at all**. There we are selling settlement access and a receipt, not a cheaper token.

Interactive model: `canvases/pricing-model.canvas.tsx`.

**Implementation is mostly configuration, not code.** `X402_USDC_PRICES` already accepts a JSON map keyed by model id and `priceTaskUSDC()` already consults it. The gaps are that `/.well-known/x402` advertises only the default price (`x402-discovery.js:102`) and `/v1/models` does not carry price at all — both should expose the schedule so an agent can plan before committing.

### Assurance axis: start charging for proofs

Verifiability does **not** command a multiple. Measured TEE premiums land at **10–20%**: GLM-5.2 on Tinfoil vs Together is +13.5%, confidential cloud instances run +10.0% to +18.7%, GPU-level TEE +35%. Nobody in the market sells attestation as a separate line item — the [Confidential Inference directory](https://confidentialinference.net/) has 8 providers and 50 models, none charging an attestation fee. HULDR, the closest analogue to our receipt product, states its model in the negative: revenue is provider stake yield, not call fees.

### Settlement proofs cost ~$0.007 — cheap enough to give away

Costed properly (2026-08-12), a Tier 2 SP1 proof is far cheaper than assumed:

| Component | Cost | Basis |
|---|---|---|
| SP1 proving, self-hosted, <10M cycles + Groth16 | **~$0.003** | ~10.6s on an L4 at $0.80/hr; cross-checked against Ethproofs' $0.0376 per full Ethereum block |
| Groth16 verification **on Base** | **~$0.004** | 275k–300k gas at 0.005 gwei; Base's own docs give ~$0.002 for 200k gas |
| **All-in** | **~$0.007** | **<$0.005 batched** — the STARK→SNARK wrap is near-constant, so batching N settlements divides it N ways |

The **$3–$18 figure is Ethereum mainnet**. On Base it is roughly **1,000x cheaper**, which is not a detail — it changes the tier. At $0.007 a settlement proof costs less than a tenth of the $0.10 previously proposed for it, so it is affordable to **include free on every paid call**. That turns cryptographic settlement proof from an upsell into a default nobody else offers, and makes any future tier gate a willingness-to-pay experiment rather than cost recovery.

**Open:** we run `SP1_PROVER=network`, so our real cost is Succinct's, not self-hosted. Their pricing is a live auction (`base fee + PGU × price/PGU`) and **the base fee is not published**. For a sub-2M-PGU circuit like ours, Succinct says fixed overhead dominates — so the base fee is essentially the whole cost. Closing this is a ~20 minute task: run `client.execute()` for the real PGU count, then read `GetProofRequestParams` for the live `GROTH16_FEE`.

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
| **2 `settlement`** (SP1) | **~$0.007 flat** | Live | **Free on paid calls.** Flat if ever charged — a percentage is wrong here |
| **3a `tee`** | 1.0–1.2x | Via Phala / Tinfoil | Pass through the 0–20% premium |
| **3b `zk-spotcheck`** | **1 + p × ~0.1** | Yes — production elsewhere | **Cost-plus % on the sampled fraction.** The live option |
| **3c `zk-full`** | **~1,000–5,000x** | **No** | **Not a product.** Research only |

**Why a percentage is wrong for Tier 2.** An SP1 settlement proof attests fee arithmetic and a payment binding — the same circuit whether the job was $0.01 or $1.00. Proof cost is flat while a percentage would scale, so 5% would undercharge on small jobs and overcharge on large ones for identical work.

**Why a percentage is right for Tier 3b.** Spot-check cost scales with the sampled fraction and the size of the calls sampled, so cost-plus keeps us whole and the sample rate is a dial we control.

Marlin prices `/v1/chat/premium` at $1.00 USDC via x402, so a proof add-on in this band is within observed norms. Tier conversion is also how we *measure* willingness-to-pay for verifiability — no published WTP figure for verifiable inference exists, which is the strongest argument for a tier gate over a guessed surcharge.

### The savings benchmark — and why "DePIN savings" is the wrong frame

**DePIN is not the price floor.** Verified against OpenRouter's live API on 2026-08-12:

| Model | We pay (AkashML) | Cheapest route | Hyperscaler | Verdict |
|---|---|---|---|---|
| Llama 3.3 70B | $0.13 / $0.40 | **$0.10 / $0.32** | Bedrock $0.72 / $0.72 | **We are ~25–30% above floor** |
| GLM-5.2 | $0.77 / $2.42 | $0.50 / $3.15 | Fireworks $2.10 / $6.60 | Dearer input, **cheaper output** — wins on reasoning-shaped work |
| GPT-OSS 120B | *not offered* | $0.03 / $0.17 | Consensus $0.15 / $0.60 | Cleanest benchmark model; we cannot route it |

DePIN comfortably beats hyperscalers and loses to the best aggregator routes. So the honest claim is not "decentralised GPUs are cheaper" — it is **"we route to whoever is actually cheapest, and prove which one ran."** That is a better story, and it makes the benchmark a forcing function on our own procurement rather than a marketing line.

A secondary source reported GLM-5.2 at $0.07/$0.22, which would have put AkashML 11x above the floor. The live API says $0.50/$3.15 — **that claim was wrong** and is worth remembering as a caution about pricing aggregator blogs.

Rules that keep the benchmark honest:

- **Same model, same token counts, same date.** Comparing our Llama-70B to a frontier model would be flattering and is the standard way these benchmarks lose credibility.
- **Publish the baseline as `{host, model, date, quantisation, context cap}`** and pick the **cheapest credible** same-model host, not the most flattering. DeepInfra shows $0.10 and $0.23 for the same model across trackers — that is an SKU difference, and quoting the low one without naming the SKU is how this goes wrong.
- **Show a negative saving when there is one**, or suppress the line on floor-regime calls. Never round a loss to zero.
- **Reference rate cards need an owner and a refresh job.** Stale baselines are the failure mode.

**The strongest available caution:** LLMRouterBench (Jan 2026, 400k+ instances, 21 datasets, 33 models) found several routing methods — *including OpenRouter's commercial router, at −24.7%* — fail to beat simply picking the best single model. The honest ceiling for a routing-savings claim is ~31.7% at matched performance, with 20–25% typical, against the 85–98% figures still circulating from 2024-era results. Note also that the vendors best placed to publish a counterfactual (Vercel AI Gateway, Cloudflare AI Gateway, OpenRouter) all show spend and decline to show savings, and that Akash's own "$1.33/hr vs $3.93 AWS" claim is documented by independent researchers as unverifiable because the AWS SKU was never specified — a cautionary example inside our own supply chain.

What makes our version defensible is narrow but real: every other vendor compares a *modelled* counterfactual against a *modelled* baseline. Our receipt binds an attested, actually-settled payment to the route that actually ran. Not "trust us on price" but "here is the counterfactual, verify it yourself" — which only holds if we pick the baseline honestly.

**Model choice matters too.** Llama 3.3 70B hit its deprecation date on 2026-07-19, so it is a poor flagship. GPT-OSS 120B has a hard consensus price of $0.15/$0.60 across Groq, Together, Fireworks, Azure and Bedrock, which makes it the cleanest reference we have — but AkashML does not list it. Adding a provider that serves it would give us the ideal demo.

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
| **Sub-cent per-call pricing** | **Not yet.** Requires batched settlement; CDP's `batch-settlement` is not registered server-side today (withdrawn over a channel-lifecycle bug). Revisit when a specific sub-cent surface such as MCP tool calls has volume |
| **Publishing a percentage skim on provider cost** | **No — and this is a framing rule, not a mechanism rule.** Deriving price from cost internally (the `k × COGS` multiple) is fine and is what protects margin. *Advertising* a percentage over provider cost is not: it re-anchors us to the 5% router band and invites "why not 1.05x like OpenRouter?". Akash's abandoned 20% is the existence proof. Publish the price and the saving against the buyer's alternative; the cost basis and the multiple stay internal |
| **Volume discounts on a published schedule** | **No.** OpenRouter states plainly it offers none; Requesty has no minimum. Discount at the enterprise contract instead |

## Open decisions

1. **Provider mix is now a pricing decision.** We are ~25–30% above the floor on Llama 3.3 70B, and cannot route GPT-OSS 120B at all. Under a savings cap, being above the floor means either no savings claim or selling below cost — so procurement, not pricing, is the binding constraint. Adding a cheap aggregator route may be worth more than any price change.
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
| 1 | True COGS from real provider usage | Open — blocking gate |
| 2 | Meter `/v1/chat/completions` | Open |
| 3 | Populate `X402_USDC_PRICES` with the class schedule | Open |
| 4 | Advertise per-model price on `/.well-known/x402` and `/v1/models` | Open |
| 5 | Price the assurance tiers | Open — Tier 2 now looks free; Tier 3b spot-check is the one to price |
| 6 | Confirm Succinct per-proof base fee via `GetProofRequestParams` | Open — ~20 min, closes the last cost unknown |
| 7 | Add a provider that reaches the floor on Llama 3.3 70B / serves GPT-OSS 120B | Open — procurement gate on the savings claim |
