# Chit402 Documentation

Verifiable settlement and payments for AI compute — USDC via x402 on Base, tiered proofs, provider-agnostic routing.

https://chit402.com · https://api.chit402.com (alias: https://api.xfuel.app)

---

## Start here

| You are… | Open |
|----------|------|
| A design partner / builder | [DESIGN_PARTNER_ONBOARDING.md](./DESIGN_PARTNER_ONBOARDING.md) |
| Checking live state | [RUNTIME_STATE.md](./RUNTIME_STATE.md) |
| The founder | [STRATEGY.md](./STRATEGY.md) · [BEACHHEAD_ICP.md](./BEACHHEAD_ICP.md) |

Everything else is reference. Do not send partners this index.

---

## Company

| Doc | Purpose |
|-----|---------|
| [POSITIONING.md](./POSITIONING.md) | Locked messaging |
| [PROVIDER_FLOAT_TREASURY.md](./PROVIDER_FLOAT_TREASURY.md) | USDC in / provider float COGS |
| [TIER3_TIMEBOX_DECISION.md](./TIER3_TIMEBOX_DECISION.md) | zkLLM narrow / continue gates |
| [PRIVATE_SPEND_THESIS.md](./PRIVATE_SPEND_THESIS.md) | Spend / vendor-blind privacy |
| [SPEND_INTELLIGENCE_THESIS.md](./SPEND_INTELLIGENCE_THESIS.md) | Agent spend analytics (thesis) |
| [MAINNET_X402_CHECKLIST.md](./MAINNET_X402_CHECKLIST.md) | Turn on Base mainnet USDC fees |
| [../WHITEPAPER.md](../WHITEPAPER.md) | Protocol design |
| [../README.md](../README.md) | Clone, build, try the API |

---

## Build

| Doc | Purpose |
|-----|---------|
| [M2M_API.md](./M2M_API.md) | REST API |
| [BOARD_INBOUND.md](./BOARD_INBOUND.md) | External job board → Chit payout receipt |
| [product/openrouter-broadcast.md](./product/openrouter-broadcast.md) | Chit receipts for OpenRouter Broadcast |
| [CHAT_COMPLETIONS_GATEWAY.md](./CHAT_COMPLETIONS_GATEWAY.md) | Chat completions `/v1` |
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

---

## Trust & security

| Doc | Purpose |
|-----|---------|
| [VERIFIED_INFERENCE_TIERS.md](./VERIFIED_INFERENCE_TIERS.md) | Trust ladder |
| [TIER3_VERIFIABLE_INFERENCE_BUILD_SPEC.md](./TIER3_VERIFIABLE_INFERENCE_BUILD_SPEC.md) | zkLLM plan |
| [POMA_SPEC.md](./POMA_SPEC.md) | Model authenticity |
| [RECEIPT_SCHEMA_V2.md](./RECEIPT_SCHEMA_V2.md) | Payment-bound receipt |
| [integrations/1f916-link-v0.md](./integrations/1f916-link-v0.md) | Draft v0: Agent Record entry ↔ receipt link. Specimen 1 and Specimen 2 are stamped listing payouts. Issuance does not stamp `agent_record_entry` yet. |
| [product/export-coverage.md](./product/export-coverage.md) | Signed set commitment on book exports |
| [product/book-seq.md](./product/book-seq.md) | Per-book append position and gap check |
| [product/refusal-anchor.md](./product/refusal-anchor.md) | Base block hash on a policy refusal |
| [product/refusal-receipt.md](./product/refusal-receipt.md) | Signed refusal document (`chit402.refusal.v1`) |
| [product/receipt-merkle.md](./product/receipt-merkle.md) | Merkle inclusion, tree head, Base and Solana anchors |
| [product/receipt-log.md](./product/receipt-log.md) | Durable receipt log, epochs, S3 bundles, restore |
| [product/receipt-log-witness.md](./product/receipt-log-witness.md) | Witnessed heads and Safe-signed epochs. The contract is not deployed |
| [product/receipt-preimage.md](./product/receipt-preimage.md) | Public bytes for recomputable receipt hashes |
| [product/issuer-key-history.md](./product/issuer-key-history.md) | Signed issuer key rotation history |
| [product/verifier-digest.md](./product/verifier-digest.md) | Verifier source digest in the tree genesis |
| [product/book-act.md](./product/book-act.md) | Act type on each book row |
| [product/correction-authority.md](./product/correction-authority.md) | Subject vs writer on corrections |
| [product/supersession-fork.md](./product/supersession-fork.md) | Fork status when two successors claim one receipt |
| [ERC8004_INTEGRATION.md](./ERC8004_INTEGRATION.md) | Validation registry |
| [security-design.md](./security-design.md) | Security model |
| [bug-bounty.md](./bug-bounty.md) | Responsible disclosure |

---

## Decisions & reference

| Doc | Purpose |
|-----|---------|
| [adr/0001](./adr/0001-usdc-revenue-and-router-verifier-positioning.md) | USDC revenue |
| [adr/0002](./adr/0002-base-settlement-home.md) | Base home |
| [adr/0003](./adr/0003-verified-inference-cleanroom.md) | Clean-room Tier-3 |
| [adr/0004](./adr/0004-zkllm-prover-stack.md) | zkLLM stack |
| [adr/0005](./adr/0005-provider-float-cogs.md) | Provider float COGS |
| [adr/0006](./adr/0006-receipts-are-not-a-paid-feature.md) | Receipts are free, never gated on payment |
| [adr/0007](./adr/0007-spot-check-assurance.md) | Spot-check assurance — pool the statistics |
| [Technical-Specifications.md](./Technical-Specifications.md) | Gas / benchmarks |
| [providers/README.md](./providers/README.md) | Provider tiers |
| [REFERENCES-AND-ATTRIBUTION.md](./REFERENCES-AND-ATTRIBUTION.md) | Research credits |
| [LEGAL_LAUNCH_CHECKLIST.md](./LEGAL_LAUNCH_CHECKLIST.md) | Legal planning |

Agents: [../AGENTS.md](../AGENTS.md).
