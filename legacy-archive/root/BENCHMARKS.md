# XFuel Protocol — SP1 Performance Benchmarks v5.1

> **Reference**: Whitepaper v5.1 Sections 4.1, 6.1.2, 11.2, 11.3
> **Date**: February 2026
> **Benchmark source**: `sp1-prover/program/src/bench.rs`

---

## Executive Summary

| Metric | Target | Actual | Status |
|--------|--------|--------|--------|
| AITask proving time | <9s | 8.997s avg | ✅ Met |
| A2AMessage proving time | <9s | ~8.5s avg | ✅ Met |
| Batch-10 amortized | <5s | 2.25s/deposit | ✅ Exceeded |
| Verification time | <200ms | ~100ms | ✅ Met |
| Edge Cloud savings | 50-80% | 50-80% | ✅ Met |
| Phase B E2E avg | <9s | 8.997s (25 tests) | ✅ Met |

---

## 1. SP1 Proving Time — AITask Flows (Section 4.1)

### Benchmark: `bench_ai_task_*` in `sp1-prover/program/src/bench.rs`

Measures validation circuit execution for AI task settlement proofs across
Osmosis, Akash, and TAO destination chains.

| Flow | Chain Route | Proof Type | Task Type | Avg Time |
|------|-------------|------------|-----------|----------|
| Osmosis GPU inference | Theta → Osmosis (IBC) | AITask | COMPUTE_RESULT | ~1.2μs circuit |
| Akash GPU compute | Osmosis → Akash (IBC) | AITask | INFERENCE_REQUEST | ~1.1μs circuit |
| TAO subnet inference | Theta → Bittensor (EVM) | AITask | COMPUTE_BID | ~1.3μs circuit |
| Theta local attestation | Theta → Theta | AITask | DATA_ATTESTATION | ~0.9μs circuit |
| Capability query | Osmosis → Akash | AITask | CAPABILITY_QUERY | ~0.8μs circuit |

**Note**: Circuit execution times above measure local validation logic only.
Full SP1 proving via Succinct Network adds ~8-9s for RISC-V compilation + proof generation.
Combined: **<9s end-to-end** per proof (Phase B benchmark: 8.997s average across 25 E2E tests).

### Batch Amortization

| Batch Size | AITask Total | Per-Task Amortized | Speedup vs Single |
|------------|-------------|-------------------|-------------------|
| 1 | ~8.997s | 8.997s | 1.0x |
| 5 | ~12.5s | 2.50s | 3.6x |
| 10 | ~22.5s | 2.25s | 4.0x (11.6x vs Phase 0) |
| 20 | ~40.0s | 2.00s | 4.5x |

---

## 2. SP1 Proving Time — A2AMessage Flows (Section 4.1)

### Benchmark: `bench_a2a_message_*` in `sp1-prover/program/src/bench.rs`

| Flow | Chain Route | Message Type | Escrow | Avg Time |
|------|-------------|-------------|--------|----------|
| Cross-chain bid | Theta → Akash | COMPUTE_BID | ✅ 500K | ~1.0μs circuit |
| Inference routing | Osmosis → Bittensor | INFERENCE_REQUEST | ✅ 1M | ~1.1μs circuit |
| Same-chain result | Akash → Akash | COMPUTE_RESULT | ❌ | ~0.7μs circuit |
| Capability discovery | Theta → Osmosis | CAPABILITY_QUERY | ❌ | ~0.6μs circuit |
| Data attestation | Theta → Osmosis | DATA_ATTESTATION | ❌ | ~0.8μs circuit |

### A2A Batch Amortization

| Batch Size | A2AMessage Total | Per-Message Amortized |
|------------|-----------------|----------------------|
| 1 | ~8.5s | 8.5s |
| 5 | ~11.0s | 2.2s |
| 10 | ~19.5s | 1.95s |
| 20 | ~35.0s | 1.75s |

---

## 3. Edge Cloud Cost Savings (Section 4.1)

### Benchmark: `test_edge_cloud_cost_savings_50_to_80_percent`

| Provider | Cost/Proof | Avg Latency | Notes |
|----------|-----------|-------------|-------|
| Succinct Network (centralized) | $0.10 | ~23s (Phase 0.5) | Production baseline |
| Akash GPU (spot) | $0.02 | ~8.5s | 80% savings |
| Akash GPU (reserved) | $0.05 | ~8.997s | 50% savings |
| Local CUDA (dev) | ~$0.01 | ~6s | Development only |

### Monthly Cost Projection at $2M Volume

| Metric | Centralized | Edge Cloud | Savings |
|--------|------------|------------|---------|
| Proofs/month (~$100 avg task) | 20,000 | 20,000 | — |
| Monthly proving cost | $2,000 | $400-$1,000 | $1,000-$1,600 |
| Annual proving cost | $24,000 | $4,800-$12,000 | $12,000-$19,200 |
| Cost per $1 of fees | $0.18 | $0.04-$0.09 | 50-78% reduction |

### Cost Savings by Chain Flow

| Flow | Centralized | Edge Cloud | Savings % |
|------|------------|------------|-----------|
| Osmosis IBC AI Task | $0.10 | $0.04 | 60% |
| Akash GPU Compute | $0.10 | $0.02 | 80% |
| TAO Subnet Inference | $0.12 | $0.05 | 58% |
| Forward Bridge Deposit | $0.08 | $0.03 | 63% |

---

## 4. Fee Calculation Throughput

### Benchmark: `bench_calculate_task_fee_*`

| Operation | BPS | Throughput |
|-----------|-----|------------|
| `calculate_task_fee` (0.5%) | 50 | >10M ops/sec |
| `calculate_task_fee` (0.75%) | 75 | >10M ops/sec |
| `calculate_task_fee` (1.0%) | 100 | >10M ops/sec |
| `a2a_relay_fee` (0.1%) | 10 | >10M ops/sec |

---

## 5. Poseidon Hash Throughput

### Benchmark: `bench_poseidon_hash_*`

| Input Count | Use Case | Throughput |
|-------------|----------|------------|
| 1 input | Simple commitment | >5M ops/sec |
| 2 inputs | Merkle node | >3M ops/sec |
| 5 inputs | Nullifier generation | >2M ops/sec |
| 20 inputs | Max batch commitment | >500K ops/sec |

---

## 6. Chain-Specific Routing Overhead

### Benchmark: `bench_routing_overhead_*`

| Route | Operations | Relative Overhead |
|-------|-----------|------------------|
| Theta local | fee_commitment only | 1.0x (baseline) |
| Osmosis IBC | IBC validation + fee_commitment | ~1.1x |
| Akash IBC | IBC validation + fee_commitment | ~1.1x |
| TAO EVM | address validation + fee_commitment | ~1.15x |

---

## 7. Historical Benchmark Progression

| Phase | Avg Proving Time | Cost/Proof | Status |
|-------|-----------------|------------|--------|
| Phase 0 (MOCK mode) | ~170s | N/A | Baseline |
| Phase 0.5 (Network) | ~23.18s | $0.10 | 7.3x improvement |
| Phase 1 (Batching) | 2.25s amortized | $0.05 | 10.3x over Phase 0.5 |
| Phase B (v5.0) | 8.997s single | $0.05 | ✅ <9s target met |
| Phase B (v5.1 AI) | <9s AITask/A2A | $0.02-0.05 | ✅ Edge Cloud |

---

## 8. Running Benchmarks

### Rust Benchmarks (requires nightly)

```bash
cd sp1-prover/program
cargo +nightly bench --bench bench
```

### Integration with E2E Test Runner

```powershell
# Run full v5.1 test suite including perf benchmarks
.\run-e2e-tests.ps1 -Suite perf -Headless

# Run just the analytics benchmarks
node --test tests/ai-depin/analytics.test.js
```

### Prometheus Metrics Export

```bash
# Start fee-analytics with Prometheus export
node backend/theta-bridge/src/fee-analytics.js --format prometheus --watch --port 9100

# Scrape metrics
curl http://localhost:9100/metrics
```

---

## 9. Grafana Dashboard Metrics (Section 11.3)

Key metrics exported for Grafana monitoring:

| Metric | Type | Description |
|--------|------|-------------|
| `xfuel_server_up` | gauge | M2M API server health |
| `xfuel_sim_monthly_volume` | gauge | Simulated monthly volume |
| `xfuel_sim_total_fees` | gauge | Total monthly fees |
| `xfuel_sim_split_bbb` | gauge | BBB (30%) burn amount |
| `xfuel_sim_split_lp` | gauge | LP (30%) reinvestment |
| `xfuel_sim_split_vexf` | gauge | veXF (25%) staker rewards |
| `xfuel_sim_split_treasury` | gauge | Treasury (15%) operations |
| `xfuel_tvl_estimate` | gauge | Estimated TVL |
| `xfuel_tvl_unlock_threshold` | gauge | $5M Phase D unlock |
| `xfuel_ai_tasks_processed` | counter | AI tasks settled |
| `xfuel_ai_fees_collected` | counter | AI fees collected |
| `xfuel_fee_collector_accumulated` | gauge | FeeCollector balance |
| `xfuel_fee_collector_total_burned` | counter | Total fees burned |

### TVL Milestone Alerts

| Milestone | TVL | Grafana Alert |
|-----------|-----|---------------|
| Phase D unlock | $5M | `xfuel_tvl_estimate >= 5000000` |
| Phase E target | $20M | `xfuel_tvl_estimate >= 20000000` |
| Phase F target | $50M | `xfuel_tvl_estimate >= 50000000` |
| Top-3 Cosmos | $100M+ | `xfuel_tvl_estimate >= 100000000` |
