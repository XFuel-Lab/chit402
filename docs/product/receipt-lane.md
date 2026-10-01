# Receipt lane

A stranger deciding whether to freeze a book row needs three facts beside `book_seq` / `book_chain.seq`. Design by Turbo on 1F916, [post 6579](https://1f916.ai/post/6579) comments [88201](https://1f916.ai/post/6579#comment-88201) and [88403](https://1f916.ai/post/6579#comment-88403). On that walk, `anchor_changed_since_binding` was true on 158 of 632 rows. Refusing on that bit alone falsely refused about a third of the receipt lane, including settled rows where the bit stays true after settlement.

The object is `receipt_lane` (`chit402.receipt_lane.v1`). It is **unsigned**. It is not a claim in the payment JWS and not a claim in `chit402.book_seq`. Payment `payload_version` stays 8. Book-seq `payload_version` stays 2 (3 when `authority` is present). An older signature still verifies. `xfuel-verify` recomputes `freeze` and does not trust a stamped `freeze` bit. `freeze` does not change the signature exit code.

## Fields

| Field | Values | Meaning |
|-------|--------|---------|
| `book_seq` | positive integer or null | Same append position as `book_seq` / `book_chain.seq` |
| `settled_by` | `observed_transfer`, `receipt`, or null | How settlement is known |
| `settled` | boolean or null | Whether this row is settled. Null means the inputs do not say |
| `anchor_changed_since_binding` | boolean or null | The anchored tree head changed after this leaf was bound. Null means unknown, not false |
| `anchor_at_binding` | identity or null | First signed head whose `tree_size` includes this leaf |
| `anchor_current` | identity or null | Latest signed head |
| `freeze` | boolean | The refusal decision |
| `reason` | `unsettled_anchor_changed` or null | Why `freeze` is true |

`settled_by`:

| Value | When |
|-------|------|
| `observed_transfer` | A Base or Solana USDC check succeeded (`payer.checked` and `payer.valid`), or the row has arrival evidence (`arrival_status: confirmed` or `ingress_receipt.ref`), or the row is `foreign_ingest` with a payment ref (that path fail-closes on an observed transfer). |
| `receipt` | A payment ref is present and settlement is asserted by the issuer or the book row (`collected`, `RECORDED_BY_SETTLE`, `refund_owed`, `board_stamp`, `board_close`, or `settlement_status` `settled` / `idempotent_replay`) and none of the observations above fired. Offline verify uses this only after the issuer signature verifies. An unsigned `payment.ref` is not an assertion. |
| null | Nothing above applies. OpenRouter Broadcast (`rail: reported`) is null: Chit did not settle it. A `policy_blocked` row with no payment ref is null. Do not treat null as either enum value. |

`anchor_changed_since_binding` compares root, Base anchor tx, and Solana signature. The binding head is the earliest retained head with `tree_size` greater than the leaf index. A later head with a different root or anchor tx sets the bit. No covering head yet is null. Replacing one day's head in place does not keep the previous anchor identity, so that rewrite alone is not visible.

## Freeze rule

Freeze when all of these are true:

1. `book_seq` is present
2. `settled_by` is `receipt` (the receipt lane; `observed_transfer` is a different leg)
3. `anchor_changed_since_binding` is true
4. `settled` is false

`anchor_changed_since_binding` alone does not freeze. A settled row whose anchor changed does not freeze. An unknown `settled_by` does not freeze.

`idempotent_replay` counts as settled: the canonical payment already settled.

## Where it appears

Beside `book_seq` on `GET /receipt/:id?format=json`, on the chat receipt when a book row was written, on each book row, in the JSON audit export, and as CSV columns `settled_by`, `settled`, `anchor_changed_since_binding`, `freeze`. The verify page prints it under the book position. `xfuel-verify` prints a receipt-lane section and includes `receipt_lane` in `--json`.

## What this proves

A reader can apply Turbo's rule without guessing. `freeze: true` means: this seq is in the receipt lane, the anchored head moved after binding, and the row is not settled.

## What this does not prove

It does not prove the payment. It does not prove the anchor. Those stay on the payment JWS, the payer check, and the signed tree head. The lane object is derived display. A stranger who wants a current head they fetched themselves passes it to `verifyReceipt({ head })` or relies on `anchor_at_binding` plus `anchor_current` carried on the receipt. The CLI recomputes the boolean from those identities.
