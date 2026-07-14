---
name: xfuel-a2a-bid
description: >-
  Coordinate agent-to-agent work on XFuel's A2A circuit: discover provider
  agents, send an A2A message with TFUEL escrow, settle a bid on delivery via
  Fair Exchange (PAS signature), and (on-chain) form agent swarms of up to 18
  members. Use when an agent needs to delegate a task to another agent, run a
  compute auction, escrow payment for a result, or join/coordinate a swarm.
---

# XFuel: Agent-to-Agent Bidding

Drive the A2A lifecycle: an orchestrator agent discovers providers, escrows TFUEL
on a bid, (optionally) delegates the actual compute as an M2M task, coordinates a
swarm, and settles trustlessly on delivery. Messaging + escrow + Fair-Exchange
settlement go through the REST API; raw on-chain bid/swarm calls use `A2ACircuit`
(server-side relayer or returned calldata — skills never hold keys).

## Lifecycle at a glance

```
discover ──► bid (TFUEL escrow) ──► [delegate compute as M2M task] ──► settle (Fair Exchange)
   │                                        │                                 │
capability_query                    submitInference (USDC/x402 | TFUEL)   settleWithFairExchange
   │                                                                          │
   └───────────────── swarm (on-chain): formSwarm → joinSwarm → settleSwarmAgent ─┘
```

**Two payment surfaces — don't conflate them:**
- **A2A escrow** (bid + Fair-Exchange settle) is **TFUEL-native on-chain** via `A2ACircuit`.
- The **delegated compute** is an ordinary M2M task and settles in **USDC via x402 (default)
  or TFUEL** — see `xfuel-submit-inference` and `../_shared/reference/payments-x402.md`.

**Runnable example:** [`sdk/js/examples/a2a-swarm.ts`](../../sdk/js/examples/a2a-swarm.ts)
— `npx tsx examples/a2a-swarm.ts` (swarm calldata + payer run offline; the REST
steps run against a live API and skip gracefully when it's unreachable).

## Prerequisites

- `XFUEL_API_URL`, `XFUEL_API_KEY`.
- On-chain settlement needs `A2A_CIRCUIT_ADDRESS` configured on the server (the
  server submits via its relayer, or returns calldata if no relayer is set).

## Parameters

| Name | Required | Description |
|------|----------|-------------|
| `action` | yes | `discover` \| `message` \| `settle` \| `swarm-plan`. |
| `message_type` | message | `compute_bid` \| `inference_request` \| `capability_query`. |
| `sender_chain` / `recipient_chain` | message | One of `theta\|osmosis\|akash\|bittensor\|persistence`. |
| `payload_hash` | message | SHA-256 of the task payload (hex). |
| `escrow_amount` | message (bid/inference) | TFUEL escrow in wei. `capability_query` must be 0. |
| `ttl` | message | Seconds, 1–86400. |
| `sender_address` / `sender_identity` | message | Agent address + identity commitment (hex). |
| `ibc_channel` | cross-chain | Required when sender_chain ≠ recipient_chain. |
| `bid_id` / `result_hash` / `v` / `r` / `s` | settle | Fair-Exchange settlement params. |

## Procedure

1. **discover** — query capabilities (zero escrow):

   ```js
   import { XFuelClient } from 'xfuel-sdk';
   const client = new XFuelClient({ baseUrl: process.env.XFUEL_API_URL, apiKey: process.env.XFUEL_API_KEY });
   const res = await client.sendA2AMessage({
     message_type: 'capability_query',
     sender_chain: 'theta', recipient_chain: 'theta',
     payload_hash: '0x...', ttl: 600,
     sender_address: '0xAgentA', sender_identity: '0xIdentityCommitment',
   });
   ```

2. **message** — submit a `compute_bid` / `inference_request` with TFUEL escrow. A
   0.1% relay fee applies on the escrow. Track via
   `client.getA2AStatus(res.message_id)`.

   ```js
   const bid = await client.sendA2AMessage({
     message_type: 'compute_bid',
     sender_chain: 'theta', recipient_chain: 'theta',
     payload_hash: '0x..sha256..', escrow_amount: '500000000000000000', // 0.5 TFUEL
     ttl: 3600, sender_address: '0xAgentA', sender_identity: '0xIdentityCommitment',
   });
   ```

3. **delegate compute (optional)** — run the actual work as an M2M task. This is
   where the **USDC/x402 vs TFUEL** choice lives (A2A escrow above stays TFUEL):

   ```js
   import { createMockPayer } from 'xfuel-sdk'; // or createEip3009Payer from 'xfuel-sdk/onchain'
   const task = await client.submitInference('llama-3-70b', '0xAgentA', '1000000', {
     chain_id: 'theta', input_hash: '0x..',
     payment: { rail: 'usdc', network: 'base', maxAmount: '50000' }, // or { rail: 'tfuel' }
     payer: createMockPayer(),                                        // omit for TFUEL
   });
   ```

4. **settle** — once a provider delivers, settle trustlessly via Fair Exchange
   (PAS signature over the result):

   ```js
   const out = await client.settleWithFairExchange({
     bid_id: '0x..32bytes..', result_hash: '0x..32bytes..', v, r, s,
   });
   // out.status: 'submitted' (relayer) | 'calldata' (sign & submit yourself)
   ```

5. **swarm-plan** — for multi-agent jobs, coordinate the on-chain lifecycle:
   `formSwarm(objectiveHash, maxMembers≤18) → joinSwarm(swarmId) →
   settleSwarmAgent(...)`. Build the calldata with `xfuel-sdk/onchain` (no keys):

   ```js
   import { XFuelOnChain } from 'xfuel-sdk/onchain';
   const chain = new XFuelOnChain({ a2aCircuitAddress: process.env.A2A_CIRCUIT_ADDRESS });
   const form = chain.encodeFormSwarm('0x..objectiveHash..', 18, '500000000000000000');
   const join = chain.encodeJoinSwarm('0x..swarmId..');
   // { to, data, value } → submit via the server relayer or sign yourself.
   ```

   Related builders: `encodeRegisterAgent`, `encodeSubmitBid`, `encodeAcceptBid`,
   `encodeSettleBid`, `encodeSettleBidFairExchange`.

   For the **full N-agent swarm lifecycle** (form → join → settle members →
   dissolve, reads, phases, fees), use the dedicated
   [`xfuel-swarm-coordinate`](../xfuel-swarm-coordinate/SKILL.md) skill.

## Failure modes

- `400` — `capability_query` with non-zero escrow, or cross-chain message without
  `ibc_channel`.
- `503 service_unavailable` — `A2A_CIRCUIT_ADDRESS` not configured for settlement.
- `200 status: calldata` — no relayer configured; submit the returned calldata to
  `A2ACircuit` with your own signer (out of band).
- Swarm full (18 members) — `joinSwarm` reverts; form an additional swarm.

## Notes

- Identity commitments and bids use ZK nullifiers for replay protection.
- **Escrow rail:** A2A escrow (`escrow_amount`) is **TFUEL-native and on-chain** via
  `A2ACircuit` — it is *not* the M2M `/task-request` payment rail. The USDC-via-x402
  default (see `../_shared/reference/payments-x402.md`) applies to M2M task
  submission, not to A2A on-chain escrow, which remains TFUEL in Phase 1. A future
  phase may add a USDC micropayment-channel path (x402-style) for A2A.
- Schemas: `../_shared/reference/m2m-openapi.yaml`; A2A contract surface in
  the repo root `AGENTS.md` (Agent-to-Agent section).
