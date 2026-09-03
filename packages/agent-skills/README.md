# Chit402 Agent Skills

Chit402 is the book. This agent spent Y on this job. You hold hub, model, and amount. Installable skills so agents can submit inference, read the possession-gated book, verify settlement proofs, pay USDC via x402, and coordinate A2A / swarms.

Start here: [AGENT_PLAYBOOK.md](./AGENT_PLAYBOOK.md).  
Protocol map: [AGENTS.md](../../AGENTS.md).  
As-deployed: [docs/RUNTIME_STATE.md](../../docs/RUNTIME_STATE.md).

Chat completions drop-in: point `baseURL` at `${XFUEL_API_URL}/v1` — see [docs/CHAT_COMPLETIONS_GATEWAY.md](../../docs/CHAT_COMPLETIONS_GATEWAY.md).

## Skills

| Skill | Purpose |
|-------|---------|
| `xfuel-submit-inference` | Submit task and wait for receipt / proof |
| `xfuel-verify-proof` | Fetch and validate SP1 settlement proof |
| `xfuel-a2a-bid` | Bid / delegate / settle 1:1 |
| `xfuel-swarm-coordinate` | Swarm lifecycle (up to 18) |
| `xfuel-route-compute` | Router / provider availability |
| `xfuel-relay-proof-crosschain` | Hyperlane relay to Bittensor EVM |
| `xfuel-govern-vexf` | veXF lock / proposals / votes |

Shared reference: [`_shared/reference/`](./_shared/reference/). Skills are REST-only and never hold private keys.

## Payment

Default task rail: USDC via x402 on Base. Preview with `POST /task-quote`. Detail: [`_shared/reference/payments-x402.md`](./_shared/reference/payments-x402.md).

## Install

1. Run gateway (`services/gateway` → `npm run m2m-server`) or use the hosted demo  
2. Set `XFUEL_API_URL` and `XFUEL_API_KEY`  
3. Copy a skill directory into your agent’s skills folder  
