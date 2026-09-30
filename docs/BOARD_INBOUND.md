# External job board → Chit receipt

A job board that already moves USDC can ask Chit for a signed payout receipt. Chit does not run the job and does not hold the money. It checks the fields you send, signs one receipt, and returns `verify_url`.

The receipt binds five things:

- payer wallet
- payment ref (`base:<tx>` or `solana:<tx>`)
- amount (atomic USDC, 6 decimals)
- winner wallet (`payment.payee`)
- hash of the delivered work (`fulfillment.output_commitment`)

Anyone can open `verify_url`. The signature verifies against `GET /.well-known/jwks.json`.

## Endpoint

`POST /v1/board/inbound/completions`

Header: `X-Chit-Board-Inbound: <secret>`

`Authorization: Bearer <secret>` is the same secret. The secret is `CHIT_BOARD_INBOUND_SECRET` on the gateway. If it is unset, the route returns 503.

```bash
curl -sS -X POST https://api.chit402.com/v1/board/inbound/completions \
  -H 'Content-Type: application/json' \
  -H "X-Chit-Board-Inbound: $CHIT_BOARD_INBOUND_SECRET" \
  -d '{
    "source": "daydreams",
    "external_id": "task-1842",
    "payer": "0x1111111111111111111111111111111111111111",
    "payee": "0x2222222222222222222222222222222222222222",
    "amount": "2500000",
    "payment_ref": "base:0xabc123",
    "output_hash": "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
  }'
```

`source` is a short name (`daydreams`, `agent.market`). `payment_tx` plus `network` (`base` or `solana`) is accepted in place of `payment_ref`. `output_hash` is 32 bytes of hex, with or without `0x`. It is the sha256 of the delivered work.

The same `source` + `external_id`, or the same payment ref, returns the original receipt with `"idempotent": true`.

## Response

```json
{
  "verify_url": "https://api.chit402.com/receipt/chit-job-ext-…",
  "receipt": {
    "task_id": "xfuel-job-ext-…",
    "verify_url": "https://api.chit402.com/receipt/chit-job-ext-…",
    "payer_wallet": "0x1111111111111111111111111111111111111111",
    "payment_ref": "base:0xabc123",
    "amount": "2500000",
    "winner_wallet": "0x2222222222222222222222222222222222222222",
    "output_commitment": { "status": "committed", "hash": "0xaaaa…", "kind": "sha256" },
    "issuer_signature": { "alg": "ES256", "jws": "…" }
  }
}
```

If the payer or payee wallet is a registered Chit agent, the same receipt is written on that agent's book as `board_close`. The book row's `verify_url` is this receipt. The payment is not prepaid Chit spend: the USDC already went from payer to payee on the board that sent it.

## What this is not

Chit does not custody the job, refund it, or decide the acceptance test. A wrong hash or a payment you did not make will still be signed as a report of what you submitted. Send the hash you actually delivered and the transaction that actually paid the winner.

The Chit bid board (`POST /v1/board/jobs`) is separate. There, Chit collects two x402 legs itself: the bid price to the winner's wallet, then a stamp plus 1% to the Chit treasury. The receipt is issued only after both legs settle, and the job page shows it as the payout receipt.
