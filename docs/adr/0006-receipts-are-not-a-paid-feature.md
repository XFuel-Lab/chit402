# ADR 0006 — Receipts Are Not a Paid Feature

Status: Proposed (founder decision, tracker item 17). Date: 2026-08-13.
Related: [ADR 0001](./0001-usdc-revenue-and-router-verifier-positioning.md), [ADR 0002](./0002-base-settlement-home.md), [PRICING_STRATEGY.md](../PRICING_STRATEGY.md), [SPEND_INTELLIGENCE_THESIS.md](../SPEND_INTELLIGENCE_THESIS.md), [BEACHHEAD_ICP.md](../BEACHHEAD_ICP.md).

## Context

The tracker asks whether the receipt product should require x402 payment at all. The
question was framed as a build decision. It is not — **the decoupling already ships.**

`/v1/chat/completions` is unmetered by default (`X402_METER_V1` is off) and every call
already returns a signed receipt, with `payment.rail: "unmetered"` and a note saying the
call was not charged. Verified on the live host 2026-08-13: `HMAC-SHA256 payload v2`,
byte-identical to `/receipt/:task_id`.

So the real question is narrower and entirely commercial: **is a free signed receipt the
entry product, or a loss-leader we tolerate until metering turns on?**

The answer determines market size. A receipt gated behind x402 addresses teams that hold
USDC on Base *and* want an audit trail. A receipt available for anything we route
addresses every team that wants an audit trail, with crypto as an upgrade. The first is a
crypto-native niche; the second is the whole agent market with a crypto-native beachhead.

It also determines what we can learn from design partners. If the first conversation
requires a Base wallet, we cannot tell whether a partner declined because the receipt was
worthless to them or because the payment rail was friction. Those need separating, and
free `/v1` separates them.

## Decisions

1. **A signed Tier-1 receipt is produced for anything XFuel routes, paid or not.** It is
   never a paid feature, never a tier, never gated on rail. This is a permanent
   commitment, not an introductory offer.
2. **Payment is an attested field, not a precondition.** When nothing settled, the receipt
   says `payment.rail: "unmetered"` rather than omitting the block or implying value moved.
   An unmetered receipt attests *which model and provider ran and what came back* — it does
   not attest a dollar, and must not be described as if it does.
3. **Revenue comes from metered routing and from assurance above Tier-1** — spot-check,
   TEE-routed compute, SP1 settlement proof — never from the receipt itself. Charging for
   proof that you were not overcharged implies the free tier might be.
4. **x402 is the settlement rail and an upgrade path, not an entry requirement.** ADR 0002
   is unchanged: Base is the money home. This ADR says money is not the turnstile.
5. **Consequence for tracker item 15:** keep `/v1` free for now. It is the funnel that puts
   a signed receipt in front of a team before asking them to pay for anything. Revisit
   `X402_METER_V1` once partners have told us whether the receipt matters.

## Consequences

- The design-partner ask becomes "swap your base URL, keep your provider, look at the
  receipt" with no wallet prerequisite. That is a materially easier first conversation and
  a cleaner experiment.
- Positioning shifts from *budgets and routing* to **an accountability layer for autonomous
  spend**. The buyer is not the agent — agents do not want receipts. The buyer is whoever
  is answerable for the agent's spend: a treasury reporting to token holders, a founder
  reporting to investors, an operator re-billing a client.
- **Free `/v1` is subsidised compute.** We pay AkashML COGS on every unmetered call and
  collect nothing. Before this ADR the gateway neither capped nor *measured* that subsidy:
  `/v1` never called `measureCogs`, so unmetered traffic burned real provider money with no
  record anywhere and the float balance overstated by however much it had served. Both are
  now fixed — `/v1` measures and burns COGS like `/task-request` does, `provider_cogs`
  appears on the `/v1` receipt, `GET /health` reports the day's give-away, and
  `FREE_TIER_DAILY_COGS_USD` (default $1/caller/day as of 2026-08-17; was $10) walls off a caller with a 402
  `free_tier_exhausted` once they cross it. Two limits worth knowing: the counter is in
  memory, so a restart forgives the day, and the demo key is a single bucket for the whole
  public internet — that ceiling *is* our public exposure.
- Signed receipts are cheap to issue (an HMAC) and free receipts are therefore farmable.
  Requiring an API key and rate-limiting per key is sufficient; do not add a payment gate
  to solve an abuse problem.
- The honest claim on an unmetered receipt is narrower than "prove every dollar." Marketing
  must not use the settled-payment language for receipts where nothing settled.

## Rejected

- **Receipt as a paid SKU.** Measured willingness to pay for verifiability is 10–20%, not a
  multiple, and no provider in the Confidential Inference directory (8 providers, 50 models)
  charges an attestation fee. Pricing the receipt would cap the wedge and contradict the
  assurance story.
- **Receipt gated on x402.** Shrinks the market to the payment rail's install base and makes
  the design-partner experiment unreadable.
- **Receipt for calls we did not route.** We attest what we observe. There is no honest
  receipt for a call that never passed through the gateway.
