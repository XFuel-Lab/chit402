---
name: xfuel-swarm-coordinate
description: >-
  Form and manage multi-agent swarms end-to-end on XFuel's A2A circuit
  (Almanak-style lifecycle, up to 18 agents). Use when an agent needs to
  coordinate a group of agents on a shared objective: register agents, form a
  swarm with a TFUEL escrow pool, have members join, settle each member's payout
  with a ZK proof, read live swarm state, and dissolve (or force-dissolve a
  timed-out swarm) to refund the remaining escrow. Complements xfuel-a2a-bid
  (1:1 bids) with N-agent coordination.
---

# XFuel: Swarm Coordination

Coordinate a group of agents working toward one objective. A **coordinator**
forms a swarm and funds a TFUEL **escrow pool**; **members** join; each member's
contribution is settled from the pool with a ZK proof; leftover escrow refunds to
the coordinator on dissolve. All swarm calls live on `A2ACircuit`; this skill
builds the calldata (via `xfuel-sdk/onchain`) and submits through the server
relayer or hands you signed-out-of-band calldata. **Skills never hold keys.**

## Lifecycle & phases

```
                 formSwarm            joinSwarm (×N)       settleSwarmAgent (×N)     dissolveSwarm
 registerAgent ─────────────► Forming ───────────► Active ───────────────► Settling ──────────► Dissolved
 (coordinator                 (escrow                (first join           (first settle         (refund
  + each member)               funded)                flips Active)         flips Settling)       remaining)
```

| Phase | Meaning |
|-------|---------|
| `Forming` | Created, escrow funded, coordinator is member #1. Members may join. |
| `Active` | ≥1 other member joined. Members may still join (until full) and settlements can begin. |
| `Settling` | First `settleSwarmAgent` has paid out; members can still be settled. |
| `Dissolved` | Coordinator/admin dissolved (or timed-out force-dissolve). Remaining escrow refunded. |

## Prerequisites

- `XFUEL_API_URL`, `XFUEL_API_KEY`.
- `A2A_CIRCUIT_ADDRESS` configured on the server (relayer submits, or the skill
  returns calldata). For on-chain **reads** (`getSwarm`), a Theta RPC URL.
- Coordinator **and** every member must be registered active agents
  (`registerAgent`) before forming/joining.

## Constraints & fees

- **Max size:** 18 members (`MAX_SWARM_SIZE`). `maxMembers` must be `1..18`.
- **Escrow:** `formSwarm` requires `msg.value > 0` (TFUEL, in wei).
- **Fee:** `swarmFeeBps = 30` (0.3%) taken on each member settlement and on the
  dissolve refund; routed to the fee collector.
- **Settlement auth:** `settleSwarmAgent` is `RELAYER_ROLE`-gated → performed by
  the server relayer/admin, not arbitrary agents.
- **swarmId is chain-derived:** `keccak256(CIRCUIT_ID, coordinator, objectiveHash,
  swarmCount)` — read it from the `SwarmFormed` event / tx receipt, then share it
  with members out of band.

## Parameters

| Name | Required | Description |
|------|----------|-------------|
| `action` | yes | `register` \| `form` \| `join` \| `settle-member` \| `dissolve` \| `force-dissolve` \| `status`. |
| `objective_hash` | form | 32-byte hash of the objective spec. |
| `max_members` | form | 1–18. |
| `escrow_wei` | form | TFUEL escrow pool in wei (>0). |
| `swarm_id` | join/settle/dissolve/status | 32-byte swarm id (from `SwarmFormed`). |
| `agent` / `amount_wei` | settle-member | Member address + payout from the pool. |
| `proof` / `public_values` / `nullifier` | settle-member | SP1 proof of contribution + replay guard. |
| `identity_commitment` / `endpoint` / `capabilities` | register | Agent identity, A2A endpoint, capability hashes. |

## Procedure (SDK `xfuel-sdk/onchain`)

```js
import { XFuelOnChain } from 'xfuel-sdk/onchain';
const chain = new XFuelOnChain({
  a2aCircuitAddress: process.env.A2A_CIRCUIT_ADDRESS,
  rpcUrl: process.env.THETA_RPC_URL, // only needed for reads
});
```

1. **register** — coordinator and each member register once:

   ```js
   const call = chain.encodeRegisterAgent(identityCommitment, 'https://agent.example/a2a', [capabilityHash]);
   // → submit `call` via the server relayer or sign it yourself.
   ```

2. **form** — coordinator opens the swarm and funds the escrow pool:

   ```js
   const form = chain.encodeFormSwarm(objectiveHash, 18, '2000000000000000000'); // 2 TFUEL pool
   // After it lands, read the swarmId from the SwarmFormed event and share it.
   ```

3. **join** — each member joins (must be registered + active; swarm not full):

   ```js
   const join = chain.encodeJoinSwarm(swarmId);
   ```

4. **settle-member** — settle each member's payout from the pool with a ZK proof.
   Relayer-gated, so normally submitted server-side:

   ```js
   const settle = chain.encodeSettleSwarmAgent(swarmId, agent, amountWei, proof, publicValues, nullifier);
   ```

5. **status** — read live swarm state at any time:

   ```js
   const s = await chain.getSwarm(swarmId);
   // { phase, memberCount, maxMembers, escrowPool, settledAmount, remainingEscrow, coordinator, ... }
   const joined = await chain.isSwarmMember(swarmId, agent); // boolean
   ```

6. **dissolve** — coordinator (or admin) closes the swarm; remaining escrow
   refunds to the coordinator (minus 0.3%). Any member may `force-dissolve` after
   the timeout:

   ```js
   const end = chain.encodeDissolveSwarm(swarmId);        // coordinator/admin
   const forced = chain.encodeForceDissolveSwarm(swarmId); // any member, post-timeout
   ```

## Two payment surfaces

- **Swarm escrow** (form → settle → dissolve) is **TFUEL-native on-chain** via
  `A2ACircuit`. This is the pool members are paid from.
- The **actual compute** each member performs can be submitted as an M2M task and
  settle in **USDC via x402 (default)** or **TFUEL** — see `xfuel-submit-inference`
  and [`../_shared/reference/payments-x402.md`](../_shared/reference/payments-x402.md).
  Don't conflate the two: agents can be *paid* in TFUEL from the pool while the
  *compute they run* is metered/settled in USDC.

## Runnable example

[`sdk/js/examples/swarm-coordinate.ts`](../../sdk/js/examples/swarm-coordinate.ts)
— `npx tsx examples/swarm-coordinate.ts` walks register → form → join →
settle-member → status → dissolve. Calldata builders run fully offline; on-chain
reads run when `THETA_RPC_URL` + `A2A_CIRCUIT_ADDRESS` are set.

## Failure modes (contract reverts)

- `InvalidSize` — `maxMembers` is 0 or >18.
- `ZeroEscrow` — `formSwarm` with `msg.value == 0`.
- `AgentNotRegistered` — coordinator/member/settle target isn't a registered active agent.
- `SwarmFull` — `joinSwarm` when `memberCount == maxMembers` (form another swarm).
- `AlreadySwarmMember` — duplicate `joinSwarm`.
- `SwarmNotFound` / `SwarmNotActive` — bad `swarmId` or wrong phase for the action.
- `InsufficientEscrow` — `settleSwarmAgent` amount would exceed the pool.
- `NullifierUsed` — settlement nullifier already spent (replay).
- `NotCoordinator` — `dissolveSwarm` caller isn't coordinator/admin.
- `SwarmNotTimedOut` / `NotSwarmMember` — `forceDissolveSwarm` too early or by a non-member.
- `503 service_unavailable` — `A2A_CIRCUIT_ADDRESS` not configured server-side.

## Notes

- Identity commitments, bids, and settlements use ZK nullifiers for replay protection.
- Related: **1:1** delegation/bidding lives in [`xfuel-a2a-bid`](../xfuel-a2a-bid/SKILL.md);
  the verifiable compute itself in [`xfuel-submit-inference`](../xfuel-submit-inference/SKILL.md).
- A2A contract surface: repo root `AGENTS.md` (Agent-to-Agent section);
  env/config: [`../_shared/reference/env-and-endpoints.md`](../_shared/reference/env-and-endpoints.md).
