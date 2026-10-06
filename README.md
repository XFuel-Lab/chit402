# Chit402

Chit402 is the book. This agent spent Y on this job. You hold hub, model, and amount.

`POST /v1/chat/completions` returns a signed receipt: hub, model, amount, verify_url. Cost-plus, quoted, receipted — pay USDC on Base or Solana. `GET|POST /v1/agents/:agent_id/book` is possession-gated last-N collected spend. Signed receipt is table stakes (HMAC); SP1 settlement proof is on demand. The product is the collected row — sidecar + ingest if you already pay a provider; without a collected USDC `payment.ref` the receipt is client-attested only. Register is fail-closed: a collected HMAC-valid receipt plus a plain EOA (personal_sign), AAWP official, or smart-account `agentWallet`.

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

The agent-facing API (settlement, payments, proving, receipts) runs from `services/gateway`:

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

## Try the paid door

No account. No API key. A wallet that can pay the 402 is enough. Register is only to hold the book after a collected receipt.

```bash
curl.exe -sS -D - -X POST https://api.chit402.com/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{}'
```

Unauthenticated `/v1` returns HTTP 402 with payment requirements (USDC on Base or Solana). The receipt prices the next call. Working copy: [docs/DESIGN_PARTNER_ONBOARDING.md](docs/DESIGN_PARTNER_ONBOARDING.md).

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

## Dual anchoring

Each UTC day the gateway signs the receipt Merkle root and publishes it in two places. `GET /v1/receipts/tree/head` returns both under `anchors.base` and `anchors.solana` (`signature`, `slot`, `cluster`, `memo`). A missing key or a failed send leaves that side `pending`. A day that already has a Solana signature is not posted again. Details: [docs/product/receipt-merkle.md](docs/product/receipt-merkle.md).

`ChitLogWitness` can accept an RFC 6962 consistency proof on Base. It is off unless `RECEIPT_LOG_WITNESS=1`, and this repository does not deploy it. With the flag off, the Base post is still the zero-value transaction whose calldata is the root. See [docs/product/receipt-log-witness.md](docs/product/receipt-log-witness.md).

| Chain | Env | What is posted |
|-------|-----|----------------|
| Base | `RECEIPT_ANCHOR_PRIVATE_KEY`, optional `RECEIPT_ANCHOR_FROM`, `BASE_RPC_URL` or `SETTLEMENT_RPC_URL` | Zero-value transaction, calldata = 32-byte root |
| Solana | `SOLANA_ANCHOR_SECRET_KEY` (base58 or JSON array), `SOLANA_RPC_URL`, optional `SOLANA_ANCHOR_CLUSTER` (default `mainnet-beta`; `devnet` for tests) | SPL Memo `chit402:root:v1:<book_or_global>:<yyyy-mm-dd>:<root_hex>:<prev_root_hex>` |

Keys stay in the host environment. They are not read from a file in this repo.

```bash
npx chit402-verify receipt.json inclusion.json head.json --rpc
```

That checks the inclusion proof, fetches the Solana transaction and requires the memo to contain the root, and checks the Base calldata the same way. It prints what this proves and what it does not prove.

One memo costs the Solana base fee: 5,000 lamports, 0.000005 SOL. No account is created, so there is no rent, and the sender does not add a priority fee. At about $120 per SOL that is under $0.001.

Devnet smoke (export the variables in the shell; the script does not load an env file):

```bash
export SOLANA_ANCHOR_SECRET_KEY   # base58 or JSON array, host env only
export SOLANA_ANCHOR_CLUSTER=devnet
export SOLANA_RPC_URL=https://api.devnet.solana.com
node scripts/solana-anchor-smoke
```

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
