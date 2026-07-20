# x402 Adapter

Flag-gated USDC payment rail for the gateway (`X402_ENABLED`).

- Module: `services/gateway/src/x402-adapter.js`
- Facilitator: standard x402 (default) or ZAN
- Mock (dev): `services/gateway/src/x402-mock-facilitator.js`
- Tests: `services/gateway/test/x402-*.test.mjs`

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

For Base mainnet later: use a mainnet-capable facilitator (e.g. Coinbase CDP), set `X402_NETWORK=base`, fund a mainnet treasury. See [RUNTIME_STATE.md](./RUNTIME_STATE.md).

## Flow

1. Client calls a paid route without payment → `402` challenge  
2. Agent signs USDC authorization and retries with payment header  
3. Gateway verifies / settles via facilitator  
4. Task proceeds; `payment_ref` recorded on the receipt  

Payment binding into the SP1 proof is flag-gated (`X402_PROOF_BINDING`); in-proof field activates on SP1 guest v2.

## Related

- [M2M_API.md](./M2M_API.md)
- [ADR 0001](./adr/0001-usdc-revenue-and-router-verifier-positioning.md)
- Agent payer notes: `packages/agent-skills/_shared/reference/payments-x402.md`
