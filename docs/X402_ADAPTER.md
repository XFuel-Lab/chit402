# x402 Adapter

Flag-gated USDC payment rail for the gateway (`X402_ENABLED`).

- Module: `services/gateway/src/x402-adapter.js`
- Facilitators:
  - **Base** (default): CDP (`https://api.cdp.coinbase.com/platform/v2/x402`) or standard x402
  - **Solana** (optional): PayAI (`https://facilitator.payai.network`)
- CDP JWT auth: `services/gateway/src/cdp-jwt.js`
- Mock (dev): `services/gateway/src/x402-mock-facilitator.js`
- Tests: `services/gateway/test/x402-*.test.mjs`
- Mainnet ops: [MAINNET_X402_CHECKLIST.md](./MAINNET_X402_CHECKLIST.md)

Default rail: `usdc` on Base ([ADR 0002](adr/0002-base-settlement-home.md)).

## Base Sepolia (live public facilitator)

```
X402_ENABLED=true
X402_DEFAULT_RAIL=usdc
X402_FACILITATOR_PROVIDER=x402
X402_NETWORK=base-sepolia
X402_PAY_TO=0x<your-base-sepolia-treasury>
X402_USDC_PRICE_DEFAULT=10000
```

Facilitator default: `https://x402.org/facilitator` (no API key). Agent signs EIP-3009 `transferWithAuthorization` (see `xfuel-sdk/onchain`).

## Base mainnet (CDP facilitator)

```
X402_ENABLED=true
X402_FACILITATOR_PROVIDER=x402
X402_NETWORK=base
X402_PAY_TO=0x<Safe_or_Splits_on_Base>
CDP_API_KEY_ID=...
CDP_API_KEY_SECRET=...
```

If `X402_FACILITATOR_URL` is unset and `X402_NETWORK=base`, the gateway defaults to  
`https://api.cdp.coinbase.com/platform/v2/x402` and authenticates with a per-request EdDSA JWT. Full checklist: [MAINNET_X402_CHECKLIST.md](./MAINNET_X402_CHECKLIST.md).

## Solana mainnet (PayAI facilitator, optional)

```
X402_SOLANA_ENABLED=true
X402_SOLANA_PAY_TO=<Solana_USDC_ATA>
X402_SOLANA_FACILITATOR_URL=https://facilitator.payai.network
X402_SOLANA_NETWORK=solana
```

When enabled, the 402 challenge includes a second `accepts` entry for Solana USDC.
Solana payments are verified and settled via PayAI. Base remains the default network.

- Network identifiers: `solana` (short) or `solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp` (CAIP-2)
- Asset: Solana USDC mint `EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v`
- `X402_SOLANA_PAY_TO` must be an Associated Token Account (ATA) for USDC

## Flow

1. Client calls a paid route without payment → `402` challenge  
   - Challenge `accepts[]` may list multiple networks (Base + Solana) when Solana is enabled
2. Agent picks a network and signs USDC authorization:
   - **Base**: EIP-3009 `transferWithAuthorization` → CDP facilitator
   - **Solana**: SPL Token authorization → PayAI facilitator
3. Agent retries with `X-PAYMENT` header  
4. Gateway routes to the appropriate facilitator based on the network in the payment
5. Facilitator verifies / settles; task proceeds; `payment_ref` recorded on the receipt  

Payment binding into the SP1 proof is flag-gated (`X402_PROOF_BINDING`); in-proof field activates on SP1 guest v2.

## CDP Bazaar Discovery Listing

The gateway's 402 challenge includes the [x402 Bazaar extension](https://docs.x402.org/extensions/bazaar.md) for CDP discovery cataloging. Once a payment settles through the CDP facilitator, XFuel becomes searchable at:

```
GET https://api.cdp.coinbase.com/platform/v2/x402/discovery/search?query=xfuel
```

### How Bazaar Cataloging Works

Cataloging requires:

1. **Public HTTPS resource returns 402 (not 401)**  
   CDP re-fetches `POST`/`GET https://api.xfuel.app/task-request` **without** an API key after settle. Auth must not run before the challenge. The key is required for fulfillment only.

2. **x402 v2 PaymentRequired** on that 402 (and `GET /.well-known/x402`):
   - `x402Version: 2`
   - Top-level `resource: { url, description, mimeType, serviceName, tags, iconUrl }`
   - `accepts[0]`: `network: eip155:8453`, `asset` = Base USDC address, `amount` (atomic), `maxTimeoutSeconds`, `extra: { name, version }`
   - Top-level `extensions.bazaar` with `info.input` = `{ type, method, bodyType, body }` + Draft 2020-12 `schema`
   - `PAYMENT-REQUIRED` response header (base64 of the same JSON)

3. **Settle body carries `paymentPayload.resource` + echoed bazaar**  
   The gateway attaches both from the bound challenge on `/verify` and `/settle`.

4. **One successful CDP settle**, then expect `bazaarStatus=success` (or `processing` then a catalog hit within ~15 min).

### Validate before paying

```bash
curl -sS -X POST https://api.cdp.coinbase.com/platform/v2/x402/validate \
  -H 'Content-Type: application/json' \
  -d '{"resource":"https://api.xfuel.app/task-request","method":"POST"}'
```

Want `valid: true` and `simulation.outcome: "accepted"`. Do not pay until that lands.

### Manual Listing Trigger (Post-Deploy)

After deploying, confirm validate is green, then one ~$0.01 paid request (API key + payer):

```bash
# Prerequisites: XFUEL_PAYER_PRIVATE_KEY / DEPLOYER_PRIVATE_KEY set
cd packages/sdk
XFUEL_API_URL=https://api.xfuel.app XFUEL_API_KEY=xfuel-demo XFUEL_AMOUNT=10000 \
  npx tsx examples/flagship-demo.ts
```

### Verify Listing

```bash
curl "https://api.cdp.coinbase.com/platform/v2/x402/discovery/search?query=xfuel"
curl "https://api.cdp.coinbase.com/platform/v2/x402/discovery/merchant?payTo=<X402_PAY_TO>"
```

Expected: XFuel with `resource: "https://api.xfuel.app/task-request"`.

### Troubleshooting

| Symptom | Cause | Fix |
|---------|-------|-----|
| validate `returns_402` fails with 401 | Auth before x402 | Public challenge path; key only for fulfillment |
| validate wants v2 fields | Still advertising v1 | `eip155:8453`, `amount`, top-level `resource` + `extensions` |
| Not listed after settle | Settle lacked `resource` | Facilitator echo from bound challenge |
| `bazaarStatus=processing` forever | CDP indexer lag / probe 401 | Fix public 402 first; do not re-pay until validate is green |
| Rejected | Schema violation | Logs: `EXTENSION-RESPONSES` `bazaar.rejectedReason` |

Inspect the live 402 without paying:

```bash
curl -sS -D - -X POST https://api.xfuel.app/task-request \
  -H 'Content-Type: application/json' \
  -d '{}'
# Expect HTTP 402 + PAYMENT-REQUIRED header (no X-API-Key)
```

## Related

- [M2M_API.md](./M2M_API.md)
- [ADR 0001](./adr/0001-usdc-revenue-and-router-verifier-positioning.md)
- Agent payer notes: `packages/agent-skills/_shared/reference/payments-x402.md`
