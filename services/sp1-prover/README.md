# SP1 Prover

Tier-2 settlement prover for XFuel. Generates Groth16/PLONK-wrapped SP1 proofs verified by `ZKVerifierSP1` on Base.

Deploy identifiers (`AWS_ACCOUNT_ID`, `ECS_CLUSTER`, `ECR_REPOSITORY`, `AWS_SECRET_ARN`, `SP1_PROVER_URL`, `PROVER_DEPLOYMENT_NAME`) come from the environment or untracked `aws-env.local.ps1` / `aws-env.local.json`. See `aws-env.local.ps1.example` and [deploy/ecs/README.md](../../deploy/ecs/README.md).  
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

## Docker (guest v5.1 + in-proof payment binding)

Build context must be the **repository root** so `core-layer/sp1-hooks` can be copied into the image. The Dockerfile vendors it at `/app/core-layer/sp1-hooks` and rewrites workspace paths in the copied `Cargo.toml` (repo sources stay unchanged).

```bash
# from repo root
docker build -f services/sp1-prover/Dockerfile -t sp1-prover:guest-v51 .
```

Runtime: set `SP1_PUBLIC_VALUES_V2=true` when serving v2 public values (see `env.example`). Product semantics are unchanged; only the image build layout is fixed.

Gateway points at the prover with `SP1_PROVER_URL`.

## Notes

- Proofs attest settlement metadata + commitments — not black-box inference correctness  
- Guest v5.1: in-proof x402 payment binding when `SP1_PUBLIC_VALUES_V2=true` + `X402_PROOF_BINDING` — [tier2-in-proof-binding-smoke.md](../../docs/product/tier2-in-proof-binding-smoke.md)  
- Scattered historical status / phase markdown in this folder is non-canonical; prefer this README and docs/DEPLOYMENT.md  
