# Hosted Testnet Endpoint — Deploy Runbook

Stands up **`https://api-testnet.xfuel.app`**: the XFuel M2M API + OpenAI-compatible
gateway, with a shared, rate-limited **public demo key** so the SDK and any OpenAI
client work out of the box.

- Server: `backend/theta-bridge/src/server.js` (M2M + `/v1/*`), port **3002**.
- Env template: [`backend/theta-bridge/.env.testnet-demo.example`](../backend/theta-bridge/.env.testnet-demo.example)
- SDK default now points here (`DEFAULT_BASE_URL`, `PUBLIC_DEMO_API_KEY = "xfuel-demo"`).

> Target: an existing VPS/host we already run. The server is long-lived (Express +
> WebSocket listeners), so run it as a managed process behind a TLS reverse proxy —
> not on Vercel serverless.

---

## 1. Configure

```bash
cd backend/theta-bridge
cp .env.testnet-demo.example .env
# edit .env: set M2M_API_KEYS (a real private key), THETA_EDGECLOUD_API_KEY (real
# compute), optionally SP1_PROVER_URL (settlement proofs). Keep M2M_DEMO_MODE=true.
npm ci
```

The demo key **must** stay `xfuel-demo` to match the SDK default (or change both).

## 2. Run as a managed process

**systemd** (`/etc/systemd/system/xfuel-testnet-api.service`):

```ini
[Unit]
Description=XFuel Testnet M2M + OpenAI API
After=network.target

[Service]
Type=simple
WorkingDirectory=/opt/xfuel-protocol/backend/theta-bridge
ExecStart=/usr/bin/npm run m2m-server
EnvironmentFile=/opt/xfuel-protocol/backend/theta-bridge/.env
Restart=always
RestartSec=5
User=xfuel

[Install]
WantedBy=multi-user.target
```

```bash
sudo systemctl daemon-reload && sudo systemctl enable --now xfuel-testnet-api
```

(or `pm2 start "npm run m2m-server" --name xfuel-testnet-api` if you use pm2.)

## 3. DNS + TLS reverse proxy

Point `api-testnet.xfuel.app` at the host (A/AAAA or CNAME), then terminate TLS
with **Caddy** (auto HTTPS):

```
api-testnet.xfuel.app {
    reverse_proxy 127.0.0.1:3002
}
```

`caddy reload`. (nginx + certbot works equally well — proxy to `127.0.0.1:3002`.)

> **Gotcha — trust the proxy or all demo users share one bucket.** Behind Caddy/nginx,
> `req.ip` is the proxy's loopback address, so the per-IP demo limiter would throttle
> *every* client together (a global 15/min). Set **`M2M_TRUST_PROXY=true`** (in `.env`)
> so Express reads `X-Forwarded-For` and per-IP limiting works. Use a hop count
> (e.g. `M2M_TRUST_PROXY=1`) or a subnet string if you chain proxies. This is already
> in the env template.

> **Gotcha — CORS for browser clients.** Server-side agents don't need CORS, but a
> browser playground / web app calling `/v1/*` will be blocked by the same-origin
> policy. Set **`M2M_CORS_ORIGIN`** (e.g. `*` for the open demo, or a specific origin)
> to emit the `Access-Control-*` headers (incl. exposing the `x-xfuel-*` receipt
> headers). Off by default.

## 4. Smoke test

```bash
# health (note the "demo" block with the advertised limits)
curl https://api-testnet.xfuel.app/health

# OpenAI drop-in (Bearer == the public demo key)
curl https://api-testnet.xfuel.app/v1/chat/completions \
  -H "Authorization: Bearer xfuel-demo" -H "Content-Type: application/json" \
  -d '{"model":"llama-3-70b","messages":[{"role":"user","content":"Explain ZK proofs in one sentence."}]}' \
  -i    # -i to see the x-xfuel-* receipt headers

# SDK (zero-config → hits this endpoint with the demo key)
XFUEL_API_URL=https://api-testnet.xfuel.app npm --prefix sdk/js run example:openai
```

## 5. Demo limits & cost control

| Control | Value | Env |
|---------|-------|-----|
| Rate (per IP) | 15/min, 150/day | `M2M_DEMO_RATE_PER_MIN`, `M2M_DEMO_RATE_PER_DAY` |
| Generation cap | `max_tokens` ≤ 512 | `OPENAI_GATEWAY_MAX_TOKENS_CAP` |
| Real vs mock | real if `THETA_EDGECLOUD_API_KEY` set, else labelled mock | `THETA_EDGECLOUD_API_KEY` |

Private keys in `M2M_API_KEYS` bypass the demo limits (normal limiter). If GPU
spend spikes, drop `THETA_EDGECLOUD_API_KEY` to fall back to mock instantly (the
receipt then reports `compute.real=false`).

## Gotchas / notes (from building this)

- **`M2M_TRUST_PROXY`** — required behind a reverse proxy, or per-IP demo limits
  collapse into a single shared bucket. See §3.
- **`M2M_CORS_ORIGIN`** — set it if browser clients (a playground/web app) must call
  `/v1/*`; server-side agents don't need it. See §3.
- **dotenv precedence** — the process loads `.env` but does **not** override variables
  already present in the real environment. `systemd`'s `EnvironmentFile` and shell
  exports win over `.env`. Put demo config in one place to avoid confusion.
- **`M2M_API_KEYS` gates demo mode's usefulness** — if it's empty the server is in
  *open mode* (any/no key accepted) and the demo throttle never engages. Always set at
  least one private key so unauthenticated traffic falls back to the rate-limited demo
  key. (`GET /health` → `demo` block confirms limits are active.)
- **Real inference** needs the repo-root `circuits/` reachable from the process (it is,
  when running from a full checkout). The existing `Dockerfile` copies only a local
  `circuits/` and runs `src/index.js`; a dedicated API image (correct entrypoint +
  repo-root build context) is a follow-up if you containerize this later.
- **`Redis` is optional** for the demo; the server runs without it.
- **`/llms.txt`** is served publicly (no auth) at the root for agent discovery — verify
  with `curl https://api-testnet.xfuel.app/llms.txt`.
