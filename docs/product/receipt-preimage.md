# Receipt hash preimages

A stranger can recompute the public hashes on a receipt without asking us what bytes we hashed. `GET /receipt/:id?format=json` (schema `xfuel.receipt.v4`) adds an unsigned `preimages` block. The same bytes are at `GET /receipt/:id/preimage/:field`. A refusal (`chit402.refusal.v1`) does the same at `GET /refusal/:id` and `GET /refusal/:id/preimage/:field`.

The block is not inside the payment JWS, the book-seq JWS, or the coverage JWS. Old signatures still verify.

`xfuel-verify receipt.json` hashes each published preimage and exits 1 if a preimage is missing or does not match. A saved receipt from before this block still verifies in the library. The CLI requires the block when the receipt carries a hash this page lists as recomputable. `--no-preimage` skips that requirement.

## Canonicalization

| Rule | Bytes |
|------|--------|
| UTF-8 | Pipe-joined lines and JSON strings are UTF-8. No trailing newline. A null or missing pipe field is an empty string. |
| SHA-256 | Lowercase hex. A `0x` prefix is present only when the published hash uses one. |
| keccak256 | `keccak256` of the `preimage_hex` bytes. Those bytes are `abi.encodePacked` as named in the field's `rule`. |
| Merkle | RFC 6962, same as the receipt tree. Leaf = SHA-256(`0x00` ‖ body). Node = SHA-256(`0x01` ‖ left ‖ right). A trailing odd node is promoted. `preimage_utf8` on a tree leaf is the body. The domain byte is added before hashing. |
| JCS | Issuer-history entry hashes use JCS (RFC 8785), the same canonical form as offer receipts. Receipt hashes keep the encoding they were already signed with. |

## Recomputable

| Field | Algorithm | Preimage |
|-------|-----------|----------|
| `book_chain.row_hash` | SHA-256 | UTF-8 `agent_id\|seq\|task_id\|prev_hash\|event`. `agent_id` is `book_id`. |
| `book_row.row_hash` on a refusal | SHA-256 | The same line. `event` is `policy_blocked`. |
| `inclusion.leaf` | SHA-256 | `0x00` ‖ UTF-8 `task_id\|row_hash`. `preimage_hex` is that whole input. |
| `tree_head_hash` | SHA-256, RFC 6962 | Ordered leaf bodies of the log prefix that ends at this receipt, when every leaf's bytes are still retained. |
| `binding.expected_commitment` | keccak256 | `abi.encodePacked(paymentRefHash, taskIdHash, rail, amount)`, or the inference form that also packs `modelCommitment` and `outputHash`, when that commitment is non-null. |
| `coverage.universe_hash` | SHA-256 | Only for a finished empty set: SHA-256 of the empty string. `enumerated_hash` is the same bytes when the window is empty. |
| `job_spec_hash` | SHA-256, `0x` prefix | `JSON.stringify({text, budget, deadline, acceptance})` with that key order. The board job publishes this. There is no separate award-object hash. |
| `response_hash` on `POST /erc8004/validate` | keccak256 | UTF-8 of the canonical HMAC payload array (`JSON.stringify`, no extra space). That is the verdict object hash. |

## Not publicly recomputable

| Field | Why |
|-------|-----|
| `output.hash` and `fulfillment.output_commitment.hash` | Commitment to the model output or the deliverable. The output is private and is not a public preimage. |
| `caller_binding.api_key_hash` | Covers the caller API key. |
| `route.model_commitment` | Merkle root over weight shards. The shards are not published. |
| `coverage.universe_hash` and `coverage.enumerated_hash` when the set is non-empty | They commit to possession-gated book rows (`task_id\|evidence\|amount\|payment_ref\|collected_at`, then SHA-256 of the ordered lines). A book holder recomputes them from the export. The rows are not published on the receipt. |
| `hmac_attestation.value` | HMAC-SHA256 over the canonical payload array with the gateway secret. The tag is not a bare SHA-256. The secret is not public. On a receipt that is not vendor-blind, `preimage_utf8` under `not_recomputable` shows the array so the covered bytes are visible. A vendor-blind receipt does not publish those bytes, because they can name the provider. |
| `delegation_hash` | EIP-712 digest of the session authorization. The typed-data bytes are not on the public receipt. |
| `tree_head_hash` when a prefix leaf's body was not retained | The root cannot be rebuilt from this receipt. The inclusion proof still checks one leaf against a later root. |

Private-desk vendor identity, prompt text, and output text are not copied into a public preimage.
