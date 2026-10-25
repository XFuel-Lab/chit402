# Issuer key history

`GET /.well-known/jwks.json` publishes the key that signs receipts now. `GET /.well-known/issuer-history.json` publishes every key that has signed, including retired and revoked ones, so a stranger can check that a receipt's `kid` was allowed to sign at `iat`.

The document is schema `chit402.issuer_history.v1`. The current issuer key signs `head_hash`, `entry_count`, and, on a sealed snapshot, `version` and `seq` (ES256, `typ: chit402-issuer-history+jwt`). Each entry's `entry_hash` is SHA-256 of the JCS (RFC 8785) UTF-8 bytes of the entry without `entry_hash`. `prev_hash` is the previous entry's `entry_hash`, or null on the first entry. Changing an old entry breaks the chain or the signature.

## Snapshots

A published document is sealed once. The response body is those stored JCS bytes. SHA-256 of the body is the snapshot hash. `X-Chit-Hash-Alg` is `sha256`. `X-Chit-History-Version` and `X-Chit-History-Seq` are the snapshot number (they match).

Sealed entries are append-only. A later snapshot may add entries. It must not change a sealed `entry_hash`. Production refuses a rebuild that would rewrite the sealed prefix (`issuer_history_rewrite`) and does not publish it. An in-place edit of the live entry (`ISSUER_HISTORY_EXTRA` or `not_before`) does not replace sealed bytes and does not stop signing. Retirement and revocation are an append. A test process drops an unrelated signing key and seals a new in-memory genesis only when `ISSUER_HISTORY_TEST_ROTATION=true` (the gateway test runner sets that). A development process pointed at a production directory does not drop unless that flag is set, and it does not append the non-extending snapshot. Every sealed snapshot stays at `?version=N` and `?hash=<sha256>`, including version 1. `?seq=` and any other query parameter are `400` `bad_query`.

Versions loaded from disk must be consecutive, and each snapshot must extend the previous entry chain. Boot refuses otherwise. The one exception is the production 2026-10 rewrite: version 1 head `3d8259fb043f8ac80c924ea89d508f0a898f70bd0335658ef47370d5757e27a6` to version 2 head `349d7bb495bad55aaa25d05ee91134575e6e7d300795b37b41f4bcf29af80f0e` (the v2 genesis entry dropped `custody`). Both versions stay served. Loading that pair appends a note to `issuer-history-notes.jsonl` (`chit402.issuer_history_note.v1`, kind `grandfathered_rewrite`). Any other non-extending pair fails closed.

A high-water mark (`version` and `head_hash`) is kept outside the history file: `issuer-history-high-water.json` beside the log, and `issuer_history` on `anchor-state.json` when `RECEIPT_LOG_DIR` is set. Boot refuses when the history file is shorter than that mark (`issuer_history_truncated`). Truncating the file and sealing again cannot reissue a version with new bytes. A later receipt-log snapshot write keeps `issuer_history` on the anchor file.

`GET /.well-known/issuer-history.json` is the snapshot in effect now. `GET /.well-known/issuer-history.json?version=N` and `?hash=<sha256>` return an older snapshot. Old bytes are not rewritten when a key is appended. Sealed snapshots are appended to `issuer-history-versions.jsonl` next to the book ledger when the gateway persists tasks. A restart serves those bytes again. A payload version 10 receipt pins `{ hash, version, seq }` inside the JWS (`issuer_history`). `hash` is SHA-256 of that snapshot's stored bytes. `xfuel-verify` fetches that version and requires the same bytes. The gateway still issues payload version 10.

## Entry

| Field | Meaning |
|-------|---------|
| `kid` | RFC 7638 thumbprint. Receipts already carry this. |
| `jwk` | Public P-256 JWK. No private material. |
| `alg` | `ES256`. |
| `not_before` | First instant this key may sign. |
| `not_after` | Last instant, or null while the key is current. |
| `status` | `active`, `retired`, or `revoked`. |
| `revoked_at` | When a revoked key stopped being valid. Null otherwise. |
| `reason` | Short revocation note, or null. |
| `custody` | Where the private key is held. |

Custody: since 2026-10-20 the ES256 private key is held in a cloud KMS, and the KMS is the only production signer. The key is no longer in the gateway environment. The kid is unchanged. The history sentence names where the key is held. It is not the key.

## The current key

The production kid is `IvFpmC-vPhkY_v0vidsrWVT9uzlE5XWKZgAEOeJTq1Q`. Its `not_before` is `2026-09-04T08:52:05Z`, the first deployment of this ES256 receipt path (`fix(receipt): standard JWT/JWS mechanics`). The earliest receipt in this repo signed by that kid is fixture `chit-5d775d12`, `iat` `2026-09-26T17:27:32Z`. The host ledger is not in the repo, so that kid's `not_before` is the earlier deployment date. Every captured receipt for that kid falls inside the window.

That date belongs to that kid only. A rotated key does not inherit it. Set `not_before` on the key's history entry, or set `ISSUER_KEY_NOT_BEFORE` for the live non-production key. If neither is set, `not_before` is null and a receipt check fails closed (`not_before_missing`).

A later key is appended. Set `ISSUER_HISTORY_EXTRA` to a JSON array of earlier entries (retired or revoked) when the first snapshot is sealed. The live process key stays the tail. After a snapshot is sealed, editing that entry in place is ignored: signing keeps the sealed bytes. A retired thumbprint is not reused. Retire or revoke with the offline script below.

## Check

`chit402-verify` reads the receipt's `kid` and `iat`. The earliest `revoked_at` and the earliest `not_after` across every entry for that kid stay in force. A later active row does not clear them. `not_before` is the latest stamp for that kid, so a later row cannot widen the window backwards. It fails if `iat` is outside `not_before` / `not_after`, or if a `revoked_at` is missing or not after `iat`. A receipt signed before revocation still verifies. A history that moves a kid from `revoked` to any later status, from `retired` to `active`, or to a different `not_before`, is `kid_status_regression`. History is always checked. A loaded history that fails the window is INVALID, exit 1.

With no file, the command uses a live snapshot that prefix-extends the copy shipped in the package, or that copy alone. `--issuer-history <file>` is the offline file. The file must prefix-extend the shipped snapshot. A file that does not is INVALID, exit 1. There is no flag to skip the check.

A new key whose `not_before` is at or before an earlier key's `not_before` is `inherited_key_window`. A history signed only by a key that first appears after the genesis entry is `introduced_key_signature`. A one-entry history signed by that key is the genesis case and verifies. When the environment signer is selected, production refuses to boot when `ISSUER_PRIVATE_KEY` is missing or empty. `ALLOW_EPHEMERAL_ISSUER_KEY`, `ISSUER_ROOT_ENABLED`, and `ISSUER_ROOT_ALLOW_SKIP` do not override that. Unset `NODE_ENV` is production.

```bash
# Issuer history is checked inside the command.
npx chit402-verify "https://api.chit402.com/receipt/xfuel-3155b7d8-4315-44bc-bfdc-bf6b78ff2d15"
# VERIFIED_PUBLIC, exit 0. The payer is not claimed.

# Optional: the current issuer-history snapshot (version 2).
curl -sS "https://api.chit402.com/receipt/xfuel-3155b7d8-4315-44bc-bfdc-bf6b78ff2d15?format=json" -o receipt.json
curl -sS "https://api.chit402.com/.well-known/issuer-history.json" -o issuer-history.json
npx chit402-verify receipt.json --issuer-history issuer-history.json
# VERIFIED_PUBLIC, exit 0.
```

The live snapshot is version 2. Pass that file, or pass no file. `?version=1` is an older snapshot. On this receipt, chit402-verify 0.4.11 reports INVALID (`issuer_history_not_extension`) for that file. Exit 0 is VERIFIED when the payer check passed, or VERIFIED_PUBLIC for a public attestation. Exit 1 is INVALID. Exit 2 is COULD_NOT_CHECK.

## Retire or revoke

The live key signs one new history entry. The sealed prefix is unchanged. The script does not listen. Two people confirm: `ISSUER_HISTORY_OPERATOR` and `ISSUER_HISTORY_APPROVER` must both be set and must differ, and `--confirm YES` is required.

```bash
cd services/gateway
ISSUER_PRIVATE_KEY=... \
ISSUER_HISTORY_OPERATOR=alice \
ISSUER_HISTORY_APPROVER=bob \
npm run retire-issuer-key -- \
  --status revoked \
  --not-before 2026-10-13T00:00:00.000Z \
  --revoked-at 2026-10-13T00:00:00.000Z \
  --reason compromised \
  --confirm YES
```

`--status retired` takes `--not-after` instead of `--revoked-at`. The append is written to the same history file the gateway serves (`AGENTS_DIR`, or the agents directory beside `TASK_STORE_DIR`). Boot calls the history check after the store loads and before listen. A signing key that has any `retired` or `revoked` entry refuses to serve (`issuer_key_not_active`). The script refuses an append that would move a revoked key, or turn a retired key active again (`kid_status_regression`). A stale in-place edit does not.

Page: https://www.chit402.com/docs/receipt-check
