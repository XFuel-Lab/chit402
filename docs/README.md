# XFuel Documentation

Verifiable settlement and payments for AI compute â€” USDC via x402 on Base, tiered proofs, provider-agnostic routing.

https://xfuel.app Â· https://api-testnet.xfuel.app

---

## Start here

| Doc | Purpose |
|-----|---------|
| [RUNTIME_STATE.md](./RUNTIME_STATE.md) | Live endpoints, real vs mock |
| [POSITIONING.md](./POSITIONING.md) | Locked messaging |
| [../WHITEPAPER.md](../WHITEPAPER.md) | Protocol design |
| [../README.md](../README.md) | Clone, build, try the API |

---

## Build

| Doc | Purpose |
|-----|---------|
| [M2M_API.md](./M2M_API.md) | REST API |
| [OPENAI_COMPATIBLE_GATEWAY.md](./OPENAI_COMPATIBLE_GATEWAY.md) | OpenAI `/v1` |
| [X402_ADAPTER.md](./X402_ADAPTER.md) | USDC payments |
| [../packages/sdk/README.md](../packages/sdk/README.md) | TypeScript SDK |
| [../packages/mcp/README.md](../packages/mcp/README.md) | MCP server |
| [../packages/agent-skills/AGENT_PLAYBOOK.md](../packages/agent-skills/AGENT_PLAYBOOK.md) | Agent flows |

---

## Operate

| Doc | Purpose |
|-----|---------|
| [DEPLOYMENT.md](./DEPLOYMENT.md) | Deploy |
| [TESTING.md](./TESTING.md) | Tests |
| [HOSTED_TESTNET_ENDPOINT.md](./HOSTED_TESTNET_ENDPOINT.md) | Public demo API + demo path |

---

## Trust & security

| Doc | Purpose |
|-----|---------|
| [VERIFIED_INFERENCE_TIERS.md](./VERIFIED_INFERENCE_TIERS.md) | Trust ladder |
| [VERIFIED_INFERENCE_HANDOFF.md](./VERIFIED_INFERENCE_HANDOFF.md) | Tier-3 handoff |
| [TIER3_VERIFIABLE_INFERENCE_BUILD_SPEC.md](./TIER3_VERIFIABLE_INFERENCE_BUILD_SPEC.md) | zkLLM plan |
| [POMA_SPEC.md](./POMA_SPEC.md) | Model authenticity |
| [RECEIPT_SCHEMA_V2.md](./RECEIPT_SCHEMA_V2.md) | Payment-bound receipt |
| [ERC8004_INTEGRATION.md](./ERC8004_INTEGRATION.md) | Validation registry |
| [AUDIT_READINESS_CHECKLIST.md](./AUDIT_READINESS_CHECKLIST.md) | Audit Phase 1 |
| [security-design.md](./security-design.md) | Security model |
| [bug-bounty.md](./bug-bounty.md) | Bounty |

---

## Decisions & reference

| Doc | Purpose |
|-----|---------|
| [adr/0001](./adr/0001-usdc-revenue-and-router-verifier-positioning.md) | USDC revenue |
| [adr/0002](./adr/0002-base-settlement-home.md) | Base home |
| [adr/0003](./adr/0003-verified-inference-cleanroom.md) | Clean-room Tier-3 |
| [adr/0004](./adr/0004-zkllm-prover-stack.md) | zkLLM stack |
| [CIRCUITS.md](./CIRCUITS.md) | Circuits |
| [Technical-Specifications.md](./Technical-Specifications.md) | Gas / benchmarks |
| [providers/README.md](./providers/README.md) | Provider tiers |
| [TAO_CIRCUIT_HYPERLANE_E2E.md](./TAO_CIRCUIT_HYPERLANE_E2E.md) | Optional Bittensor relay |
| [REFERENCES-AND-ATTRIBUTION.md](./REFERENCES-AND-ATTRIBUTION.md) | Research credits |
| [FUNDRAISING_STRUCTURE.md](./FUNDRAISING_STRUCTURE.md) | Equity-first raise (counsel) |
| [LEGAL_LAUNCH_CHECKLIST.md](./LEGAL_LAUNCH_CHECKLIST.md) | Legal planning |

Agents: [../AGENTS.md](../AGENTS.md). Historical: [_archive/](./_archive/README.md).
