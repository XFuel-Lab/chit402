# XFuel Demo Video — Script (60–90s)

Locked line: **Route any model. Prove every dollar.**  
As-deployed truth: [RUNTIME_STATE.md](./RUNTIME_STATE.md) · Messaging: [POSITIONING.md](./POSITIONING.md)

Companion docs: [DEMO_SHOT_LIST.md](./DEMO_SHOT_LIST.md) · [DEMO_COMMANDS.md](./DEMO_COMMANDS.md) · [`scripts/demo-ffmpeg.sh`](../scripts/demo-ffmpeg.sh)

---

## Recording Checklist (do this first)

- [ ] Gateway healthy: `curl.exe -sS https://api.xfuel.app/health` → `"status":"ok"`
- [ ] Pre-run once: `cd packages/sdk; npx tsx examples/flagship-demo.ts` — save the printed `verify_url` (and wait for nullifier if you want Tier-2 on the first take)
- [ ] Browser tabs: homepage · that receipt URL · Basescan verifier · (optional) Sepolia payment tx
- [ ] Terminal font large; film **flagship output**, not curl soup
- [ ] Mic check; speak at conversational pace (~140–150 wpm)
- [ ] Screen record 1080p / 30fps; leave 2–3s of silence at head and tail for edits
- [ ] Do **not** demo `zkgpt` mock or ZAN mock facilitator as live proofs
- [ ] Honesty line ready: *Money + proofs on Base mainnet (USDC via x402). Public beta at api.xfuel.app.*

---

## Suggested titles / description / hashtags

**YouTube title options**
1. XFuel in 90 Seconds — Route Any Model. Prove Every Dollar.
2. OpenAI-Compatible API → Signed Receipt → SP1 Proof on Base
3. Verifiable AI Compute Settlement (USDC + SP1) — XFuel Demo

**X / short title**
`XFuel: route any model. Prove every dollar. (90s)`

**Description (paste)**

```
XFuel settles AI compute in USDC via x402 on Base and returns tiered receipts:
Tier-1 signed → Tier-2 SP1 settlement proof → Tier-3 Verified Inference (active build).

In this demo:
• OpenAI-compatible / M2M task submit on the public test gateway
• Tier-1 signed receipt (route, cost, output hash)
• Tier-2 SP1 settlement proof (fees, binding, nullifier)
• ZKVerifierSP1 on Base mainnet: 0x9373499645292715a2275A78eD65B14215C41c06

Honest status (as of recording):
Proofs and payments live on Base mainnet (USDC via x402 / CDP).
Tier-2 attests settlement metadata + output commitment — not black-box model correctness.

Try it: https://api.xfuel.app
Docs: https://xfuel.app · https://github.com/seeharn/xfuel-protocol
Design partners: DM or email hello@xfuel.app

#AI #Agents #Base #x402 #USDC #ZK #SP1 #OpenAI #Web3 #Infra
```

**Hashtags (X)**  
`#AI #Agents #Base #x402 #USDC #ZK #SP1 #Builders`

---

## Runtime (spoken ≈ 75s · edit window 60–90s)

| Time | On screen | Voiceover (exact) |
|------|-----------|-------------------|
| **0:00–0:08** | Homepage hero (`xfuel.app`) or terminal title card: *Route any model. Prove every dollar.* | Agents are starting to spend money on their own. Today that means API keys and invoices you hope are honest. XFuel gives the agent a budget instead — and a receipt you can verify. |
| **0:08–0:22** | Terminal: run `npx tsx examples/flagship-demo.ts`. Highlight quote → pay+submit → `task_id`. | One call — pay, route, settle. Same budget model your agents need. No API-key handoff. |
| **0:22–0:38** | Browser: open printed `verify_url`. Circle Tier-1: route, model, amounts, signature / signed tier. | Here's the Tier-1 signed receipt — route, model, cost, and output hash. Default. Free. Shareable. No login. |
| **0:38–0:55** | Same terminal as proof/nullifier lines appear, or refresh receipt for tier `settlement`. | When it matters, we attach a Tier-2 SP1 settlement proof — fees, payment binding, output commitment, single-use nullifier. This proves settlement, not that a black-box model ran correctly. |
| **0:55–1:10** | Basescan: `https://basescan.org/address/0x9373499645292715a2275A78eD65B14215C41c06` — Contract / Read Contract. Optional cut: payment `explorer_url` from receipt (Base mainnet). | The verifier lives on Base mainnet — ZKVerifierSP1. Payments settle in USDC via x402 (CDP facilitator) on Base. |
| **1:10–1:20** | Split: receipt + Basescan, or docs CTA card. | Route any model. Prove every dollar. Try the demo at api.xfuel.app — docs on xfuel.app. Design partners: DM us. |

**Hard cut length:** drop the 0:00–0:08 opening metaphor if you need ≤60s; start on the curl and keep the honesty + CTA.

---

## Voiceover — continuous take (≈75 seconds)

> Agents are starting to spend money on their own. Today that means API keys and invoices you hope are honest. XFuel gives the agent a budget instead — and a receipt you can verify.
>
> One flagship call — pay, route, settle — and you get a task ID. Same budget model your agents need.
>
> Here's the Tier-1 signed receipt — route, model, cost, and output hash. Default. Free. Shareable. No login.
>
> When it matters, we attach a Tier-2 SP1 settlement proof — fees, payment binding, output commitment, single-use nullifier. This proves settlement, not that a black-box model ran correctly.
>
> The verifier lives on Base mainnet — ZKVerifierSP1. Proofs settle here. Payments settle in USDC via x402 on Base (CDP facilitator).
>
> Route any model. Prove every dollar. Try the demo at api.xfuel.app — docs on xfuel.app. Design partners: DM us.

**Word count:** ~175 · **Target pace:** ~140 wpm → ~75s spoken.

---

## Voiceover — timed to a real flagship take (~2:15+)

Your cut (as recorded): command starts **0:22** · receipt opens ~**1:30–1:36** · Basescan ~**2:05**.  
Tier-2 proving can eat a minute — lean into that; don’t pretend the receipt is instant.

**Suggestion:** start VO at **0:00** with a short hook over the cold open (homepage / idle terminal). If you prefer silence + music until the command, start spoken VO at **0:22** and drop the 0:00–0:21 lines.

| Video time | On screen (yours) | Say this |
|------------|-------------------|----------|
| **0:00–0:22** | Cold open (brand / idle) | *Optional cold open:* Agents are starting to spend on their own. Today that’s API keys and invoices you hope are honest. XFuel gives the agent a budget — and a receipt you can verify. |
| **0:22–0:45** | Run `flagship-demo` · quote / pay / submit | One flagship call. Quote in USDC, pay over x402, route, settle. Same budget model your agents need — no API-key handoff. |
| **0:45–1:28** | Terminal waiting / proving | Settlement’s done — now we’re waiting on the Tier-2 SP1 proof. That can take a bit. Worth it: fees, payment binding, output commitment, single-use nullifier. Proves settlement — not that a black-box model ran correctly. |
| **1:30–1:50** | Open receipt (~1:36) | Here’s the shareable receipt. Tier-1 signed fields — route, model, cost, output hash — plus the Tier-2 proof once it lands. No login. Anyone can open this link. |
| **1:50–2:05** | Scroll receipt / payment | Payments are USDC via x402 on Base mainnet. Proofs live on Base mainnet. |
| **2:05–2:20** | Basescan (verifier / output commitment) | ZKVerifierSP1 on Base mainnet — this is where settlement proofs anchor. Output commitment, nullifier, on-chain verify home. |
| **2:20–end** | CTA / end card | Route any model. Prove every dollar. Try flagship-demo from packages/sdk — or start at xfuel.app. Design partners: DM us. |

### Continuous take (aligned to the table; ~2:15 if you include the cold open)

> *(0:00)* Agents are starting to spend on their own. Today that’s API keys and invoices you hope are honest. XFuel gives the agent a budget — and a receipt you can verify.
>
> *(0:22)* One flagship call. Quote in USDC, pay over x402, route, settle. Same budget model your agents need — no API-key handoff.
>
> *(0:45)* Settlement’s done — now we’re waiting on the Tier-2 SP1 proof. That can take a bit. Worth it: fees, payment binding, output commitment, single-use nullifier. Proves settlement — not that a black-box model ran correctly.
>
> *(1:36)* Here’s the shareable receipt. Tier-1 signed fields — route, model, cost, output hash — plus the Tier-2 proof once it lands. No login. Anyone can open this link.
>
> *(1:50)* Payments are USDC via x402 on Base mainnet. Proofs live on Base mainnet.
>
> *(2:05)* ZKVerifierSP1 on Base mainnet — this is where settlement proofs anchor. Output commitment, nullifier, on-chain verify home.
>
> *(2:20)* Route any model. Prove every dollar. Try flagship-demo from packages/sdk — or start at xfuel.app. Design partners: DM us.

### Edit tips for this take

1. **Don’t fight the prove wait** — the 0:45–1:28 block is intentional filler that stays on-message.  
2. **Receipt line must land on ~1:36**, not earlier — mute/cut any old “here’s the receipt” if you recorded the 75s script.  
3. **Basescan at 2:05** = verifier + commitment beat; keep payment Sepolia honesty in the line before it.  
4. If final cut is longer than VO, hold last frame or soft music under CTA; if shorter, trim the prove-wait paragraph.

### Record VO (Windows)

1. Put the silent video somewhere easy, e.g. `C:\Users\seeha\Videos\xfuel-demo-silent.mp4`
2. Record mic to WAV/M4A (Voice Recorder, Audacity, or OBS). Aim for the full ~2:00; leave 0.5s silence at start/end.
3. Save as e.g. `C:\Users\seeha\Videos\xfuel-demo-vo.wav`

### Mux (PowerShell — needs `ffmpeg` on PATH)

```powershell
ffmpeg.exe -y `
  -i "C:\Users\seeha\Videos\xfuel-demo-silent.mp4" `
  -i "C:\Users\seeha\Videos\xfuel-demo-vo.wav" `
  -filter_complex "[0:v]scale=1920:1080:force_original_aspect_ratio=decrease,pad=1920:1080:(ow-iw)/2:(oh-ih)/2,fps=30,format=yuv420p[v];[1:a]loudnorm=I=-16:TP=-1.5:LRA=11,aformat=sample_fmts=fltp:sample_rates=48000:channel_layouts=stereo[a]" `
  -map "[v]" -map "[a]" `
  -c:v libx264 -profile:v high -preset slow -crf 18 -maxrate 12M -bufsize 24M `
  -c:a aac -b:a 192k -movflags +faststart `
  -shortest `
  "C:\Users\seeha\Videos\xfuel-demo-final.mp4"
```

`-shortest` ends when the shorter of video/audio ends — keep VO ≈ video length. If VO is short, re-record or drop `-shortest` and pad audio.

Optional soft music: use `scripts/demo-ffmpeg.sh` from Git Bash with `--music bed.mp3`.

---

## On-screen lower-thirds (optional burn-in)

| Cue | Text |
|-----|------|
| 0:08 | `flagship-demo.ts` · pay → prove → receipt |
| 0:22 | `Tier 1 — Signed receipt` |
| 0:38 | `Tier 2 — SP1 settlement proof` |
| 0:55 | `ZKVerifierSP1 · Base mainnet` |
| 1:05 | `Payments: Base mainnet (x402 USDC)` |
| 1:12 | `Try: api.xfuel.app` |

---

## What not to say

- Do not say Theta / EdgeCloud is the settlement home (optional GPU provider only).
- Do not say every task is ZK-proven by default without showing Tier-2.
- Do not claim Tier-2 proves black-box LLM correctness.
- Do not imply USDC/x402 is live on Base **mainnet** — say Sepolia for payments, mainnet for the verifier.
- Do not present regenerable / mock proofs as production.

---

## CTA variants (pick one ending)

1. **Builder:** “Clone the SDK, point `baseURL` at api.xfuel.app, and open the receipt.”
2. **Design partner:** “Building agent payments or verifiable compute? DM us — we’re onboarding design partners.”
3. **Docs:** “Full API, OpenAI drop-in, and runtime state linked in the description.”
