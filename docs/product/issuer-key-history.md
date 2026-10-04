# Issuer key history

`GET /.well-known/jwks.json` publishes the key that signs receipts now. `GET /.well-known/issuer-history.json` publishes every key that has signed, including retired and revoked ones, so a stranger can check that a receipt's `kid` was allowed to sign at `iat`.

The document is schema `chit402.issuer_history.v1`. The current issuer key signs `head_hash` and `entry_count` (ES256, `typ: chit402-issuer-history+jwt`). Each entry's `entry_hash` is SHA-256 of the JCS (RFC 8785) UTF-8 bytes of the entry without `entry_hash`. `prev_hash` is the previous entry's `entry_hash`, or null on the first entry. Changing an old entry breaks the chain or the signature.

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
curl -sS "https://api.chit402.com/receipt/chit-39af100b-23dd-4d86-a16b-4556ca6796af?format=json" -o receipt.json
curl -sS "https://api.chit402.com/.well-known/issuer-history.json" -o issuer-history.json
npx -p @xfuel/verify xfuel-verify receipt.json --issuer-history-file issuer-history.json
```

That check works once the gateway serving `api.chit402.com` is running this build. Until then the history URL is absent and `xfuel-verify` warns unless `--strict-issuer-history` is set.

Page: https://www.chit402.com/docs/receipt-check
