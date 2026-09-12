# Foreign / PayBox ingest seat

Status: **shipped** · API: `POST /v1/agents/:agent_id/book/ingest`

## Positioning

**Spent elsewhere → stamp here.** MoonPay PayBox, other x402 facilitators, and external agent wallets can settle inference outside Chit402. Treasuries still need a holdable book row with the same `verify_url` chrome — without Chit becoming a PayBox clone or wallet vault.

Chit **verifies and records**; it does **not** re-execute the hop or settle on behalf of peers.

## When to use

| Flow | Door |
|------|------|
| Pay through Chit | `POST /v1/chat/completions` |
| Already paid another x402 shop / PayBox | `POST /v1/agents/:id/book/ingest` |

## Payload shapes

**Full x402** (preferred when you have the 402 envelopes):

```json
{
  "session": "<possession>",
  "payment_required": { "resource": "https://…", "amount": "10000", "payTo": "0x…" },
  "payment_response": { "tx": "0x…", "payer": "0x…", "network": "base" }
}
```

**Minimal foreign invoice** (PayBox receipt, wallet tx):

```json
{
  "session": "<possession>",
  "foreign_invoice": {
    "amount": "10000",
    "payer": "0x…",
    "payTo": "0x…",
    "payment_ref": "base:0x…",
    "hub": "api.example.com",
    "model": "/v1/chat/completions"
  }
}
```

## Evidence

- `source` / `evidence`: `foreign_ingest`
- `foreign_x402`: `true`
- HMAC scope `recorded` means **Chit402 recorded this** — not merchant attestation.

## Do not

- Treat ingest as a second completions product surface
- Hand architecture dumps to partners (stamp/ingest only)
