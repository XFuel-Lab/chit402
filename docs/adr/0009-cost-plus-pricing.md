# ADR 0009 — Cost-Plus Pricing, and What It Does Not Cover

Status: Proposed (implemented behind `X402_COST_PLUS`, default off). Date: 2026-08-14.
Related: [ADR 0006](./0006-receipts-are-not-a-paid-feature.md), [ADR 0007](./0007-spot-check-assurance.md), [ADR 0008](./0008-rolling-settlement.md), [PRICING_STRATEGY.md](../PRICING_STRATEGY.md), [KNOWN_ISSUES.md](../KNOWN_ISSUES.md), [VERIFIED_INFERENCE_TIERS.md](../VERIFIED_INFERENCE_TIERS.md).

## Context

Pricing has been a rate card we own — `DEFAULT_RATE` at $0.30/$0.90 per million tokens,
plus per-model rows to stop dear models being sold at the cheap default. The card was
chosen deliberately over cost-plus on one argument: provider cost falls roughly 5-10x a
year, so a percentage of it deflates too.

That argument still holds, and the card has lost on everything else.

**It sells at ~2.1x COGS on the number every buyer compares.** A median agent call
(20,000 prompt / 15,000 output on GLM-5.2) costs us $0.094 and bills at $0.195. ZAN sells
comparable AI routing at or near wholesale, so the card is not a defensible position — it
is a 2x premium on a commodity, and the competitive teardown found no feature the premium
buys that a buyer can see.

**It cannot cover the catalogue.** AkashML spans $0.037/M to $1.40/M input — 38x. One row
cannot serve that, which is why per-model rows exist, and why two Critical entries in
`KNOWN_ISSUES.md` are both "a model was priced on the wrong row": the default model sold
at a 4.6x loss, and the rate card never applied to the default request at all.

**A buyer cannot check it.** A rate card is a number we assert. Meanwhile the receipt
already signs `provider_cogs.actual` — we attest what the GPU cost and then bill from an
unrelated list.

## Decision

**Price as measured provider cost plus a stated percentage, both as separate line items on
the receipt.** Default fee 10%, `max(floor, COGS × 1.10)`.

Implemented as `quoteFromCogs` in `pricing.js`, behind `X402_COST_PLUS` (default off) with
`X402_PLATFORM_FEE_BPS` (default 1000). The rate card stays in place and keeps working;
switching is a commercial decision, not a deploy, for the same reason `X402_METER_V1`
ships off.

The floor is unchanged and still binds. A 500-token Llama tool call costs $0.000105, so
cost-plus would charge $0.000116 — far below what a settlement costs. On small calls the
floor *is* the price and the percentage never applies.

### Why this shape

**It is the only pricing model our own product can prove.** `provider_cogs.actual` is
already in the signed receipt, so a buyer holding a receipt and a stated `fee_bps` can
recompute the entire bill and check it. Nobody else attests COGS, so nobody else can offer
a self-auditing invoice. The pricing model becomes a demonstration of the thing we sell.
This is the argument; the price cut is a consequence.

**It removes a live bug class.** No model-keyed price means no wrong row. The 38x
catalogue span and the `xfuel/auto` resolution hazard both stop mattering.

**It is a ~47% price cut** on a median call — $0.1034 against $0.195 — pinned by a test so
a rate-card edit cannot quietly undo it.

## What the 10% covers, and what it does not

Covered: the **signed Tier-1 receipt** (free on every routed call per ADR 0006, never an
upsell) and **network-pooled spot-check** (ADR 0007). Spot-check belongs in the base fee
because its cost is pooled across the network and adds nothing per additional customer.

**Tier-2 SP1 settlement proofs are not covered.** This was the open question when the fee
was chosen, and it is now measured rather than estimated.

Succinct request `0x073ef49f…384fb8b`, `sp1-v6.1.0`, auction strategy, measured 2026-08-14:

| Field | Value |
|---|---|
| Gas used | 58,698 PGU |
| Base fee | 0.341064 PROVE |
| Total fee | 0.341064000000058698 PROVE |
| Variable component | 0.000000000058698 PROVE ≈ $8.6 × 10⁻¹² |
| **Cost per request** | **≈ $0.050** at PROVE $0.147 |

The variable component is eleven orders of magnitude below the base fee. **Cost is fixed
per request and independent of circuit size** — our 58,698 PGU is far below the 2M
previously assumed, and optimising the circuit would save nothing. Cost per settlement is
therefore the base fee divided by batch size, and nothing else:

| Batch size | Per settlement | Against the $0.0094 fee on a median call |
|---|---|---|
| **1 — what we pay today** | **$0.0500** | **5.3x the whole fee** |
| 5 | $0.0100 | 1.06x — still underwater |
| 10 | $0.0050 | 53% of the fee |
| 20 (host max) | $0.0025 | 27% of the fee |

Break-even is batch 6. This supersedes the ~$0.007 self-hosted estimate in
`PRICING_STRATEGY.md`, which was low by about 7x and led to the conclusion that proofs were
"cheap enough to give away".

**Batch 1 is not a tuning problem — AI-task proofs cannot be batched.**
`ai-listener.js` calls `generateProof(request, true)`, and `urgent` bypasses the queue by
necessity: the host handles `ai_task` only in the `Single` branch of
`parse_request_to_batch`, while the `Batch` branch parses `ForwardDeposit` and requires
`merkle_proof` / `identity_secret`. The batch queue has only ever served legacy TFUEL
deposits. Fixing it means a new guest ELF, a new vKey, and a vKey update in `ZKVerifierSP1`
on Base — the parked "Guest v2" item, now on the critical path for Tier-2.

So: **Tier-2 is opt-in and separately priced at a flat $0.08**
(`X402_TIER2_PROOF_UNITS`, default 80000), not bundled into the 10%. Flat, not a percentage —
the circuit is byte-identical whether the job was $0.01 or $1.00, so a percentage would
undercharge small jobs and overcharge large ones for the same work.

$0.08 is 1.6x the measured $0.050. The headroom is FX rather than margin: proof cost is
denominated in PROVE at its all-time low, and this price breaks even up to about PROVE
$0.235. It is charged **on top of** the inference price and is never absorbed by the floor,
or a floor-priced call would buy a $0.050 proof inside a $0.01 payment. Marlin prices its
premium tier at $1.00 USDC, so $0.08 is well inside observed norms.

`checkPricingConfig` (called from `createApp`) logs at error level if cost-plus is on while
Tier-2 is still gated on the settled amount, or if the proof price is set below what a proof
costs. Each setting looks reasonable alone; only the combination loses money, which is
exactly the kind of thing that should not be caught by reading a doc.

## Consequences

**`tier2Min` had to be re-based, and it was the more urgent half of this ADR.** It was
`10000` — the same value as the $0.01 price floor — so on the settled-amount basis
essentially every paid call sat at the settlement floor. With cost-plus on, that is a call
collecting $0.0094 of fee and spending $0.050 on a proof: **every paid call loses money.**
`tier-policy.js` now accepts `tier2MinCogs` / `tier3MinCogs`, which take precedence when
the task carries measured COGS. Amount thresholds remain as a fallback, so nothing changes
until the COGS thresholds are configured.

Thresholds belong in COGS for a second reason: they stop moving when we reprice. A 47% cut
would otherwise pull calls below a fixed amount threshold and silently downgrade assurance
we had already promised.

Deriving a solvent threshold — bundle only when the fee covers the amortised proof K times
over, `COGS × feeRate ≥ K × ($0.050 / batchSize)`:

- batch 10, K=4 → COGS ≥ **$0.20**
- batch 1, K=4 → COGS ≥ **$2.00**

**$2.00 is the operative figure**, because AI-task proofs are unbatchable until Guest v2.
Almost no call reaches $2.00 of provider cost, which is the honest statement of where this
leaves us: Tier-2 is an opt-in charge today, not a bundled default, and the $0.20 threshold
is unlocked by shipping Guest v2 rather than by changing a setting.

**We accept deflation exposure.** A percentage of a cost that falls 5-10x a year falls with
it. This bets agent token volume grows faster than unit price falls — the bet OpenRouter is
making. It is reasonable and it is still a bet. The hedge is that `X402_PLATFORM_FEE_BPS` is
a single number, so repricing is one variable rather than a card revision.

**We are structurally short PROVE.** Proof COGS is denominated in a token at its all-time
low ($0.1439, set 2026-08-13) after a ~86% annual decline. At its 1-year-ago $1.41 the same
proof costs $0.48, and batch-20 amortisation only reaches $0.024 — still 2.6x the fee on a
median call. Any future decision to bundle Tier-2 is a bet that PROVE stays cheap.

**Volume discounts are designed but not shipped.** Bracketed per band, so no tier boundary
is a cliff where a customer spending more pays us less. Registration gates the brackets
rather than earning its own discount, because volume accrues to an identity and an
anonymous caller has none. Holding them as a negotiation tool: we can always discount, and
cannot quietly un-discount.

**Not yet measured:** the request above used `.compressed()`, a STARK, not the Groth16 wrap
`ZKVerifierSP1` verifies on Base. On-chain settlement adds a wrap plus Base calldata gas on
top of the $0.050.

## Alternatives rejected

**Keep the rate card.** Wins on deflation, loses on price, on catalogue coverage, on bug
surface, and on verifiability. Retained behind the flag rather than deleted.

**Flat per-call price.** Cost variance across our catalogue is 3,257x between the cheapest
and dearest call. Any single price is adverse-selected: heavy agent traffic arrives, light
traffic leaves.

**Subscription seat plus zero markup.** Modelled as `max(seat floor, % of spend)`. The
percentage is the load-bearing half at any volume worth having, and the seat adds a signup
barrier for an agent that wants to pay per call. Registration is kept for identity, not as
a revenue line.

**Percentage-priced Tier-2 proofs.** Cost is fixed per request — now measured as
independent even of PGU count — so a percentage cannot track it.
