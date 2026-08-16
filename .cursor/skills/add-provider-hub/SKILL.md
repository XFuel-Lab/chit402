---
name: add-provider-hub
description: >-
  Add or extend an inference provider hub in the XFuel gateway (services/gateway) — a new
  aggregator or DePIN network such as ZAN, OpenRouter or Together, or a new model class on an
  existing hub (Theta, AkashML). Use when wiring hub discovery into hub-catalog.js, reading a
  provider's published prices in provider-rates.js, teaching xfuel/auto to route to or around it,
  giving it a capacity or health signal, or adding its inference path to openai-gateway.js. Also
  use when a hub changes its price encoding or catalogue shape. Pricing is load-bearing here:
  under cost-plus the provider's own rate *is* what the buyer pays, so a misread rate is billed
  straight through, and an unreadable one falls back to the rate card in silence.
---

# Adding a provider hub to the gateway

A hub is **discovery + rate + capacity + inference**, in that order. The catalogue is the control
plane: `provider-rates.js`, `pricing.js`, routing and `/v1/models` all read from it, so a row that
is wrong in the catalogue is wrong everywhere downstream.

Since [ADR 0009](../../../docs/adr/0009-cost-plus-pricing.md) the gateway prices as **measured
provider COGS + 10%**. That changes the stakes of this work: the rate you parse is no longer an
internal margin figure, it is the buyer's invoice.

## The two failure modes that cost money

Both are silent. Neither throws, and both look like a working integration.

**1. The rate is parsed, and wrong.** Theta encodes price as an integer over `cost_divisor`, in the
unit named by its `instructions` field, **denominated in US cents — which the API never states.**
TFUEL is the natural guess and is wrong by about 110x. Under cost-plus that is charged to the buyer.
Two independent cross-checks pinned it: the diffusion models read `1` per image against the
$0.01/request Theta bills for the same models on RapidAPI, and GLM-5.2 read `154`/`484` per 1M
tokens against AkashML's $1.40/$4.40 for the *identical model* — a 10% premium, not a 110x gap.

> **Never trust a hub's price encoding until you have reconciled one model against an independent
> price for the same model.** A same-model comparison across two hubs should land within single-digit
> multiples. Orders of magnitude mean you have the unit wrong, not a bargain.

**2. The rate is not parsed at all.** `rateForModel` returns `null` for any `cost` shape it does not
recognise, `estimateCogsFromRequest` returns `basis: 'no_rate'`, and the quote **falls back to the
rate card**. The hub serves, receipts sign, tests pass, and every model on it is priced off a card
nobody chose for it. There is no error. A test asserting `basis === 'measured'` for the new hub is
the only thing that catches this.

## Decision rules

| The hub… | Do this |
|---|---|
| Publishes OpenAI-ish `{input, output}` decimal USD-per-token | Nothing — the default branch of `rateForModel` handles it |
| Uses its own encoding (integers, divisors, per-1M, a currency) | New `<hub>Rate(cost)` branch, keyed on `catalogModel.hub`, converting **to USD per token** |
| Prices per artefact (image, video) not per token | `input: 0, output: 0`, put the charge in `perRequest`. Take `Math.max`, never the sum — ESRGAN carries `1` on both sides and summing double-charges |
| Charges a flat fee per call on top of tokens | Must land in `perRequest`, or short calls under-report COGS exactly where it hurts most |
| Discounts cached reads | `cachedInput`. Absent means *not discounted*, not free — leave it `null` so reads bill fresh |
| Publishes live capacity (worker/replica counts) | Map it to `capacity` in the catalogue row |
| Publishes no capacity | Leave `capacity` **undefined**, and extend `provider-health.js` probing — see below |

## Capacity: unknown is not zero

`hasCapacity` treats only a hub that publishes capacity *and* reports none as down. A hub that says
nothing keeps working exactly as before. Preserve that: coercing an absent field to `0` silently
removes a working hub from `xfuel/auto`.

`state: "public"` is not capacity. Every Theta service reads `public`, including ones that answer
every request with a 409; `workers` is the field that distinguishes them.

If the new hub publishes nothing, observed health is the only signal. `provider-health.js` records
success and failure from real traffic for free, but **active probing is currently hardcoded to
AkashML** (`m.hub === 'akash'`, and the native id is derived by stripping `akash/`). A new
capacity-less hub needs that generalised, or it gets passive health only.

## Implementation checklist

Copy this and track it:

```
- [ ] hub-catalog.js: fetch<Hub>Models(base, key, fetchFn) — 8s timeout, returns
      { models, source, error }, never throws; a dead hub must degrade to the others
- [ ] hub-catalog.js: map<Hub>Service(row) -> CatalogModel, id = `<hub>/<alias>`,
      carrying `cost` verbatim and `capacity` if published
- [ ] hub-catalog.js: classify<Hub>Model(row) -> modality
- [ ] hub-catalog.js: add to the Promise.all in getHubCatalog + merge + source string
- [ ] hub-catalog.js: resolveCatalogModel — bare-native-id branch if ids contain slashes
- [ ] provider-rates.js: <hub>Rate(cost) branch in rateForModel, converting to USD/token
- [ ] RECONCILE one model's rate against an independent price for the same model
- [ ] openai-gateway.js: infer<Hub>() + recordSuccess/recordFailure on both paths
- [ ] provider-health.js: generalise probing if the hub publishes no capacity
- [ ] autoPreferenceFor: add to the order lists only with eval evidence (MODEL_QUALITY_EVAL.md)
- [ ] env.example: <HUB>_BASE_URL, <HUB>_API_KEY, documented
- [ ] Tests below; `npm test` in services/gateway (auto-discovers test/*.test.mjs)
- [ ] node scripts/dev/_verify_deploy.mjs <url> after deploy
- [ ] Update docs/RUNTIME_STATE.md and KNOWN_ISSUES.md if the hub changed behaviour
```

## Non-negotiable invariants

1. **A hub outage degrades, never breaks.** Every fetch is wrapped, returns empty on failure, and
   logs. A failed poll drops that hub's rows so preference lists fall through to the others.
2. **Unknown capacity means available.** Only an explicit zero from a hub that publishes capacity
   marks a model down.
3. **`xfuel/auto` is filtered, an explicit request is not.** A caller naming a dead model gets the
   attempt and a real error; auto-routing must skip it, because the caller had no way to know.
4. **Rates are USD per token**, rounded *up* into base units. Never under-report what we owe.
5. **The catalogue holds no pricing logic.** `priceFor` is injected into `toOpenAIList`;
   `provider-rates.js` already imports the catalogue and importing it back closes the cycle.
6. **Advertised must equal charged.** `/.well-known/x402` and `/task-quote` are asserted equal by
   `_verify_deploy.mjs` — that check exists because they diverged for an hour on 2026-08-15.

## Required tests

Mirror `test/hub-catalog.test.mjs` and `test/provider-rates.test.mjs`:

1. **Mapping** — a captured real response row maps to the expected `CatalogModel`, including
   `cost` and `capacity`. Use a real payload, not an invented one.
2. **Rate reconciliation** — the parsed rate for one known model equals its published price, as a
   literal expected number. This is the test that catches a unit error.
3. **COGS is measured, not estimated** — `estimateCogsFromRequest` returns `basis: 'measured'`
   (or `'estimated'`), never `'no_rate'`, for a model on the new hub.
4. **Degradation** — with the new hub's fetch failing, the catalogue still returns the other hubs
   and `xfuel/auto` still resolves.
5. **Capacity** — zero capacity is skipped by `xfuel/auto`; absent capacity is still routable; an
   explicit request for a zero-capacity model still resolves.

Hub polls must be stubbed via the injected `fetchFn` — no test may hit a live hub.

## Housekeeping

`HUB_CATALOG_OFFLINE=true` forces the seed for tests. If the hub should appear offline, add rows to
`CATALOG_SEED`. Keep `docs/RUNTIME_STATE.md` (as-deployed truth), `docs/KNOWN_ISSUES.md` and
`services/gateway/env.example` in sync — and if the hub's economics change the pricing argument,
that belongs in an ADR, not in this file.
