# Public record (`chit402.public.v1`)

A public record is a **derived statement**. It is not the receipt. Signing one does not change the receipt, the log leaf, the tree head, or an anchor.

The record is a compact JWS, `typ: chit402.public+jws`, payload schema `chit402.public.v1`. It is signed once by the background job (`services/gateway/scripts/sign-public-records.mjs`, or `PUBLIC_RECORD_JOB=true`) with the same issuer key that signs receipts. `GET /receipt/:id/public` only reads stored bytes. It never signs.

`payment_tx` is not in the record. The verifier cannot check the chain payment from the record. A green result says payment was not checked.

`xfuel-verify` prints `PUBLIC_VERIFIED` and exits 0 when the signature, the key at `public_signed_at`, and inclusion under a signed head all hold. `--json` sets `scope` to `"public"` and `not_checked` to payer, agent, content, and usage. The verdict is never `VERIFIED`. There is no `--require-full` flag. v10 and v11 records say `leaf_binding: "issuer_asserted"`. A record with `leaf_hash: null` is `PUBLIC_SIGNED_NOT_IN_LOG` and exits 1. An unknown schema or receipt version exits 2. A full receipt JWS whose sha256 does not equal `full_receipt_sha256` exits 1 (`public_full_mismatch`).

Serving is off unless `PUBLIC_RECORD_SERVE=true`. The job is off unless `PUBLIC_RECORD_JOB=true`. Both default off.

**PR540-ROTATION-TRUST must land before any record is served.** This verifier judges the kid at `public_signed_at` when issuer history is supplied (`--issuer-history-file`). The one-pin trust path still breaks records signed after a rotation until that fix is the published verifier. Do not turn serving on before that verifier is what operators run.

Option B (salted commitments inside the receipt) is parked. This record does not use salts.
