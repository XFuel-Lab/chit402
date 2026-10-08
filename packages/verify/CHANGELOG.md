# Changelog — @xfuel/verify

All notable changes to the Chit402 offline verifier are documented here. This project adheres to
[Semantic Versioning](https://semver.org/).

## 0.3.2 — Tree head signature and anchor wallets

### Security
- **A head signed before signer pinning fails closed.** An anchored head whose signature does not name `anchors.base.from` or `anchors.solana.fee_payer` returns `LEGACY_HEAD_UNPINNED_SIGNER` and does not return VERIFIED. The message says the head predates signer pinning and that a newer head should be used. Exit code stays 1. The epoch-1 head and the epoch-2 head signed at 07:43 ET on 2026-10-07 are this case. A head that names both signers is unchanged.
- **Offline mode checks the tree head signature too.** `verifyReceipt({ head })` and `xfuel-verify receipt.json inclusion.json head.json` without `--rpc` verify the ES256 `issuer_signature` over the outer size, root, and the same signed fields anchor mode already compares. A head whose signature does not match fails closed (`head_claims_mismatch`, `head_signature_missing`, or `head_signature_invalid`). Deleting `issuer_signature` is `head_signature_missing` and does not verify. A `{ root, tree_size }` prefix used only to compare `tree_head_hash` is unchanged. This check does not call chain RPC. `--rpc` is unchanged.
- **Offline head trust uses the issuer history that was fetched.** The history body loaded for the receipt (file or `/.well-known/issuer-history.json`) is the document `verifyTreeHeadTrust` sees. A kid that appears only in that history can sign the head. A body that was fetched and does not verify fails closed (`issuer_history_invalid`) and is not ignored in favor of the production pin. Unreachable history stays a warning unless `--strict-issuer-history`.
- **Inclusion proofs are bound to leaf index and tree size (RFC 9162 §2.1.3.2).** The verifier uses that pair to choose left or right at each step. A `position` label is not trusted. A proof whose length is not the length the pair requires is rejected, and so is `index >= size`. The same rule is in the gateway `verifyInclusion`. Leaf hashing and node hashing are unchanged. Consistency proofs and the empty root are unchanged.
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
