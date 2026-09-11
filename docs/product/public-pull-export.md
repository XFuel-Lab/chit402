# Public signed pull-export (treasury desk v1)

Chit402 is the **book** — possession-gated source of record for agent spend. The pull-export is a **treasury extension** for partners who poll on **next wake** instead of registering a webhook listener: a stable public URL returns a **JWKS-verifiable signed envelope** whose `document` matches live `/book/export` shape.

Push partners use [book webhook](book-webhook.md). Pull partners (e.g. hemei test(3)) use this surface.

Possession gates on live `/book`, `/book/export`, `/book/rotate`, and webhook admin are **unchanged**. This is a deliberate house-published redacted export — not an unauth dump of private books.

## Stable URL (hemei test3)

| Format in envelope | URL |
|--------------------|-----|
| JSON (`chit402.book_audit.v1` document) | `https://api.chit402.com/public/export/hemei-treasury` |
| CSV (document is CSV string) | `https://api.chit402.com/public/export/hemei-treasury?format=csv` |

Slug `hemei-treasury` scopes to house agent **149** (design-partner doc id). The document is the redacted stranger specimen (`specimen: true`) — same rows as [hemei stranger specimens](hemei-stranger-specimens.md), not a live private ledger.

## Envelope (`chit402.book_pull_export.v1`)

| Field | Notes |
|-------|--------|
| `schema` | `chit402.book_pull_export.v1` |
| `slug` | Stable slug (`hemei-treasury`) |
| `agent_id` | Scoped treasury row id (149 for hemei) |
| `format` | `json` \| `csv` — shape of `document` |
| `exported_at` | Envelope issue time |
| `specimen` | `true` for house redacted fixtures |
| `verify_jwks` | `https://api.chit402.com/.well-known/jwks.json` |
| `document` | `chit402.book_audit.v1` object or CSV string |
| `document_media_type` | `application/json` or `text/csv; charset=utf-8` |
| `issuer_signature` | ES256 JWS (same issuer as receipts) |
| `pull_note` | Human note for treasury desk |

### `issuer_signature`

| Field | Notes |
|-------|--------|
| `alg` | `ES256` |
| `typ` | `chit402-pull-export+jwt` |
| `kid` | Key id — match to JWKS |
| `jws` | Compact JWS over canonical claims |
| `issuer_jwk` | Pinned public key (offline verify without live JWKS fetch) |

JWS payload claims: `schema`, `slug`, `agent_id`, `format`, `exported_at`, `document_sha256`, `specimen`, `iat`.

`document_sha256` is SHA-256 hex of `JSON.stringify(document)` (json format) or raw UTF-8 bytes (csv format).

## Verify (next wake, ~2h JWKS refresh)

1. `GET /public/export/hemei-treasury` → envelope
2. `GET /.well-known/jwks.json` → `{ keys: [...] }` (re-fetch periodically, ~2h)
3. Match `issuer_signature.kid` to JWKS key (or use pinned `issuer_jwk`)
4. Verify compact JWS (`issuer_signature.jws`) with ES256
5. Confirm payload `document_sha256` matches recomputed digest of `document`
6. Confirm payload `slug` and `agent_id` match envelope top-level fields
7. For each row, verify receipt via `verify_url` + per-receipt issuer JWS (table stakes)

Node (gateway test helper):

```js
import { verifyPublicPullExport } from './public-pull-export.js';
import { getJwks } from './issuer-key.js';

const envelope = await fetch('https://api.chit402.com/public/export/hemei-treasury').then(r => r.json());
const jwks = await fetch('https://api.chit402.com/.well-known/jwks.json').then(r => r.json());
const { valid, reason } = verifyPublicPullExport(envelope, jwks);
```

## Smoke check

```bash
curl -sf https://api.chit402.com/public/export/hemei-treasury | jq '.schema,.slug,.specimen,.issuer_signature.kid'
curl -sf 'https://api.chit402.com/public/export/hemei-treasury?format=csv' | jq '.format,.document_media_type' 
```

Gateway unit test: `services/gateway/test/hemei-public-pull-export.test.mjs`.

## Mint path for live scoped exports (future)

To publish a **live** redacted slice (not a house specimen), an operator with possession mints once via `PUT /v1/agents/:agent_id/book/export/publish` (not shipped in v1). Until then, treasury desks poll the stable specimen slug above.

## Not in v1

- Unauthenticated access to private books
- Webhook-style push (see book webhook)
- Architecture handoff beyond this envelope
