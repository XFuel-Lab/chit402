# Changelog — @xfuel/verify

All notable changes to the Chit402 offline verifier are documented here. This project adheres to
[Semantic Versioning](https://semver.org/).

## 0.4.8 — Issuer JWS slot typing

### Changed
- **Each issuer-JWS slot checks its `typ`.** `verifyIssuerJws(jws, jwk, { expectTyp })` takes the accepted typ set for the slot; any other typ is `typ_mismatch`. Receipts accept `chit402-receipt+jwt`, plus the earlier `JWT` typ and a header with no typ. Tree heads, epochs, issuer history, refusals, freeze control records and anchor-wallet documents each accept only their own typ. The sets are exported as `ISSUER_JWS_TYP`. Calls without `expectTyp` behave as in 0.4.7.
- **A receipt signature must cover the receipt.** `verifyReceipt` (and `verifyReceiptUpToV10`) reports `verified` only when the signed payload is a receipt object whose `task_id` equals the receipt's `task_id`, and whose `payment` block is present whenever the outer document has one. A signed tree-head, epoch, history or other non-receipt schema is `failed`.

### Tests
- Cross-typ JWS in the receipt slot is `failed` in the library and exit 1 `INVALID` in the CLI.
- Issued receipts of payload v5, v6, v7, v8, v9, v10 and a v10 foreign payout keep their 0.4.7 verdicts. `BUILD_DIGEST.txt` moved because the verifier sources changed. Not published. No deploy.

## 0.4.7 — Public attestation fail-closed edges

### Changed
- **The signed epoch must be confirmed.** With a public attestation, a log that serves no epoch on either the inclusion or the head is exit 2 `log_epoch_mismatch`. Before, the signed epoch went unchecked in that case.
- **A removed log is exit 2.** A Base receipt that carries any log with `removed: true` (a reorg in flight) is `payer_unchecked`, exit 2. It is never a pass.
- **Copy.** The `VERIFIED_PUBLIC` scope reads "settled amount": only the settled amount is checked on chain.

### Tests
- The on-chain check now covers a wrong chainId, 11 against 12 confirmations, a relayer `tx.from` against the token sender, one payee Transfer plus a non-payee Transfer (passes), and a removed log.

## 0.4.6 — Public receipt attestation, VERIFIED_PUBLIC

### Added
- **`VERIFIED_PUBLIC`, exit 0.** A public shell with a `public_attestation` JWS is checked on its own path. The scope is the signed public fields: amount, payee, tx, and log position. The payer and fulfillment are not claimed; the verdict says `payer: not_claimed` and shows the on-chain sender, truncated, as a chain fact. The link from the receipt id to the log leaf rests on the issuer signature. Base only.
- **Tagged, non-JSON payload.** `chit402.public_receipt.v1` plus a newline, then RFC 8785 canonical claims. typ `chit402-public-receipt+jwt`. The claims are an exact allowlist; `payload_version` and `v` are not allowed. Non-canonical bytes are exit 1 `invalid_jws`. Each published verifier from 0.3.0 to 0.4.5 rejects the payload.
- **Key trust.** The kid must be a verified issuer-history entry whose JWK thumbprint is the kid, active and never revoked at the start and the end of the `attested_at` minute. An untrusted kid is exit 1 `key untrusted`. A key outside its window is exit 1 `key_window`.
- **Subject and leaf binding.** The requested id and every outer shell field must equal the signed value (exit 1 `claim_mismatch`). The fresh proof is checked for the signed leaf hash at the signed index (`verifyAnchoredRoot` option `signedLeaf`). A different leaf is exit 1 `leaf_not_bound`, a different index exit 1 `leaf_index_mismatch`, a different epoch exit 2 `log_epoch_mismatch`.
- **On-chain check.** Chain 8453, status 1, 12 blocks deep, and exactly one USDC Transfer to the signed payee for the signed settled amount. Zero or two is exit 1 `transfer_mismatch`. An RPC that does not answer or returns null is exit 2.
- A pending attestation is exit 2 `public_attestation_pending`. A present but malformed or invalid attestation is exit 1; it never falls back to `signed_receipt_unavailable`.

### Security
- **`verifyIssuerJws` refuses typ `chit402-public-receipt+jwt`** (`typ_mismatch`), so an attestation cannot verify as a receipt, tree head, epoch, refusal, or history document.
- Old receipts and holder documents verify as in 0.4.5. A holder JWS that does not verify never consults the attestation. `BUILD_DIGEST.txt` moved because the verifier sources changed. The pinned epoch genesis digests did not. Not published. No deploy.

### Changed
- `@xfuel/verify` 0.4.6 depends on exactly `"chit402-verify": "0.4.6"`. `--version` prints `chit402-verify 0.4.6`.

## 0.4.5 — Signed ids, unsigned row hash, claim mismatch

### Security
- **Verdict ids come from the signed task id.** `receipt_id` and `display_id` in the CLI verdict, `--json`, the library result, and `POST /v1/receipts/check` are the verified `task_id` (v11 uses the signed `receipt_id` when the payload has no task id). They are null when the signature is not valid. An outer `display_id`, `receipt_id`, or `task_id` is not copied into those fields. An outer `receipt_id` that disagrees with the signed id is a claim mismatch. `BUILD_DIGEST.txt` moved because the verifier sources changed. The pinned epoch genesis digests did not. Not published. No deploy.
- **Public shells and id lookups show null ids.** `receipt_id` and `display_id` are null for an unsigned public shell and for an id lookup, where 0.4.4 showed the unsigned outer id.
- **An unsigned `book_chain.row_hash` does not need a published preimage.** The log leaf binds `task_id|row_hash`, and the preimage contains `agent_id`, which is not public. The same rule covers a top-level `row_hash`. A published preimage that does not match still fails. A row hash that the receipt JWS actually signs still requires a preimage. An honest holder built by `holderDocumentFromOwnerView` is no longer exit 1 `payment_mismatch` for a missing row-hash preimage.
- **An outer copy that disagrees with the signature is `claim_mismatch`.** Exit 1. It is not `payment_mismatch`. `payment_binding` is still `fail`. A payer, payee, or amount that the chain disagrees with, and that the outer copy did not rewrite, stays `payment_mismatch`.
- **One claimed chain verifies.** Base-only or Solana-only: a signed head claims a chain only when that side is not `pending` and it names a tx or signature. A side the issuer signed as anything else with no tx or signature stays partial. The live log anchors Base and leaves Solana pending. Both sides pending stays partial, and the CLI reports that as `pending`, not `log_unreachable`.

### Changed
- `@xfuel/verify` 0.4.5 depends on exactly `"chit402-verify": "0.4.5"`. `--version` prints `chit402-verify 0.4.5`. Not published. No deploy.

## 0.4.4 — Payer check is on in the CLI

Numbered 0.4.4, above the 0.4.3 anchor-finality release.

### Security
- **Exit 0 includes the on-chain payer check.** `chit402-verify` calls `verifyReceipt` with `checkPayer: true`. A USDC transfer that does not match the signed payer, payee, or amount is exit 1 `payment_mismatch`. An RPC timeout, a null receipt, an RPC error, a missing payer field, an unsigned public shell, or an unsupported rail is exit 2 `payer_unchecked` (or the existing log reason when the log was also not checked). It is not exit 0. There is no flag to turn the check off. A fabricated `payment.ref` (a rail this verifier cannot read, or a transaction the RPC does not have) is exit 2, not exit 1: the chain did not disagree, it could not be checked. Solana requires the signed payee to be credited at least the amount in USDC. A legacy `transfer` of another token does not count. A Solana receipt with no signed payee is exit 2. `BUILD_DIGEST.txt` moved because the verifier sources changed. The pinned epoch genesis digests did not. Not published. No deploy.
- **RPC calls stop.** The payer check and the anchor reads share one JSON-RPC helper: one request, one deadline, no retry. The Base payer read waits 12 seconds. The Solana payer `getTransaction` waits 30 seconds. Base anchor calls keep the 8 second budget (`ANCHOR_RPC_TIMEOUT_MS`). Each Solana anchor call keeps `SOLANA_ANCHOR_RPC_TIMEOUT_MS` (30 seconds). A deadline is exit 2.
- **The epoch record is a trust path.** `GET /v1/receipts/tree/epoch` is checked when the head names an epoch. The signer has to be `active` at the verified head's `published_at`. The epoch JWS `iat` is not that time. The loaded history must never revoke that kid. A `revoked` or `retired` history key does not sign the epoch, even when the signature bytes verify. A production pin with no history row for that kid stays the package pin.
- **`--` does not hide a flag.** `chit402-verify receipt.json -- --check-payer` and `chit402-verify receipt.json -- anything` exit 1. The grammar stays `<id|url|file|-> [--issuer-history <file>] [--json]`, plus `-h`/`--help` and `-V`/`--version`.

### Removed
- The unused pre-0.4 argument parser and `legacyMain` are gone. The running command is the locked verdict.

### Fixed
- **`fetchBaseAnchorTransaction` closes on its own line.** The return and the function were written as `};}` on one line. The Base anchor reads are unchanged. `BUILD_DIGEST.txt` moved because `src/anchor-witness.ts` changed. The pinned epoch genesis digests did not. Not published. No deploy.

### Changed
- `@xfuel/verify` 0.4.4 depends on exactly `"chit402-verify": "0.4.4"`. `--version` prints `chit402-verify 0.4.4`. Not published. No deploy.

## 0.4.3 — Anchors must be mined, successful, and final

### Security
- **A Base anchor is accepted only when its receipt succeeded and the block is at least 12 below the tip.** `fetchBaseAnchorTransaction` reads `eth_getTransactionReceipt`, `eth_chainId`, and `eth_blockNumber` for the hash the head named. Status must be `0x1`, `blockNumber` must be present, and `tip - blockNumber` must be at least `BASE_ANCHOR_MIN_CONFIRMATIONS` (12). Twelve confirmations means the receipt is mined and successful. It is not finality. A requirement that the block be at or below the `safe` tag is a follow-up. Base blocks are about 2 seconds, so a fresh anchor stays `COULD_NOT_CHECK` for about 24 seconds. Pending, no receipt, a null block, a null tip, or a shallow block is `could_not_check`. A reverted receipt (`0x0`) is `tx_reverted` and is not verified. A null or unparseable chain id is `chain_id_missing` and is not skipped. A different chain id, or a transaction chain id that disagrees with `eth_chainId`, stays `chain_mismatch`. A receipt hash, sender, or block that disagrees with the transaction is `anchor_inconsistent`. A receipt with no transaction body is the same code and is `could_not_check`, because there is no calldata to compare. A null RPC, a thrown RPC, and a timeout are `base_rpc_null`, `base_rpc_error`, and `base_rpc_timeout`. None of those fall back to an older anchor hash. `BUILD_DIGEST.txt` moved because `src/anchor-witness.ts` changed. The pinned epoch genesis digests did not. Not published. No deploy.
- **A Solana anchor is fetched at `finalized`.** `getTransaction` sends `commitment: "finalized"`. Each Solana anchor call has its own budget, `SOLANA_ANCHOR_RPC_TIMEOUT_MS` (30 seconds). A historical `getTransaction` on the public mainnet-beta RPC takes about 11–15 seconds, so the 8 second Base budget is not used for Solana. A null body or a `confirmationStatus` other than `finalized` is `could_not_check`. `meta.err` on a finalized transaction still fails. The full genesis hash comparison is unchanged. The fee-payer list is unchanged: `BHTnbPu6UZ7zQZ7Qpkpz4LcUQbMN73YDsMtvaNXpEioD` stays first.
- **The Base payer check is unchanged.** It still uses `getTransactionReceipt` with no confirmation depth. That path is separate from the anchor JSON-RPC, and another change is already editing the payer-check default and the RPC timeout. Depth there would collide with that work.

## 0.4.2 — Solana anchor fee-payer pin is a list

### Changed
- **The Solana anchor pin is append-only.** `PINNED_SOLANA_ANCHOR_FEE_PAYERS` is `[BHTnbPu6UZ7zQZ7Qpkpz4LcUQbMN73YDsMtvaNXpEioD, 8ef3GtYNuQ6P2ANxLMPUXTAo9BhfJJqMx6cdDVh7JM4U]`. The second entry is the rotated anchor fee payer, effective 2026-10-15. A head anchored by either payer passes offline. `PINNED_SOLANA_ANCHOR_FEE_PAYER` still exports the first entry. A head is still trusted only through its issuer ES256 signature; the pin only names which memo signer may carry the root. The bundled issuer-history snapshot is unchanged. Flags stay `--issuer-history` and `--json`; exit codes stay 0, 1, 2. `BUILD_DIGEST.txt` moved because `src/anchor-trust.ts` and `src/index.ts` changed. The pinned epoch genesis digests did not. Not published. No deploy.

## 0.4.1 — COULD_NOT_CHECK does not read as INVALID

### Added
- **`checkReceiptInput` is the locked check.** The CLI and the free receipt-check box both call it. A public caller can pass receipt JSON, an id, or a URL on a host the verifier already trusts. It does not read a local file. `BUILD_DIGEST.txt` moved because `src/check-input.ts` and `src/cli.ts` changed. The pinned epoch genesis digests did not. Not published. No deploy.

### Fixed
- **A public issuer-history read error is `COULD_NOT_CHECK`.** When the bundled snapshot cannot be read, `checkReceiptInput` with a public caller returns exit 2, reason `issuer_history_unavailable`. The lines say the history could not be read and the receipt could not be checked. They do not contain `invalid` or `INVALID`. A local `--issuer-history` file that cannot be opened is still exit 1. `BUILD_DIGEST.txt` moved because `src/check-input.ts` and `src/verdict.ts` changed. The pinned epoch genesis digests did not. Not published. No deploy.
- **Exit 2 no longer says the receipt was found invalid.** The fetch failure used to append `It was NOT found invalid.`, and human output added a stray `NOT found invalid` line. Both read as `INVALID`. Human text and the JSON `message` are the same: the receipt could not be fetched, and `COULD_NOT_CHECK` says the receipt could not be checked. That output does not contain `invalid` or `INVALID`. `result`, `reason`, `exit_code`, and the verdict keys are unchanged. A failed fetch is still exit 2, reason `receipt_unavailable`, and every check is `could_not_check`. Flags stay `--issuer-history` and `--json`. `BUILD_DIGEST.txt` moved because `src/verdict.ts` and `src/cli.ts` changed. The pinned epoch genesis digests did not. `@xfuel/verify` 0.4.1 depends on exactly `"chit402-verify": "0.4.1"`. Not published. No deploy.

## 0.4.0 — Locked verifier verdict

### Breaking
- **Exit codes are 0, 1, and 2.** 0 is `VERIFIED` (every check passed). 1 is `INVALID` (tamper, a bad signature, a revoked or out-of-window key, `kid_status_regression`, a payment mismatch, `NOT_IN_LOG`, `id_prefix_version_mismatch`, `intent_on_legacy_version`). 2 is `COULD_NOT_CHECK` (no history covers the key, the log or anchor was not fetched or did not verify, `unsupported_version`). Exit 3 is removed. `VERIFIED_NO_KEY_WINDOW` is retired. A log check that did not run is not a pass.
- **The command is `chit402-verify <id|url|file>`.** Flags are `--issuer-history <file>` and `--json`. `--help` and `--version` still exit 0. `--issuer-history-file` is removed. Every other flag, including `--jwks-file`, `--trusted-kid`, `--rpc`, `--jws`, `--accept-shell`, `--strict`, and `--no-issuer-history`, exits 1 with `removed in 0.4:`. `--json` on an error is the verdict JSON.
- **`--issuer-history` must prefix-extend the bundled snapshot.** The one grandfathered rewrite is head `3d8259fb` to `349d7bb4` (v1 to v2). The reverse is not an extension.
- **`chit402-verify` is the package.** `@xfuel/verify` 0.4.0 depends on exactly `"chit402-verify": "0.4.0"`. Both bins (`chit402-verify` and `xfuel-verify`) ship on the primary package. Publish uses `npm publish --provenance` from the `workflow_dispatch` job.

### Security
- **Exit 0 is `VERIFIED` only when every check passed.** Exit 1 is `INVALID`. Exit 2 is `COULD_NOT_CHECK`, including a log or anchor this run did not fetch. `payment_binding` is `could_not_check` unless the signature passed. `key untrusted` says the key is not the issuer's. A receipt URL is fetched as JSON (`?format=json` and `Accept: application/json`). HTML, a timeout, or a failed fetch is exit 2, reason `receipt_unavailable`: every check is `could_not_check`, and the receipt was not found invalid. A fetched proof or head that does not verify (tampered proof, bad head signature, anchor mismatch) is exit 1. `NOT_IN_LOG` needs the current signed tree head, and that signature has to verify against the pinned kids and the loaded history, beside an unsigned `not_in_tree` response. It does not check that the head covers the leaf. An unsigned head, or an unsigned 404 alone, is exit 2. A head whose signature does not verify is exit 1.
- **An unsigned public shell is `signed_receipt_unavailable` (exit 2).** The next step is the owner view, not `--issuer-history`. A shell with no inclusion, plus a fresh `not_in_tree` beside that verified head, is `NOT_IN_LOG` (exit 1). `BUILD_DIGEST.txt` moved because `src/cli.ts`, `src/verdict.ts`, and `src/issuer-history.ts` changed. The pinned epoch genesis digests did not.
- **Issuer history is always checked.** The source is `--issuer-history <file>` when that file extends the bundled snapshot, else a live snapshot that prefix-extends it, else that snapshot alone, reported `as of 2026-10-14`. A file that does not verify, or that does not extend the snapshot, is `INVALID` and is not replaced. Reason anchors live at `https://chit402.com/docs/verify#<reason>`.
- **`not_before` still cannot move.** A later entry that changes `not_before` for the same kid is `kid_status_regression`. The window uses the latest `not_before`.
- **A pre-log receipt is `NOT_IN_LOG`.** `chit-1ebc5616` and the other payments issued before the public log are not leaves. A log check exits 1. The payment row in the book is unchanged: the receipt is not re-signed, and the book does not drop or rewrite the payment.
- **Publish is no longer held.** The owner approves the release. This change does not publish, merge, or deploy.

## 0.3.6 — Inclusion size is checked before the head

### Security
- **A size mismatch is `tree_size_mismatch`, including a null proof.** `verifyReceipt` compares the head size with the inclusion size before `suppliedHeadCovers`. A null proof no longer hides that mismatch behind `tree_head_mismatch` or `inclusion_failed`, and it is not VERIFIED. A null proof whose size matches the head stays `inclusion_failed` and is not an inclusion. Pending-anchor CLI output is unchanged: the anchor check does not pass the inclusion into `verifyReceipt` a second time. Not published.
- **`inclusion.head` is a head only when its JWS verifies under JWKS or a pinned kid.** The named summary is not a tree-head document. The verified payload is the head. A key carried in that summary is ignored unless the kid is pinned. An untrusted summary is not a head. A caller-supplied head wins.
- **A failed anchor or refusal does not print the affirmative “What this proves” block.** `PARTIAL` and `PENDING` still print it. Not published.

## 0.3.5 — Unsupported receipt versions fail closed

### Security
- **Versions the gateway never issued are `unsupported_version`, exit 1, before any RPC.** One exact-type allowlist reads the signed payload only. Privacy receipts must carry `v` as the JSON number 11 and must not carry `payload_version`. Legacy receipts must carry `payload_version` as an integer 1 through 10, or 11 only when `issuer_root` is present and an object. `Number()` is not used. JSON `11.0` and `1.1e1` are the number 11; the string `"11"` is not. `BUILD_DIGEST.txt` moved because `src/receipt-version.ts` and the verifier entry points changed. The pinned epoch genesis digests did not. Ship this as 0.3.5. Do not fold it into 0.3.4. Not published.
- **Every path that can say VERIFIED uses that gate.** Library `verifyReceipt`, `verifyReceiptUpToV10`, `verifyV11Receipt`, the CLI, `--json`, shell `--jws`, owner view, `--accept-shell --jws`, log and anchor mode, carry-forward `reconcileSettledTransfer`, and refusals. No flag skips it. The library returns `failed` and does not throw.
- **The version is the signed version.** An outer `v` or `issuer_signature.payload_version` that differs in value or type is `version_mismatch`. `reconcileSettledTransfer` does not fall back to an outer version when a JWS is present. A version on the JWS header is ignored. `hmac_attestation.payload_version` stays the HMAC field-list version and is not compared to the JWS version.
- **Unversioned September 4–5 receipts** are accepted as inferred only when every outer version slot is 4 or 5 and the claims have no v6+ field. `--json` sets `version_source` to `inferred`.
- **Bare `--accept-shell` on a version outside the allowlist exits 1** and does not print `INCLUDED_SHELL`. The #519 row for a supported shell is unchanged (OV519-ACCEPT).
- **Refusals use the same exact-type rule.** `payload_version` must be the integer 1, 2, or 3. The string `"2"` and `true` are `unsupported_version`.
- **Gateway self-checks use the same exact rule** and responses carry an unsigned `verifier_min` hint (`0.3.5`). The hint is not a trust input. Do not enable `ISSUER_ROOT` or emit v11 from production paths until this package is published.

## 0.3.4 — Shell holder trust

### Security
- **`xfuel-verify shell.json --jws holder` does not print VERIFIED for a holder signed by an untrusted key.** The key inside the holder, including an `issuer_jwk` on an owner-view response, is not a trust root. VERIFIED requires a pinned kid or a JWKS entry, a passing inclusion proof, and a signed payment that matches the shell. A shell with no proof, a bad proof, or a leaf that does not match the proof is not VERIFIED. A shell without `--jws` stays `INCLUDED_SHELL`. Publish 0.3.4 before a gateway that serves the public shell. Not published.

## Unreleased

### Security
- **A receipt from before the public log is `NOT_IN_LOG`.** See 0.4.0. The payment row in the book is unchanged. Publish is no longer held. Not published by this change.
- **Revocation is sticky.** The earliest `revoked_at` and the earliest `not_after` for a kid stay in force after a later entry. A history that moves a kid from `revoked` to any later status, or from `retired` to `active`, is `kid_status_regression`. A receipt issued before `revoked_at` still verifies. Not published.
- **`not_before` cannot move.** A later entry that changes `not_before` for the same kid is `kid_status_regression`. The window uses the latest `not_before`, so `[not_before 2026-03-01, retired not_before 2026-01-01]` does not accept `iat` 2026-02-01. Not published.
- **History is always on in 0.4.0.** See the 0.4.0 entry. `--no-issuer-history` and `--strict` are removed. A loaded history that fails (`kid_revoked_before_issuance`, outside the window, `kid_status_regression`) is `INVALID`, exit 1. A version 10 pin stays an exact document hash, including history version 1. The earliest `revoked_at` and `not_after` for that kid stay in force. An edited genesis entry, a new key that copies an older `not_before`, and a history signed only by the key it introduces all fail. The gateway still issues payload version 10. Not published.
- **Epoch records with a row list still verify, and so does a commitment.** Payload version 2 still checks `unlogged.rows` against its hash. Payload version 3 checks `unlogged` as `count` plus a 64-character `commitment` and rejects a task id, agent id, reason, or row list on that object. `unloggedReasonForTask` still reads a version 2 list and returns nothing for a version 3 commitment. A version 2 `unlogged` value that is not a plain object (a string, a number, `true`, an array, or null) fails closed with `unlogged_missing` and does not throw. Version 1 records are unchanged. `BUILD_DIGEST.txt` moved because `src/epoch.ts` changed. The pinned epoch genesis digests did not. Publish the v3-aware `@xfuel/verify` and confirm it with `npm view @xfuel/verify version` before `backfill-receipt-log.mjs --apply`; npm serves 0.3.1 today. 0.3.1, and the 0.3.2 on main before this change, reject a version 3 epoch record (`epoch_record_version`). The first v3-aware release is 0.3.3; `npm view @xfuel/verify version` must print 0.3.3 or later. Not published.
- **A pending leaf does not skip the issuer pin or the epoch record.** `pending` is only a leaf past the anchored head whose head trust, wallets, epoch link, newest memo, and issuer pin all pass. A claimed `issuer_key_pin` with no pin file is `ISSUER_PIN_DOWNGRADE` and is not `pending`. A head that names an epoch and has no epoch record is `epoch_record_missing` and is not `pending`. A checked chain that does not match still fails.
- **Public tree preimage is an inclusion audit path.** `verifyPublishedPreimages` recomputes `tree_head_hash` from this receipt's leaf body plus `audit_path` (`index`, `tree_size`, sibling hashes, root). Index and tree size choose the side. A `position` label on that path is ignored. Inclusion proofs still reject a label that names the other side. A tampered sibling, a swapped index, a wrong `tree_size`, or a forged leaf body fails. The leaf is bound to this receipt from its canonical bytes, not from one encoding: `leaf.task_id` is `task_id`, and the body is `task_id|` the row hash `boundRowHash` agrees (top-level `row_hash`, `book_chain.row_hash`, and `inclusion.row_hash`). A null row, an empty string, or a disagreement fails closed and is not hashed as `task_id|`. The body may be utf8, hex, or `0x00 ||` that body. Utf8 and hex must name the same body. Any other encoding, an invalid hex string, or a body that itself starts with `0x00` fails closed with `leaf_not_bound`. When present, `inclusion.leaf` and `inclusion.leaf_index` match that same body and `audit_path.index`. Inclusion tree size is not compared. A different leaf in the same prefix fails closed with `leaf_not_bound`. A saved response that still publishes the ordered `leaves` array still verifies. `BUILD_DIGEST.txt` moved because `src/preimage.ts` and `src/anchor-witness.ts` changed. The pinned epoch genesis digests did not. Not published.

## 0.3.2 — Tree head signature and anchor wallets

### Security
- **A foreign payer cannot mark an honest head stale, and a failed receipt is not PENDING.** `--rpc` counts a Solana memo only when its fee payer is the head's signed `anchors.solana.fee_payer` and that payer is on the signed anchor-wallet list. A memo from any other payer is ignored and is not a newer anchor. `--json` reports `receipt_check.overall` as the receipt failure when the signature, a signed field, or a preimage fails. `PENDING` (exit 2) is only a valid receipt whose leaf is past the anchored size.
- **Offline inclusion does not hash an empty row.** A null or empty `row_hash` is `no_leaf`. The leaf is not `task_id|`. An inclusion of that empty-suffix leaf fails even when the leaf is in the tree. Anchor mode already returned `no_leaf` for the same receipt.
- **Anchor mode, carry-forward, and preimages use one row-hash rule.** `verifyAnchoredRoot` agrees the top-level `row_hash`, `book_chain.row_hash`, and inclusion `row_hash`, or fails `row_hash_mismatch`. A receipt with no row hash fails `no_leaf`. The inclusion object's `leaf` is not substituted for that hash. Carry-forward runs the same helper across those receipt fields and `carry.row_hash`. A disagreement fails. No row hash is `row_hash_missing`. A history window is the matched entry's own `not_before`, `not_after`, and `revoked_at`. Two entries that match the same kid or thumbprint fail closed. `requirePreimages` covers a non-empty top-level `row_hash`.
- **A leaf past the anchored head is PENDING.** Inclusion with `status: pending_anchor` prints `PENDING` and exits 2 only when `leaf_index` and `tree_size` are safe integers, `tree_size >= 1`, and `leaf_index >= tree_size`. When `live_tree_size` is present it must be greater than both. An index inside the head is `pending_leaf_in_head` and fails. `--json` sets `receipt_check.overall` to `pending` for that leaf only when the receipt itself verifies. A failed receipt stays a failure. The text output does not print the unsigned-field `UNVERIFIED` line for an honest pending leaf. `--rpc` requires `anchors.solana.fee_payer` whenever the head claims an anchor, and that payer must be on the anchor-wallet list. A missing or unlisted payer is `newest_anchor_unavailable`. The scan pages `getSignaturesForAddress` with `before` until the first memo that payer actually paid, and requires the served root to equal that memo. A memo from any other payer is ignored. A newer root from the signed payer is `stale_head`. A null transaction, a thrown fetch, or a full page cap with no memo is `newest_anchor_unavailable`. An inclusion that claims `anchored` while the head has no anchor transaction is `head_not_anchored`. Not published.
- **A head signed before signer pinning fails closed.** An anchored head whose signature does not name `anchors.base.from` or `anchors.solana.fee_payer` returns `LEGACY_HEAD_UNPINNED_SIGNER` and does not return VERIFIED. The message says the head predates signer pinning and that a newer head should be used. Exit code stays 1. The epoch-1 head and the epoch-2 head signed at 07:43 ET on 2026-10-07 are this case. A head that names both signers is unchanged.
- **Offline mode checks the tree head signature too.** `verifyReceipt({ head })` and `xfuel-verify receipt.json inclusion.json head.json` without `--rpc` verify the ES256 `issuer_signature` over the outer size, root, and the same signed fields anchor mode already compares. A head whose signature does not match fails closed (`head_claims_mismatch`, `head_signature_missing`, or `head_signature_invalid`). Deleting `issuer_signature` is `head_signature_missing` and does not verify. A `{ root, tree_size }` prefix used only to compare `tree_head_hash` is unchanged. This check does not call chain RPC. `--rpc` is unchanged.
- **Offline inclusion reads a top-level `row_hash`.** The leaf is `task_id|row_hash` in the same order as anchor mode: the receipt's top-level `row_hash`, then `book_chain.row_hash`, then the inclusion document. A receipt that stores the hash only at the top level still verifies. When more than one of those sources is present they must be the same string; a disagreement is `row_hash_mismatch`. A different top-level hash fails the inclusion proof.
- **A history kid matched by thumbprint stays inside its window.** Issuer history can name a key by `entry.kid` or by the RFC 7638 thumbprint of `entry.jwk`. The window check uses that same match. A head inside the window verifies. A `published_at` outside the window is still `head_kid_window`, not `kid_not_in_history`.
- **Offline head trust uses the issuer history that was fetched.** The history body loaded for the receipt (file or `/.well-known/issuer-history.json`) is the document `verifyTreeHeadTrust` sees. A kid that appears only in that history can sign the head. A body that was fetched and does not verify fails closed (`issuer_history_invalid`) and is not ignored in favor of the production pin. Unreachable history stays a warning unless `--strict-issuer-history`.
- **Inclusion proofs are bound to leaf index and tree size (RFC 9162 §2.1.3.2).** The verifier uses that pair to choose left or right at each step. A `position` label is not the source of that side. When a label is present it must name the side the index already chose, so a swapped label fails. An omitted label does not. A proof whose length is not the length the pair requires is rejected, and so is `index >= size`. The same rule is in the gateway `verifyInclusion`. Leaf hashing and node hashing are unchanged. Consistency proofs and the empty root are unchanged.
- **Every signed claim is compared with the outer receipt.** The check walks the JWS payload. Any path that also exists on the outer document must match, including `payment.fee_amount` and `payment.protocol_fee_bps`. A new signed field cannot skip the check. The outer document `schema` is not a copy of the JWS `schema` (`xfuel.receipt.v3` beside `chit402.foreign_payout.v1`); it is unsigned. A path the outer receipt omits is not a mismatch.
- **Unsigned outer fields are UNVERIFIED.** `payment.network`, `payment.fee_bps`, `payment.collected`, `payment.explorer_url`, `verify_url`, `route.resolved`, `created_at`, `usage.total_tokens`, and every other path the signature does not cover are listed in `unsigned_fields` and printed as `UNVERIFIED`. They do not fail a legitimate receipt, and they are not part of Overall. `issuer_signature` is the credential that was checked and is not in that list.
- **Log mode runs the receipt checks.** `xfuel-verify receipt.json inclusion.json head.json` (with or without `--rpc`) fails when the issuer signature is missing, stripped, or only partial, and when the signed-versus-outer comparison fails. The exit code is non-zero. Overall is not VERIFIED. `--quiet` still prints that failure. An inclusion proof that still matches does not print Overall VERIFIED for a tampered amount.
- **A foreign payout is `observed_transfer`.** A verified JWS whose `schema` is `chit402.foreign_payout.v1` no longer prints `settled_by: receipt`.
- **`xfuel-verify --rpc` requires the tree head's ES256 issuer signature.** A missing, forged, or untrusted signature fails closed. The kid is trusted the same way as a receipt: the production pin, a JWKS key matched by kid, or a kid in a verified issuer-history document. The signed root, size, epoch, and anchors must match the head that was checked.
- **The anchor transaction has to come from the wallet the issuer signed.** `anchors.base.from` is the Base sender and `anchors.solana.fee_payer` is the Solana fee payer. The verifier reads those accounts from the transaction and requires them to equal the signed values. A wallet that is not on the issuer's anchor-wallet list fails even when the sender matches. The list is the package pin (Base `0x1844D1F5FE42aff1Cce6F776514Fd40374079582`, Solana `BHTnbPu6UZ7zQZ7Qpkpz4LcUQbMN73YDsMtvaNXpEioD`), plus wallets in a verified `chit402.anchor_wallets.v1` document or in a verified issuer-history payload's `anchor_wallets`. The on-chain issuer-root registry and the DNS anchor are named and not queried.

### Fixed
- **`--rpc <url>` with a tree head enters anchor mode.** A head file is no longer read as a receipt (`Invalid receipt: missing task_id`). An unpublished head reports `not_yet_published` when the receipt and inclusion are present as well as when an input is missing.
- **A head with no `published_at` is not `issued_at_missing`.** v1 heads omit the field, and a closed head with no observed chain time signs null. An active kid with an open issuer-history window still verifies. A revoked kid, or a kid with `not_after`, fails closed because the missing time cannot show the signature was inside the window. A present `published_at` still uses the receipt window rules.
- **`--version` prints the package version** and exits 0.

### Notes
- Not published. The epoch 1 root `dd20e39a…`, the epoch 2 opening `f2043ee9…`, and the epoch record payload are unchanged.

### Added
- **Dated carry-forward.** A receipt leaf included under an earlier signed epoch head and under the current signed epoch head is `VERIFIED_CARRIED_FORWARD`. `issued_at` and `issued_epoch` are the earlier head's signed claims. `logged_at`, `logged_epoch`, and `leaf_index` are the current head's signed claims and the RFC 9162 inclusion proof. Unsigned receipt fields are not those dates. A receipt in the current epoch is unchanged. A missing signature, a bad proof, a leaf mismatch, a current head time before the earlier head, an epoch id outside the pinned anchor list, or the same leaf at two indexes fails closed with the existing error code.
- **Unlogged rows.** A payload version 2 epoch record carries `unlogged` (`count`, `hash`, `rows`). `verifyEpochRecord` checks that hash. `xfuel-verify` reports `unlogged_reason` when inclusion is absent and the signed list names the task. Payload version 1 records stay valid and have no list.

### Security
- **Issuer pin reads the verified JWS.** When `issuer_key_pin` is claimed, a compact JWS that verifies under the pin key is required. The kid is the protected-header `kid`, and a v11 `issuer_root.kid` is the one inside the payload. Unsigned `issuer_signature.kid`, `issuer_jwk`, and `issuer_root.kid` do not satisfy that check, including when they match the pin. A JWS that does not verify is `ISSUER_PIN_MISMATCH`. A source fills a missing commit or hash only when it already names both. A commit from one claim and a hash from another is `ISSUER_PIN_DOWNGRADE`. Commit hex is compared in lowercase.
- **Specimen key gate cannot be waived by a prior pin.** A prior whose kid is not the published Sepolia specimen is `ISSUER_ROTATION_UNCONTROLLED`, including a same-kid copy of an attacker pin. The prior file must name a 40-hex commit and the file hash (`--issuer-prior-commit`, `--issuer-prior-sha256`). `--issuer-witnesses` and the other pin flags do not start the check and do not downgrade a receipt that does not claim `issuer_key_pin`.
- **Content-addressed issuer pin in anchor mode.** A receipt or head that carries `issuer_key_pin` must match `docs/well-known/issuer-key.json` at a 40-hex commit whose SHA-256 is the pin file. A branch name is `ISSUER_PIN_MUTABLE_REF` and is not fetched. A hash mismatch is `ISSUER_PIN_HASH_MISMATCH`. A different issuer key, `issuer_root.kid`, or `/api/witnesses` kid is `ISSUER_PIN_MISMATCH`. A registration self-signature that does not verify is `ISSUER_SELF_SIG_INVALID`. A claimed era with no pin is `ISSUER_PIN_DOWNGRADE`. A new key without a `chit402.freeze.v1` event (`purpose: citizen_issuer_key`) signed by the previous key is `ISSUER_ROTATION_UNCONTROLLED`. The pin chain is `eip155:84532`. Receipts that do not claim the era are unchanged. Not published.

## 0.3.1 — Epoch record on `--rpc`, full Solana genesis hash

### Security
- **Epoch 1 proofs fail closed.** A head may omit `epoch` only when it is `chit402.tree_head.v1` or payload version 1. A version 2 head with no `epoch` fails `epoch_missing`, including inside `verifyAnchoredRoot`. An epoch-1 inclusion root must be a pinned prefix: size 1 is the genesis leaf of digest `422cceb1`, size 2 is `ecf9a330…`, size 4 is `dd20e39a…`. Size 3 and every other size fail.
- **`xfuel-verify --rpc` loads the signed epoch record.** A v2 head fetches `GET /v1/receipts/tree/epoch` from the receipt `verify_url` origin, or uses `--epoch-record` / `--epoch-url`. A missing or forged record still fails. Issuer history is fetched by default; `--no-issuer-history` is the offline skip, and a missing `/preimage` is not a verification failure.
- **Epoch signatures use the same keys as the receipt check.** `--jwks-file`, `--jwks-url`, and `--fetch-jwks` are loaded for the epoch record. An embedded epoch key still verifies only when its thumbprint is a trusted kid. A key that is in none of those sources fails closed.

### Fixed
- **Windows `npm test` before publish.** `--import` of the JWKS preload is a `file://` URL (`pathToFileURL`). A raw `C:\` path is protocol `c:` and Node exits `ERR_UNSUPPORTED_ESM_URL_SCHEME`. `xfuel-verify` sets `process.exitCode` and closes Node's fetch connection pool. `process.exit()` while those sockets are still closing aborted on Windows (`UV_HANDLE_CLOSING` in `src/win/async.c`) after a verified epoch-1 anchor check. `--jwks-url` and `--epoch-record` still read files with `readFileSync`. Version stays 0.3.1.
- **Mainnet Solana genesis hash.** `SOLANA_GENESIS['mainnet-beta']` is the full `getGenesisHash` value `5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d`. The previous 32-character CAIP-2 reference never compared equal, so every mainnet-beta anchor failed `solana:cluster_mismatch`. Devnet `EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG` and testnet `4uhcVJyU9pJkvQyS88uRDiswHXSCkY3zQawwpjk2NsNY` were already the full hashes and are pinned the same way.
- **Unpublished head and `not_in_tree`.** A head whose `status` is `not_yet_published` is reported as that. An inclusion document `{ "error": "not_in_tree" }` (the inclusion endpoint's 404 body) is `not_in_tree`.
- **`BUILD_DIGEST.txt` tracks these sources.** The historical epoch 1 genesis `422cceb1` and the epoch 2 opening root `f2043ee9` are not this file.

## 0.3.0 — Canonical preimage, issuer-history pin, refusals

### Added
- **Fail closed on a bad canonical preimage or a missing v10 pin.** `verifyReceipt` sets `overall` to `failed` when the stored canonical object or `--canonical-preimage` does not hash to the signed `payload_hash`, so `xfuel-verify` exits nonzero. A payload version 10 receipt with no `issuer_history` pin fails `issuer_history_pin_missing` even when no history file was passed.
- **Pinned issuer history and canonical object.** When verified claims include `issuer_history`, `xfuel-verify` fetches that snapshot (`?version=N`), checks SHA-256 of the body against `hash`, and reads `not_after` from the pinned entry. A mismatch or a missing snapshot fails closed. Payload version 10 without a pin fails `issuer_history_pin_missing`. Older receipts still warn when history is unreachable. `--canonical-preimage <file>` hashes that file and matches `payload_hash`. A stored `issuer_signature.canonical_preimage` is checked the same way. `--no-issuer-history` skips the pin. `BUILD_DIGEST.txt` includes `src/canonical-preimage.ts`.
- **Hash preimages.** `verifyReceipt` and `xfuel-verify` recompute every published preimage (`book_chain.row_hash`, refusal `book_row.row_hash`, `inclusion.leaf`, `binding.expected_commitment`, `job_spec_hash`, `response_hash`, and a published `tree_head_hash` or empty-set coverage hash). A missing or mismatched preimage fails. `output.hash` is not recomputed. A receipt with no `preimages` block still verifies when `requirePreimages` is false. The CLI sets that requirement. `--no-preimage` skips it.
- **Issuer key window.** `xfuel-verify` fetches `/.well-known/issuer-history.json` from the receipt's JWKS host, or reads `--issuer-history-file`. It fails if `iat` is outside the kid's `not_before` / `not_after`, or if the kid was revoked before issuance. An unreachable history is a warning. `--strict-issuer-history` fails closed. `--no-issuer-history` skips the check.
- **Refusal documents.** `verifyReceipt` recognizes a refusal from the signed JWS `schema`, including when the unsigned outer `schema` is omitted or rewritten, and does not report that document as a verified payment. An outer `schema` that disagrees with the signed schema fails `verifyRefusal` (`schema_mismatch`). Omitting the outer schema still verifies as a refusal. `xfuel-verify` accepts schema `chit402.refusal.v1`. It checks the ES256 JWS against the same JWKS or pinned kid as a receipt, and it checks that the outer `refusal_code`, `nonce`, anchor, and book row match the signed claims. A charge other than zero fails. The output states what the signature proves (the issuer refused, at that anchor, for that code) and what it does not prove (a payment, a stable block after a reorg, or that the rule was the correct one). `verifyReceipt()` on the same document fails with `refusal document is not a payment receipt`. `BUILD_DIGEST.txt` moved because `src/refusal.ts` is part of the source digest.
- **Receipt-lane boundary.** `receipt_lane` adds `ordering`, `boundary`, `classification`, and `local_check`. `classification: unverifiable_from_registry` is a binding past expiry with `settled_by`, `receipt_id`, `observed_tx_hash`, and `observed_transfer_id` all null. A joined `observed_transfer` stays settled. `local_check.claims_paid` is false. `freeze` is unchanged and still does not change the exit code. Design by Turbo on 1F916 (post 6579, comment 88596).
- **`claim_id` seat check.** `verifyReceipt()` reads `claim_id` from the verified JWS. A payload that includes the key, has `payment.ref`, and has `claim_id` null fails (`claim_id: refused`). A v8 payload that omits the key still verifies (`claim_id: not_present_legacy`). Outer `claim_id` is compared with the JWS.
- **Receipt lane.** `verifyReceipt` returns unsigned `receipt_lane` (`settled_by`, `anchor_changed_since_binding`, `settled`, `freeze`). `freeze` is true only for an unsettled receipt-lane row (`settled_by: receipt`) whose anchor changed after binding. A settled row with an anchor change does not freeze. The bit is recomputed; a stamped `freeze` is ignored. Signature `payload_version` is unchanged and `freeze` does not change the exit code. Design by Turbo on 1F916 (post 6579, comments 88201 and 88403).
- **`--rpc` anchor mode.** `xfuel-verify receipt.json inclusion.json head.json --rpc` checks Merkle inclusion, fetches the Solana memo transaction, and checks the Base calldata for the same root. The output states what this proves and what it does not prove. Pending anchors exit 2. A memo or calldata that does not carry the root exits 1.

### Fixed
- **Windows `npm publish`.** The package-export test no longer fails the suite when `symlink` returns `EPERM`. On Windows it falls back to a directory junction, and skips only if that is denied too, so `prepublishOnly` can run `npm test` without `--ignore-scripts`. Linux still resolves `./dist/cli.js` and `./cli`. The canonical-preimage CLI test resolves `dist/cli.js` with `fileURLToPath`. `URL.pathname` plus `path.join` produced `\C:\...` on Windows, so the process never started (`status` null, empty stdout) and `JSON.parse` threw `Unexpected end of JSON input`. A spawn that does not exit, or that does not print JSON, now fails the assertion with status and stderr.

### Changed
- **`prepack` builds `dist`.** `npm pack` and `npm publish` compile TypeScript before the tarball is assembled, so a clean checkout ships `dist/` and does not ship sources, tests, or secrets.

## 0.2.1 — Reconcile only trusted JWS claims

### Security
- **`reconcileSettledTransfer()`** uses `payment` claims from `issuer_signature.jws` only after the same key-trust check as `verifyReceipt()` (JWKS by `kid`, or an embedded key whose RFC 7638 thumbprint is a pinned kid). An untrusted or invalid JWS is not compared to the chain, and the unsigned outer `payment` object is not a fallback for those claims. Pass `trustedKids` or `jwks` when the issuer key is not the default production pin.

## 0.2.0 — Trusted keys only

### Security
- **Embedded `issuer_jwk` is not a trust root.** A signature is valid only when the verifying key matches a JWKS entry by `kid` (file, `--jwks-url`, or `--fetch-jwks` from an allowlisted issuer host) or its RFC 7638 thumbprint equals a pinned trusted kid. The default offline pin is production kid `IvFpmC-vPhkY_v0vidsrWVT9uzlE5XWKZgAEOeJTq1Q` (`--trusted-kid` / `trustedKids` overrides it). Anything else is `key untrusted`.
- **Facts come from verified JWS claims.** Amount, payer, payee, asset, model, and tx are not read from the unsigned outer `payment` / `caller_binding` copies. Mismatches are reported and fail verification.
- **Base payer check confirms payee and asset** as well as payer and amount.
- **Package exports** include `./dist/cli.js` and `./cli`, so `chit402-verify` can resolve the CLI (`ERR_PACKAGE_PATH_NOT_EXPORTED`).

### Notes
- A paid USDC receipt with `binding.expected_commitment: null` is reported as having no payment-binding commitment. It is not described as unmetered or TFUEL.
- Legacy detached `issuer_signature.value` receipts still verify against a JWKS entry matched by kid.

## 0.1.1 — Pin-first offline verify

### Added
- **Pin-first issuer verification** — `verifyReceipt()` uses `issuer_signature.issuer_jwk`
  embedded in the receipt for offline ES256/JWS verification. No JWKS file or network fetch
  required for receipts issued after gateway PR #314.
- **`resolvePinnedIssuerJwk()` / `verifyIssuerJws()`** — helpers for pinned-key JWS verification.

### Notes
- Legacy receipts without `issuer_jwk` still verify with `--jwks-file` / `options.jwks`.
- Tampered pinned receipts fail signature verification.

## 0.1.0 — Initial release

First public release of the Chit402 offline receipt verifier.

### Features
- **Binding verification** — `verifyBinding()` recomputes the payment commitment locally.
- **Nullifier verification** — `verifyNullifier()` checks on-chain nullifier anchor (requires network).
- **Full verification** — `verifyReceipt()` combines binding + optional nullifier check.
- **CLI** — `npx xfuel-verify receipt.json` for command-line verification.

### Verification
- Payment-only binding: `keccak256(payment_ref, task_id, rail, amount)`.
- PBR (Payment-Bound Receipt): includes `model_commitment` and `output_hash`.
- Matches `SP1ProofHooks.computePaymentCommitment` on-chain.
