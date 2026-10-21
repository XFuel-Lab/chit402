# Changelog

Shipped changes to Chit402 receipts, newest first. Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/). A line is listed only once it runs in production or is published to npm. Dates are US Eastern.

Earlier changelog entries are kept in the git history.

Package changelogs: [verify](packages/verify/CHANGELOG.md), [sdk](packages/sdk/CHANGELOG.md), [mcp](packages/mcp/CHANGELOG.md), [sidecar](packages/sidecar/CHANGELOG.md), [plugin-elizaos](packages/plugin-elizaos/CHANGELOG.md).

## [Unreleased]

Merged to main, not yet in production.

- Receipts issued before the public log began carry a note that says how to check their payment. (#609)
- A step-by-step recipe and script for reproducing a Merkle inclusion proof. (#610)
- An Arc payment rail, testnet only and off by default. (#611)

## 2026-10-20

### Changed
- The cloud KMS is now the only issuer signer. The issuer key is no longer in the gateway environment, and the kid is unchanged.
- Receipt pages explain when a receipt has no public attestation. (#602)
- Stricter matching of EVM payments to receipts. (#604)
- Looking up a receipt by transaction sends board and comment stamps to their post, and ingest stamps to their receipt. (#608)

### Verifier
- chit402-verify 0.4.10: anchor lookups retry over public fallback endpoints, and one confirmed anchor is enough when the other chain cannot be reached.

## 2026-10-19

### Changed
- Receipt pages suggest the current minimum verifier version. (#599)

## 2026-10-18

### Changed
- Receipt pages render only signed fields, and the log witness is checked before it is shown. (#578)
- The gateway advises chit402-verify 0.4.9 as the minimum version. (#590)

### Verifier
- chit402-verify 0.4.9: the payee and payer on a receipt must match the signed parties.

## 2026-10-17

### Added
- Public attestation: a public receipt carries a signed attestation of its amount, payee, payment transaction and log position, so anyone can check it without the owner view. The verifier reports `VERIFIED_PUBLIC`. The payer is not claimed. (#572, #573, #574)
- The issuer key moved to a cloud KMS signer. The kid is unchanged. (#561)

### Changed
- Receipt pages show only signed fields, and x402 receipts carry their own signature type. (#576)
- An anchor counts only once its transaction is mined, successful and final. (#564)
- Private book reads are never cached.
- The Solana anchor wallet list is append-only, and the rotated anchor wallet is listed beside the original. (#558)

### Verifier
- chit402-verify 0.4.4: exit 0 includes the on-chain payer check.
- chit402-verify 0.4.5: verdict ids come from the signed receipt.
- chit402-verify 0.4.7: public attestation support (`VERIFIED_PUBLIC`).
- chit402-verify 0.4.8: stricter checks on the issuer signature.

## 2026-10-15 to 2026-10-16

### Changed
- Stricter checks on anchors, settlement and receipts. (#556, #557)

### Verifier
- chit402-verify 0.4.2: accepts either listed Solana anchor wallet.

## 2026-10-14

### Changed
- Issuer key history is append-only, and every past snapshot stays served.
- Receipts issued before the public log began report `NOT_IN_LOG`.

### Verifier
- chit402-verify 0.4.0: one locked verdict with exit codes 0, 1 and 2, and issuer history is always checked.
- chit402-verify 0.4.1: a receipt that could not be checked no longer reads as invalid.

## 2026-10-05 to 2026-10-09

### Added
- x402 payment binding: a receipt is issued only for a payment that settles against a live, server-issued challenge, with the amount, payee and network taken from that challenge and the confirmed transfer. (#516, #520)
- Public receipt page with a receipt card and short `chit-` display ids. (#524)
- A durable public receipt log, linked across epochs, with inclusion proved against the newest anchored tree head. (#486, #490, #512)
- Each receipt stores its canonical signed bytes at issuance and pins the issuer history snapshot it was signed under. (#473)

### Changed
- A public receipt shows only its own log entry. (#511)

### Verifier
- chit402-verify 0.3.0: checks the canonical receipt bytes and the pinned issuer history.
- chit402-verify 0.3.4: stricter trust rules for holder documents.
- chit402-verify 0.3.5: receipt versions the gateway never issued fail closed.

## 2026-09-28 to 2026-10-02

### Added
- Public Merkle log of receipts, with each signed tree head anchored on Base. The public log in production begins on 2026-10-02. (#447, #451)
- The daily receipt root is also anchored on Solana. (#453)
- Anchors are tied to the chain clock. (#454)
- Receipts sign the tree head they were issued under. (#468)

### Fixed
- Receipt lookup by transaction finds stamped receipts. (#466)

### Verifier
- chit402-verify 0.2.0: only trusted issuer keys verify.

## 2026-08-31 to 2026-09-11

### Added
- Payment receipts with stable receipt ids, a public receipt URL, and lookup by transaction. (#251, #253)
- ES256 issuer signature on every receipt, checkable against the public JWKS at `/.well-known/jwks.json`. The production key first signed on 2026-09-04. (#279, #292)

### Verifier
- chit402-verify 0.1.0: offline receipt verifier on npm.
- chit402-verify 0.1.1: pinned issuer key first, offline.

From 0.3.4 on, each chit402-verify version is also published as `@xfuel/verify`.
