# ADR 0011 — Receipt v8: signed amount is the on-chain transfer

Status: **Accepted**. Date: 2026-09-27.
Related: [ADR 0001](./0001-usdc-revenue-and-router-verifier-positioning.md), [POSITIONING.md](../POSITIONING.md), [VERIFY_ALGORITHM.md](../VERIFY_ALGORITHM.md).

## Context

A settled x402 receipt is one USDC `Transfer` to the payee. Live receipt
`chit-5d775d12-f43a-460f-8b4a-9299b4eedf20` (payload v7) signed
`gross_amount` `"2000"`, `net_amount` `"1990"`, `fee_amount` `"10"`,
`protocol_fee_bps` `50`, plus `platform_fee` `"1"` at `platform_fee_bps` `100`.

The Base transaction has exactly one USDC Transfer, 2000 atomic units, from
the payer to the payee. No fee moved on chain. `net_amount` was documented as
"amount after fees", which made the signature say the payee received 1990.
The 50 bps figure is a stale default (`task.feeBps || 50`) from the old
protocol split. Live pricing is cost-plus: a 100 bps route margin from
`platformFeeBps()` in `services/gateway/src/pricing.js`, plus the $0.002
receipt floor when that floor binds.

## Decision

**Option B.** Payload version **8** replaces the net/fee split on newly signed
receipts.

- `payment.gross_amount` is the amount charged.
- `payment.settled_amount` is set only once a USDC payment reference exists, and
  it equals `gross_amount`. That is the value of the USDC Transfer to `payee`.
- `payment.accounting` is internal accounting **inside** that amount, not a
  deduction from it:

```json
{
  "kind": "internal",
  "scope": "inside_settled_amount",
  "note": "Internal accounting inside the settled amount. Not an on-chain deduction; the payee received settled_amount in full.",
  "internal_breakdown": {
    "route_margin_bps": 100,
    "route_margin_amount": "1",
    "receipt_floor_amount": "1993",
    "provider_cogs_amount": "6",
    "tier2_proof_amount": "0"
  }
}
```

`route_margin_bps` is the quote's `fee_bps` when the quote stamped one, otherwise
`platformFeeBps()` at sign time. It is not a literal 50 or 100 in `receipt.js`.
`route_margin_amount` is the percentage of provider COGS. When the receipt floor
binds, that margin sits inside the floor and `receipt_floor_amount` is the
residual (`settled − COGS − margin − tier2`). For a cost-plus quote:

`provider_cogs_amount + route_margin_amount + receipt_floor_amount + tier2_proof_amount = settled amount`.

v8 receipts do not sign `net_amount`, `fee_amount`, `fee_bps`, or
`protocol_fee_bps`.

Payload versions **≤ 7 are not re-signed** and keep verifying with the historical
field list. Verifiers branch on `payload_version`. An optional reconciliation
check compares the signed figure to USDC Transfer logs: v8 uses `settled_amount`,
v7 uses `net_amount` (so the listing-55 receipt flags 1990 against a 2000 transfer).

## Consequences

- A buyer can match the signed settled amount to the chain without pretending a
  fee left the payee.
- The 100 bps margin and the receipt floor stay auditable, labeled as internal.
- HMAC payload version for new receipts is 8. The v8 field list is shared by the
  gateway, `packages/sdk`, `packages/verify`, and `scripts/verify-receipt.mjs`.
- Historical v7 receipts, including listing-55, remain valid signatures of what
  they actually signed. They are not rewritten to look like v8.
