# XFuel — Agent Index

Entry point for agents and automation.

1. [docs/RUNTIME_STATE.md](docs/RUNTIME_STATE.md) — as-deployed truth  
2. [docs/POSITIONING.md](docs/POSITIONING.md) — messaging  
3. [WHITEPAPER.md](WHITEPAPER.md) — design  

XFuel settles AI compute in USDC on Base (x402), routes to pluggable providers, and returns tiered receipts (signed → SP1 on Base → Verified Inference build).

## Submit a task

```
POST {host}:3002/task-request
Headers: X-API-Key: {key}

{
  "message_type": "inference_request",
  "chain_id": "base",
  "amount": "1000000",
  "sender": "0xYourAddress",
  "model_id": "llama-3-70b",
  "input_hash": "0xabc...",
  "payment": { "rail": "usdc", "network": "base-sepolia" }
}
```

Status: `GET /task-status?task_id=`  
OpenAI: `POST /v1/chat/completions`, `GET /v1/models`, `GET /llms.txt`

- [docs/M2M_API.md](docs/M2M_API.md)
- [docs/OPENAI_COMPATIBLE_GATEWAY.md](docs/OPENAI_COMPATIBLE_GATEWAY.md)
- [docs/X402_ADAPTER.md](docs/X402_ADAPTER.md)
- [packages/agent-skills/AGENT_PLAYBOOK.md](packages/agent-skills/AGENT_PLAYBOOK.md)

```
npm install xfuel-sdk
npx xfuel-mcp
```

Public test gateway: `https://api-testnet.xfuel.app`

## Contracts (Base)

- `ZKVerifierSP1` — mainnet `0x9373499645292715a2275A78eD65B14215C41c06` (see `deploy/manifests/`)
- Fee sink — `X402_PAY_TO` / Splits v2 (USDC)
- `veXFGovernance` — post-TGE
- `SP1ProofHooks` — library

See ADR 0001 (revenue) and ADR 0002 (Base home).

## Repo map

```
services/gateway/        API, routing, payments, receipts
services/sp1-prover/     Tier-2 SP1
services/zkllm-prover/   Tier-3 Verified Inference
contracts/core/          Settlement contracts
packages/sdk|mcp|agent-skills/
docs/                    Start at docs/README.md
```

Tests:

```
npm run test:contracts:core
npm run test:contracts:all
cd services/zkllm-prover && cargo test
```

## Commits

Interactive pre-commit asks for `YES`. For agents:

```
GIT_COMMIT_CONFIRMED=YES git commit -F <msg-file>
```

PowerShell: `$env:GIT_COMMIT_CONFIRMED='YES'; git commit -F <msg-file>`

Do not use `--no-verify`. Do not push directly to `main`.

## Security

security@xfuel.app · [docs/bug-bounty.md](docs/bug-bounty.md) · up to $50,000 Critical
