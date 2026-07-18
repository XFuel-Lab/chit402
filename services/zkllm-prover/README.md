# XFuel zkLLM prover (`xfuel-zkp`)

Self-owned, **model-agnostic** ZK prover for XFuel Verified Inference (Tier-3). Clean-room and
permissive-only (see [`docs/adr/0004-zkllm-prover-stack.md`](../../docs/adr/0004-zkllm-prover-stack.md)
and ADR 0003). CPU-only — runs in any container.

> Not "zkGPT". Built **op-first + config-driven** so one codebase covers the ZK-addressable LLM
> market (open-weight decoder transformers: Llama, Mistral, Qwen, Gemma, GPT-2, MoE). Closed models
> (no weight access) are un-provable by anyone and are covered by the TEE / signed tiers.

## What's here (M5.1 core + M5.2 gadget/block/lookup layer)

| Module | Purpose |
|--------|---------|
| `matmul` | Sumcheck-based `C = A·B` argument (Thaler-style). Matmul is ~90%+ of transformer cost and identical across LLMs — this is the reusable core. |
| `sumcheck` | Product sumcheck + **generic multi-product (degree-d) sumcheck** + Lagrange eval, over a Keccak256 Fiat–Shamir transcript. |
| `mle` | Multilinear-extension helpers (`eq` weights, MLE evaluation, `eq_eval`). |
| `gadgets` | **Sound Hadamard (elementwise-product) argument** `z = a⊙b` (SwiGLU/RoPE workhorse) + typed `LookupObligation`. |
| `lookup` | **Logup lookup argument** — proves a non-linearity via a `(in, out)` table (SiLU/GeLU/softmax-exp/rsqrt) with no field-native circuit. |
| `activation` | Quantized **SiLU/GeLU** lookup table + `prove`/`verify` — discharges the FFN's activation obligation soundly. |
| `norm` | **RMSNorm gadget** — `rsqrt` via a canonical lookup table + a linear sum-of-squares reduction + a Hadamard scaling chain. Discharges the FFN's norm obligation soundly. |
| `table` | Generic canonical **`code → code` lookup table** (`ScalarTable`) — the reusable backbone for any quantized non-linearity (backs softmax's `exp` + reciprocal). |
| `ffn` | **SwiGLU FFN sub-block** — (quantized) RMSNorm + 3 matmul proofs + gating Hadamard + (quantized) activation lookup under one transcript, manifest-driven. **Zero pending obligations in quantized mode.** |
| `attention` | **Causal self-attention sub-block** — Q/K/V/O + `Q·Kᵀ` + `P·V` (matmul), causal mask, and **softmax** as `exp` + row-sum + reciprocal lookups + a normalization Hadamard. **Zero pending obligations** (single-head, quantized). |
| `block` | **Full transformer block** — composes `attention → ffn` under one Fiat–Shamir transcript. |
| `manifest` | `ModelManifest` (arch config) + **arch-bound PoMA commitment** — proof attests "these weights + this architecture". |
| `commitment` | keccak256 weights root / model commitment + `commit_field_table` + **PBR public-input binding**, byte-identical to `SP1ProofHooks.computeInferenceBindingCommitment`. |

**Soundly proven today:** all linear projections (matmul), elementwise gating (Hadamard), the
**transcendental activation** (SiLU/GeLU) via the logup lookup, **RMSNorm** (rsqrt via the same
lookup + a sum-of-squares reduction + a Hadamard scaling chain), and **causal self-attention** with
**softmax** (`exp` + row-sum + reciprocal lookups + a normalization Hadamard). In quantized mode a
full SwiGLU FFN block and a single-head attention block each have **zero pending obligations**, and a
full transformer `block` composes them under one transcript.
**Explicitly pending (M5.2b-cont):** multi-head/GQA + RoPE **assembly** (reuses the shipped
attention core — pure witness assembly, no new argument). Then inter-op requantization range-checks
and random-block-window spot-checks (M5.3) and an on-chain verifier (M5.4).

## Build & test

```bash
cargo build --release
cargo test
```

## Benchmark

```bash
cargo run --release --example prove_block            # 256x256 · 256x256 (single matmul)
cargo run --release --example prove_block 512 512 512

cargo run --release --example prove_ffn              # SwiGLU FFN: seq=64 d_model=512 d_ff=1024
cargo run --release --example prove_ffn 128 1024 4096
```

Prints prove / verify timings, proof size, and (for the FFN) the pending lookup obligations.
Dimensions must be powers of two. Use these on a high-RAM host to fill
[`docs/ZKG5_BENCHMARK.md`](../../docs/ZKG5_BENCHMARK.md).

## Container (AWS-ready)

```bash
docker build -t xfuel-zkllm services/zkllm-prover
docker run --rm xfuel-zkllm 512 512 512
```

CPU-only; the scaling knob is **RAM**, not GPU. For model-scale runs pick a high-memory instance
(e.g. AWS `r7i` / `x2iedn`) or a large-memory Fargate task — see the benchmark doc for sizing.

## Trust boundary (honest)

M5.1/M5.2 are a *verifiable-computation* reduction: the verifier is given the tensors + advice and
checks the sumcheck/lookup arguments are sound. Two boundaries remain explicit:

1. **The transcendental steps are wired; assembly + requant remain.** Activation (SiLU/GeLU),
   RMSNorm's rsqrt, and softmax's `exp`/reciprocal are all soundly proven by the logup lookup in
   quantized mode — quantized FFN and single-head attention blocks each have zero pending
   obligations. What remains for a full model: **multi-head/GQA + RoPE assembly** (reuses the shipped
   attention core) and **inter-op requantization range-checks** so each op's output `y` re-enters the
   next op's code domain (the `block` test runs the FFN half in placeholder mode for exactly this
   reason) — M5.2b-cont/M5.3. The non-quantized path keeps placeholder norm/activation for exercising
   linear+gating on arbitrary field inputs.
2. **No polynomial commitment yet.** Binding MLE evaluations to an on-chain **polynomial commitment**
   of the weights (so the verifier needs only the commitment) + the Groth16 wrap for cheap on-chain
   verification are the M5.4 milestone.

Until those land, zkLLM proofs are generated/verified off-chain and the tier engine keeps serving
`tee` / `settlement` / `signed`.
