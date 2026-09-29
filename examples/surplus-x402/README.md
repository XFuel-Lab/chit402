# Surplus → Chit receipt

Pay a [Surplus Intelligence](https://www.surplusintelligence.ai/docs/payments/x402) endpoint with x402 USDC on Base, then stamp that settlement on a Chit402 book.

`chitSurplusFetch(url, opts)` does three things:

1. Pays the Surplus URL with `@x402/fetch` (exact scheme, EIP-3009). The unpaid 402 is priced first.
2. Decodes the `PAYMENT-RESPONSE` header (base64 JSON: tx hash, network, payer).
3. Posts that settlement to `POST https://api.chit402.com/v1/agents/:agent_id/book/ingest` and pays the book stamp.

It returns `{ data, verify_url }`. `data` is the Surplus response body. `verify_url` is the Chit receipt.

Two caps refuse **before any signature**:

| Payment | Cap |
| --- | --- |
| Surplus | 0.05 USDC (50000 atomic) |
| Chit stamp | 2000 atomic USDC ($0.002) |

A price above either cap throws. Nothing is signed.

## Keys

The process environment only. This demo does not read a `.env` file, and it does not take private keys as arguments.

| Variable | Use |
| --- | --- |
| `SURPLUS_PAYER_PRIVATE_KEY` | Wallet that pays Surplus. Hex, 32 bytes. |
| `CHIT_STAMP_PRIVATE_KEY` | Wallet that pays the $0.002 book stamp. |
| `CHIT_AGENT_ID` | Registered book id (`POST /v1/agents/register`). |
| `CHIT_BOOK_SESSION` | Possession session for that book. The ingest door requires it (`X-Xfuel-Session` and the JSON `session` field). |

`CHIT_API_KEY` is optional. When set, it is sent as `X-API-Key`, the same header the book ingest client uses. A demo key cannot write the book.

## One-command live run

From the repo root, with those variables already exported:

```bash
npm install --prefix examples/surplus-x402 && npm start --prefix examples/surplus-x402
```

That posts a short chat completion to `https://api.surplusintelligence.ai/v1/chat/completions` (`llama-3.3-70b`, `max_tokens` 8). A quote near a few thousand atomic USDC is under the 0.05 cap. Twitter search on the same host is about $0.052 and is refused before signature.

Pass another Surplus URL as the first argument if you want a different resource:

```bash
npm start --prefix examples/surplus-x402 -- https://api.surplusintelligence.ai/v1/chat/completions
```

A successful run prints the receipt and the completion:

```json
{
  "verify_url": "https://api.chit402.com/receipt/foreign-x402-m5k2-ab12cd",
  "content": "pong",
  "data": {
    "id": "chatcmpl-surplus-example",
    "object": "chat.completion",
    "choices": [
      {
        "index": 0,
        "message": { "role": "assistant", "content": "pong" },
        "finish_reason": "stop"
      }
    ]
  }
}
```

`verify_url` is the public Chit receipt for the Surplus settlement (hub, model path, amount, tx). The `id` and wording above are the shape of the output, not a captured mainnet response.

## List paid endpoints

`npm run list-endpoints` fetches `https://api.surplusintelligence.ai/.well-known/x402` and prints each resource with its price. Prices published on the manifest are used as-is. A manifest that only lists URLs is priced with an unpaid 402 probe. The probe does not sign and does not send a payment header.

```bash
npm run list-endpoints --prefix examples/surplus-x402
```

```text
Surplus x402  https://api.surplusintelligence.ai/.well-known/x402

POST  https://api.surplusintelligence.ai/v1/chat/completions
      exact       3301 atomic USDC  $0.003301  eip155:8453
      upto        3301 atomic USDC  $0.003301  eip155:8453

GET   https://api.surplusintelligence.ai/x402/resources/twitter/tweets/search/recent
      priced from https://api.surplusintelligence.ai/x402/resources/twitter/tweets/search/recent?query=hello
      exact      52000 atomic USDC  $0.052000  eip155:8453  over 0.05 USDC cap
      upto       52000 atomic USDC  $0.052000  eip155:8453  over 0.05 USDC cap
```

Amounts move with the market. The chat line is a small unpaid quote. The Twitter line is over the demo cap, so `chitSurplusFetch` will not sign it. A path parameter or a Venice network segment is filled in only for the unpaid price probe; the manifest URL stays on the first line.

## Tests

```bash
npm test --prefix examples/surplus-x402
```

The tests mock `fetch`. They cover a paid receipt, both cap refusals, a missing or bad `PAYMENT-RESPONSE`, and a failed ingest. They do not call Surplus or Chit.
