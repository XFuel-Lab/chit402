# Spend Intelligence — Product Thesis

Internal product thesis. Not a marketing claim until the true-COGS gate below is cleared.

Related: [PRIVATE_SPEND_THESIS.md](./PRIVATE_SPEND_THESIS.md), [PROVIDER_FLOAT_TREASURY.md](./PROVIDER_FLOAT_TREASURY.md), [providers/README.md](./providers/README.md), [RECEIPT_SCHEMA_V2.md](./RECEIPT_SCHEMA_V2.md), [ADR 0005](./adr/0005-provider-float-cogs.md).

## The idea

Agents spend money on inference and cannot see where it goes. XFuel sits in the settlement path across multiple providers, so we can tell an agent what it spent, what it could have spent, and then route the cheaper way — returning a signed receipt for each decision.

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

This slots directly under the existing positioning: *Route any model. Prove every dollar.* Spend Intelligence is what makes the second half literal.

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
| 1 | True COGS — real `usage` × rate card into `provider_cogs.actual` | Gate. Everything downstream is fiction without it |
| 2 | Meter `/v1/chat/completions` | The busiest surface currently contributes no spend data at all |
| 3 | Counterfactual pricer on the receipt | The artifact that demonstrates value, advisory only |
| 4 | Agent surface — MCP spend report + route hint | Where an agent acts on it |
| 5 | Extend `/stats/me` into a spend graph | Human buying decision |
| 6 | Opt-in auto-routing on a cost ceiling | Only with explicit opt-in or a quality signal |

Steps 1–2 are correctness work we owe regardless of whether this product ships. Steps 3–6 are the product.

## Open questions

- **Quality signal.** Auto-routing needs one. Buy an eval harness, sample-judge with a frontier model, or require per-workload opt-in? Unresolved.
- **Rate-card drift.** Published prices move (GLM-5.2 is currently 45% off). A cached card silently misprices COGS — refresh cadence and a staleness bound are needed.
- **Non-token models.** AkashML publishes a `pricing_config` for models priced on request-level factors rather than tokens. The pricer must handle both or explicitly refuse.
- **Prompt caching.** `input_cache_read` is roughly 5–6x below the input rate, so a stable system-prompt prefix is direct margin. Worth measuring before it is promised.
- **Retention window.** How long do metadata rows live, and what does the customer-facing retention promise say?

## Status

Thesis only — nothing here is built or promised. Promote to an ADR (0006) once the approach is accepted, since the metadata-only boundary and the advisory-not-automatic stance are architectural commitments rather than implementation details.
