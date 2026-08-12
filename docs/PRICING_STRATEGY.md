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

**But zkML is different, because the marginal cost is real and enormous.** GPU proving runs **$0.02–$0.50 per proof** and onchain verification is 200k–600k gas (**$3–$18** on Ethereum mainnet; far less on Base). Against $0.000335 of inference, a $0.02 proof is **60x the COGS of the call it attests**.

We currently give that away, gated on an amount the buyer used to declare themselves. The gate is now fixed (receipts derive gross from the settled payment), but the price is still zero:

Our tier numbering is **off by one** from how it is often discussed informally — worth fixing before pricing it. `VERIFIED_INFERENCE_TIERS.md` is authoritative: Tier 1 `signed`, Tier 2 `settlement` (SP1), Tier 3 `inference` (3a `tee`, 3b `zk-spotcheck`, 3c `zk-full`).

The pricing *shape* differs by tier, because only one of them scales with job size:

| Tier | Scales with job size? | Shape | Proposed |
|---|---|---|---|
| **1 `signed`** | No — effectively zero cost | — | **Free, permanently.** Baseline assurance, never an upsell |
| **2 `settlement`** (SP1) | **No** | **Flat adder** | A percentage would be wrong here — see below |
| **3a `tee`** | Weakly | Flat or small % | Cheapest real Tier 3; TEE premium is 10–20% in market |
| **3b `zk-spotcheck`** | Tunable by sample rate | **Cost-plus %** | The affordability dial — prove a random fraction, stake against the rest |
| **3c `zk-full`** | **Yes, strongly** | **Cost-plus %** | $0.02–$0.50+ per proof, small models only |

**Why a percentage is wrong for Tier 2.** An SP1 settlement proof attests fee arithmetic and a payment binding — the same circuit whether the job was $0.01 or $1.00. Proof cost is flat while a percentage would scale, so 5% would undercharge on small jobs and overcharge on large ones for identical work. Note `SP1_PROVER=network` in `deploy/ecs/sp1-prover-task.json`: we pay the Succinct Prover Network **per proof**, so this is a genuine marginal cost on top of the ~$100/month Fargate task and ALB. Exact per-proof price still to be confirmed.

**Why a percentage is right for Tier 3.** A forward-pass proof scales with model size and token count, so cost-plus keeps us whole. `zk-spotcheck` is already in the tier ladder and is the lever that makes it affordable: sample 5% of calls and expected cost is 5% of full proving, with staking deterrence covering the remainder.

Marlin prices `/v1/chat/premium` at $1.00 USDC via x402, so a proof add-on in this band is within observed norms. Tier conversion is also how we *measure* willingness-to-pay for verifiability — no published WTP figure for verifiable inference exists, which is the strongest argument for a tier gate over a guessed surcharge.

### The DePIN savings benchmark

Routing to decentralised GPUs is already a large cost saving that we currently keep entirely and never show anyone. Surfacing it turns our price from *a markup* into *a discount* — but only if the savings cap above is enforced, otherwise the benchmark prints a negative number.

Computed per call and shown on the receipt: **what this exact model would have cost on a named centralised host**, against what the buyer actually paid. Rules that keep it honest:

- **Same model, same token counts.** Comparing our Llama-70B to GPT-5 would be flattering and dishonest, and it is the standard way these benchmarks lose credibility.
- **Name the reference host and its list price**, with the date it was captured. A benchmark against an unnamed "typical provider" is unfalsifiable.
- **Show a negative saving when there is one**, or suppress the line entirely on floor-regime calls. Never round a loss up to zero.
- Reference rate cards need a refresh job — they drift, and a stale baseline is how this becomes a misleading claim.

This is the strongest form of the assurance product: not "trust us on price" but "here is the counterfactual, verify it yourself."

### Spend Intelligence: a plan, not a percentage

**Nobody prices analytics as a share of the spend it observes** — it is per-event or flat, universally. Entry paid tiers cluster tightly at **$29–$79/month** (Langfuse Core $29, Portkey Production $49, Helicone Pro $79, LangSmith Plus $39/seat), with free tiers at 10k–50k events.

The profitable gate is **compliance, not the dashboard**: Helicone steps $79 → $799 for SOC-2/HIPAA, Langfuse $29 → $199. Our thesis already argues the dashboard is not the moat; the market agrees and prices it near zero.

| Tier | Price | Contents |
|---|---|---|
| Included | free | Per-task receipt, **per-call DePIN savings benchmark**, `/stats/me` current-window totals |
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

1. **Reference rate cards need an owner.** The savings cap and the benchmark both depend on knowing what a centralised host charges. Stale baselines make the claim misleading, so this needs a refresh job and a named source per model.
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
| 5 | Price the assurance tiers | Open — decision above |
