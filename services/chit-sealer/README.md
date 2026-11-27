# Sealer hold

`anchor-hold.json` in `CHIT_V13_SEALER_DIR` stops the hourly scheduler. The file is written when an anchor receipt reverts (`anchor_reverted`) or when `nonce too low` does not match a transaction this sealer signed (`anchor_nonce_conflict`). While the file is present, every tick logs that code and `/health` reports it as `anchor_stall`. No later hour is signed.

A hold file that is not a regular file, or that is empty, torn, or not the one-line `{ "v": 1, "reason" }` record, is `anchor_hold_unreadable`. That is also a hold: the tick does not sign. Recovering from it is manual. Stop the gateway, delete `anchor-hold.json`, and start again. Do not edit the file in place. The scheduler does not clear that code by itself.

`anchor-bumps.json` is not part of this hold. It records that an epoch already used its one replacement, and the original and replacement transaction hashes. Do not delete it to force a second bump.

## Clear a reverted anchor

1. Stop the gateway process so a tick cannot rewrite the file while you remove it.
2. Read `anchor-hold.json`. `reason` must be `anchor_reverted`.
3. On Base, confirm the checkpoint transaction. Deleting the file while that receipt is still status 0 makes the next tick write the hold back. Wait until the hash the scheduler will observe is not a reverted anchor.
4. Delete `anchor-hold.json`. Do not edit the JSON in place. Leave the directory mode 700.
5. Start the gateway. The next tick does not return `anchor_reverted`.

## Clear a nonce conflict

Deleting `anchor-hold.json` while the node still answers `nonce too low` for a hash this sealer did not sign writes the hold again. Stop the gateway before changing files in `CHIT_V13_SEALER_DIR`.

1. Read `reason`. It must be `anchor_nonce_conflict`. A file left over from an earlier hour does nothing, and it must not be used to remove a fresh hold.
2. Read the unbroadcast commit's `nonce` in `sealer-state.json`, and every `hash` or `tx` for that nonce in `anchor-intents.jsonl` and `anchor-bumps.json`.

If one of those hashes is on either RPC, the nonce is ours. Delete only `anchor-hold.json`. Do not write a clear file. The next tick marks that hash broadcast.

If none of those hashes is on either RPC, and both RPCs show the checkpoint account nonce above that commit, retire it:

3. Leave `anchor-hold.json` in place. Write `anchor-nonce-clear.json` next to it, mode exactly 0600 (0400 and 0644 are ignored), owned by the gateway user, after the hold file. The JSON is exactly these two fields and nothing else. A repeated key or a nonce with a leading zero (`00`) is ignored:

```json
{ "v": 1, "nonce": "0" }
```

4. Start the gateway. The next tick checks both RPCs. When the file is mode 600, newer than the hold, and the chain agrees the nonce was taken by someone else, the tick writes `anchor-hold.json` as `{ "v": 1, "reason": "anchor_nonce_retired" }` and deletes the clear file. That file is used once. A mode other than 600, an extra JSON key, a nonce that is not the journal nonce, or a file written before the hold is ignored.
5. Every later tick returns `ok: false` with `anchor_nonce_retired`. `/health` reports that code. The scheduler does not send.

A retired hold does not replace `anchor_reverted`, and it does not hide a transaction this sealer signed. Anchoring does not resume until a builder updates the sealer journal so the next commit uses a nonce the chain will accept, and then removes `anchor-hold.json`. Deleting the hold file by itself is not that step: the next tick writes `anchor_nonce_conflict` again.

## One RPC

A receipt is released when both RPCs agree it is in a finalized block. If one RPC is down, the live RPC releases only after its finalized head is at least `CHIT_SEALER_FINALITY_DEPTH` blocks past the receipt block. The default is 64. Two agreeing RPCs do not wait for that gap.
