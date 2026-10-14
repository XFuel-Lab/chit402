# Public record (`chit402.public.v1`)

A public record is a **derived statement**. It is not the receipt. Signing one does not change the receipt, the log leaf, the tree head, or an anchor.

The record is a compact JWS, `typ: chit402.public+jws`, payload schema `chit402.public.v1`. It is signed once, with the same issuer key that signs receipts. The bytes are fsynced to a temp file and linked into `PUBLIC_RECORD_DIR`. The first link wins. An empty or non-JWS file is not a record. A crash before the link leaves no `.jws`. The server and the backfill script share that variable. When it is unset, both use `services/gateway/.data/public-records`. A file linked into the folder is read on the next lookup. `GET /receipt/:id/public` only reads stored bytes. It never signs.

Payment fields are copied from the signed receipt claims only. A missing claim is omitted or the record is not signed. The outer quote is not a fill-in. `payment_tx` is not in the record. The verifier cannot check the chain payment from the record. A green result says payment was not checked.

`chit402-verify` takes one receipt id, url, or file. The flags are `--issuer-history` and `--json`. There is no `--jwks-file`, `--inclusion`, or `--head`. The record, the inclusion proof, and the signed head are fetched from that one receipt URL. Trust is the pinned kid plus issuer history that verifies under the pin. A kid outside that set is `key untrusted`.

`PUBLIC_VERIFIED` exits 0 and `--json` sets `scope` to `"public"`. It does not print a full-receipt `VERIFIED`. v10 and v11 records say `leaf_binding: "issuer_asserted"`. A record with `leaf_hash: null` is `PUBLIC_SIGNED_NOT_IN_LOG` and exits 1. An unknown schema or receipt version exits 2. A full receipt from that URL whose sha256 does not equal `full_receipt_sha256` exits 1 (`public_full_mismatch`). The kid window uses `public_signed_at`.

`PUBLIC_RECORD_JOB` defaults off. `PUBLIC_RECORD_SERVE` defaults off, and serving stays off while `ROTATION_TRUST_SHIPPED` is false. The flag alone does not serve a record.

**ROTATION-TRUST must be the verifier operators run before any record is served.**

Option B (salted commitments inside the receipt) is parked. This record does not use salts.
