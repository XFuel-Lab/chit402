# Virtuals ACP — Chit402 stamp path

Status: **shipped** · www: https://chit402.com/docs/acp

## Preferred path

Agents **keep ACP** for agent commerce and wallet flows. Route **inference spend** through Chit402 so the principal gets a signed receipt:

- `POST /v1/chat/completions` @ `https://api.chit402.com/v1`
- Pay USDC on Base (x402)
- Hold `verify_url` — hub, model, amount

ACP settle and Chit inference receipt are complementary, not competing products.

## Optional — foreign / PayBox ingest

**Spent elsewhere → stamp here** — complementary to PayBox/x402, not competing. See [foreign-paybox-ingest.md](./foreign-paybox-ingest.md).

When inference already paid another x402 shop (or PayBox settle), a registered principal can record the row:

```http
POST /v1/agents/:agent_id/book/ingest
X-API-Key: <partner-key>
X-Xfuel-Session: <possession-session>
Content-Type: application/json

{
  "payment_required": { "resource": "...", "amount": "...", "payTo": "0x..." },
  "payment_response": { "tx": "0x...", "payer": "0x..." }
}
```

Requires prior `POST /v1/agents/register` with a collected (non-demo) receipt.

Helper: `ingestForeignX402ToBook` from `@xfuel/adapters/ingest` (alias `chit402-adapters/ingest`).

## Design-partner paste block

```text
We use Chit402 as the inference receipt book — not a cheaper model router.
Point chat-completions at api.chit402.com/v1, pay USDC on Base, hold verify_url.
ACP can keep its own settle path; Chit stamps hub/model/amount for finance.
Register once (POST /v1/agents/register) to hold the possession-gated book.
```

## Do not

- Fork ACP or replace Virtuals wallet flows
- Lead with ~$0.01 floor pricing in partner copy
- Default to SP1 — signed ES256 receipt is table stakes
