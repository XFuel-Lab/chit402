# Book sequence

Each row in a book gets `seq`, an append position assigned by the gateway when the row is indexed. Numbers start at 1 for that book and go up by one. `prev_hash` is the previous row's `row_hash`. `row_hash` is SHA-256 of:

```text
agent_id|seq|task_id|prev_hash|event
```

The hash binds the position. It does not bind the amount or the payment ref. A correction that changes an inflow allocation is a new row; the original row keeps the hash it had when it was appended.

The signed object is `chit402.book_seq.v1`, field `book_chain` on the row and on the receipt. Current rows use `payload_version` 4. That version signs `payment_ref` next to `book_id`, so a lane with no payment JWS still ties the tx to the seat. `payment_ref` is null when the row has no tx. Versions 2 (act) and 3 (authority) still verify; they do not carry `payment_ref`. Authority on a new correction row stays inside version 4. The payment JWS is not rewritten. An existing v8 receipt still verifies. New payment receipts are payload version 10.

## Replays and corrections

An idempotent replay (`replay_of`) writes an audit note on the original row. It does not take a new `seq`.

`POST /v1/agents/:agent_id/book/inflow/correct` still updates the original inflow row in place for the live balance, and it also appends a new row `{task_id}:correction:{n}` with the next `seq`.

## Gaps

`GET /v1/agents/:agent_id/book/gaps` (possession-gated) returns `chit402.book_seq_report.v1`:

| Field | Meaning |
|-------|---------|
| `gapless` | true when the seqs are exactly 1..N |
| `gaps` | missing positive integers |
| `next_seq` | the seq the next append will take |
| `count` | rows that have a seq |

The book view includes the same `sequence` object. The principal dashboard shows whether the book is gapless.

## What this proves

This row was appended at this position, and the issuer links it to the previous row's hash. On payload version 4 the same signature names `book_id` and `payment_ref`. A holder can walk the chain and ask the gaps endpoint whether a number is missing.

## What this does not prove

Payload version 4 binds `payment_ref` to `book_id`. It does not prove the transfer succeeded or the amount. It does not prove that a row was never deleted from a copy you made yourself. A replay is not a second append. Rows that were stored before seq existed receive a seq when the process loads them; that assignment follows file order and is not a new on-disk history for those old lines until the process writes a later row.

A gapless seq is not a single tip. Two correction rows can both name the same predecessor while the numbers stay 1..N and each `prev_hash` points at the previous append. That book is `forked`. See [supersession-fork.md](./supersession-fork.md).
