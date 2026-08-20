# x402 Adapter

Flag-gated USDC payment rail for the gateway (`X402_ENABLED`).

- Module: `services/gateway/src/x402-adapter.js`
- Facilitator: standard x402 (default) or ZAN
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

## Flow

1. Client calls a paid route without payment → `402` challenge  
2. Agent signs USDC authorization and retries with payment header  
3. Gateway verifies / settles via facilitator  
4. Task proceeds; `payment_ref` recorded on the receipt  

Payment binding into the SP1 proof is flag-gated (`X402_PROOF_BINDING`); in-proof field activates on SP1 guest v2.

## CDP Bazaar Discovery Listing

The gateway's 402 challenge includes the [x402 Bazaar extension](https://docs.x402.org/extensions/bazaar.md) for CDP discovery cataloging. Once a payment settles through the CDP facilitator, XFuel becomes searchable at:

```
GET https://api.cdp.coinbase.com/platform/v2/x402/discovery/search?query=xfuel
```

### How Bazaar Cataloging Works

Cataloging requires three steps:

1. **Server advertises a spec-conformant bazaar extension on the 402 (PaymentRequired)**  
   The gateway's `buildPaymentChallenge()` includes:
   - An absolute `resource` URL: `https://api.xfuel.app/task-request`
   - A `routeTemplate` as the catalog key (not per-task)
   - `extensions.bazaar.info.input.type` and `info.output.type`
   - Service metadata: `serviceName: "XFuel"`, `tags`, `iconUrl`

2. **A paying client echoes that extension in the PaymentPayload**  
   x402-compatible SDKs (xfuel-sdk, @x402/axios, etc.) automatically echo the bazaar extension when present. No client-side configuration needed.

3. **One successful settlement through the CDP Facilitator**  
   After the first paid `/task-request` settles through `https://api.cdp.coinbase.com/platform/v2/x402`, the service is cataloged. A small ~$0.01 payment is sufficient.

### Manual Listing Trigger (Post-Deploy)

After deploying, trigger the initial listing with a minimal paid request:

```bash
# Prerequisites: XFUEL_PAYER_PRIVATE_KEY set in an agent or SDK client
# This is a real Base mainnet USDC payment

curl -X POST https://api.xfuel.app/task-request \
  -H "Content-Type: application/json" \
  -H "X-API-Key: <your-key>" \
  -H "X-PAYMENT: <signed-payment-from-sdk>" \
  -d '{
    "message_type": "inference_request",
    "chain_id": "base",
    "sender": "0xYourAddress",
    "model_id": "xfuel/auto",
    "messages": [{"role":"user","content":"hi"}],
    "payment": {"rail": "usdc"}
  }'
```

Or use the SDK's `pay_with_usdc` MCP tool if `XFUEL_PAYER_PRIVATE_KEY` is set.

### Verify Listing

After settlement, search for XFuel:

```bash
curl "https://api.cdp.coinbase.com/platform/v2/x402/discovery/search?query=xfuel"
```

Expected: XFuel appears with `resource: "https://api.xfuel.app/task-request"` and the bazaar metadata.

### Troubleshooting

Common cataloging failures (per spec):

| Symptom | Cause | Fix |
|---------|-------|-----|
| Not listed | No settlement yet | Send one paid request through CDP |
| Listed with wrong URL | Relative resource URL | Ensure `PUBLIC_BASE_URL` is set |
| Missing from search | `bazaar` extension missing | Check 402 includes `extensions.bazaar` |
| Rejected by facilitator | Schema violation | Check `info.input.type` / `info.output.type` present |

The 402 JSON can be inspected without paying:

```bash
curl -X POST https://api.xfuel.app/task-request \
  -H "Content-Type: application/json" \
  -d '{"message_type":"inference_request","chain_id":"base","sender":"0x0"}' \
  | jq '.accepts[0] | {resource, routeTemplate, serviceName, extensions}'
```

## Related

- [M2M_API.md](./M2M_API.md)
- [ADR 0001](./adr/0001-usdc-revenue-and-router-verifier-positioning.md)
- Agent payer notes: `packages/agent-skills/_shared/reference/payments-x402.md`
