# Design Partner Onboarding

You are in. XFuel is the book: this agent spent Y on this job, and you hold hub, model, and amount. Signed receipt is table stakes. This page is the working copy — tell us what broke.

## Two seats

| Seat | What they need |
|------|----------------|
| **Builder** | Point `baseURL` at `https://api.xfuel.app/v1`, get a signed receipt on every call |
| **USDC signer** | Review `verify_url`, see the collected spend, forward receipts to finance/auditors |

## Close

1. **One ingest this week** — a real call through the gateway with a collected USDC `payment.ref`
2. **A `verify_url` you can forward** — public, no auth, shows hub/model/amount/payment
3. **`GET /receipt/by-tx?tx=<hash>`** — look up any receipt by its on-chain settlement

The product is the collected row — sidecar + ingest if you already pay a provider. Without collected USDC the receipt is client-attested only (a tech demo, not the product).

---

## Two surfaces

| Surface | What it is |
|---------|------------|
| `POST /v1/chat/completions` | Chat-completions drop-in. Signed receipt, no wallet for demo traffic. |
| `POST /task-request` | Paid USDC path. Rolling settlement + optional on-chain proof. |

You should already have:

1. A **partner API key** (yours — not the public `xfuel-demo` key)
2. An invite to a shared Slack or Telegram with us

If either is missing, reply on that channel before you start.

Gateway: `https://api.xfuel.app`  
Public beta. **Payments on this host are real USDC on Base mainnet.** Treat the key like a credential.

---

## 1. Two minutes — no wallet

Any chat-completions client works. Change the base URL and the key.

```js
import OpenAI from 'openai';

const client = new OpenAI({
  apiKey: process.env.XFUEL_API_KEY,
  baseURL: 'https://api.xfuel.app/v1',
});

const res = await client.chat.completions.create({
  model: 'xfuel/auto',
  messages: [{ role: 'user', content: 'Say hello in five words.' }],
});

console.log(res.choices[0].message.content);
console.log(res.xfuel); // signed receipt — clients ignore this field
```

That call is **demo traffic** — not the product. It returns a client-attested receipt. Use `xfuel/auto` unless you have a reason not to — it picks a live chat model from the catalog.

Same swap works in LangChain, the Vercel AI SDK, Grok, Cursor, or anything else that takes a chat-completions `baseURL`.

---

## 2. Read the receipt

Every response carries the same artifact two ways:

| Where | What to look at |
|-------|-----------------|
| Headers | `x-xfuel-task-id`, `x-xfuel-provider`, `x-xfuel-verify-url` |
| Body | `xfuel` on the chat completion |
| Public page | `https://api.xfuel.app/receipt/<task_id>` — no auth, shareable |

Open the verify URL. Then fetch JSON you can keep in your own logs:

```bash
curl -sS "https://api.xfuel.app/receipt/<task_id>?format=json"
```

Fields that matter on a first pass:

| Field | Meaning |
|-------|---------|
| `route.model` / `route.provider` | What actually served the call |
| `usage` | Prompt / completion tokens measured after the call |
| `payment.rail` | `"unmetered"` on demo traffic — nothing settled |
| `payment.ref` | On-chain tx hash when USDC settled — **this is the product** |
| `output.hash` | Commitment to what came back |
| `signature` | Tamper-evident HMAC over the payment-bound fields |

Auditor pack (policy + totals, **no prompts or raw outputs**):

```text
https://api.xfuel.app/receipt/<task_id>?format=auditor
```

---

## 3. When you want to pay

The chat-completions path is demo traffic. USDC settlement is the product, on `POST /task-request`, once the receipt is useful enough to put a budget behind.

- Rail: USDC via x402 on **Base mainnet**
- Price: measured provider cost + 10%, itemised on the receipt
- You pay for the **last** call. The first call from a new payer is served unpaid; the next request collects the measured bill.
- Optional on-chain SP1 settlement proof: **+$0.08**, opt-in (`proof_tier: "settlement"`)

```js
import { XFuelClient } from 'xfuel-sdk';
import { createEip3009Payer } from 'xfuel-sdk/onchain';

const client = new XFuelClient({
  baseUrl: 'https://api.xfuel.app',
  apiKey: process.env.XFUEL_API_KEY,
});

const quote = await client.quoteTask({ model_id: 'xfuel/auto', amount: '1000000' });
const task = await client.submitInference('xfuel/auto', wallet.address, '1000000', {
  chain_id: 'base',
  payment: { rail: 'usdc', network: quote.rails.usdc.network, maxAmount: quote.rails.usdc.amount },
  payer: createEip3009Payer(wallet),
});
console.log(task.verify_url);
await client.waitForCompletion(task.task_id);
```

SDK: `npm install xfuel-sdk`.

Do not put provider org keys in the agent. The agent holds a USDC budget; we hold the provider keys.

---

## What the receipt proves (and does not)

| You get | What it actually means |
|---------|------------------------|
| Signed receipt (every call) | Route, provider, tokens, output hash. Tamper-evident. |
| USDC receipt (paid path) | The above, plus the dollar: COGS, 10% fee, what settled. |
| SP1 settlement proof (opt-in) | On-chain verification of fees, payment binding, output commitment. **Not** a proof that model weights ran correctly. |
| Private Spend (when on) | Providers see pooled XFuel traffic, not your org graph. **Gateway-trusted — not prompt encryption.** |

We do not claim a signed receipt or an SP1 proof verifies black-box model correctness.

---

## Things that will surprise you

**Demo ceiling.** Demo traffic stops once your key has burned about **$1 of provider cost in a UTC day**. That is enough to try the receipt, not enough to farm. Use the paid path for real volume.

**Hostname vs money.** `api.xfuel.app` settles **mainnet USDC**. A quote that looks like play money is not.

**The first paid call has no settlement ref.** Rolling settlement collects the last call on the next request. Open the receipt: it should say **bill pending**, not look empty. The explorer link appears on the receipt that actually paid.

---

## If something fails

Read `error.code` before retrying.

| Code | What to do |
|------|------------|
| `401` / bad key | Use the partner key, `Authorization: Bearer …` or `X-API-Key`. |
| `model_retired` / `model_not_found` | Call `GET /v1/models`. Do not retry the same id. |
| `no_provider_available` | Retry later — capacity, not your request. |
| `free_tier_exhausted` | Move to `/task-request` or wait for UTC midnight. |
| `402` on `/task-request` | Expected: pay the challenge (the previous call's measured bill). |

A failed paid task is never answered with a mock. If it failed, nothing to attest ran.

---

## What we want from you

1. Did the base-URL swap take less than a day?
2. Is `verify_url` / the JSON receipt usable in *your* audit trail — or what is missing?
3. What would have to change for this to carry production volume?

Reply on the channel we invited you to.

---

## Further reading

| If you want… | Go here |
|--------------|---------|
| Chat completions surface | [CHAT_COMPLETIONS_GATEWAY.md](./CHAT_COMPLETIONS_GATEWAY.md) |
| Paid REST + quotes | [M2M_API.md](./M2M_API.md) |
| USDC / x402 | [X402_ADAPTER.md](./X402_ADAPTER.md) |
| TypeScript client | [packages/sdk/README.md](../packages/sdk/README.md) |
| Agent flows | [AGENT_PLAYBOOK.md](../packages/agent-skills/AGENT_PLAYBOOK.md) |
| Receipt fields | [RECEIPT_SCHEMA_V2.md](./RECEIPT_SCHEMA_V2.md) |
