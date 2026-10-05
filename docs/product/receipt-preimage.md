# Receipt hash preimages

A stranger can recompute the public hashes on a receipt without asking us what bytes we hashed. `GET /receipt/:id?format=json` (schema `xfuel.receipt.v4`) adds an unsigned `preimages` block. The whole canonical object is `GET /receipt/:id/preimage`. One field is `GET /receipt/:id/preimage/:field`. A refusal (`chit402.refusal.v1`) does the same at `GET /refusal/:id`, `GET /refusal/:id/preimage`, and `GET /refusal/:id/preimage/:field`.

## Whole canonical object

`GET /receipt/:id/preimage` and `GET /refusal/:id/preimage` return the exact UTF-8 bytes stored at issuance. Those bytes are JCS (RFC 8785): object keys sorted by UTF-16 code unit, no insignificant whitespace, no trailing newline. SHA-256 of the body is `payload_hash` inside the signed JWS. The response sets `X-Chit-Hash-Alg: sha256`, `X-Chit-Payload-Hash` to that digest, and `X-Chit-Canonicalization: jcs-rfc8785`. `?meta=1` returns the algorithm and the hash without the body.

The hash is of the public claims **without** `payload_hash`. The JWS then carries `payload_hash`. A stranger hashes the response body and compares it to that claim. The server does not rebuild the object from the receipt on read. A document issued before the bytes were stored answers `404 preimage_unavailable`.

Payment receipts that store the object are payload version 10. Version 9 and earlier still verify and do not grow a canonical object after the fact. New refusals are payload version 2. Refusal payload version 1 still verifies.

### Receipt field set

Every key below may appear. A key that is absent is omitted. Wire order is the JCS sort of whichever keys are present, not this list order.

`action`, `agent_pubkey`, `binding`, `caller_binding`, `claim_id`, `delegation_hash`, `dispute_window`, `fulfillment`, `iat`, `iss`, `issuance_commitment`, `issuer_history`, `kind`, `openrouter`, `output`, `parent_receipt_id`, `payload_version`, `payment`, `provider_cogs`, `route`, `session`, `session_act`, `session_expiry`, `settlement`, `target_agent`, `task_id`, `tolerance`, `tree_head_hash`.

`issuer_history` is `{ hash, version, seq }` of the issuer-history snapshot in effect at issuance. `output` is `{ hash }` only.

### Refusal field set

`agent_id`, `amount_charged`, `amount_requested`, `anchor`, `asset`, `attempt_index`, `book_id`, `book_row`, `cap_atomic`, `chain_id`, `charged`, `hub`, `intent_id`, `issued_at`, `issuer_history`, `kind`, `model`, `nonce`, `payload_version`, `period_start`, `policy_key`, `reason`, `refusal_code`, `refusal_id`, `schema`, `spent_atomic`, `task_id`.

### Still withheld

Prompt text, model output text, API keys, private JWKs, weight shards, and possession-gated book rows are not in the object. `output.hash` and `caller_binding.api_key_hash` may appear, because those digests are already public claims. The per-field routes below stay as a convenience for one hash. They are not a substitute for the stored object.

The block is not inside the payment JWS, the book-seq JWS, or the coverage JWS. Old signatures still verify.

`xfuel-verify receipt.json` hashes each published preimage and exits 1 if a preimage is missing or does not match. A saved receipt from before this block still verifies in the library. The CLI requires the block when the receipt carries a hash this page lists as recomputable. `--no-preimage` skips that requirement.

## Canonicalization

| Rule | Bytes |
|------|--------|
| UTF-8 | Pipe-joined lines and JSON strings are UTF-8. No trailing newline. A null or missing pipe field is an empty string. |
| SHA-256 | Lowercase hex. A `0x` prefix is present only when the published hash uses one. |
| keccak256 | `keccak256` of the `preimage_hex` bytes. Those bytes are `abi.encodePacked` as named in the field's `rule`. |
| Merkle | RFC 6962, same as the receipt tree. Leaf = SHA-256(`0x00` ‖ body). Node = SHA-256(`0x01` ‖ left ‖ right). A trailing odd node is promoted. `preimage_utf8` on a tree leaf is the body. The domain byte is added before hashing. |
| JCS | Issuer-history entry hashes, the sealed history document, and the whole receipt or refusal canonical object use JCS (RFC 8785). Per-field receipt hashes keep the encoding they were signed with. |

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
