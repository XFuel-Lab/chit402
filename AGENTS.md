# XFuel — Agent Index

Entry point for agents and automation.

1. [docs/STRATEGY.md](docs/STRATEGY.md) — company strategy (build-from source)  
2. [docs/RUNTIME_STATE.md](docs/RUNTIME_STATE.md) — as-deployed truth  
3. [docs/POSITIONING.md](docs/POSITIONING.md) — messaging  
4. [WHITEPAPER.md](WHITEPAPER.md) — design  

XFuel is the crypto control plane for AI compute: settle in USDC on Base (x402), route across pluggable providers (DePIN + frontier), return tiered proof receipts (signed → SP1 on Base → Verified Inference build).

Beachhead: crypto-native agent teams — [docs/BEACHHEAD_ICP.md](docs/BEACHHEAD_ICP.md).  
Provider COGS floats: [docs/PROVIDER_FLOAT_TREASURY.md](docs/PROVIDER_FLOAT_TREASURY.md) · [ADR 0005](docs/adr/0005-provider-float-cogs.md).  
Mainnet USDC go-live: [docs/MAINNET_X402_CHECKLIST.md](docs/MAINNET_X402_CHECKLIST.md).  
Privacy thesis (Private Spend): [docs/PRIVATE_SPEND_THESIS.md](docs/PRIVATE_SPEND_THESIS.md).  
**Your open actions:** [docs/FOUNDER_ACTIONS.md](docs/FOUNDER_ACTIONS.md).  
Design partners: [docs/DESIGN_PARTNER_ONBOARDING.md](docs/DESIGN_PARTNER_ONBOARDING.md).  
Seed scaffold: [docs/SEED_READINESS.md](docs/SEED_READINESS.md).

## Try the demo

```
cd packages/sdk
npx tsx examples/flagship-demo.ts
```

Public test gateway: `https://api-testnet.xfuel.app` (demo key `xfuel-demo`, rate-limited).  
Windows: use `curl.exe` for raw HTTP — PowerShell `curl` is not real curl.

Status: `GET /task-status?task_id=`  
OpenAI: `POST /v1/chat/completions`, `GET /v1/models`, `GET /llms.txt`

- [docs/HOSTED_TESTNET_ENDPOINT.md](docs/HOSTED_TESTNET_ENDPOINT.md)
- [docs/M2M_API.md](docs/M2M_API.md)
- [docs/OPENAI_COMPATIBLE_GATEWAY.md](docs/OPENAI_COMPATIBLE_GATEWAY.md)
- [docs/X402_ADAPTER.md](docs/X402_ADAPTER.md)
- [packages/agent-skills/AGENT_PLAYBOOK.md](packages/agent-skills/AGENT_PLAYBOOK.md)

```
npm install xfuel-sdk
npx xfuel-mcp
```

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

## Publish SDK (npm)

CI does **not** publish. Ship manually with browser + security key (WebAuthn):

```powershell
cd packages/sdk
npm publish --access public --auth-type=web
```

Complete the browser prompt, then check https://www.npmjs.com/package/xfuel-sdk  
Details: [packages/sdk/PUBLISHING.md](packages/sdk/PUBLISHING.md).

## Security

security@xfuel.app · [docs/bug-bounty.md](docs/bug-bounty.md) · coordinated disclosure with safe harbour (no cash bounty pre-audit)
