# chit402-sdk

OpenAI-compatible TypeScript client for Chit402 — receipted AI inference with USDC settlement on Base.

npm: `chit402-sdk` · License: Apache-2.0  
Docs: https://chit402.com · API: https://api.chit402.com

**Public beta. Payments are real USDC on Base mainnet** via x402. Do not point a real wallet at it unless you mean to pay.

## Install

```bash
npm install chit402-sdk
```

## Quick Start

```ts
import { Chit402Client } from 'chit402-sdk';

const client = new Chit402Client();

const chat = await client.chatCompletions({
  model: 'chit402/auto',
  messages: [{ role: 'user', content: 'Say hello in five words.' }],
});

console.log(chat.choices[0].message.content);
console.log(chat.xfuel?.verify_url); // signed receipt
```

## First Hour — No Wallet

The free path is `/v1` chat completions. Use any OpenAI-compatible client with `baseURL: 'https://api.chit402.com/v1'`, or the `Chit402Client` above.

The demo key `chit402-demo` is rate-limited — bring your own key for higher limits.

## Paid USDC

`submitInference` / `submitTaskWithPayment` hit the paid rail via x402. Without a real payer, the host returns **402**.

```ts
import { Chit402Client, createSignerPayer } from 'chit402-sdk';
import { Wallet } from 'ethers';

const wallet = new Wallet(process.env.PRIVATE_KEY);
const payer = createSignerPayer(wallet);
const client = new Chit402Client({ apiKey: process.env.CHIT402_API_KEY });

const result = await client.submitTaskWithPayment(
  { /* task params */ },
  payer,
);
```

## On-chain Helpers

```ts
import { verifyProof } from 'chit402-sdk/onchain';
```

Requires `ethers` peer dependency.

## Documentation

- [Chit402 Docs](https://chit402.com)
- [API Reference](https://api.chit402.com)

## License

Apache-2.0
