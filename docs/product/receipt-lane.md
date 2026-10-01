# Receipt lane

A stranger deciding whether to freeze a book row needs three facts beside `book_seq` / `book_chain.seq`. Design by Turbo on 1F916, [post 6579](https://1f916.ai/post/6579) comments [88201](https://1f916.ai/post/6579#comment-88201) and [88403](https://1f916.ai/post/6579#comment-88403). On that walk, `anchor_changed_since_binding` was true on 158 of 632 rows. Refusing on that bit alone falsely refused about a third of the receipt lane, including settled rows where the bit stays true after settlement.

Comment [88596](https://1f916.ai/post/6579#comment-88596) freezes the ordering as `seq + settled_by + (anchor_changed AND not settled)` and states its boundary: complete over registry marks, blind to payments the registry never joined. A binding past expiry with no registry marks is `unverifiable_from_registry`, not unpaid. Binding 209 is that shape. Binding 468 is past expiry and `settled_by: observed_transfer`, so it stays settled.

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
| `ordering` | `seq + settled_by + (anchor_changed AND not settled)` | The frozen partition order. `settled_by` in that expression is the receipt-lane conjunct (value `receipt`) |
| `boundary` | `complete over registry marks, blind to payments the registry never joined` | The ordering does not see a payment the registry never joined |
| `classification` | `receipt`, `observed_transfer`, `anchor_changed_unsettled`, `unsettled`, or `unverifiable_from_registry` | Which partition the row is in |
| `local_check` | object or null | Payee and amount a stranger can check on Base. Present only for `unverifiable_from_registry` on Base USDC. `claims_paid` is false |

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

## Boundary

`ordering` is `seq + settled_by + (anchor_changed AND not settled)`. `boundary` is `complete over registry marks, blind to payments the registry never joined`.

The marks are `settled_by`, `receipt_id`, `observed_tx_hash`, and `observed_transfer_id`. A Base transfer that never joined the registry is outside the ordering. The lane does not walk the chain to fill that gap.

## Classification

| `classification` | When |
|------------------|------|
| `receipt` | `settled_by` is `receipt`, including a row that also freezes |
| `observed_transfer` | `settled_by` is `observed_transfer`. Expiry does not remove the mark |
| `unverifiable_from_registry` | Past expiry, and all four marks are null. Not unpaid, lapsed, or noise. `settled` stays null. `freeze` stays false |
| `anchor_changed_unsettled` | No joined `settled_by`, not the unverifiable case, `anchor_changed_since_binding` is true, and `settled` is not true |
| `unsettled` | None of the above |

A joined mark wins over expiry. Binding 468 (`settled_by: observed_transfer`, `receipt_id` null, `observed_tx_hash` set, expiry already past) is `observed_transfer` and `settled: true`. Binding 209 (expiry past, all four marks null) is `unverifiable_from_registry`.

## local_check

`local_check` is set only when `classification` is `unverifiable_from_registry` and the row is Base mainnet USDC, the same contract the gateway already checks on a known transaction (`method: base_usdc_transfer`). The object is `chain_id`, `token`, `payee`, `amount_atomic`, and `claims_paid: false`. It names what a stranger can check. It is not a payment, and this path does not call an RPC or walk Basescan. Any other chain or token leaves `local_check` null.

## Where it appears

Beside `book_seq` on `GET /receipt/:id?format=json`, on the chat receipt when a book row was written, on each book row, in the JSON audit export, and as CSV columns `settled_by`, `settled`, `anchor_changed_since_binding`, `freeze`, `classification`. The verify page prints it under the book position. `xfuel-verify` prints a receipt-lane section and includes `receipt_lane` in `--json`. `GET /llms.txt` states the ordering, the boundary, and `unverifiable_from_registry`.

## What this proves

A reader can apply Turbo's rule without guessing. `freeze: true` means: this seq is in the receipt lane, the anchored head moved after binding, and the row is not settled. `classification: unverifiable_from_registry` means the registry has no mark and the binding is past expiry. It does not mean the row was unpaid.

## What this does not prove

It does not prove the payment. It does not prove the anchor. Those stay on the payment JWS, the payer check, and the signed tree head. The lane object is derived display. `local_check` does not prove a transfer. A stranger who wants a current head they fetched themselves passes it to `verifyReceipt({ head })` or relies on `anchor_at_binding` plus `anchor_current` carried on the receipt. The CLI recomputes the boolean from those identities. The ordering is blind to a payment the registry never joined.
