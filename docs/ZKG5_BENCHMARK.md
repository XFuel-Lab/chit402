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

**Code status (M5.3, shipped):** the inter-op **requantization** gadget is wired into the FFN gate
path (wide `gate` accumulator → proven requant → activation lookup, zero-obligation), and the
**Tier-3b block-window spot-check** (`spotcheck.rs`) selects a Fiat–Shamir window of `k` blocks bound
to the model + PBR commitments. Correctness/soundness are covered by the 73-test suite; the numbers
below are **hardware-gated** — they need a high-RAM host (below) to record real model-scale
prove-time and peak RSS, which is the only remaining M5.3 item.

| Model (quant) | Block window | prove time | peak RAM | verify | proof size |
|---------------|--------------|-----------|----------|--------|-----------|
| TinyLlama-1.1B (q4_k_m) | k=1 block (FS-selected) | _tbd_ | _tbd_ | _tbd_ | _tbd_ |
| GPT-2 (fp16) | k=1 block (FS-selected) | _tbd_ | _tbd_ | _tbd_ | _tbd_ |
| Llama-3-8B (q4_k_m) | k=2 blocks (FS-selected) | _tbd_ | _tbd_ | _tbd_ | _tbd_ |

## Running at model scale (AWS) — click-by-click

The prover is a **CPU-only** Rust binary; the only scaling knob is **memory** (no GPU). Pick a
memory-optimized instance sized to the model, run the harness under `/usr/bin/time -v`, and copy the
printed timings + **peak RSS** into the tables above.

### 1. Pick the instance (memory-optimized, not GPU)

| Target | Instance | RAM | Notes |
|--------|----------|-----|-------|
| M5.2/M5.3 single block (TinyLlama/GPT-2) | `r7i.4xlarge` → `r7i.8xlarge` | 128 → 256 GB | start here |
| Larger block / small spot-check window | `r7i.12xlarge` / `r7i.16xlarge` | 384 / 512 GB | |
| Full-pass (M5.5) experiments | `x2iedn.8xlarge` | 1 TB | only if needed |

Spot instances are fine — the job is deterministic and restartable, and memory-optimized on-demand
is already cheap relative to any GPU box.

### 2. Launch (console)

1. **EC2 → Launch instance.**
2. **AMI:** Ubuntu Server 24.04 LTS (x86_64).
3. **Instance type:** `r7i.8xlarge` (or from the table above).
4. **Key pair:** select/create one for SSH.
5. **Storage:** bump the root EBS volume to **≥ 100 GB gp3** (build artifacts + model weights).
6. **Launch**, then `ssh ubuntu@<public-ip>`.

CLI equivalent (optional):

```bash
aws ec2 run-instances \
  --image-id <ubuntu-24.04-ami> --instance-type r7i.8xlarge \
  --key-name <your-key> --block-device-mappings \
  '[{"DeviceName":"/dev/sda1","Ebs":{"VolumeSize":100,"VolumeType":"gp3"}}]'
```

### 3. Set up + build (native — simplest for peak-RSS capture)

```bash
sudo apt-get update && sudo apt-get install -y build-essential git time
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y
source "$HOME/.cargo/env"

git clone https://github.com/XFuel-Lab/xfuel-protocol && cd xfuel-protocol/services/zkllm-prover
cargo build --release --examples          # arkworks release build (a few minutes, one-off)
```

### 4. Run the sweep + record peak RAM

`/usr/bin/time -v` reports **Maximum resident set size** (peak RSS, in KB) — the number for the RAM
column. Dimensions must be powers of two.

```bash
# Single matmul-heavy block (the Dockerfile default entrypoint too):
/usr/bin/time -v cargo run --release --example prove_block 1024 1024 1024

# SwiGLU FFN sub-block (prints prove/verify + proof size + obligations):
/usr/bin/time -v cargo run --release --example prove_ffn 128 1024 4096
```

Read off `Elapsed (wall clock) time` and `Maximum resident set size (kbytes)` (÷ 1_048_576 for GB),
plus the harness's own `prove` / `verify` / `proof field elements` lines, and fill the tables above.

### 5. Container path (optional, e.g. Fargate)

The shipped image builds and runs the `prove_block` harness:

```bash
docker build -t xfuel-zkllm services/zkllm-prover
docker run --rm xfuel-zkllm 1024 1024 1024      # ENTRYPOINT prove_block, args = M K N
docker stats --no-stream                         # peak container memory if not using /usr/bin/time
```

For a large-memory **Fargate** task, set the task memory explicitly (e.g. 240 GB) and pass the M K N
args as the container command. For the FFN / spot-check harnesses, run them natively via
`cargo run --release --example …` (the image only bundles `prove_block`).

> **Status:** the M5.3 tables above are **hardware-gated** — the code + harness are ready and covered
> by the 73-test suite; they just need one run on a high-RAM host to populate real numbers. Nothing
> here needs a GPU.
