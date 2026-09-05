# Bankr skill — chit402-receipt (door #4)

**Status: shipped**

Print-receipt door for Bankr and similar Base-native agents: pay through Chit402 x402,
collect a signed receipt, return `verify_url` so the principal holds the row.

## Artifact location

```
skills/chit402-receipt/
  SKILL.md              # YAML frontmatter + agent instructions
  catalog.json          # Bankr catalog schema v1
  references/
    api.md              # Endpoints, 402/200 shapes
    verify-offline.md   # issuer_jwk pin + JWKS fallback + payer bind
```

## Bankr install (one-liner)

```text
install the chit402-receipt skill from https://github.com/XFuel-Lab/chit402/tree/main/skills/chit402-receipt
```

After merge to `main`, Bankr fetches from that tree URL (external skill — not in BankrBot/skills).

## Environment

| Variable | Purpose |
|----------|---------|
| `CHIT_API_URL` | `https://api.chit402.com` (default) |
| `CHIT_API_KEY` | Partner or demo API key |
| `CHIT_MAX_USD_PER_CALL` | Per-call USDC cap (USD decimal, e.g. `0.10`) |
| `CHIT_MAX_USD_SESSION` | Session cumulative cap (e.g. `1.00`) |

Bankr wallet funds Base USDC x402. Agent signs `PAYMENT-SIGNATURE` (CDP v2).

## Flow (locked)

1. `POST /v1/chat/completions` → 402 (read `accepts[]`, enforce caps)
2. Wallet settles USDC on Base → retry with `PAYMENT-SIGNATURE`
3. Read `verify_url` from `x-xfuel-verify-url` or `xfuel.verify_url`
4. Return to principal: short human line + **`verify_url`**
5. Optional offline verify: pinned `issuer_signature.issuer_jwk` → JWS; confirm payer/payee/asset/amount/tx binds

**No SP1 default.** Signed ES256 receipt is the prove-it path.

## Receipt upgrades (documented in skill)

- **`issuer_signature.issuer_jwk`** — pin-first offline verify (no JWKS fetch required)
- **Settlement binds in signed JWS:** `caller_binding.payer_wallet`, `payment.payee`, `payment.asset`, `payment.gross_amount`, `payment.ref`
- JWKS fallback: `GET /.well-known/jwks.json`

## Example agent return

```text
Paid $0.01 USDC on Base for xfuel/auto (openrouter) — receipt: https://api.chit402.com/receipt/openai-abc123
```

JSON/tool payload should include top-level `verify_url` when structured output is used.

## Christopher → @bankrbot paste

**Message 1 — install skill:**

```text
install the chit402-receipt skill from https://github.com/XFuel-Lab/chit402/tree/main/skills/chit402-receipt
```

**Message 2 — treasury test (after skill loads):**

```text
Using the chit402-receipt skill: call Chit402 on Base with my wallet. Cap $0.05 per call and $0.25 this session. Run one paid POST /v1/chat/completions (model xfuel/auto, prompt "Say hello in five words."), settle x402 USDC on Base, and reply with verify_url plus one line showing hub, model, amount, and the receipt link. Do not request SP1.
```

## Related doors

| Door | Surface |
|------|---------|
| #4 Bankr skill | `skills/chit402-receipt/` (this doc) |
| #4 Eliza plugin | `packages/plugin-elizaos` — `REGISTER_CHIT_AGENT`, `SHOW_CHIT_BOOK` |
| MCP | `npx chit402-mcp` — optional; not duplicated here |

## Spec history

| Date | Note |
|------|------|
| 2026-09-05 | Locked Bankr format from docs.bankr.bot + BankrBot/skills; shipped in-repo |
