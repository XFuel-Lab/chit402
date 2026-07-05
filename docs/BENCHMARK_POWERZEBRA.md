# PowerZebra Benchmark — Setup, A/B Harness & Initial Findings

Goal: quantify **ZAN PowerZebra** (GPU/FPGA ZK acceleration) against XFuel's **current
CUDA prover** (Theta EdgeCloud SP1 host) so we can decide whether to wire it in behind
a flag + fallback. This doc is the technical reference + the initial data.

> **Looking for the simple step-by-step version?** See
> [`docs/BENCHMARK_RUNBOOK.md`](./BENCHMARK_RUNBOOK.md) — a beginner-friendly checklist
> with copy-paste `npm run benchmark:cuda` / `benchmark:zan` / `benchmark:compare`
> commands that wrap everything in §3 below. This document remains the deep-dive
> reference (architecture, raw commands, gotchas, decision gate).

> **TL;DR status (2026-07):** PowerZebra is **⛔ procurement-blocked** (Contact-Us on
> zan.top — no GPU endpoint provisioned yet), and this workstation has **no NVIDIA GPU
> and no SP1 toolchain** (`cargo prove` absent). So a *real* ZAN-GPU-vs-CUDA run cannot
> be executed here today. What we did instead: **hardened + fully validated the A/B
> pipeline end-to-end** (harness → summary → comparator) using a protocol-accurate mock
> prover, and pre-computed the projection + exact real-run commands so the measured A/B
> is a copy-paste away the moment a ZAN GPU host exists. See §4 (measured pipeline
> validation) and §5 (projection).

---

## 1. What "current CUDA prover" means here

XFuel's production prover is the **SP1 host on Theta EdgeCloud (CUDA GPU)** — the
primary in `backend/theta-bridge/src/sp1-prover-client.js` (`SP1_PROVER_URL`), with an
optional Succinct-network fallback (`SP1_FALLBACK_URL`). Reference points on record:

| Source | Config | Proving time |
|--------|--------|--------------|
| `sp1-prover/README.md` | GPU RTX 4090 (CUDA), single | ~0.5 s |
| `sp1-prover/README.md` | CPU i9-13900K, single | ~2.5 s |
| `sp1-prover/BENCHMARK_RESULTS_PHASE1.md` | Succinct network, single | ~26.7 s |
| `sp1-prover/BENCHMARK_RESULTS_PHASE1.md` | Succinct network, batch-10 | ~2.3 s/deposit |

These are the control numbers to **re-measure freshly** on the live EdgeCloud CUDA host
before the PowerZebra A/B (don't trust stale numbers across SDK versions).

PowerZebra is **prover-side only** — `ZKVerifierSP1.sol` verifies Groth16/PLONK and is
proof-system-agnostic, so **on-chain gas and the audit scope are unchanged**. That makes
this a pure latency/cost/throughput comparison.

---

## 2. The A/B harness (already in-repo)

| Piece | Path | Role |
|-------|------|------|
| Beginner wrapper | `backend/theta-bridge/scripts/run-benchmark.mjs` (npm: `benchmark:cuda` / `benchmark:zan` / `benchmark:compare`) | Reads URLs/keys from `backend/theta-bridge/.env.benchmark` (copy from `.env.benchmark.example`) and calls the driver + comparator below with sane defaults and fixed output filenames. See [`docs/BENCHMARK_RUNBOOK.md`](./BENCHMARK_RUNBOOK.md). |
| Benchmark driver | `backend/theta-bridge/scripts/benchmark-prover.js` | Warm-up + sequential + concurrent proofs; emits stats, CSV, and a machine-readable `*.summary.json` (incl. `cost_per_proof_usd` when `--cost-per-hour` is given). |
| Comparator | `scripts/compare-benchmarks.cjs` | Diffs two `summary.json` files → markdown before/after table with speedup + cost Δ. |
| Mock prover | `backend/theta-bridge/scripts/mock-prover-server.js` (npm: `benchmark:mock:cuda` / `benchmark:mock:zan`) | **SIMULATED** prover speaking the exact wire contract (`/healthz`, `/metrics`, `/prove`, `/prove/binary` bincode). For pipeline validation + dry-runs only. |
| Workload | `sp1-prover/test-data/deposit-1tfuel.json` | The proof input (batchable via `--batch N`). |

The driver reads `SP1_PROVER_URL` and hits `/prove/binary` (falls back to `/prove`),
so **the same command works against any prover** — EdgeCloud, a ZAN GPU host, or the
mock. That's the whole point: one harness, swap the URL.

---

## 3. Running the REAL A/B (once a ZAN GPU host is provisioned)

**Simplest path:** fill in `backend/theta-bridge/.env.benchmark` (copy from
`.env.benchmark.example`) with `BENCHMARK_CUDA_URL` / `BENCHMARK_ZAN_URL` /
`BENCHMARK_ZAN_API_KEY`, then run `npm run benchmark:cuda`, `npm run benchmark:zan`,
`npm run benchmark:compare` from `backend/theta-bridge`. That's a thin wrapper around
the exact commands below (fixed `--label`/`--csv`/`--summary` paths under `bench/`) —
see [`docs/BENCHMARK_RUNBOOK.md`](./BENCHMARK_RUNBOOK.md) for the full walkthrough.

**Manual/advanced path** (full control over flags, e.g. custom `--sequential`/`--batch`
counts or one-off runs without touching `.env.benchmark`):

```bash
cd backend/theta-bridge
mkdir -p bench

# (A) Baseline = current CUDA prover (Theta EdgeCloud SP1 host)
SP1_PROVER_URL="https://<edgecloud-sp1-host>" \
  node scripts/benchmark-prover.js \
  --sequential 50 --concurrent 10 --batch 1 \
  --label edgecloud-cuda --cost-per-hour <USD_PER_GPU_HR> \
  --csv bench/cuda.csv --summary bench/cuda.summary.json

# (B) Candidate = same SP1 host deployed on a ZAN PowerZebra GPU server.
#     If the ZAN endpoint is API-key gated, pass --api-key (header defaults to
#     x-api-key; override with --api-key-header). The key can also come from
#     SP1_PROVER_API_KEY / ZAN_PROVER_API_KEY env instead of the flag.
SP1_PROVER_URL="https://<sp1-host-on-zan-powerzebra>" \
  node scripts/benchmark-prover.js \
  --sequential 50 --concurrent 10 --batch 1 \
  --api-key "<ZAN_PROVER_API_KEY>" \
  --label powerzebra --cost-per-hour <USD_PER_GPU_HR> \
  --csv bench/pz.csv --summary bench/pz.summary.json

# (C) Before/after table
node ../../scripts/compare-benchmarks.cjs \
  bench/cuda.summary.json bench/pz.summary.json --out bench/comparison.md
```

Also run with `--batch 10` (XFuel's production batch size) to capture the amortized
per-deposit numbers, and repeat A/B for an apples-to-apples batched comparison.

**Validate the authenticated path locally first (no ZAN needed).** The mock prover
can emulate a gated endpoint so you can confirm `--api-key` wiring end-to-end before
pointing at the real host:

```bash
# terminal 1 — gated SIMULATED prover
node scripts/mock-prover-server.js --port 8099 --require-key --api-key testkey123 --prove-ms 80

# terminal 2 — without a key → every proof 401s (0 succeeded); with the key → all succeed
SP1_PROVER_URL="http://127.0.0.1:8099" node scripts/benchmark-prover.js --sequential 3 --concurrent 2
SP1_PROVER_URL="http://127.0.0.1:8099" node scripts/benchmark-prover.js --sequential 3 --concurrent 2 --api-key testkey123
```

The benchmark banner prints `Auth: x-api-key (set)` vs `Auth: none` so you can see
the key was applied. This same auth wiring is covered by
`backend/theta-bridge/test/prover-zan-auth.test.mjs` for the live server path.

**Integration path — `SP1_PROVER=zan` flag (scaffolded, flag-gated, default off):**
the runtime prover backend is now selectable via `SP1_PROVER` in
`backend/theta-bridge/src/sp1-prover-client.js` (`resolveProverConfig()`):

```bash
# Default (unchanged): CUDA primary, optional Succinct fallback
SP1_PROVER=cuda            # or unset

# Activate ZAN PowerZebra as primary; the CUDA endpoint stays as AUTOMATIC fallback
SP1_PROVER=zan
ZAN_PROVER_URL="https://<sp1-host-on-zan-powerzebra>"
ZAN_PROVER_API_KEY="<key>"            # sent as x-api-key (header configurable)
SP1_PROVER_URL="https://<edgecloud-sp1-host>"   # becomes the fallback
```

ZAN must speak the same wire protocol (`/prove`, `/prove/binary`, `/health`,
`/metrics`). Enabling it is safe/reversible: if ZAN is unreachable, the client's
health-checked failover falls back to the CUDA endpoint automatically. For the A/B
benchmark above you still point `SP1_PROVER_URL` directly at each host (the harness
targets `SP1_PROVER_URL`); the `SP1_PROVER=zan` flag is for the live server path.

---

## 4. Measured now: pipeline validation (SIMULATED prover)

Because no GPU/ZAN prover is reachable here, we validated the **entire pipeline** with
two mock instances (injected proving times `520ms` and `105ms`, ~5x apart) to prove the
harness, summary schema, cost math, and comparator all work correctly:

```bash
# two SIMULATED provers
node scripts/mock-prover-server.js --port 8091 --prove-ms 520 --jitter 40   # "cuda-SIM"
node scripts/mock-prover-server.js --port 8092 --prove-ms 105 --jitter 12   # "powerzebra-SIM"
# harness A/B (as in §3) → compare
```

Result (`backend/theta-bridge/bench/comparison-SIM.md`):

| Metric | Baseline `cuda-SIM` | Candidate `powerzebra-SIM` | Δ |
|--------|--------------------|----------------------------|---|
| GPU time (avg) | 515 ms | 104 ms | **4.95x better** |
| GPU time (p95) | 559 ms | 116 ms | 4.82x better |
| Effective ms/deposit (avg) | 515 ms | 104 ms | 4.95x better |
| Round-trip (avg) | 531 ms | 117 ms | 4.54x better |
| Cost per proof (@ $2.50/GPU-hr) | $0.000358 | $0.000072 | 4.95x cheaper |

> ⚠️ **These are SIMULATED timings, not real proving measurements.** They only prove the
> A/B tooling produces correct math and a clean report. The 4.95x here is just the
> injected ratio round-tripping through the harness — **not** a PowerZebra result.

---

## 5. Projection (to be replaced by measured data)

Applying ZAN's published PowerZebra claim (**up to ~50x kernel / ~5x end-to-end** on the
MSM/NTT/H_Poly/Transpose kernels SP1 leans on) to the CUDA reference baseline:

| Workload | Current CUDA (reference) | PowerZebra projected (~5x e2e) | Notes |
|----------|--------------------------|-------------------------------|-------|
| Single proof | ~0.5 s (RTX 4090) | **~0.1 s** | latency-bound path |
| Batch-10 / deposit | ~2.3 s → (CUDA target ~0.5 s) | **~0.1 s/deposit** | throughput path |
| On-chain gas | ~270K | ~270K | **unchanged** (verifier agnostic) |

Cost-per-proof scales linearly with GPU-seconds: `cost = gpu_seconds × ($/GPU-hr ÷ 3600)`.
So a 5x proving speedup is a ~5x cost reduction **at equal $/GPU-hr** — the open variable
is PowerZebra's hardware $/hr, which we need from ZAN's quote to finalize $/proof.

> These rows are **PROJECTED**, pending ZAN provisioning. Replace them with the measured
> `bench/comparison.md` from §3 before citing anywhere (grants, WHITEPAPER §12).

---

## 6. Gotchas

- **No `Δ`/unicode issues in files** — the comparator writes clean UTF-8; a mangled `Δ`
  in a PowerShell console is just terminal encoding, the `.md` file is correct.
- **`bench/` must exist** before a run (harness writes CSV/summary there; `mkdir -p bench`).
  The `npm run benchmark:*` wrapper scripts create it automatically.
- **`.env.benchmark` is git-ignored.** It's separate from the backend's real `.env` —
  safe place for ZAN keys used only for benchmarking. `benchmark:compare` always reads
  fixed filenames (`bench/edgecloud-cuda.summary.json`, `bench/powerzebra.summary.json`),
  so re-running `benchmark:cuda`/`benchmark:zan` overwrites the previous result — copy
  them elsewhere first if you need to keep multiple historical runs.
- **Mock ≠ prover.** `mock-prover-server.js` emits *simulated* times and logs a warning on
  boot. Never let a `*-SIM` summary leak into a real comparison.
- **Fresh baseline.** Re-measure EdgeCloud CUDA at benchmark time; the reference numbers
  above span different SP1 SDK versions and runtimes (network vs CUDA) and aren't comparable.
- **Batch parity.** Compare like-for-like: baseline batch-1 vs candidate batch-1, and
  batch-10 vs batch-10. Effective ms/deposit is the number that matters for throughput.
- **Warm-up matters.** The harness discards 3 warm-up proofs (setup-key caching); keep it.
- **ZAN ≠ Theta RPC.** Unrelated but easy to conflate: ZAN Node Service has no Theta RPC
  (see `docs/ZAN_INTEGRATION.md`). PowerZebra is GPU capacity, a separate product/track.
- **Timeout.** Real CUDA/network proofs can take seconds–minutes; the driver uses a 300s
  per-proof timeout. Don't lower it for the network-fallback path.
- **Phase 2 payment binding (v2 public values).** When benchmarking AI-task proofs with
  x402 binding, rebuild the guest ELF after pulling `sp1-prover/` changes, register the
  new `programVKey`, set `SP1_PUBLIC_VALUES_V2=true` on the prover host, and
  `X402_PROOF_BINDING=true` on the backend. v2 adds a small in-circuit keccak check;
  re-baseline throughput after activation. See `skills/_shared/reference/public-values.md`.

---

## 7. Decision gate → next step

Once §3 produces a real `bench/comparison.md`:

1. **If PowerZebra ≥ ~2–3x end-to-end at acceptable $/GPU-hr** → wire approach A: set the
   ZAN host as `SP1_PROVER_URL`, keep EdgeCloud as `SP1_FALLBACK_URL` (flag + fallback
   already implemented). Roll out gradually; watch `/metrics` + fallback activations.
2. **If marginal** → hold at reference; revisit approach B (in-process `SP1_PROVER=zan`
   accelerated backend) only if the kernel-level ~50x translates to a bigger end-to-end win
   on batched workloads.
3. Either way, on-chain verification is untouched — **no contract redeploy, no audit-scope
   change.**

Artifacts from this session live in `backend/theta-bridge/bench/` (`*.summary.json`,
`comparison-SIM.md`) and are fully regenerable via the commands above.
