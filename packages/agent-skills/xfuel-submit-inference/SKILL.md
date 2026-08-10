---
name: xfuel-submit-inference
description: >-
  Submit a verifiable AI inference or compute task to the XFuel Protocol and get
  back an on-chain-settled result with a ZK proof. Use when a user or agent wants
  to run an LLM/compute task via pluggable providers (neocloud / optional DePIN GPU)
  with a verifiable receipt. Settlement is USDC via x402 on Base by default.
  Triggers: "run inference with proof", "verifiable LLM call", "submit a compute
  task to XFuel", "pay with x402".
---

# XFuel: Submit Verifiable Inference

Run an AI inference/compute task through XFuel's router and receive a settled,
proof-backed receipt. Prefer the SDK over raw HTTP. Money + proofs live on Base.

## Prerequisites

- `XFUEL_API_URL` (default `https://api-testnet.xfuel.app`; use `http://localhost:3002` to self-host) and `XFUEL_API_KEY` (defaults to the public demo key `xfuel-demo`).
- `xfuel-sdk` installed (`npm install xfuel-sdk`). See
  `../_shared/reference/env-and-endpoints.md`.

## Parameters

| Name | Required | Description |
|------|----------|-------------|
| `model` | yes (inference) | Live catalog id, e.g. `xfuel/auto` or `theta/glm_5_2` (list via `GET /v1/models`). Retired `llama-*` names are rejected, not remapped. Maps to SDK `modelId`. |
| `input` | recommended | Prompt/string. You compute `input_hash = keccak256(input)` (the SDK takes `input_hash`, not the raw input). |
| `sender` | yes | Caller address (settlement attribution). |
| `amount` | no | Gross fee in wei (min `10000`). Default `1000000`. |
| `chain_id` | no | `base` (default) \| `theta` \| `bittensor` \| `akash` \| `osmosis`. `base` = settlement home; others are routing / optional-rail hints. |
| `proof_system` | no | `sp1` (default settlement proof). `zkgpt` is a retired/dev scaffold — not the Tier-3 path. |
| `callback_url` | no | Webhook to receive the `TaskSettled` event instead of polling. |
| `payment` | no | Payment rail. **Default USDC via x402** (`{ rail: 'usdc', network: 'base' }`). Optional legacy rails may exist if the server enables them. |
| `subnet_id` | yes if `chain_id=bittensor` | Bittensor subnet UID. |

## Payment rail (USDC via x402 is the default)

XFuel's default rail is **USDC via x402** — agent-native payment on Base against a
machine-parseable 402 challenge. The SDK never holds keys.

```jsonc
// Default — USDC via x402 (agent-side wallet signs; SDK never holds keys)
"payment": { "rail": "usdc", "asset": "USDC", "network": "base", "maxAmount": "50000" }
```

USDC/x402 handshake (agent side): submit → receive `402` + `accepts[]` challenge →
your **pluggable payer** signs USDC on Base → retry with the `X-PAYMENT` header (plus
`X-PAYMENT-NONCE` echoing `accepts[].extra.nonce`) → server verifies + settles →
returns `{ task_id, payment_rail: "usdc", payment_ref }`.

The SDK runs this whole loop for you — pass a **payer** and it submits, catches the
402, pays, and retries in one call. Payers are agent-side; the SDK never holds keys:

```js
// Dev/CI (works against the mock facilitator; does NOT move real funds):
import { createMockPayer } from 'xfuel-sdk';
const payer = createMockPayer();

// Production: sign USDC EIP-3009 transferWithAuthorization on Base with your wallet.
// createEip3009Payer is in the /onchain entry (needs the `ethers` peer dep); the
// private key stays inside the signer — the SDK never sees it.
import { Wallet } from 'ethers';
import { createEip3009Payer } from 'xfuel-sdk/onchain';
const payer = createEip3009Payer(new Wallet(process.env.XFUEL_PAYER_PK));
```

Runnable end-to-end example (quote → pay → prove):
[`packages/sdk/examples/pay-with-usdc.ts`](../../sdk/examples/pay-with-usdc.ts) —
`npx tsx examples/pay-with-usdc.ts` (mock payer by default; set `XFUEL_PAYER_PK`
to sign real USDC on Base).

> Status: the server-side 402 handshake is **flag-gated** (`X402_ENABLED`, Phase 1)
> and `X402_DEFAULT_RAIL` defaults to `usdc` on Base. Until
> then, requests settle via TFUEL even if `rail: 'usdc'` is set (with
> `X402_FALLBACK_TFUEL`). Always trust the `payment_rail` field in the status response.
> Preview per-rail pricing first with `POST /task-quote`.

## Procedure

1. Compute the input hash (the API/SDK take `input_hash`, not raw input):

   ```js
   import { ethers } from 'ethers';
   const input_hash = ethers.keccak256(ethers.toUtf8Bytes('Explain ZK proofs in one sentence.'));
   ```

2. Build the client and submit. Note `submitInference(modelId, sender, amount, opts)`
   is positional:

   ```js
   import { XFuelClient, ChainId, createMockPayer } from 'xfuel-sdk';
   const client = new XFuelClient({
     baseUrl: process.env.XFUEL_API_URL,
     apiKey: process.env.XFUEL_API_KEY,
   });
   const task = await client.submitInference('xfuel/auto', '0xYourAddr', '1000000', {
     chain_id: ChainId.THETA,
     input_hash,
     theta_recipient: '0xYourAddr',
     payment: { rail: 'usdc', network: 'base', maxAmount: '50000' }, // USDC default; use { rail: 'tfuel' } for Theta-native
     payer: createMockPayer(), // swap for createSignerPayer(...) in prod; omit for TFUEL
     // proof_system: 'sp1',
     // callback_url: 'https://your-agent/webhook',  // skip polling
   });
   // task.task_id, task.fee_amount, task.net_amount, task.payment_rail, task.payment_ref
   ```

   The `payer` makes `submitInference` run the full 402→pay→retry handshake
   automatically. Omit `payer` (or use `{ rail: 'tfuel' }`) to settle via TFUEL.
   For non-inference types (`compute_bid`, `data_attestation`), use the generic
   `client.submitTask(...)` or `client.submitTaskWithPayment(params, payer)`.

3. Wait for settlement (or rely on `callback_url`):

   ```js
   const result = await client.waitForCompletion(task.task_id);
   ```

4. Return `task_id`, `status`, `proof_system`, and `result`.
5. To prove the result cryptographically, pass `task_id` to the
   **`xfuel-verify-proof`** skill.

## Failure modes

- `400 validation_error` → check required fields; `amount` must be `>= 10000` wei.
- `401 unauthorized` → missing/invalid `X-API-Key`.
- `429` → rate limited; honor `Retry-After`.
- Task stuck in `routing` → all DePIN tiers may be disabled; check `GET /health`.
- legacy `proof_system: zkgpt` requested but unset → backend falls back to SP1 (not a live Tier-3 path);
  trust the `proof_system` field in the status response.

## Notes

- Fee is 0.5% by default (`fee_bps` 50–100). Fees settle as **USDC on Base** to
  `X402_PAY_TO` / Splits v2 (token-light; ADR 0001) — no hardcoded per-fee split.
- Payment rails: USDC/x402 on Base is the default. See
  `../_shared/reference/payments-x402.md`.
- Full request/response schema: `../_shared/reference/m2m-openapi.yaml`.
