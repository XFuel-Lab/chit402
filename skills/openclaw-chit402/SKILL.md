---
name: openclaw-chit402
description: >-
  Send inference spend through Chit402 (api.chit402.com/v1), pay USDC on Base via x402,
  and return verify_url so the principal holds the spend row. Use for stamped
  agent inference with budget caps — not cheaper routing.
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

## Do not

- Default to SP1 / Tier-2 proofs unless explicitly asked
- Lead with cheapest-call pricing — product is the receipt, not discount inference
- Store private keys in the skill file

## Register (optional)

After the first **paid** call, principal can `POST /v1/agents/register` with the
collected receipt to hold the possession-gated book (`GET|POST /v1/agents/:id/book`).

Docs: https://chit402.com/docs/chit-in-15-lines
