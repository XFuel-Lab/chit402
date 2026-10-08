# @chit402/cdp-spend-store

A CDP `SpendStore` whose `append` places an atomic hold on the funder's cap at a Chit402 gateway, and whose payment-response hook settles that hold and returns a Chit402 receipt (`verify_url`). Base Sepolia and Sepolia USDC only. The package does not sign receipts and does not publish itself.

CDP's own lock is in-process. Two workers that share only the default store can both pass `maxCumulativeSpend`. This store's refusal is the gateway's `409 CEILING_EXCEEDED`. `append` throws `SpendCapExceeded`. `@x402/core` runs that before-hook before the scheme signs and does not catch the throw, so the payment is not signed and not sent.

The hold/settle core (`createSpendBook`, `attachHoldSettle`) does not import CDP. Use it with any `x402Client`. `createChitSpendStore` is the thin adapter.

## Quickstart

```js
import { applySpendControls } from "@coinbase/cdp-sdk/x402";
import { x402Client } from "@x402/core/client";
import { createChitSpendStore, attachChitReceipt, BASE_SEPOLIA_USDC } from "@chit402/cdp-spend-store";

const client = new x402Client().setSpendControls(false);
const store = createChitSpendStore({
  gatewayUrl: process.env.CHIT402_GATEWAY_URL,
  token: process.env.CHIT402_SPEND_HOLD_TOKEN,
  funder: process.env.CHIT402_FUNDER,
});
applySpendControls(client, {
  maxCumulativeSpend: { atomic: process.env.CHIT402_CAP_ATOMIC, asset: BASE_SEPOLIA_USDC },
  allowedNetworks: ["eip155:84532"],
  store,
});
attachChitReceipt(client, store);
```

`maxCumulativeSpend` has to be set or CDP never calls `append`. The gateway ceiling is the one that holds across processes. After a paid response, `store.book.lastReceipt.verify_url` is the receipt. `x402` does not forward hook return values, so the receipt is also on `ctx.chitReceipt`.

Importing `@coinbase/cdp-sdk/x402` needs its optional peers: `@x402/core`, `@x402/evm`, `@x402/extensions`, `@x402/svm`. The example's `--pay` path also needs `@x402/fetch`.

Any other x402 client, without CDP:

```js
import { attachHoldSettle, createSpendBook } from "@chit402/cdp-spend-store";

const book = createSpendBook({
  gatewayUrl: process.env.CHIT402_GATEWAY_URL,
  token: process.env.CHIT402_SPEND_HOLD_TOKEN,
  funder: process.env.CHIT402_FUNDER,
});
attachHoldSettle(client, book);
```

Do not put both on one client. Each would reserve.

## Gateway

Routes exist only when `SPEND_HOLD_ENABLED=true`. They share PR #495's `SpendHoldStore`. A missing token fails closed. Caps are server-side (`SPEND_HOLD_CEILINGS_JSON`), not whatever the agent sends. Base mainnet and mainnet USDC are rejected.

| Method | Path | Effect |
|---|---|---|
| `POST` | `/v1/spend/holds` | Atomic hold. `409` `CEILING_EXCEEDED` refuses. Same `request_id` does not reserve twice. |
| `GET` | `/v1/spend/holds?funder=0x…` | Open and consumed entries, plus cap, held, spent, remaining. |
| `POST` | `/v1/spend/holds/:request_id/release` | Drop an open hold. `removeEntry` calls this. |
| `POST` | `/v1/spend/holds/:request_id/settle` | Consume the hold and return the receipt. A retry returns the same issuer JWS. |

`GET /receipt/:taskId` serves that receipt. The handler does not sign on read.

Settle records the x402 settle response (payer, tx, amount, resource host and path). It does not read the USDC `Transfer` log. The receipt's unsigned `spend_hold.onchain_check` is `not_performed`. `claim_id` is set only when settle is given a positive integer `agent_id` (`CHIT402_AGENT_ID`). Without that seat, `xfuel-verify` can refuse the paid receipt.

An ambiguous payment response (no settle result and no follow-up 402) leaves the hold until `SPEND_HOLD_TTL_MS`. It does not get a receipt. A failed settle releases the hold.

The client refuses `api.chit402.com` and `api.xfuel.app` even if `CHIT402_SPEND_HOLD_SANDBOX=true`. Localhost is allowed. Any other host needs `CHIT402_SPEND_HOLD_SANDBOX=true`.

## Environment

Names only. No values belong in the repo.

Client:

- `CHIT402_GATEWAY_URL` — sandbox or `http://127.0.0.1:…`. Not production.
- `CHIT402_SPEND_HOLD_TOKEN` — bearer token, same value as the gateway's `SPEND_HOLD_API_TOKEN`.
- `CHIT402_FUNDER` — address whose ceiling the hold is checked against.
- `CHIT402_CAP_ATOMIC` — local CDP pre-check. The gateway JSON cap is authoritative.
- `CHIT402_SPEND_HOLD_SANDBOX` — `true` for a non-local sandbox host.
- `CHIT402_AGENT_ID` — optional book seat copied onto the receipt.
- `CDP_API_KEY_ID`, `CDP_API_KEY_SECRET`, `CDP_WALLET_SECRET` — CDP server wallet. The example reads these when you pass `--pay`.

Gateway (flag off by default; do not enable in production for this sandbox route):

- `SPEND_HOLD_ENABLED=true`
- `SPEND_HOLD_API_TOKEN`
- `SPEND_HOLD_CEILINGS_JSON` — `{ "0xFunder": { "cap": "1000000" } }` atomic USDC.
- `SPEND_HOLD_TTL_MS` — open-hold expiry. Default 10 minutes.

## Example

`examples/base-sepolia.mjs` is Base Sepolia and Sepolia USDC only. With no `--pay` it prints the env names and exits. `--pay` wires a CDP account and will not follow a 402 whose network is not `eip155:84532`.

## Tests

```
npm test
```

The two-process test forks two workers against one gateway cap. A refusal does not increment the scheme's sign counter. Settle-twice compares issuer JWS strings (ES256 is non-deterministic, so a second signature would not match).
