# Prover Benchmark Comparison

- **Baseline:** `edgecloud-cuda-SIM` (local, batch=1, 2026-07-01T06:26:50.388Z)
- **Candidate:** `powerzebra-SIM` (local, batch=1, 2026-07-01T06:27:19.058Z)

| Metric | Baseline | Candidate | Δ |
|--------|----------|-----------|---|
| GPU time (avg) | 515ms | 104ms | (4.95x better) |
| GPU time (p95) | 559ms | 116ms | (4.82x better) |
| Effective ms/deposit (avg) | 515ms | 104ms | (4.95x better) |
| Round-trip (avg) | 531ms | 117ms | (4.54x better) |
| Cost per proof | 0.00035764 USD | 0.00007222 USD | (4.95x better) |

**Headline:** candidate GPU proving is **4.95x** the baseline on average GPU time.

> Note: on-chain verification gas is unchanged (ZKVerifierSP1 is proof-system-agnostic).
