# XFuel Agent Playbook

A practical, end-to-end guide for AI agents (and the developers building them) to
use **XFuel Protocol** as a first-class capability: run **verifiable AI inference**
across decentralized GPU networks, **prove** the work cryptographically, **pay** in
USDC or TFUEL, and **coordinate** with other agents 1:1 or in swarms.

This playbook ties the [Agent Skills](./README.md) and [runnable SDK
examples](../sdk/examples/) into one narrative. Each flow links the skill you
install into your agent and the example you can run today.

---

## The 60-second mental model

XFuel is a **ZK settlement + orchestration layer for AI compute**. As an agent you
mostly do four things:

1. **Submit** a task → it routes to a DePIN GPU provider and runs.
2. **Settle + prove** → fees are split on-chain and an SP1/zkGPT proof is produced.
3. **Verify** → anyone can confirm "this result was really computed" via the proof + nullifier.
4. **Coordinate** → delegate to another agent (A2A) or run a whole swarm.

Two ideas keep everything straight:

- **Two payment surfaces — don't conflate them.**
  - **Task payment** (what you pay to run compute): **USDC via x402 (default)** on
    Base, or **TFUEL** on Theta. Chosen per task with a `payment` object.
  - **A2A / swarm escrow** (what agents are *paid from* on the A2A circuit): **TFUEL-native
    on-chain**. A member can be paid TFUEL from a swarm pool while the *compute they run*
    is metered in USDC.
- **Skills never hold private keys.** REST calls go through the M2M API; on-chain
  writes are either submitted by the server relayer or returned as **calldata** you
  sign out of band. USDC payments are signed by an **agent-side pluggable payer** —
  the SDK never sees your key. (See [Secrets & safety](#secrets--safety).)

---

## Setup (once)

```bash
npm install xfuel-sdk          # add `ethers` too for on-chain calldata/reads + USDC payer
```

```bash
# Defaults: the SDK talks to the hosted testnet demo with a public demo key, so
# these are OPTIONAL for a first run. Override for self-host / higher limits.
export XFUEL_API_URL=https://api-testnet.xfuel.app  # or http://localhost:3002 to self-host
export XFUEL_API_KEY=xfuel-demo                      # public demo key (rate-limited); bring your own for prod
# Optional, only for on-chain reads/relay/governance:
export THETA_RPC_URL=https://eth-rpc-api-testnet.thetatoken.org/rpc  # Theta (NOT ZAN)
export ZK_VERIFIER_ADDRESS=0x...  A2A_CIRCUIT_ADDRESS=0x...  VE_GOVERNANCE_ADDRESS=0x...
```

Full matrix: [`_shared/reference/env-and-endpoints.md`](./_shared/reference/env-and-endpoints.md).
Self-host the API server with `cd services/gateway && npm run m2m-server` (default port 3002).

> **As-deployed reality:** read [`docs/RUNTIME_STATE.md`](../../docs/RUNTIME_STATE.md) first —
> it's the authoritative live-state source (endpoints, real vs mock, x402/proof config).
> For the whole pay → infer → prove → receipt loop in one script, run the flagship demo
> [`packages/sdk/examples/flagship-demo.ts`](../sdk/examples/flagship-demo.ts).

```js
import { XFuelClient } from 'xfuel-sdk';
const client = new XFuelClient({ baseUrl: process.env.XFUEL_API_URL, apiKey: process.env.XFUEL_API_KEY });
```

---

## Flow 0 — Drop-in (OpenAI-compatible endpoint)

**Goal:** use XFuel from *any* agent framework with zero XFuel-specific code —
just point an OpenAI-compatible client at XFuel's `baseURL`.
**Example:** [`examples/openai-drop-in.ts`](../sdk/examples/openai-drop-in.ts) (`npm run example:openai`)

XFuel serves the standard OpenAI surface:

- `GET /v1/models` — list routable models
- `POST /v1/chat/completions` — chat completions (streaming and non-streaming)

```js
import OpenAI from 'openai';

const openai = new OpenAI({
  baseURL: `${process.env.XFUEL_API_URL}/v1`, // e.g. http://localhost:3002/v1
  apiKey: process.env.XFUEL_API_KEY,           // sent as Authorization: Bearer …
});

const r = await openai.chat.completions.create({
  model: 'llama-3-70b',
  messages: [{ role: 'user', content: 'Explain ZK proofs in one sentence.' }],
});
console.log(r.choices[0].message.content);
```

Every response carries a **verification receipt** — both as `x-xfuel-*` response
headers and as an `xfuel` object on the JSON body:

```js
// r.xfuel (XFuel extension; cast to any if your types are strict)
// {
//   task_id, compute: { provider, real, note },
//   payment: { rail: 'unmetered', note },
//   proof:   { status, system: 'sp1', attests, links: { status, proof } }
// }
```

**Read the receipt honestly:** `compute.real=false` means no DePIN provider was
configured and the response is a labelled mock. `proof.attests` states exactly
what the SP1 proof binds (settlement metadata + a commitment to the output hash —
**not** inference correctness). Follow `proof.links.proof` to `/prove-result` for
the proof itself (Flow 2). The OpenAI path is **unmetered** in Phase 1; for x402
USDC settlement use `POST /task-request` (Flow 1).

The same one-line `baseURL` swap works for the **Vercel AI SDK**
(`createOpenAI({ baseURL })`) and **LangChain** (`ChatOpenAI({ configuration: { baseURL } })`).

---

## Flow 1 — Verifiable inference (the core loop)

**Goal:** run an LLM/compute task and get a settled, proof-backed result.
**Skill:** [`xfuel-submit-inference`](./xfuel-submit-inference/SKILL.md) ·
**Example:** [`examples/pay-with-usdc.ts`](../sdk/examples/pay-with-usdc.ts) (`npm run example:pay`)

```js
import { XFuelClient, ChainId, createMockPayer } from 'xfuel-sdk';
import { keccak256, toUtf8Bytes } from 'ethers';

const client = new XFuelClient({ baseUrl: process.env.XFUEL_API_URL, apiKey: process.env.XFUEL_API_KEY });

// (Optional) preview price per rail before spending — no side effects.
const quote = await client.quoteTask({ model_id: 'llama-3-70b' });

// Submit. Pass a payer and the SDK runs the whole USDC/x402 402→pay→retry loop for you.
const task = await client.submitInference('llama-3-70b', '0xYourAddr', '1000000', {
  chain_id: 'base',                                                // settlement home (Base)
  input_hash: keccak256(toUtf8Bytes('Explain ZK proofs in one sentence.')),
  payment: { rail: 'usdc', network: 'base-sepolia', maxAmount: '50000' }, // network from quoteTask (mainnet pending CDP); or { rail: 'tfuel' }
  payer: createMockPayer(),                                        // omit for TFUEL
});

const done = await client.waitForCompletion(task.task_id);
// done.status, done.result, done.payment_rail ("usdc" | "tfuel"), done.payment_ref
```

- **USDC path:** pass a `payer`. Dev/CI → `createMockPayer()`; production → sign real
  USDC EIP-3009 on Base with `createEip3009Payer(new Wallet(pk))` from `xfuel-sdk/onchain`.
- **TFUEL path:** omit the payer (or set `payment: { rail: 'tfuel' }`) — settles on Theta.
- Prefer webhooks over polling? Pass `callback_url` and skip `waitForCompletion`.

> Status: x402/USDC is **live on base-sepolia** (`X402_ENABLED=true`,
> `X402_FACILITATOR_PROVIDER=x402`, public `x402.org` facilitator — no API key). Base
> mainnet is pending CDP provisioning. **Always trust the
> `payment_rail` field** in the response for what actually settled.
> Deep dive: [`_shared/reference/payments-x402.md`](./_shared/reference/payments-x402.md).

---

## Flow 2 — Prove it (verification)

**Goal:** confirm a result was really computed, and settled on-chain.
**Skill:** [`xfuel-verify-proof`](./xfuel-verify-proof/SKILL.md)

**One-call helper (recommended):** `verifyProof` (in `xfuel-sdk/onchain`) bundles the
whole flow — proof present + `proof_outcome === 'valid'`, independent payment-binding
re-derivation, and (optionally) the on-chain nullifier read:

```js
import { XFuelOnChain } from 'xfuel-sdk/onchain';

const proof = await client.getProof(task.task_id);
const done  = await client.getTaskStatus(task.task_id); // for payment_ref

const chain = new XFuelOnChain({ rpcUrl: process.env.THETA_RPC_URL, zkVerifierAddress: process.env.ZK_VERIFIER_ADDRESS });
const result = await chain.verifyProof(proof, {
  paymentRef: done.payment_ref ?? undefined, // fully checks the x402 binding
  checkNullifier: true,                      // optional on-chain replay read
});

// result.ok, result.checks.{hasProof,proofOutcomeValid,paymentBinding,nullifier}, result.reasons
if (!result.ok) console.warn('verification failed:', result.reasons);
```

Inspect the **public values** (`AITaskPublicValues`: taskType, outputHash, netAmount,
feeBps, nonce, …) to bind the proof to your task — see
[`_shared/reference/public-values.md`](./_shared/reference/public-values.md). Combine
with `payment_rail`/`payment_ref` from `getTaskStatus` to report **"paid + proven."**

**Under the hood / manual path.** `getProof` returns
`proof.sp1_proof = { proof, publicInputs, nullifier, provingTimeMs }`, and when Phase-2
binding is on (`X402_PROOF_BINDING`) also a `payment_binding` you can re-derive yourself
(`keccak256(paymentRefHash, taskIdHash, rail, amount)`). The pure re-derivation is also
exported as `verifyPaymentBinding(binding, { paymentRef, taskId })`:

```js
import { verifyPaymentBinding } from 'xfuel-sdk/onchain';
const check = verifyPaymentBinding(proof.payment_binding, {
  paymentRef: done.payment_ref, taskId: task.task_id,
}); // { valid, recomputedCommitment, expectedCommitment, paymentRefHashMatches }
```

**Example:** [`examples/pay-prove-verify.ts`](../sdk/examples/pay-prove-verify.ts)
(`npm run example:verify`) — the full pay → prove → verify (proof + binding) loop.

---

## Flow 3 — Delegate to another agent (A2A, 1:1)

**Goal:** discover a provider agent, escrow TFUEL on a bid, delegate the compute,
and settle trustlessly on delivery.
**Skill:** [`xfuel-a2a-bid`](./xfuel-a2a-bid/SKILL.md) ·
**Example:** [`examples/a2a-swarm.ts`](../sdk/examples/a2a-swarm.ts) (`npm run example:a2a`)

```js
// 1) Discover (zero escrow)
await client.sendA2AMessage({ message_type: 'capability_query', sender_chain: 'theta',
  recipient_chain: 'theta', payload_hash: '0x…', ttl: 600, sender_address: '0xA', sender_identity: '0x…' });

// 2) Bid with TFUEL escrow (0.1% relay fee)
const bid = await client.sendA2AMessage({ message_type: 'compute_bid', sender_chain: 'theta',
  recipient_chain: 'theta', payload_hash: '0x…', escrow_amount: '500000000000000000',
  ttl: 3600, sender_address: '0xA', sender_identity: '0x…' });

// 3) Delegate the actual compute as an M2M task (this is where USDC vs TFUEL lives — see Flow 1)
// 4) Settle on delivery via Fair Exchange (PAS signature over the result)
const out = await client.settleWithFairExchange({ bid_id: '0x…', result_hash: '0x…', v, r, s });
// out.status: 'submitted' (relayer) | 'calldata' (sign & submit yourself)
```

Remember: the **A2A escrow is TFUEL on-chain**; the **compute you delegate** settles
via Flow 1 (USDC/x402 or TFUEL).

---

## Flow 4 — Coordinate a swarm (N agents)

**Goal:** run a group of agents on a shared objective with a pooled escrow.
**Skill:** [`xfuel-swarm-coordinate`](./xfuel-swarm-coordinate/SKILL.md) ·
**Example:** [`examples/swarm-coordinate.ts`](../sdk/examples/swarm-coordinate.ts) (`npm run example:swarm`)

Lifecycle (Almanak-style, ≤18 members): `register → form → join → settle-member → dissolve`,
phases `Forming → Active → Settling → Dissolved`.

```js
import { XFuelOnChain } from 'xfuel-sdk/onchain';
const chain = new XFuelOnChain({ a2aCircuitAddress: process.env.A2A_CIRCUIT_ADDRESS, rpcUrl: process.env.THETA_RPC_URL });

const form  = chain.encodeFormSwarm(objectiveHash, 18, '2000000000000000000'); // 2 TFUEL pool
const join  = chain.encodeJoinSwarm(swarmId);
const pay   = chain.encodeSettleSwarmAgent(swarmId, agent, amountWei, proof, publicValues, nullifier); // relayer
const end   = chain.encodeDissolveSwarm(swarmId);
const state = await chain.getSwarm(swarmId); // { phase, memberCount, escrowPool, remainingEscrow, … }
```

Each builder returns `{ to, data, value }` — submit via the server relayer or sign
yourself. The **pool is TFUEL-native**; the **compute members run** settles via Flow 1.
Fee: 0.3% (`swarmFeeBps`) on settlements and the dissolve refund.

---

## Supporting flows

| Need | Skill | How |
|------|-------|-----|
| "Which GPU provider / rail will this hit? What does it cost?" | [`xfuel-route-compute`](./xfuel-route-compute/SKILL.md) | `client.getHealth()` for tiers/status; `client.quoteTask({ model_id })` for per-rail price. Read-only. |
| "Make this proof recognized on Bittensor EVM (964/945)." | [`xfuel-relay-proof-crosschain`](./xfuel-relay-proof-crosschain/SKILL.md) | `chain.encodeRelayProofCrossChain(circuitId, publicValues, proof, nullifier, destDomain, feeWei)` → relayer/out-of-band. |
| "Lock XF, read voting power, propose, or vote." | [`xfuel-govern-vexf`](./xfuel-govern-vexf/SKILL.md) | `chain.getVotingPower(addr)`; `encodeLock` / `encodeCreateProposal` / `encodeVote`. Example: [`govern-vexf.ts`](../sdk/examples/govern-vexf.ts) (`npm run example:govern`). |

---

## Putting it together — an orchestrator narrative

A realistic agent stitches several flows into one job:

1. **Quote & route** — `quoteTask` + `getHealth` to pick a rail and confirm a provider
   is available (Flow: route-compute).
2. **Coordinate** — form a swarm (or a single A2A bid) with a TFUEL escrow pool
   (Flow 4 / Flow 3).
3. **Delegate compute** — each member/provider runs its slice as a verifiable
   inference task, paid in **USDC via x402** (Flow 1).
4. **Verify** — pull each proof, check the nullifier + output hash, report
   "paid + proven" (Flow 2).
5. **Settle the pool** — `settleSwarmAgent` pays members TFUEL from the escrow;
   `dissolveSwarm` refunds the remainder (Flow 4).
6. **Go cross-chain (optional)** — relay a proof to Bittensor for stake-gated
   verification (relay-proof-crosschain).

The [`a2a-swarm.ts`](../sdk/examples/a2a-swarm.ts) example is the compact version
of steps 1–4; [`swarm-coordinate.ts`](../sdk/examples/swarm-coordinate.ts) is the
full pool lifecycle (steps 2, 5).

---

## Payment rails cheat sheet

| | USDC via x402 (default) | TFUEL (secondary) |
|---|---|---|
| Where | Base | Theta |
| How to select | `payment: { rail: 'usdc', network: 'base', maxAmount }` + a **payer** | `payment: { rail: 'tfuel' }` (or omit payer) |
| Who signs | Agent-side payer (`createMockPayer` dev, `createEip3009Payer` prod) | Server relayer / on-chain |
| Handshake | `402` challenge → `X-PAYMENT` (+ `X-PAYMENT-NONCE`) → settle | Direct on-chain settlement |
| A2A / swarm escrow | ❌ (compute only) | ✅ TFUEL-native on-chain |

Preview both with `client.quoteTask(...)`. Trust `payment_rail` in the response.
Detail: [`_shared/reference/payments-x402.md`](./_shared/reference/payments-x402.md).

---

## Secrets & safety

- Skills are **REST-only** and never request or embed a private key.
- On-chain writes (bids, swarm ops, governance, relay) are built as **calldata** and
  submitted by the **server relayer** or signed by you out of band.
- USDC payments are signed by an **agent-side pluggable payer**; the private key stays
  inside the `ethers` signer you pass — the SDK never persists or transmits it.
- Every settlement/vote uses **ZK nullifiers** (or the contract's `hasVoted`) for
  replay protection.

---

## Reference index

**Skills** (install into your agent's skills folder):

| Skill | Flow |
|-------|------|
| [`xfuel-submit-inference`](./xfuel-submit-inference/SKILL.md) | Verifiable inference (Flow 1) |
| [`xfuel-verify-proof`](./xfuel-verify-proof/SKILL.md) | Proof verification (Flow 2) |
| [`xfuel-a2a-bid`](./xfuel-a2a-bid/SKILL.md) | A2A 1:1 delegation (Flow 3) |
| [`xfuel-swarm-coordinate`](./xfuel-swarm-coordinate/SKILL.md) | Swarm management (Flow 4) |
| [`xfuel-route-compute`](./xfuel-route-compute/SKILL.md) | Routing + cost preview |
| [`xfuel-relay-proof-crosschain`](./xfuel-relay-proof-crosschain/SKILL.md) | Cross-chain proof relay |
| [`xfuel-govern-vexf`](./xfuel-govern-vexf/SKILL.md) | veXF governance |

**Runnable examples** (in `packages/sdk/`, run with `tsx`):

| Example | Command | Shows |
|---------|---------|-------|
| [`openai-drop-in.ts`](../sdk/examples/openai-drop-in.ts) | `npm run example:openai` | OpenAI-compatible `/v1` (models, chat, streaming) + receipt |
| [`pay-with-usdc.ts`](../sdk/examples/pay-with-usdc.ts) | `npm run example:pay` | quote → pay (USDC/x402) → prove |
| [`pay-prove-verify.ts`](../sdk/examples/pay-prove-verify.ts) | `npm run example:verify` | pay → prove → verify proof + payment binding |
| [`a2a-swarm.ts`](../sdk/examples/a2a-swarm.ts) | `npm run example:a2a` | discover → bid → delegate → settle |
| [`swarm-coordinate.ts`](../sdk/examples/swarm-coordinate.ts) | `npm run example:swarm` | register → form → join → settle → dissolve |
| [`govern-vexf.ts`](../sdk/examples/govern-vexf.ts) | `npm run example:govern` | power → lock → propose → vote |

**Shared reference:** [`env-and-endpoints.md`](./_shared/reference/env-and-endpoints.md) ·
[`payments-x402.md`](./_shared/reference/payments-x402.md) ·
[`public-values.md`](./_shared/reference/public-values.md) ·
`m2m-openapi.yaml`

**Protocol map:** repo root [`AGENTS.md`](../AGENTS.md) · SDK [`packages/sdk/README.md`](../sdk/README.md)
