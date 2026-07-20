# SP1 Prover

Tier-2 settlement prover for XFuel. Generates Groth16/PLONK-wrapped SP1 proofs verified by `ZKVerifierSP1` on Base.

Live topology: [docs/RUNTIME_STATE.md](../../docs/RUNTIME_STATE.md) (AWS ECS + ALB).  
Research track (Interstellar): WHITEPAPER / [REFERENCES-AND-ATTRIBUTION.md](../../docs/REFERENCES-AND-ATTRIBUTION.md).

## Layout

```
host/      # proof orchestration
program/   # zkVM guest
script/    # build helpers
```

## Local

```
# Rust + SP1 toolchain (sp1up) required
cd services/sp1-prover
# see script/ for build helpers on your OS
```

Gateway points at the prover with `SP1_PROVER_URL`. Production ALB accepts the demo Lightsail IP only.

## Notes

- Proofs attest settlement metadata + commitments — not black-box inference correctness  
- Guest v2 unlocks in-proof payment binding (`X402_PROOF_BINDING`)  
- Scattered historical status / phase markdown in this folder is non-canonical; prefer this README + RUNTIME_STATE  
