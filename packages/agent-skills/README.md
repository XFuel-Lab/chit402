# XFuel Agent Skills

Installable [Agent Skills](https://docs.claude.com/en/docs/agents-and-tools/agent-skills)
that let any AI agent use the **XFuel Protocol** as a first-class capability:
submit verifiable AI inference across decentralized GPU providers, retrieve ZK
proofs, and coordinate agent-to-agent (A2A) work — settled in **USDC via x402
(default)** or **TFUEL on Theta**.

> XFuel is a ZK settlement and orchestration layer for AI compute across
> decentralized GPU networks (DePIN). These skills are the agent-facing front
> door to that layer. See the repo root `AGENTS.md` for the full protocol map.

**New here?** Start with the [**Agent Playbook**](./AGENT_PLAYBOOK.md) — an
end-to-end narrative of the main flows (verifiable inference, proof verification,
A2A coordination, swarm management) with links to every skill and runnable example.

**Just want inference?** XFuel also serves an **OpenAI-compatible endpoint**
(`GET /v1/models`, `POST /v1/chat/completions`, streaming supported). Point any
OpenAI client's `baseURL` at `${XFUEL_API_URL}/v1` — every response carries a
verifiable-compute receipt (`x-xfuel-*` headers + an `xfuel` body field). See
[Playbook · Flow 0](./AGENT_PLAYBOOK.md#flow-0--drop-in-openai-compatible-endpoint).

## Skills in this directory

| Skill | What it does |
|-------|--------------|
| [`xfuel-submit-inference`](./xfuel-submit-inference/SKILL.md) | Submit a verifiable inference/compute task and wait for a proof-backed, on-chain-settled result. |
| [`xfuel-verify-proof`](./xfuel-verify-proof/SKILL.md) | Fetch and validate the SP1/zkGPT proof + nullifier for a completed task. |
| [`xfuel-a2a-bid`](./xfuel-a2a-bid/SKILL.md) | Discover provider agents, bid (TFUEL escrow), delegate compute, and settle 1:1 via Fair Exchange on the A2A circuit. |
| [`xfuel-swarm-coordinate`](./xfuel-swarm-coordinate/SKILL.md) | Form and manage multi-agent swarms end-to-end (register → form → join → settle members → dissolve, up to 18 agents). |
| [`xfuel-route-compute`](./xfuel-route-compute/SKILL.md) | Inspect the 6-tier DePIN router and provider availability before submitting. |
| [`xfuel-relay-proof-crosschain`](./xfuel-relay-proof-crosschain/SKILL.md) | Relay a verified proof to Bittensor EVM (964/945) via Hyperlane. |
| [`xfuel-govern-vexf`](./xfuel-govern-vexf/SKILL.md) | Lock XF, read voting power, create proposals, and vote (veXF). |

Skills that build on-chain calldata use the SDK on-chain module
(`xfuel-sdk/onchain`, requires `ethers`). Signing stays server-side/out-of-band.

## Payment rails

Task-submitting skills accept a `payment` object. **USDC via x402 (on Base) is the
default/recommended rail**; **TFUEL on Theta** is the secondary rail. The server-side
402 handshake is flag-gated (`X402_ENABLED`, Phase 1) with TFUEL fallback, so behavior
is safe while the facilitator rolls out. Preview per-rail pricing with `POST
/task-quote`. Full detail: [`_shared/reference/payments-x402.md`](./_shared/reference/payments-x402.md).

## Spec & versioning

- Skills follow the Agent Skills Specification: each skill is a directory
  containing a `SKILL.md` with YAML frontmatter (`name`, `description`) plus a
  markdown body. Shared reference material lives in [`_shared/reference/`](./_shared/reference/)
  and is referenced via progressive disclosure (don't inline large schemas).
- **Spec version pinned:** Agent Skills Specification (2025-10).
- Skills are REST-only and never hold private keys (see secrets policy below).

## Install / use

1. Run the XFuel M2M API server (`services/gateway/`, default port 3002) or
   point at a hosted deployment.
2. Set environment: `XFUEL_API_URL` and `XFUEL_API_KEY`.
3. Drop a skill directory into your agent's skills folder (e.g. Cursor/Claude
   `.cursor/skills/` or your framework's skills path).

Full config matrix: [`_shared/reference/env-and-endpoints.md`](./_shared/reference/env-and-endpoints.md).
API schemas: [`_shared/reference/m2m-openapi.yaml`](./_shared/reference/m2m-openapi.yaml).

## Secrets policy

Skills default to REST and rely on the server to hold relayer keys. A skill must
never request or embed a private key. On-chain settlement is performed by the
backend relayer or returned as calldata for the caller to sign out-of-band.
