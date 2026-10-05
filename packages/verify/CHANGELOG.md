# Changelog — @xfuel/verify

All notable changes to the Chit402 offline verifier are documented here. This project adheres to
[Semantic Versioning](https://semver.org/).

## Unreleased

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
