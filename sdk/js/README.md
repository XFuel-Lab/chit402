# xfuel-sdk

JavaScript / TypeScript SDK for the **XFuel Protocol M2M API**.

Submit AI tasks, retrieve SP1 ZK settlement proofs, send agent-to-agent (A2A) messages, and poll task status — all from a single client.

## Install

```bash
npm install xfuel-sdk
```

## Quick Start

```typescript
import { XFuelClient, ChainId } from 'xfuel-sdk';

const xfuel = new XFuelClient({
  baseUrl: 'https://api.xfuel.ai',   // or http://localhost:3002
  apiKey:  'your-api-key',
});
```

## Examples

### 1. Submit a Llama Inference Request

```typescript
import { XFuelClient } from 'xfuel-sdk';

const xfuel = new XFuelClient({ apiKey: process.env.XFUEL_API_KEY });

// Convenience method — sets message_type to "inference_request"
const task = await xfuel.submitInference(
  'llama-3-70b',                     // model ID
  '0xYourAgentAddress',              // sender
  '1000000',                         // amount (gross value)
  {
    chain_id:   'akash',             // route to Akash GPU
    input_hash: '0xabcdef1234...',   // SHA-256 of your prompt
  },
);

console.log('Task accepted:', task.task_id);
console.log('Fee:', task.fee_amount, `(${task.fee_bps} BPS)`);

// Poll until settled
const result = await xfuel.waitForCompletion(task.task_id, {
  intervalMs: 3000,
  onPoll: (s, attempt) => console.log(`  poll #${attempt}: ${s.status}`),
});

console.log('Final status:', result.status);
console.log('Proof outcome:', result.proof_outcome);
```

### 2. Send an A2A Cross-Chain Message with Escrow

```typescript
import { XFuelClient, MessageType } from 'xfuel-sdk';

const xfuel = new XFuelClient({ apiKey: process.env.XFUEL_API_KEY });

const msg = await xfuel.sendA2AMessage({
  message_type:    MessageType.COMPUTE_BID,
  sender_chain:    'theta',
  recipient_chain: 'akash',
  payload_hash:    '0xdeadbeef1234567890abcdef',
  escrow_amount:   '250000',
  ttl:             3600,
  sender_address:  '0xYourAgentAddress',
  sender_identity: '0xPoseidonCommitmentHash',
  ibc_channel:     'channel-42',
});

console.log('A2A message ID:', msg.message_id);
console.log('Relay fee:', msg.relay_fee);

// Check A2A verification status
const status = await xfuel.getA2AStatus(msg.message_id);
console.log('Verified:', status.proof_outcome);
```

### 3. Poll a Task and Retrieve its ZK Proof

```typescript
import { XFuelClient, MessageType, ChainId } from 'xfuel-sdk';

const xfuel = new XFuelClient({ apiKey: process.env.XFUEL_API_KEY });

// Submit a full task request with all params
const task = await xfuel.submitTask({
  message_type: MessageType.COMPUTE_BID,
  chain_id:     ChainId.BITTENSOR,
  amount:       '500000',
  sender:       '0xYourAgentAddress',
  subnet_id:    1,
});

// Wait for completion (auto-retries on 429)
const settled = await xfuel.waitForCompletion(task.task_id);

if (settled.proof_outcome === 'valid') {
  const proof = await xfuel.getProof(task.task_id);

  console.log('SP1 proof:', proof.sp1_proof?.nullifier);
  console.log('Revenue split:', proof.fee.revenue_split);
}
```

## API Reference

### `new XFuelClient(options?)`

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `baseUrl` | `string` | `http://localhost:3002` | M2M API server URL |
| `apiKey` | `string` | — | API key sent via `X-API-Key` header |
| `maxRetries` | `number` | `3` | Auto-retries on 429 / 5xx |
| `retryBaseMs` | `number` | `1000` | Base delay before first retry |
| `timeoutMs` | `number` | `30000` | Request timeout |

### Methods

| Method | Endpoint | Returns |
|--------|----------|---------|
| `submitTask(params)` | `POST /task-request` | `TaskRequestResponse` |
| `submitInference(modelId, sender, amount, opts?)` | `POST /task-request` | `TaskRequestResponse` |
| `getTaskStatus(taskId)` | `GET /task-status` | `TaskStatusResponse` |
| `getProof(taskId)` | `GET /prove-result` | `ProofResponse` |
| `sendA2AMessage(params)` | `POST /a2a-message` | `A2AMessageResponse` |
| `getA2AStatus(messageId)` | `GET /task-status` | `A2AStatusResponse` |
| `getHealth()` | `GET /health` | `HealthResponse` |
| `waitForCompletion(taskId, opts?)` | Polls `/task-status` | `TaskStatusResponse` |

### Error Handling

All API errors throw `XFuelApiError` with structured fields:

```typescript
import { XFuelApiError } from 'xfuel-sdk';

try {
  await xfuel.submitTask({ /* ... */ });
} catch (err) {
  if (err instanceof XFuelApiError) {
    console.error(err.status);   // HTTP status (400, 401, 429, etc.)
    console.error(err.code);     // "validation_error", "unauthorized", etc.
    console.error(err.details);  // field-level validation errors (if any)
  }
}
```

429 responses are automatically retried with exponential backoff (respects `Retry-After` header).

## Build from Source

```bash
cd sdk/js
npm install
npm run build    # outputs to dist/
```

## Publish

```bash
npm login
npm publish --access public
```

## License

MIT
