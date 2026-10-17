# Issuer signing key in AWS KMS

The gateway signs receipts with an env key by default. `ISSUER_SIGNER=kms` is opt-in. With the variable unset, signatures, `kid`, and JWKS stay on the env key. The verifier package does not change for that path.

No production cutover is in this change. Do not point a live host at KMS until Phase 1 or Phase 2 below has been rehearsed on a staging process.

## Env

| Variable | Required | Default | Meaning |
|---|---|---|---|
| `ISSUER_SIGNER` | no | `env` | `env` or `kms`. Any other value refuses to boot. |
| `ISSUER_PRIVATE_KEY` | env signer, production | unset | Base64 PEM. Ignored when the signer is `kms`. |
| `ISSUER_KID` | kms in production | production kid for the env signer | RFC 7638 thumbprint. KMS boot fails with `issuer_kid_mismatch` when it does not match `GetPublicKey`. |
| `ISSUER_KMS_KEY_ID` | kms | unset | Key ARN or alias. |
| `ISSUER_KMS_REGION` | kms | unset | Region of that key. |
| `ISSUER_KMS_TIMEOUT_MS` | no | `3000` | AbortSignal timeout on `GetPublicKey` and `Sign`. |
| `ISSUER_SIGNER_LOW_S` | no | unset | `true` normalises env signatures to low-S. Unset leaves env signatures byte-identical to `crypto.sign`. KMS signatures are always low-S. |
| `ISSUER_CAP_RECEIPTS_PER_HOUR` | no | unset | Receipt-kind signs per UTC hour. Unset means the cap is off. |
| `ISSUER_CAP_RECEIPTS_PER_DAY` | no | unset | Receipt-kind signs per UTC day. Unset means that window is off. |
| `ISSUER_CAP_SOFT_PCT` | no | `80` | Paid routes return 503 `issuance_paused` at or above this percent, before the 402 challenge and before settle. |
| `ISSUER_CAP_DB` | no | `.data/issuer-sign-counts.sqlite` (memory in test) | SQLite file for `issuer_sign_counts`. |

KMS init runs once at boot, before listen. A failed `GetPublicKey`, a key that is not `ECC_NIST_P256` / `SIGN_VERIFY` / `ECDSA_SHA_256`, or a kid mismatch refuses to boot. Sign failures throw `issuer_sign_unavailable` (timeout, throttle, service error) or `issuer_sign_invalid` (DER or self-verify). There is no fallback to `ISSUER_PRIVATE_KEY`.

`signJws` stays synchronous for the env signer. Calling it while the signer is `kms` throws `issuer_signer_async_required`.

## IAM policy (runtime principal)

```json
{"Version":"2012-10-17","Statement":[
 {"Sid":"Sign","Effect":"Allow","Action":"kms:Sign",
  "Resource":"arn:aws:kms:REGION:ACCT:key/KEY_ID",
  "Condition":{"StringEquals":{"kms:SigningAlgorithm":"ECDSA_SHA_256","kms:MessageType":["RAW","DIGEST"]},
               "IpAddress":{"aws:SourceIp":"STATIC_IP/32"}}},
 {"Sid":"Pub","Effect":"Allow","Action":["kms:GetPublicKey","kms:DescribeKey"],
  "Resource":"arn:aws:kms:REGION:ACCT:key/KEY_ID",
  "Condition":{"IpAddress":{"aws:SourceIp":"STATIC_IP/32"}}}]}
```

Inputs over 4096 bytes are hashed locally and sent as `DIGEST`; the algorithm is still `ECDSA_SHA_256`.

The runtime principal has no Decrypt, Verify, Create, Import, Disable, ScheduleKeyDeletion, PutKeyPolicy, or CreateGrant. Admin actions belong on a separate break-glass role.

## Phase 1 (same kid)

1. Create an external key: `aws kms create-key --key-spec ECC_NIST_P256 --key-usage SIGN_VERIFY --origin EXTERNAL` and alias `alias/chit402-issuer-v1`.
2. Import the current PKCS#8 material with `RSA_AES_KEY_WRAP_SHA_256`, then wipe the local DER. The RFC 7638 thumbprint does not change, so verifier 0.4.2 and existing receipts stay valid.
3. Dry-run: `ISSUER_SIGNER=kms ISSUER_KMS_KEY_ID=… ISSUER_KMS_REGION=eu-west-3 ISSUER_KID=… ISSUER_JWKS_URL=https://api.chit402.com/.well-known/jwks.json node scripts/issuer-kms-check.mjs`. It prints `kid`, `jwks match|mismatch|skipped`, and `PASS` or `FAIL <code>`.
4. Set `ISSUER_SIGNER=kms`, `ISSUER_KMS_KEY_ID`, `ISSUER_KMS_REGION`, and `ISSUER_KID`. Restart. `GET /health` and a local verify of a new receipt must succeed.
5. Leave `ISSUER_PRIVATE_KEY` in `.env` during the soak. `ISSUER_SIGNER=env` rollback needs it. Removing it is a separate later step. Keep one sealed offline backup until Phase 2.

Imported material does not prove the key was never copied. Keep this phase short.

## Phase 2 (new kid)

1. Create a KMS-generated key (`Origin=AWS_KMS`). `GetPublicKey` gives the new kid.
2. Append issuer history `seq+1`: the new kid `active` with `not_before`, and the old kid `retired` with `not_after`. The old key signs that entry. The new key must not be the sole signer.
3. Ship a verifier release that bundles the entry before cutover.
4. Cut over with `ISSUER_SIGNER=kms` and `ISSUER_KID` set to the new thumbprint. JWKS serves the active key.
5. Disable or schedule deletion of the Phase 1 key only after a soak. Keep the public JWK in history.

## Rollback

Before the history entry is published, set `ISSUER_SIGNER=env`, restore `ISSUER_PRIVATE_KEY` from the offline backup, and restart.

After the retire entry is published, env-signed receipts with `issued_at` after `not_after` fail `issued_after_not_after`. Do not roll back to the env key after that entry is published. Fix the KMS path or re-enable the key.

## Issuance cap

The cap counts receipt-kind signs only (`receipt.js`, `late-issue.js`, `refusal-receipt.js`). Tree heads, issuer history, anchor wallets, exports, and offers are not counted and are not blocked.

Counters live in `issuer_sign_counts(window_start, span, count)` with fixed UTC hour and day windows. The increment is its own SQLite transaction and finishes before the signer is awaited.

- Soft threshold (default 80%): paid routes return `503` `{ "error": "issuance_paused" }` and do not issue a 402 challenge or settle.
- Hard cap (100%): the signer throws `issuance_cap`. A paid in-flight row is parked on the durable late-issue row when `X402_LATE_ISSUE` is on. When that flag is off, the gateway logs `issuance_cap_lost_receipt` with the receipt id only and raises an alert.

`GET /health` includes `issuance.cap` with `hour_used`, `day_used`, and `state` (`off`, `open`, `soft`, `hard`). It does not include the cap limits.

## Dry run

```bash
ISSUER_SIGNER=kms ISSUER_KMS_KEY_ID=alias/chit402-issuer-v1 ISSUER_KMS_REGION=eu-west-3 ISSUER_KID=… \
  ISSUER_JWKS_URL=https://api.chit402.com/.well-known/jwks.json \
  node scripts/issuer-kms-check.mjs
```

The script calls `GetPublicKey`, signs one fixed message, and verifies it locally. When `ISSUER_JWKS_URL` is set it sends one GET (5 second timeout, no body) and requires exactly one published key whose `kid`, `x`, and `y` match the signer, then verifies that same signature with the JWKS key. It prints three lines and nothing else:

```
kid <kid>
jwks match
PASS
```

`jwks` is `match`, `mismatch`, or `skipped` when `ISSUER_JWKS_URL` is unset. A failure prints `FAIL <code>` and exits 1. `<code>` is the error code when it is a short lowercase token, otherwise `error`. The script does not print the signature, the key, env values, or the error message.

## Self-review (receipt signature checklist)

- §2 key resolution: kid comes from GetPublicKey, pinned via `ISSUER_KID` and checked against the JWKS.
- §3 rotation: Phase 1 keeps the kid; Phase 2 needs an old-key-signed history entry.
- §4 algorithm: ES256 bound to the key, DER strictly parsed, low-S, self-verify.
- §5 no re-signing on read: the signer is called only at issuance.
- §9 fail closed: no env fallback, a boot refusal and sign errors.
- Cost/DoS: issuance cap plus timeout.
- Open item: the verifier doesn't enforce low-S yet (G6).
