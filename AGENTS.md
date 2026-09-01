# XFuel — Agent Index

Entry point for agents and automation.

1. [docs/STRATEGY.md](docs/STRATEGY.md) — company strategy (build-from source)  
2. [docs/RUNTIME_STATE.md](docs/RUNTIME_STATE.md) — as-deployed truth  
3. [docs/POSITIONING.md](docs/POSITIONING.md) — messaging  
4. [WHITEPAPER.md](WHITEPAPER.md) — design  

XFuel is the book. This agent spent Y on this job. You hold hub, model, and amount. `POST /v1/chat/completions` returns a signed receipt: hub, model, amount, verify_url. Cost-plus, quoted, receipted — USDC on Base or Solana. `GET|POST /v1/agents/:agent_id/book` is possession-gated. Signed receipt is table stakes.

Beachhead: crypto-native agent teams — [docs/BEACHHEAD_ICP.md](docs/BEACHHEAD_ICP.md).  
Provider COGS floats: [docs/PROVIDER_FLOAT_TREASURY.md](docs/PROVIDER_FLOAT_TREASURY.md) · [ADR 0005](docs/adr/0005-provider-float-cogs.md). 
Pricing: [docs/SPEND_INTELLIGENCE_THESIS.md](docs/SPEND_INTELLIGENCE_THESIS.md) · [docs/adr/0009-cost-plus-pricing.md](docs/adr/0009-cost-plus-pricing.md).  
Mainnet USDC go-live: [docs/MAINNET_X402_CHECKLIST.md](docs/MAINNET_X402_CHECKLIST.md).  
Privacy thesis (Private Spend): [docs/PRIVATE_SPEND_THESIS.md](docs/PRIVATE_SPEND_THESIS.md).  
Design partners: [docs/DESIGN_PARTNER_ONBOARDING.md](docs/DESIGN_PARTNER_ONBOARDING.md).

## Try the demo

Public gateway: `https://api.xfuel.app` (demo key `xfuel-demo`, rate-limited). First hour is `POST /v1/chat/completions` — no wallet. Working copy: [docs/DESIGN_PARTNER_ONBOARDING.md](docs/DESIGN_PARTNER_ONBOARDING.md).  
Windows: use `curl.exe` for raw HTTP — PowerShell `curl` is not real curl.

Status: `GET /task-status?task_id=`  
Chat completions: `POST /v1/chat/completions`, `GET /v1/models`, `GET /llms.txt`

- [docs/M2M_API.md](docs/M2M_API.md)
- [docs/CHAT_COMPLETIONS_GATEWAY.md](docs/CHAT_COMPLETIONS_GATEWAY.md)
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
