# xfuel-sdk

TypeScript / JavaScript client for the XFuel M2M API: submit inference, pay USDC via x402, fetch proofs, A2A / swarm helpers.

npm: `xfuel-sdk` · License: Apache-2.0  
Hosted demo: https://api-testnet.xfuel.app

## Install

```
npm install xfuel-sdk
```

On-chain helpers: `import 'xfuel-sdk/onchain'` (needs `ethers` peer dep).

Quickstart example: `npm run example:quickstart`.

## Quick start

```
import XFuelClient, { createMockPayer } from 'xfuel-sdk';

const client = new XFuelClient(); // demo endpoint + public demo key

// 'xfuel/auto' resolves to the best live chat model. List concrete ids (e.g.
// theta/glm_5_2) with `await client.listModels()` — retired names are rejected.
const task = await client.submitInference(
  'xfuel/auto',
  '0xYourWalletAddress',
  '1000000',
  {
    chain_id: 'base',
    payment: { rail: 'usdc' },
    // The endpoint settles real USDC via x402; without a payer it answers 402.
    // Swap for createEip3009Payer(wallet) from 'xfuel-sdk/onchain' to move funds.
    payer: createMockPayer(),
  }
);

const result = await client.waitForCompletion(task.task_id);
const proof = result.status === 'completed' ? await client.getProof(task.task_id) : null;
console.log(task.verify_url ?? client.receiptUrl(task.task_id));
```

Production: pass `{ baseUrl, apiKey }`. As-deployed: [docs/RUNTIME_STATE.md](../../docs/RUNTIME_STATE.md).

## USDC via x402

Default rail. Pass an agent-side `payer` (`createMockPayer`, `createSignerPayer`, or `createEip3009Payer` from `xfuel-sdk/onchain`). The SDK never holds server keys.

Examples: `examples/pay-with-usdc.ts`, `examples/pay-prove-verify.ts`.

## Proofs

Settlement proofs attest fees / payment binding / output commitment — not black-box model correctness. Use `getProof` + `XFuelOnChain.verifyProof` / `verifyPaymentBinding`.

## A2A and swarms

`sendA2AMessage` / `getA2AStatus` for messaging.  
`XFuelOnChain` builds calldata for register → bid → settle and swarm lifecycle (up to 18 members). Examples: `examples/a2a-swarm.ts`, `examples/swarm-coordinate.ts`.

## Docs

- [docs/M2M_API.md](../../docs/M2M_API.md)
- [docs/X402_ADAPTER.md](../../docs/X402_ADAPTER.md)
- [Agent playbook](../agent-skills/AGENT_PLAYBOOK.md)
