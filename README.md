# XFuel Protocol

XFuel is the verifiable settlement and payments layer for AI compute. Agents and applications submit inference tasks; XFuel routes each task to the best available provider, settles fees in **USDC via x402 on Base**, and returns a verifiable receipt — signed by default, or an on-chain SP1 settlement proof on demand.

Providers are pluggable (OpenAI-compatible APIs, neoclouds, optional DePIN GPUs). Money and proofs live on Base. Trust is tiered so cost tracks value at risk: signed receipt → SP1 settlement proof → Verified Inference (zkLLM, active build).

To learn more about the protocol design, read the [whitepaper](WHITEPAPER.md). For live endpoints and what is real vs mock today, see [runtime state](docs/RUNTIME_STATE.md). Full documentation hub: [docs/](docs/README.md).

**Live app:** https://xfuel.app  
**Public API:** https://api-testnet.xfuel.app

## Table of Contents

- [Setup](#setup)
- [Using the API](#using-the-api)
- [Agent toolkit](#agent-toolkit)
- [Documentation](#documentation)
- [Security](#security)

## Setup

### Prerequisites

Install **Node.js 20+** and **npm 10+**. A Rust toolchain is required if you build CosmWasm, SP1, or zkLLM crates.

### Build and test

Clone the repository, install dependencies, compile contracts, and run the test suite:

```bash
git clone https://github.com/XFuel-Lab/xfuel-protocol.git
cd xfuel-protocol
npm install
npx hardhat compile
npx hardhat test
```

### Agent gateway

The agent-facing API (routing, payments, proving, receipts) runs from `services/gateway`:

```bash
cd services/gateway
npm install
npm run m2m-server
```

The gateway listens on `http://localhost:3002` by default. Env examples live under `services/gateway/`. Production layout is documented in [runtime state](docs/RUNTIME_STATE.md).

### Website

```bash
cd apps/web
npm install
npm run dev
```

## Using the API

Submit an inference task against the hosted testnet demo (public demo key, rate-limited):

```bash
curl -X POST https://api-testnet.xfuel.app/task-request \
  -H "Content-Type: application/json" \
  -H "X-API-Key: xfuel-demo" \
  -d '{
    "message_type": "inference_request",
    "chain_id": "base",
    "model_id": "llama-3-70b",
    "amount": "1000000",
    "sender": "0xYourAddress",
    "input_hash": "0xabc...",
    "payment": { "rail": "usdc" }
  }'
```

The same host exposes an OpenAI-compatible surface:

```bash
curl https://api-testnet.xfuel.app/v1/chat/completions \
  -H "Authorization: Bearer xfuel-demo" \
  -H "Content-Type: application/json" \
  -d '{"model":"llama-3-70b","messages":[{"role":"user","content":"hi"}]}'
```

API reference: [M2M API](docs/M2M_API.md) · OpenAI gateway: [docs here](docs/OPENAI_COMPATIBLE_GATEWAY.md) · Payments: [x402 adapter](docs/X402_ADAPTER.md).

## Agent toolkit

```bash
npm install xfuel-sdk
npx xfuel-mcp
```

- TypeScript SDK — [packages/sdk](packages/sdk/README.md)
- MCP server — [packages/mcp](packages/mcp/README.md)
- Agent playbook — [packages/agent-skills](packages/agent-skills/AGENT_PLAYBOOK.md)

## Documentation

| Doc | Description |
|-----|-------------|
| [WHITEPAPER.md](WHITEPAPER.md) | Protocol design |
| [docs/README.md](docs/README.md) | Documentation hub |
| [docs/RUNTIME_STATE.md](docs/RUNTIME_STATE.md) | As-deployed state |
| [docs/POSITIONING.md](docs/POSITIONING.md) | Messaging |
| [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md) | Deployment |
| [docs/TESTING.md](docs/TESTING.md) | Tests |
| [AGENTS.md](AGENTS.md) | Agent / LLM index |
| [CONTRIBUTING.md](CONTRIBUTING.md) | Contributing |

## Security

Bug bounty (up to $50,000 critical): [docs/bug-bounty.md](docs/bug-bounty.md).  
Reporting policy: [SECURITY.md](SECURITY.md).

---

MIT License — see [LICENSE](LICENSE).
