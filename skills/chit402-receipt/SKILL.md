---
name: chit402-receipt
description: >-
  Pay for Chit402 inference via x402 USDC on Base, collect a signed receipt, and
  return verify_url so the principal holds the row. Use when an agent needs to
  stamp spend through Chit402, print a shareable receipt, verify payer/payee/asset/
  amount/tx binds offline, budget capped USDC calls without defaulting to SP1,
  or stamp a Chit receipt after paying a Cloudflare Monetization Gateway API.
---

# Chit402 Receipt — pay, stamp, return verify_url

Chit402 is the book: **this agent spent Y on this job**. You hold hub, model, amount,
and a public **`verify_url`** the principal can forward to finance or auditors.

**Live API:** `https://api.chit402.com`  
**Default rail:** x402 USDC on **Base mainnet** (CDP facilitator). Solana USDC is
available when the 402 challenge lists it — prefer Base unless the user asks otherwise.

**Do not default to SP1.** Signed receipts (Tier 1, ES256 JWS) are table stakes.
Tier-2 settlement proofs are optional and cost extra — never request or wait for SP1
unless the user explicitly asks for on-chain proof.

## When to use

- User wants an agent to **pay for inference** and return a **receipt link**
- User asks to **stamp spend**, **print receipt**, **verify_url**, or **Chit402 book row**
- User needs **offline verification** of payer / payee / asset / amount / tx binds
- Bankr or similar agent with a Base USDC wallet (CDP `PAYMENT-SIGNATURE` path)

## Environment

| Variable | Required | Description |
|----------|----------|-------------|
| `CHIT_API_URL` | no | Gateway base (default `https://api.chit402.com`). Aliases: `CHIT402_API_URL`, `XFUEL_API_URL`. |
| `CHIT_API_KEY` | recommended | Partner or demo key (`chit402-demo` is rate-limited). Aliases: `CHIT402_API_KEY`, `XFUEL_API_KEY`. |
| `CHIT_MAX_USD_PER_CALL` | recommended | Hard cap per paid call in USD (e.g. `0.10` = ten cents). **Refuse** if quoted amount exceeds cap. |
| `CHIT_MAX_USD_SESSION` | recommended | Cumulative session cap in USD. Track spend in this conversation; **refuse** when exceeded. |

Bankr agents: use the **Bankr wallet** for x402 signing (`PAYMENT-SIGNATURE` header).
Do not paste private keys into skills or chat. Prefer Bankr submit/sign APIs over raw keys.

## Spend caps (required behavior)

Before every paid call:

1. Parse the 402 `accepts[]` entry you will pay against. Amount is **atomic USDC**
   (6 decimals): `"2000"` = $0.002.
2. Compare to `CHIT_MAX_USD_PER_CALL` (default **$0.10** if unset).
3. Add to your session running total; compare to `CHIT_MAX_USD_SESSION` (default **$1.00**
   if unset).
4. If either cap would be exceeded, **stop** and tell the principal the quoted amount
   and your limits. Do not settle.

Floor on the public door is **$0.002** (atomic USDC `"2000"`, `min_charge_usd` on `GET /.well-known/x402`) per call unless the quote says otherwise.

## Primary flow — `POST /v1/chat/completions` (x402 on Base)

Best for Bankr and chat-native agents. Same door as OpenAI-compatible clients.

### Steps

1. **Probe** (optional): `GET https://api.chit402.com/v1/models` with
   `Authorization: Bearer $CHIT_API_KEY` or `X-API-Key: $CHIT_API_KEY`.

2. **Request without payment** to read the 402 challenge:

   ```http
   POST /v1/chat/completions
   Content-Type: application/json

   {
     "model": "xfuel/auto",
     "messages": [{ "role": "user", "content": "<prompt>" }]
   }
   ```

   Expect **HTTP 402** with `PAYMENT-REQUIRED` (and/or body `accepts[]`).
   Pick the **Base** entry: `network` = `eip155:8453` or `base`, asset = Base USDC
   (`0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913`), note `payTo` (payee), `amount`.

3. **Enforce caps** (above) against `accepts[].amount`.

4. **Sign and retry** with CDP-native payment header (Bankr default):

   ```http
   POST /v1/chat/completions
   Authorization: Bearer $CHIT_API_KEY
   Content-Type: application/json
   PAYMENT-SIGNATURE: <CDP v2 PaymentPayload from wallet>

   { "model": "xfuel/auto", "messages": [...] }
   ```

   Bankr sends `PAYMENT-SIGNATURE` (not only `X-PAYMENT`). Echo the challenge's
   `accepts[0]` shape; the gateway normalizes float-string timestamps.

5. **Collect the receipt** from the 200 response:

   | Source | Field |
   |--------|-------|
   | Header | `x-xfuel-verify-url`, `x-xfuel-task-id` |
   | Body | `xfuel.verify_url`, `xfuel.task_id` |
   | Constructed | `https://api.chit402.com/receipt/<task_id>` |

6. **Return to the principal** — always include:

   - **`verify_url`** (full HTTPS URL)
   - One short human line, e.g.  
     `Paid $0.002 USDC on Base for xfuel/auto — receipt: <verify_url>`

### Alternate paid door — `POST /task-request`

Use for M2M / agent loops that need `task-status` polling or rolling settlement.
Same x402 handshake; see [references/api.md](references/api.md).

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

`url` is the public door above. Floor on that door is $0.002 (atomic USDC `"2000"`) unless the 402 quotes otherwise. Enforce the same spend caps before you send the fetch.

Sponge returns the paid Chit response. Read `verify_url` from `xfuel.verify_url` or `x-xfuel-verify-url`, then check the receipt offline:

```bash
curl -sS "https://api.chit402.com/receipt/<task_id>?format=json" -o receipt.json
npx xfuel-verify receipt.json --json
```

## What the receipt binds (new upgrades)

Collected USDC receipts stamp these in the **issuer-signed JWS** (`issuer_signature.jws`):

| Bind | JWS / envelope field | Meaning |
|------|----------------------|---------|
| **Issuer key pin** | `issuer_signature.issuer_jwk` | ES256 public key **pinned in the receipt** — offline verify without fetching JWKS first |
| **Payer** | `caller_binding.payer_wallet` | Wallet that settled USDC (matches on-chain `from`) |
| **Payee** | `payment.payee` | x402 `payTo` / treasury recipient |
| **Asset** | `payment.asset` | e.g. `USDC` |
| **Amount** | `payment.gross_amount` | Atomic USDC (6 dp) |
| **Tx** | `payment.ref` | `base:0x…` or `eip155:8453:0x…` settlement reference |

Fetch JSON: `GET /receipt/<task_id>?format=json`  
JWKS (legacy / cross-check): `GET /.well-known/jwks.json`

Full offline steps: [references/verify-offline.md](references/verify-offline.md)

## Offline verification (JWKS → JWS)

**Pin-first (recommended):** newer receipts include `issuer_signature.issuer_jwk`.
Verify the compact JWS with ES256 — no network required for signature check.

```bash
curl -sS "https://api.chit402.com/receipt/<task_id>?format=json" -o receipt.json
npx xfuel-verify receipt.json --json
# Uses pinned issuer_jwk automatically (@xfuel/verify)
```

**JWKS fallback** (older receipts or cross-check kid rotation):

```bash
curl -sS "https://api.chit402.com/.well-known/jwks.json" -o jwks.json
npx xfuel-verify receipt.json --jwks-file jwks.json --json
```

Then confirm **payer on-chain** matches `caller_binding.payer_wallet` for `payment.ref`
(Base USDC Transfer / EIP-3009 `from`). CLI: `--check-payer` when RPC is available.

**Do not** treat SP1 / `binding.in_proof` as the default prove-it path. Signed JWS +
payer bind is enough for most agent treasury workflows.

## MCP (optional)

`npx chit402-mcp` exposes `chat_completions`, `verify_receipt`, etc. Bankr installs
this **skill file** for instructions; MCP is optional and not required for Bankr.

## Failure modes

| Symptom | Action |
|---------|--------|
| 402 after payment | Check `PAYMENT-SIGNATURE` shape, Base network CAIP-2, amount vs cap |
| 400 on empty body | Send valid `messages` **before** payment settles (gateway validates body pre-settle) |
| `invalid_network` | Use `eip155:8453` in signed payload for CDP v2 |
| Cap exceeded | Report quoted atomic amount; ask principal to raise cap or narrow the task |
| Unmetered receipt | Demo key / no settlement — `payment.rail` = `unmetered`; not a collected row |

## Hard requirements

- **Always return `verify_url`** on successful paid completion.
- **Enforce spend caps** — never exceed `CHIT_MAX_USD_PER_CALL` or `CHIT_MAX_USD_SESSION`.
- **Default to Base USDC x402** — do not silently switch rails.
- **No SP1 by default** — do not poll `/prove-result` unless asked.
- **Never exfiltrate** private keys; use Bankr wallet signing.
- Point principals at **`https://api.chit402.com`** (not legacy hostnames) for live traffic.

## Paying Cloudflare-gated APIs (Monetization Gateway)

Cloudflare Monetization Gateway (closed beta, launched 30 Sep 2026) is **x402 v2**.
It verifies the payment and settles it through **Coinbase's x402 facilitator** in
**USDC on Base** (`eip155:8453`). Cloudflare does not run the facilitator. Buyers
and sellers must be **US-based**. There is no partner directory, and settlement
logs are not available yet.

Chit does not touch that settlement. After the paid call, read `PAYMENT-RESPONSE`
and POST it to the existing foreign-ingest door. Chit checks the USDC Transfer
on Base and writes a book row. The receipt evidence is **`foreign_ingest`**: Chit
recorded the payment. Chit did not route it and did not settle it.

**Base USDC only** on this path. The USDC contract is
`0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913`.

### Buyer-side recipe

1. **Pay with any x402 client** (`@x402/fetch`, Agents SDK `withX402Client`, or
   the Worker in `examples/cloudflare-x402-chit-receipt/`). The first response is
   HTTP 402 with `PAYMENT-REQUIRED` (base64 JSON). Retry with `PAYMENT-SIGNATURE`.
   Enforce `CHIT_MAX_USD_PER_CALL` and `CHIT_MAX_USD_SESSION` on the challenge
   amount before you sign. Atomic USDC, 6 decimals: `"10000"` = $0.01. The
   gateway minimum is $0.001 (`1000`).

2. **Read `PAYMENT-RESPONSE`** on the paid response. It is base64 JSON:

   ```json
   { "success": true, "transaction": "0x…", "network": "eip155:8453", "payer": "0x…" }
   ```

   `transaction` is the Base tx hash. Keep the resource URL, atomic amount, and
   `payTo` from the 402 challenge you already paid.

3. **POST the ingest.** Possession session required
   (`X-Xfuel-Session` and JSON `session`). A registered book comes from
   `POST /v1/agents/register`.

   ```http
   POST /v1/agents/<agent_id>/book/ingest
   Content-Type: application/json
   X-Xfuel-Session: <session>

   {
     "session": "<session>",
     "payment_required": {
       "resource": "https://seller.example/v1/resource",
       "amount": "10000",
       "payTo": "0x…",
       "network": "eip155:8453",
       "asset": "USDC"
     },
     "payment_response": {
       "success": true,
       "transaction": "0x…",
       "network": "eip155:8453",
       "payer": "0x…"
     }
   }
   ```

   `payment_response` may instead be the raw base64 `PAYMENT-RESPONSE` header.
   `transaction` is stored as `tx`. `eip155:8453` is stored as `base`, so the
   book ref is `base:0x…` and on-chain verify can read the hash.

   The ingest door then returns **HTTP 402** for its own **$0.002** stamp
   (2000 atomic USDC) paid by the submitter. Settle that stamp with
   `PAYMENT-SIGNATURE` or `X-PAYMENT`. The stamp is separate from the seller
   payment and does not debit prepaid budget.

   For an **`exact`** challenge, `amount` is the settled figure. For **`upto`**,
   the challenge `amount` is only the authorization ceiling (`max_amount`).
   Spend is `PAYMENT-RESPONSE.amount` when that field is present. Otherwise
   ingest reads the USDC Transfer and records that. A posted amount above the
   Transfer, or above the ceiling, is rejected (`payment_invalid`).

4. **Keep `verify_url`** from the 201 body
   (`https://api.chit402.com/receipt/<task_id>`). Return it to the principal.
   `GET /receipt/<task_id>?format=json` shows `"evidence": "foreign_ingest"`.

A Worker that does steps 1–4 for an **exact** Base USDC price and sets
`X-Chit-Receipt` to the verify URL: `examples/cloudflare-x402-chit-receipt/`.
It refuses an `upto`-only challenge before signing. Docs:
https://www.chit402.com/docs/cloudflare-x402

### Honest limits

- Evidence is `foreign_ingest`. The HMAC scope is `recorded`. That is Chit's
  record of a payment settled elsewhere, not a merchant attestation and not a
  Chit-routed hop.
- Base USDC only. Monetization Gateway settles on Base through Coinbase's facilitator.
- The gateway is a **US-only closed beta**. Buyers and sellers must be US-based.

## References

- [references/api.md](references/api.md) — endpoints, headers, example 402/200
- [references/verify-offline.md](references/verify-offline.md) — pin-first JWS + payer bind
- Repo: `docs/VERIFY_ALGORITHM.md`, `docs/X402_ADAPTER.md`, `docs/DESIGN_PARTNER_ONBOARDING.md`
