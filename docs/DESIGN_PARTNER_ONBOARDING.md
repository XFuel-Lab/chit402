# Design Partner Onboarding

You are in. This page is the working copy: swap one URL, get a signed receipt on every call, tell us what broke.

Two surfaces, both live on the same host:

| Start here | What it is |
|------------|------------|
| `POST /v1/chat/completions` | Free OpenAI drop-in. Signed receipt, no wallet. **This is the first hour.** |
| `POST /task-request` | Paid USDC path (flagship demo, SDK `submitInference`). Rolling settlement + optional on-chain proof. |

You should already have:

1. A **partner API key** (yours — not the public `xfuel-demo` key)
2. An invite to a shared Slack or Telegram with us

If either is missing, reply on that channel before you start.

Gateway: `https://api.xfuel.app`  
Public beta. **Payments on this host are real USDC on Base mainnet.** Treat the key like a credential.

---

## 1. Two minutes — no wallet

Keep your existing OpenAI-compatible client. Change the base URL and the key.

```js
import OpenAI from 'openai';

const client = new OpenAI({
  apiKey: process.env.XFUEL_API_KEY, // the partner key we sent
  baseURL: 'https://api.xfuel.app/v1',
});

const res = await client.chat.completions.create({
  model: 'xfuel/auto',
  messages: [{ role: 'user', content: 'Say hello in five words.' }],
});

console.log(res.choices[0].message.content);
console.log(res.xfuel); // signed receipt — OpenAI clients ignore this field
```

That call is **free**. It still returns a signed receipt. You do not need a Base wallet, x402, or our SDK for this path.

Same swap works in LangChain, the Vercel AI SDK, Eliza, Cursor, or anything else that takes an OpenAI `baseURL`.

```js
// LangChain
new ChatOpenAI({
  model: 'xfuel/auto',
  apiKey: process.env.XFUEL_API_KEY,
  configuration: { baseURL: 'https://api.xfuel.app/v1' },
});
```

Use `xfuel/auto` unless you have a reason not to — it picks a live chat model from the catalog. List the rest with `GET /v1/models`. Retired names (`llama-*`) fail with `model_retired` rather than silently billing you for a different model.

---

## 2. Read the receipt

Every response carries the same artifact two ways:

| Where | What to look at |
|-------|-----------------|
| Headers | `x-xfuel-task-id`, `x-xfuel-provider`, `x-xfuel-verify-url` |
| Body | `xfuel` on the chat completion (OpenAI clients ignore it) |
| Public page | `https://api.xfuel.app/receipt/<task_id>` — no auth, shareable |

Open the verify URL. Then fetch JSON you can keep in your own logs:

```bash
curl -sS "https://api.xfuel.app/receipt/<task_id>?format=json"
```

On Windows PowerShell use `curl.exe`, not `curl`.

Fields that matter on a first pass:

| Field | Meaning |
|-------|---------|
| `route.model` / `route.provider` | What actually served the call, not what you asked for |
| `usage` | Prompt / completion tokens measured after the call |
| `payment.rail` | `"unmetered"` on this free path — nothing settled, so there is no dollar to attest |
| `output.hash` | Commitment to what came back |
| `signature` | Tamper-evident HMAC over the payment-bound fields |
| `provider_cogs.actual` | What the provider cost us (present even when you were not billed) |

Auditor pack (policy + totals, **no prompts or raw outputs**):

```text
https://api.xfuel.app/receipt/<task_id>?format=auditor
```

From the SDK, once you add it: `client.getReceipt(taskId)` and `client.getAuditorExport(taskId)`.

An unmetered receipt attests **which model and provider ran**. It does not attest a dollar, because nothing settled. Do not treat it as a paid invoice.

---

## 3. Your usage, not the network's

```bash
curl -sS https://api.xfuel.app/stats/me \
  -H "Authorization: Bearer $XFUEL_API_KEY"
```

Or, in Node:

```js
import { XFuelClient } from 'xfuel-sdk';

const client = new XFuelClient({
  baseUrl: 'https://api.xfuel.app',
  apiKey: process.env.XFUEL_API_KEY,
});
const mine = await client.getMyStats();
console.log(mine.north_star); // paid_tasks_7d, usdc_fees_7d
```

`/stats` (no `/me`) is the public network view. `/stats/me` is scoped to **your key**.

MCP, if you already run one: `npx xfuel-mcp` then the `get_my_stats` tool.

---

## 4. When you want to pay (optional)

The OpenAI path stays free on purpose. USDC settlement is the upgrade, on `POST /task-request`, once the receipt is useful enough to put a budget behind.

- Rail: USDC via x402 on **Base mainnet**
- Price: measured provider cost + 10%, $0.01 floor, itemised on the receipt (`provider_cogs.actual`, `payment.platform_fee_bps`)
- You pay for the **last** call. `/task-quote` is a forecast of the next one, not the invoice. The first call from a new payer is served unpaid; the next request collects the measured bill. A first call whose ceiling quote is above $1 is prepaid instead, so a whale prompt cannot walk away free.
- Optional on-chain SP1 settlement proof: **+$0.08**, opt-in (`proof_tier: "settlement"`). The prover is **live** during onboarding. Signed receipts do not depend on it. A short hello will not mint a proof on its own — automatic proofs need ≥ $2.00 of provider cost.

```js
import { XFuelClient } from 'xfuel-sdk';
import { createEip3009Payer } from 'xfuel-sdk/onchain'; // needs a wallet; ethers peer dep

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

Worked example (repo, not required to clone): [`packages/sdk/examples/pay-with-usdc.ts`](../packages/sdk/examples/pay-with-usdc.ts). SDK: `npm install xfuel-sdk`.

Do not put OpenAI / Anthropic org keys in the agent. The agent holds a USDC budget; we hold the provider keys.

---

## What the receipt proves (and does not)

| You get | What it actually means |
|---------|------------------------|
| Signed receipt (every call) | Route, provider, tokens, output hash. Tamper-evident. |
| USDC receipt (paid path) | The above, plus the dollar: COGS, 10% fee, what settled. |
| SP1 settlement proof (opt-in) | On-chain verification of fees, payment binding, output commitment. **Not** a proof that GPT-class weights ran correctly. |
| Private Spend (when on) | Providers see pooled XFuel traffic, not your org graph. **Gateway-trusted — not prompt encryption.** Check `privacy.mode` on the receipt. |
| Confidential / TEE route | Prompt privacy. Only if we have configured that path for you — ask if you need it. |

We do not claim a signed receipt or an SP1 proof verifies black-box model correctness. If an endpoint served a different quantisation or truncated the output, that is a later assurance tier, not this one.

---

## Things that will surprise you

**Daily free-tier ceiling.** Unmetered `/v1` stops once your key has burned about **$1 of provider cost in a UTC day** (`402`, code `free_tier_exhausted`, `Retry-After` until midnight UTC). That is enough to try the receipt, not enough to farm the public demo. Need more? Use the paid `/task-request` path, or ping us before a heavy session and we will raise the ceiling.

**Hostname vs money.** `api.xfuel.app` is the public beta and settles **mainnet USDC**. A quote that looks like play money is not.

**`xfuel/auto` is not one price.** It resolves per request. Agent-shaped calls (tools, long loops) land on a different model than a five-word hello. Name a model from `GET /v1/models` if you need a price you can predict without quoting. Each model’s `pricing` block is on that list.

**Tool calls need a hub that supports them.** Today that is Akash, not Theta. A tool-carrying request that cannot be served fails with `tools_unsupported_on_hub` rather than a fake answer. A receipt always corresponds to work that ran.

**The first paid call has no settlement ref.** Rolling settlement collects the last call on the next request. Open the receipt: it should say **bill pending**, not look empty. The explorer link appears on the receipt that actually paid.

**On-chain proofs are opt-in.** The prover is live (`GET /health` → `proofs.settlement_proof: "open"`). A signed HMAC receipt is on every call. An SP1 proof is extra: pass `proof_tier: "settlement"` (+$0.08), or wait until a call’s provider cost is ≥ $2.00.

---

## If something fails

Read `error.code` before retrying.

| Code | What to do |
|------|------------|
| `401` / bad key | Use the partner key, `Authorization: Bearer …` or `X-API-Key`. |
| `model_retired` / `model_not_found` | Call `GET /v1/models`. Do not retry the same id. |
| `tools_unsupported_on_hub` | Drop tools, or let `xfuel/auto` pick a tool-capable route. Retrying the same hub will not help. |
| `no_provider_available` | Retry later — capacity, not your request. |
| `free_tier_exhausted` | Wait for UTC midnight, or ask us to raise the cap, or move that traffic to `/task-request`. |
| `402` on `/task-request` | Expected: pay the challenge (the previous call’s measured bill). |

A failed paid task is never answered with a mock. If it failed, nothing to attest ran.

---

## What we want from you in two weeks

Blunt is more useful than polite.

1. Did the base-URL swap take less than a day, including whatever was actually in your agent?
2. Is `verify_url` / the JSON receipt usable in *your* audit trail — or what is missing?
3. What would have to change for this to carry production volume?

Optional, if you are willing: two or three sentences we can paraphrase for diligence (attribution optional) — what you could not answer about agent spend before, and what changed.

Reply on the channel we invited you to. If a call is easier, say so.

---

## Further reading

| If you want… | Go here |
|--------------|---------|
| OpenAI surface | [OPENAI_COMPATIBLE_GATEWAY.md](./OPENAI_COMPATIBLE_GATEWAY.md) |
| Paid REST + quotes | [M2M_API.md](./M2M_API.md) |
| USDC / x402 | [X402_ADAPTER.md](./X402_ADAPTER.md) |
| TypeScript client | [packages/sdk/README.md](../packages/sdk/README.md) |
| Agent flows | [AGENT_PLAYBOOK.md](../packages/agent-skills/AGENT_PLAYBOOK.md) (start at Flow 0) |
| Receipt fields | [RECEIPT_SCHEMA_V2.md](./RECEIPT_SCHEMA_V2.md) |
| Hosted endpoint | [HOSTED_TESTNET_ENDPOINT.md](./HOSTED_TESTNET_ENDPOINT.md) |
