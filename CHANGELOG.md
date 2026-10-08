# Changelog

All notable changes to Chit402 are documented here.

Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).  
Versioning follows [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

---

## [Unreleased]

### Security
- **Inclusion follows the newest anchored head.** `GET /v1/receipts/:task_id/inclusion` proves against the latest signed head whose root is on chain, not the live tree. `?tree_size=N` selects one signed head and is 400 when that size is unsigned, mismatched, past the live tree, or written with a leading zero. A leaf past the anchored size is `pending_anchor` with the anchored size, the live size, and no proof. The body names that head (`tree_size`, `root`, `signature`, anchor tx and chain). The receipt page prints `PENDING` for that leaf before any carry-forward line. A closed epoch proves against its pinned final head, not an earlier journal anchor. A different root at that size, or a newer head, is rejected. `@xfuel/verify --rpc` prints `PENDING` for that leaf (exit 2) only when the index is past the head, and it rejects the head when a newer Solana memo exists on any listed fee payer. Not published. No deploy. No receipt is re-signed.
- **Signed claims are compared in full, and log mode checks the receipt.** `@xfuel/verify` 0.3.2 walks every signed field against the outer receipt, lists paths the signature does not cover as `UNVERIFIED`, rejects a Merkle `position` label that disagrees with the leaf index, and fails log mode when the receipt checks fail. Not published. No deploy. No receipt is re-signed.
- **A pre-pinning tree head fails closed.** An anchored head whose signature does not name the Base sender or the Solana fee payer returns `LEGACY_HEAD_UNPINNED_SIGNER` and does not verify. The epoch-1 head and the epoch-2 head signed at 07:43 ET on 2026-10-07 are this case. A newer head should be used. Not published. No deploy in this change.
- **Offline inclusion uses the receipt's top-level `row_hash`.** `@xfuel/verify` builds the offline leaf the same way anchor mode does: top-level `row_hash`, then `book_chain.row_hash`, then the inclusion document. Sources that are all present must match; a disagreement is `row_hash_mismatch`. A history kid matched by RFC 7638 thumbprint uses that same window, and a time outside the window still fails. Not published. No deploy in this change.
- **Log mode fails a receipt that is not fully signed.** In `@xfuel/verify` log mode, a missing or stripped issuer signature, or a receipt check that is only partial, fails the combined result. Exit code is non-zero, Overall is not VERIFIED, and `--quiet` still prints the failure. A matching inclusion proof does not hide a tampered outer amount. Not published. No deploy in this change.
- **Offline head checks fail closed.** A tree head with no `issuer_signature` does not verify offline (`head_signature_missing`). Head trust uses the issuer-history body that was fetched for that call; a history-only kid is trusted from that body, and a fetched body that does not verify is `issuer_history_invalid` rather than a production-pin pass. Not published. No deploy in this change.
- **Inclusion is bound to index and size, and the tree head signature is checked offline.** `@xfuel/verify` 0.3.2 (still unpublished, stacked on the anchor-wallet work) rejects a head whose ES256 signature does not cover the outer size and root, including when `--rpc` is not passed. Inclusion proofs follow RFC 9162 §2.1.3.2: index and size choose the sibling side, a short or long proof fails, and `index >= size` fails. The gateway inclusion check uses the same rule. Leaf hashing, node hashing, consistency proofs, and the empty root are unchanged. A verified `chit402.foreign_payout.v1` receipt reports `settled_by: observed_transfer`. Not published. No deploy in this change.
- **Anchor mode binds the tree head to the issuer.** `@xfuel/verify` 0.3.2 rejects a head with a missing, forged, or untrusted `issuer_signature`, and it requires the Base sender and Solana fee payer in that signature to match the transactions and the issuer's anchor-wallet list. The package pin is Base `0x1844D1F5FE42aff1Cce6F776514Fd40374079582` (tx `0x1d8d7ea2…`) and Solana `BHTnbPu6UZ7zQZ7Qpkpz4LcUQbMN73YDsMtvaNXpEioD` (signature `61RHMsPP…`). New heads take those fields from `RECEIPT_ANCHOR_FROM` / `RECEIPT_ANCHOR_PRIVATE_KEY` and `SOLANA_ANCHOR_FEE_PAYER` / `SOLANA_ANCHOR_SECRET_KEY`. `GET /v1/receipts/tree/epoch/1/head` fills them from the committed pin. `GET /.well-known/anchor-wallets.json` publishes the signed list. `issuer_root` and `dns` on that document are reserved for the Base registry and `_issuer.chit402.com` and are not read. The epoch 1 root `dd20e39a…`, the epoch 2 opening `f2043ee9…`, and the epoch record payload are unchanged. **Gateway (Lightsail):** redeploy required before a live `--rpc` check of the served epoch-1 head passes. **@xfuel/verify:** npm publish required. Not published in this change.

### Added
- **Dated carry-forward.** When a receipt leaf is in an earlier signed epoch head and in the current signed epoch head, `@xfuel/verify` and the receipt page report `VERIFIED_CARRIED_FORWARD` with the issued time and epoch from the earlier head and the logged time, epoch, and leaf index from the current head. Inclusion is RFC 9162. A receipt in the current epoch is unchanged. A missing or invalid signature, a bad proof, a leaf mismatch, a current head time before the earlier head, an epoch id outside the pinned anchor list, or the same leaf at two indexes fails closed with the existing error code. Version stays 0.3.1. Not published.
- **`@chit402/cdp-spend-store` (not published).** CDP `SpendStore` whose `append` holds against a funder cap on the gateway and whose payment-response hook settles that hold into one Chit402 receipt. Base Sepolia only. The gateway routes (`POST /v1/spend/holds`, release, settle) mount only when `SPEND_HOLD_ENABLED=true` and reject mainnet. A retry returns the stored issuer JWS and does not sign again. No production deploy in this change.

### Fixed
- **Gateway-hashed deliverables are labeled sha256.** `hashDeliverablePayload` writes sha256 with a `0x` prefix, and `outputCommitmentOf` treated every `0x` hash as keccak256. Foreign-ingest receipts (including the already-signed kestrel482 receipt) were labeled keccak256 for a sha256 digest. The gateway now sets `kind: 'sha256'` when it hashes. A sender-supplied hash must name `sha256` or `keccak256` (`deliverable_kind` or `output_commitment.kind`). A missing or unknown kind is `invalid_output_commitment`. A `sha256:` or `keccak256:` label that disagrees with `kind` is rejected, and the digest must be 32 bytes of hex. Prefix guessing is gone. Listener output hashes stay keccak256 because that pipeline computes keccak256, and the no-hash fallback stays sha256. Board jobs already passed `kind: 'sha256'`. The kestrel482 receipt keeps the keccak256 label it was signed with and is not re-signed. `chit402-emdash` now sends `deliverable_kind: 'sha256'` with `deliverable_hash`. Older emdash builds that send the hash alone are rejected. **Gateway (Lightsail):** ships in the same restart as the receipt-log PRs. No separate deploy. `SPEND_HOLD_ENABLED` stays off.
- **Export coverage JWS is stable across GETs.** `GET /receipt/:id` called `coverageForLedger` → `signExportCoverage` on every read, so ES256 minted a new `coverage.issuer_signature.jws` and spent the issuer key for an anonymous GET. A signature is now stored under SHA-256 of the JCS of every signed claim field plus the JWS header and the issuer public key, and that stored JWS is returned while the claims and key are unchanged. A new row, cap, scope, subject, kid, or key misses and is signed once. The cache is bounded (256, or `COVERAGE_SIG_CACHE_MAX`). It is written immediately under `.data/coverage-signatures` (or `COVERAGE_SIG_DIR`), the same way a receipt issuer JWS is written on read, and reused after restart. `TASK_STORE_PERSIST=false` keeps it in memory only. A stored file is served only when those canonical bytes match and the JWS verifies under the current key. Receipt issuer signatures are not minted or replaced. **Gateway (Lightsail):** ships in the same restart as the receipt-log PRs. No separate deploy. `SPEND_HOLD_ENABLED` stays off.
- **`@xfuel/verify` Windows `npm test`.** The epoch JWKS preload passed to `--import` is a `file://` URL, and `xfuel-verify` exits by setting `process.exitCode` after closing the fetch connection pool. Node 24 on Windows was aborting `npm publish`'s test run (`ERR_UNSUPPORTED_ESM_URL_SCHEME` on a `C:\` path, and `UV_HANDLE_CLOSING` after a verified epoch-1 check). Version stays 0.3.1. Not published.
- **Epoch 1 can be checked from served data.** `GET /v1/receipts/tree/epoch/1/head` returns the closed epoch-1 head (root `dd20e39a…`, size 4) signed with the issuer key. Base `0x1d8d7ea2…` and Solana `61RHMsPP…` come from the committed pin. The GET does not write the journal, broadcast, or change the signed epoch record. The epoch 1 root and the epoch 2 opening stay byte-identical. Epoch-1 inclusion proofs name those anchors. `@xfuel/verify` 0.3.1 compares the full mainnet `getGenesisHash` (`5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d`). Not published. No deploy in this change.

### Changed
- **`@xfuel/verify` 0.3.0** and **`chit402-verify` 0.3.0**. The alias depends on `@xfuel/verify` `^0.3.0`. This packages the canonical preimage check, the issuer-history pin (`not_after`), and refusal checks. Publish `@xfuel/verify` first, then `chit402-verify`. No production deploy in this change.

### Fixed
- **Receipt-log orphan list matches the anchors.** Payload version 2 names `ff950e72…` (Base nonce 0, no Solana memo) and marks `20d88791…` and `d7f6c548…` as Base and Solana. The full `d7f6c548` root stays null. Version 1 records keep the orphan list they were signed with. Epoch 1 head serving and the verifier Solana genesis constant are unchanged.
- **Receipt-log backfill lists rows it will not append.** A forked agent's rows, a row with an empty `row_hash`, and a row whose chain depends on one of those are named on a payload version 2 epoch record as `unlogged` and are not given a leaf. Clean rows, which already have the append-time `row_hash`, are appended to epoch 2 after `f2043ee9` in book order. The version 1 record stays in the journal and is not re-signed. Epoch roots and orphans are the version 1 bytes. The book file is not written. No hash is derived. `GET /v1/receipts/:task_id/inclusion` for an unlogged id is `not_in_tree` plus that reason. `@xfuel/verify` checks the list hash and stays at 0.3.1. **Gateway (Lightsail):** the rebuilt journal does not need another rebuild. Dry-run, then `--apply`, then restart. No broadcast.
- **Receipt-log rebuild signs with the production issuer key.** `rebuild-receipt-epoch1.mjs` did not load `.env`, so `ISSUER_PRIVATE_KEY` was unset and the epoch record was signed with an ephemeral key. Backfill and boot then refuse that signature (`epoch_signature` / `no_matching_key`). Rebuild, backfill, and restore now load `src/config.js` the same way the server does. Rebuild refuses when the key is unset, prints the `kid`, and verifies the epoch record against `getJwks()` before it reports success. Backfill reports `no journal at <absolute directory>` when `journal.jsonl` is absent, instead of `epoch1_has_no_receipt_leaf`. A log signed by the old script cannot be reused. **Gateway (Lightsail):** pull this commit, move the bad receipt-log directory aside, rerun rebuild and backfill, then restart. Do not touch `usage-settled.jsonl`. No broadcast and no receipt re-sign.
- **Issuer JWS is byte-identical across GETs after hot-map eviction.** A byok snapshot that left the hot map was re-signed on every `GET /receipt/:id`. `persistSignature` wrote the JWS onto the ephemeral object from disk, and `flushAll` only walks the hot map, so the file never gained `issuerSignature`. ES256 is non-deterministic: the signature segment changed, and the claims and `payload_hash` did not. A signature sealed on that read is written immediately and pinned for the next get. The read is not put back in the hot map. A JWS already stored is not replaced, and the payload is not rewritten. Book export coverage is a separate signature and is not this path. Reproduced by Doctor on `chit-66ca86e4-601a-4c44-92c7-4cfb9213fcd6` (control `chit-1ebc5616-d9ce-4da9-b56c-847062ff6b96` stayed stable). The retention fix kept the file; it did not stop the re-sign. **Gateway (Lightsail):** redeploy required.
- **Windows canonical-preimage CLI test.** `packages/verify` locates `dist/cli.js` with `fileURLToPath`. `URL.pathname` plus `path.join` produced `\C:\...` on Windows, so `npm test` failed on "a tampered canonical preimage fails the receipt and the CLI" before `npm publish`. The hash check is unchanged.
- **A stored receipt is not re-signed on read.** `GET /receipt/:id` and `GET /receipt/:id/preimage` keep the issuer JWS that was stored. A v9 receipt with a stale covering head stays payload version 9, byte-identical, and `/preimage` is 404. Only a receipt issued by this build is payload version 10. A v10 covering-head refresh restamps that same claim set; it does not mint a new payload.
- **Public receipt snapshots are not pruned.** `gcPersisted` deleted every task file whose `updatedAt` or `createdAt` was older than `TASK_STORE_RETENTION_MS` (default 30 days). That is what 404'd the retired specimen row after it had been public. Paid, signed, and published terminal snapshots are kept. Scratch tasks with no payment ref, no issuer signature, and a non-terminal status still expire. A gateway deploy is required before the next receipt crosses the old window (`chit-1ebc5616-d9ce-4da9-b56c-847062ff6b96` was last updated 2026-09-05T17:14:11Z). The deleted file for the retired specimen row is not in this commit and is not re-signed.
- **v9 `tree_head_hash` is the prefix that includes the receipt.** The signed root is the Merkle root of the log through this leaf, so an inclusion proof of size `leaf_index + 1` verifies against it. It is not `latestHead()` from before the append. A later published head verifies when its inclusion proof covers the leaf. Any other supplied root fails (`tree_head_mismatch`). A signature taken before the leaf was appended is restamped once the book row is indexed.
- **1F916 specimens stamped.** Specimen 1 is `foreign-x402-muq262x0-1467b076fc62` and Specimen 2 is `foreign-x402-muq264r9-69896464bb19`. `chit_verify_url` is `https://api.chit402.com/receipt/<id>`. The link verifier accepts that URL with or without `?format=json` and still rejects a different host or id.
- **Receipt lookup by tx.** `GET /receipt/by-tx` finds a stamped foreign-ingest row on the book when the task store has no match. The query accepts `base:<tx>`, a bare hash, case-insensitive hex, and optional `?chain=` (`base` or `eip155:8453`). It redirects to `/receipt/:id`, which serves that row's issuer JWS.
- **Principal book window refetch.** Changing the spend window does not show the previous window's KPI totals, and a failed or in-flight refetch does not clear the loaded book, budget draft, or policy form.
- **Principal book export windows.** The receipts-list Export CSV follows the selected window. Treasury advanced audit packs (CSV, JSON, HTML) stay the full history and do not send `from` / `to`. A budget save shares the book load generation, so a stale window refetch cannot overwrite it.
- **Null claim_id re-signs only when a book seat arrives.** A cached payment JWS with `payment.ref` and `claim_id: null` is re-signed once a book id exists, so `GET /receipt` before `writeSettleBookRow` cannot lock a signature that fails after `bookSpend`. A receipt with no book seat keeps its genesis JWS, including session acts. A JWS that already has `claim_id`, or that omits the key, is not rewritten. A seated signature is not replaced by a later build that has no seat.

### Added
- **Durable receipt log.** The Merkle log is an append-only journal under `.data/receipt-log` (fsync, atomic checkpoint). Boot recomputes every pinned epoch from the journal, including a non-empty journal, and refuses a mismatch with `receipt-log-pin.json` (epoch 1 `dd20e39a…` size 4, epoch 2 opening `f2043ee9…`). The committed pin stays authoritative when `RECEIPT_LOG_EXPECTED_EPOCH` / `RECEIPT_LOG_EXPECTED_ROOT` are set. Those vars can only add a stricter open-epoch root, and a conflict refuses boot. Epoch 2's opening prefix is checked at any tree size. Backfill refuses a row with `task_id` or `seq` and no `agent_id`. Epoch 1 is final: size 4, root `dd20e39a…`, genesis `422cceb1…`. Known Base and Solana anchor transactions are loaded by hash from `receipt-log-pin.json`. Epoch 1 and the epoch 2 opening must be journal heads. Orphans are checked on chain and are not journal heads. `ff950e72…` is Base-only. A null hash or a missing RPC result refuses boot. `anchor-state.json` is not that proof. Epoch records must be issuer-signed and pin epoch 1, including genesis `422cceb1…`. `d7f6c548` stays in the orphan list with `root: null` and `unrecoverable: true`. The gateway signs the Base anchor and fsyncs the raw transaction and its keccak hash before broadcast. Recovery uses `eth_getTransactionByHash` and `eth_getTransactionCount`. It adopts the intent only when the calldata root, sender, anchor `to` address, and receipt status all match. Any other mined nonce is `replaced` and is not sent again. An unsigned intent is `abandoned_unsigned` and that nonce is reused. A rejected broadcast is replaced at the same nonce instead of skipping to the next one. A transient error stays `blocked` and backs off. `eth_chainId` must be `0x2105` before boot finishes and before a broadcast. `RECEIPT_ANCHOR_FROM` is optional and must match the private key when both are set. Backfill refuses a forked book, a gap, a duplicate, and an empty `row_hash`, and the dry-run lists each refusal. Hourly S3 bundles are off until `RECEIPT_LOG_S3_BUCKET` is set. Each put reads the object lock back and fails unless it is `COMPLIANCE`. The bundle index is write-once per hour. Restore checks `bundle_index_hash` on an anchored signed head and the full recomputed root, not only the epoch prefixes. `/health` reports `receipt_log.last_bundle_ok_at`, `consecutive_failures`, `blocked_intents`, `pending_intents`, `oldest_blocked_age_s`, `last_anchored_root`, `last_anchored_tx`, `last_error`, and `stuck_pending_age_s`. A Base intent becomes anchored only after confirmAnchor fetches a status-1 receipt for that exact root, sender, and to, so already known and nonce too low stay broadcast, a missing block time is unconfirmed and looked up again, a mined receipt outside the clock bound is replaced so the next publish uses the next nonce, a mempool transaction older than ANCHOR_STUCK_MS (default 10 minutes) is replaced at the same nonce with a higher fee and the newest root unless ANCHOR_MAX_FEE_WEI blocks it as anchor_fee_cap, and reconcile marks every lower-fee raw superseded before broadcast. See [receipt-log.md](docs/product/receipt-log.md).
- **Canonical receipt object and pinned issuer history.** `GET /receipt/:id/preimage` and `GET /refusal/:id/preimage` return the exact JCS bytes stored at issuance. SHA-256 of that body is `payload_hash` inside the JWS. `X-Chit-Hash-Alg` is `sha256`. The object is not rebuilt on read. Per-field `/preimage/:field` stays. New payment receipts are payload version 10 and sign `issuer_history` (`hash`, `version`, `seq`) plus `payload_hash`. New refusals are payload version 2 and sign the same pair. Version 9 receipts and version 1 refusals still verify. Issuer history snapshots are append-only: `GET /.well-known/issuer-history.json?version=N` or `?hash=` serves the sealed bytes. `xfuel-verify` checks the pinned hash and reads `not_after` from that snapshot. **Gateway (Lightsail):** redeploy required. **@xfuel/verify:** npm publish required. No production deploy in this change. See [receipt-preimage.md](docs/product/receipt-preimage.md) and [issuer-key-history.md](docs/product/issuer-key-history.md).
- **Receipt check fixes.** Refusal verification passes the same trusted kids as a payment receipt, including the default production pin, so a valid refusal still verifies once issuer history is reachable. Refusal preimage links are `GET /refusal/:id/preimage`. Only the production kid defaults `not_before` to `2026-09-04T08:52:05Z`; another live key uses its history entry or `ISSUER_KEY_NOT_BEFORE`, and a missing date fails the window check closed.
- **Public receipt hash preimages.** `GET /receipt/:id?format=json` and `GET /refusal/:id?format=json` add an unsigned `preimages` block (`chit402.preimage.v1`). `GET /receipt/:id/preimage/:field` and `GET /refusal/:id/preimage/:field` return one field. Recomputable hashes: `book_chain.row_hash`, refusal `book_row.row_hash`, `inclusion.leaf`, `tree_head_hash` when every prefix leaf body is retained, `binding.expected_commitment` when it is non-null, the empty-set `coverage.universe_hash`, board `job_spec_hash`, and ERC-8004 `response_hash`. Canonicalization is UTF-8 pipe lines, `abi.encodePacked` + keccak256 for bindings, and RFC 6962 for the tree. JCS (RFC 8785) stays the offer-receipt and issuer-history form; existing signed hashes are not re-encoded. `output.hash` stays private. Non-empty coverage hashes stay off the public receipt because they cover possession-gated book rows. HMAC stays a keyed tag. `xfuel-verify` recomputes the published bytes and fails if a preimage is missing or mismatched. Old signatures and old receipt URLs still verify. **Gateway (Lightsail):** redeploy required. **@xfuel/verify:** npm publish required. See [receipt-preimage.md](docs/product/receipt-preimage.md).
- **Signed issuer key history.** `GET /.well-known/issuer-history.json` (`chit402.issuer_history.v1`) lists each `kid`, public JWK, `alg`, `not_before`, `not_after`, `status` (`active` / `retired` / `revoked`), `revoked_at`, `reason`, and a custody sentence. The private key is the base64 PEM in `ISSUER_PRIVATE_KEY`, not a cloud KMS. Entries chain by SHA-256 of JCS. The current issuer key signs `head_hash`. The production kid `IvFpmC-vPhkY_v0vidsrWVT9uzlE5XWKZgAEOeJTq1Q` has `not_before` `2026-09-04T08:52:05Z` (first ES256 receipt deployment; the earliest in-repo receipt for that kid is `2026-09-26T17:27:32Z`). `xfuel-verify` checks that `iat` is inside the kid's window and that the kid was not revoked before issuance. An unreachable history warns unless `--strict-issuer-history`. **Gateway (Lightsail):** redeploy required. See [issuer-key-history.md](docs/product/issuer-key-history.md).
- **Public spend audit:** `/audit` on the web app. Paste a Base wallet (no signup) and the page reads about seven days of USDC `Transfer` logs out of that address from `https://mainnet.base.org`, the same Base RPC receipt checks already use, then matches each transaction with public `GET /receipt/by-tx`. The report lists spend by counterparty, x402 only when a public Chit receipt or USDC `transferWithAuthorization` (`0xe3ee160e`) shows it, unreceipted transfers only on HTTP 404, and simple spikes and near-duplicate charges. CSV and JSON download. A failed or truncated scan withholds the total. Solana, possession-book rows, and spend caps are named as not read. See [docs/product/public-spend-audit.md](docs/product/public-spend-audit.md).
- **Signed refusal receipt.** `GET /refusal/:id` appends `Accept` to `Vary` (the CORS `Origin` value stays) and caches for 300s, so a shared cache cannot return HTML to a client that asked for JSON or reuse one origin's CORS headers for another. A policy or cap refusal (`policy_blocked`, including `budget_exhausted` and `approval_ttl_expired`) returns schema `chit402.refusal.v1` (payload version 1) in the response and at `GET /refusal/:refusal_id` (public, no auth, `?format=json`). The ES256 JWS uses the same issuer key as a payment receipt (`typ: chit402-refusal+jwt`); verify it against `/.well-known/jwks.json` or `xfuel-verify`. It signs `chain_id`, the Base anchor (block number, block hash, and `state_root` when the RPC returned one, or `status: UNAVAILABLE`), `refusal_code`, `nonce`, timestamp, agent/book id, requested amount when known, and the `policy_blocked` row's `seq`. `charged` is false and `amount_charged` is `"0"`. It proves the issuer refused, at that anchor, for that code. It does not prove a payment, that the block still stands after a reorg, or that the rule was the correct one. `UNAVAILABLE` means the issuer had no block. Payment receipt schemas and payload versions are unchanged. A 402 challenge, a failed settle, and a free-tier capacity response are not this document. `budget_exhausted` now also appends a `policy_blocked` row so the refusal joins the book; it still does not settle. Suggested by bankr_1d5b on 1F916 (https://1f916.ai/post/6645, comments c88181 and c89581). See [docs/product/refusal-receipt.md](docs/product/refusal-receipt.md).
- **Receipt payload v9 and single-use claim close.** New payment receipts sign `tree_head_hash` and `tolerance` (`base` 300, `solana` 150) inside the issuer JWS. `issuer_signature.payload_version` is 9. The HMAC array stays the v8 list, so `hmac_attestation.payload_version` stays 8. v8 receipts that omit the pair still verify. Verifiers (`xfuel-verify`, the receipt page, `verify-receipt.mjs`, and `readSignedHeadBinding` in the SDK) read the pair only from verified claims. An unsigned outer copy that disagrees fails (`head_binding_mismatch`). A v9 payload missing either key fails (`head_binding_missing`). A settlement `claim_id` closes once (`open` → `settled`). A second receipt returns `claim_already_settled`. The same task and payment ref returns the existing receipt. The book seat (claim_id equal to the agent id) stays reusable across spends. **Gateway (Lightsail):** redeploy required so new receipts are v9 and the close is enforced. See [VERIFY_ALGORITHM.md](docs/VERIFY_ALGORITHM.md) §3.3 and [receipt-merkle.md](docs/product/receipt-merkle.md).
- **1F916 payout stamp:** `services/gateway/scripts/stamp-foreign-payout.mjs` records an already-settled Base tx on the house book. It verifies the single USDC transfer with the foreign-ingest checker and spends a `STAMP_WAIVER_KEYS` slot. It does not broadcast a transaction. A tx already on the book is printed and skipped. Specimen 1 (listing 55, `0x909d738d79ff4c9885cd9ed0755636565ee3ddf0406ef6f454e7fbf797990ce9`) and Specimen 2 (listing 45, `0x233acdcf3d78436d63a0dba00092fb9a8fe806a3ecd1b415a4d364144baffebd`) stay without a `chit_receipt_id` until that command prints their `verify_url`. New rows also carry an issuer JWS (`chit402.foreign_payout.v1`) whose `payment` and `caller_binding` claims match the outer receipt, so the standard ECDSA verifier accepts them, and which also names the tx, chain, and the entry fingerprint when the operator stamp checked that hash on the public 1F916 record. The public ingest route does not sign a fingerprint from the request body. Older rows without that JWS still verify as recorded HMAC rows. Once `chit_receipt_id` is set, `scripts/verify-1f916-link.mjs` checks the issuer JWS against the Chit JWKS, `book_chain` v4, the Base transfer, and the 1F916 entry hash. Pending means the receipt id is absent.
- **1F916 link draft:** public schema for binding an Agent Record entry to a Chit receipt. `chit_receipt_id` is optional off money-moving entries and required when the entry asserts a payment; a money-moving entry without it is `unverified payment claim`, and the entry stays valid. The receipt field `agent_record_entry` is unsigned beside `book_seq` (`signed: false`, `registry: 1f916`, entry `fingerprint`). Issuance does not stamp it yet. Page: https://www.chit402.com/docs/1f916-link. Spec: `docs/integrations/1f916-link-v0.md`. Thread: https://1f916.ai/post/7404.
- **Principal dashboard KPIs:** `/book` shows Spend, Payments, Vendors paid, and Receipts verified for the selected window (default last 7 days). The book response adds `summary` over the full scoped set. An empty window is zeros, and the receipts list links the quickstart. **Export CSV** on that list calls the existing `GET /v1/agents/:agent_id/book/export?format=csv` with the same `from` / `to`. See `docs/product/principal-dashboard-v1.md`.
- **Receipt-lane boundary:** `receipt_lane` keeps its fields and adds `ordering` (`seq + settled_by + (anchor_changed AND not settled)`), `boundary` (`complete over registry marks, blind to payments the registry never joined`), `classification`, and `local_check`. A payout binding past expiry with `settled_by`, `receipt_id`, `observed_tx_hash`, and `observed_transfer_id` all null is `classification: unverifiable_from_registry`, not unpaid. A past-expiry binding with `settled_by: observed_transfer` stays settled. `local_check` is a Base USDC payee and amount (`claims_paid: false`) and does not read the chain. Payment and book-seq payload versions are unchanged. Design by Turbo on 1F916 (post 6579, comment 88596). See `docs/product/receipt-lane.md`.
- **Settlement claim_id:** the payment JWS (payload version stays 8) signs `claim_id`, the book `agent_id`. The v8 HMAC array is unchanged. A receipt that includes the key, has `payment.ref`, and has `claim_id` null fails verification. Older v8 receipts that omit the key still verify (`claim_id: not_present_legacy`). The receipt is signed after the book id exists. Book-seq payload version 4 signs `payment_ref` with `book_id` for foreign ingest, Nano, and board stamp rows, which have no payment JWS. Versions 2 and 3 still verify. The ingest stamp tx is its own book row (`ingest_stamp`), not prepaid spend. Suggested by @ellie-v2 on 1F916 (https://1f916.ai/post/7347#comment-88218).
- **Receipt lane:** unsigned `receipt_lane` (`chit402.receipt_lane.v1`) beside `book_seq` on the receipt JSON, book row, audit export, verify page, and `xfuel-verify`. `settled_by` is `observed_transfer` or `receipt` (null when unknown). `anchor_changed_since_binding` is true when a later tree head differs from the head that first covered the leaf. `freeze` is true only when seq is set, `settled_by` is `receipt`, the anchor changed, and the row is not settled. An anchor change alone does not freeze. The lane object is unsigned, so it does not rewrite the payment JWS or an existing book-seq signature. Design by Turbo on 1F916 (post 6579, comments 88201 and 88403). See `docs/product/receipt-lane.md`.
- **Supersession fork detector:** verify receipts and `GET .../book/gaps` carry an unsigned `supersession` object (`chit402.supersession.v1`). `status` is `none`, `linear`, or `forked`. `authoritative` is set only when exactly one successor matches the subject. Two successors are `forked` with `authoritative: null`. Seq and time do not elect a tip, and a gapless `book_seq` does not hide the fork. The payment JWS and signed `book_chain` are unchanged. Suggested by verdigris on 1F916 (https://1f916.ai/post/6396#comment-88320). See `docs/product/supersession-fork.md`.
- **Receipt anchor clock tolerance:** signed tree heads include `clock_tolerance_s` (`base` 300s, `solana` 150s) beside `anchors`. `payload_version` stays 1, so a head signed before the claim still verifies. If an anchor block time falls outside the bound, that side stays `pending` (`anchor_clock_drift`) instead of claiming `anchored`. `verify-receipt.mjs --rpc` checks `|published_at - block_ts|` and refuses a receipt timestamped after the head plus the tolerance. Without `--rpc` the check is skipped, not passed. No new environment variable. Suggested by @ellie-v2 on 1F916. See `docs/product/receipt-merkle.md`.
- **Solana receipt-root anchor:** the daily Merkle root is also posted to Solana mainnet-beta as an SPL Memo (`chit402:root:v1:<scope>:<yyyy-mm-dd>:<root>:<prev>`), signed by `SOLANA_ANCHOR_SECRET_KEY` from the host environment. The tree head records `anchors.solana` (`signature`, `slot`, `cluster`, `memo`) next to `anchors.base`. Unset env or a failed send stays pending. A day already anchored is not sent again. `chit402-verify --rpc` checks inclusion, the memo, and the Base calldata. See `docs/product/receipt-merkle.md`.
- **Verified bid board:** `POST /v1/board/jobs` opens a job (stamp, budget max $25). Other agents bid, the poster awards one bid, and the winner commits `output_sha256` before payment. Pay is two x402 legs: the bid price to the winner's wallet, then the $0.002 stamp plus 1% to the Chit treasury. One signed receipt is issued only after both legs settle. It binds payer wallet, payment ref, amount, winner, and `output_commitment`, and it is written on both books. The job page leads with that receipt. `POST /v1/board/inbound/completions` lets an external board (Daydreams, agent.market) submit a completion and receive the same receipt. See `docs/BOARD_INBOUND.md`.
- **Correction authority:** correction and successor rows sign `authority` (`subject_handle` or `subject_wallet`, `writer: gateway`, `issuer: chit402`) inside `book_chain` payload version 3. A plain spend row has no authority. The payment JWS is unchanged. See `docs/product/correction-authority.md`.
- **Row act:** each book row has `act` (`open`, `spend`, `transfer`, `refund`, `correction`, `refusal`) inside the signed `book_chain` at payload version 2. The payment JWS is unchanged. See `docs/product/book-act.md`.
- **Verifier source digest:** `packages/verify` publishes `BUILD_DIGEST.txt` from `npm run digest` (SHA-256 of sorted `src/**/*.ts`, not a `tsc` binary). The Merkle genesis leaf copies it as `verifier_binary_build_digest`. See `docs/product/verifier-digest.md`.
- **Receipt tree anchor send:** when `RECEIPT_ANCHOR_PRIVATE_KEY` and `BASE_RPC_URL` are set, a published tree head sends a zero-value Base transaction whose calldata is the root. A missing key or a failed send leaves `anchor_status: pending`. No key is committed.
- **Receipt Merkle tree:** append-only RFC 6962-style tree over receipt leaves. `GET /v1/receipts/tree/head`, `GET /v1/receipts/:task_id/inclusion`, and `GET /v1/receipts/tree/consistency` are public. A signed head is published on the first append of each UTC day. The Base anchor stays `pending` until `RECEIPT_ANCHOR_PRIVATE_KEY` is set. The verify page says `pending anchor` or names the Base tx. See `docs/product/receipt-merkle.md`.
- **Refusal anchor:** a `policy_blocked` row signs the Base chain id, block number, and block hash observed at clamp time (`anchor` inside `book_chain`). If the RPC is missing or fails, `anchor.status` is `UNAVAILABLE` and the refusal is still recorded. See `docs/product/refusal-anchor.md`.
- **Book seq:** each book row gets a monotonic `seq`, `prev_hash`, and `row_hash`, signed as `chit402.book_seq.v1` (`book_chain`). Idempotent replays do not take a seq. `POST .../book/inflow/correct` appends a new correction row that does. `GET /v1/agents/:agent_id/book/gaps` reports missing numbers. The payment JWS is unchanged. See `docs/product/book-seq.md`.
- **Export coverage:** book views and CSV, JSON, and HTML exports carry a signed `chit402.export_coverage.v1` object (`enumerated_count`, query `scope`, `universe_hash`). A finished empty scan is `empty_by_policy` (empty-set hash). An unfinished scan is `empty_by_drain` (`universe_hash` null). A short limit is `truncated`. The spend receipt JWS is unchanged. The verify page and `/book` show the commitment. See `docs/product/export-coverage.md`.
- **Surplus x402 receipt demo:** `examples/surplus-x402` pays a Surplus Intelligence endpoint with `@x402/fetch`, decodes `PAYMENT-RESPONSE`, and stamps `POST /v1/agents/:agent_id/book/ingest`. Caps refuse before any signature: 0.05 USDC on the Surplus payment, 2000 atomic USDC on the Chit stamp. `npm run list-endpoints` prints `/.well-known/x402` with prices. Keys stay in the environment.
- **EmDash stamp fee:** `chit402-emdash` signs the $0.002 ingest stamp and retries once when `signer` is a viem account, an `xfuel-sdk` payer, or `CHIT_STAMP_PRIVATE_KEY`. No signer still serves the page and logs one startup warning.
- **EmDash paid-read receipts:** `packages/emdash-chit402` (`chit402-emdash`) wraps `@emdash-cms/x402` `enforce()`. A paid agent read posts payer, page, price, network, settlement tx, and an optional content hash to `POST /v1/agents/:agent_id/book/ingest` and sets `X-Chit-Receipt` to `verify_url`. The standard stamp is $0.002 USDC. A slow or failed stamp is logged and does not fail the page.
- **Model alias table:** `MODEL_ALIAS_TABLE` maps common OpenAI and Anthropic chat names (and dated snapshots) onto live `gpt-oss` rows. Longest match wins; a leading `openai/` or `anthropic/` is stripped. Bare `gpt` and `openai` follow `xfuel/auto`. `GET /v1/models` publishes `aliases`, `alias_patterns`, and a per-model `aliases` array. Receipts keep `route.model` as the row that served and add `requested_model` for the name the caller sent. Nothing in the table points at OpenRouter.
- **Alias disclosure and strict mode:** when a table name is served as a different id, the 402 and the paid response set `X-Chit-Requested-Model`, `X-Chit-Served-Model`, and `X-Chit-Model-Substituted: true` (exposed for CORS). Non-streaming completions include a `chit` object. Receipts add `substituted`. `X-Chit-Strict-Model: true` or `chit_strict_model: true` disables the table and returns 400 `model_not_routable` before any charge. `GET /v1/models` publishes `substitution_policy`. Exact `openrouter/*` catalog ids are never flagged substituted. OpenRouter Broadcast receipts keep the reported generation model as the exact row and are never flagged substituted.
- **OpenRouter, bring your own key:** `openrouter/<vendor>/<model>` is advertised from the public model list. The caller sends `X-OpenRouter-Key` (or `Authorization` on an `openrouter/*` route). Chit forwards that key, does not store or log it, and charges only the $0.002 receipt. The receipt records provider `openrouter`, the served model, usage, and OpenRouter's reported cost labelled `paid-by-caller-to-OpenRouter`. House-key resale (`OPENROUTER_API_KEY`, cost-plus) requires `OPENROUTER_HOUSE_RESALE_ENABLED=true` (default off); while it is off, familiar names do not point at OpenRouter. A named `openrouter/*` call with no key is `400 openrouter_key_required` before verify/settle. Every OpenRouter chat request sends a stable hashed `user`, plus `HTTP-Referer: https://chit402.com`, `X-OpenRouter-Title: Chit402` (and `X-Title`), and `X-OpenRouter-Categories: cloud-agent`. `X-OpenRouter-App-Visibility` is not sent. After a completion, `GET /generation?id=` may record `total_cost` and `upstream_inference_cost` without blocking the response.
- **Agent skill `chit402-cite-1f916`:** pay Chit402 over x402 and cite `task_id`, `verify_url`, `payment_ref`, `output_hash`, and `receipt_sha256` on a 1F916 submission. The receipt proves spend, not acceptance. Canonical host is `api.chit402.com`.
- **Nano (XNO) foreign ingest:** `POST /v1/agents/:agent_id/book/ingest` accepts a cemented mainnet send (block hash, recipient, raw amount, description). Two public RPCs must agree the block is a confirmed send and that `block_info.amount` matches the balance delta. Receipts carry `chain=nano`, raw and XNO amounts, a Kraken NANOUSD figure labeled `estimate`, and a block explorer link. Dedupe key is the block hash.
- **ECDSA issuer signature on receipts:** Receipts now include an ES256 (P-256) public-key signature in `issuer_signature` that downstream agents can verify against the published JWKS at `GET /.well-known/jwks.json`. HMAC signatures remain for backward compatibility. SDK exports `verifyReceiptEcdsa()` and `verifyReceiptEcdsaWithJwks()` for verification. See `docs/VERIFY_ALGORITHM.md` §10.
- **x402scan listing:** `GET /openapi.json` (OpenAPI 3.1 with `info.x-guidance`, `x-payment-info`, `responses.402`). Public door is `POST /v1/chat/completions`; `POST /task-request` is second. Unauth `POST /v1/chat/completions` with `{}` returns 402 before body validation. Demo key `xfuel-demo` still skips payment. Runtime 402 amounts stay `"10000"`.

### Fixed
- **Gateway test runner:** `npm test` runs files one at a time. Parallel `--test-force-exit` was exiting before `receipt.test.mjs` finished its remaining tests and still reporting success, so the summary count moved (1144, 1145, 1132) without any test file being deleted.
- **OpenRouter BYOK receipt facts:** the receipt records OpenRouter's `gen-…` id as `openrouter.generation_id` and `X-OpenRouter-Generation-Id` (the gateway `chatcmpl-` id is not a generation id). `route.model` is the model OpenRouter served; `requested_model` stays the name the caller sent. An exact `openrouter/*` id stays `substituted: false` even when that served string differs. `reported_cost_usd` is a plain decimal. Those facts are inside the signed JWS. `GET /receipt/:id?format=json` includes `settlement_status`, `idempotent_replay`, `replay_of`, and the public `payment`, `route`, and `usage_settled` blocks.
- **First paid call settlement label:** `POST /v1/chat/completions` reports `settlement_status: settled` on the call that collected the payment. `idempotent_replay` / `replay_of` are only for a later resubmit of the same `payment.ref`. The settle-time book row is not a replay of itself.
- **Auditor `in_policy`:** a normal paid receipt whose fee and rail checks pass is `in_policy: true`. Missing principal binding and missing privacy mode are `checks.*: "no_policy"`, not a policy failure. `in_policy: false` is a real miss only.

### Changed
- **Ingest stamp is $0.002:** `STAMP_FEE_UNITS` is 2000 (USDC, 6 decimals), paid by the submitter via x402 on Base or Solana. The stamp no longer debits prepaid budget (that debit plus the ingested spend reduced remaining twice). `GET /.well-known/x402` publishes `pricing.stamp_fee_usd`. Pilot waiver `STAMP_WAIVER_KEYS` / `STAMP_WAIVER_CAP` is off unless set.
- **Docs merge lean:** `DEMO` → `HOSTED_TESTNET_ENDPOINT`; `BASE_CUTOVER` → `RUNTIME_STATE`; `ZKG5_BENCHMARK` → `VERIFIED_INFERENCE_HANDOFF` (thin redirect stubs left at old paths).
- **Aggressive docs lean (single narrative):** archived phase kickoffs, engagement/treasury fluff, grant-audit duplicates, zkGPT research memos, pointer stubs, and phase JSON reports → `docs/_archive/legacy-narrative/`. `docs/README.md` is a clean hub only. Kept technical truth (RUNTIME_STATE, APIs, ADRs, VI, audit readiness).
- **Repo docs → Theta-style GitHub README shape:** `README.md`, `WHITEPAPER.md`, and `docs/README.md` rewritten with opening prose, TOC, `---` section breaks, labeled `bash` fences, and human-readable link text (so GitHub render matches a modern protocol README — not raw editor view).
- **Docs archive (approved):** gateway status dumps → `docs/_archive/legacy-gateway-ops/`; superseded design dumps → `docs/_archive/legacy-design-dumps/`.
- **Docs formatting pass (continued):** ops (`RUNTIME_STATE`, `DEPLOYMENT`, `TESTING`, `DEMO`, `HOSTED_TESTNET`, `BASE_CUTOVER`), security (`bug-bounty`, `SECURITY`, `AUDIT_READINESS`, `security-design`, `LEGAL_LAUNCH`), fundraising, ADRs 0001–0004, Verified Inference front doors (`VERIFIED_INFERENCE_*`, Tier-3 build spec), package READMEs (SDK/MCP/agent-skills/playbook), and service READMEs (gateway/sp1/zkllm/zkgpt). Same sparse contract: plain headings, short paragraphs, link lists; Base + token-light narrative; Tier-3 = zkLLM active build.
- **Docs formatting + lean pass (Theta-sparse):** plain headings, short paragraphs, link lists over badge/table walls. Slimmed `CIRCUITS.md`, `Technical-Specifications.md`, `M2M_API.md`, `OPENAI_COMPATIBLE_GATEWAY.md`, `X402_ADAPTER.md`, `POSITIONING.md`, and `pitch-deck.md`. Archived `Circuit-Design-and-Expansion.md`, obsolete `QUICK_REFERENCE.md`, and outdated `docs/grants/*` decks under `docs/_archive/`.
- **Theta-style lean docs restructure:** `README.md`, `WHITEPAPER.md`, `AGENTS.md`, and `docs/README.md` rewritten as short front doors that point to satellite docs (RUNTIME_STATE, POSITIONING, M2M_API, CIRCUITS, etc.). Removed duplicated architecture essays, deployment tables, mermaid diagrams, and circuit/use-case catalogs from the canonical surfaces — depth lives in `docs/`.
- **Follow-up accuracy sweep (UI + live API + archive):**
  - **Gateway** (`services/gateway/src/server.js`, `revenue-split.js`) — removed hardcoded `30% BBB / 30% LP / 25% veXF / 15% Treasury` from `/health`, `/prove-result`, and `/task-request` fee_info; now returns `describeSplit(resolveSplit())` (token-light USDC on Base).
  - **Frontend** — `Dashboard.tsx` no longer reads `CoreRevenueSplitter`; `Security.tsx` reframed to Base verifier + equity-first fundraising; `Staking.tsx` retitled from Fee-to-Stake to governance staking; `Docs.tsx` badges → v2.6 / Base / 755+.
  - **SDK + agent skill** — `revenue_split` type matches `describeSplit()`; submit-inference skill notes updated.
  - **Archived** to `docs/_archive/`: `Growth-Expansion-Treasury.md`, `FUNDING_ROUNDS_LAUNCH_RUNBOOK.md`, `PRICING_TFUEL_XF.md`, `THETA_INTEGRATION_PLAN.md` (see `docs/_archive/README.md`).
  - **CONTRIBUTING.md / SECURITY.md** — Base-settled framing; removed CoreRevenueSplitter from bounty in-scope; version → v2.6.
- **Docs de-legacy sweep — canonical docs now describe the project as-is (top-project shape).** Removed legacy machinery from the narrative entirely (history remains in git):
  - **`WHITEPAPER.md`** — replaced §5 (GET / Fee-to-Stake / `CoreRevenueSplitter` 30/30/25/15) with a tight token-light "Revenue & Fees" section; removed all `CoreRevenueSplitter`/`RevenueSplitter` references (§2 note, §6 governance hooks, §7.2, §9.1); dropped believer/angel sale mechanics from §10 tokenomics and §11.5 audit scope; replaced the §12 Phase 1–6 completion log with a forward-only "Now → next / Later" roadmap; removed ThetaScan/believer-metrics mentions.
  - **`README.md`** — full lean rewrite toward a top-project shape (~11 tight sections): what it is, trust tiers, quick start, how it works, architecture, providers/chains, current deployment status, repo map, testing, security, community. Cut the phase-by-phase deployment log, "Verifier Patches," standalone CosmWasm/EVM/Solana prover test-count sections, the "AI DePIN Hub / Why Theta First" section, and legacy `.env` vars.
  - **`AGENTS.md`** — cut the retired BelieverRound/AngelRound/engagement fundraising blocks (one-line equity-first note remains), removed `CoreRevenueSplitter` refs, fixed the A2A escrow example (USDC/x402 + Fair Exchange, not `CoreRevenueSplitter.createEscrow`), updated the governance table (TreasuryPolicy), and reframed Tier-3 to the self-owned zkLLM prover.
  - **`docs/README.md`** — core-contract list no longer lists deprecated `CoreRevenueSplitter`.
- **Narrative alignment to locked core story (Base-settled, provider-agnostic, tiered-trust).** Aligned high-visibility surfaces to the locked positioning (`docs/POSITIONING.md`, ADR 0002) with zero change to technical facts, addresses, or test counts:
  - **`WHITEPAPER.md` → v2.6** — reconciled Tier-3 from "zkGPT (blocked on GPU)" to the self-owned **XFuel zkLLM** prover (`services/zkllm-prover`, RAM-bound/CPU-only, active build); zkGPT retained as cited prior art. Updated §3.5 tier table, §3.6 research track, §11.1, roadmap, and references.
  - **`README.md`** — version refs v2.4→v2.6, "As of March 2026"→July 2026, added locked one-liner summary, replaced the 30/30/25/15 fee-flow and "All fees route through CoreRevenueSplitter" with the token-light USDC-on-Base model, and reframed the DePIN-hub / "Why Theta First" section (neocloud-first router; EdgeCloud = optional GPU provider tier, not settlement home).
  - **`apps/web/src/pages/Home.tsx`** — synced to `POSITIONING.md`: removed the "30% BBB · 30% GET · 25% veXF · 15% treasury — settled on Theta" card, made USDC-on-Base the default rail (TFUEL demoted to legacy), added Base/Base Sepolia to the networks list, and set the settlement framing to Base.
  - **`docs/README.md`** — v2.4/"Hybrid Theta-Centric" → v2.6/"Base-Settled, Provider-Agnostic"; added a one-line positioning summary; date → July 2026.
- **Core tests:** Split `test:contracts:core` into `test:contracts:core:listener` (`node:test`, `ai-listener.test.js`) and `test:contracts:core:solidity` (Hardhat `*.test.cjs` only). `ci.yml` runs them as separate steps; `test.yml` gas job uses `:solidity` only.
- **`test:contracts:all`:** Runs the core listener first, then `test:contracts:all:hardhat` via `scripts/hardhat-test-all.cjs` (collects every `test/**/*.test.cjs`, `core-layer/test/*.cjs`, `circuits/*/test/*.cjs` without shell globs — fixes Windows). `test.yml` uses two explicit steps matching that split.
- **`theta-inference-handler.test.cjs`:** Wrapped the runner in `require.main === module` so Hardhat no longer exits the whole process on `require()` (same class of bug as fee-analytics tokenomics tests).

### Planned
- Audit Phase 1 — `contracts/core/` on Base (see `docs/AUDIT_READINESS_CHECKLIST.md`)
- Base mainnet x402 facilitator provisioning
- SP1 guest v2 (in-proof payment binding)
- Tier-3 on-chain verify + E2E (zkLLM)
- veXFGovernance first on-chain proposal (when token launches)

---

## [2.4.0] — 2026-03-11

### Added
- `docs/THETA_INTEGRATION_PLAN.md` — comprehensive 62KB Theta ecosystem integration plan covering EdgeStore, Video API, TDROP payments, and subchain deployment
- `.github/workflows/test.yml` — secondary CI workflow running Solidity (`test:contracts:all`) and CosmWasm (`cargo test`) jobs
- `.env.deploy.example` — fully documented deployment environment template with all 40+ variables explained
- `.solcover.cjs` — Solidity coverage configuration skipping `legacy/`, `mocks/`, `test-helpers/`
- `.hyperlane/chains.yaml` — Hyperlane chain definitions for Theta Mainnet (361), Theta Testnet (365), Bittensor Testnet (945), and Bittensor EVM (964)
- `SECURITY.md` — vulnerability disclosure policy with contact, scope, and bug bounty tiers
- `CODE_OF_CONDUCT.md` — Contributor Covenant v2.1
- `CHANGELOG.md` — this file
- `.github/dependabot.yml` — automated dependency scanning for npm (root, bridge, mobile, sdk) and Cargo
- `.github/ISSUE_TEMPLATE/` — structured issue templates: bug report, feature request, question
- `.github/PULL_REQUEST_TEMPLATE.md` — PR checklist with gas impact table
- `docs/GAP_ANALYSIS.md` — pre-submission gap analysis and sprint plan for CertiK + Theta grant
- Cargo workspace members: `core-layer/wasm/zk-verifier`, `core-layer/wasm/revenue-splitter`, `core-layer/sp1-hooks`

### Changed
- `README.md` — full rewrite for v2.4 "Hybrid Theta-Centric Architecture"; added Table of Contents, Mermaid architecture overview, agent-first API examples
- `CONTRIBUTING.md` — updated all contract references to `contracts/core/` and `contracts/circuits/`; updated status to "All 6 phases complete (755+ tests)"
- `.cursorrules` — added Theta ETH-RPC quirks, EdgeCloud API key types, Hyperlane CLI reference, Bittensor EVM chain IDs
- `.gitignore` — added `*.pdb`, `sp1-source/`, `*.bin` (with `!src/**/*.bin` exception)

---

## [2.3.0] — 2026-02-28

### Added
- Phase 6 — Ecosystem Expansion: `contracts/circuits/` additions (AgentRobotics, AutonomousVaults, EnergyGrid, FilecoinStorage, MappingSensor, NearAgents, WirelessDePIN)
- `test/phase6/EcosystemExpansion.test.cjs` — Phase 6 test suite
- `tests/ai-depin/e2e.test.js` — Node `--test` AI/DePIN ecosystem integration tests
- `tests/security/fuzz.test.js` — 40KB fuzz test suite (Node `--test`)
- `docs/phase6-report.json` — Phase 6 completion report
- Coverage HTML report at `coverage/` (85%+ on Phase 1 audit contracts)

### Changed
- Upgraded `@openzeppelin/contracts` and `@openzeppelin/contracts-upgradeable` to v5.4.0

---

## [2.2.0] — 2026-02-14

### Added
- Phase 5 — Privacy & Agent Swarms: `contracts/circuits/A2ACircuit.sol`, `AgentRobotics.sol`
- `test/phase5/` — AgentSwarms, CrossChainExpansion, PrivacyMarkets test suites
- Phase 5 completion report (`docs/phase5-report.json`)
- `backend/theta-bridge/src/theta-video-handler.js` — Theta Video API integration (upload, transcode, DRM)
- TDROP payment option: `ThetaInferenceCircuit.setTdropConfig()` — 20% fee discount for TDROP payers

### Fixed
- ZKVerifierSP1: proof replay attack prevention via `usedProofHashes` mapping
- CoreRevenueSplitter: reentrancy guard on `distributeFees()` for ERC-20 payment paths

---

## [2.1.0] — 2026-02-01

### Added
- Phase 4 — Intelligence Layer: `contracts/circuits/ZKMLCircuit.sol`, `InferenceRouter.sol`
- `test/phase4/` — CoreListener, ZKRollup, TVL simulation, x402 Escrow, SubchainDeploy, MonitoringDashboard
- `monitoring/` — Prometheus + Grafana docker-compose stack for fee analytics
- `backend/theta-bridge/src/fee-analytics.js` — 59KB fee analytics engine with Prometheus metrics
- `dashboard/index.html` — standalone 26KB live dashboard with failure prediction and gas profiles
- `contracts/core/veXFGovernance.sol` — vote-escrowed governance with 4-week lock minimum
- Theta subchain governance: `contracts/governance/XFuelSubchainGovToken.sol`
- `test/hardening/LoadChaos.hardening.test.cjs` — load and chaos stress testing

### Changed
- `contracts/core/CoreRevenueSplitter.sol` — added `dynamicBoost` multiplier for TDROP payers and circuit priority weights

---

## [2.0.0] — 2026-01-15

### Breaking Changes
- Architecture pivot: from "ZK bridge between Theta and Persistence" to "Theta-hybrid AI DePIN Hub"
- `VaultFactory.sol` → deprecated in favor of modular Core Layer + Circuit pattern
- Persistence-primary routing → Theta EdgeCloud-primary with optional Osmosis/Persistence fallback

### Added
- **Core Layer** (`contracts/core/`): ZKVerifierSP1, CoreRevenueSplitter, SP1ProofHooks
- **21 Circuit Contracts** (`contracts/circuits/`): ThetaInferenceCircuit, TAOCircuit, BridgeCircuit, AkashCircuit, YieldCircuit, DataHubs, UplinkCircuit, ComputeMarketplace, SolanaAIBridge, BelieverRound, and 11 more
- SP1 v6.0.2 integration: `sp1-prover/` Rust workspace (host + program) generating real Groth16 proofs
- `core-layer/wasm/zk-verifier/` — CosmWasm ark-groth16 verifier for Cosmos chains
- `core-layer/wasm/revenue-splitter/` — CosmWasm revenue splitter
- `contracts/interfaces/` — IBittensorStaking, ICrossChainMailbox, IChainlinkOracle, IHyperlaneMailbox, ISP1Verifier
- Hyperlane integration: `.hyperlane/` config, `ICrossChainMailbox` interface on core contracts
- `sdk/js/` — TypeScript SDK (`xfuel-sdk`) for M2M/A2A API integration
- `edgefarm-mobile/` — Expo React Native mobile app
- Phase 1–3 test suites: 755+ total tests across Solidity, CosmWasm, and integration
- `docs/security-design.md` (35KB), `docs/routing-mitigations-design.md` (50KB)
- `docs/certik-phase1-scope.json` — formal CertiK audit scope definition
- `.openzeppelin/` — UUPS proxy upgrade manifests for chains 361 and 365

### Removed
- Persistence-specific governance contracts (moved to `contracts/legacy/`)
- `VaultFactory.sol` as primary contract (moved to `contracts/legacy/`)
- `WHITEPAPER_v4.4.md` — replaced by `WHITEPAPER.md`

---

## [1.6.0] — 2025-11-20

### Added
- Phase B completion: 8.997s avg SP1 proof generation, 52.89 tx/min throughput benchmarks
- Bi-directional bridge: `burn_for_unwrap` + `unwrapFromBurn` with SP1 event proofs
- `FeeCollector.wasm` — CosmWasm fee collection on Persistence chain
- Nonce-based replay protection across bridge flows
- `MOCK_MODE` testing flag for CI environments without live ZK proving

### Changed
- Revenue split finalized: 30% Buyback & Burn / 30% Growth & Expansion / 25% Stakers / 15% Treasury
- SP1 zkVM upgraded from STARK-only to STARK → Groth16 wrapper (reduces on-chain verification gas by ~40%)

---

## [1.5.0] — 2025-10-08

### Added
- Osmosis strategic pivot: primary routing target changed from Persistence to Osmosis ($2B+ TVL, 30-50%+ APY AI yield pools)
- Akash IBC integration: TFUEL → AKT for decentralized GPU compute bids/leases
- Bittensor (TAO) routing: ML inference to optimal subnets via Substrate/EVM bridge
- Phase E design: AI DePIN Bridge with ZK-verifiable A2A/M2M communications

---

## [1.4.0] — 2025-09-01

### Added
- SP1 zkVM integration: RISC-V → STARK → Groth16 wrapper proof pipeline
- Phase A completion: CosmWasm contracts deployed on Persistence testnet
- `cosmwasm-contracts/persistence-minter/` and `fee-collector/` with compiled `.wasm` artifacts
- Initial Theta Mainnet beta deployment: VaultFactory at `0xB0a26600074dADC69186632a1B8dFd7c3146Ce56` (chain 361)

---

## [1.0.0] — 2025-07-15

### Added
- Initial protocol design: ZK bridge between Theta (TFUEL) and Persistence LSTfi ecosystem
- `VaultFactory.sol` — initial bridge vault factory contract
- `sp1-prover/` — initial SP1 zkVM proof infrastructure
- Whitepaper v1.0 — ZK bridge architecture
- React frontend at `xfuel.app`
- Hardhat test framework with local chain 1337 configuration

---

[Unreleased]: https://github.com/XFuel-Lab/xfuel-protocol/compare/v2.4.0...HEAD
[2.4.0]: https://github.com/XFuel-Lab/xfuel-protocol/compare/v2.3.0...v2.4.0
[2.3.0]: https://github.com/XFuel-Lab/xfuel-protocol/compare/v2.2.0...v2.3.0
[2.2.0]: https://github.com/XFuel-Lab/xfuel-protocol/compare/v2.1.0...v2.2.0
[2.1.0]: https://github.com/XFuel-Lab/xfuel-protocol/compare/v2.0.0...v2.1.0
[2.0.0]: https://github.com/XFuel-Lab/xfuel-protocol/compare/v1.6.0...v2.0.0
[1.6.0]: https://github.com/XFuel-Lab/xfuel-protocol/compare/v1.5.0...v1.6.0
[1.5.0]: https://github.com/XFuel-Lab/xfuel-protocol/compare/v1.4.0...v1.5.0
[1.4.0]: https://github.com/XFuel-Lab/xfuel-protocol/compare/v1.0.0...v1.4.0
[1.0.0]: https://github.com/XFuel-Lab/xfuel-protocol/releases/tag/v1.0.0
