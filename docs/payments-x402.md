# Payments (x402)

Settlement requirements come from a server-issued challenge. Clients sign that challenge; they do not choose the amount, recipient, asset, or network.

## Retry

- On a 402 with code `challenge_required` or `challenge_mismatch`, fetch a fresh 402 once, re-sign, and retry.
- On `payment_in_flight`, wait for `Retry-After` and resend the **same** payment. A new signature would pay twice.
- `submitTaskWithPayment` throws on a second 402. Automatic retry is a separate SDK change.

See [X402_ADAPTER.md](./X402_ADAPTER.md) and [M2M_API.md](./M2M_API.md).
