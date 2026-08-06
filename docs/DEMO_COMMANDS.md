# XFuel Demo Video — Commands

**Primary path for the video: the flagship SDK demo.** One script = pay → settle → SP1 proof → shareable receipt.

Public gateway: `https://api-testnet.xfuel.app`  
Verifier (Base mainnet): `0x9373499645292715a2275A78eD65B14215C41c06`  
Truth: [RUNTIME_STATE.md](./RUNTIME_STATE.md)

Curl / OpenAI one-shots are **optional B-roll** (appendix below). Do not make them the recording path.

---

## The demo (this is what you film)

### Preflight

```powershell
curl.exe -sS https://api-testnet.xfuel.app/health | python -m json.tool
```

Expect `"status": "ok"`.

Basescan (browser tab, keep open):

```text
https://basescan.org/address/0x9373499645292715a2275A78eD65B14215C41c06
```

### Run flagship

From repo root (PowerShell):

```powershell
cd packages/sdk
npx tsx examples/flagship-demo.ts
```

What it prints (film this):

1. Quote (USDC / network)
2. Pay + submit → `task_id`
3. Settle → status + proof outcome
4. SP1 proof → nullifier (polls briefly)
5. **Hero line:** one public `verify_url`

Open that URL in the browser → Tier-1 receipt; proof tier becomes `settlement` once the nullifier attaches. Then cut to Basescan verifier. Say the honesty line: *Money + proofs on Base mainnet (USDC via x402). Hostname is still api-testnet.*

### Live USDC vs dry run

| Mode | Setup | On camera |
|------|--------|-----------|
| **Dry run** | No payer key in env | Mock payer — still shows full receipt + proof flow; no real USDC moved |
| **Live payment** | Fund Base mainnet ETH + USDC; set key (see below) | Real x402 settle; receipt gets `payment.explorer_url` on Basescan |

```powershell
# Optional live payer (Base mainnet). Prefer repo-root .env.local DEPLOYER_* —
# flagship loads that automatically. Or:
$env:XFUEL_PAYER_PK = "0xYOUR_64_HEX_KEY"
# optional overrides:
# $env:XFUEL_API_URL = "https://api-testnet.xfuel.app"
# $env:XFUEL_API_KEY = "xfuel-demo"
```

### Recording tip

1. Pre-run once off-camera so you know a good `verify_url` / nullifier timing  
2. On camera: run flagship again (or reopen the pre-run receipt + Basescan)  
3. Keep terminal font large; don’t scroll the script source — only the output

That’s the whole A-take.

---

## Optional B-roll (not required)

Use only if you want a 2–3s cut of “same surface as OpenAI” or raw HTTP.

### OpenAI-compatible drop-in

```powershell
cd packages/sdk
npx tsx examples/openai-drop-in.ts
```

Honest note: on the public gateway this may show `provider: mock` / `proof: skipped` when no DePIN provider key is configured. Fine as a “swap the baseURL” beat — not your Tier-2 proof shot.

### Raw curl

Only if you insist. On PowerShell always use `curl.exe` (never bare `curl`), and put JSON in a file. Full recipes used to live here; prefer the SDK examples above so Windows escaping doesn’t eat the take.

---

## Quick links after flagship finishes

| What | Where |
|------|--------|
| Receipt (Tier-1 → Tier-2) | Printed `verify_url` |
| Proof JSON | `https://api-testnet.xfuel.app/prove-result?task_id={id}` (needs `X-API-Key: xfuel-demo`) |
| Verifier | https://basescan.org/address/0x9373499645292715a2275A78eD65B14215C41c06 |
| Payment tx | Receipt `payment.explorer_url` (Sepolia when live paid) |
