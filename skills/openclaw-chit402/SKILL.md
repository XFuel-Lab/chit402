---
name: openclaw-chit402
description: >-
  Send inference spend through Chit402 (api.chit402.com/v1), pay USDC on Base via x402,
  and return verify_url so the principal holds the spend row. Use for stamped
  agent inference with budget caps, a Sponge wallet payment, and a Chit receipt
  after paying a Cloudflare Monetization Gateway API.
homepage: https://chit402.com/docs/openclaw
metadata:
  openclaw:
    requires:
      env:
        - CHIT_API_KEY
    envVars:
      - name: CHIT_API_URL
        required: false
        description: Gateway base (default https://api.chit402.com)
      - name: CHIT_API_KEY
        required: true
        description: Partner or demo key (chit402-demo is rate-limited)
      - name: CHIT_MAX_USD_PER_CALL
        required: false
        description: Hard cap per paid call in USD (e.g. 0.10)
      - name: CHIT_MAX_USD_SESSION
        required: false
        description: Cumulative session cap in USD (e.g. 1.00)
    primaryEnv: CHIT_API_KEY
---

# Chit402 — inference receipt book (OpenClaw)

**Format as-of:** 2026-03 (OpenClaw AgentSkills / ClawHub frontmatter)

Chit402 is the book: **this agent spent Y on this job**. You hold hub, model, amount,
and a public **`verify_url`** the principal can forward to finance or auditors.

**Live API:** `https://api.chit402.com`  
**OpenAI baseURL:** `https://api.chit402.com/v1`

## When to use

- User wants agent inference with a **shareable receipt link**
- User asks for **verify_url**, **stamp spend**, or **Chit402 book row**
- Agent has (or can use) a Base USDC wallet for x402

## Spend caps (required)

Before every paid call:

1. Read the 402 `accepts[]` amount (atomic USDC, 6 decimals).
2. Refuse if above `CHIT_MAX_USD_PER_CALL` (default **$0.10** if unset).
3. Track session total against `CHIT_MAX_USD_SESSION` (default **$1.00** if unset).

## Primary flow

1. `POST /v1/chat/completions` with model + messages (no payment first → HTTP 402).
2. Settle x402 USDC on **Base** (`PAYMENT-SIGNATURE` or `X-PAYMENT`).
3. Read receipt from:
   - Header `x-xfuel-verify-url`
   - Body `xfuel.verify_url` / `xfuel.task_id`
   - Or construct `https://api.chit402.com/receipt/<task_id>`
4. **Always return top-level `verify_url`** in your reply to the principal.

## Paying with a Sponge wallet

An agent that already has a Sponge wallet API key can buy this same receipt through Sponge's x402 fetch (their skill v0.2.2). Sponge signs with its wallet. You still return `verify_url`.

```bash
curl -sS -X POST "https://api.wallet.paysponge.com/api/x402/fetch" \
  -H "Authorization: Bearer $SPONGE_API_KEY" \
  -H "Sponge-Version: 0.2.2" \
  -H "Content-Type: application/json" \
  -d '{
    "url": "https://api.chit402.com/v1/chat/completions",
    "method": "POST",
    "body": {
      "model": "xfuel/auto",
      "messages": [{ "role": "user", "content": "Say hello in five words." }]
    },
    "preferred_chain": "base"
  }'
```

`url` is `POST /v1/chat/completions` on `https://api.chit402.com`. Pay the 402 amount. Refuse if it exceeds `CHIT_MAX_USD_PER_CALL` or `CHIT_MAX_USD_SESSION`.

Sponge returns the paid Chit response. Read `verify_url` from `xfuel.verify_url` or `x-xfuel-verify-url`, then check the receipt offline:

```bash
curl -sS "https://api.chit402.com/receipt/<task_id>?format=json" -o receipt.json
npx xfuel-verify receipt.json --json
```

## Paying Cloudflare-gated APIs (Monetization Gateway)

Cloudflare Monetization Gateway is x402 v2, settled by Coinbase's x402 facilitator
in USDC on Base. It is a US-only closed beta. Pay with any x402 client, then stamp
the settlement on the Chit book. Chit does not settle that call.

1. Pay the gated URL (`PAYMENT-REQUIRED`, then `PAYMENT-SIGNATURE`). Cap the
   challenge amount with `CHIT_MAX_USD_PER_CALL` and `CHIT_MAX_USD_SESSION`
   before you sign.
2. Read the `PAYMENT-RESPONSE` header: base64 JSON
   `{ success, transaction, network, payer }` with `network` `eip155:8453`.
3. `POST https://api.chit402.com/v1/agents/<agent_id>/book/ingest` with the
   possession `session`, `payment_required` (`resource`, atomic `amount`, `payTo`),
   and that settlement (`transaction` or the raw header). The door 402s a
   **$0.002** stamp; pay it, then read the 201.
4. Keep `verify_url`. Evidence is **`foreign_ingest`**: Chit recorded the Base
   USDC transfer. Chit did not route the payment.

`exact` amount is the challenge amount. For `upto`, the challenge amount is
`max_amount`. Spend is `PAYMENT-RESPONSE.amount` when present, otherwise the
USDC Transfer. The ceiling is not the receipt amount. Base USDC only.

Worker that returns the upstream body plus `X-Chit-Receipt`:
`examples/cloudflare-x402-chit-receipt/`.
Docs: https://www.chit402.com/docs/cloudflare-x402

## Do not

- Default to SP1 / Tier-2 proofs unless explicitly asked
- Lead with cheapest-call pricing — product is the receipt, not discount inference
- Store private keys in the skill file

## Register (optional)

After the first **paid** call, principal can `POST /v1/agents/register` with the
collected receipt to hold the possession-gated book (`GET|POST /v1/agents/:id/book`).

Docs: https://chit402.com/docs/chit-in-15-lines
