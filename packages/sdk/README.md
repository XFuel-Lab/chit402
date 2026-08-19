# xfuel-sdk

TypeScript / JavaScript client for the XFuel M2M API.

npm: `xfuel-sdk` · License: Apache-2.0  
Hosted demo: https://api-testnet.xfuel.app

The hostname says testnet. **Payments on that host are real USDC on Base mainnet** via Coinbase x402. Do not point a real wallet at it unless you mean to pay.

## Install

```
npm install xfuel-sdk
```

Use a **named** import. The package is CommonJS; a default `import XFuelClient from 'xfuel-sdk'` is not a constructor under native ESM.

```ts
import { XFuelClient } from 'xfuel-sdk';
```

On-chain helpers (ethers peer): `import { verifyProof } from 'xfuel-sdk/onchain'`.

HMAC receipt check does **not** need ethers: `import { verifyReceiptSignature } from 'xfuel-sdk'`. That is operator tamper-evidence (shared `RECEIPT_SIGNING_SECRET`), not a third-party settlement proof.

Examples live in the [repo](https://github.com/XFuel-Lab/xfuel-protocol/tree/main/packages/sdk/examples), not the npm tarball.

## First hour — no wallet

The free path is OpenAI-compatible `/v1`. Swap `baseURL` on any OpenAI client, or:

```ts
import { XFuelClient } from 'xfuel-sdk';

const client = new XFuelClient(); // demo host + public `xfuel-demo` key

const chat = await client.chatCompletions({
  model: 'xfuel/auto',
  messages: [{ role: 'user', content: 'Say hello in five words.' }],
});
console.log(chat.choices[0].message.content);
console.log(chat.xfuel?.verify_url); // signed receipt — no USDC moved
```

`xfuel/auto` picks a live chat model. `await client.listModels()` lists the rest.

## Paid USDC (`/task-request`)

`submitInference` / `submitTask` hit the paid rail. Without a real x402 payer the host returns **402**. `createMockPayer()` is for a **local mock facilitator only** — Coinbase x402 on the hosted demo rejects it (`payment_payload_invalid`).

To move real funds: `createEip3009Payer(wallet)` from `xfuel-sdk/onchain`. That spends mainnet USDC.

A 402 from `submitTask` is an `XFuelApiError` with `error.challenge.accepts` (the x402 handshake). Or use `submitTaskWithPayment`.

Production: pass `{ baseUrl, apiKey }`. As-deployed: [docs/RUNTIME_STATE.md](../../docs/RUNTIME_STATE.md).

## Proofs

Settlement proofs attest fees / payment binding / output commitment — not black-box model correctness. Unmetered `/v1` receipts have no Base explorer ref. Use `getProof` + `XFuelOnChain.verifyProof` / `verifyPaymentBinding` on a paid task that actually proved.

## Docs

- [Design partner onboarding](../../docs/DESIGN_PARTNER_ONBOARDING.md)
- [docs/M2M_API.md](../../docs/M2M_API.md)
- [docs/X402_ADAPTER.md](../../docs/X402_ADAPTER.md)
- [Agent playbook](../agent-skills/AGENT_PLAYBOOK.md)
