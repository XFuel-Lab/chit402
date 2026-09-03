# Contributing

Chit402 is the verifiable settlement and payments layer for AI compute: route inference, settle USDC on Base via x402, return tiered receipts. Money and proofs live on Base ([ADR 0002](docs/adr/0002-base-settlement-home.md)).

Live beta: Tier-1 receipts + Tier-2 SP1 on Base; 755+ tests; Audit Phase 1 prep.

## Quick wins

- Clarify [README.md](README.md) or [WHITEPAPER.md](WHITEPAPER.md)
- Report issues against https://xfuel.app or https://api.xfuel.app
- Review open PRs; flag gas or trust-boundary issues in `contracts/core/`
- Suggest Base / x402 / agent ecosystem outreach (non-code)

## Setup

Prerequisites: Node.js 20+, npm 10+, Rust (for SP1 / zkLLM / CosmWasm).

```
git clone https://github.com/YOUR_USERNAME/xfuel-protocol.git
cd xfuel-protocol
npm install
npx hardhat compile
npx hardhat test
```

Gateway:

```
cd services/gateway
npm install
npm run m2m-server
```

As-deployed layout: [docs/RUNTIME_STATE.md](docs/RUNTIME_STATE.md).  
Tests: [docs/TESTING.md](docs/TESTING.md).

## Where to work

| Area | Path |
|------|------|
| Core settlement | `contracts/core/` |
| Circuits | `contracts/circuits/` |
| Gateway / M2M / OpenAI | `services/gateway/` |
| SP1 settlement prover | `services/sp1-prover/` |
| zkLLM (Tier-3) | `services/zkllm-prover/` |
| SDK / MCP / skills | `packages/sdk`, `packages/mcp`, `packages/agent-skills` |
| Web | `apps/web/` |

## Pull requests

1. Branch from `main` (never push directly to `main` / `master` / `develop`)
2. Keep PRs focused; match existing style and sparse docs format
3. Add or update tests for behavior changes
4. Link docs when you change public APIs or runtime topology
5. Do not commit secrets (`.env`, keys, credentials)

Commit messages: short, imperative, explain why.

Local hook: set `GIT_COMMIT_CONFIRMED=YES` for non-interactive commits (see [AGENTS.md](AGENTS.md)).

## Security

Report vulnerabilities privately — [SECURITY.md](SECURITY.md), [docs/bug-bounty.md](docs/bug-bounty.md).

## Docs style

Canonical docs use plain headings, short paragraphs, and link lists (see [README.md](README.md) and [docs/README.md](docs/README.md)). Prefer satellites for depth; keep front doors lean. Narrative: Base settlement, USDC/x402, token-light fees, tiered proofs, provider-agnostic routing.

## License

By contributing you agree your contributions are under the project license — see [LICENSE](LICENSE).
