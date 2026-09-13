# Fulfillment receipt v1

Status: **shipped in gateway** · Chit402-only chrome (no parallel human receipt UI).

## Purpose

Generalize the Chit receipt envelope beyond chat completions into a paid **job object** strangers can re-check at `verify_url`:

`intent → authorization → payment.ref → output_commitment → verify_url`

Same public `GET /receipt/:task_id` surface and possession-gated `/book` rows — extend schemas, do not fork.

## Job kinds

`job_kind` (and optional `resource`) classify the paid work:

| Value | Typical source |
|-------|----------------|
| `completions` | Native `POST /v1/chat/completions` / A2A |
| `scrape` | Foreign x402 scrape / data job |
| `review` | Human or agent review stamp |
| `swap` | On-chain or DEX-adjacent job |
| `research` | Research / report deliverable |
| `acp_job` | Virtuals ACP-adjacent stamp (see [acp-stamp-path](../doors/acp-stamp-path.md)) |
| `other` | Explicit catch-all |

When omitted, the gateway infers from route `resource` where possible; native completions default to `completions`.

## Output commitment

- **Committed:** `output_commitment.hash` (keccak256 or sha256 deliverable digest) with `status: committed`.
- **Missing deliverable:** `status: UNVERIFIED` and `omission_rule: missing_deliverable_at_stamp` — payment evidence remains honest; never imply zero payment.

Completions map existing `output.hash` into `output_commitment` for one envelope.

## Intent / authorization

Reuses [#338 intent / attempt](./intent-retry-grouping.md):

- `intent.intent_id`, `intent.attempt_index` from headers or ingest body.
- `authorization.payer_wallet` binds payer ↔ `payment.ref` (same honesty as book export).
- Session possession stays on `/book`; public receipt does not leak session secrets.

## Ingest

`POST /v1/agents/:agent_id/book/ingest` accepts:

- Full x402 envelopes (unchanged).
- Minimal `foreign_invoice` / `fulfillment_invoice` with optional `job_kind`, `output_commitment`, `deliverable_hash`, `intent_id`, `attempt_index`.

Evidence remains `foreign_ingest` when Chit did not execute the hop.

## Book

`/book` and export rows include a compact `fulfillment` block (`job_kind`, `resource`, `output_commitment`, `intent`) alongside existing evidence enums.

## Verification

Issuer JWS (payload v7+) carries `fulfillment` claims alongside payment/route/output. Offline verify uses pinned `issuer_jwk` + JWKS as today.
