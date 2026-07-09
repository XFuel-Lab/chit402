# xfuel-sdk

> JavaScript / TypeScript SDK for the XFuel Protocol M2M API — submit AI tasks, retrieve ZK proofs, send A2A messages.

[![npm](https://img.shields.io/npm/v/xfuel-sdk?color=blue)](https://www.npmjs.com/package/xfuel-sdk)
[![License](https://img.shields.io/badge/license-Apache--2.0-blue.svg)](./LICENSE)

---

## Installation

```bash
npm install xfuel-sdk
```

> **Runnable quickstart:** [`examples/quickstart.ts`](./examples/quickstart.ts)
> (`npm run example:quickstart`) — the full submit → settle → prove → verify loop in
> ~20 lines against the hosted testnet demo (zero config).

## Quick Start

```typescript
import XFuelClient from 'xfuel-sdk';

// Zero-config: talks to the hosted testnet demo (https://api-testnet.xfuel.app)
// with a shared, rate-limited public demo key. Great for a first run.
const client = new XFuelClient();

// Production / local dev: bring your own endpoint + key.
// const client = new XFuelClient({
//   baseUrl: 'https://api.xfuel.app',  // or http://localhost:3002 for local dev
//   apiKey: process.env.XFUEL_API_KEY, // higher limits than the public demo key
// });

// Submit an AI inference task
const task = await client.submitInference(
  'meta-llama/Llama-3.2-3B-Instruct',
  '0xYourWalletAddress',
  '1000000000000000000',    // 1 TFUEL in wei
  { chain_id: 'theta' }
);

console.log('Task ID:', task.task_id);

// Poll until complete (auto-retries, 5s interval, 60 attempts max)
const result = await client.waitForCompletion(task.task_id, {
  onPoll: (status, attempt) => console.log(`Attempt ${attempt}: ${status.status}`),
});

// Retrieve the ZK proof
if (result.status === 'completed') {
  const proof = await client.getProof(task.task_id);
  console.log('Nullifier:', proof.sp1_proof?.nullifier);
  console.log('Revenue split:', proof.fee.revenue_split);
}
```

## Paying in USDC via x402 (default rail)

XFuel's default payment rail is **USDC via x402**. Pass a `payer` and the SDK runs
the full `402 → pay → retry` handshake in one call. The payer is agent-side — the
SDK never holds your private keys.

```typescript
import XFuelClient, { createMockPayer, createSignerPayer } from 'xfuel-sdk';

const client = new XFuelClient({ baseUrl, apiKey });

// Dev/CI: works against the mock facilitator (does NOT move real funds)
const task = await client.submitInference('llama-3-70b', '0xYourAddr', '1000000', {
  chain_id: 'theta',
  payment: { rail: 'usdc', network: 'base', maxAmount: '50000' },
  payer: createMockPayer(),
});
console.log(task.payment_rail, task.payment_ref); // "usdc", "base:0x…"

// Production: sign USDC EIP-3009 `transferWithAuthorization` on Base with your wallet.
// `createEip3009Payer` lives in the /onchain entry (needs the `ethers` peer dep);
// your private key stays inside the signer — the SDK never sees it.
import { Wallet } from 'ethers';
import { createEip3009Payer } from 'xfuel-sdk/onchain';

const payer = createEip3009Payer(new Wallet(process.env.XFUEL_PAYER_PK));
await client.submitTaskWithPayment({ /* task params */, payment: { rail: 'usdc' } }, payer);
```

Omit `payer` (or use `payment: { rail: 'tfuel' }`) to settle in TFUEL on Theta. If
the server settles without issuing a 402 (x402 flag off, or TFUEL fallback), the
payer is never called. Preview pricing first with `client.quoteTask({ model_id })`.

> **Runnable examples:** [`examples/pay-with-usdc.ts`](./examples/pay-with-usdc.ts) —
> a full quote → pay → prove loop (`npx tsx examples/pay-with-usdc.ts`; uses the mock
> payer by default, set `XFUEL_PAYER_PK` to sign real USDC on Base). And
> [`examples/pay-prove-verify.ts`](./examples/pay-prove-verify.ts)
> (`npm run example:verify`) — extends it with proof retrieval and an independent
> re-derivation of the Phase-2 `payment_binding` commitment (verify proof + payment).

## Agent-to-Agent (A2A) Messaging

```typescript
// Send a cross-chain A2A message (e.g., Theta → Bittensor)
const msg = await client.sendA2AMessage({
  message_type: 'compute_bid',
  sender_chain: 'theta',
  recipient_chain: 'bittensor',
  payload_hash: '0xabc...',
  escrow_amount: '500000000000000000',  // 0.5 TFUEL escrow
  ttl: 3600,
  sender_address: '0xYourAddress',
  sender_identity: 'agent-v1',
});

const status = await client.getA2AStatus(msg.message_id);
```

## Swarm coordination (on-chain)

Form and manage multi-agent swarms (Almanak-style, up to 18 members) with the
on-chain module. It builds calldata + reads on-chain state — it never holds a key.

```typescript
import { XFuelOnChain } from 'xfuel-sdk/onchain'; // needs the `ethers` peer dep

const chain = new XFuelOnChain({
  a2aCircuitAddress: process.env.A2A_CIRCUIT_ADDRESS,
  rpcUrl: process.env.THETA_RPC_URL, // for reads
});

// Lifecycle calldata ({ to, data, value }) — submit via relayer or sign yourself.
const form = chain.encodeFormSwarm(objectiveHash, 18, '2000000000000000000'); // 2 TFUEL pool
const join = chain.encodeJoinSwarm(swarmId);
const settle = chain.encodeSettleSwarmAgent(swarmId, agent, amountWei, proof, publicValues, nullifier);
const end = chain.encodeDissolveSwarm(swarmId);

// Read live state
const s = await chain.getSwarm(swarmId); // { phase, memberCount, escrowPool, remainingEscrow, ... }
const joined = await chain.isSwarmMember(swarmId, agent);
```

Builders: `encodeRegisterAgent`, `encodeSubmitBid`, `encodeAcceptBid`,
`encodeSettleBid`, `encodeSettleBidFairExchange`, `encodeFormSwarm`,
`encodeJoinSwarm`, `encodeSettleSwarmAgent`, `encodeDissolveSwarm`,
`encodeForceDissolveSwarm`. Reads: `getSwarm`, `isSwarmMember`, `isNullifierUsed`,
`getVotingPower`. Verification: `verifyProof`, `verifyPaymentBinding`.

> **Runnable examples:** [`examples/a2a-swarm.ts`](./examples/a2a-swarm.ts)
> (discover → bid → delegate → settle) and
> [`examples/swarm-coordinate.ts`](./examples/swarm-coordinate.ts)
> (register → form → join → settle members → dissolve). Both run offline for
> calldata; `npx tsx examples/swarm-coordinate.ts`.

## Verify a proof (on-chain)

`verifyProof` bundles the whole "prove it" flow into one call: it confirms a proof
is present and `proof_outcome === 'valid'`, independently re-derives the x402
payment-binding commitment (never trusting the server's echo), and — when a provider
and zkVerifier address are configured — reads the on-chain nullifier state.

```typescript
import { XFuelOnChain } from 'xfuel-sdk/onchain';

const proof = await client.getProof(taskId);
const done  = await client.getTaskStatus(taskId); // for payment_ref

const chain = new XFuelOnChain({ rpcUrl: process.env.THETA_RPC_URL, zkVerifierAddress: process.env.ZK_VERIFIER_ADDRESS });
const result = await chain.verifyProof(proof, {
  paymentRef: done.payment_ref ?? undefined, // fully checks the x402 binding
  checkNullifier: true,                      // optional on-chain replay read
});

if (!result.ok) console.warn('verification failed:', result.reasons);
// result.checks.{ hasProof, proofOutcomeValid, paymentBinding, nullifier }
```

The pure re-derivation is also exported as
`verifyPaymentBinding(binding, { paymentRef, taskId })`. See
[`examples/pay-prove-verify.ts`](./examples/pay-prove-verify.ts) (`npm run example:verify`).

## API Reference

### `new XFuelClient(options?)`

| Option | Type | Default | Description |
|---|---|---|---|
| `baseUrl` | `string` | `https://api-testnet.xfuel.app` | XFuel API base URL (hosted testnet demo) |
| `apiKey` | `string` | `xfuel-demo` | API key for `X-API-Key`. Defaults to the shared, rate-limited public demo key |
| `maxRetries` | `number` | `3` | Auto-retry on 429 / 5xx |
| `retryBaseMs` | `number` | `1000` | Base delay (ms) for exponential backoff |
| `timeoutMs` | `number` | `30000` | Request timeout (ms) |

### Methods

| Method | Description |
|---|---|
| `submitTask(params)` | Submit any task type |
| `submitTaskWithPayment(params, payer)` | Submit + run the USDC/x402 402→pay→retry handshake |
| `submitInference(modelId, sender, amount, opts?)` | Inference shorthand (accepts `payment` + `payer`) |
| `quoteTask(params?)` | Preview per-rail pricing (USDC / TFUEL) — no side effects |
| `getTaskStatus(taskId)` | Poll task status |
| `getProof(taskId)` | Retrieve SP1 ZK proof |
| `waitForCompletion(taskId, opts?)` | Poll until terminal status |
| `sendA2AMessage(params)` | Send agent-to-agent message |
| `getA2AStatus(messageId)` | Get A2A message status |
| `getHealth()` | Check API health |

### Payment helpers (USDC via x402)

| Export | Import from | Description |
|---|---|---|
| `createMockPayer(opts?)` | `xfuel-sdk` | Dev/CI payer — works against the mock facilitator; **does not move real funds** |
| `createSignerPayer(signFn)` | `xfuel-sdk` | Generic production payer — you provide the signed authorization; the SDK never holds keys |
| `createEip3009Payer(signer, opts?)` | `xfuel-sdk/onchain` | USDC EIP-3009 `transferWithAuthorization` payer for Base (needs `ethers`) |
| `selectAccept(challenge)` | `xfuel-sdk` | Pick the `exact`-scheme entry from a 402 challenge |

### Error Handling

```typescript
import { XFuelApiError } from 'xfuel-sdk';

try {
  await client.getProof('invalid-task-id');
} catch (err) {
  if (err instanceof XFuelApiError) {
    console.error(err.status, err.code, err.message);
    // e.g. 404, 'task_not_found', 'Task not found'
  }
}
```

## Supported Chains

| `chain_id` | Network |
|---|---|
| `theta` | Theta Mainnet / Testnet (chain 361 / 365) |
| `bittensor` | Bittensor EVM (chain 964 / 945) |
| `akash` | Akash Network (Cosmos) |
| `osmosis` | Osmosis (IBC) |
| `persistence` | Persistence (IBC) |

## License

Apache-2.0 — see [LICENSE](./LICENSE)
