# Hosted endpoint

Public gateway: `https://api.xfuel.app`  
Alias (same box): `https://api-testnet.xfuel.app`  
Demo key: `xfuel-demo` (rate-limited). Use the partner key if we sent you one.

This is the **public beta**. Payments on this host are **real USDC on Base mainnet.**

Cutover / DNS / TLS (founder): [API_HOSTNAME.md](./API_HOSTNAME.md).

**Try it:** [DESIGN_PARTNER_ONBOARDING.md](./DESIGN_PARTNER_ONBOARDING.md) — OpenAI `baseURL` swap, receipt, paid path. Do not start here and also there; that page is the working copy.

```powershell
curl.exe -sS https://api.xfuel.app/health
```

macOS / Linux: `curl` is fine. PowerShell must use `curl.exe`.

Live truth: [RUNTIME_STATE.md](./RUNTIME_STATE.md).  
OpenAI surface: [OPENAI_COMPATIBLE_GATEWAY.md](./OPENAI_COMPATIBLE_GATEWAY.md).  
Paid REST: [M2M_API.md](./M2M_API.md).  
Flagship script (paid path): `packages/sdk/examples/flagship-demo.ts`.

Local: `cd services/gateway && npm run m2m-server` → `http://localhost:3002`.

Video package (recording, not the partner path): [DEMO_VIDEO_SCRIPT.md](./DEMO_VIDEO_SCRIPT.md) · [DEMO_SHOT_LIST.md](./DEMO_SHOT_LIST.md) · [DEMO_COMMANDS.md](./DEMO_COMMANDS.md).
