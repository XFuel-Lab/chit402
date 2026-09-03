# chit402-sidecar

**System of record, not cheapest hop.** The book survives losing the route.

Emit Chit402-shaped receipts from any OpenAI-compatible upstream — OpenRouter, Groq, Together, or your own endpoint. The sidecar stamps receipts on calls you already make.

npm: `chit402-sidecar` · License: Apache-2.0 · Docs: https://chit402.com

## Install

```bash
npm install chit402-sidecar
```

## Quick Start

Wrap any OpenAI-compatible client with one line:

```ts
import OpenAI from 'openai';
import { createSidecarFetch } from 'chit402-sidecar';

const openai = new OpenAI({
  baseURL: 'https://openrouter.ai/api/v1',
  apiKey: process.env.OPENROUTER_API_KEY,
  fetch: createSidecarFetch({
    signingSecret: process.env.CHIT402_SIGNING_SECRET,
    onReceipt: (receipt) => {
      console.log('Chit402 receipt:', receipt.task_id);
      console.log('  Hub:', receipt.route.hub);
      console.log('  Model:', receipt.route.model);
    },
  }),
});

const res = await openai.chat.completions.create({
  model: 'openai/gpt-4-turbo',
  messages: [{ role: 'user', content: 'Hello!' }],
});
```

## Import Usage Exports

Convert OpenRouter/Groq usage exports to Chit402 receipts:

```ts
import { importUsageExport } from 'chit402-sidecar';
import { readFileSync } from 'fs';

const csv = readFileSync('openrouter-activity.csv', 'utf8');
const { receipts, imported } = importUsageExport(csv);

console.log(`Imported ${imported} rows`);
```

## Receipt Schema

Each receipt includes:
- `hub` — who served it (e.g., `openrouter.ai`)
- `model` — what model ran
- `amount` — USDC cost (atomic, 6 decimals)
- `output_hash` — commitment to the response
- `verify_url` — shareable receipt link

## Documentation

- [Chit402 Docs](https://chit402.com)
- [API Reference](https://api.chit402.com)

## License

Apache-2.0
