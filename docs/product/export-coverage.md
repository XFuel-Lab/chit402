# Export coverage

Every book view and every book export commits to the set it covers. The commitment is `chit402.export_coverage.v1`, signed with the same issuer ES256 key as receipts (`issuer_signature.jws`, type `chit402-export-coverage+jwt`). Verify it against `/.well-known/jwks.json`.

The spend receipt JWS is unchanged. Coverage is an extra signed object on the book, on the export, and on the public verify page for a row that sits on a book. Old receipts still verify.

## Fields

| Field | Meaning |
|-------|---------|
| `book_id` | Agent book the scan read |
| `scope` | `book_id`, `from`, `to`, `filters` (`evidence`, `intent_id`), `limit` |
| `enumerated_count` | Rows in this document |
| `universe_count` | Rows in the scoped set, before the limit |
| `enumerated_hash` | SHA-256 over the ordered row commitments in the document |
| `universe_hash` | SHA-256 over the ordered row commitments in the full scoped set |
| `complete` | The document holds every row in the scoped set |
| `truncated` | The document is a window of a larger set |
| `empty_reason` | `empty_by_policy`, `empty_by_drain`, or null |
| `omitted_by_policy_count` | Rows on the agent the book refuses to show (demo, unmetered, uncollected spend) |
| `filtered_out_count` | Visible rows outside `from` / `to` / `evidence` / `intent_id` |

Order is `collected_at` then `task_id`, oldest first. A row commitment is SHA-256 of:

```text
task_id|evidence|amount|payment_ref|collected_at
```

The empty set hashes to SHA-256 of the empty string. That value is `universe_hash` when a finished scan found nothing.

## Empty by policy and empty by drain

Both can show `enumerated_count: 0`. They are not the same statement.

- **empty_by_policy** — the scan finished. `universe_hash` is the empty-set hash (or the hash of a scoped set that the limit then dropped to an empty window only when the universe itself is empty). `complete` is true. `omitted_by_policy_count` and `filtered_out_count` say whether the book hid rows or the query excluded them. A book that truly has no visible rows is still this case: the issuer looked, and the set is empty.
- **empty_by_drain** — the scan did not finish (missing ledger, or a published file that claims more rows than it contains). `universe_hash` is null. `universe_count` is null. `complete` is false. Do not treat that document as an empty book.

A truncated export is a third case: `enumerated_count` is smaller than `universe_count`, `complete` is false, and the two hashes differ. The signature still commits to the full set. The file in your hand does not contain it.

## Where it shows up

- `GET|POST /v1/agents/:agent_id/book` — `coverage` on the JSON body
- `GET|POST /v1/agents/:agent_id/book/export` — JSON `coverage`, CSV comment preamble (`# universe_hash=`, `# coverage_jws=`), HTML section
- `GET /receipt/:taskId` — "Export coverage" on the verify page and in `?format=json`, for the book that holds the row. `subject_in_universe` says whether this receipt is in the set. This signature is live at page render. It is not inside the spend JWS.
- Public pull export — `coverage` on the envelope and inside the pull-export JWS
- Principal dashboard (`/book`) — enumerated count, universe count, hash, and the complete / truncated / empty label

Query or body fields `from`, `to`, `evidence`, and `intent_id` narrow the scope. They are inside the signed `scope`.

## What this proves

The issuer scanned this book id, time range, and filters, and signed the ordered row set named by `universe_hash`. A holder who has every row can recompute that hash. A holder who has a shorter file can see that their `enumerated_hash` does not match, so the file is not the set.

## What this does not prove

It does not prove a row was paid. Payment is still `payment.ref` plus the receipt JWS. It does not prove that a row outside this book never happened. It does not cover a row appended after the signature. Re-export to cover a later set.
