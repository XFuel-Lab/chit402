# Outside witness

Receipts are leaves in an append-only Merkle tree. The hash is RFC 6962-style: a leaf is SHA-256 of `0x00` plus the leaf bytes, and an internal node is SHA-256 of `0x01` plus the left child plus the right child. A trailing odd node is promoted, not hashed with itself.

Leaf 0 is genesis (`chit402.tree_genesis.v1`). It names `verifier_binary_build_digest` from [verifier-digest.md](./verifier-digest.md) when that file has been published. Later leaves are `task_id|row_hash`. The digest is a hash of the verifier sources, not a bit-reproducible compiler binary.

## What a holder gets

| Endpoint | Returns |
|----------|---------|
| `GET /v1/receipts/tree/head` | Latest signed tree head (`chit402.tree_head.v1`) |
| `GET /v1/receipts/:task_id/inclusion` | `leaf_index`, `tree_size`, `root`, `proof` |
| `GET /v1/receipts/tree/consistency?first=&second=` | Proof that the tree of size `first` is a prefix of size `second` |

The gateway signs a new head on the first append of each UTC day. The verify page names a Base transaction, a Solana transaction, both, or `pending anchor`.

## Dual anchor

The same daily root is published on Base and on Solana. `GET /v1/receipts/tree/head` records both under `anchors`:

| Side | What is posted | Recorded on the head |
|------|----------------|----------------------|
| `anchors.base` | Zero-value transaction whose calldata is the 32-byte root | `tx`, `calldata`, `from`, `chain_id` |
| `anchors.solana` | SPL Memo (`MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr`) | `signature`, `slot`, `cluster`, `memo` |

The memo text is `chit402:root:v1:<book_or_global>:<yyyy-mm-dd>:<root_hex>:<prev_root_hex>`. The live tree uses scope `global`. `prev_root_hex` is the previous UTC day's root, or 64 zero bytes on the first head.

Each side stays `pending` until its own key and RPC are set. A failed send stays `pending` and is retried on a later append, with a one-minute gap so a dead RPC is not hit on every receipt. A day that already has a Solana signature is not sent again. The inclusion proof is still signed either way.

### Base

Calldata is the root. The sender is `RECEIPT_ANCHOR_FROM`, or the key's own address when that is unset. The key is `RECEIPT_ANCHOR_PRIVATE_KEY`. The RPC is `BASE_RPC_URL` or `SETTLEMENT_RPC_URL`.

### Solana

The signer is `SOLANA_ANCHOR_SECRET_KEY` (base58 or a JSON byte array, the `solana-keygen` file shape). The RPC is `SOLANA_RPC_URL`. `SOLANA_ANCHOR_CLUSTER` defaults to `mainnet-beta`; `devnet` is for tests and `scripts/solana-anchor-smoke`. The gateway reads those from the process environment only. It does not load an env file and it does not log the secret.

A memo transaction pays the protocol base fee of 5,000 lamports (0.000005 SOL) for one signature. No account is created, so there is no rent, and this sender does not set a priority fee. At about $120 per SOL that is well under a tenth of a cent.

## What this proves

The leaf for this receipt is in the issuer's tree of the stated size, under the stated root. A consistency proof shows an earlier root is a prefix of a later one. A signed head shows the issuer published that root. A Base transaction whose calldata is the root, and a Solana memo that contains the root, show that root was published on those chains.

`chit402-verify receipt.json inclusion.json head.json --rpc` checks the inclusion, fetches the Solana transaction, and checks the Base calldata. It prints the same boundary.

## What this does not prove

It does not prove the payment. Pending anchor means that chain has not recorded the root yet. An anchor proves the issuer published the root at that time. It does not prove every receipt that will ever exist is in that root — only the tree of that size. It does not prove the RPC you queried is honest; it checks the transaction that RPC returned.
