# xfuel-sdk

> JavaScript / TypeScript SDK for the XFuel Protocol M2M API — submit AI tasks, retrieve ZK proofs, send A2A messages.

[![npm](https://img.shields.io/npm/v/xfuel-sdk?color=blue)](https://www.npmjs.com/package/xfuel-sdk)
[![License](https://img.shields.io/badge/license-MIT-blue.svg)](../../LICENSE)

---

## Installation

```bash
npm install xfuel-sdk
```

## Quick Start

```typescript
import XFuelClient from 'xfuel-sdk';

const client = new XFuelClient({
  baseUrl: 'https://api.xfuel.app',   // or http://localhost:3002 for local dev
  apiKey: process.env.XFUEL_API_KEY,  // optional — for rate-limit bypass
});

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

## API Reference

### `new XFuelClient(options?)`

| Option | Type | Default | Description |
|---|---|---|---|
| `baseUrl` | `string` | `http://localhost:3002` | XFuel API base URL |
| `apiKey` | `string` | — | Optional API key for `X-API-Key` header |
| `maxRetries` | `number` | `3` | Auto-retry on 429 / 5xx |
| `retryBaseMs` | `number` | `1000` | Base delay (ms) for exponential backoff |
| `timeoutMs` | `number` | `30000` | Request timeout (ms) |

### Methods

| Method | Description |
|---|---|
| `submitTask(params)` | Submit any task type |
| `submitInference(modelId, sender, amount, opts?)` | Inference shorthand |
| `getTaskStatus(taskId)` | Poll task status |
| `getProof(taskId)` | Retrieve SP1 ZK proof |
| `waitForCompletion(taskId, opts?)` | Poll until terminal status |
| `sendA2AMessage(params)` | Send agent-to-agent message |
| `getA2AStatus(messageId)` | Get A2A message status |
| `getHealth()` | Check API health |

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

MIT — see [LICENSE](../../LICENSE)
