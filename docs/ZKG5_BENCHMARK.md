# XFuel zkLLM — Benchmark Harness (Phase 5 / M5.x)

Tracks prove/verify time, proof size, and **RAM** for the zkLLM prover. Phase 5 is RAM-bound (not
GPU) — this doc is where we record real numbers as milestones land and hardware is sized.

Harness: [`services/zkllm-prover`](../services/zkllm-prover) → `cargo run --release --example prove_block M K N`.

## M5.1 — generic matmul argument (the architecture-agnostic core)

Single `C = A·B` proof (sumcheck + Keccak256 Fiat–Shamir). Proof size = `log2(K)·3 + log2(M) + log2(N) + 3`
field elements (~32 B each) — succinct and logarithmic in the inner dimension.

**Reference run** (dev laptop, single core, debug-free `--release`; indicative only):

| M×K·K×N | matmul build | prove | verify | sumcheck rounds | proof (field elts) |
|---------|-------------|-------|--------|-----------------|--------------------|
| 256×256 · 256×256 | ~1.0 s | ~21 ms | ~32 ms | 8 | 43 |
| 512×512 · 512×512 | _tbd_ | _tbd_ | _tbd_ | 9 | 48 |
| 1024×1024 · 1024×1024 | _tbd_ | _tbd_ | _tbd_ | 10 | 53 |

> The proof is tiny (tens of field elements) and verify is milliseconds regardless of matrix size —
> the cost is prover-side and scales with the matmul, exactly as intended.

## M5.2a — SwiGLU FFN sub-block (matmul core + gating Hadamard)

Composes 3 matmul proofs (`Wgate`, `Wup`, `Wdown`) + the SwiGLU gating Hadamard proof under one
Fiat–Shamir transcript. Norm + activation are recorded as pending `LookupObligation`s (M5.2b), so
these numbers are the **linear + gating** cost — the dominant, architecture-independent part.

Harness: `cargo run --release --example prove_ffn SEQ D_MODEL D_FF`.

| seq × d_model × d_ff | prove (3 matmul + gate) | verify | proof (field elts) | obligations |
|----------------------|--------------------------|--------|--------------------|-------------|
| 64 × 512 × 1024 | ~4.4 s | ~0.34 s | 223 | rmsnorm, silu |
| 128 × 1024 × 4096 | _tbd_ | _tbd_ | _tbd_ | rmsnorm, silu |

> Verify stays sub-second and the proof stays a few hundred field elements; prover cost tracks the
> three projections. Reference run on a dev laptop — refill on the high-RAM host alongside M5.3.

## M5.2b–M5.3 — full block / small-model spot-check (to fill on the high-RAM host)

| Model (quant) | Block window | prove time | peak RAM | verify | proof size |
|---------------|--------------|-----------|----------|--------|-----------|
| TinyLlama-1.1B (q4_k_m) | 1 block | _tbd_ | _tbd_ | _tbd_ | _tbd_ |
| GPT-2 (fp16) | 1 block | _tbd_ | _tbd_ | _tbd_ | _tbd_ |
| Llama-3-8B (q4_k_m) | 1 block | _tbd_ | _tbd_ | _tbd_ | _tbd_ |

## Running at model scale (AWS container)

The prover is a CPU-only Rust binary — it runs in any container. The only scaling knob is **memory**.

1. **Build the image:** `docker build -t xfuel-zkllm services/zkllm-prover`
2. **Pick a high-memory instance** (memory-optimized, not GPU):
   - `r7i.4xlarge` (128 GB) → `r7i.8xlarge` (256 GB) for M5.2/M5.3 block proofs.
   - `x2iedn.8xlarge` (1 TB) for full-pass (M5.5) experiments.
   - Or a large-memory **Fargate** task if you prefer serverless (set task memory explicitly).
3. **Run a sweep:** `docker run --rm xfuel-zkllm 1024 1024 1024` (and larger), record the printed
   timings + `/usr/bin/time -v` peak RSS into the tables above.
4. **Cost note:** memory-optimized on-demand is cheap relative to GPU; spot instances are fine for
   benchmarking (the job is deterministic and restartable).

> A detailed, click-by-click AWS setup walkthrough will be added when we start M5.3 (the first run
> that needs the big host). Nothing here needs a GPU.
