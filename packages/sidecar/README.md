# XFuel Sidecar

**System of record, not cheapest hop.** The book survives losing the route.

Emit XFuel-shaped receipts from any OpenAI-compatible upstream — OpenRouter, Groq, Together, or your own endpoint. The sidecar does not need to win the route; it stamps the receipt while the call happens.

## Why

If your book only exists when traffic goes through `api.xfuel.app`, any provider that adds a signed invoice eats XFuel. The sidecar ensures every inference call — wherever it routes — produces the same receipt schema:

- `hub` — who served it (e.g., `openrouter.ai`, `api.groq.com`)
- `model` — what model ran
- `amount` — USDC cost (atomic, 6 decimals)
- `output_hash` — commitment to the response
- `payment_ref` — x402 transaction binding (if present)
- `verify_url` — works even if XFuel did not run the model

## Install

```bash
npm install xfuel-sidecar
```

---

## Quick Start: SDK Middleware

Wrap any OpenAI-compatible client. One line change.

```ts
import OpenAI from 'openai';
import { createSidecarFetch } from 'xfuel-sidecar';

const openai = new OpenAI({
  baseURL: 'https://openrouter.ai/api/v1',
  apiKey: process.env.OPENROUTER_API_KEY,
  fetch: createSidecarFetch({
    signingSecret: process.env.XFUEL_SIGNING_SECRET,
    onReceipt: (receipt) => {
      console.log('XFuel receipt:', receipt.task_id);
      console.log('  Hub:', receipt.route.hub);
      console.log('  Model:', receipt.route.model);
      console.log('  Output hash:', receipt.output?.hash);
    },
  }),
});

const res = await openai.chat.completions.create({
  model: 'openai/gpt-4-turbo',
  messages: [{ role: 'user', content: 'Hello!' }],
});

console.log(res.choices[0].message.content);
// Receipt is on res.xfuelReceipt (type assertion needed for TypeScript)
```

### With Groq

```ts
const groq = new OpenAI({
  baseURL: 'https://api.groq.com/openai/v1',
  apiKey: process.env.GROQ_API_KEY,
  fetch: createSidecarFetch({
    onReceipt: (receipt) => saveToMyAuditLog(receipt),
  }),
});
```

### With Together AI

```ts
const together = new OpenAI({
  baseURL: 'https://api.together.xyz/v1',
  apiKey: process.env.TOGETHER_API_KEY,
  fetch: createSidecarFetch(),
});
```

---

## Quick Start: Cloudflare Worker

Deploy an edge proxy in front of any upstream. Your OpenAI client points at the worker.

```bash
cd packages/sidecar/worker
wrangler secret put XFUEL_SIGNING_SECRET
wrangler secret put UPSTREAM_API_KEY
wrangler deploy
```

Edit `wrangler.toml`:

```toml
[vars]
UPSTREAM_BASE_URL = "https://openrouter.ai/api"
```

Then point your client at the worker:

```ts
const openai = new OpenAI({
  baseURL: 'https://xfuel-sidecar.<your-subdomain>.workers.dev/v1',
  apiKey: 'your-key',
});
```

Every response includes:
- `x-xfuel-task-id` header
- `x-xfuel-output-hash` header
- `xfuel` object on the JSON body

---

## Import OpenRouter Usage

Drop an OpenRouter activity export and get XFuel receipts back.

```ts
import { importUsageExport } from 'xfuel-sidecar';
import { readFileSync } from 'fs';

const csv = readFileSync('openrouter-activity.csv', 'utf8');
const { receipts, imported, errors } = importUsageExport(csv);

console.log(`Imported ${imported} rows`);

for (const receipt of receipts) {
  console.log(`${receipt.route.model}: $${Number(receipt.payment.gross_amount) / 1e6}`);
}
```

Supports:
- OpenRouter JSON/CSV exports
- Groq usage exports
- Generic CSV with `model`, `cost`, `prompt_tokens`, `completion_tokens`

---

## Ingest to XFuel Book

After wrapping a call, post the receipt to XFuel's possession-gated book:

```ts
import { ingestToBook, registerAgent } from 'xfuel-sidecar';

// 1. Register an agent (once)
const { agent_id, session } = await registerAgent({
  apiKey: process.env.XFUEL_API_KEY,
});

// 2. On each call with x402 payment, ingest to the book
await ingestToBook(
  {
    payment_required: {
      resource: 'https://openrouter.ai/api/v1/chat/completions',
      amount: '10000',  // USDC atomic
      payTo: '0xOpenRouterTreasury',
    },
    payment_response: {
      tx: '0xabc123...',
      payer: '0xYourWallet',
      network: 'base',
    },
  },
  {
    apiKey: process.env.XFUEL_API_KEY,
    agentId: agent_id,
    session,
  }
);
```

**Note:** Ingest requires a real on-chain USDC transfer. XFuel verifies the payment before adding it to the book. Uncollected (metered-by-provider-key) calls create local receipts but cannot be ingested until payment is verified.

---

## Receipt Schema

```ts
interface SidecarReceipt {
  schema: 'xfuel.receipt.v3';
  task_id: string;        // sidecar-<timestamp>-<random>
  status: 'completed' | 'failed';
  proof_outcome: 'signed';
  sidecar: true;
  created_at: string;

  payment: {
    rail: 'usdc' | 'uncollected';
    ref: string | null;           // base:0x... or null
    gross_amount: string;         // USDC atomic (6 decimals)
    collected: boolean;
    payer?: string;
    payTo?: string;
  };

  route: {
    hub: string;      // e.g., openrouter.ai
    model: string;    // e.g., openai/gpt-4-turbo
    provider: string;
  };

  output: {
    hash: string;     // 0x-prefixed SHA-256
    kind: 'sha256';
  } | null;

  usage: {
    prompt_tokens: number | null;
    completion_tokens: number | null;
    total_tokens: number | null;
  } | null;

  signature?: {
    alg: 'HMAC-SHA256';
    scope: 'sidecar';
    value: string;    // sha256=<hex>
  };
}
```

---

## Verify Signature

```ts
import { verifySidecarSignature } from 'xfuel-sidecar';

const { valid, checked } = verifySidecarSignature(receipt, signingSecret);

if (checked && valid) {
  console.log('Receipt is tamper-evident');
}
```

---

## Payment Binding

When wrapping an x402 call, the sidecar extracts payment info from the `X-PAYMENT` header and binds it to the receipt:

```ts
const sidecarFetch = createSidecarFetch({
  extractPayment: (headers) => {
    const payment = headers.get('x-payment');
    // Parse your payment header format
    return { ref: 'base:0x...', payer: '0x...', amount: '10000' };
  },
});
```

Default extraction parses the standard x402 header format.

---

## Fail Closed on Payment

If a payment is claimed (`X-PAYMENT` header present), the sidecar fails closed on verification:

- If the payment header is present but malformed → receipt marks `collected: false`
- If payment cannot be verified → do not ingest to book (book rejects unverified payments)
- If no payment header → receipt is `rail: 'uncollected'`, marked unofficial

---

## What the Receipt Proves

| Field | Meaning |
|-------|---------|
| `route.hub` / `route.model` | Who served the call and what model |
| `output.hash` | SHA-256 of the response content |
| `payment.ref` | x402 transaction hash (if paid) |
| `signature` | HMAC tamper-evidence (client-signed, not merchant) |

The sidecar receipt is **client-attested**, not merchant-attested. It proves *you recorded this call*. To make it merchant-attested, ingest it to the XFuel book where on-chain verification runs.

---

## Not a Router

The sidecar does not route traffic, optimize costs, or select models. It stamps receipts on calls you already make. Use it alongside your existing OpenRouter/Groq/etc. setup, not instead of it.

---

## API Reference

### `createSidecarFetch(config)`

Create a fetch wrapper that attaches receipts.

```ts
interface SidecarMiddlewareConfig {
  signingSecret?: string;
  xfuelBaseUrl?: string;
  onReceipt?: (receipt, request, response) => void | Promise<void>;
  extractPayment?: (headers) => { ref?, payer?, payTo?, amount? } | null;
  pricing?: Record<string, { promptPrice: number; completionPrice: number }>;
}
```

### `importUsageExport(data, config)`

Import usage data and convert to receipts.

```ts
const { imported, skipped, receipts, errors } = importUsageExport(csvOrJson, {
  source: 'openrouter' | 'groq' | 'generic' | 'auto',
  signingSecret: '...',
});
```

### `buildSidecarReceipt(params)`

Build a receipt manually.

```ts
const receipt = buildSidecarReceipt({
  hub: 'api.openrouter.ai',
  model: 'openai/gpt-4',
  amount: '10000',
  output: 'The response content',
  usage: { prompt_tokens: 100, completion_tokens: 50 },
  paymentRef: 'base:0x...',
  payer: '0x...',
  signingSecret: '...',
});
```

---

## License

Apache-2.0
