# Hosted Testnet & Demo

Public gateway for builders and demos.

Base URL: https://api-testnet.xfuel.app  
As-deployed details: [RUNTIME_STATE.md](./RUNTIME_STATE.md).

## Auth

Demo key: `xfuel-demo` (rate-limited per IP).  
Or: `X-API-Key` / `Authorization: Bearer <key>`.

## Demo path

1. Health: https://api-testnet.xfuel.app/health  
2. Submit a task (curl below)  
3. Open the `verify_url` / receipt from the response  

What to show: Tier 1 signed receipt; optional Tier 2 SP1 when the prover URL is set; USDC x402 on Base Sepolia when `X402_ENABLED=true`. Do not present the zkGPT mock as a live proof.

## Try it

```bash
curl https://api-testnet.xfuel.app/health

curl -X POST https://api-testnet.xfuel.app/task-request \
  -H "Content-Type: application/json" \
  -H "X-API-Key: xfuel-demo" \
  -d '{
    "message_type": "inference_request",
    "chain_id": "base",
    "amount": "1000000",
    "sender": "0xYourAddress",
    "model_id": "llama-3-70b",
    "input_hash": "0xabc...",
    "payment": { "rail": "usdc" }
  }'
```

OpenAI-compatible: `https://api-testnet.xfuel.app/v1`  
Payments: USDC via x402 on Base Sepolia — [X402_ADAPTER.md](./X402_ADAPTER.md).

## Local demo

```bash
cd services/gateway
npm install
npm run m2m-server
```

Point clients at `http://localhost:3002`. For real Tier-2 proofs you need `SP1_PROVER_URL` as in [RUNTIME_STATE.md](./RUNTIME_STATE.md).

## Related

- [M2M_API.md](./M2M_API.md)
- [OPENAI_COMPATIBLE_GATEWAY.md](./OPENAI_COMPATIBLE_GATEWAY.md)
