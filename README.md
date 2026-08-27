# XFuel Protocol

XFuel is the book. This agent spent Y on this job. You hold hub, model, and amount. Not a smart router. Not a model shop.

`POST /v1/chat/completions` is **$0.01 USDC on Base and Solana**. `GET|POST /v1/agents/:agent_id/book` is possession-gated last-N collected spend. Signed receipt is table stakes (HMAC); SP1 settlement proof is on demand. Live routes today are Theta and Akash. Demo key `xfuel-demo` skips payment (rate-limited). Register is fail-closed: a collected HMAC-valid receipt plus an AAWP official or smart-account `agentWallet`.

To learn more about the protocol design, read the [whitepaper](WHITEPAPER.md). For live endpoints and what is real vs mock today, see [runtime state](docs/RUNTIME_STATE.md). Full documentation hub: [docs/](docs/README.md).

**Live app:** https://xfuel.app  
**Public API:** https://api.xfuel.app

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

## Try the demo

First hour is unmetered OpenAI `/v1` on `https://api.xfuel.app` (demo key `xfuel-demo`). No wallet. Working copy: [docs/DESIGN_PARTNER_ONBOARDING.md](docs/DESIGN_PARTNER_ONBOARDING.md).

```
npm install xfuel-sdk
npx xfuel-mcp
```

`flagship-demo.ts` is the **paid** `/task-request` path (402 without a payer). Do not start there.

- TypeScript SDK — [packages/sdk](packages/sdk/README.md)
- MCP server — [packages/mcp](packages/mcp/README.md)
- Agent playbook — [packages/agent-skills](packages/agent-skills/AGENT_PLAYBOOK.md)
- Hosted endpoint — [docs/HOSTED_TESTNET_ENDPOINT.md](docs/HOSTED_TESTNET_ENDPOINT.md)

**Windows note:** if you use raw HTTP, call `curl.exe` — PowerShell’s `curl` is not real curl.

API reference: [M2M API](docs/M2M_API.md) · OpenAI gateway: [docs here](docs/OPENAI_COMPATIBLE_GATEWAY.md) · Payments: [x402 adapter](docs/X402_ADAPTER.md).

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

Responsible disclosure (safe harbour; no cash bounty until the first audit): [docs/bug-bounty.md](docs/bug-bounty.md).  
Reporting policy: [SECURITY.md](SECURITY.md).

---

Apache-2.0 — see [LICENSE](LICENSE).
