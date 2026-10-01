# x402 proxy with a Chit receipt

Cloudflare Worker that pays an x402 endpoint, then asks Chit to record the settlement.

The seller's facilitator still settles the call. For Cloudflare Monetization Gateway that facilitator is Coinbase's, in USDC on Base. This Worker does not run a facilitator and does not change that settlement. After `PAYMENT-RESPONSE` comes back it POSTs the tx hash, network, and payer to `POST /v1/agents/:agent_id/book/ingest`. The upstream body is returned with:

```http
X-Chit-Receipt: https://api.chit402.com/receipt/foreign-x402-…
```

That URL is a **`foreign_ingest`** receipt. Chit verified the Base USDC transfer and recorded it. Chit did not route the payment.

Monetization Gateway is a US-only closed beta. Buyers and sellers must be US-based. This template also fits any other x402 seller on Base USDC.

Modeled on the [x402-proxy-template](https://github.com/cloudflare/templates/tree/main/x402-proxy-template) layout (`wrangler` config, `src/index.ts`, env bindings, `cloudflare` package metadata) so it can be offered upstream later. `cloudflare.publish` is `false` until that happens.

## What it does

1. Forwards the request to `UPSTREAM_ORIGIN` plus the incoming path and query.
2. On HTTP 402, reads `PAYMENT-REQUIRED` and refuses **before any signature** when the Base USDC price is above `MAX_ATOMIC_USDC` (default `100000`, which is $0.10).
3. Signs `PAYMENT-SIGNATURE` with `X402_PAYER_PRIVATE_KEY` (`@x402/fetch`, **exact** scheme on Base USDC). An `upto`-only challenge is refused before any signature.
4. Reads `PAYMENT-RESPONSE` (`success`, `transaction`, `network`, `payer`).
5. POSTs that v2 settlement to Chit. The ingest door returns its own 402 for a **$0.002** stamp (2000 atomic USDC). The Worker pays that with `CHIT_STAMP_PRIVATE_KEY`, capped at 2000 atomic, then reads `verify_url`.

`exact` prices use the challenge amount. `upto` prices settle the actual amount, which can be below the authorized ceiling. Pass that settled amount through only when `PAYMENT-RESPONSE` includes `amount`. A posted amount above the on-chain Transfer is rejected.

Base USDC only (`eip155:8453`).

## Configure

No secrets belong in the repo. `[vars]` in `wrangler.toml` hold public settings. Keys and the book session are bindings:

| Binding | Kind | Use |
| --- | --- | --- |
| `UPSTREAM_ORIGIN` | var | Origin to pay. Path and query from the incoming request are appended. |
| `CHIT_API_URL` | var | Default `https://api.chit402.com`. |
| `MAX_ATOMIC_USDC` | var | Per-call cap in atomic USDC. Checked before signing. |
| `CHIT_AGENT_ID` | secret or var | Book id from `POST /v1/agents/register`. |
| `CHIT_BOOK_SESSION` | secret | Possession session for that book. |
| `X402_PAYER_PRIVATE_KEY` | secret | Hex key that pays the upstream endpoint. |
| `CHIT_STAMP_PRIVATE_KEY` | secret | Hex key that pays the $0.002 stamp. |
| `CHIT_API_KEY` | secret, optional | Sent as `X-API-Key`. A demo key cannot write the book. |

```bash
wrangler secret put X402_PAYER_PRIVATE_KEY
wrangler secret put CHIT_STAMP_PRIVATE_KEY
wrangler secret put CHIT_BOOK_SESSION
wrangler secret put CHIT_AGENT_ID
```

Local dev reads `.dev.vars` (gitignored). Start from `.dev.vars.example` and fill the blanks there, not in git.

`GET /__chit/health` skips the proxy and returns `{ "ok": true }`.

## Test

Tests load `test/fixtures/paid-call.json` and mock `fetch`. They do not pay anyone and do not call Base.

```bash
npm install
npm test
```

## Docs

Buyer recipe: [`skills/chit402-receipt/SKILL.md`](../../skills/chit402-receipt/SKILL.md) (section "Paying Cloudflare-gated APIs").

Page: https://www.chit402.com/docs/cloudflare-x402
