# chit402-emdash

Chit is the book. When an agent pays an EmDash page, this package stamps the read: who opened the page, who funded it, and a `verify_url` the payer can hold.

The stamp is the existing book door, `POST /v1/agents/:agent_id/book/ingest`, at the standard **$0.002** USDC fee (2000 atomic units, 6 decimals). A slow or failed stamp is logged. The paid page still renders. Humans skipped by bot-only mode, and unpaid 402 responses, are left as `@emdash-cms/x402` returned them.

## Install

`chit402-emdash` is not on npm yet. It is coming to npm. Until then, build it from this repo and install the folder. `@emdash-cms/x402` is the published EmDash package.

```bash
git clone https://github.com/XFuel-Lab/chit402.git
cd chit402/packages/emdash-chit402
npm install
npm run build
```

From the EmDash app, point npm at that built folder:

```bash
npm install /path/to/chit402/packages/emdash-chit402 @emdash-cms/x402
```

`astro.config.mjs` keeps the EmDash payment integration. The page wraps `Astro.locals.x402`. `CHIT_STAMP_PRIVATE_KEY` is the publisher key that pays the $0.002 stamp. A viem account, or `createEip3009Payer` from `xfuel-sdk/onchain`, can be passed as `signer` instead of the raw key.

```js
import { x402 } from "@emdash-cms/x402";
export default { integrations: [x402({ payTo: "0xPublisher", network: "eip155:8453", defaultPrice: "$0.05" })] };
```

```astro
---
import { withReceipts } from "chit402-emdash";
const x402 = withReceipts(Astro.locals.x402, {
  agentId: "7", session: import.meta.env.CHIT_BOOK_SESSION, apiKey: import.meta.env.CHIT_API_KEY,
  payTo: "0xPublisher", signer: import.meta.env.CHIT_STAMP_PRIVATE_KEY,
  waitUntil: (p) => Astro.locals.runtime?.ctx?.waitUntil?.(p),
});
const result = await x402.enforce(Astro.request, { price: "$0.05" });
if (result instanceof Response) return result;
x402.applyHeaders(result, Astro.response);
---
```

`stampedEnforce` is the same wrapper. On Cloudflare Workers, `waitUntil` lets the stamp finish after the response. Without it the page still returns inside 1.5s and the in-flight stamp may be dropped with the isolate.

## Receipt header

When ingest returns inside that window, the page response carries the settlement header from EmDash plus:

```http
X-Chit-Receipt: https://api.chit402.com/receipt/foreign-x402-m5k2-ab12cd
PAYMENT-RESPONSE: <base64 settlement from @emdash-cms/x402>
```

A repeat of the same settlement tx gets `X-Chit-Receipt: https://api.chit402.com/receipt/by-tx?tx=<hash>`, which redirects to the same receipt.

## Book auth

The publisher holds a registered agent (`POST /v1/agents/register`) and sends:

| Header | Config |
| --- | --- |
| `X-API-Key` | `apiKey` or `CHIT_API_KEY` |
| `X-Xfuel-Session` | `session` or `CHIT_BOOK_SESSION` |

The body is `payment_required` (page URL, atomic USDC price, payTo, network) and `payment_response` (settlement tx, payer, network), plus `deliverable_hash` when you pass `contentHash`. Gateway origin defaults to `https://api.chit402.com`.

The ingest door answers **402** until the submitter pays the $0.002 stamp, unless that API key is on the gateway waiver list (`STAMP_WAIVER_KEYS`). With `signer` set, this package signs that fee (SDK `X-PAYMENT` header) and retries the ingest once. The page is not held past 1.5s: a slower payment continues on `waitUntil`, and `X-Chit-Receipt` is set only when `verify_url` arrives in time. With no signer, the wrapper logs one warning when it is created and still serves the page. Demo keys cannot write the book.

## Later hook

If EmDash adds `onSettled(ctx)` with `{ request, result, resource }`, drop the wrapper and pass:

```js
import { chit402OnSettled } from "chit402-emdash";
onSettled: chit402OnSettled({
  agentId: "7", session, apiKey, payTo: "0xPublisher",
  signer: import.meta.env.CHIT_STAMP_PRIVATE_KEY,
})
```
