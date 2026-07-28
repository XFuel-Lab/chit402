# XFuel Demo Video — Shot List

Pair with [DEMO_VIDEO_SCRIPT.md](./DEMO_VIDEO_SCRIPT.md) and [DEMO_COMMANDS.md](./DEMO_COMMANDS.md).

Runtime truth: [RUNTIME_STATE.md](./RUNTIME_STATE.md).

**Film the flagship demo.** Not curl.

---

## Window layout (1080p)

```
┌─────────────────────────────┬────────────────────────────┐
│  A · Browser (2/3 width)    │  B · Terminal (1/3)        │
│  Tabs: Home · Receipt ·     │  Large font                │
│  Basescan                   │  flagship output only      │
└─────────────────────────────┴────────────────────────────┘
```

**Cleaner:** full-screen terminal for flagship → cut to full-screen browser for receipt + Basescan.

---

## Pre-load

| Tab | URL |
|-----|-----|
| 1 Home | https://xfuel.app |
| 2 Receipt | `verify_url` from flagship pre-run |
| 3 Verifier | https://basescan.org/address/0x9373499645292715a2275A78eD65B14215C41c06 |
| 4 Payment (opt.) | Sepolia tx from receipt `payment.explorer_url` |

```powershell
cd packages/sdk
npx tsx examples/flagship-demo.ts
```

---

## Shot-by-shot

| Time | Shot | Action | Circle |
|------|------|--------|--------|
| 0:00–0:08 | Hook | Homepage brand + tagline | Brand only |
| 0:08–0:22 | Flagship | Run the one command; steps ①–③ | Quote · task · rail |
| 0:22–0:38 | Tier-1 | Open `verify_url` | Route · amounts · signed |
| 0:38–0:55 | Tier-2 | Nullifier line / receipt tier `settlement` | Nullifier · fees |
| 0:55–1:10 | Verifier | Basescan `ZKVerifierSP1` (+ optional Sepolia pay tx) | Address · Base |
| 1:10–1:20 | CTA | End card | `api-testnet.xfuel.app` |

---

## Contingency

| Problem | Fix |
|---------|-----|
| Proof still proving | Show Tier-1 receipt; cut to pre-run that already has nullifier |
| No payment_ref | Dry-run / mock payer — still honest; or fund Sepolia for live pay |
| Rate limit | Use pre-run receipt |

---

## Capture

1080p · 30fps · cursor on · webcam off · separate mic · soft music −18 to −22 LUFS under VO.
