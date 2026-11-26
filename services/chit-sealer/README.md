# Sealer hold

`anchor-hold.json` in `CHIT_V13_SEALER_DIR` stops the hourly scheduler. The file is written when an anchor receipt reverts (`anchor_reverted`) or when `nonce too low` does not match a transaction this sealer signed (`anchor_nonce_conflict`). While the file is present, every tick logs that code and `/health` reports it as `anchor_stall`. No later hour is signed.

`anchor-bumps.json` is not part of this hold. It records that an epoch already used its one replacement, and the original and replacement transaction hashes. Do not delete it to force a second bump.

## Clear a reverted anchor

1. Stop the gateway process so a tick cannot rewrite the file while you remove it.
2. Read `anchor-hold.json`. `reason` must be `anchor_reverted`.
3. On Base, confirm the checkpoint transaction. Deleting the file while that receipt is still status 0 makes the next tick write the hold back. Wait until the hash the scheduler will observe is not a reverted anchor.
4. Delete `anchor-hold.json`. Do not edit the JSON in place. Leave the directory mode 700.
5. Start the gateway. The next tick does not return `anchor_reverted`.

## Clear a nonce conflict

Deleting `anchor-hold.json` while the node still answers `nonce too low` for a hash this sealer did not sign writes the hold again on the next tick. Use one of the two steps below. Stop the gateway first.

1. Read `reason`. It must be `anchor_nonce_conflict`.
2. Read the unbroadcast commit in `sealer-state.json` and every `hash` or `tx` for that `nonce` in `anchor-intents.jsonl`.
3. On Base, call `eth_getTransactionByHash` for each of those hashes.

If one of those hashes is now present, the nonce is ours:

4. Delete only `anchor-hold.json`. Do not write `anchor-nonce-clear.json`.
5. Start the gateway. The next tick marks that hash broadcast and does not write the hold.

If none of those hashes is present, retiring the nonce is the supported clear. A plain delete is not:

4. Write `anchor-nonce-clear.json` in `CHIT_V13_SEALER_DIR`, mode 600, with the commit's nonce as a decimal string and nothing else:

```json
{ "v": 1, "nonce": "0" }
```

5. Delete `anchor-hold.json`.
6. Start the gateway. The scheduler does not send that nonce and does not write `anchor_nonce_conflict` again. It does not seal a later hour on the retired nonce.

A clear file whose `nonce` is not the journal nonce does not suppress the hold.

## One RPC

A receipt is released when both RPCs agree it is in a finalized block. If one RPC is down, the live RPC releases only after its finalized head is at least `CHIT_SEALER_FINALITY_DEPTH` blocks past the receipt block. The default is 64. Two agreeing RPCs do not wait for that gap.
