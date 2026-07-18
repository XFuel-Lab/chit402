# XFuel zkLLM prover (`xfuel-zkp`)

Self-owned, **model-agnostic** ZK prover for XFuel Verified Inference (Tier-3). Clean-room and
permissive-only (see [`docs/adr/0004-zkllm-prover-stack.md`](../../docs/adr/0004-zkllm-prover-stack.md)
and ADR 0003). CPU-only — runs in any container.

> Not "zkGPT". Built **op-first + config-driven** so one codebase covers the ZK-addressable LLM
> market (open-weight decoder transformers: Llama, Mistral, Qwen, Gemma, GPT-2, MoE). Closed models
> (no weight access) are un-provable by anyone and are covered by the TEE / signed tiers.

## What's here (M5.1 core + M5.2 gadget/block/lookup layer + M5.3 requant/spot-check)

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
| `rope` | **RoPE** — public-linear (fixed-point cos/sin) exact rotation of Q/K; verifier recomputes, no proof object. |
| `mha` | **Multi-head + GQA attention** — one shared norm + Q/K/V/O, RoPE on Q/K, and the per-head softmax argument for every head under one transcript. GQA is index layout (`head → kv group`). **Zero pending obligations** (quantized). |
| `range` | **Range-check gadget** — proves a column lies in `[0, bound)` via a membership lookup into the identity table. The reusable backbone for requant bounds and any limb decomposition. |
| `requant` | **Inter-op requantization** — proves `acc + bias = q·D + r` with `0 ≤ r < D` and `0 ≤ q < q_bound` (division-with-remainder + two range checks; public `bias` handles signed accumulators), so a wide accumulator re-enters the next op's code domain. **Wired into the FFN gate path** (`RequantParams`). |
| `block` | **Full transformer block** — composes `attention → ffn` under one Fiat–Shamir transcript; the FFN gate's wide→code requant hop threads through. |
| `spotcheck` | **Tier-3b block-window spot-check** — a Fiat–Shamir-selected pseudo-random window of `k` blocks, bound to the model + PBR commitments so the prover can't cherry-pick and any trace tampering re-rolls the selection. Generic over the per-block prover. |
| `manifest` | `ModelManifest` (arch config) + **arch-bound PoMA commitment** — proof attests "these weights + this architecture". |
| `commitment` | keccak256 weights root / model commitment + `commit_field_table` + **PBR public-input binding**, byte-identical to `SP1ProofHooks.computeInferenceBindingCommitment`. |

**Soundly proven today:** all linear projections (matmul), elementwise gating (Hadamard), the
**transcendental activation** (SiLU/GeLU) via the logup lookup, **RMSNorm** (rsqrt via the same
lookup + a sum-of-squares reduction + a Hadamard scaling chain), **causal self-attention** with
**softmax** (`exp` + row-sum + reciprocal lookups + a normalization Hadamard), **multi-head + GQA**
attention, and **RoPE** (public-linear). In quantized mode a SwiGLU FFN block and a multi-head
attention block each have **zero pending obligations**, and a full transformer `block` composes them
under one transcript. Inter-op **requantization** (`requant`) is proven as division-with-remainder
plus two `range` checks and is now **wired into the FFN gate path** — a wide matmul accumulator is
requantized into the activation's code domain under the block transcript (an FFN test proves a wide
gate → requant → activation → sound norm with **zero pending obligations**). The **Tier-3b
block-window spot-check** (`spotcheck`) selects a Fiat–Shamir window of blocks bound to the model +
PBR commitments (M5.3). **Explicitly pending:** the RAM bench on a high-RAM host (M5.3), then the PCS
binding + on-chain verifier + Groth16 wrap (M5.4).

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

1. **The transcendental steps, attention assembly, and inter-op requant are all proven.**
   Activation (SiLU/GeLU), RMSNorm's rsqrt, and softmax's `exp`/reciprocal are all soundly proven by
   the logup lookup in quantized mode; multi-head/GQA + RoPE assembly is done; and inter-op
   **requantization** (`requant` = division-with-remainder + two `range` checks) is **wired into the
   FFN gate path** — an FFN test proves a wide gate accumulator → requant → activation → sound norm
   with zero pending obligations, and it threads through the `block`. The `spotcheck` layer selects a
   Fiat–Shamir block window for the cheaper Tier-3b. The non-quantized path keeps placeholder
   norm/activation for exercising linear+gating on arbitrary field inputs. What remains is the
   full-model **RAM benchmark** on a high-RAM host (M5.3).
2. **No polynomial commitment yet.** Binding MLE evaluations to an on-chain **polynomial commitment**
   of the weights (so the verifier needs only the commitment) + the Groth16 wrap for cheap on-chain
   verification are the M5.4 milestone.

Until those land, zkLLM proofs are generated/verified off-chain and the tier engine keeps serving
`tee` / `settlement` / `signed`.
