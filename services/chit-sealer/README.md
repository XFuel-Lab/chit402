# Sealer hold

`anchor-hold.json` in `CHIT_V13_SEALER_DIR` stops the hourly scheduler. The file is written when an anchor receipt reverts (`anchor_reverted`) or when `nonce too low` does not match a transaction this sealer signed (`anchor_nonce_conflict`). While the file is present, every tick logs that code and `/health` reports it as `anchor_stall`. No later hour is signed.

## Clear it

1. Stop the gateway process so a tick cannot rewrite the file while you remove it.
2. Read the `reason` field. It is `anchor_reverted` or `anchor_nonce_conflict`.
3. On Base, confirm the checkpoint nonce and the `ChitAnchor` head. A reverted receipt must no longer be the transaction the scheduler will observe: either that hash is not status 0, or you have decided the nonce is yours again. Deleting the file while the receipt is still reverted makes the next tick write it back.
4. Delete `anchor-hold.json` from `CHIT_V13_SEALER_DIR`. Do not edit the JSON in place. Leave the directory mode 700.
5. Start the gateway. The next tick treats the sealer as clear and will seal the next finished hour that has intake.

`anchor-bumps.json` is not part of this hold. It records that an epoch already used its one replacement, and the original and replacement transaction hashes. Do not delete it to force a second bump.

## One RPC

A receipt is released when both RPCs agree it is in a finalized block. If one RPC is down, the live RPC releases only after its finalized head is at least `CHIT_SEALER_FINALITY_DEPTH` blocks past the receipt block. The default is 64. Two agreeing RPCs do not wait for that gap.
