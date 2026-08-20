# Hosted endpoint

Public gateway: `https://api.xfuel.app`  
Demo key: `xfuel-demo` (rate-limited). Use the partner key if we sent you one.

Public beta. Payments on this host are **real USDC on Base mainnet.** Filename is historical.

**Try it:** [DESIGN_PARTNER_ONBOARDING.md](./DESIGN_PARTNER_ONBOARDING.md). That page is the working copy — do not start here and also there.

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
