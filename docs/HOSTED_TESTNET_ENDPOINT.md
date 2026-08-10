# Hosted Testnet & Demo

Public gateway for builders and demos.

Base URL: https://api-testnet.xfuel.app  
As-deployed details: [RUNTIME_STATE.md](./RUNTIME_STATE.md).

## Auth

Demo key: `xfuel-demo` (rate-limited per IP).  
Or: `X-API-Key` / `Authorization: Bearer <key>`.

## Try it (recommended)

One command — pay → settle → SP1 proof → shareable receipt:

```powershell
cd packages/sdk
npx tsx examples/flagship-demo.ts
```

Open the printed `verify_url`. Then optionally:

```text
https://basescan.org/address/0x9373499645292715a2275A78eD65B14215C41c06
```

**Honest status:** Money + proofs on Base mainnet (USDC via x402 / CDP; SP1 on `ZKVerifierSP1`).  
Demo hostname is still `api-testnet` — payments are **mainnet USDC**, not Sepolia.  
Do not present the zkGPT mock as a live proof.

Demo video package: [DEMO_VIDEO_SCRIPT.md](./DEMO_VIDEO_SCRIPT.md) · [DEMO_SHOT_LIST.md](./DEMO_SHOT_LIST.md) · [DEMO_COMMANDS.md](./DEMO_COMMANDS.md)

## Optional: raw HTTP

On **Windows PowerShell**, use `curl.exe` (plain `curl` is `Invoke-WebRequest` and will fail).

```powershell
curl.exe -sS https://api-testnet.xfuel.app/health | python -m json.tool
```

```bash
# macOS / Linux / Git Bash
curl -sS https://api-testnet.xfuel.app/health | python -m json.tool

curl -sS -X POST https://api-testnet.xfuel.app/task-request \
  -H "Content-Type: application/json" \
  -H "X-API-Key: xfuel-demo" \
  -d '{
    "message_type": "inference_request",
    "chain_id": "base",
    "amount": "1000000",
    "sender": "0xYourAddress",
    "model_id": "xfuel/auto",
    "input_hash": "0xabc...",
    "payment": { "rail": "usdc", "network": "base" }
  }'
```

OpenAI-compatible: `https://api-testnet.xfuel.app/v1`  
Payments: USDC via x402 on **Base mainnet** — [X402_ADAPTER.md](./X402_ADAPTER.md) · [RUNTIME_STATE.md](./RUNTIME_STATE.md).

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
