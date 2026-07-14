# XFuel Flagship Demo — pay → infer → prove → one shareable receipt

> **The whole value proposition in one runnable script and one link.**
> An agent pays for a verifiable inference task in USDC over x402, the task settles
> with an on-chain SP1 settlement proof, and you get **one public, no-auth `verify_url`**
> that renders the route, the payment (with a block-explorer link), the proof status,
> and an *independent* re-derivation of the x402 payment binding. No login. No trust-me.

Source: [`sdk/js/examples/flagship-demo.ts`](../sdk/js/examples/flagship-demo.ts)

---

## TL;DR

```bash
cd sdk/js
npm install
npm run example:demo          # dry run with a mock payer (no real funds)
```

The script prints a numbered walkthrough and ends with the hero:

```
  ────────────────────────────────────────────────────────────────
  ✔ Done. One shareable, public proof link:

      https://api-testnet.xfuel.app/receipt/openai-1a2b3c…

      Open it: route, payment (+ block-explorer link), proof status,
      and an independent payment-binding check — no login, no trust-me.
  ────────────────────────────────────────────────────────────────
```

Open that URL (or send it to anyone) to see the full settlement story.

---

## What it demonstrates

| Step | Call | What happens |
|------|------|--------------|
| ① Quote | `client.quoteTask()` | Preview per-rail pricing (no side effects). |
| ② Pay + submit | `client.submitInference(…, { payer })` | Submit the task; the agent-side payer runs the x402 `402 → pay → retry` handshake automatically. |
| ③ Settle | `client.waitForCompletion()` | Poll until the task reaches a terminal state. |
| ④ Proof | `client.getProof()` | Fetch the SP1 settlement proof (nullifier, proving time). |
| ⑤ Binding | (from the proof) | The Phase-2 x402 payment commitment binding the payment to this exact task. |
| **Hero** | `task.verify_url` | One public link to the receipt explorer. |

**What the proof attests:** correct fee split + payment binding + a commitment to the
output hash, anchored on-chain with a single-use nullifier. **What it does NOT attest:**
that a black-box provider ran the model correctly — that is Tier-2 proof-of-inference
(zkGPT, roadmap). We are precise about this on purpose.

---

## Run modes

### 1. Dry run (mock payer) — works anywhere, no funds

```bash
cd sdk/js
npm run example:demo
```

Uses `createMockPayer()` — no real USDC moves. Great for a first look and for CI.

### 2. Real USDC on Base (agent signs EIP-3009)

```bash
cd sdk/js
XFUEL_PAYER_PK=0x<funded-base-key> \
XFUEL_SENDER=0x<your-address> \
npm run example:demo
```

The payer signs an EIP-3009 `transferWithAuthorization` against the x402 challenge —
no server-side keys, wallet-as-identity.

### 3. Fully local end-to-end (mock facilitator + mock prover)

Prove the *entire* loop green on your machine before touching a live endpoint.

```bash
# Terminal A — x402 mock facilitator
cd backend/theta-bridge
node src/x402-mock-facilitator.js            # :8402

# Terminal B — mock SP1 prover
node scripts/mock-prover-server.js --port 8097

# Terminal C — the bridge/API server (file-backed store; leave REDIS_URL unset)
X402_ENABLED=true \
X402_PROOF_BINDING=true \
ZAN_X402_GATEWAY_URL=http://127.0.0.1:8402 ZAN_X402_API_KEY=dev \
X402_PAY_TO=0x000000000000000000000000000000000000cafe \
SP1_PROVER_URL=http://127.0.0.1:8097 \
node src/server.js                           # :3002

# Terminal D — run the demo against local
cd ../../sdk/js
XFUEL_API_URL=http://localhost:3002 \
XFUEL_SENDER=0x000000000000000000000000000000000000dEaD \
npm run example:demo
```

Now the printed `verify_url` (`http://localhost:3002/receipt/…`) is live — open it in a browser.

---

## Environment variables

| Var | Default | Purpose |
|-----|---------|---------|
| `XFUEL_API_URL` | `https://api-testnet.xfuel.app` | Target endpoint. |
| `XFUEL_API_KEY` | *(none)* | API key if the endpoint requires one. |
| `XFUEL_SENDER` | `0x…dEaD` | The submitting agent address. |
| `XFUEL_MODEL` | `llama-3-70b` | Model to route. |
| `XFUEL_AMOUNT` | `1000000` | Gross task value in base units (min `10000`). |
| `XFUEL_PAYER_PK` | *(none)* | Base private key → signs real USDC EIP-3009; omit for a mock payer. |

---

## Note on the public link

The hosted testnet (`api-testnet.xfuel.app`) serves the public `/receipt/:id` page and
echoes `verify_url` **once merged `main` is deployed**. Until then, run mode #3 (fully
local) to see the receipt render live, or point `XFUEL_API_URL` at any endpoint running
current `main`.
