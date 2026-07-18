---
name: add-zkp-gadget
description: >-
  Add a new sound proving gadget (operator argument) to the XFuel zkLLM prover crate
  (services/zkllm-prover/crates/xfuel-zkp). Use when implementing or extending a transformer/SSM
  operator in Rust — matmul, Hadamard/gating, a lookup-backed non-linearity (activation, norm/rsqrt,
  softmax/exp, reciprocal), attention, an FFN/block composition, or any new `*.rs` gadget + prover +
  verifier + tests — and when preserving the crate's honest trust boundary (typed LookupObligations)
  and single-transcript discipline.
---

# Adding a sound gadget to `xfuel-zkp`

The prover is **matmul-first + manifest-selected gadgets**: one codebase covers the open-weight LLM
market, and a new model architecture should be *config + at most one new gadget*, never a rewrite.
Every gadget must be **sound** (a cheating prover is rejected) or explicitly **honest** (the unproven
step is recorded as a typed obligation). Never silently trust a step.

## The decision rule (how to prove any op)

Reduce the operator to primitives the crate already owns; only reach for a lookup when the op is a
genuine non-linearity.

| The op is… | Prove it with | Example |
|---|---|---|
| A linear map with **public** coefficients (residual, transpose, RoPE with fixed-point cos/sin, row-sum) | **Direct recomputation** by the verifier from bound tensors — no proof object | `attention` residual + `Kᵀ` + causal mask; `norm` sum-of-squares |
| A matrix product `A·B` | `matmul::{prove,verify}` (sumcheck) | Q/K/V/O projections, `Q·Kᵀ`, `P·V` |
| An **elementwise product** `z = a ⊙ b` | `gadgets::{prove,verify}_hadamard` | gating, `x⊙x`, softmax normalization `E ⊙ r` |
| A **non-linearity** on quantized codes (`silu`, `gelu`, `rsqrt`, `exp`, `1/x`) | a **canonical lookup table** (`table::ScalarTable`) + `lookup` logup argument | activation, norm rsqrt, softmax exp/reciprocal |
| Not yet wired | `gadgets::LookupObligation::new(op, input, output)` — push it and return it | placeholder norm/activation paths |

**Critical soundness rule — never impose an exact in-field algebraic constraint on a rounded
fixed-point value.** `inv_rms² · (ss/d + eps) = 1` is *unsatisfiable* for a rounded `inv_rms`, and
`P · rowsum = exp` fails for a rounded probability. The sound move is always a **canonical table**:
prover and verifier build a byte-identical `code → f(code)` table, and the lookup proves membership.
The table *is* the spec; numeric fidelity (calibration) is the separate M5.3 requant concern.

## Worked examples to copy

Read the closest existing gadget and mirror its structure — do not invent a new shape.

- **Lookup-backed non-linearity** → `src/norm.rs` (RMSNorm: `x⊙x` Hadamard → row-sum direct →
  `rsqrt` lookup → scaling Hadamards) and `src/table.rs` (`ScalarTable`).
- **Multi-argument sub-block under one transcript** → `src/attention.rs` (projections + `Q·Kᵀ` +
  causal mask + softmax as `exp`+row-sum+reciprocal lookups + Hadamard + `P·V` + `Ctx·Wo` + residual)
  and `src/ffn.rs`.
- **Composition of sub-blocks** → `src/block.rs` (thread one `&mut Transcript` through each).

## Implementation checklist

Copy this and track it:

```
- [ ] Reduce the op via the decision rule above; new non-linearity ⇒ a ScalarTable
- [ ] src/<gadget>.rs: a Proof struct carrying advice tensors + sub-proofs + `obligations: Vec<LookupObligation>`
- [ ] prove_<gadget>(cfg, inputs, ..., tables, norm: Option<&NormParams>, tr) -> (Proof, output)
- [ ] verify_<gadget>(cfg, inputs, ..., output, proof, tables, norm, tr) -> bool
- [ ] Register `pub mod <gadget>;` in src/lib.rs (alphabetical) + update the crate-doc trust boundary
- [ ] tests/<gadget>.rs: the four cases below
- [ ] cargo test  (all green, and rustc warning-free)
- [ ] cargo clippy --all-targets  (add #[allow(clippy::too_many_arguments)] on prove/verify if needed)
- [ ] Update services/zkllm-prover/README.md (module table + trust boundary) and the build spec milestone
```

## Non-negotiable invariants

1. **One transcript.** `prove_*` and `verify_*` must fold every sub-proof into the same
   `Transcript` in the **identical order**. A verify-side reorder silently breaks Fiat–Shamir.
2. **Verifier recomputes all public/structural data** (masks, transposes, row-sums, residuals) from
   the *bound* tensors in the proof — it never trusts the prover for them.
3. **Honest boundary.** Anything not soundly proven is a `LookupObligation`; `verify_*` recomputes
   the expected obligation list and checks `proof.obligations == expected` (mode-mismatch ⇒ reject).
4. **Quantized mode targets zero obligations.** Provide a `Some(..)`/table path that discharges
   every obligation, and assert `obligations.is_empty()` in a test.
5. **Clean-room IP.** arkworks (`ark-*`) only. **No** AGPL zkml/Expander code, by-hand or copied.
6. **BN254 `Fr`**, keccak256 transcript, deterministic tables — consistent with the rest of the crate.

## Required tests (`tests/<gadget>.rs`)

Every gadget ships all four; mirror `tests/norm.rs` / `tests/attention.rs`:

1. **Honest verifies** — a correct proof passes; assert the expected obligation list.
2. **Zero-obligations (quantized)** — with tables/`NormParams` supplied, `obligations.is_empty()`.
3. **Tamper rejected** — perturb each advice tensor / output in turn; each must fail `verify`.
4. **Wrong-table / mode-mismatch rejected** — prove with one canonical table, verify with a
   different one (or swap `Some`/`None` norm) ⇒ reject.

Use tiny, fully-controlled fixtures (power-of-two dims; inputs chosen so lookup queries land inside
the table domain and every softmax/row-sum denominator is nonzero).

## Housekeeping

Keep `docs/TIER3_VERIFIABLE_INFERENCE_BUILD_SPEC.md`, `services/zkllm-prover/README.md`, and the
local `docs/VERIFIED_INFERENCE_HANDOFF.md` in sync (module table, trust boundary, `cargo test` count).
`docs/VERIFIED_INFERENCE_HANDOFF.md` is **local only — never commit it.**
