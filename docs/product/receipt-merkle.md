# Outside witness

Receipts are leaves in an append-only Merkle tree. The hash is RFC 6962-style: a leaf is SHA-256 of `0x00` plus the leaf bytes, and an internal node is SHA-256 of `0x01` plus the left child plus the right child. A trailing odd node is promoted, not hashed with itself.

Leaf 0 is genesis (`chit402.tree_genesis.v1`). It names `verifier_binary_build_digest` from [verifier-digest.md](./verifier-digest.md) when that file has been published. Later leaves are `task_id|row_hash`. The digest is a hash of the verifier sources, not a bit-reproducible compiler binary.


## Recompute an inclusion proof

This is the full recipe. It matches `services/gateway/src/receipt-merkle.js` (`verifyInclusion`) and `chit402-verify`.

Receipts issued before the public log started (Oct 2, 2026) have no leaf. Their inclusion request returns `404 {"error":"not_in_tree"}`.

### Leaf bytes

- A receipt leaf body is the UTF-8 string `task_id|row_hash`: the receipt's `task_id` exactly as the inclusion response names it (for example `xfuel-3155b7d8-4315-44bc-bfdc-bf6b78ff2d15`; a `chit-` receipt id resolves to its `xfuel-` task id), one ASCII `|` (0x7c), then `row_hash` as 64 lowercase hex characters with no `0x`. No JSON, no quotes, no whitespace, no trailing newline. A missing `row_hash` is the empty string.
- Leaf 0 of an epoch is the genesis body, the compact JSON `{"schema":"chit402.tree_genesis.v1","payload_version":1,"verifier_binary_build_digest":"<digest>"}` in that key order. The digest is 64 hex characters, or JSON `null` (unquoted) when none was published at that genesis.
- `row_hash` is owner-held (see [receipt-preimage.md](./receipt-preimage.md)). An outside party starts from the published leaf hash (`leaf` on the inclusion response, `inclusion.leaf_hash` on the public shell). The owner can check that step too.

### Hashes

- Leaf hash = SHA-256(`0x00` ‖ leaf body).
- Node hash = SHA-256(`0x01` ‖ left ‖ right), where left and right are the raw 32-byte hashes, not hex text.
- Leaves are paired left to right at each level. A trailing odd node is promoted unchanged to the next level. It is not hashed with itself. This gives the same root as the RFC 6962 split at the largest power of two.

### Sibling order and direction

`proof` is ordered from the leaf up to the root. Each entry is `{ hash, position }`. `position: "left"` means the sibling is the left input, so the step is node(sibling, current). `"right"` means node(current, sibling). A promoted level has no entry.

The side is fixed by `leaf_index` and `tree_size` (RFC 9162 §2.1.3.2), and `position` must agree with it:

```
fn = leaf_index; sn = tree_size - 1; r = leaf
for each sibling p:
  if fn is odd or fn == sn:            # sibling on the left
    r = node(p, r)
    if fn is even: while fn is even and fn != 0: fn >>= 1; sn >>= 1
  else:                                # sibling on the right
    r = node(r, p)
  fn >>= 1; sn >>= 1
accept iff sn == 0 and r == root
```

### Worked example

`xfuel-3155b7d8-4315-44bc-bfdc-bf6b78ff2d15`, from `GET /v1/receipts/xfuel-3155b7d8-4315-44bc-bfdc-bf6b78ff2d15/inclusion`:

| | Value |
|---|---|
| `leaf_index` / `tree_size` | 34 / 35 |
| `leaf` | `dbb7229f29b2fafc9bd4699dea8c8dcdac226e26ddad948d9312a0d12d99a006` |
| proof[0] (left) | `850004bd8b6e743da4aa4fcae21aee02c2e16ae313e3cb534a177da0222c4de8` |
| proof[1] (left) | `2e53dd841cdfc4ac45bce676aa72646826d8c906807a46018fc09926df5d718f` |

1. fn=34, sn=34. fn == sn, so the sibling is on the left: SHA-256(`01` ‖ `850004bd…` ‖ `dbb7229f…`) = `b5f1878abb0fc84f2f1cdf0c42076e93726f8782be3ce20cb6346fea3e3683a7`. fn is even, so shift to fn=17, sn=17, then shift again to fn=8, sn=8.
2. fn == sn, so the sibling is on the left: SHA-256(`01` ‖ `2e53dd84…` ‖ `b5f1878a…`) = `344cfd286fbc7b90a16b38cd126911c46e835a3396d3bd976f8ddd6c04ea8b35`. fn is even, so shift while it stays even and non-zero: 4, 2, 1 (sn the same). The final shift gives fn=0, sn=0.
3. sn = 0 and the result equals `root` (`344cfd28…`), which is the calldata of Base tx `0xa3d40f9937b48b56631dedb28b8337fc4f8a8ebf74c563d3c835fddd71a24a5c`.

Leaf-body check, with made-up values: the body `example-task|abab…ab` (64 hex characters) hashes to SHA-256(`00` ‖ body) = `bad0a9d071071740f8051214a7638bbe1b19ec690ca842c6ca66da42892b5177`.

### Script

[`examples/verify-inclusion.mjs`](./examples/verify-inclusion.mjs) needs Node 18 or later and no dependencies. It fetches the public shell and the inclusion proof with GET only, checks that the two leaf hashes agree, and recomputes the root. It also refuses a `leaf_index` outside `0..tree_size-1`, any hash that is not 64 lowercase hex characters, a shell with no `leaf_hash`, and proof steps left over after the root level. It prints one JSON line and exits 0 only when `ok` is true. A failure prints `{"id":…,"ok":false,"reason":…}` and exits 1. `reason` is the server's error (`not_in_tree`, `pending_anchor`, …) or the check that failed:

```bash
node docs/product/examples/verify-inclusion.mjs xfuel-3155b7d8-4315-44bc-bfdc-bf6b78ff2d15
```

It does not check the head signature or the anchor transactions. `chit402-verify` does those.

## What a holder gets

| Endpoint | Returns |
|----------|---------|
| `GET /v1/receipts/tree/head` | Latest signed tree head (`chit402.tree_head.v2`), or `not_yet_published`. `?tree_size=N` returns that signed head only. `N` is a canonical positive integer. A duplicate or non-canonical value is `400 {error:"bad_tree_size"}`. The sized response is `Cache-Control: private, no-store`. |
| `GET /v1/receipts/tree/epoch/:epoch/head` | Signed head of a closed epoch. Epoch 1 is the pinned final root, with its Base and Solana transactions. A public read does not broadcast. |
| `GET /v1/receipts/:task_id/inclusion` | Proof against the newest effectively anchored head: `leaf_index`, `tree_size`, `root`, `proof`, and `head` (`tree_size`, `root`, `signature`, anchor tx and chain when known). A broadcast head is treated as anchored only when the journal intent, the tracker receipt, the signed Base tx, and the block time all agree. `anchor_confirmed_by` says `signed_head` or `anchor_state`. The signed `anchors` object is not rewritten. `?tree_size=N` selects that signed head. `N` is a canonical positive integer with no leading zeros. A leaf past the anchored size is `status: pending_anchor` with `anchored_tree_size` and `live_tree_size`, and no proof. When the selected head is not itself anchored and a later anchored signed head contains the leaf, the body adds optional `covered_by`. It names the smallest such head: `epoch`, `tree_size`, `root`, `inclusion_url` (`/v1/receipts/<task_id>/inclusion?tree_size=<N>`), and `anchors`. `anchors.base.tx` is the Base transaction hash. `anchors.solana.slot` and `anchors.solana.signature` are present when that head has a Solana anchor. The field is omitted when the head is anchored, including `pending_anchor` for a leaf past that head. A quarantined head is not served and is not `covered_by`. Existing fields are unchanged. `head_url` is `/v1/receipts/tree/epoch/<E>/head` for a closed epoch and `/v1/receipts/tree/head?tree_size=<N>` for the open epoch. The public page uses that same `N` on both the inclusion link and the head link. Inclusion and head are the same size. |
| `GET /v1/receipts/tree/consistency?first=&second=` | Proof that the tree of size `first` is a prefix of size `second`. Optional `epoch` picks the epoch. See [Consistency proofs](#consistency-proofs). |

The gateway signs a new head on the first append of each UTC day. A public read does not publish or anchor, and it does not re-sign a stored head. Inclusion uses the newest effectively anchored head, so a leaf appended after that head is `pending_anchor` until the next anchor. A proof against a head that is not itself anchored can name the smallest later anchored signed head in `covered_by`. That object is `epoch`, `tree_size`, `root`, `inclusion_url` for that size, and the anchor transactions: Base `anchors.base.tx`, plus Solana `anchors.solana.slot` and `anchors.solana.signature` when present. It is left out when the inclusion head is itself anchored. A quarantined head is an example of a head that never anchors; it is not served, and it is not used as `covered_by`. A closed epoch and the open epoch can both have a head of the same size. The closed receipt pairs with `/v1/receipts/tree/epoch/<E>/head`, never with the open epoch's `?tree_size=` head. A closed epoch uses its pinned final head. A journal head newer than that pin, or a head that names a different root at the same size, is rejected. The verify page names a Base transaction, a Solana transaction, both, or `PENDING` for a leaf that is not in the anchored head yet. `PENDING` is only shown when the receipt verifies. A failed receipt is `FAILED`. Storage, epochs, and restore are in [receipt-log.md](./receipt-log.md).

## Consistency proofs

An inclusion proof ties one leaf to one signed head. To check that a later head extends an earlier one, fetch a consistency proof between their sizes. For a head and the head before it, use the earlier head's `tree_size` as `first` and this head's as `second`. The earlier root is the signed head's `prev_root`.

```bash
curl -s "https://api.chit402.com/v1/receipts/tree/consistency?first=36&second=37"
```

The response (`chit402.consistency.v1`) carries `epoch`, `first_tree_size`, `second_tree_size`, `first_root`, `second_root` and `proof`. Compare `first_root` and `second_root` with the roots of the two signed heads (`GET /v1/receipts/tree/head?tree_size=N`). The response itself is not signed, so the signed heads are what bind the roots.

`proof` is a list of node hashes in our own order, not the RFC 6962 `PROOF(m, D[n])` order. A stock RFC 6962 or RFC 9162 consistency verifier will not accept it as is. The order is: split the size-`second` tree at the largest power of two below its size, as RFC 6962 does, and recurse left then right. A subtree that lies wholly inside the first `first` leaves, or wholly after them, contributes its root hash. The reference check is `verifyConsistency` in `services/gateway/src/receipt-merkle.js`. It rebuilds both roots from the list and requires every hash to be used.

Epochs are separate trees. A consistency proof covers two sizes in the same epoch. The link between epochs is the signed epoch record (`GET /v1/receipts/tree/epoch`) and the closed epoch head (`GET /v1/receipts/tree/epoch/:epoch/head`).

`chit402-verify` does not check consistency yet. It checks inclusion against one signed head.

## Public attestation

A receipt shell is unsigned. An outside party cannot recompute `leaf_hash` from it, because `row_hash` is owner-held. For eligible Base receipts the shell carries `public_attestation.jws`, an ES256 JWS (`typ` `chit402-public-receipt+jwt`) under the issuer key in `/.well-known/jwks.json`. Its payload is the line `chit402.public_receipt.v1`, a newline, and a JSON object that signs:

- `task_id` and `issued_at`
- `payment.ref` (the payment tx, `base:0x…`), `payment.payee`, `payment.gross_amount`, `payment.settled_amount`, `payment.asset` and `payment.rail`
- `log.leaf_hash`, `log.leaf_index` and `log.epoch`
- `iss` and `attested_at`

That ties the public fields to the leaf by signature, so the inclusion proof for `log.leaf_hash` covers this receipt. The payer is not in the attestation or the leaf. That is by design. `npx chit402-verify <receipt url>` reports `verified_public` only when the attestation signature, the shell fields, the leaf's inclusion and anchor, and the Base payment all check out. A receipt issued before public attestation started has no `public_attestation`, and an outside check of it reports could-not-check.

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

The Solana anchor fee payer is pinned as an append-only list. The anchor key rotated on 2026-10-15; heads anchored before that name `BHTn…EioD`, heads after name `8ef3…JM4U`. Both pass offline. An entry is never removed.

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

## Quarantined heads

A signed head whose root is really an earlier prefix (the Oct 9, 2026 publish/append race) is quarantined: it isn't served, and no inclusion proof against it counts. `/health` lists it under `quarantined_heads`. The public, signed acknowledgement format for such a head is in [`docs/log/quarantine-ack.md`](../log/quarantine-ack.md).

## What this does not prove

It does not prove the payment. Pending anchor means that chain has not recorded the root yet. An anchor proves the issuer published the root at that time. It does not prove every receipt that will ever exist is in that root — only the tree of that size. It does not prove the RPC you queried is honest; it checks the transaction that RPC returned.
