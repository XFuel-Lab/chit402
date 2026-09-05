# Changelog — @xfuel/verify

All notable changes to the Chit402 offline verifier are documented here. This project adheres to
[Semantic Versioning](https://semver.org/).

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
