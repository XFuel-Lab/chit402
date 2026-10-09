# Outside witness

Receipts are leaves in an append-only Merkle tree. The hash is RFC 6962-style: a leaf is SHA-256 of `0x00` plus the leaf bytes, and an internal node is SHA-256 of `0x01` plus the left child plus the right child. A trailing odd node is promoted, not hashed with itself.

Leaf 0 is genesis (`chit402.tree_genesis.v1`). It names `verifier_binary_build_digest` from [verifier-digest.md](./verifier-digest.md) when that file has been published. Later leaves are `task_id|row_hash`. The digest is a hash of the verifier sources, not a bit-reproducible compiler binary.

## What a holder gets

| Endpoint | Returns |
|----------|---------|
| `GET /v1/receipts/tree/head` | Latest signed tree head (`chit402.tree_head.v2`), or `not_yet_published`. `?tree_size=N` returns that signed head only. `N` is a canonical positive integer. A duplicate or non-canonical value is `400 {error:"bad_tree_size"}`. The sized response is `Cache-Control: private, no-store`. |
| `GET /v1/receipts/tree/epoch/:epoch/head` | Signed head of a closed epoch. Epoch 1 is the pinned final root, with its Base and Solana transactions. A public read does not broadcast. |
| `GET /v1/receipts/:task_id/inclusion` | Proof against the newest effectively anchored head: `leaf_index`, `tree_size`, `root`, `proof`, and `head` (`tree_size`, `root`, `signature`, anchor tx and chain when known). A broadcast head is treated as anchored only when the journal intent, the tracker receipt, the signed Base tx, and the block time all agree. `anchor_confirmed_by` says `signed_head` or `anchor_state`. The signed `anchors` object is not rewritten. `?tree_size=N` selects that signed head. `N` is a canonical positive integer with no leading zeros. A leaf past the anchored size is `status: pending_anchor` with `anchored_tree_size` and `live_tree_size`, and no proof. `head_url` is `/v1/receipts/tree/epoch/<E>/head` for a closed epoch and `/v1/receipts/tree/head?tree_size=<N>` for the open epoch. The public page uses that same `N` on both the inclusion link and the head link. Inclusion and head are the same size. |
| `GET /v1/receipts/tree/consistency?first=&second=` | Proof that the tree of size `first` is a prefix of size `second` |

The gateway signs a new head on the first append of each UTC day. A public read does not publish or anchor, and it does not re-sign a stored head. Inclusion uses the newest effectively anchored head, so a leaf appended after that head is `pending_anchor` until the next anchor. A closed epoch and the open epoch can both have a head of the same size. The closed receipt pairs with `/v1/receipts/tree/epoch/<E>/head`, never with the open epoch's `?tree_size=` head. A closed epoch uses its pinned final head. A journal head newer than that pin, or a head that names a different root at the same size, is rejected. The verify page names a Base transaction, a Solana transaction, both, or `PENDING` for a leaf that is not in the anchored head yet. `PENDING` is only shown when the receipt verifies. A failed receipt is `FAILED`. Storage, epochs, and restore are in [receipt-log.md](./receipt-log.md).

## Dual anchor

The same daily root is published on Base and on Solana. `GET /v1/receipts/tree/head` records both under `anchors`:

| Side | What is posted | Recorded on the head |
|------|----------------|----------------------|
| `anchors.base` | Zero-value transaction whose calldata is the 32-byte root | `tx`, `calldata`, `from`, `chain_id` |
| `anchors.solana` | SPL Memo (`MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr`) | `signature`, `slot`, `cluster`, `memo` |

New memos are `chit402:root:v2:<scope>:<yyyy-mm-dd>:<root_hex>:<prev_root_hex>:<epoch>:<prev_epoch_root>:<prev_epoch_size>:<bundle_index_hash>`. The live tree uses scope `global`. `prev_root_hex` is the previous stored head. It is 64 zero bytes only when that head is the genesis of the epoch. A v1 memo (`chit402:root:v1:...`) still parses. The daily anchor guard is stored on disk.

Each side stays `pending` until its own key and RPC are set. A failed send stays `pending` and is retried on a later append, with a one-minute gap so a dead RPC is not hit on every receipt. A day that already has a Solana signature is not sent again. The inclusion proof is still signed either way.

### Base

Calldata is the root. The sender is `RECEIPT_ANCHOR_FROM`, or the key's own address when that is unset. The key is `RECEIPT_ANCHOR_PRIVATE_KEY`. The RPC is `BASE_RPC_URL` or `SETTLEMENT_RPC_URL`.

### Solana

The signer is `SOLANA_ANCHOR_SECRET_KEY` (base58 or a JSON byte array, the `solana-keygen` file shape). The RPC is `SOLANA_RPC_URL`. `SOLANA_ANCHOR_CLUSTER` defaults to `mainnet-beta`; `devnet` is for tests and `scripts/solana-anchor-smoke`. The gateway reads those from the process environment only. It does not load an env file and it does not log the secret.

A memo transaction pays the protocol base fee of 5,000 lamports (0.000005 SOL) for one signature. No account is created, so there is no rent, and this sender does not set a priority fee. At about $120 per SOL that is well under a tenth of a cent.

## Clock tolerance

Suggested by @ellie-v2 on 1F916. The signed head carries `clock_tolerance_s` (`base: 300`, `solana: 150`). The head's `payload_version` stays 1. A head signed before that claim still verifies; a verifier then uses these same constants.

A payment receipt at payload version 9 also signs that pair inside its own issuer JWS. `tree_head_hash` is the Merkle root of the log prefix that ends at this receipt's leaf, so an inclusion proof of size `leaf_index + 1` verifies against it. It is null when the receipt is not a leaf yet. It is not the daily head published before the append. `tolerance` is `{ base: 300, solana: 150 }`. Verifiers read the pair from the verified claims. An unsigned outer copy that disagrees fails the check. A later published head with a different root is not a signature failure, and `verify-receipt.mjs --head` still checks that head. An inclusion proof supplied for a different head must be this receipt's `task_id|row_hash` leaf. Payload version 8 receipts omit the pair and keep the previous path.

`base` is 300 seconds: a Base block is about 2 seconds, and the zero-value transaction can wait in the mempool. `solana` is 150 seconds: a blockhash expires after 151 slots (about 60 seconds at the 400ms target), and `getBlockTime` is a stake-weighted median that can lag wall clock by more than one of those windows. 150 seconds covers that lag. It does not accept a block from a different recent-blockhash epoch. The daily head is much further apart than either bound.

If that side's transaction is already confirmed and `|published_at - block_ts|` is outside the bound for that chain, the side stays `pending` with reason `anchor_clock_drift` and the head does not claim it is anchored. The next head samples that side again. No new environment variable. The Base and Solana keys already in the environment are unchanged.

The offline verifier checks the same bound when you pass `--rpc` (and `--solana-rpc` for a Solana anchor). It fetches the anchor transaction's block time. It also refuses a receipt whose own timestamp is later than `published_at` plus the tolerance, so a later receipt cannot be treated as covered by an older anchor. Without `--rpc` the check is reported as skipped, not passed.

```bash
node services/gateway/scripts/verify-receipt.mjs receipt.json "$SECRET" --head head.json --rpc "$BASE_RPC_URL"
```

## What this proves

The leaf for this receipt is in the issuer's tree of the stated size, under the stated root. A consistency proof shows an earlier root is a prefix of a later one. A signed head shows the issuer published that root. A Base transaction whose calldata is the root, and a Solana memo that contains the root, show that root was published on those chains.

`chit402-verify receipt.json inclusion.json head.json --rpc` checks the inclusion, fetches the Solana transaction, and checks the Base calldata. It prints the same boundary.

## What this does not prove

It does not prove the payment. Pending anchor means that chain has not recorded the root yet. An anchor proves the issuer published the root at that time. It does not prove every receipt that will ever exist is in that root — only the tree of that size. It does not prove the RPC you queried is honest; it checks the transaction that RPC returned.
