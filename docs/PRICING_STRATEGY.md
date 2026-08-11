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

### Price schedule (proposed)

Each class carries a **token envelope**. Flat pricing without one is a loss-leader for context-stuffers: a 100k-context GLM-5.2 call costs ~$0.077 of provider spend and would sink any flat price. Beyond the envelope, the call switches to metered `upto` or is refused with a clear error — machinery we already have, since the AkashML adapter reports `truncated` and the gateway returns `max_tokens_too_small`.

| Class | Models | Envelope (in / out) | Price | Provider cost at envelope | Margin at envelope |
|---|---|---|---|---|---|
| **S** — small open | Llama 3.1 8B, small Qwen | 4k / 1k | **$0.01** | ~$0.0005 | ~95% |
| **M** — mid open | Llama 3.3 70B, GPT-OSS 120B | 8k / 2k | **$0.02** | ~$0.0018 | ~91% |
| **L** — reasoning / frontier open | GLM-5.2, DeepSeek-R1 | 8k / 4k | **$0.05** | ~$0.0158 | ~68% |
| **XL** — frontier proprietary | Claude, GPT-5 class | metered | **`upto` ceiling** | pass-through + margin | set per model |

Class M cost derived from AkashML Llama 3.3 70B at $0.13/$0.40 per 1M; Class L from GLM-5.2 at $0.77/$2.42 per 1M. Class L gets the widest output envelope because reasoning models spend tokens before answering — we measured 128 of 132 output tokens going to hidden reasoning.

Note Class L's margin is materially thinner. That is honest: reasoning is genuinely expensive, and the envelope plus the price are what stop a reasoning-heavy buyer from being unprofitable.

**Implementation is mostly configuration, not code.** `X402_USDC_PRICES` already accepts a JSON map keyed by model id and `priceTaskUSDC()` already consults it. The gaps are that `/.well-known/x402` advertises only the default price (`x402-discovery.js:102`) and `/v1/models` does not carry price at all — both should expose the schedule so an agent can plan before committing.

### Assurance axis: start charging for proofs

Verifiability does **not** command a multiple. Measured TEE premiums land at **10–20%**: GLM-5.2 on Tinfoil vs Together is +13.5%, confidential cloud instances run +10.0% to +18.7%, GPU-level TEE +35%. Nobody in the market sells attestation as a separate line item — the [Confidential Inference directory](https://confidentialinference.net/) has 8 providers and 50 models, none charging an attestation fee. HULDR, the closest analogue to our receipt product, states its model in the negative: revenue is provider stake yield, not call fees.

**But zkML is different, because the marginal cost is real and enormous.** GPU proving runs **$0.02–$0.50 per proof** and onchain verification is 200k–600k gas (**$3–$18** on Ethereum mainnet; far less on Base). Against $0.000335 of inference, a $0.02 proof is **60x the COGS of the call it attests**.

We currently give that away, gated on an amount the buyer used to declare themselves. The gate is now fixed (receipts derive gross from the settled payment), but the price is still zero:

| Tier | What it is | Marginal cost | Proposed |
|---|---|---|---|
| **Signed receipt** | Gateway-signed, tamper-evident | ~0 | **Free, always** — this is baseline assurance and must never be an upsell |
| **Settlement proof** (SP1 on Base) | Payment + routing bound in a proof | prover compute + Base gas | **~$0.10/task**, or bundled in a plan |
| **Verified Inference** (zkLLM) | Execution-level proof | $0.02–$0.50+, small models only | **~$1.00/task or enterprise-only** |

Marlin prices `/v1/chat/premium` at $1.00 USDC via x402, so a proof add-on in this band is within observed norms. Tier conversion is also how we *measure* willingness-to-pay for verifiability — no published WTP figure for verifiable inference exists, which is the strongest argument for a tier gate over a guessed surcharge.

### Spend Intelligence: a plan, not a percentage

**Nobody prices analytics as a share of the spend it observes** — it is per-event or flat, universally. Entry paid tiers cluster tightly at **$29–$79/month** (Langfuse Core $29, Portkey Production $49, Helicone Pro $79, LangSmith Plus $39/seat), with free tiers at 10k–50k events.

The profitable gate is **compliance, not the dashboard**: Helicone steps $79 → $799 for SOC-2/HIPAA, Langfuse $29 → $199. Our thesis already argues the dashboard is not the moat; the market agrees and prices it near zero.

| Tier | Price | Contents |
|---|---|---|
| Included | free | Per-task receipt, `/stats/me` current-window totals |
| **Spend Intelligence** | **$29–$49/mo** | History, per-workload breakdowns, counterfactual pricing, cheaper-route hints |
| **Audit-grade** | **$199–$799/mo** | Long retention, exports, tamper-evident trail, compliance attestations |

Worth noting: a monthly subscription fits the human who approves the invoice, not an anonymous agent. Consider a usage-metered equivalent for pure-agent buyers.

**Gain-share on proven savings** is the one place our receipt is genuinely unique — Vertice contractually guarantees a 20% software-spend saving and cannot prove it, whereas we could. Hold it until the counterfactual pricer is trustworthy, because without a quality signal a "saving" may be a quality regression in disguise.

## Rejected, and why

| Option | Verdict |
|---|---|
| **Prepaid credits + 5% top-up fee** (OpenRouter / Eden AI) | **Not as the primary model.** ~600x less revenue per call, needs OpenRouter-scale volume, puts the reasoning tax back on the buyer, and benchmarks us directly against a company with 8M developers. Viable only as an enterprise BYOK option |
| **Sub-cent per-call pricing** | **Not yet.** Requires batched settlement; CDP's `batch-settlement` is not registered server-side today (withdrawn over a channel-lifecycle bug). Revisit when a specific sub-cent surface such as MCP tool calls has volume |
| **Percentage skim on provider cost** | **No.** Caps us at the 5% router band and has an existence proof of failure at Akash's abandoned 20% |
| **Volume discounts on a published schedule** | **No.** OpenRouter states plainly it offers none; Requesty has no minimum. Discount at the enterprise contract instead |

## Open decisions

1. **Does the revenue split base need to change?** ADR 0001 splits the *fee* 40/35/25. At 50 bps on a $0.01 task the buyback bucket receives **$0.0000175 per task** — 1M tasks/month funds $17.50 of buyback, while gross margin on the same volume is roughly $18,000. If the token thesis depends on that split, the base has to be gross margin, not the nominal fee. This needs an explicit call.
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
