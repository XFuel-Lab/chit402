# Fulfillment receipt v1 — house smoke

Paid job envelope beyond chat completions: `intent → authorization → payment.ref → output_commitment → verify_url`.

Product lock: [fulfillment-receipt-v1.md](./fulfillment-receipt-v1.md) · gateway: `services/gateway/src/fulfillment-receipt.js`.

## Public specimen (no wallet)

Stranger-auditable shape for a **non-completions** foreign ingest row (`job_kind: research`):

`GET https://api.chit402.com/public/specimens/fulfillment-foreign-research.json`

The embedded `public_receipt` matches `GET /receipt/:task_id?format=json` for foreign ingest (evidence `foreign_ingest`).

## Regression — native completions (unchanged)

```bash
export CHIT402_BASE_URL=https://api.chit402.com
export X_API_KEY=…   # registered agent key

curl -sS -X POST "$CHIT402_BASE_URL/v1/chat/completions" \
  -H "Authorization: Bearer $X_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"model":"xfuel/auto","messages":[{"role":"user","content":"Reply ok."}],"max_tokens":8}' \
  | jq '{task_id, verify_url, job_kind: .fulfillment.intent.job_kind, output: .fulfillment.output_commitment.hash}'
```

Expect `job_kind` `"completions"`, non-null `verify_url`, and `output_commitment.hash` when the hop returns content.

Automated gate (no network): `cd services/gateway && npm test -- test/fulfillment-receipt.test.mjs test/receipt.test.mjs`

## Non-completions — foreign ingest (possession-gated write)

Requires a **register session** on the agent (`POST /v1/agents/register` → session token). Ingest does not return HTTP 402; missing possession is **401**.

```bash
export CHIT402_BASE_URL=https://api.chit402.com
export AGENT_ID=…
export BOOK_SESSION=…   # from register

DELIVERABLE='{"report":"smoke-v1"}'
# Optional: pre-hash deliverable (gateway also accepts raw `deliverable` and hashes server-side)

curl -sS -X POST "$CHIT402_BASE_URL/v1/agents/$AGENT_ID/book/ingest" \
  -H "Authorization: Bearer $BOOK_SESSION" \
  -H "Content-Type: application/json" \
  -d "{
    \"fulfillment_invoice\": {
      \"amount\": \"1000\",
      \"payer\": \"0xYourPayer\",
      \"payTo\": \"0xYourPayTo\",
      \"tx\": \"0xYourSettledTx\",
      \"network\": \"base\",
      \"hub\": \"research.example\",
      \"model\": \"/run\",
      \"resource\": \"https://research.example/v1/run\",
      \"job_kind\": \"research\",
      \"intent_id\": \"intent-smoke-1\",
      \"attempt_index\": 0,
      \"deliverable\": $DELIVERABLE
    }
  }" | jq '{task_id, verify_url, evidence, fulfillment}'
```

Stranger re-check (no auth):

```bash
curl -sS "$VERIFY_URL?format=json" | jq '{task_id, evidence, fulfillment, payment: .payment.ref}'
```

Principal book row (possession):

```bash
curl -sS "$CHIT402_BASE_URL/v1/agents/$AGENT_ID/book" \
  -H "Authorization: Bearer $BOOK_SESSION" \
  | jq '.entries[] | select(.task_id=="'"$TASK_ID"'") | {task_id, evidence, fulfillment, verify_url}'
```

## ACP / escrow submit (output commitment on job)

`POST /v1/agents/:agent_id/book/a2a-escrow` action `submit` accepts `fulfillment_receipt_id` and/or `output_commitment` (see [a2a-escrow-dispute-v1.md](./a2a-escrow-dispute-v1.md)). Use when counterparty delivery is a hash, not a native completion hop.

## Issuer JWS

Fulfillment claims ride in issuer payload **v7+** (`receipt.issuer_signature.payload_version`). Offline verify: pinned `issuer_jwk` / `GET /.well-known/jwks.json` — same as completions.
