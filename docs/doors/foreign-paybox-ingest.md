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

## Stamp

The submitter pays **$0.002** (`STAMP_FEE_UNITS` 2000, USDC 6 decimals) via x402 on Base or Solana after possession checks succeed. That fee is not subtracted from prepaid budget. `GET /.well-known/x402` publishes `pricing.stamp_fee_usd` `0.002`.

Pilot waiver (off by default): `STAMP_WAIVER_KEYS` lists partner API keys; `STAMP_WAIVER_CAP` is how many free stamps each key gets (default 0). A house smoke key may be listed on the gateway host. After the cap, the key pays the stamp.

## Nano (XNO)

Cemented mainnet sends only. Two public RPCs (`NANO_RPC_URLS`) must agree: `subtype=send`, `confirmed=true`, recipient (`link_as_account` / `linked_account`) matches, and `block_info.amount` equals the expected raw amount and the balance delta from the previous block. Dedupe key is the block hash (`nano:<hash>`), persisted on the ledger. The receipt carries `chain=nano`, raw and XNO amounts, a Kraken `NANOUSD` figure labeled `estimate`, and `https://nanexplorer.com/nano/block/<hash>`.

```json
{
  "session": "<possession>",
  "nano": {
    "block": "324B1CED853848219956F60B43065ECF08F0AB0C35B54BA2516EBE39C4E5C19B",
    "recipient": "nano_3kef5c3ahkwf3qcyw61qcnma668z8ez4ocnm55gkiaqeure3ghcfqunfynug",
    "amount": "1000000000000000000000000000000",
    "description": "1 XNO mainnet send"
  }
}
```

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
