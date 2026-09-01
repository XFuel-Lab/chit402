# ADR 0008 — Rolling Settlement: Charge the Previous Call

Status: **Accepted — live on `api-testnet.xfuel.app` `/task-request` since 2026-08-16.** `/v1` stays free (ADR 0006). Date: 2026-08-13.
Related: [ADR 0002](./0002-base-settlement-home.md), [ADR 0006](./0006-receipts-are-not-a-paid-feature.md), [X402_SCHEME_MIGRATION.md](../X402_SCHEME_MIGRATION.md), [KNOWN_ISSUES.md](../KNOWN_ISSUES.md).

## Context

The x402 `exact` scheme requires a price before the work runs. Output length is not
knowable then, so `pricing.js` quotes output at `max_tokens`. Agents ask for a large
ceiling and use a fraction of it, so buyers are systematically overcharged. Measured
on a ceiling-heavy call — 1,000 prompt tokens, `max_tokens: 20000`, 1,000 tokens
actually produced, priced on the GLM-5.2 row — the quote is **$0.183 against $0.012 of
real usage, a 15x overcharge**. This was a High-severity entry in `KNOWN_ISSUES.md`; the remedy is live.

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

Priced by `quoteFromCogs` in `pricing.js` from **measured provider COGS**, not the
rate card. Formula: `max($0.01, provider_cogs × 1.10) + $0.08` if they asked for a
settlement proof. Reasoning tokens are not added on top of `completion_tokens`,
because providers already fold them in. Pricing uses the **resolved** model, not the
requested alias.

The signed receipt proves the 10%: `provider_cogs.actual`, `payment.platform_fee_bps`
(1000), and `payment.protocol_fee_bps` (50, ADR 0001 split of gross) are all in the
HMAC payload. A buyer recomputes `max(floor, cogs × 1.10)` and matches `gross_amount`.
When payment lands on the next request, `payment.ref` is written onto the **owed**
task, not the new one.

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
  **You pay for the last call; `/task-quote` is a forecast of the next one.**
- **The ledger is durable** (JSON on disk, same single-process model as task-store).
  A restart must not forgive an invoice. Do not enable `X402_ROLLING_SETTLEMENT` on
  the live box until persist is on (it is, when `TASK_STORE_PERSIST` is not `false`).
- Debts are keyed on the API-key hash, not the paying wallet, because the first call
  has no payment header and therefore no wallet to key on. Rotating keys resets the
  one free call — the same exposure the free tier already accepts.
- One more piece of state in the payment path. The flag remains so a rollback is
  one line (`X402_ROLLING_SETTLEMENT=false`) plus a restart.

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

## Founder decisions (2026-08-16)

1. **`/task-request` only.** `/v1` stays free (ADR 0006).
2. **$1 whale prepay kept** (`X402_ROLLING_MAX_UNSETTLED_USD=1`).
3. **Durable ledger first** — already in (JSON on disk). Last-call lag accepted:
   you pay for the last call; `/task-quote` is a forecast.
