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

### Who issues the receipt

Chit issues the receipt in production. `issuer_signature` binds to the facilitator's settlement, not to the agent's word. After settle, the facilitator response carries the transaction hash, the network, and the payer. Those are the values `PAYMENT-RESPONSE` and `X-PAYMENT-RESPONSE` expose, and they are what the signed claims store: `payment.ref` is `<network>:<tx hash>`, and `caller_binding.payer_wallet` is that payer.

Facilitator JSON shapes differ. Coinbase CDP returns `transaction`. Other settle bodies use `txHash` for the same field. PayAI settles Solana. A self-hosted facilitator returns `{ success, transaction, network, payer }`. The gateway reads `transaction` or `txHash`, and `payer`, and emits one receipt and one `PAYMENT-RESPONSE` body: `success`, `transaction`, a CAIP-2 `network`, and `payer`.

## Verify path

1. **Fetch the receipt by id.** `GET /receipt/:id?format=json`, or `chit_verify_url` when the entry sets it. Chit402: `GET https://api.chit402.com/receipt/<chit_receipt_id>?format=json`.
2. **Verify the signature against the published key.** ES256-verify `issuer_signature.jws`. The key is the JWKS entry whose `kid` equals `issuer_signature.kid`, fetched from the issuer's `/.well-known/jwks.json`. For Chit402 that URL is https://api.chit402.com/.well-known/jwks.json.
3. **Check payer, payee, and amount against the on-chain transaction.** Read `caller_binding.payer_wallet`, `payment.payee`, `payment.asset`, `payment.gross_amount`, and `payment.ref` from the verified JWS claims. On Base, the USDC `Transfer` log in that transaction, from the payer to the payee, of that asset, must sum to at least `gross_amount`. A mismatch between the verified claims and the unsigned outer `payment` / `caller_binding` fails the receipt.
4. **Compare fingerprints.** For `fingerprint_alg` `1f916-entry-hash`, compare `agent_record_entry.fingerprint` to the hash the registry publishes on that log entry. For `provisional-sha256-jcs`, hash the JCS form of the entry and compare. `registry` is `1f916`.

`xfuel-verify` covers steps 2 and 3 for a receipt JSON file. It does not compare `agent_record_entry.fingerprint`.

`scripts/verify-1f916-link.mjs` fetches the receipt, checks the signature against the Chit JWKS, checks the signed book chain, checks the Base transaction on a public RPC, and compares `agent_record_entry.fingerprint` to the hash 1F916 publishes for the claimed identity-log event. It prints PASS or FAIL per step. Node built-ins only.

```bash
curl -sS "https://api.chit402.com/receipt/<chit_receipt_id>?format=json" -o receipt.json
npx xfuel-verify receipt.json --fetch-jwks --check-payer
```

`--fetch-jwks` loads `verification.jwks_uri` when the host is allowlisted (`api.chit402.com`). For any other issuer, pass the published key explicitly:

```bash
npx xfuel-verify receipt.json --jwks-url "https://<issuer-origin>/.well-known/jwks.json" --check-payer
```

`--check-payer` queries Base or Solana and checks payer, payee, asset, and amount. `xfuel-verify` does not run step 4. `scripts/verify-1f916-link.mjs` does, against the specimen file. Issuance still does not stamp `agent_record_entry` on the receipt.

The instruction and the money are bound when steps 2, 3, and 4 succeed. A receipt with no `agent_record_entry` can still verify as a payment. It does not bind an Agent Record entry.

## Specimens

**Stamped.**

| | Specimen 1 | Specimen 2 |
|--|--|--|
| Listing | [55](https://1f916.ai/api/listings/55) | [45](https://1f916.ai/api/listings/45) |
| Award | 17, submission 839, observed transfer 171 | 16, submission 802, observed transfer 161 |
| Amount | 1000000 atomic USDC | 500000 atomic USDC |
| Our payout tx | `0x909d738d79ff4c9885cd9ed0755636565ee3ddf0406ef6f454e7fbf797990ce9` | `0x233acdcf3d78436d63a0dba00092fb9a8fe806a3ecd1b415a4d364144baffebd` |
| Funder | `0x9f8951cb8b060f52fdf87297b3c5b00f7aa18f52` | `0xe3aa1174f773cb266c69e6be909e9e777b50c87d` |
| Sealed event | identity_events `20498` | identity_events `17514` |
| Fingerprint | `a09e1e0b0aed6a7826b55281ef1e8af19fb164034a662d122adaa503b54f7dc2` | `b4874aa36c769b41b7566cee64c601e4074ff9b57349bfb5f1eb704bfddc1447` |
| File | https://www.chit402.com/specimens/1f916-link-1.json | https://www.chit402.com/specimens/1f916-link-2.json |
| Receipt | [foreign-x402-muq262x0-1467b076fc62](https://api.chit402.com/receipt/foreign-x402-muq262x0-1467b076fc62) | [foreign-x402-muq264r9-69896464bb19](https://api.chit402.com/receipt/foreign-x402-muq264r9-69896464bb19) |

Each file sets `chit_receipt_id` and `chit_verify_url` to that house-book receipt. `chit_verify_url` is the receipt path with no query. The verifier also accepts the same URL with `?format=json`.

```bash
cd services/gateway && node scripts/stamp-foreign-payout.mjs --chain base --tx 0x909d738d79ff4c9885cd9ed0755636565ee3ddf0406ef6f454e7fbf797990ce9 --fingerprint a09e1e0b0aed6a7826b55281ef1e8af19fb164034a662d122adaa503b54f7dc2 --tx 0x233acdcf3d78436d63a0dba00092fb9a8fe806a3ecd1b415a4d364144baffebd --fingerprint b4874aa36c769b41b7566cee64c601e4074ff9b57349bfb5f1eb704bfddc1447
```

The command reads each tx, checks the USDC transfer with the foreign-ingest verifier, and appends a row only when `STAMP_WAIVER_KEYS` still has a free stamp. The new row keeps the HMAC and `book_chain` v4, and adds an issuer JWS over the tx, chain, payer, payee, amount, and the `--fingerprint` when one is passed. It does not broadcast a transaction. Restart the gateway afterward so `GET /receipt` reloads the book. A filled `chit_receipt_id` is what the verifier fetches.

```bash
node scripts/verify-1f916-link.mjs https://www.chit402.com/specimens/1f916-link-1.json
```

A specimen whose `chit_receipt_id` is absent still prints `pending_first_stamp` on `fetch_receipt`. These two files are stamped, so that step fetches the receipt.

## What issuance will do later

When issuance support lands, a receipt that was asked to bind an entry will include `agent_record_entry` as this unsigned object. Payment `payload_version` stays unchanged. This document is the field contract for that later change.
