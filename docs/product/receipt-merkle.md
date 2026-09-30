# Outside witness

Receipts are leaves in an append-only Merkle tree. The hash is RFC 6962-style: a leaf is SHA-256 of `0x00` plus the leaf bytes, and an internal node is SHA-256 of `0x01` plus the left child plus the right child. A trailing odd node is promoted, not hashed with itself.

Leaf 0 is genesis (`chit402.tree_genesis.v1`). It names `verifier_binary_build_digest` from [verifier-digest.md](./verifier-digest.md) when that file has been published. Later leaves are `task_id|row_hash`. The digest is a hash of the verifier sources, not a bit-reproducible compiler binary.

## What a holder gets

| Endpoint | Returns |
|----------|---------|
| `GET /v1/receipts/tree/head` | Latest signed tree head (`chit402.tree_head.v1`) |
| `GET /v1/receipts/:task_id/inclusion` | `leaf_index`, `tree_size`, `root`, `proof` |
| `GET /v1/receipts/tree/consistency?first=&second=` | Proof that the tree of size `first` is a prefix of size `second` |

The gateway signs a new head on the first append of each UTC day. The verify page says `included in root X, anchored in Base tx Y` once a transaction hash is recorded, and `included in root X, pending anchor` before that.

## Base anchor

The root is the calldata of a zero-value transaction from `RECEIPT_ANCHOR_FROM` (or from the key's own address when `RECEIPT_ANCHOR_FROM` is unset). The sender key is `RECEIPT_ANCHOR_PRIVATE_KEY`. Both are environment variables. No key is committed. Without the key the head stays `anchor_status: pending`. With the key and `BASE_RPC_URL` (or `SETTLEMENT_RPC_URL`), publishing a head sends that transaction. If the send fails, the head stays pending and records the error. The inclusion proof is still signed either way.

## What this proves

The leaf for this receipt is in the issuer's tree of the stated size, under the stated root. A consistency proof shows an earlier root is a prefix of a later one. A signed head shows the issuer published that root.

## What this does not prove

It does not prove the payment. Pending anchor means the root is not in a Base transaction yet. An anchor transaction proves the issuer published the root on Base at that time. It does not prove every receipt that will ever exist is in that root — only the tree of that size.
