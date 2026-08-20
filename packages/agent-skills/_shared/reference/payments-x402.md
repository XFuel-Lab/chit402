# Payments: USDC via x402 (default) + TFUEL (secondary)

XFuel's default, recommended payment rail is **USDC via x402**. **TFUEL/TDROP on
Theta remains fully supported** as a secondary rail for Theta-native flows. Every
payment-bearing skill accepts a `payment` object; when omitted, the server default
(`X402_DEFAULT_RAIL`) applies.

## The `payment` parameter

```jsonc
{
  "rail": "usdc",              // "usdc" (default) | "tfuel"
  "asset": "USDC",             // usdc only
  "network": "base",           // usdc only: "base" (mainnet, LIVE today) | "base-sepolia" | "solana"
                               // Take this from POST /task-quote rather than hardcoding.
  "maxAmount": "50000"         // smallest unit: USDC = 6dp (50000 = $0.05), TFUEL = wei
}
```

## Pricing preview — `POST /task-quote`

Before paying, an agent can price a task per rail (no side effects):

```
POST /task-quote { model_id?, amount? }
→ { recommended:"usdc", default_rail, rails:{ usdc:{ amount, asset, network, pay_to, decimals, enabled }, tfuel:{ amount } } }
```

## USDC/x402 handshake (agent side)

```
1. POST /task-request { ..., payment: { rail: "usdc", network: "base", maxAmount } }
2. ← 402 Payment Required + body.accepts[] { scheme:"exact", network, asset, maxAmountRequired, payTo, extra:{ nonce, expiresAt } }
3. Agent-side payer signs USDC on Base (mainnet today) for the challenge → produces the X-PAYMENT header
4. Retry POST /task-request with headers  X-PAYMENT: <blob>  and  X-PAYMENT-NONCE: <extra.nonce>
   (the nonce may instead be embedded as a `nonce` field inside a JSON / base64-JSON X-PAYMENT blob)
5. Server verifies + settles via the facilitator (binds nonce/amount, rejects replays) → { task_id, payment_rail:"usdc", payment_ref }
6. Poll /task-status or await the TaskSettled webhook → both expose { payment_rail, payment_ref }
```

The server echoes `payment_rail` + `payment_ref` on the 202 `/task-request` response,
in `GET /task-status`, and in the `TaskSettled` webhook payload.

**Payer model:** the payer is **agent-side and pluggable** — the SDK/skill never
holds private keys. Provide a payer that, given the `accepts[]` challenge, returns
the `X-PAYMENT` header value.

## SDK client flow (recommended)

The `xfuel-sdk` runs the whole handshake for you — pass an `X402Payer` and it
submits, catches the 402, pays, and retries in one call:

```js
import { XFuelClient, createMockPayer, createSignerPayer } from 'xfuel-sdk';

const client = new XFuelClient({ baseUrl, apiKey });

// Dev/CI — works against the mock facilitator; does NOT move real funds.
const task = await client.submitInference('xfuel/auto', '0xAddr', '1000000', {
  payment: { rail: 'usdc', network: 'base', maxAmount: '50000' }, // Base mainnet is LIVE
  payer: createMockPayer(),
});

// Production — sign USDC EIP-3009 transferWithAuthorization on Base with your wallet.
// createEip3009Payer is in the /onchain entry (needs `ethers`); the key stays in the
// signer, and the SDK envelopes the signed authorization into X-PAYMENT.
import { Wallet } from 'ethers';
import { createEip3009Payer } from 'xfuel-sdk/onchain';
const payer = createEip3009Payer(new Wallet(process.env.XFUEL_PAYER_PK));
await client.submitTaskWithPayment({ /* task params */, payment: { rail: 'usdc' } }, payer);
```

- `submitTaskWithPayment(params, payer)` — generic; runs the 402 loop.
- `submitInference(model, sender, amount, { payment, payer })` — inference shorthand.
- Omit `payer` (or use `{ rail: 'tfuel' }`) to settle via TFUEL. If the server settles
  without a 402 (TFUEL rail), the payer is never called.
- Payers: `createMockPayer()` (dev/CI, `xfuel-sdk`), `createEip3009Payer(signer)`
  (Base USDC, `xfuel-sdk/onchain`), `createSignerPayer(signFn)` (generic). Also
  `selectAccept(challenge)`.
- **Runnable example:** `packages/sdk/examples/pay-with-usdc.ts` (`npx tsx examples/pay-with-usdc.ts`).

The EIP-3009 `authorization` blob delivered to the facilitator is
`{ type:'eip3009-transferWithAuthorization', domain, message, signature }` where
`message = { from, to, value, validAfter, validBefore, nonce }` — the facilitator
submits it via `USDC.transferWithAuthorization(...)`.

## TFUEL (secondary)

```jsonc
"payment": { "rail": "tfuel", "maxAmount": "1000000000000000000" }  // 1 TFUEL in wei
```

No 402 handshake — the existing amount-in-wei M2M flow settles on Theta (361/365).

## Settlement model (token-light, ADR 0001)

- The protocol USDC fee lands at **one Base address** (`X402_PAY_TO` / Splits) —
  off the hot path. There is **no** synchronous per-fee 30/30/25/15 split; bucket
  fan-out (if any) is downstream, governance-adjustable treasury policy on Base.
  The legacy `CoreRevenueSplitter` (native TFUEL, 30/30/25/15) is **deprecated**
  from the fee path. TFUEL payments still settle directly on Theta.

## Replay & binding

Each 402 challenge carries a `nonce` bound to `{ amount, asset, network, payTo,
resource }` with a TTL (`X402_CHALLENGE_TTL_MS`). Verify enforces expiry + amount
binding; settle marks the nonce spent (replay protection — analogous to ZK
nullifiers).

## Proof binding (Phase 2, flag-gated)

`X402_PROOF_BINDING` (enabled on the live testnet) binds the settlement `payment_ref`
into the SP1 proof so it attests **payment + computation**. When enabled for a USDC task,
`/task-status` and `/prove-result` return a `payment_binding` object
(`{ version, rail, commitment, payment_ref_hash, amount, in_proof }`), also exposed
as the SDK `PaymentBinding` type. The `commitment` mirrors
`SP1ProofHooks.computePaymentCommitment` (parity-tested). `in_proof` is `false`
until the SP1 guest commits the v2 public-values layout (new `programVKey`); until
then it's server-attested settlement metadata. See `public-values.md` (v2 layout)
and `docs/X402_ADAPTER.md`.

## Flags & fallback (server)

| Flag | Meaning |
|------|---------|
| `X402_ENABLED` | Master switch. Live testnet runs `true`. |
| `X402_FACILITATOR_PROVIDER` | Facilitator backend. Live: **`cdp`** (Coinbase CDP, Base mainnet). `x402` (public `x402.org/facilitator`, no API key) is the Sepolia/rollback path; `zan` is optional. |
| `X402_NETWORK` | Payment network. Live: `base` (mainnet). `base-sepolia` is the rollback. |
| `X402_DEFAULT_RAIL` | `usdc` (default on Base; ADR 0002). |
| `X402_FALLBACK_TFUEL` | If `usdc` requested but facilitator unavailable: `true` → fall back to TFUEL; `false` → `503`. |
| `ZAN_X402_GATEWAY_URL` / `ZAN_X402_API_KEY` | Optional ZAN facilitator (only when `X402_FACILITATOR_PROVIDER=zan`). |
| `X402_PAY_TO` / `X402_ASSET` | Base treasury + asset defaults. |

**Status — LIVE on Base mainnet:** the server-side 402 handshake on `POST /task-request`
is enabled on the hosted endpoint (`X402_ENABLED=true`, `X402_FACILITATOR_PROVIDER=cdp`
against the Coinbase CDP facilitator, `X402_NETWORK=base`, `X402_PROOF_BINDING=true`).
An unpaid `usdc` request returns a bound 402 challenge; a retry with a valid
`X-PAYMENT` (+ nonce) is verified and settled, and `payment_rail="usdc"` +
`payment_ref` are attached to the task. The host is `api.xfuel.app` (public beta); the
money is real — see `docs/RUNTIME_STATE.md`. Base Sepolia is the rollback path. ZAN is
optional, not required, and not a blocker. Always trust the `payment_rail` field in the
status response. For
local/CI, run the mock facilitator (`services/gateway/src/x402-mock-facilitator.js`);
the full loop is covered by `services/gateway/test/x402-server.test.mjs`. See
[`docs/RUNTIME_STATE.md`](../../../../docs/RUNTIME_STATE.md) for as-deployed config.
