# Agent Pain Points — What Agents Need, and What Nobody Has Built

Date: 2026-08-13. Status: research input for a positioning decision, not an accepted plan.
Related: [ADR 0006](./adr/0006-receipts-are-not-a-paid-feature.md) (receipts are free), [ADR 0007](./adr/0007-spot-check-assurance.md) (spot-check assurance), [ADR 0008](./adr/0008-rolling-settlement.md), [KNOWN_ISSUES.md](./KNOWN_ISSUES.md), [POSITIONING.md](./POSITIONING.md), [STRATEGY.md](./STRATEGY.md).

Every external claim here is dated and cited. Every internal number is reproducible from
`scripts/dev/_availability_probe.mjs`. Where something is inference rather than measurement it says so.

---

## 1. The one-sentence version

**"Is the endpoint up" is the wrong question, and the right question — "is it serving what it
claims" — is one only a router that also pays and attests can answer.** That is the whole thesis,
and as of two weeks ago it has third-party evidence from outside crypto.

---

## 2. What we measured ourselves

`scripts/dev/_availability_probe.mjs`, 5 runs in one 10-minute window on 2026-08-13, every
advertised chat model on both hubs:

- **2 of 8 advertised models never served once.** `theta/qwen3` returns 409 `No instances available`
  on every request while sitting in a live public catalogue; `akash/Qwen/Qwen3.5-35B-A3B` returned
  empty content every time.
- **Only 4 of 8 served on every run.** Two more flapped with timeouts.
- **`akash/deepseek-ai/DeepSeek-V4-Flash-0731` ranged 1.2s → 22.3s — a 19.2x spread on one endpoint
  in ten minutes.** No fixed client timeout is correct: tight abandons healthy calls, loose hangs
  the agent.
- **Same model, two hubs, 4x apart.** `theta/glm_5_2` served 5/5 at a 2.0s median.
  `akash/zai-org/GLM-5.2` served 4/5 at 8.7s. Identical model name.

That last line is the important one, and we found it by accident. See §4.

## 3. What agents actually struggle with, ranked by evidence

**Rate limits are the single largest failure cause.** Datadog's State of AI Engineering 2026, from
LLM Observability traces across 1,000+ customers: 5% of LLM spans errored in February 2026 and ~60%
of those were exceeded rate limits — roughly **8.4 million rate-limit errors in March 2026 alone**.
Their own words: "the capacity ceilings of model providers are leading to compromises in agent
reliability," with fallback capacity among the recommended mitigations. This is a description of a
multi-provider router written by someone who does not sell one.

The mechanism is specific to agents. Long ReAct loops and multi-agent fan-out spike concurrency
against shared org quotas; 429s trigger retries; retries add load. Agents generate their own load
*in response to failure*, so the incident is self-sustaining in a way a human-driven workload is not.

**Silent degradation that no status page catches.** Anthropic's 23 April 2026 postmortem: three
unrelated changes between March and April degraded Claude Code — reasoning effort silently dropped
from high to medium, a cache fix that fired every turn, and a verbosity line costing a measurable 3%
of coding quality. Six weeks of complaints, no 5xx, no latency spike, no status incident. It passed
code review, unit tests, end-to-end tests and dogfooding. InfoQ's coverage adds that users found
Claude Code silently delegating sub-tasks to cheaper Haiku, visible only under verbose logging.

**Binary uptime monitoring would have reported 100% availability throughout.** That is the case for
behavioural availability in one example.

**Runaway spend, with blue-chip examples.** Uber rolled Claude Code to ~5,000 engineers in December
2025 and **exhausted its entire 2026 AI budget by April**, then imposed $1,500/month per-tool caps.
Per FT reporting, an Amazon project accumulated roughly **$1.8M, ~860% over budget, undetected for
five months**, and never shipped. Note both were caught late, not prevented.

**Model churn as a governance problem.** Four significant OpenAI retirement waves in 2026 (23 July
and 10 August already passed; 23 October and 11 December ahead), and replacements are not
like-for-like in behaviour or price. Worse for automation: `deprecation_date` is only populated
*after* public announcement, so it cannot be detected programmatically during the grace period.
Datadog found GPT-4o was still their most-traced model in March 2026, after OpenAI had retired it in
the ChatGPT UI — teams adopt fast and retire slowly.

**Capacity is genuinely constrained and worsening.** OpenAI API throughput went from 6B to 15B
tokens/minute between October and end of March; Blackwell spot rose ~48% in two months; CoreWeave
raised prices >20%; Google is rationing Meta's Gemini access. The deeper constraint is memory, not
compute: TrendForce projects DRAM up >70% in 2026 with 2026 HBM output sold out under multi-year
agreements. Agent workloads have the longest contexts and inference is bottlenecked on KV-cache, so
agents feel this first — Datadog measured average request tokens more than doubling for median
customers year over year.

**Regulation, already in force.** EU AI Act Articles 12, 26(6) and 73 activated **2 August 2026**:
automatic lifetime logging, deployer log retention of at least six months, serious incidents
reported within 15 days, penalties to €35M or 7% of global revenue. Our receipts are already most of
an Article 12 record — but see §7 for why this is the wrong customer for us today.

## 4. The finding that matters most, and it is two weeks old

**Artificial Analysis launched an Endpoint Accuracy Index on 4 August 2026** measuring how much of
an open-weights model's accuracy each serverless endpoint actually preserves, benchmarked against
their own self-hosted reference deployment of the official weights.

Their framing: *"Providers trade off accuracy to optimize for speed and cost. They quantize weights,
write custom kernels and tune their inference stacks, and sometimes they simply ship bugs."*

Launch coverage is **GLM-5.2, gpt-oss-120b and DeepSeek V4 Pro** — which is to say, the models we
route. Findings:

- On **gpt-oss-120b**, "some endpoints score 22% on BFCL-500 against 37% for the reference" — a 40%
  relative loss in **tool calling**, the capability agents depend on most, for the same model name.
- On **GLM-5.2**, "the most restrictive endpoints score half the reference or less on HLE-250,"
  because output-token limits cut responses off before the model finishes reasoning.
- "Serving configuration changes what the model does at the same requested settings."
- The lowest-scoring endpoints produce roughly **half the reference's output tokens**.
- **DeepSeek V4 Pro is the counter-example** — most endpoints at reference parity. So this is
  provider-specific, not universal, which is exactly what makes per-endpoint measurement worth
  paying for rather than a blanket assumption.

Independently, IRIS (arXiv 2607.20860, July 2026) audits endpoints from returned text alone,
detecting both wholesale substitution and *fractional dilution* (routing only ε of requests to the
advertised model). Its live cross-provider audit **flags 14 of 15 same-model provider pairs** as
genuinely deviating through quantization and kernel differences.

**Three independent measurements of the same phenomenon, and one of them is ours.** Our probe found
`theta/glm_5_2` at 2.0s/5-of-5 against `akash/zai-org/GLM-5.2` at 8.7s/4-of-5 on the same model
name. AA explains the mechanism we stumbled into. We have been building the measurement apparatus
for a problem that a mainstream, non-crypto benchmark just made legible to buyers.

Two things follow, one good and one uncomfortable:

- The receipt thesis (ADR 0006) now has external corroboration dated this month. Whatever demand
  test we run should run **now, while this is novel**, and should cite AA rather than argue from
  first principles.
- **IRIS is explicitly an audit of gateways, and we are a gateway.** Anyone can point it at
  `api.xfuel.app`. That is a moat if our receipts are real and independently corroborable, and an
  existential embarrassment if they are decorative.

## 5. Nobody publishes availability for DePIN

Every reliability tracker found covers centralised APIs only: LLMStatus (12 providers), ModelUptime
(41 models, derived via the OpenRouter path), AIWatch, DownForAI (817 services), and AA's endpoint
index (serverless endpoints). Torchrank has Bittensor live with **Akash and Render permanently in
"Preview / Coming Soon."** A Chutes (Bittensor SN64) outage on 26–27 July 2026 was documented by
*summarising Discord messages*.

DownForAI's Q2 2026 report carries the most useful single statistic: of 817 monitored AI services
only **134 (16%) expose a verified machine-readable status feed**, and among LLM APIs specifically
just **17 of 62 (27%)**. Three-quarters of centralised LLM services have no programmatic way to tell
you whether they are up. For DePIN the figure is effectively zero.

The raw material is free: Akash's Console API already returns `isOnline`, `uptime1d/7d/30d` and GPU
availability per provider, unauthenticated. We already probe these endpoints to route.

**The honest caveat.** OpenRouter *does* publish provider uptime, throughput and tool-call success
rates and routes on them with published thresholds. "Availability index" as a generic idea is not
unbuilt — it is unbuilt **for DePIN**, and the behavioural dimension is unbuilt for everyone. Scope
the claim that way or it dies on a prospect's first search.

## 6. What to build — three things that compose

Ranked by evidence the pain is real and fit with what we already run.

### 6.1 Overflow routing: "your agent doesn't stop when OpenAI says 429"

**Highest conviction.** Rate limits are the #1 failure cause with 8.4M errors in one month. DePIN has
idle capacity 45–60% below hyperscaler pricing. Its central weakness — variable reliability — matters
far less on a *fallback* path than a primary one.

This converts both of our structural weaknesses into the mechanism of the offer. We cannot win a
price war and our DePIN supply is flaky; as capacity insurance, cheap-and-variable is exactly the
right shape. It also reframes DePIN from "discount" (a losing race) to "the capacity you cannot buy
from your primary vendor at any price when they are rationing."

Needs: cross-hub model equivalence, health-weighted routing, circuit breaking. We have none of these
— routing preference is a static list (`autoPreferenceFor`) with no availability input at all.

### 6.2 A warranty, not a receipt

**This answers the existential question.** ADR 0006's honest risk is that nobody pays for a receipt.
A receipt is an artefact; **a receipt that automatically refunds you is a warranty**, and people
have always paid for warranties.

The primitive: if the attestation shows the served endpoint deviated from what was quoted — wrong
precision, truncated output ceiling, substituted model — the buyer is credited automatically, with
nothing to file. AA's GLM-5.2 finding makes this concrete and no longer abstract: an endpoint with a
restrictive output ceiling delivers **half the reference's reasoning tokens at full price**. That is
a measurable overcharge, not a trust concern.

DePIN has no enforceable SLA — slashing punishes the node and compensates nobody. Circle's Refund
Protocol gives non-custodial escrow with a power-limited arbiter and there is no ERC for refunds.
**Nobody has connected dispute machinery to inference quality**, and only someone holding the
routing decision, the attestation and the money can. We hold all three.

### 6.3 A DePIN availability and conformance index

The cheapest distribution asset available to a company with no distribution: free, citable,
continuously updated, and structurally uncopyable by anyone who carries no DePIN supply. Publishing
what we already measure is close to zero marginal cost — `_availability_probe.mjs` is most of it.

Scope it to DePIN and to behavioural conformance, per §5. It is also what makes 6.1 and 6.2
credible rather than a separate product: health-weighted routing needs the series, and a warranty
needs evidence of deviation.

## 7. What not to build, and why

**Do not lean on x402 as a differentiator.** A population-scale measurement (arXiv 2607.12575)
audited 280 days of x402 on Base: 136,708,672 settlements worth $44.1M, payer/recipient/value Gini
all above 0.98, of which **21.20% are fictitious self-payments and 63.78% are internal settlement
inside a linked cluster**, leaving 15.02% unattributed. Only **$187,861 demonstrably reaches a
nameable service**, just **249 recipients ever earned $10 or more**, and only 52% of advertised hosts
still return a live payment challenge. The entire settlement count is reproducible for ~$355k of
facilitator-sponsored gas. Their conclusion: settlement count measures manufacturability, not
adoption.

The plumbing is fine and the institutional backing is enormous (x402 Foundation under the Linux
Foundation with Coinbase, Cloudflare, Stripe, Visa, Mastercard, Google, Circle). But the addressable
market for x402 routing is ~$20k/day globally and the standard is free to implement. **Every hour on
rail parity is an hour competing for a market that measurement says does not exist yet.**

**Do not build on ERC-8004 reputation.** 445,009 registered agents across 24 chains, but a
peer-reviewed audit (arXiv 2606.26028) found only **3%/4%/15%** of registrations on
Ethereum/BSC/Base expose a valid file with a live endpoint, reputation "cannot function as a trust
signal," and **73.6%/59.2%/90.6%** of reviewers show coordinated Sybil behaviour. The Validation
Registry — the one component that would carry an inference attestation — is marked UNSTABLE and
mainnet-pending. Register an identity because it is cheap; build nothing on the reputation layer.

**Do not position Tier-3 zkML as near-term revenue.** DeepProve achieves first end-to-end LLM
inference verification at ~174 tok/min for GPT-2 and ~86 for Gemma 3; NanoZK proves GPT-2 scale in
43s with 6.9KB proofs. Both are genuine advances and both are GPT-2/Gemma-3 scale. This is a
research position. *Inference:* the practical near-term substitute is TEE attestation, and it is
already shipping in DePIN — Chutes SN64 added TEE support in late July 2026 and positions it as
differentiation. **If DePIN providers ship hardware attestation before we ship a compelling receipt,
part of our differentiation evaporates.** That is a clock, not a hypothetical.

**Do not chase EU AI Act compliance yet, despite the fit.** Articles 12/26/73 are in force and our
receipts are most of an Article 12 record. But our declared beachhead is crypto-native agent teams,
who are close to the least likely population to be building Annex III high-risk systems. Well-
evidenced, well-fitting, wrong customer. Evidence for a possible second segment, not validation of
the first.

**Durable execution is not our fight.** Real pain, but Temporal, Inngest, Restate, DBOS and LangGraph
all address it. One sub-problem *is* ours: retries stack across the LLM loop, the SDK, the workflow
engine and the provider with no global budget, and a router is exactly the layer where a global
retry-and-spend budget could be enforced.

**Multi-hop delegation is a correct bet on an unbuilt market.** No deployed protocol proves which
human authorised which agent at hop three or four (arXiv 2604.23280); AP2 anchors hop one; ERC-7710
redelegation demos are hackathon submissions. Genuinely unsolved, genuinely ours to solve — and
serving a market measured in tens of thousands of dollars a day. Carry a mandate reference in the
receipt so the hook exists. Do not build the product.

## 8. Open decisions

1. **Adopt the reframe?** "Availability through routing" is already in `POSITIONING.md` and
   explicitly does not sell an uptime SLA. Moving to "we prove what actually served you, and credit
   you when it wasn't what you paid for" is a bigger claim that needs the warranty in 6.2 to be real.
2. **Revisit `autoPreferenceFor('agent')`.** It prefers `akash/zai-org/GLM-5.2` on agent-loop quality
   alone. Theta's GLM-5.2 measured 4x faster and more reliable for a 10% higher rate. Health-weighted
   routing is the general fix; changing the static preference is the same-day fix.
3. **Publish the index, or keep it internal?** Publishing is distribution and invites scrutiny of our
   own numbers. Given §4's warning that IRIS can be pointed at us, scrutiny is coming regardless.
4. **Add ZAN as a hub.** Approved in principle. It buys Claude/GPT/Gemini reach for the overflow
   story and a second source for the ADR 0007 spot-check. Cost: SIWE/JWT auth rather than an API key.
