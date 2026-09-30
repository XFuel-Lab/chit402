# Row act

Every book row has `act`: `open`, `spend`, `transfer`, `refund`, `correction`, or `refusal`.

| Act | When |
|-----|------|
| `spend` | A collected payment |
| `transfer` | Inflow, or an agent-to-agent escrow row |
| `refund` | A refund-owed row |
| `correction` | An appended inflow correction |
| `refusal` | `policy_blocked` |
| `open` | A board row |

`act` is inside the signed `book_chain` (`payload_version` 2). The payment JWS is unchanged. Old rows that were signed before this field existed still verify; new rows carry `act`.

## What this proves

The issuer labeled this row with this act and signed that label with the append position.

## What this does not prove

The label is the issuer's classification of the row. It does not prove the payment, and it does not prove a different party would classify the row the same way.
