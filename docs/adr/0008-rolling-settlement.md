# ADR 0008 — Rolling Settlement: Charge the Previous Call

Status: Proposed (implemented behind `X402_ROLLING_SETTLEMENT`, default off). Date: 2026-08-13.
Related: [ADR 0002](./0002-base-settlement-home.md), [ADR 0006](./0006-receipts-are-not-a-paid-feature.md), [X402_SCHEME_MIGRATION.md](../X402_SCHEME_MIGRATION.md), [PRICING_STRATEGY.md](../PRICING_STRATEGY.md), [KNOWN_ISSUES.md](../KNOWN_ISSUES.md).

## Context

The x402 `exact` scheme requires a price before the work runs. Output length is not
knowable then, so `pricing.js` quotes output at `max_tokens`. Agents ask for a large
ceiling and use a fraction of it, so buyers are systematically overcharged. Measured
on a ceiling-heavy call — 1,000 prompt tokens, `max_tokens: 20000`, 1,000 tokens
actually produced, priced on the GLM-5.2 row — the quote is **$0.183 against $0.012 of
real usage, a 15x overcharge**. This is a live High-severity entry in `KNOWN_ISSUES.md`.

The known remedy is the x402 `upto` scheme, which settles actual usage and refunds the
difference. `X402_SCHEME_MIGRATION.md` scopes that as an x402 v1→v2 migration plus
Permit2, multi-day and breaking for every existing integration. It has therefore sat
open while we overcharge.

Overcharging is not a survivable position. It is the specific failure the receipt
thesis is supposed to make impossible: we cannot sell "prove every dollar" while
billing for output the caller never received. And the rail is now commoditised — a
buyer who price-checks has somewhere else to go.

## Decision

**Serve the call, measure it, and collect on the caller's next request.**

- First request from a payer: served with no payment. Its measured cost is recorded as
  a pending charge.
- Every later request: if a charge is pending, reply 402 for **that exact measured
  amount**. On payment, settle it and serve the new request, recording its cost as the
  new pending charge.
- `exact` stays the scheme, which is now correct rather than a compromise — the figure
  in the challenge is a measurement, not an estimate.

No facilitator change, no v2, no Permit2. The ordering changes; the protocol does not.

Priced by `quoteUsage` in `pricing.js` from provider-reported usage, against the same
rate card and the same floor. Reasoning tokens are not added on top of
`completion_tokens`, because providers already fold them in — doing otherwise would
double-bill most of the agent catalogue. Pricing uses the **resolved** model, not the
requested alias, for the reason documented in `x402-server.js`: an `xfuel/auto` request
that serves GLM-5.2 must not be priced as Llama.

### Bounding the bad debt

The last call before a payer goes away is never collected. That is inherent, and it is
bounded at one call per payer — which is the free allowance ADR 0006 already commits
to, so in the normal case it costs nothing we were not already spending.

It is only bounded if a single unpaid call cannot be large. A fresh key whose first
request is a 200k-token job would otherwise be a free 200k-token job. So a first call
whose **ceiling** quote exceeds `X402_ROLLING_MAX_UNSETTLED_USD` (default $1) is sent
down the ordinary prepay path instead. Rolling settlement for normal traffic, prepay
for whales.

A failed settlement retains the debt rather than forgiving it, so the next request is
challenged again. A payment arriving with nothing outstanding is accepted rather than
rejected, because a restart may have forgiven the charge the client is mid-way through
paying.

## Consequences

Good:

- Buyers are billed what they used. The 15x overcharge is gone without a breaking
  migration.
- The first call needs no wallet, no payment, and no prior setup — the lowest-friction
  onboarding we can offer, and it composes with the free tier rather than competing
  with it.
- `upto` becomes a nice-to-have rather than a blocker.

Bad, and accepted:

- **Charges are one call late.** A buyer's invoice never reflects their most recent
  call. This must be stated plainly in the docs; discovering it feels like a bug.
- **The ledger is in memory**, matching `free-tier.js` and the single-process design.
  A restart forgives every pending charge. Acceptable for a subsidy guard, **not
  acceptable for billing at volume** — a durable ledger is the prerequisite for
  turning this on for real revenue, and is deliberately out of scope here.
- Debts are keyed on the API-key hash, not the paying wallet, because the first call
  has no payment header and therefore no wallet to key on. Rotating keys resets the
  one free call — the same exposure the free tier already accepts.
- One more piece of state in the payment path, which is why it ships behind a flag
  that defaults to off.

## Alternatives rejected

**Wait for `upto`.** Correct, and unavailable for weeks. Overcharging in the meantime
costs more than the migration.

**Quote a lower ceiling.** Caps useful output instead of fixing the price. Users hit
truncation rather than a fair bill.

**Post-hoc refunds.** Two on-chain movements per call instead of one, refund logic to
get wrong, and the buyer is out of pocket in between.

**Pre-authorise a budget and draw down.** Better UX than either, and it is essentially
Permit2 — the migration this ADR exists to avoid. Worth revisiting once the durable
ledger exists.

## Open questions for the founder

1. Turn it on for `/task-request`, `/v1`, or both? `/v1` is unmetered by default, so
   the natural first home is `/task-request` where money already flows.
2. Is the one-call-per-payer bad debt acceptable at the current `MAX_UNSETTLED` of $1,
   or should the first call be capped tighter?
3. Durable ledger before or after enabling in production? Recommended: before, for
   anything that counts as revenue.
