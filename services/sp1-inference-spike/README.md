# XFuel Verified Inference — SP1-compat spike (Tier-3, ADR 0004 step 2)

> **Throwaway spike, not product code.** Purpose: get **one** `xfuel-zkp` multilinear-KZG opening
> check compiling + proving **inside an SP1 guest**, wrapped to Groth16, verifiable on Base by the
> existing `SP1Verifier.sol`. The cycle/gas numbers decide **C1 vs C2** (below) before we build the
> full Tier-3 verifier. Isolated from CI and from the repo root workspace.

## Why (the decision this unblocks)

The committed prover (`services/zkllm-prover`) is complete through the full transformer block. The
on-chain verifier plan (ADR 0004) is to run our **verifier** inside an SP1 guest and let Succinct wrap
it to a cheap on-chain proof — no new audit-scope Solidity, no GPU. Two variants:

- **C1 — keep KZG:** the guest runs `pcs::verify` (multilinear-KZG). Each opening is O(1) BN254
  pairings (SP1 has a `bn254` pairing precompile). Cheap guest, **but** needs a multilinear SRS
  (public powers-of-tau are univariate — see `docs/POMA_SPEC.md` §6) and depends on `ark-poly-commit`
  compiling to the zkVM.
- **C2 — drop KZG:** the guest commits tensors by keccak (already native in SP1) and recomputes
  `mle_eval` in-guest. No SRS, no pairings, **but** O(n) field ops per opening → more cycles.

**This spike measures exactly that trade-off** with the smallest possible unit: a single KZG opening.
If `ark-poly-commit` compiles to the zkVM and the pairing-check cycle count is acceptable → **C1**.
If it resists the zkVM or is too expensive → **C2** (the fallback is already de-risked; the guest can
keccak natively). The spike cannot really "fail" — it returns a decision.

## Layout

```
verify-core/   Windows-checkable. NO sp1-* deps. Serialization + `pcs::verify` + the SpikeBundle.
               `cargo test` here proves the round-trip + verify logic on ANY host.  ← run this now
sp1/guest/     SP1 zkVM entrypoint: reads a witness, calls verify-core, commits the bundle.
sp1/host/      Builds a real opening with xfuel-zkp, executes (cycle count) + Groth16-proves + verifies.
```

`verify-core` and `sp1/` are **separate workspaces** (each declares its own `[workspace]`), neither is
a member of the repo root workspace, and **nothing here is referenced by `.github/workflows/test.yml`**.

## Run it

### 1. Logic check — works on Windows/macOS/Linux (no SP1 toolchain)

```bash
cd services/sp1-inference-spike/verify-core
cargo test        # round-trip + KZG opening verify + tamper-rejection
```

### 2. The actual spike — Linux/Docker/WSL/AWS only

`sp1-sdk`/`sp1-zkvm` are Unix-only (sp1-jit uses `std::os::fd`). Reuse the environment that already
builds `services/sp1-prover` (its Dockerfiles / the AWS box).

```bash
# Install the SP1 toolchain (once), per services/sp1-prover/INSTALL.md:
curl -L https://sp1up.succinct.xyz | bash && sp1up      # provides cargo-prove + the zkVM target

cd services/sp1-inference-spike/sp1
# (2a) MAKE-OR-BREAK: does xfuel-zkp (ark-poly-commit + BN254) compile to the zkVM target?
cargo prove build -p xfuel-inference-spike-guest
#   → if this fails on ark-poly-commit, that is the C2 signal. Capture the error.

# (2b) execute for the cycle count, then Groth16-prove + verify:
SP1_PROVER=cpu cargo run -p xfuel-inference-spike-host --release -- 16
```

### Numbers to capture (paste into `docs/adr/0004-zkllm-prover-stack.md`)

- Does `cargo prove build` of the guest **succeed** (C1 viable) or fail on `ark-poly-commit` (→ C2)?
- **Guest cycles** for one opening (`report.total_instruction_count()`), and how it scales with `n`.
- **Groth16 prove time** and that `SP1Verifier.sol` accepts the wrapped proof (Base testnet).
- The printed **`programVKey`** (a new guest ⇒ new vkey to register on-chain).

## Notes / caveats

- The exact sp1-sdk 6.0.2 builder methods (`execute(..).await`, `.groth16().await`) should be confirmed
  against the installed SDK on first Linux build; mirror `services/sp1-prover/host/src/main.rs`
  (which uses `.compressed().await`) if the surface differs.
- If C1 needs SP1's patched arkworks crates, add `[patch.crates-io]` entries (Succinct forks of
  `ark-bn254`/`ark-ff`/`ark-ec`) to `sp1/Cargo.toml` — that is part of what step 2a discovers.
- This directory can be deleted once the decision is recorded; it intentionally holds no product code.
