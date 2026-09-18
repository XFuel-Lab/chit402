# @xfuel/adapters

Thin first-party helpers for routing **LangChain** and **Vercel AI SDK** through Chit402 — swap `baseURL`, pay USDC on Base, hold `verify_url`.

Public alias: `chit402-adapters`.

## Install

```bash
npm install @xfuel/adapters @langchain/openai
# or
npm install chit402-adapters @ai-sdk/openai ai
```

Peer dependencies (install the one you use):

- `@langchain/openai` — LangChain chat models
- `@ai-sdk/openai` — Vercel AI SDK provider

## LangChain

```ts
import { createChitChatOpenAI } from '@xfuel/adapters/langchain';
import { extractReceipt } from '@xfuel/adapters/receipt';

const llm = await createChitChatOpenAI({
  apiKey: process.env.CHIT_API_KEY, // partner key or omit for x402-paid /v1
  model: 'xfuel/auto',
});

const res = await llm.invoke('Say hello in five words.');
const raw = (res as { response_metadata?: { body?: unknown } }).response_metadata?.body;
const receipt = extractReceipt(raw as Record<string, unknown>, 'https://api.chit402.com');
console.log(receipt.verify_url);
```

Env: `CHIT_API_URL`, `CHIT_API_KEY` (aliases `CHIT402_*`, `XFUEL_*`).

## Vercel AI SDK

```ts
import { generateText } from 'ai';
import { createChit } from '@xfuel/adapters/ai-sdk';
import { extractReceipt } from '@xfuel/adapters/receipt';

const chit = await createChit();
const { text, response } = await generateText({
  model: chit('xfuel/auto'),
  prompt: 'Say hello in five words.',
});

const receipt = extractReceipt(
  (await response.json()) as Record<string, unknown>,
  'https://api.chit402.com',
  response.headers,
);
console.log(text, receipt.verify_url);
```

## Receipt extraction

Works on chat-completions JSON (`xfuel` extension), top-level fields, or `x-xfuel-*` headers:

```ts
import { extractReceipt, verifyUrlOf } from '@xfuel/adapters/receipt';
```

## Foreign x402 ingest (ACP / multi-hop)

When inference stays on another shop but you need a book row:

```ts
import { ingestForeignX402ToBook } from '@xfuel/adapters/ingest';

await ingestForeignX402ToBook(
  { payment_required: { ... }, payment_response: { ... } },
  { apiKey, agentId: 7, session: process.env.CHIT_BOOK_SESSION! },
);
```

Requires a registered agent (`POST /v1/agents/register`) and possession session.

## Product law

Chit402 is the book — hub, model, amount, `verify_url`. Not a cheaper inference router.

Docs: https://chit402.com/docs/framework-adapters
