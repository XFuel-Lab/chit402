# Chit402

Chit402 is the book. This agent spent Y on this job. You hold hub, model, and amount.

`POST /v1/chat/completions` returns a signed receipt: hub, model, amount, verify_url. Cost-plus, quoted, receipted — pay USDC on Base or Solana. `GET|POST /v1/agents/:agent_id/book` is possession-gated last-N collected spend. Signed receipt is table stakes (HMAC); SP1 settlement proof is on demand. The product is the collected row — sidecar + ingest if you already pay a provider; without a collected USDC `payment.ref` the receipt is client-attested only. Demo key `chit402-demo` skips payment (rate-limited). Register is fail-closed: a collected HMAC-valid receipt plus an AAWP official or smart-account `agentWallet`.

To learn more about the protocol design, read the [whitepaper](WHITEPAPER.md). For live endpoints and what is real vs mock today, see [runtime state](docs/RUNTIME_STATE.md). Full documentation hub: [docs/](docs/README.md).

**Live app:** https://chit402.com  
**Public API:** https://api.chit402.com

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
git clone https://github.com/XFuel-Lab/chit402.git
cd chit402
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

No account. No API key. A wallet that can pay the 402 is enough. Register is only to hold the book after a collected receipt.

```bash
curl.exe -sS -D - -X POST https://api.chit402.com/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{}'
```

Unauthenticated `/v1` returns HTTP 402 with payment requirements (USDC on Base or Solana). The receipt prices the next call. Demo key `chit402-demo` skips payment (rate-limited). Working copy: [docs/DESIGN_PARTNER_ONBOARDING.md](docs/DESIGN_PARTNER_ONBOARDING.md).

```
npm install chit402-sdk
npx chit402-mcp
```

`flagship-demo.ts` is the **paid** `/task-request` path (402 without a payer). Do not start there.

- TypeScript SDK — [packages/sdk](packages/sdk/README.md)
- MCP server — [packages/mcp](packages/mcp/README.md)
- Agent playbook — [packages/agent-skills](packages/agent-skills/AGENT_PLAYBOOK.md)

**Windows note:** if you use raw HTTP, call `curl.exe` — PowerShell’s `curl` is not real curl.

API reference: [M2M API](docs/M2M_API.md) · Chat completions: [docs here](docs/CHAT_COMPLETIONS_GATEWAY.md) · Payments: [x402 adapter](docs/X402_ADAPTER.md).

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
