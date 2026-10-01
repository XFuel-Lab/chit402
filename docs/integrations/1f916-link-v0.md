# 1F916 Agent Record link — Draft v0

**Draft v0, feedback welcome.**

Public page: https://www.chit402.com/docs/1f916-link

This note specifies how a [1F916](https://1f916.ai/) Agent Record entry and a Chit receipt name each other, so one offline check covers the instruction and the money. It answers the schema, the issuer, and the verify path asked for on [post 7404](https://1f916.ai/post/7404) ([JSON](https://1f916.ai/api/post/7404), comments 88731 and 88757).

**Issuance support is coming.** Chit402 does not stamp `agent_record_entry` on receipts in this revision. A receipt fetched today will not contain the field. Nothing in gateway issuance, `packages/verify`, or the payment JWS changes here.

The Agent Record wire is [draft-maintainer-1f916-agent-record](https://datatracker.ietf.org/doc/draft-maintainer-1f916-agent-record/) (text reviewed: draft-01, 12 August 2026).

## Entry side (1F916)

Two fields on the Agent Record entry:

| Field | Type | Rule |
|-------|------|------|
| `chit_receipt_id` | string | The receipt id accepted by `GET /receipt/:id`. On Chit402 this is the id in `verify_url` (the `chit-…` path id). |
| `chit_verify_url` | string | Optional absolute URL for that receipt. |

`chit_receipt_id` is **optional** on an entry that does not move money.

`chit_receipt_id` is **required** when the entry asserts that a payment happened (a money-moving entry). A money-moving entry without it is **`unverified payment claim`**, not invalid. The Agent Record entry stays valid. This draft does not ask the registry to reject the write. A reader who wants the instruction and the money in one check treats that classification as an unlinked payment claim.

An entry asserts a payment when it claims value moved: a settled transfer, a paid call, or a payout. A quote, a discussion, or an intention that did not settle is not money-moving, and `chit_receipt_id` stays optional there.

When `chit_verify_url` is absent, a Chit402 id resolves at:

```
GET https://api.chit402.com/receipt/<chit_receipt_id>?format=json
```

## Receipt side (Chit)

`agent_record_entry` is an unsigned object beside `book_seq`, in the same posture as [`receipt_lane`](../product/receipt-lane.md) and `supersession` ([RECEIPT_SCHEMA_V2.md](../RECEIPT_SCHEMA_V2.md)).

The payment JWS has a fixed claim set. `book_chain` (`chit402.book_seq.v1`) is its own signed object with its own `payload_version`. There is no open slot on the payment JWS for an extra signed claim. This field follows the unsigned siblings: `signed: false`. It does not change payment `payload_version`, the HMAC array, or `book_chain`.

| Field | Meaning |
|-------|---------|
| `schema` | `chit402.agent_record_entry.v0` |
| `signed` | `false` |
| `registry` | `1f916` |
| `fingerprint` | Lowercase hex hash of the Agent Record entry, under `fingerprint_alg` |
| `fingerprint_alg` | Which rule produced `fingerprint` |

```json
"agent_record_entry": {
  "schema": "chit402.agent_record_entry.v0",
  "signed": false,
  "registry": "1f916",
  "fingerprint": "<lowercase hex>",
  "fingerprint_alg": "provisional-sha256-jcs"
}
```

`registry` is `1f916` in this version.

### Fingerprint

`fingerprint` is the entry's hash.

draft-01 names an entry hash: each event carries the hash of its predecessor, and the registry builds an RFC 6962 Merkle tree over the sealed events' hashes (Section 2.1 of RFC 6962). The same draft canonicalizes JSON with JCS (RFC 8785) for attestations and for the dossier core (`1f916.record.v1:<sha256_hex>`). draft-01 does not publish the preimage of the entry hash and does not define a field named `fingerprint`.

Until a revision of `draft-maintainer-1f916-agent-record` names those bytes, verifiers apply this rule:

1. When the entry already carries the hash the registry publishes for that log entry, that value is `fingerprint` and `fingerprint_alg` is `1f916-entry-hash`.
2. Otherwise `fingerprint` is **provisional**: lowercase hex SHA-256 of the JCS (RFC 8785) canonical form of the entry. `fingerprint_alg` is `provisional-sha256-jcs`.

Both sides use the same `fingerprint_alg`. The provisional algorithm is retired when the draft names the entry hash preimage; verifiers then use that algorithm.

## Issuer

The receipt's existing signing field identifies who signed it: `issuer_signature` (ES256). `issuer_signature.kid` is the RFC 7638 thumbprint of the signing key. The JWS claim `iss` is the issuer's name.

Today Chit402 issues. Live receipts carry `iss` `chit402` and kid `IvFpmC-vPhkY_v0vidsrWVT9uzlE5XWKZgAEOeJTq1Q`. The verifying key is published at:

- https://api.chit402.com/.well-known/jwks.json
- alias https://api.xfuel.app/.well-known/jwks.json

`verification.jwks_uri` on the receipt repeats the first URL. Pin and rotation: https://www.chit402.com/trust. Algorithm: [VERIFY_ALGORITHM.md](../VERIFY_ALGORITHM.md) §10.

The schema is issuer-agnostic. A facilitator, or any other party, is the issuer when it signs this same receipt format with a key published at `https://<issuer-origin>/.well-known/jwks.json`. Verification matches `issuer_signature.kid` to that published key. It uses the signature plus the chain check. The `iss` string is a label. Embedded `issuer_jwk` is a convenience copy, not a trust root, unless its thumbprint equals a key the verifier already pinned.

## Verify path

1. **Fetch the receipt by id.** `GET /receipt/:id?format=json`, or `chit_verify_url` when the entry sets it. Chit402: `GET https://api.chit402.com/receipt/<chit_receipt_id>?format=json`.
2. **Verify the signature against the published key.** ES256-verify `issuer_signature.jws`. The key is the JWKS entry whose `kid` equals `issuer_signature.kid`, fetched from the issuer's `/.well-known/jwks.json`. For Chit402 that URL is https://api.chit402.com/.well-known/jwks.json.
3. **Check payer, payee, and amount against the on-chain transaction.** Read `caller_binding.payer_wallet`, `payment.payee`, `payment.asset`, `payment.gross_amount`, and `payment.ref` from the verified JWS claims. On Base, the USDC `Transfer` log in that transaction, from the payer to the payee, of that asset, must sum to at least `gross_amount`. A mismatch between the verified claims and the unsigned outer `payment` / `caller_binding` fails the receipt.
4. **Compare fingerprints.** Hash the Agent Record entry with `fingerprint_alg` and compare to `agent_record_entry.fingerprint`. `registry` is `1f916`.

`xfuel-verify` covers steps 2 and 3 for a receipt JSON file. It does not compare `agent_record_entry.fingerprint`.

```bash
curl -sS "https://api.chit402.com/receipt/<chit_receipt_id>?format=json" -o receipt.json
npx xfuel-verify receipt.json --fetch-jwks --check-payer
```

`--fetch-jwks` loads `verification.jwks_uri` when the host is allowlisted (`api.chit402.com`). For any other issuer, pass the published key explicitly:

```bash
npx xfuel-verify receipt.json --jwks-url "https://<issuer-origin>/.well-known/jwks.json" --check-payer
```

`--check-payer` queries Base or Solana and checks payer, payee, asset, and amount. Step 4 stays a separate comparison until issuance stamps the field and the CLI grows a check for it.

The instruction and the money are bound when steps 2, 3, and 4 succeed. A receipt with no `agent_record_entry` can still verify as a payment. It does not bind an Agent Record entry.

## Worked example

No linked pair exists yet. The block below copies fields from a live receipt and marks the link fields as a placeholder. Do not treat the placeholder as a hash, and do not look for a 1F916 entry that carries this id.

Live receipt (no `agent_record_entry` on the wire today):

`GET https://api.chit402.com/receipt/chit-1ebc5616-d9ce-4da9-b56c-847062ff6b96?format=json`

Fetched 2026-10-01. Values below are from that response.

| Field | Value |
|-------|--------|
| `schema` | `xfuel.receipt.v4` |
| `task_id` | `xfuel-1ebc5616-d9ce-4da9-b56c-847062ff6b96` |
| `verify_url` path id | `chit-1ebc5616-d9ce-4da9-b56c-847062ff6b96` |
| `payment.rail` | `usdc` |
| `payment.ref` | `base:0xf63ed6a83106d84a04b18a53ebbd73ff4c1fce280ec1a6035c5bdc2bed283f6f` |
| `payment.gross_amount` | `2000` |
| `payment.asset` | `0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913` |
| `payment.payee` | `0x23f713411c30BBd9A989c9cbC22EB0b55F7f7334` |
| `caller_binding.payer_wallet` | `0x253695Ff2DAa549980D9181B962d042B73A5e499` |
| `route.provider` | `akash-network` |
| `route.model` | `akash/meta-llama/Llama-3.3-70B-Instruct` |
| `issuer_signature.alg` | `ES256` |
| `issuer_signature.kid` | `IvFpmC-vPhkY_v0vidsrWVT9uzlE5XWKZgAEOeJTq1Q` |
| `issuer_signature.payload_version` | `6` |
| `verification.jwks_uri` | `https://api.chit402.com/.well-known/jwks.json` |
| `book_seq` | `1` |
| `receipt_lane.signed` | `false` |

The JWS `iss` claim on this receipt is `chit402`.

Placeholder entry fields, using that live id. No Agent Record entry publishes them today:

```json
{
  "chit_receipt_id": "chit-1ebc5616-d9ce-4da9-b56c-847062ff6b96",
  "chit_verify_url": "https://api.chit402.com/receipt/chit-1ebc5616-d9ce-4da9-b56c-847062ff6b96?format=json"
}
```

Placeholder receipt object. **Not present** on the live JSON. `fingerprint` is the sentinel `PLACEHOLDER`, not a hash:

```json
"agent_record_entry": {
  "schema": "chit402.agent_record_entry.v0",
  "signed": false,
  "registry": "1f916",
  "fingerprint": "PLACEHOLDER",
  "fingerprint_alg": "provisional-sha256-jcs"
}
```

Verify the live receipt as it exists today (signature and chain only):

```bash
curl -sS "https://api.chit402.com/receipt/chit-1ebc5616-d9ce-4da9-b56c-847062ff6b96?format=json" -o receipt.json
npx xfuel-verify receipt.json --fetch-jwks --check-payer
```

## What issuance will do later

When issuance support lands, a receipt that was asked to bind an entry will include `agent_record_entry` as this unsigned object. Payment `payload_version` stays unchanged. This document is the field contract for that later change.
