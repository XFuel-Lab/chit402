# x402 schemes: `exact` today, `upto` and `batch-settlement` are available now

Assessed 2026-08-12 · probes `scripts/dev/_x402_supported.mjs`, `scripts/dev/_upto_overcharge.mjs`

## What changed

The working assumption was that `upto` (metered settlement) was theoretical, and that
batch-settlement was a request we would have to make of Coinbase. Both are wrong. Asking CDP
directly, with our own credentials:

```
node scripts/dev/_x402_supported.mjs
```

```
v1  exact              base
v2  exact              eip155:8453
v2  upto               eip155:8453  facilitatorAddress 0xB87E1A2cc2B4643F2892768e80e41167F17C5860
v2  batch-settlement   eip155:8453  receiverAuthorizer 0x3721824a31197dcDD2984cF43b92B6cc8A87c0Fb
extensions: bazaar, builder-code, eip2612GasSponsoring
```

**All three schemes settle on Base mainnet through our existing facilitator.** Nothing needs to be
requested, negotiated, or waited for. What blocks us is on our side, not theirs.

Public secondary sources still describe `upto` as "theoretical" — it is worth noting that the
question was settled in about a minute by asking the facilitator instead of reading about it.

## Why `upto` is worth the work: we overcharge by up to 3.8x today

The `exact` scheme fixes the price before the work runs, so output has to be quoted at the
`max_tokens` ceiling. Buyers pay for tokens that were never generated. Measured with our own rate
card (`scripts/dev/_upto_overcharge.mjs`), on shapes taken from the agent-loop eval:

| shape | quoted today | `upto` would settle | overcharge |
|---|---|---|---|
| 500 in, 40 out, `max_tokens=4096` | $0.0384 | $0.0100 | **+284%** |
| 2,000 in, 300 out, `max_tokens=1024` (GLM agent turn) | $0.0152 | $0.0100 | +52% |
| 68,000 in, 247 out, `max_tokens=2048` | $0.0222 | $0.0206 | +8% |
| 3,700 in, 800 out, `max_tokens=1024` | $0.0100 | $0.0100 | 0% (floor) |

The overcharge is worst exactly where agents live: a modest prompt with a generous cap, which is the
default in most SDKs. It shrinks to nothing on large-context calls, where input dominates, and
disappears under the floor on cheap models.

This is not only a fairness problem — it is a competitive one. A buyer comparing us against a per-token
API sees the quote, not the metered cost, and our quote can be nearly 4x the work performed.

## What it actually costs us to adopt

`upto` is **not** a string change from `"exact"` to `"upto"`. Three separate migrations are stacked
inside it:

1. **x402 v1 → v2.** `upto` and `batch-settlement` are advertised only at `x402Version: 2`. That
   changes the header (`PAYMENT-SIGNATURE`), the requirements shape (`amount`, not
   `maxAmountRequired`), and network identifiers (`eip155:8453`, not `base`). Our adapter, the
   discovery manifest, and the SDK payer all speak v1 today.

2. **EIP-3009 → Permit2.** The spec is explicit: *"EIP-3009 is not supported for the `upto` scheme
   because it requires exact amounts at signature time."* Settlement happens through
   `x402UptoPermit2Proxy` via `permitWitnessTransferFrom`. Our `createEip3009Payer` signs the wrong
   thing for this scheme, so every paying client has to upgrade — this is a breaking SDK change, not
   an additive one.

3. **A one-time Permit2 approval per buyer wallet.** Permit2 must be approved before the first
   payment. CDP advertises `eip2612GasSponsoring`, and USDC supports EIP-2612, so the approval can
   be sponsored via `settleWithPermit` rather than requiring the buyer to hold ETH for gas. CDP does
   **not** advertise `erc20ApprovalGasSponsoring` (the reference testnet facilitator does), so the
   EIP-2612 route is the one to build against.

There is also a trust inversion worth stating plainly. Under `exact`, the buyer signs the precise
amount. Under `upto`, the buyer signs a ceiling and **we** choose what to settle. The spec's own
security note says it: *"malicious servers could charge up to `amount` regardless of actual usage."*
Metered settlement makes our receipt the buyer's only evidence that the charge matched the work —
which is an argument for adopting it, since the signed receipt already attests the token counts and
the model. `upto` turns the receipt from a nice-to-have into the thing that makes the rail safe.

## `batch-settlement` answers the facilitator-fee problem

The facilitator takes roughly 10% of gross at our price points, because it charges per settlement
and our settlements are ~$0.01–0.02. `batch-settlement` uses escrow plus off-chain vouchers so many
small charges are redeemed on-chain in batches instead of one settlement per HTTP request. It is
live on Base mainnet (`receiverAuthorizer 0x3721824a31197dcDD2984cF43b92B6cc8A87c0Fb`).

It shares migration step 1 with `upto` (both are v2-only), so the v2 migration is the common
prerequisite and should be sequenced first.

## Recommendation

Do the v2 migration as its own change, behind a flag, keeping `exact` semantics — no pricing or
signing change, so it can be verified against mainnet without touching what buyers pay. Then adopt
`upto`, which is where the buyer-visible win is. Then `batch-settlement`, which is where the margin
win is.

Not started here deliberately: this touches payment correctness and ships a breaking SDK change, and
splitting it across an unattended session is how you get a half-migrated payment path. The
assessment is the deliverable; the sequencing decision is a founder call
([FOUNDER_ACTIONS.md](./FOUNDER_ACTIONS.md)).

## Reproducing

```
node scripts/dev/_x402_supported.mjs      # what CDP will settle, with our keys
node scripts/dev/_upto_overcharge.mjs     # what the ceiling quote costs buyers
curl.exe -s https://x402.org/facilitator/supported   # reference facilitator, testnet only
```
