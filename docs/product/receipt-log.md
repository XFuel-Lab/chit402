# Receipt log

The public receipt log is an append-only Merkle tree. This page is how that log is stored, how it fails, and how to restore it. Inclusion math stays in [receipt-merkle.md](./receipt-merkle.md).

The log lives in the gateway data directory, next to the book:

```
services/gateway/.data/receipt-log/
  journal.jsonl        append-only records, one JSON object per line
  checkpoint.json      atomic snapshot of each epoch's size and root
  anchor-state.json    atomic copy of the one-anchor-per-day guard
  epoch-record.json    signed epoch record, including orphaned roots
  bundle-index.json    local copy of the hourly S3 index hash
```

On Lightsail that directory is `/home/ubuntu/xfuel-protocol/services/gateway/.data/receipt-log`. It is gitignored. `git pull` does not delete it.

Each journal line is written, then the file and the directory are fsynced. The checkpoint, anchor state, epoch record, and bundle index are written to a temp file in the same directory, fsynced, and renamed.

## What is stored

- The exact genesis leaf bytes. Later boots use those bytes. They do not call the current verifier digest.
- Every later leaf's preimage bytes (`task_id|row_hash`).
- Every signed head, and the observed historical heads that were not re-signed.
- The anchor guard: which UTC day already has a Solana signature, and which root already has a Base transaction.

A leaf hash is SHA-256 of `0x00` plus the stored preimage. On boot the gateway replays the journal, recomputes every root, and checks each stored head. Genesis is the stored preimage, not `packages/verify/BUILD_DIGEST.txt` as it reads today.

## Failure modes

The process refuses to start in these cases. It does not open an empty log and it does not anchor a new genesis.

| Condition | Result |
|-----------|--------|
| Journal line does not parse, or a preimage does not match its stored leaf hash | Refuse. Code `corrupt_journal` or `leaf_hash`. |
| Recomputed root does not match a stored head, the checkpoint at the same size, or the epoch record | Refuse. Code `root_mismatch`. |
| Checkpoint is ahead of the journal | Refuse. Code `checkpoint_ahead`. |
| Anchor state or an epoch record exists and the journal does not | Refuse. Code `missing_log`. |
| Journal is empty or missing while the pin is set | Refuse. Code `pin_unmet`. |
| Journal is non-empty and a pinned epoch's recomputed root or size does not match | Refuse. Code `pin_unmet`. |
| A pin anchor has no transaction hash | Refuse. Code `anchor_tx_unspecified`. |
| The RPC does not return a known anchor transaction | Refuse. Code `anchor_rpc_missing`. |
| That transaction's root differs, or the root is not a journal head | Refuse. Code `anchor_root_mismatch` or `anchor_not_in_journal`. |
| Epoch record is missing | Refuse. Code `epoch_record_missing`. |
| Epoch record signature does not match the epochs or the orphan list | Refuse. Code `epoch_signature`. |
| Epoch record is not the pinned epoch 1 (`dd20e39a…`, size 4, genesis `422cceb1…`) | Refuse. The reason names the failed check, including `epoch1_root`. |

The pin is `services/gateway/receipt-log-pin.json`. It names epoch 1 at root `dd20e39a39a225b7b3441bb7f61532c06562288b74ae5dc4dda015c48312f973`, size 4, and epoch 2 opening at `f2043ee96b6e9f678b76bb3c512b5d911293dbb2a3bf198c98252c83802f3286`. Boot recomputes each of those prefixes from the journal. An empty directory fails that check. A journal that holds some other tree fails it too. Keys in `anchor-state.json` are not proof that a root is in the log. `RECEIPT_LOG_EXPECTED_EPOCH` and `RECEIPT_LOG_EXPECTED_ROOT` do not replace that file. When both are set they can only add a stricter current root for an open epoch. A value that disagrees with epoch 1 refuses to boot (`bad_pin`). The chain hash list, both epoch prefixes, and the RPC checks still run. An RPC that returns nothing is `anchor_rpc_missing`. The recovery is a better RPC URL. `startServer` sets `RECEIPT_LOG_BOOT=1`, which loads this pin. An empty or missing journal with that pin does not boot. That is the failure that restarted the log six times: a process came up with no leaves and a later read published a new genesis. `RECEIPT_LOG_BOOT=0` skips the load. Leave that unset on the public gateway.

Each pin anchor has a `tx`. Boot loads a Base transaction with `eth_getTransactionByHash` and a Solana transaction with `getTransaction`. The calldata or the memo must contain that root. Anchors with `in_journal` true (epoch 1 final `dd20e39a…` and the epoch 2 opening `f2043ee9…`, on both chains) must already be journal heads. Orphans, and the epoch 1 size-2 head `ecf9a330…`, are checked on chain and are not required as journal heads. The restored journal stores the size-4 head, not a separate size-2 head. If `tx` is null, or the RPC returns nothing, boot refuses. There is no Otterscan query and no block scan.

`ff950e72…` is Base-only. Its pin entry sets `solana` to `absent`. The anchor memo wallet `BHTnbPu6UZ7zQZ7Qpkpz4LcUQbMN73YDsMtvaNXpEioD` has no memo for that root. Epoch 1's Oct 3 Solana memo is present.

`GET /v1/receipts/tree/head` still does not sign a head or send a transaction. It is only reached when boot succeeded.

The only way past the pin and the on-chain check is `RECEIPT_LOG_ACCEPT_FRESH_GENESIS` set to exactly `YES_I_ACCEPT_A_NEW_PUBLIC_RECEIPT_LOG`. Boot logs that at error level, including the words `FRESH GENESIS`. The flag does not extend epoch 1 or epoch 2. Leave it unset on the public gateway.

`RECEIPT_LOG_STRICT=false` logs and continues when the journal is missing but an anchor snapshot exists. It still does not mint a genesis. Production should leave strict mode on.

A failed disk write throws. It is not swallowed.

## Heads and anchors

Signed heads are `chit402.tree_head.v2`, payload version 2. A version 1 head still verifies.

| Claim | Meaning |
|-------|---------|
| `epoch` | Which log this head belongs to |
| `prev_epoch_root` | Final root of the previous epoch. Null on epoch 1 |
| `prev_epoch_size` | Leaf count of that previous epoch. 0 on epoch 1 |
| `prev_root` | Previous stored head in this epoch. 64 zero bytes only for a real genesis head |
| `bundle_index_hash` | SHA-256 of the canonical bundle index at publish time |
| `tree_size`, `root` | This head's tree |

`prev_root` is the last stored head whose root differs from the head being published. It is not chosen by comparing `published_at`.

The Solana memo for a new anchor is:

```
chit402:root:v2:<scope>:<yyyy-mm-dd>:<root>:<prev_root>:<epoch>:<prev_epoch_root>:<prev_epoch_size>:<bundle_index_hash>
```

`prev_epoch_root` is 64 zero bytes when the epoch has no predecessor. A v1 memo (`chit402:root:v1:<scope>:<day>:<root>:<prev>`) still parses.

Base calldata remains the 32-byte root. The previous root is inside the signed head and on `anchors.base.prev_root`. The offline check that calldata equals the root is unchanged.

The one-anchor-per-day guard is `anchor-state.json`. A restart does not forget a signature that was fsynced. Publishing happens on the daily append path. A public GET does not publish.

Before a Base broadcast, the gateway signs the zero-value self-transfer and fsyncs an `anchor_intent` record with the signed raw transaction, the keccak hash of that raw transaction, the root, the UTC day, the nonce, and the sender. The broadcast is the next step. Boot loads the stored hash with `eth_getTransactionByHash` and `eth_getTransactionReceipt` on any standard RPC. It adopts the intent only when the calldata root equals the intent root, the sender is the anchor key, the `to` address is that same anchor address, and the receipt status is 1. Any other transaction mined at that nonce is `replaced`: it is not anchored, and it is not sent again on that nonce. If the stored hash is missing and `eth_getTransactionCount` for the sender at `latest` is at or below the reserved nonce, boot rebroadcasts that same raw transaction. If the count is above the nonce and the hash is not mined, the intent is `replaced`. An `intent` row with no raw transaction was never broadcast. Reconcile marks it `abandoned_unsigned` and the next sign reuses that nonce, for that root or any later root. One sender has at most one unresolved signed raw. The next root looks that raw up and rebroadcasts it before signing anything new. A permanent rejection is replaced at the same nonce. The older intent is `superseded` and is not broadcast again. A transient RPC error leaves the intent `blocked`, the head says `blocked`, and retries wait on an exponential backoff. `last_error` on `/health` is that reason. Before boot finishes and before every broadcast, `eth_chainId` on `BASE_RPC_URL` must be `0x2105`. Anything else is `anchor_chain_mismatch` and the signed bytes are not sent. The signed transaction itself still uses chain id 8453. `RECEIPT_ANCHOR_FROM` may be omitted. The sender is then the address of `RECEIPT_ANCHOR_PRIVATE_KEY`. Boot refuses when both are set and they disagree. `ots_getTransactionBySenderAndNonce` is optional and is not required. A Base intent becomes anchored only after confirmAnchor fetches a status-1 receipt for that exact root, sender, and to, so already known and nonce too low stay broadcast, a missing block time is unconfirmed and looked up again, a mined receipt outside the clock bound is replaced so the next publish uses the next nonce, a mempool transaction older than ANCHOR_STUCK_MS (default 10 minutes) is replaced at the same nonce with a higher fee and the newest root unless ANCHOR_MAX_FEE_WEI blocks it as anchor_fee_cap, /health reports stuck_pending_age_s, and reconcile marks every lower-fee raw superseded before broadcast.

Inclusion proofs include `epoch`, `prev_epoch_root`, and `prev_epoch_size`. An epoch 1 proof verifies against the epoch 1 root. It does not have to verify against epoch 2.

## Epochs

| Epoch | What it is |
|-------|------------|
| 1 | Closed. Four leaves. Genesis digest `422cceb1be77114317043b0a00bc18cba6ca9cee34144cd23875c6dcf1b47368` (verifier sources from the #468 build). Final root `dd20e39a39a225b7b3441bb7f61532c06562288b74ae5dc4dda015c48312f973`. |
| 2 | Open. Starts at `f2043ee96b6e9f678b76bb3c512b5d911293dbb2a3bf198c98252c83802f3286`, the Oct 5 genesis leaf (digest `847edd66…`). `prev_epoch_root` is the epoch 1 final root and `prev_epoch_size` is 4. |

The Oct 5 Solana memo for that opening root used a prev of 64 zero bytes. That memo is not rewritten. The epoch link is `prev_epoch_root`, not that memo.

The signed epoch record (`chit402.tree_epoch.v1`) also lists orphaned roots that are on Base and are not a prefix of epoch 1:

- `20d887917a4c32a49434e4b8f8db864cbf26a8e3a0daa6f5f89ab097282413f9`, the same genesis-only root anchored five times from Sep 30 through Oct 1.
- `d7f6c548`, a populated tree anchored Oct 1 around 8:01 AM ET and lost on the next restart. The full root was not recovered. The record keeps `root: null`, `root_prefix: d7f6c548`, and `unrecoverable: true`. It does not invent the rest and it is not skipped.
- `f2043ee9…`, the Oct 5 genesis-only anchor, which is also the opening leaf of epoch 2.

Existing receipt `tree_head_hash` values are not re-signed. Epoch 1 inclusion still uses the prefix root that was signed into those receipts.

`GET /v1/receipts/tree/epoch` returns the signed record. It does not publish a head.

`GET /v1/receipts/tree/epoch/1/head` returns the closed epoch-1 head. The root and size are the journal's (`dd20e39a…`, size 4). The Base transaction `0x1d8d7ea2…` and the Solana signature `61RHMsPP…` are the in-journal rows of the committed pin. The issuer key signs that head on read. The GET does not write the journal, broadcast, or change the signed epoch record. Epoch-1 inclusion proofs use this head, so `anchor_status` is `anchored` and `anchor_tx` is that Base transaction. A closed epoch whose root is not an in-journal pin anchor stays `not_yet_published`.

### Rebuild epoch 1 on the server

Run this on the gateway host, against the book file, before restarting the process onto this build. It refuses unless the root is exactly the epoch 1 final root. It does not broadcast and it does not re-sign a receipt.

```bash
cd /home/ubuntu/xfuel-protocol/services/gateway
node scripts/rebuild-receipt-epoch1.mjs \
  --jsonl .data/agents/usage-settled.jsonl \
  --out .data/receipt-log
```

The script reads `usage-settled.jsonl` in file order, skips rows before `xfuel-39af100b-23dd-4d86-a16b-4556ca6796af`, and takes that row plus the next two rows that have a `task_id`. Leaf 0 is the pinned genesis bytes. If `.data/receipt-log/journal.jsonl` already exists, the script refuses to overwrite it.

Then backfill every later book row that is not already a leaf. Dry-run is the default. `--apply` writes the leaves and does not publish or broadcast.

```bash
node scripts/backfill-receipt-log.mjs \
  --jsonl .data/agents/usage-settled.jsonl \
  --dir .data/receipt-log
node scripts/backfill-receipt-log.mjs \
  --jsonl .data/agents/usage-settled.jsonl \
  --dir .data/receipt-log \
  --apply
```

The dry-run prints `would append <task_id>` for each row that would be written. It also lists every refusal as `refuse <task_id or agent id>: <reason>` and exits non-zero. It refuses a book whose `analyzeSeq` result is `FORKED`, a gap, a duplicate seq, and any leaf whose `row_hash` is empty or missing. Those are the same rows the epoch 1 rebuild refuses. `--apply` prints `appended <task_id>` and does not run when a refusal was listed. Rows before epoch 1's last receipt leaf stay out of the tree.

## S3 bundles

Hourly bundles are off until `RECEIPT_LOG_S3_BUCKET` is set. Credentials use the AWS SDK default chain (environment, shared config, or the instance role). No key is committed.

| Variable | Role |
|----------|------|
| `RECEIPT_LOG_S3_BUCKET` | Bucket name. Unset means the uploader does not run. |
| `RECEIPT_LOG_S3_REGION` | Region. Default `us-east-1`. |
| `RECEIPT_LOG_S3_PREFIX` | Key prefix. Default `receipt-log/`. |
| `RECEIPT_LOG_S3_RETENTION_DAYS` | Object Lock retain-until, in days from upload. Default 365. |
| `RECEIPT_LOG_S3_ENDPOINT` | Optional endpoint for MinIO. |
| `RECEIPT_LOG_S3_FORCE_PATH_STYLE` | Set `true` for path-style endpoints. |
| `RECEIPT_LOG_RETENTION_POLICY_ID` | Optional id of a retention policy document. |
| `RECEIPT_LOG_RETENTION_POLICY_SHA256` | SHA-256 of that document. Both must be set or the field is omitted. |

The bundle index may carry `retention_policy: { id, sha256 }`. That pair is inside the hash the daily anchor commits to. Receipts do not sign it yet. `/health` and `GET /v1/receipts/tree/head` include `receipt_log.last_bundle_ok_at` and `receipt_log.consecutive_failures`. They also include `blocked_intents`, `pending_intents`, `oldest_blocked_age_s`, `last_anchored_root`, `last_anchored_tx`, `last_error`, and `stuck_pending_age_s`. An upload error increments the count and does not stop the process. A later success sets `last_bundle_ok_at` and clears the count.

Each hour the gateway gzips one JSON document (`chit402.receipt_log_bundle.v1`): the open epoch's leaf preimages, heads, the book rows those new leaves came from, and the closed epochs. It uploads that gzip with `ObjectLockMode: COMPLIANCE`, then reads the object retention back. The upload fails (`object_lock_not_compliance`) unless the mode is `COMPLIANCE` and a retain-until date is set. The SHA-256 of the gzip bytes is recorded in `receipt-log/index/<hour>.json`, where `<hour>` is `YYYY-MM-DDTHH`. That index key is write-once. If it already exists, the hour is refused (`index_already_published`) and a new version is not written. The next daily anchor's `bundle_index_hash` is the SHA-256 of the canonical index (object keys sorted). Health counters are not part of that hash.

A failed upload is logged and retried on the next hour. It does not by itself stop the process. The local journal is still required to boot.

### Bucket setup

Create the bucket with Object Lock enabled. Object Lock has to be turned on at creation. The default retention mode is compliance. Governance mode is not accepted: the gateway reads the lock back after every put and refuses anything else.

The instance role needs this policy. `s3:PutObjectRetention` is allowed only when `s3:object-lock-mode` is `COMPLIANCE`. `s3:PutObject` has the same condition, because the put itself sets the lock mode. The policy does not grant `s3:BypassGovernanceRetention`. `s3:GetObject` covers `HeadObject`, which is how the write-once index check sees an existing key.

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "ReceiptLogRead",
      "Effect": "Allow",
      "Action": [
        "s3:GetObject",
        "s3:GetObjectRetention"
      ],
      "Resource": "arn:aws:s3:::BUCKET_NAME/receipt-log/*"
    },
    {
      "Sid": "ReceiptLogWriteCompliance",
      "Effect": "Allow",
      "Action": [
        "s3:PutObject",
        "s3:PutObjectRetention"
      ],
      "Resource": "arn:aws:s3:::BUCKET_NAME/receipt-log/*",
      "Condition": {
        "StringEquals": { "s3:object-lock-mode": "COMPLIANCE" }
      }
    },
    {
      "Sid": "ReceiptLogList",
      "Effect": "Allow",
      "Action": "s3:ListBucket",
      "Resource": "arn:aws:s3:::BUCKET_NAME",
      "Condition": { "StringLike": { "s3:prefix": "receipt-log/*" } }
    }
  ]
}
```

Replace `BUCKET_NAME`.

Lifecycle rule, move bundles to Glacier after 90 days. Object Lock still applies after the transition.

```json
{
  "Rules": [
    {
      "ID": "receipt-log-glacier-90",
      "Status": "Enabled",
      "Filter": { "Prefix": "receipt-log/" },
      "Transitions": [{ "Days": 90, "StorageClass": "GLACIER" }]
    }
  ]
}
```

### Restore

```bash
cd /home/ubuntu/xfuel-protocol/services/gateway
RECEIPT_LOG_S3_BUCKET=BUCKET_NAME RECEIPT_LOG_S3_REGION=us-east-1 \
  node scripts/restore-receipt-log.mjs
```

The script downloads the latest `receipt-log/index/<hour>.json`, checks each bundle's SHA-256, and rebuilds the leaves from the stored preimages. It checks `bundle_index_hash` against an anchored, signed head (`--head path.json`, or the newest signed anchored head inside the bundles). Epoch 1 size 4 must be `dd20e39a…` and the epoch 2 opening root must be `f2043ee9…`. Leaves past those prefixes have to roll into that head's root and size. A prefix match with a different full root is refused. Extra checks: `--expect <epoch>:<size>:<root>`. It does not write the local journal and it does not broadcast. Copy a restored tree into `.data/receipt-log` only after that check passes, and only when that directory has no journal yet.

## Rollout on Lightsail

Do this before `systemctl restart xfuel-api` on the build that contains this log. Do not set the fresh-genesis flag.

1. Pull the commit. Do not restart yet.
2. Confirm `.data/agents/usage-settled.jsonl` is the live book.
3. Run `rebuild-receipt-epoch1.mjs` as above. It must print the epoch 1 root and `epoch record signed: true`. If it prints `REFUSED`, do not restart.
4. Run the backfill dry-run, read the `would append` task ids, then run it again with `--apply`. Do this before restart. The script does not broadcast.
5. Create the S3 bucket with Object Lock (compliance) and the lifecycle rule above. Attach the instance role. Set `RECEIPT_LOG_S3_BUCKET` and `RECEIPT_LOG_S3_REGION` in `.env` when you want hourly bundles. Leaving the bucket unset keeps bundles off. Set `RECEIPT_LOG_RETENTION_POLICY_ID` and `RECEIPT_LOG_RETENTION_POLICY_SHA256` together when a policy document should be named on the bundle index.
6. Leave `RECEIPT_LOG_STRICT` unset and leave `RECEIPT_LOG_ACCEPT_FRESH_GENESIS` unset. The committed pin already names the Base and Solana transactions. Boot still refuses a null `tx`. The pin is checked against the recomputed journal, not only against an empty directory. `ff950e72…` has no Solana transaction.
7. Restart `xfuel-api` only after the rebuild and the backfill `--apply` have written the journal. An empty `.data/receipt-log` now refuses to start (`pin_unmet`) instead of serving a fresh log. If you restarted too early, stop the service, run the two scripts, then start.
8. `GET /v1/receipts/tree/head` may say `not_yet_published` until the next book append publishes the day's head. That GET must not create a Base or Solana transaction. The recomputed epoch 2 root is still in that response as `root`. `receipt_log.consecutive_failures` on `/health` is what the smoke check should alert on.
9. `GET /v1/receipts/tree/epoch` returns the signed record, including the orphan list.

## Principal notice (draft)

Receipt log notice (Oct 6). On Oct 5 at about 7:18 AM ET the public receipt log restarted from memory. A new root, f2043ee9, was anchored at 7:22 AM ET without a link to the Oct 3 root dd20e39a (4 leaves, Base and Solana). Signed receipts were not changed. They still verify, and none were re-signed.

This release stores the log on disk and refuses to start if that copy is missing, does not match the pinned epochs, or does not contain the known Base and Solana anchor transactions. A public read no longer publishes a head. Epoch 1 is the four-leaf log that ends at dd20e39a. Epoch 2 starts at f2043ee9 and records the link back to epoch 1, including the leaf count 4. The epoch record is signed. Earlier Base anchors from Sep 30 and Oct 1, including the lost populated root whose prefix is d7f6c548, are listed as orphans. That lost root is marked unrecoverable and its full bytes are not invented. Inclusion proofs for epoch 1 stay valid against dd20e39a once that epoch is rebuilt on the server from the book. Book rows after that epoch are appended by an operator script before the process starts. The script refuses a forked book and a leaf with no row hash. A new log is not opened unless an operator sets an explicit flag for that purpose.
