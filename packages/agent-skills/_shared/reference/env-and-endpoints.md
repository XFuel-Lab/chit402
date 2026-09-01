# XFuel Skills — Environment & Endpoints Reference

Progressive-disclosure reference for all XFuel skills. Skills point here instead
of duplicating config details.

## Required environment

| Variable | Purpose | Default |
|----------|---------|---------|
| `XFUEL_API_URL` | Base URL of the M2M API server | `https://api.xfuel.app` (public beta; `http://localhost:3002` to self-host) |
| `XFUEL_API_KEY` | M2M API key (sent as `X-API-Key`) | `xfuel-demo` (shared public demo key, rate-limited; bring your own for higher limits) |

The SDK defaults to `https://api.xfuel.app` + the public demo key, so
`new XFuelClient()` works with zero config. The chat-completions surface
(`GET /v1/models`, `POST /v1/chat/completions`) lives on the same server.

## Optional environment (on-chain reads)

| Variable | Purpose |
|----------|---------|
| `THETA_RPC_URL` | Theta ETH-RPC adaptor for on-chain verification. Use a Theta endpoint — mainnet `https://eth-rpc-api.thetatoken.org/rpc` (361) or testnet `https://eth-rpc-api-testnet.thetatoken.org/rpc` (365), or a dedicated Theta node. **Not ZAN** — ZAN Node Service does not serve Theta RPC (it covers EVM chains like Ethereum/Base/BSC/Polygon, which XFuel uses for the x402/Base and Hyperlane legs). |
| `ZK_VERIFIER_ADDRESS` | `ZKVerifierSP1` address (for nullifier checks) — see `deploy/manifests/` |
| `A2A_CIRCUIT_ADDRESS` | `A2ACircuit` address (for bid/settle) — see `deploy/manifests/` |
| `VE_GOVERNANCE_ADDRESS` | `veXFGovernance` address (for voting-power reads) — see `deploy/manifests/` |

## Endpoints (see `m2m-openapi.yaml` for full schemas)

| Method | Path | Skill |
|--------|------|-------|
| POST | `/task-request` | xfuel-submit-inference |
| POST | `/task-quote` | xfuel-route-compute (cost preview), xfuel-submit-inference |
| GET | `/task-status?task_id=` | xfuel-submit-inference, xfuel-verify-proof |
| GET | `/prove-result?task_id=` | xfuel-verify-proof |
| POST | `/a2a-message` | xfuel-a2a-bid |
| POST | `/a2a-settle-fair-exchange` | xfuel-a2a-bid |
| PUT/GET/DELETE | `/webhook` | (event subscription) |
| GET | `/health` | (diagnostics; includes `demo` limits when demo mode is on) |
| GET | `/v1/models` | Model list (chat-completions format) |
| POST | `/v1/chat/completions` | Chat completions (streaming + non-streaming) |

## Conventions

- **Amounts** are USDC 6-decimal strings (`10000` = $0.01), not wei. Minimum task amount is `10000`.
- **Settlement home**: `chain_id: "base"` is the default settlement/routing home (USDC via x402; ADR 0002). `theta`, `akash`, `bittensor`, etc. are routing hints.
- **Fees**: 50–100 bps (default 50 = 0.5%). Token-light: the protocol USDC fee lands at **one Base address** (`X402_PAY_TO` / Splits; ADR 0001). The legacy `CoreRevenueSplitter` 30/30/25/15 split is **deprecated** from the fee path.
- **Proof systems**: `sp1` (default) or `zkgpt`. The `proof_system` in a status
  response is authoritative (the backend may fall back to SP1 if zkGPT is unset).
- **Webhook signature**: `X-XFuel-Signature: sha256=<hmac>`, HMAC-SHA256 over the
  raw JSON body keyed by the webhook secret (or `WEBHOOK_SECRET`).
- **Auth**: `X-API-Key` header, or relayer ECDSA signature (`X-Signature` +
  `X-Sig-Timestamp`).

## Payment rails (USDC via x402 default; TFUEL secondary)

- Payment-bearing skills accept a `payment` object (`{ rail: 'usdc' | 'tfuel', ... }`).
  **USDC via x402 (on Base) is the default/recommended rail**; **TFUEL on Theta** is
  the secondary rail. When `payment` is omitted, the server `X402_DEFAULT_RAIL` applies.
- The server-side 402 handshake is **live on the public host** (`X402_ENABLED=true`,
  `X402_FACILITATOR_PROVIDER=cdp`, `X402_NETWORK=base`).
  See [`docs/RUNTIME_STATE.md`](../../../../docs/RUNTIME_STATE.md) for as-deployed config.
- **Agent side:** an unpaid `usdc` request gets a `402` challenge; retry with the
  `X-PAYMENT` header (+ `X-PAYMENT-NONCE` echoing `accepts[].extra.nonce`). The payer is
  **pluggable and agent-side** — skills/SDK never hold private keys.
- Responses (`/task-request` 202, `/task-status`, `TaskSettled` webhook) expose
  `payment_rail` and `payment_ref`. **Trust `payment_rail`** for what actually settled.
- Full detail: [`payments-x402.md`](./payments-x402.md).

## SDK

Skills SHOULD use the JS SDK (`xfuel-sdk`, see `packages/sdk/`) rather than raw fetch:

```js
import { XFuelClient } from 'xfuel-sdk';
const client = new XFuelClient({ baseUrl: process.env.XFUEL_API_URL, apiKey: process.env.XFUEL_API_KEY });
```

Secrets policy: skills are REST-only and never hold private keys. On-chain signing
(bids, settlement, governance) is performed server-side by the relayer.
