# Issuer key history

`GET /.well-known/jwks.json` publishes the key that signs receipts now. `GET /.well-known/issuer-history.json` publishes every key that has signed, including retired and revoked ones, so a stranger can check that a receipt's `kid` was allowed to sign at `iat`.

The document is schema `chit402.issuer_history.v1`. The current issuer key signs `head_hash`, `entry_count`, and, on a sealed snapshot, `version` and `seq` (ES256, `typ: chit402-issuer-history+jwt`). Each entry's `entry_hash` is SHA-256 of the JCS (RFC 8785) UTF-8 bytes of the entry without `entry_hash`. `prev_hash` is the previous entry's `entry_hash`, or null on the first entry. Changing an old entry breaks the chain or the signature.

## Snapshots

A published document is sealed once. The response body is those stored JCS bytes. SHA-256 of the body is the snapshot hash. `X-Chit-Hash-Alg` is `sha256`. `X-Chit-History-Version` and `X-Chit-History-Seq` are the snapshot number (they match).

`GET /.well-known/issuer-history.json` is the snapshot in effect now. `GET /.well-known/issuer-history.json?version=N` and `?hash=<sha256>` return an older snapshot. Old bytes are not rewritten when a key is appended or `not_after` is set. Sealed snapshots are appended to `issuer-history-versions.jsonl` next to the book ledger when the gateway persists tasks. A restart serves those bytes again. A new receipt pins `{ hash, version, seq }` inside the JWS (`issuer_history`). `xfuel-verify` fetches that version, checks the hash, and reads `not_after` from the pinned entry. A later snapshot's `not_after` does not replace the one the receipt pinned.

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

Custody, as the process is written: the ES256 private key is the base64 PEM in the gateway environment variable `ISSUER_PRIVATE_KEY`. The process does not call a cloud KMS. When that variable is unset, a local run generates an ephemeral key. Production sets the variable. The history sentence names that location. It is not the key.

## The current key

The production kid is `IvFpmC-vPhkY_v0vidsrWVT9uzlE5XWKZgAEOeJTq1Q`. Its `not_before` is `2026-09-04T08:52:05Z`, the first deployment of this ES256 receipt path (`fix(receipt): standard JWT/JWS mechanics`). The earliest receipt in this repo signed by that kid is fixture `chit-5d775d12`, `iat` `2026-09-26T17:27:32Z`. The host ledger is not in the repo, so that kid's `not_before` is the earlier deployment date. Every captured receipt for that kid falls inside the window.

That date belongs to that kid only. A rotated key does not inherit it. Set `not_before` on the key's history entry, or set `ISSUER_KEY_NOT_BEFORE` for the live non-production key. If neither is set, `not_before` is null and a receipt check fails closed (`not_before_missing`).

A later key is appended. Set `ISSUER_HISTORY_EXTRA` to a JSON array of earlier entries (retired or revoked) when rotating. The live process key stays the tail. A retired thumbprint is not reused.

## Check

`xfuel-verify` reads the receipt's `kid` and `iat`. It fails if `iat` is outside `not_before` / `not_after`, or if `status` is `revoked` and `revoked_at` is missing or not after `iat`. A receipt signed before revocation still verifies.

If the history URL cannot be fetched, the command warns and still verifies the signature. `--strict-issuer-history` fails closed instead. `--issuer-history-file` uses a saved document and does not fetch. `--no-issuer-history` skips the window.

```bash
curl -sS "https://api.chit402.com/receipt/RECEIPT_ID?format=json" -o receipt.json
curl -sS -D - "https://api.chit402.com/receipt/RECEIPT_ID/preimage" -o preimage.json
# X-Chit-Hash-Alg: sha256
# sha256(preimage.json) matches payload_hash in the receipt JWS
curl -sS "https://api.chit402.com/.well-known/issuer-history.json?version=1" -o issuer-history.json
npx -p @xfuel/verify xfuel-verify receipt.json --canonical-preimage preimage.json --issuer-history-file issuer-history.json
```

Use the `version` from the receipt's signed `issuer_history`, not always `1`. A receipt issued before payload version 10 has no stored canonical object: `/preimage` is 404, and `xfuel-verify` still checks the signature. A pinned receipt fails closed when that snapshot cannot be fetched. An unpinned receipt warns unless `--strict-issuer-history` is set. This works once the gateway serving `api.chit402.com` is running this build.

Page: https://www.chit402.com/docs/receipt-check
