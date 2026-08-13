# Model quality evaluation — is the cheap model good enough?

Run 2026-08-12 · harnesses `scripts/dev/_model_eval.mjs` (single-turn) and
`scripts/dev/_agent_loop_eval.mjs` (multi-turn) · re-run before changing a routing default.

> **The single-turn result below was superseded the same day.** It found all three models
> equivalent and moved `xfuel/auto` to the cheapest. A multi-turn agent loop then found the
> opposite, and the default was moved back. Read
> [the multi-turn section](#multi-turn-is-where-the-models-actually-separate) before quoting
> anything on this page.

`xfuel/auto` resolves to GLM-5.2, the dearest model across both hubs. Measured COGS on the median
agent call (68,000 in / 247 out) is **$0.096 on AkashML and $0.106 on Theta, against $0.00264 for
GPT-OSS-120B — 40x**. The only thing defending that was an untested assumption that the expensive
model is better. This tested it.

## Result: quality is not the differentiator

Nine task categories, three repetitions, temperature 0, graded deterministically — no LLM judge,
which would import the quality question it is supposed to answer.

| | GPT-OSS-120B | Llama 3.3 70B | GLM-5.2 |
|---|---|---|---|
| tool calling | 3/3 | 3/3 | 3/3 |
| structured JSON | 3/3 | 3/3 | 3/3 |
| long-context recall | 3/3 | 3/3 | 3/3 |
| instruction following | 3/3 | 3/3 | 3/3 |
| multi-step reasoning | 3/3 | 3/3 | 3/3 |
| synthesis @68k (two facts, far apart) | 3/3 | 3/3 | 3/3 |
| tool result → answer | 3/3 | 3/3 | 3/3 |
| nested JSON schema | 3/3 | 3/3 | 3/3 |
| constraint under trap | 3/3 | 3/3 | 3/3 |
| **median latency** | 3,562–6,128 ms | **849–1,946 ms** | 2,858–5,560 ms |
| **COGS / median agent call** | **$0.00264** | $0.00894 | $0.09629 |

**Every model passed everything.** GLM-5.2 has no measurable quality advantage on agent primitives
while costing 11–40x more and running 2–4x slower.

Two failures appeared during the run and neither was a quality failure. One was a **grader bug**:
GPT-OSS answered `-6 °C with sleet` using a Unicode non-breaking hyphen, and an ASCII-only regex
scored a correct answer as wrong — the exact error that would have driven the wrong routing
decision, which is the argument for deterministic grading being *reviewable* rather than merely
objective. The other was AkashML returning **HTTP 504 `queue_timeout`**, twice in 81 calls (~2.5%),
once on GPT-OSS and once on GLM.

## What this does and does not establish

It establishes that the cheap models are **not broken** for the primitives agents depend on. It does
**not** establish that they are equivalent in general, and the reason is that the eval failed to
discriminate: at 3 reps with every model scoring 27/27, the tasks were too easy to separate the top
end. Absence of a measured difference here is weak evidence of absence.

Specifically untested: multi-turn agent loops beyond one tool round-trip, recovery from a failed
tool call (which hits 9% of production turns and amplifies compute up to 4x), context compaction
across a long session, and anything domain-specific. A model can ace single-shot primitives and
still drift over a 40-turn trajectory.

The honest position is therefore narrow: **there is no quality evidence supporting a 40x price
premium for GLM-5.2 on this workload**, which is enough to move the default off it, and not enough
to claim the models are interchangeable everywhere.

## The 504s are a finding in their own right

~2.5% of calls failed on provider capacity, not on model behaviour, spread across two different
models. This is independent support for routing and failover being the product — the argument in
[PRICING_STRATEGY.md](./PRICING_STRATEGY.md) that our position is "availability through routing,
without losing the audit trail" rather than "DePIN is cheaper". It also means a single-model default
inherits that model's queue depth, so whichever default is chosen needs a fallback that is not the
same hub.

## Cost of the evidence

$0.52 total, of which **$0.46 was GLM-5.2** — the incumbent default cost 30x more to evaluate than
the challenger, which is the thesis in miniature.

## Reproducing

```
node scripts/dev/_model_eval.mjs --reps 3
node scripts/dev/_model_eval.mjs --reps 5 --only synth,chain --models openai/gpt-oss-120b
```

Hits AkashML directly rather than going through our gateway. At the time of the run that was
mandatory, because the gateway dropped `tools` entirely — a gap this eval uncovered and which is now
fixed (see [KNOWN_ISSUES.md](./KNOWN_ISSUES.md)). Keeping the direct path is still right: it measures
the model rather than our routing, so a gateway regression cannot be mistaken for a quality change.

## Multi-turn is where the models actually separate

The section above closes by naming the gap: one tool round-trip proves nothing about a trajectory.
Closing it reversed the conclusion.

`scripts/dev/_agent_loop_eval.mjs` runs a real agent loop — list invoices, fetch each one, fetch each
vendor's terms, apply per-vendor discounts to unpaid invoices, return the total (4350). Every call
depends on an earlier result, so the model cannot shortcut it. Two scenarios: `audit`, and `flaky`,
where one tool returns `rate_limited` once and must be retried. That mirrors the ~9% of production
turns that hit a tool failure. Three repetitions each, through our own gateway against the live
provider.

| | completed the loop | median turns | avg latency | avg tokens |
|---|---|---|---|---|
| **GLM-5.2** | **6/6** | 4–5 | **10.3 s** | ~2,400 |
| GPT-OSS-120B | 3/6 | 8–9 | 32.4 s | ~3,000 |
| Llama 3.3 70B *(was the default)* | **0/6** | 4 | 11.0 s | ~2,420 |

**Llama 3.3 70B failed every run, identically.** It makes three correct tool calls — `list_invoices`,
`get_invoice(INV-1)`, `get_vendor_terms(Acme)` — and then, on turn 4, stops calling tools and emits
Python source describing what it would have done, with `finish_reason: stop`. It never reaches the
remaining invoices. This is the model, not the gateway: the trace shows three tool round-trips
delivered correctly before it gives up.

A firm system prompt ("answer only by calling tools, you cannot execute code") was tested as a
rescue, because keeping the 10x cheaper model would be worth a prompt change. It is not enough:
Llama goes to **2/6** — it now makes all 8–9 calls but still gets the arithmetic wrong four times out
of six — while GPT-OSS-120B goes to **5/6**. The steer also triples Llama's prompt tokens, because
more turns means more context, which erodes the per-token saving that motivated it.

GLM wins on turns, not on tokens: it issues **parallel tool calls**, finishing in 4–5 turns where
GPT-OSS needs 8–9. That is why it is simultaneously the dearest per token and the fastest and
leanest per completed task.

### Why the default moved back to GLM-5.2

Our beachhead is crypto-native agent teams ([BEACHHEAD_ICP.md](./BEACHHEAD_ICP.md)). A default that
cannot complete an agent loop is a correctness failure, not a price/quality trade, so reliability
decides it. The cost consequence is real and should be reviewed: GLM is ~10x more per token, and on
the median agent call (68k in / 247 out) that is $0.096 of COGS against $0.00264 for GPT-OSS.

Per *completed loop* on this workload the gap is much narrower — roughly $0.0046 for GLM against
~$0.0008 for GPT-OSS at 5/6, before counting the retry a failure costs — but the workload here is
small-context, so do not generalise those figures to the 68k-input shape.

Override without a code change:

```
XFUEL_AUTO_MODEL=akash/openai/gpt-oss-120b
```

That is the right switch if latency and reliability become less important than COGS: GPT-OSS at 5/6
with a system prompt is defensible for a cost-led default, at 3.5x the latency.

### Reproducing

```
node scripts/dev/_agent_loop_eval.mjs --repeat=3
node scripts/dev/_agent_loop_eval.mjs akash/meta-llama/Llama-3.3-70B-Instruct --trace
node scripts/dev/_agent_loop_eval.mjs --system --repeat=3
```

### Still untested

Long trajectories (this loop is 4–10 turns, not 40), context compaction, parallel-call correctness
under contention, and domain-specific work. The lesson from reversing this decision in a single day
is the one worth keeping: **single-turn scores do not predict loop behaviour**, and a default should
not be moved on primitives alone.
