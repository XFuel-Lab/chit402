# ADR 0007 — Spot-Check Assurance: Pool the Statistics, Not the Sample

Status: Proposed. Date: 2026-08-13.
Related: [ADR 0006](./0006-receipts-are-not-a-paid-feature.md), [ADR 0003](./0003-verified-inference-cleanroom.md), [ADR 0004](./0004-zkllm-prover-stack.md), [KNOWN_ISSUES.md](../KNOWN_ISSUES.md).

## Context

A Tier-1 receipt attests what the gateway observed: which model was requested, which
provider we routed to, what tokens came back, what it cost. It is signed and
tamper-evident, and everything in it is true.

It does not attest that the provider ran the model it said it ran. The receipt says
`route.provider: akash-network` and `route.model: akash/zai-org/GLM-5.2` because AkashML
said so. A provider quietly serving a 4-bit quantisation, a smaller model, or a stale
cached response produces a receipt that is signed, verifiable, and wrong about the only
thing the buyer cares about. **This is the honest ceiling of the current product** and it
is not a bug we can fix by signing harder.

The tiers above are either the wrong proof or not ready. Tier-2 SP1 proves *settlement* —
that the payment and the task bind — not that the inference happened as claimed. Tier-3
zkLLM proves the inference itself and is the right answer, but is not shipped and will not
be economical for frontier-sized models for some time (ADR 0004).

Spot-checking fills the gap statistically: re-execute a sampled fraction of calls on a
second provider and compare. It cannot prove any individual call. It can bound how often a
given provider-and-model pair is lying, which is a different and cheaper claim.

Two objections have to be answered before this is worth building.

**"We are too small to sample."** Wrong, and worth correcting explicitly because it was our
own first instinct. Sampling cost is not fixed — the rate is a per-customer knob, and for a
low-volume customer you turn it *up* precisely because the absolute cost is trivial. A check
costs about one re-execution of the same model, so roughly 1x the original COGS. On the
agent path that is $0.096 against a $0.206 price; at a 10% rate it is $0.0096 per call, or
about 9% of gross margin. On short completions it lands near 7%. Payable, and tunable.

**"A small customer cannot get a meaningful claim."** This one is real, and it is the
constraint that shapes the design. The binding limit is not money, it is sample size. With
zero failures in *n* checks the 95% upper bound on the true failure rate is about 3/n — so
10 clean samples only rule out failure rates above roughly 26%, which is not a claim worth
selling. You need around 100 samples to say "under 3%" and 300 to say "under 1%." A customer
running 50 calls a month can never reach that on their own traffic, at any sample rate they
would tolerate paying for.

The resolution is to change the unit the claim is made about.

## Decisions

1. **Statistics pool per `(provider, model)` across all XFuel traffic — never per customer.**
   A customer with 50 calls inherits the confidence from every check run on that pair for
   everyone. Their receipt reports two separate numbers and does not conflate them: how many
   of *their* calls were sampled, and the network-wide agreement rate for the pair that
   served them.
2. **This is the mechanism that makes routing volume compound.** More traffic through XFuel
   means tighter bounds on every pair, which means a stronger claim for every customer,
   which is a reason to consolidate spend through one router rather than split it. Plain
   routing has no such property, and this is the strongest structural argument in the
   product.
3. **Bootstrap with synthetic canaries before customer volume exists.** Ordinary-looking
   prompts on our own key, run against every pair in the catalogue, establish a baseline for
   tens of dollars rather than waiting on traffic. A malicious provider could in principle
   detect and special-case canaries; with a shared key and unremarkable prompts this is hard,
   and it is the same assumption every proof-of-sampling scheme makes. Note it, do not
   pretend it away.
4. **Comparison is the hard part, not sampling** — and the probe battery is the lever that
   decides whether it works at all. Measured below: a curated battery needs **23 checks** per
   pair where an uncurated one needs 179. Logprob distributions would be a stronger
   fingerprint than text, but AkashML returns `null` for them, so text comparison over
   curated free-choice prompts is the only method available today. **Publish the battery, the
   comparator and the threshold.** An agreement rate computed by an undisclosed method is a
   marketing number.
7. **No per-call verdicts, ever.** Measured self-disagreement runs to 21% on our own default
   model, so a single mismatch carries no information and a receipt must never imply
   otherwise. The unit of the claim is a rate over a sample, and the tier's language has to
   say so.
5. **Sell it as an assurance tier, not a SKU.** Measured willingness to pay for verifiability
   is 10–20%, not a multiple, and nobody in the market charges an attestation line item.
   Expect it to earn its keep as
   differentiation and retention before it is a revenue line. This is consistent with ADR
   0006: the *receipt* is free; a higher assurance level behind it is what carries price.
6. **A mismatch is a signal, not a verdict.** Non-determinism guarantees false positives, so
   a single disagreement never de-lists a provider or triggers a public claim. Act on a run
   of failures against the pair's own established baseline, and tell the provider before
   telling anyone else.

## Measured, 2026-08-13

Run before committing to any of this: `scripts/dev/_canary_probe.mjs`, 576 calls across all six
AkashML models, 24 free-choice prompts × 4 repetitions, temperature 0. Raw responses and scores
in `canary-baseline.json`. **Total cost $0.17 and five and a half minutes**, which settles the
cost objection permanently — the constraint on this experiment was never money.

Three findings, two of which contradicted the assumptions above.

**Models do not reliably repeat themselves.** Self-agreement at temperature 0 ranged from 78.6%
to 100%. The worst was `zai-org/GLM-5.2` — the model `xfuel/auto` resolves to for agent work —
which disagrees with itself on 21% of prompts. `openai/gpt-oss-120b` was 82.6%. So the noise
floor is high, model-specific, and worst on our default. Any per-call comparison is dead on
arrival, and decision 7 above exists because of this number.

**The probe battery matters more than the sample rate.** Uncurated, the hardest pair
(GLM-5.2 vs Qwen3.6) sat 13.3% above its own noise floor, needing ~179 checks to call apart at
95% confidence and 80% power. Scoring each prompt by self-agreement minus cross-agreement and
keeping the better half lifted that margin to 39.1% — **23 checks**. Two prompts scored 0%
discrimination (every model answers "Name a tree" identically) and were pure cost; three scored
100%. Free-choice prompts only work when models actually choose differently, and which ones
those are is an empirical question, not a guess.

**Near-twins are separable.** `Qwen3.5-35B-A3B` vs `Qwen3.6-35B-A3B` — same family, same size,
adjacent versions — separated by 35.6% uncurated and 52.1% curated. The hardest realistic
substitution is comfortably detectable, which is the single most important result here.

Two operational notes fell out of the run. Reasoning models return **empty content** when
`max_tokens` is tight enough that hidden reasoning consumes the budget: 33 of 96 calls on
Qwen3.6 and 17 of 96 on GLM-5.2 came back blank at 512 tokens. And the real check —
cross-*provider*, the same model on two hubs — is still unmeasured, because it needs a Theta
EdgeCloud key we do not hold locally.

At 23 checks per pair the pooling decision stops being a preference and becomes arithmetic: a
customer running 50 calls a month cannot fund a verdict about their own traffic at any sample
rate, and the network reaches 23 on a single pair within a day of modest volume.

## What already exists, and what the measurement breaks

This is not greenfield. `services/gateway/src/spotcheck.js` (Phase 4, T3b) already implements a
sampler, and it is **dormant**: it only reaches a receipt when the assurance mechanism resolves to
`zk-spotcheck`, which needs `VI_SPOTCHECK_ENABLED=true` *and* a non-zero `VI_SPOTCHECK_RATE_BPS`,
both off by default. Nothing has been sampled in production, so there is no live incident here —
but it must not be switched on as written.

**Keep the sampler.** `shouldSpotCheck` draws `keccak256(seed, taskId)` against `rateBps`, with
the seed a per-epoch beacon revealed after the epoch. That is better than a plain random draw and
better than anything proposed above: the provider cannot predict which calls are checked, and
anyone can audit afterwards that we sampled what we said we sampled. Decision 1's pooling changes
what the *rate* is computed over, not how the draw works.

**Replace the comparison.** `buildSpotCheckRecord` resolves `pass` / `mismatch` by comparing
`keccak256` output hashes for equality, and sets `slashable: outcome === 'mismatch'`. Byte
equality is exactly the comparator the measurement above rules out: GLM-5.2 returns different text
for an identical prompt at temperature 0 on **21% of prompts**, and different text is a different
keccak hash. Enabled as written against a re-execution, this would mark roughly one in five
*honest* checks as a mismatch and flag it slashable. The record needs to carry a similarity score
and an accumulating agreement rate per `(provider, model)`, and `outcome` must be a property of a
sample rather than of a call.

**`slashable` needs re-scoping, not deletion.** The flag exists because
`contracts/core/ProviderStaking.sol` and `PROVIDER_STAKING_ADDRESS` anticipate providers who have
staked with XFuel. None of our current providers have — AkashML and Theta are vendors we buy from
— so today the field can only ever be aspirational, and a receipt should not imply an enforcement
path that does not exist. Keep the mechanism for a future staked-provider tier; stop computing the
flag from a single hash comparison.

## Consequences

- We must publish network agreement rates, including the bad ones. An assurance claim we
  only publish when it flatters us is not an assurance claim, and a provider will eventually
  fail a check.
- Our leverage over a provider is commercial, not cryptoeconomic: we are their customer, not
  the operator of their network, so there is no stake to slash. What we can do is route away
  and say publicly why. That is weaker than slashing and stronger than nothing, and it should
  be described as what it is.
- Sampling adds latency to no user-visible call — re-execution happens out of band, after the
  original response has been returned.
- Scope of the claim is narrow and must stay stated: this detects a provider serving a
  different or more aggressively quantised model than billed, and stale or cached responses.
  It does not detect subtle quality drift, and it says nothing about any individual
  unsampled call.

## Rejected

- **Per-customer statistical claims.** At realistic volumes *n* is too small for the bound to
  mean anything; "we checked 10 of your calls" invites a question we cannot answer well.
- **Cryptoeconomic slashing against today's providers.** `ProviderStaking.sol` exists and the
  receipt already carries a `slashable` flag, but AkashML and Theta are vendors we buy from and
  have staked nothing. The mechanism is right for a future staked-provider tier and wrong as a
  claim about the providers we actually route to now.
- **Per-call match as a verdict.** Normalised exact match is a perfectly good *statistic* — it
  is what the measured margins above are built from — but as a per-call judgement it would
  generate false accusations at 21% on our own default model.
- **An uncurated probe battery.** Measured at 179 checks per pair against 23 for a curated one.
  The prompts must be scored and pruned, and re-scored whenever the catalogue changes.
- **A separate paid attestation SKU.** Contradicts ADR 0006 and the measured price ceiling
  for verifiability.
