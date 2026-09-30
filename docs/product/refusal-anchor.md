# Chain anchor on a refusal

When policy blocks a spend, the `policy_blocked` row records the chain the spend would have used. Base is the rail that is observed today.

| Field | Meaning |
|-------|---------|
| `anchor.status` | `observed` or `UNAVAILABLE` |
| `anchor.rail` | `base` |
| `anchor.chain_id` | From `eth_chainId` (8453 on Base mainnet) |
| `anchor.block_number` | Latest block number at clamp time |
| `anchor.block_hash` | That block's hash |

The same object is inside the row's signed `book_chain` (`chit402.book_seq.v1`). The payment JWS is not rewritten.

If `BASE_RPC_URL` / `SETTLEMENT_RPC_URL` is unset, or the RPC errors or times out, the row is still written and `anchor.status` is `UNAVAILABLE`. The refusal does not fail because the chain could not be read.

A synchronous caller that has not observed a block yet records `UNAVAILABLE` with reason `no_observation`. The paid chat path waits up to 800ms for a fresh block, then records whatever came back, including `UNAVAILABLE`.

The book and the verify page show the anchor on the refusal.

## What this proves

When `status` is `observed`, the issuer saw this block hash on this chain id at clamp time and signed that observation into the refusal row.

## What this does not prove

It does not prove the blocked spend would have landed in that block. It does not prove a later reorg did not move the hash. `UNAVAILABLE` means the issuer did not have a block, not that the chain was empty.
