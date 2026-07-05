# Benchmark Runbook — PowerZebra vs CUDA (Beginner-Friendly)

This is a **step-by-step checklist**, written for someone who is not an infrastructure
person. No environment-variable juggling, no long commands to memorize — just copy a
file, fill in a couple of lines, and run three `npm` commands.

If you want the deep technical background (why we're doing this, the raw data, the
architecture), see [`docs/BENCHMARK_POWERZEBRA.md`](./BENCHMARK_POWERZEBRA.md). This
runbook is the "just tell me what to click/type" version.

---

## What you're doing, in one sentence

We're comparing how fast our **current prover** (CUDA, on Theta EdgeCloud) is against
ZAN's **PowerZebra** prover, using the exact same test data, so we can decide whether to
switch. Nothing on-chain changes either way — this is purely a speed/cost test.

---

## 0. Before ZAN gives you access (do this now, takes 2 minutes)

1. Open a terminal and go to the benchmark folder:

   ```powershell
   cd backend/theta-bridge
   ```

2. Copy the settings template:

   ```powershell
   Copy-Item .env.benchmark.example .env.benchmark
   ```

   (Mac/Linux: `cp .env.benchmark.example .env.benchmark`)

3. Open the new file `backend/theta-bridge/.env.benchmark` in any text editor (Notepad,
   VS Code, Cursor — anything). Fill in the **CUDA** section now, since we already have
   that:

   ```
   BENCHMARK_CUDA_URL=https://<the current SP1 prover URL>
   BENCHMARK_CUDA_COST_PER_HOUR=2.50
   ```

   > Don't know the current URL? Look at `SP1_PROVER_URL` in
   > `backend/theta-bridge/.env` (or ask whoever manages the prover). If you truly can't
   > find it, leave it blank for now — you can fill it in Monday too.

4. Leave the **ZAN** section blank for now:

   ```
   BENCHMARK_ZAN_URL=
   BENCHMARK_ZAN_API_KEY=
   BENCHMARK_ZAN_COST_PER_HOUR=
   ```

That's it. `.env.benchmark` is private to your machine (it's git-ignored) — it's safe to
put real keys in it.

---

## 1. Monday: once ZAN gives you access

ZAN will give you two things:
- A **URL** (something like `https://xxxxx.zan.top` or an IP address with a port)
- An **API key**

Open `backend/theta-bridge/.env.benchmark` again and fill in the ZAN section:

```
BENCHMARK_ZAN_URL=https://<the URL ZAN gave you>
BENCHMARK_ZAN_API_KEY=<the API key ZAN gave you>
BENCHMARK_ZAN_COST_PER_HOUR=<optional — the $/hour ZAN quoted you, if any>
```

Save the file. You're ready.

---

## 2. Run the benchmark (3 commands, in order)

Open a terminal in `backend/theta-bridge` and run these **one at a time**, waiting for
each to finish (each takes 1-3 minutes):

```powershell
cd backend/theta-bridge

# Step 1 — measure the CURRENT prover (CUDA)
npm run benchmark:cuda

# Step 2 — measure ZAN PowerZebra
npm run benchmark:zan

# Step 3 — generate the comparison report
npm run benchmark:compare
```

That's the entire process. When it's done, open:

```
backend/theta-bridge/bench/comparison.md
```

This file has a table showing how much faster (or slower) PowerZebra is, and the cost
difference per proof. Send that file to whoever needs the results — no further
processing needed.

### What "switching between CUDA and ZAN mode" means here

You are **not** flipping a switch in the app — you're just running two separate
measurement commands (`benchmark:cuda` then `benchmark:zan`). Each one reads its own
URL from `.env.benchmark`, so there's nothing else to toggle. Run them in either order;
just run `benchmark:compare` last (it needs both results to exist).

---

## 3. Reading the report

`bench/comparison.md` looks like this:

```
| Metric                      | Baseline | Candidate | Δ              |
|------------------------------|----------|-----------|----------------|
| GPU time (avg)                | 520ms    | 105ms     | 4.95x better   |
| GPU time (p95)                | 556ms    | 113ms     | 4.92x better   |
| Effective ms/deposit (avg)    | 520ms    | 105ms     | 4.95x better   |
| Round-trip (avg)              | 533ms    | 117ms     | 4.56x better   |
| Cost per proof                | $0.00036 | $0.00007  | 4.95x cheaper  |
```

- **Baseline** = current CUDA prover. **Candidate** = ZAN PowerZebra.
- **"X better"** means the candidate (ZAN) is faster/cheaper by that multiple.
- **"X worse"** means ZAN is slower/more expensive — that's a valid, useful result too.
- If the **Cost per proof** row says `n/a`, it means one of the two `_COST_PER_HOUR`
  values wasn't filled in — the report still works, you just won't see a $ comparison.

You don't need to interpret anything further — the headline sentence at the bottom of
the report already states the overall verdict in plain English.

---

## 4. Common issues and how to fix them

| Problem | What it means | Fix |
|---|---|---|
| `No prover URL configured for "zan" mode` | `.env.benchmark` is missing `BENCHMARK_ZAN_URL` | Open `.env.benchmark`, fill in the line, save, re-run the command |
| `No prover URL configured for "cuda" mode` | Same, but for `BENCHMARK_CUDA_URL` | Same fix, CUDA line instead |
| `HTTP 401` errors during the ZAN run | The API key is missing or wrong | Double-check `BENCHMARK_ZAN_API_KEY` in `.env.benchmark` — copy-paste it fresh from ZAN's email/dashboard (watch for extra spaces) |
| `WARNING: Health check failed` | The URL is unreachable (typo, VPN needed, server not up yet) | Confirm the URL opens in a browser or `curl <url>/healthz`; ask ZAN if the host needs a VPN or IP allowlist |
| Command hangs for a long time | Real GPU proofs can take seconds each — this is normal, not frozen | Wait; each run does ~60 proofs, so a few minutes is expected. If it's stuck for 10+ minutes with no dots printing, press `Ctrl+C` and re-run |
| `benchmark:compare` says a file is missing | You haven't run `benchmark:cuda` and/or `benchmark:zan` yet, or an earlier run failed | Run the missing step(s) first, then re-run `npm run benchmark:compare` |
| Numbers look identical to a previous test | You're accidentally still pointed at the mock/practice server | Check `.env.benchmark` — the URL should be the real ZAN/CUDA host, not `127.0.0.1` |
| Weird `Δ` character shows as `?` or boxes in the terminal | Just a terminal display quirk (encoding) | Ignore it — open `bench/comparison.md` in a text editor or Cursor; the file itself is correct UTF-8 |

If something isn't covered here, paste the exact error message to whoever is helping
you (or back into this chat) — the wrapper scripts print clear, specific error
messages on purpose.

---

## 5. (Optional) Practice run before Monday — no ZAN needed

If you want to rehearse the whole process without waiting for ZAN, you can practice
against two fake ("simulated") prover servers included in the repo. This lets you
confirm the 3 commands work on your machine ahead of time.

Open **three separate terminals**, all in `backend/theta-bridge`:

```powershell
# Terminal 1 — fake CUDA prover
npm run benchmark:mock:cuda

# Terminal 2 — fake ZAN prover
npm run benchmark:mock:zan
```

In a **third terminal**, temporarily point `.env.benchmark` at the fake servers:

```
BENCHMARK_CUDA_URL=http://127.0.0.1:8091
BENCHMARK_ZAN_URL=http://127.0.0.1:8092
BENCHMARK_ZAN_API_KEY=
```

Then run the same 3 commands from Step 2 above. You'll get a real `comparison.md` —
just remember the numbers are **fake** (simulated timing), and to put the **real** ZAN
URL/key back into `.env.benchmark` before Monday's real run.

> Stop the two practice servers with `Ctrl+C` in their terminals when you're done.

---

## 6. What happens after the report

Once you have `bench/comparison.md` with real numbers, share it — the decision rule is
already documented in [`docs/BENCHMARK_POWERZEBRA.md` §7](./BENCHMARK_POWERZEBRA.md#7-decision-gate--next-step):
if PowerZebra is meaningfully faster/cheaper, we wire it in behind a flag
(`SP1_PROVER=zan`) with automatic fallback to CUDA — no code changes needed to test
this further, it's already built.

---

## Summary: automated vs. manual

| | |
|---|---|
| **Automated (scripted, one command each)** | Running the benchmark (`npm run benchmark:cuda` / `benchmark:zan`), generating the comparison report (`npm run benchmark:compare`), health checks, warm-up, stats (min/avg/p95), CSV + JSON output, cost-per-proof math |
| **Manual (you still have to do this)** | Getting the ZAN URL + API key from ZAN, pasting them into `.env.benchmark`, deciding whether the result is "good enough" to switch, and (if yes) telling engineering to flip `SP1_PROVER=zan` in the real backend config |

That's the whole job: **fill in one file, run three commands, read one report.**
