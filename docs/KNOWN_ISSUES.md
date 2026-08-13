# Known Issues (Diligence)

Honest gaps for auditors, design partners, and Seed diligence. Keep this current.

Last updated: 2026-08-13  
Runtime truth: [RUNTIME_STATE.md](./RUNTIME_STATE.md)

## Production / money

| Issue | Severity | Status |
|-------|----------|--------|
| **Flat $0.01 price does not cover COGS on a median agent call** | **Critical** | **Fixed** 2026-08-12 — metered against a rate card with a floor (`src/pricing.js`) |
| **The default model was sold at a 4.6x loss on every agent call** | **Critical** | **Fixed** 2026-08-12 — per-model rate rows + measured COGS. See below |
| **COGS was `gross × 70%` — a share of our own price, not of the work** | **High** | **Fixed** 2026-08-12 — real tokens × the provider's published rate (`src/provider-rates.js`) |
| **Tool definitions are dropped: agents cannot use tool calling through XFuel** | **High** | **Fixed** 2026-08-12 — forwarded on the `akash` hub; Theta refuses rather than silently dropping |
| **Tool calling worked only on the free surface: `/task-request` accepted no `tools` at all** | **High** | **Fixed** 2026-08-12 — the paid path runs a full agent loop. See below |
| **`max_tokens` was priced but never forwarded on the paid path** | **High** | **Fixed** 2026-08-12 — same change; the quote and the request now agree |
| **The paid path served mocks: `/task-request` took payment and signed a receipt for an inference that never ran** | **Critical** | **Fixed** 2026-08-12 — see below |
| **The mock was still reachable as a fallback when every provider declined** | **Critical** | **Fixed** 2026-08-12 — mocks are opt-in (`ALLOW_MOCK_INFERENCE`); otherwise the task fails. See below |
| **A failed task returned `status: "failed"` and no reason** | Medium | **Fixed** 2026-08-12 — `/task-status` returns `error.code`/`message`/`hint` |
| **`/v1` receipts are unsigned — the verifiable-receipt product is absent on the busiest surface** | **High** | **Fixed** 2026-08-12 — `/v1` now returns the canonical signed receipt; both surfaces produce one identical signature. See below |
| **The default model could not complete an agent loop (0/6)** | **High** | **Fixed** 2026-08-12 — multi-turn eval reversed a same-day routing decision. See below |
| **`/v1` receipts claimed `payment.rail: "unmetered"` even when x402 had settled** | **High** | **Fixed** 2026-08-12 — a regression introduced with `X402_METER_V1` |
| **x402 uses the `exact` scheme, so output is quoted at the `max_tokens` ceiling — buyers overpay by up to 3.8x** | **High** | Open, **unblocked** 2026-08-12 — CDP settles `upto` on Base mainnet today; the blocker is our x402 v1→v2 + Permit2 migration ([X402_SCHEME_MIGRATION.md](./X402_SCHEME_MIGRATION.md)) |
| **Facilitator fee is ~10% of gross at $0.01; batch-settlement not enabled** | Medium | Open, **unblocked** 2026-08-12 — previously believed withdrawn; CDP advertises `batch-settlement` on Base mainnet. Same v2 prerequisite |
| **No prompt-cache support; router has no session affinity** | Medium | **Reassessed** 2026-08-12 — the blocker moved: our default model *does* price cached reads, but hits are not reported. See below |
| **All buyers share one provider API key, so upstream prompt caches are not isolated between tenants** | **High** | Mitigated 2026-08-12 (per-buyer `cache_salt`), unconfirmed upstream — see below |
| ~~Receipt `gross_amount` is buyer-declared, not the amount x402 collected~~ | **Critical** | **Fixed 2026-08-11** — gross derives from the settled challenge amount. Historical rows still inflated, see below |
| **Live `/stats` USDC fee totals are ~100x overstated by pre-fix task rows** | **High** | **Fixed** 2026-08-12 — money is summed only from rows created after the fix, and the excluded count is published. See below |
| ~~Assurance tier selected from buyer-declared `amount`~~ | High | **Fixed 2026-08-11** — tier floors now read settled gross |
| Provider COGS burns a flat 70% of quote, measured ~21x off actual | High | Open — [SPEND_INTELLIGENCE_THESIS.md](./SPEND_INTELLIGENCE_THESIS.md) |
| ~~Base mainnet x402 facilitator not wired on live demo host~~ | — | **Resolved 2026-08-06** — public `api-testnet` on Base + CDP |
| Payment binding is server-attested (`in_proof: false`) until SP1 guest v2 | Medium | Guest rebuild + new programVKey required |
| **`/v1` never measured COGS, so the busiest surface spent provider money with no record of it** | **High** | **Fixed** 2026-08-13 — `/v1` measures and burns like `/task-request`; the subsidy is capped and reported. See below |
| **The spot-check sampler would flag ~1 in 5 honest re-executions as slashable** | **High** | Open — **dormant, do not enable.** `buildSpotCheckRecord` compares output hashes for byte equality; measured self-disagreement on our default model is 21%. See below |
| OpenAI-compatible `/v1` path is **unmetered** (Phase 1) | Medium | **By decision** as of 2026-08-13 — [ADR 0006](./adr/0006-receipts-are-not-a-paid-feature.md) keeps it free as the funnel. Paid path = `/task-request` + x402 |
| Web2 collect-and-forward custody not counsel-cleared | High if scaled | Do not enable broad OpenAI pass-through revenue yet |

### Flat pricing is below cost on real agent traffic (Critical)

Our pricing was modelled on chat-shaped calls. Production agent telemetry says otherwise. The
median call in [Microsoft/UIUC's GitHub Copilot characterization](https://arxiv.org/html/2608.00101v1)
(761M LLM calls across 13.5M sessions, June 2026) is **68,000 input / 247 output tokens** — roughly
90x the input of a median chat prompt, at an input:output ratio above 275:1.

At AkashML's Llama 3.3 70B rate ($0.13 / $0.40 per M) and no prompt caching:

| Workload | Input | Output | COGS | Net at flat $0.01 |
|----------|-------|--------|------|-------------------|
| Chat baseline | 750 | 105 | $0.0001 | +$0.0089 |
| **Agent call, median** | 68,000 | 247 | **$0.0089** | **+$0.00006** |
| Agent call, P90 (derived) | 94,000 | 580 | $0.0124 | **−$0.0034** |

So the median agent call yields ~$0.00006 of contribution, and covering ~$134/mo of fixed
infrastructure would need **~2.2M calls/month**. Heavy calls lose money outright.

Flat pricing also faces severe adverse selection: LLM calls per session are 15 at the median but
100.5 at P90, **7.8% of sessions generate 44.2% of all tokens** via context compaction, and tool
failures hit 9% of turns while amplifying compute up to 4x.

Cross-checked against published rates at the same 68k/247 shape: Claude Sonnet 5 costs **$0.139**
per call, DeepSeek V4 Pro via DeepInfra **$0.119**, Novita DeepSeek V3.2 **$0.018**, and only
Fireworks' sub-4B tier (**$0.0068**) clears $0.01 — and that margin drops to +22% once the
facilitator takes its cut. **Our flat price is profitable on sub-4B models only.** AkashML's
$0.13/M input is genuinely competitive on this input-heavy shape; the price is the problem, not
the provider.

Three consequences: meter tokens with a floor rather than charging flat; adopt the x402 **`upto`**
scheme, which exists precisely for this ("the buyer authorizes a ceiling and you settle the actual
amount"); and capture real usage.

### The default model was sold at a 4.6x loss (Critical, fixed 2026-08-12)

Metering fixed the price but not the *rate card's shape*: a single `default` row charged the same
for every model, and AkashML's catalogue spans **$0.037/M to $1.40/M input, a 38x range**. Priced
per model against measured COGS (`scripts/dev/_margin_check.mjs`, live rates), five of six models
were healthy and the sixth was catastrophic — and the sixth was the one we route to by default:

| Model | COGS / median agent call | Was charged | Margin |
|---|---|---|---|
| `openai/gpt-oss-120b` | $0.00264 | $0.02085 | 7.90x |
| `meta-llama/Llama-3.3-70B-Instruct` | $0.00894 | $0.02085 | 2.33x |
| `deepseek-ai/DeepSeek-V4-Flash` | $0.00959 | $0.02085 | 2.17x |
| `Qwen/Qwen3.6-35B-A3B` | $0.00977 | $0.02085 | 2.13x |
| **`zai-org/GLM-5.2` (the default)** | **$0.09629** | **$0.02085** | **0.22x — −$0.075/call** |

`AKASHML_DEFAULT_MODEL` and `xfuel/auto` both resolve to GLM-5.2, so *the unmodified default path
lost money on every median agent call* — worse per call than the flat price it replaced. Fixed by
giving GLM its own row (`DEFAULT_RATE_CARD` in `pricing.js`), which takes the default path to
+$0.112.

Theta serves GLM-5.2 too, at **$0.106** per median agent call — dearer still — and at the time
`resolveCatalogModel` reached for `theta/glm_5_2` *before* the Akash copy, so `xfuel/auto` was
landing on the worst row in the catalogue. It has a row of its own now, and the preference lists no
longer include it. All eight live chat models across both hubs clear cost, at 1.52x to 7.90x; the
thinnest is `theta/qwen3` at 1.52x.

Two things this leaves open. GLM costs a buyer **$0.21 against $0.021 for every other model**, so
routing agent work to it is a live commercial choice rather than a hidden subsidy — the quality
evaluation has since been run and justifies it on correctness (`docs/MODEL_QUALITY_EVAL.md`: 6/6
agent loops against Llama's 0/6), but whether that is the right trade at 10x the buyer's price is a
founder call, not an engineering one. And a newly-listed dear model still falls to the cheap default
row until someone adds one; the backstop is a runtime warning (`_warnIfBelowCost` in
`ai-listener.js`) that fires when measured COGS exceeds the settled price, which detects the loss
but only after we have eaten it.

**This fix did not reach the default path** — pricing read the alias, not the resolved model. See
the next entry.

### The per-model rate card never applied to the default request (Critical, fixed 2026-08-13)

The GLM row above fixed the 4.6x loss for anyone who *named* GLM-5.2. Almost nobody does. The
documented default is `model_id: "xfuel/auto"`, and pricing ran **before** routing resolved that
alias: `quoteTask` matches `model_id` verbatim, `xfuel/auto` matches no row, so every alias request
was quoted on the cheap `default` row whatever it went on to serve.

```
xfuel/auto  (median agent call, tools present)   quoted $0.0206  →  served GLM-5.2, COGS $0.096
akash/zai-org/GLM-5.2  (same request, named)     quoted $0.2062
```

So the −$0.075/call loss was still live on the one path a real caller takes, and the fix that
"closed" it was only ever reachable by a caller who bypassed the default. The `_warnIfBelowCost`
backstop fires after the money is gone, and no test caught it because the pricing tests are unit
tests over `quoteTask` and never priced an alias.

Fixed by `resolvePricingModel` (`x402-server.js`), which resolves the alias through the live
catalog — same `requestShape` classification routing uses — and prices the resolved id. Both the
402 challenge and the settlement amount go through it, so they cannot disagree. `/task-quote` now
reports `requested_model` and `priced_model` so a buyer can see *why* an alias costs what it does:
shape-aware routing means the same alias is two different prices, $0.021 for a short completion and
$0.21 for agent work, and the alias alone does not explain that.

A catalog outage falls back to quoting the requested id, which is the old behaviour — the wrong
price is better than refusing a payable request.

### An unset signing secret makes every receipt unsigned, silently (High, mitigated 2026-08-13)

`RECEIPT_SIGNING_SECRET` is optional in code: `buildReceipt` signs only `if (signingSecret)`. With it
unset the receipt still renders, still carries the model, provider, payment and output hash, still
*looks* authoritative — and has no `signature` field. Nothing warned at boot, nothing appeared on
`/health`, and the failure surfaces at the far end, when a partner runs the SDK verifier and it
returns nothing to verify.

Tier-1 signed receipts are the product, so the whole product could be off because of one missing
line in a `.env` on one host. Found by pointing the new deploy probe at a local gateway: 9/11, both
failures for this one reason.

Mitigated, not fixed — the secret is still optional, because requiring it would take down any host
that has been running without it. `GET /health` now reports `receipts.tier1_signed` with an explicit
warning string, the gateway logs a warning at boot, and `scripts/dev/_verify_deploy.mjs` checks it
before it checks any signature, so the boring cause is reported instead of a cascade of signature
failures.

Found alongside it, in the same quote path: `/v1` prices output at the `max_tokens` ceiling but
serves `min(max_tokens, OPENAI_GATEWAY_MAX_TOKENS_CAP)`, so a caller asking for 100,000 tokens
against the demo's cap was quoted **$0.09 of output it was structurally unable to receive**. The
quote now uses the capped figure. Only reachable with `X402_METER_V1` on, which is off — worth
fixing before the flag flips rather than after.

### The free surface spent provider money off the books (High, fixed 2026-08-13)

`/task-request` has always reconciled COGS after serving — measure real tokens against the
provider's published rate, burn it against the prepaid float, record it on the receipt
(`_reconcileProviderCogs`). `/v1` did none of it. It computed `usage`, registered the task, and
stopped. So the busiest surface — the one that is unmetered by default and therefore the one
where *we* pay for every call — was the one surface with no cost record at all.

Two consequences, both quiet. The float balance overstated by the entire volume of unmetered
traffic ever served, because money left the AkashML account that no burn ever reflected. And
"what does the free tier cost us per day" had no answer anywhere in the system, on any surface,
at any granularity.

The only brakes were a request-rate limit and `OPENAI_GATEWAY_MAX_TOKENS_CAP`, and neither knows
what a call costs. At measured rates, 150 demo calls a day is **$1.30 of short completions or
$14 of agent-shaped ones** — an order of magnitude apart, indistinguishable to a counter of
requests.

Fixed in three parts. `/v1` now measures and burns COGS on the same code path as the M2M
surface, so `provider_cogs` appears on the `/v1` receipt exactly as it does on the other one
(unsigned block; it is not in `canonicalSignedPayload`, and `route.provider` still resolves from
`task.result.provider` first, so no existing signature moved). `GET /health` reports a
`free_tier` block with today's give-away. And `FREE_TIER_DAILY_COGS_USD` — default $10 per
caller per day, denominated in provider cost rather than requests — returns 402
`free_tier_exhausted` past the ceiling, with `Retry-After` set to the UTC reset.

Bounded, not solved, and both limits are deliberate. The counter is in memory like the request
rate limiter, so **a restart forgives the day's spend** — acceptable for a spend guard, which is
why it never touches a buyer's invoice. And the ceiling is checked before a call but charged
after it, so a caller can cross it by at most one call; a pre-serve check cannot know what the
pending call will cost. The one to watch operationally: the demo key is a **single bucket for
the whole public internet**, so `FREE_TIER_DAILY_COGS_USD` is also the cap on public exposure.
`/v1/images/generations` and `/v1/audio/transcriptions` are not COGS-metered yet — no per-token
rate exists for them — so they neither burn nor draw on the allowance.

### The spot-check sampler compares bytes, and models are not deterministic (High, open)

`src/spotcheck.js` decides `pass` vs `mismatch` by comparing `keccak256` output hashes for
equality, and sets `slashable: outcome === 'mismatch'`. The sampling half is sound — a per-epoch
beacon makes the draw unpredictable to the provider and auditable afterwards — but the comparison
half assumes two honest runs of the same model produce identical bytes.

Measured 2026-08-13 (`scripts/dev/_canary_probe.mjs`, 576 calls, temperature 0): identical prompt,
identical model, same provider produced **different text on 21% of prompts for `zai-org/GLM-5.2`**,
which is what `xfuel/auto` resolves to for agent work. `openai/gpt-oss-120b` was 17%. Different
text is a different hash, so enabled against a re-execution this marks roughly one honest check in
five as a mismatch — and flags it slashable.

**Not live.** It reaches a receipt only when the mechanism resolves to `zk-spotcheck`, which needs
`VI_SPOTCHECK_ENABLED=true` and a non-zero `VI_SPOTCHECK_RATE_BPS`; both default off. Nothing has
been sampled in production. The exposure is that the flags default off rather than that the
comparator is correct, so this is a "do not switch on" rather than an incident.

Fix is in [ADR 0007](./adr/0007-spot-check-assurance.md): keep the sampler, replace byte equality
with an accumulating agreement rate per `(provider, model)` scored over a curated probe battery
(23 checks per pair, against 179 uncurated), and stop deriving `slashable` from one comparison
against providers who have staked nothing.

### COGS was a percentage of our own price (High, fixed 2026-08-12)

`estimateCogs` was `gross × PROVIDER_COGS_BPS` (70%). That is circular — raising our price raised
our recorded cost — and it was wrong by 1.65x to 5.6x depending on the model. Float burns, receipt
`provider_cogs.actual`, and every margin figure inherited the error.

`src/provider-rates.js` now prices real tokens at the provider's published per-token rate, read at
runtime from the catalogue poll (verified AkashML field names: `input`, `output`,
`input_cache_read`, and a per-call `request` charge that is zero everywhere today). Records carry
`basis: 'measured' | 'estimated'` so a real cost is never mistaken for the bps fallback, which now
applies only when the catalogue poll fails or a new provider publishes no rate at all.

### Tool calling did not survive the gateway (High, fixed 2026-08-12)

Found while building the model eval, which had to bypass our own gateway to test it. An agent
calling XFuel with tools got a prose reply where it expected a structured call, silently — which
undercuts the "OpenAI-compatible gateway for agents" claim about as directly as anything could,
since tool calling is how agents do work.

It was broken in three independent places, and fixing any one alone would not have helped:

1. **Request side.** `openai-gateway.js` destructured only `{ model, messages, max_tokens,
   temperature, stream }`, so `tools` never left the building.
2. **Message validation.** Every message was required to have a string `content`, which rejects both
   shapes a tool loop depends on — an assistant turn with `content: null` plus `tool_calls`, and a
   `role: "tool"` result turn. A multi-turn agent conversation was literally unrepresentable.
3. **Response side.** `akashml-infer.js` treated empty `content` as `empty_output` and *failed
   over*. A tool call arrives with `content: null` by design, so a correct tool call was read as a
   provider failure and retried elsewhere.

Now forwarded on the `akash` hub, with `tool_calls` returned and `finish_reason: "tool_calls"` set.
Verified end to end against the live provider (`scripts/dev/_tool_e2e.mjs`): tool call out, result
fed back, correct answer.

Two deliberate refusals rather than silent degradation. **Theta returns 400
`tools_unsupported_on_hub`** — its on-demand completions accept only
`{messages, max_tokens, temperature, top_p, stream, enable_thinking}` and there is no tools
parameter, so forwarding would drop them and return prose. And **`stream: true` with `tools` returns
400** rather than falling back to the prose path, because assembling `tool_calls` deltas across
chunks is not implemented and the prose path would hand back a plausible-looking answer with the
tool call missing.

The receipt's output hash now covers `{content, tool_calls}` rather than content alone; hashing
content would have attested an empty output for the response the caller actually acts on.

### The paid path served mocks (Critical, fixed 2026-08-12)

`POST /task-request` — the surface that takes USDC, charges the 50 bps fee, and returns the signed
receipt that is the entire product — **could not reach a real provider.** It settled payment, routed
to `theta-edge-mock`, and returned a correctly signed receipt attesting `provider: theta-edge-mock`
over an output hash of the literal string `mock-output-<taskId>`. A cryptographic attestation of an
inference that never happened is the worst failure this product can have, and it was the default
behaviour for every paying caller.

Meanwhile `/v1` — the *free* surface — served real inference throughout. Nothing compared the two,
so the gap survived every change to routing.

Three defects, each individually sufficient:

1. **The treasury default hijacked routing.** `preferred_provider` fell back to
   `PROVIDER_FLOAT_DEFAULT` (`theta-edgecloud`), which is a decision about *which COGS float to
   debit*, not where inference runs. Every request without an explicit provider was pinned to a hub
   with no API key configured. `requestedProvider` is now separate: only a caller's explicit choice
   steers routing, and absent one, routing follows the model's hub.
2. **`xfuel/auto` was forwarded verbatim.** It is an XFuel alias, not a model any hub knows, so
   AkashML answered `404 model_not_found` even when a provider *was* named. `/v1` resolves aliases
   through the hub catalog; the M2M path never did. It now shares `resolveCatalogModel`, and naming
   a provider narrows the auto pick to that hub rather than being ignored.
3. **Both failures fell through to mock and reported success.** An unknown model now fails the task
   with `model_not_found` instead of minting a receipt for a fake inference.

Two honesty fixes in `receipt.js` came out of the same trace. `route.model` reported
`intent.modelId`, so a receipt for an `xfuel/auto` call attested the *alias* rather than the model
that served — unverifiable by anyone. And `route.provider` fell back to the float label when nothing
ran, so a failed task named a provider that never touched it; a real COGS burn now outranks that
label, and a task that served nothing attests no provider.

The signed receipt itself was sound the whole time: `/task-request` → `/receipt/:id` verifies, and
tampering with `route.provider` invalidates the signature (`scripts/dev/_receipt_verify.mjs`). The
attestation machinery was working correctly — it was faithfully attesting a mock.

Guarded by `test/m2m-routing.test.mjs`, and reproducible live with
`scripts/dev/_m2m_routing.mjs` (default / named-provider / hub-prefixed model / unknown model).
Worth noting the suite was **243 green** while the paid path served mocks: none of it exercised
`/task-request` end to end against a provider.

### Agents could only run tool loops for free (High, fixed 2026-08-12)

Tool calling was fixed on `/v1` earlier the same day. `/task-request` — the surface that takes the
USDC and returns the signed receipt — **never destructured `tools` from the request body**, so the
one workload the beachhead runs was unavailable on the one surface we charge for. A caller who
wanted a receipt for an agent loop could not get one; a caller who wanted an agent loop got it for
free. The same hole was in `packages/sdk`, so the typed client could not express it either.

`tools`, `tool_choice`, `max_tokens` and `temperature` now travel with the intent, and `tool_calls`
plus `finish_reason` come back on `result`. Verified live, both turns, through the paid path:
`scripts/dev/_paid_tool_e2e.mjs` gets a `get_invoice_total(...)` call out, feeds the result back, and
the model closes the loop with the right figure. Tools on a hub that cannot serve them fail with
`tools_unsupported_on_hub` rather than returning prose the loop cannot parse, matching `/v1`.

**`max_tokens` was the quieter half of this.** `pricing.js` meters the caller's `max_tokens` ceiling
into the quote — that is how the `exact` scheme prices before the work runs — but the intent dropped
it, so every paid inference ran on the adapter's hardcoded 500 regardless of what the buyer paid
for. Asking for 2,000 tokens bought 500; asking for 16 got billed for 16 and cost us 500. Both
directions were wrong and neither was visible in a receipt.

### The mock was still reachable when providers declined (Critical, fixed 2026-08-12)

The mock-serving fix above removed the *routes* into the mock; it left the mock itself as the final
fallback whenever no provider served. Reproduced immediately: with the AkashML key unset, a live
`/task-request` still came back `completed`, `provider: theta-edge-mock`, correctly signed. Every
path that reaches this branch is a path where the buyer has already paid, so a synthetic answer is a
false attestation rather than graceful degradation — and it converts a loud, retryable outage into a
silent, permanent lie in a signed artifact.

Mock inference is now opt-in via `ALLOW_MOCK_INFERENCE=true` for local work. Otherwise the task
fails with `no_provider_available` and the receipt attests no provider. Guarded by *"when every
provider declines, the task fails instead of serving a mock"* in `test/task-request-e2e.test.mjs`.

The failure was only diagnosable because `/task-status` now returns the `error` object; before that,
a failed task reported `status: "failed"` and nothing else, so an unknown model, an unsupported tool
request, and a provider outage were indistinguishable to the caller.

### `/v1` receipts were unsigned (High, fixed 2026-08-12)

`/v1` did not use `receipt.js`. It built its own informational object — `compute`, `payment`,
`proof`, `route` — with **no `signature` field at all**, so the tamper-evident receipt that is the
core product did not exist on the busiest surface. A signed receipt *was* produced for the same task
and reachable at `/receipt/:task_id`, but nothing told the caller that, and the inline `xfuel` block
looked authoritative.

`/v1` now builds the canonical receipt from `receipt.js`, signs it with the same key over the same
canonical payload, and layers its presentation fields (`compute`, `proof.status`, `route.requested`,
`route.resolved`, the notes) on top — only fields that are *not* in the signed payload are added
after signing. The guarantee is stronger than "both are signed": the inline receipt and the one at
`/receipt/:task_id` come from the same task and carry **one identical signature**, so a verifier does
not need to know which surface produced it (`test/v1-receipt-signing.test.mjs`, and
`scripts/dev/_receipt_verify.mjs` end to end against the live provider).

Convergence surfaced a smaller inconsistency worth fixing at the same time: the two surfaces named
the same model differently in a **signed** field — `/v1` used the hub-prefixed catalog id
(`akash/meta-llama/…`) while the M2M path used the bare provider alias. Both now attest the catalog
id, which is also what `/v1/models` publishes.

Found while chasing a different theory that turned out to be wrong — the guess was that `/v1`
receipts *failed* verification because `receipt.route` is reassigned after signing. That reasoning
was sound and would have been a real bug on the `/task-request` path; it just did not apply, because
the receipt was never signed in the first place. **Checked `/task-request` separately: it does not
reassign `route` after signing, and its receipts verify.** Chasing that down is what surfaced the
mock-serving bug above.

### A receipt claimed money that had not moved (High, fixed 2026-08-12)

The same `/v1` receipt hardcoded `payment: { rail: 'unmetered', note: 'unmetered in Phase 1' }`. That
became false the moment `X402_METER_V1` shipped: a call that settled real USDC over x402 still
returned a receipt saying it was free. Self-inflicted, in the same session that added metering, and
it inverts the rule stated elsewhere in the codebase that a receipt may only report money that
actually moved. It now reports the settled rail, reference, and amount, and says plainly when a call
was not charged.

`route.provider` was also missing from the `/v1` receipt entirely — the field added to the signed
payload for exactly this purpose — and is now populated.

### The default model could not complete an agent loop (High, fixed 2026-08-12)

`xfuel/auto` was moved to Llama 3.3 70B earlier the same day, on a single-turn eval in which all
three candidate models scored 27/27 and Llama was the fastest and cheapest. That eval explicitly
recorded what it had not tested: multi-turn agent loops. Testing it reversed the decision.

Over 18 runs of a dependent-tool-call loop (`scripts/dev/_agent_loop_eval.mjs`), **Llama 3.3 70B
completed 0/6**. It issues three correct tool calls, then on turn 4 stops calling tools and emits
Python source describing what it would have done, with `finish_reason: stop`. It never reaches the
remaining data. The trace confirms our gateway delivered all three tool round-trips correctly, so
this is the model. A corrective system prompt lifts it only to 2/6. GLM-5.2 completed 6/6 and
GPT-OSS-120B 3/6 (5/6 with the system prompt).

The default went back to `akash/zai-org/GLM-5.2` — and that immediately broke the other workload.
GLM is a reasoning model: it spends ~110 output tokens to answer "PONG" and returns **nothing** below
`max_tokens=256`, so the receipt probe, which asks for 16, started failing with an empty answer the
moment the default moved. A blanket default cannot serve both shapes; picking either one is a
correctness bug for the other.

`xfuel/auto` now resolves on the **shape of the request**: tools present, or a tool result being fed
back, means agent work and routes to GLM-5.2; anything else routes to Llama 3.3 70B, which swept the
single-turn primitives 27/27 and answers a short prompt in 3 tokens. `XFUEL_AUTO_MODEL` still
overrides both. The classifier is deliberately crude and cheap (`requestShape` in `hub-catalog.js`),
and it is applied at both call sites — `/v1` and `/task-request` — because for a while only `/v1`
had it, which meant paid agent callers silently got the short-completion model.

The cost is real and is flagged as an open commercial decision: an agent-shaped call routes to a
model where the buyer pays **$0.21 against $0.021** per median agent call. Shape routing narrows the
exposure to the calls that actually need it rather than removing it.

Two process lessons, both cheap to state and expensive to relearn. **Single-turn scores do not
predict loop behaviour** — a model can pass every agent primitive and still fail every agent task.
And an eval that names its own untested gap should be treated as a blocker on decisions that depend
on that gap, not as a caveat under a decision already taken.

### Theta does publish per-token rates — in cents, undeclared

An earlier revision of this file said Theta priced per inference and had no readable rate. Wrong:
`/service/list` carries `cost: {input, output}` over a `cost_divisor`, with an `instructions` JSON
naming the unit (`"1M input tokens"` for LLMs, `"image"` for the diffusion models). GLM-5.2 reads
`154`/`484` per 1M and Qwen3 reads `20`/`40`.

**The one thing the self-describing metadata omits is the currency.** TFUEL is the natural guess —
Theta pays node rewards in it — and it is wrong by ~110x. The integers are US cents, pinned by two
independent checks: the diffusion models read `1` per image and Theta resells those same models at
$0.01/request on RapidAPI (`external_price_tier: "standard"`), and GLM-5.2's `154`/`484` reads as
$1.54/$4.84 against AkashML's $1.40/$4.40 for the identical model — a 10% premium rather than a
currency gap. Anyone integrating a third hub should assume the unit of money is undeclared until
proven, because getting it wrong by 100x is silent and one-directional.

**Usage capture landed 2026-08-12.** Every inference path now normalizes through `src/usage.js` and
stamps `task.usage`, carrying the cached-prompt and reasoning-token splits where the provider
reports them. `/stats` exposes a `tokens` block that keeps provider-reported and estimated counts
separate. The numbers above remain other people's telemetry until our own traffic confirms them.

### Prompt caching — measured, and smaller than modelled (reassessed 2026-08-12)

**The 5.7x was wrong.** It assumed cached input bills at 10% of the fresh rate, which is
OpenAI/Anthropic convention, not our providers'. Measured against AkashML's live API
(`scripts/dev/_cache_probe.mjs`, `_cache_control.mjs`):

- **AkashML already prefix-caches, automatically, at no charge.** A repeated 8k prefix returns in
  1,725 ms against 3,752 ms for a *new* prefix of the same size at the same output length, and stays
  fast after an unrelated request intervenes. The speed-up follows the prefix, not the connection —
  it is a real KV cache, roughly 2–3x on prefill. vLLM enables this by default.
- **It reports nothing.** No `usage.prompt_tokens_details.cached_tokens`, no `cached_tokens`, no
  cache response headers, on either GLM-5.2 or GPT-OSS-120B. `prompt_tokens` is the full count every
  call. Our `usage.js` parses all three shapes and will see null on this provider.
- **`/v1/models` publishes a cache-read rate for some models and not others.** GLM-5.2 $0.26/M
  against $1.40/M input, DeepSeek V4 Flash $0.02 against $0.14, Qwen3.6 $0.05 against $0.14 —
  but **Llama 3.3 70B, GPT-OSS-120B and Qwen3.5 have no cache rate at all.** Read these at runtime;
  the table changes.

So on Llama 3.3 70B, which our COGS baseline was built on, caching is worth **1.0x** — the provider
takes the compute saving. On a model that does price cached reads, a realistic 80% hit rate gives
about **2.5x**, not 5.7x. And because the discount is unreported, we cannot verify we received it,
bill against it, or put it in a receipt. That is our own price-assurance thesis failing on our own
COGS.

**Re-checked after the default moved to GLM-5.2 (2026-08-12).** The conclusion above was drawn when
the default was Llama, which prices no cached reads. GLM-5.2 does — $0.26/M against $1.40/M, **5.4x**
— so the default route is now the one where caching could actually pay, and agent loops resend the
whole conversation every turn, which is the ideal shape for it. Re-probing GLM directly still shows
**no cached-token field**, with call 2 running 31.8% faster than call 1 on the same 6.4k prefix: the
cache is real and remains invisible. So the blocker has moved from *"nothing we route prices cached
reads"* (no longer true) to *"we cannot observe the hits"*, which is a sharper question to put to
AkashML. Check it any time with `scripts/dev/_cache_gate.mjs`.

**Model choice beats caching outright.** GPT-OSS-120B on AkashML is $0.037/M input against Llama
3.3 70B's $0.13, which is **$0.00264 per median agent call versus $0.00894 — 3.4x, uncached, today**,
and it is a routing decision we control rather than a provider behaviour we cannot influence. An
earlier note that AkashML does not serve GPT-OSS-120B was wrong; it is in the catalogue and serves.
The open question was whether the cheap models are *adequate* for agent work; they were then
evaluated, and the answer inverted this paragraph's implied recommendation — see
[MODEL_QUALITY_EVAL.md](./MODEL_QUALITY_EVAL.md).

**Session affinity: gated, and the gate is explicit.** Building it needs two conditions, and only
one is met. (1) *Someone we route to must price cached reads* — met: 3 of 14 live models do, including
the model agent work now routes to (GLM-5.2 at 5.4x, DeepSeek V4 Flash 7.0x, Qwen3.6 2.8x), verified
any time with `scripts/dev/_cache_gate.mjs`. (2) *The provider must expose something to pin to* —
**unanswered**, and it is AkashML's to answer, not ours to engineer around: they document no
affinity key, and the `cache_salt` / `prompt_cache_key` we already send is unconfirmed. Until (2)
lands there is nothing to build — pinning to a provider we cannot address inside is a no-op. The
question is queued in [FOUNDER_ACTIONS.md](./FOUNDER_ACTIONS.md).

One consolation on the accounting: because cached reads are unreported, `costOfUsage` bills every
prompt token fresh, so measured COGS is an **upper bound**. We understate our own margin rather than
overstating it, which is the correct direction to be wrong in.

Still true: `compute-router.js` has no session pinning, and switching providers mid-session throws
away the prefix cache. Less urgent than it looked, because the router is a fixed-order waterfall
rather than a cheapest-per-call selector, so we already have accidental provider-level affinity. The
exposure is failover and any future cheapest-route logic. AkashML documents no session-affinity or
cache-key mechanism, so there is nothing to pin *to* there; Fireworks (`x-session-affinity`),
Baseten, and DeepInfra (`prompt_cache_key`) do expose one.

**Do not build semantic caching.** Agent calls vary in the suffix by construction so the hit rate is
near zero, false hits are measured (54 versus 3 in the MeanCache comparison), it is an attack surface
in its own right, and it would make our receipts false — no provider would have run the request.

### Cross-tenant prompt-cache leakage via a shared provider key (High)

Every XFuel buyer is multiplexed through one AkashML key, so the provider sees a single account and
its per-account cache isolation gives our tenants no separation from each other. CacheProbe
(SAGAI '26) measured this exact architecture on OpenRouter — a router with shared upstream
credentials — and found cross-account cache sharing up to **100%** on some upstreams, with prompts
recoverable by timing. Their conclusion: the flaw "stems from OpenRouter's use of shared
organizational credentials rather than from OpenRouter's routing layer itself." It applies to us
whether or not we ever ship a caching feature, and it matters because buyer prompts contain
proprietary agent strategy.

Mitigated by sending a per-buyer namespace upstream — `cache_salt` (vLLM's spelling) and
`prompt_cache_key` (OpenAI's) — derived in `buyer-attr.js` by re-hashing the buyer's API-key digest,
so the provider never receives a value that correlates with our own records. AkashML accepts both
fields.

**Unresolved: we cannot confirm AkashML honours either.** A salted-versus-unsalted timing test was
inconclusive — GLM-5.2's variable reasoning tokens swamp the signal and AkashML serves from many
datacenters. Treat this as defence in depth, not a guarantee, and put the question to AkashML in
writing along with whether caches are isolated per API key.

### Receipt gross vs collected payment (Critical)

Two independent numbers are in play on `POST /task-request` and nothing reconciles them:

- **What is charged** — `priceUSDC()` returns `payment.maxAmount` when the caller supplies it, else the flat `X402_USDC_PRICE_DEFAULT` (`10000` = $0.01). See `services/gateway/src/x402-server.js:49-55`.
- **What the receipt reports** — `req.body.amount`, supplied by the caller, drives `calculateTaskFee` and `payment.gross_amount` / `fee_amount` / `net_amount` (`server.js:651-653`, `receipt.js:380-387`).

A caller therefore controls both values independently and can pay $0.01 while minting a signed receipt asserting any gross it likes. Blast radius: signed receipts overstate settled value, `/stats` fee totals include revenue never collected, SP1 proofs bind a payment amount that may be fictional, and tier floors are trivially satisfied.

**Our own flagship demo does this.** `packages/sdk/examples/flagship-demo.ts:88` sets `XFUEL_AMOUNT=1000000` ($1.00) while line 160 pays `maxAmount: usdc.amount` ($0.01), so every receipt it produces claims **$1.00 gross for a $0.01 payment** — under a banner reading "prove every dollar" (line 137).

This is a product-integrity issue, not a rounding nit: it is the one field a price-assurance product cannot get wrong.

**Fixed 2026-08-11.** `runX402Handshake` now returns `settledAmount`, read from the challenge record bound to the payment nonce (captured before `settlePayment` marks it spent). `/task-request` uses that as gross for fee math, `intent.amount`, receipts, and tier floors, and logs a warning when the caller's declaration diverges. The declared `amount` remains authoritative only for legacy TFUEL, which has no settlement to derive from. Regression test: *"settled gross cannot be restated by the paid retry"* in `services/gateway/test/x402-server.test.mjs`.

### Historical `/stats` inflation (fixed 2026-08-12 by windowing)

The fix stops new bad rows but does not retroactively correct task records already written. Measured on the live testnet host at 2026-08-11T17:02Z:

- USDC rail: **26 tasks, 130,000 base units of fees** ($0.13)
- That averages **5,000 units of fee per task**, which at 50 bps implies **$1.00 gross per task** — the pre-fix demo default
- True fees, had gross been the $0.01 actually paid: 26 × 50 = **1,300 units (~$0.0013)**

So the headline "USDC fees" figure reads about **100x** the amount actually collected, matching the $1.00-declared / $0.01-paid ratio exactly. The 7d panel ($0.03 over 6 USDC tasks) has the same 100x factor.

**Resolved by windowing, not backfilling.** `computeUsageStats` now sums money only from tasks
created at or after `STATS_FEE_TRUST_FROM` (default `2026-08-12T00:00:00Z`, deliberately a few hours
after the fix so the boundary errs towards under-reporting our own revenue). Backfilling was
rejected: the settled amount for a historical row cannot always be recovered, and inventing one
would be the same class of error as the original bug.

Three properties make this a correction rather than a cover-up. Task **counts** are untouched — only
amounts are windowed, so activity history stays intact. The excluded rows are **published**, as
`payments.fee_basis.excluded_tasks` in the JSON and on the dashboard, rather than silently dropped.
And the **7d north-star figure is windowed too**, since the headline number is the one most likely to
be quoted and must not be the one place the inflation survives. A row with no timestamp cannot be
placed relative to the fix and is treated as untrusted. `STATS_FEE_TRUST_FROM=all` opts out.

Current `/stats` fee figures are now safe to quote — including in
[FOUNDER_ACTIONS.md](./FOUNDER_ACTIONS.md) item 10 (seed deck) — with the caveat that they are a
post-2026-08-12 window, not lifetime totals.

## Trust / product honesty

| Issue | Severity | Status |
|-------|----------|--------|
| Tier-2 does **not** prove black-box LLM correctness | — | Documented; do not overclaim |
| Private Spend is **gateway-trusted**, not prompt encryption | — | Thesis + receipts state this |
| Tier-3 Verified Inference not E2E on-chain | Medium (moat timeline) | Narrowed: [TIER3_TIMEBOX_DECISION.md](./TIER3_TIMEBOX_DECISION.md) |
| Confidential / TEE provider tier is opt-in stub | Low | Needs `CONFIDENTIAL_PROVIDER_*` env |

## Ops

| Issue | Severity | Status |
|-------|----------|--------|
| Demo gateway is single Lightsail + IP-locked prover ALB | Medium | Staging SLA draft; not enterprise HA |
| Prover may be scaled to 0 (cost) → proofs gated | Medium | Document for partners |
| A2A message store is in-memory (not durable like task receipts) | Low | Receipt lineage on tasks is durable |

## Narrative residue

| Issue | Severity | Status |
|-------|----------|--------|
| Legacy Theta / Believer decks (removed; in git history) | Low | Do not use for fundraising; go-forward = POSITIONING.md |
| Public marketing site may still need scrub | Medium | Founder: site/deck pass |

## Not bugs

- TFUEL rail exists as optional fallback only when explicitly enabled.
- Theta EdgeCloud remains an optional GPU provider, not settlement home.
