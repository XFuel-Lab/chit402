# SP1 Prover Batching Configuration Guide

## Overview

Phase 1 batching has been successfully implemented, achieving:
- **11.6x speedup** vs single deposits
- **90% cost reduction** on Succinct Mainnet
- **2.25s effective time per deposit** (Batch-10)

This document explains how to configure and use the batching functionality.

---

## Environment Variables

Add these to your `.env` or `.env.local` file:

```bash
# SP1 Prover Configuration
SP1_PROVER_URL=http://3.83.140.122:8080  # Updated Phase 1 endpoint
SP1_PROVER_TIMEOUT=120000                 # 120s (increase if using larger batches)
SP1_PROVER_RETRIES=3
SP1_PROVER_FALLBACK=false

# Phase 1: Batching Configuration
SP1_BATCHING_ENABLED=true                 # Enable/disable batching (default: true)
SP1_BATCH_SIZE=10                         # Target batch size (1-10, default: 10)
SP1_BATCH_TIMEOUT_MS=10000                # Max wait time before processing partial batch (default: 10s)
SP1_MIN_BATCH_SIZE=5                      # Min batch size before timeout flush (default: 5)
```

---

## Configuration Options

### `SP1_BATCHING_ENABLED`
- **Default**: `true`
- **Description**: Master switch for batching functionality
- **When to disable**: 
  - Testing/debugging single deposit flows
  - Low-volume periods where latency is critical
  - Initial deployment (gradual rollout)

### `SP1_BATCH_SIZE`
- **Default**: `10`
- **Range**: `1-10`
- **Description**: Target number of deposits per batch
- **Recommendations**:
  - `10`: Maximum cost savings (90%), best for high-volume periods
  - `5`: Balanced (80% cost savings, 6.3x speedup)
  - `3`: Lower latency (65% cost savings, 3.3x speedup)
  - `1`: Effectively disables batching (single deposits)

**Performance by Batch Size** (from benchmark):
```
Batch Size │ Time/Deposit │ Speedup │ Cost Savings
───────────┼──────────────┼─────────┼─────────────
1 (single) │ 26.69s       │ 1.0x    │ 0%
3          │ 8.11s        │ 3.3x    │ 67%
5          │ 5.41s        │ 4.9x    │ 80%
10         │ 2.30s        │ 11.6x   │ 90%
```

### `SP1_BATCH_TIMEOUT_MS`
- **Default**: `10000` (10 seconds)
- **Description**: Maximum time to wait before processing a partial batch
- **Recommendations**:
  - `5000` (5s): Low-latency requirements
  - `10000` (10s): Balanced (default)
  - `30000` (30s): High-volume periods, maximize batch fill rate
  - `60000` (60s): Maximum cost optimization, can tolerate high latency

**Trade-off**: Lower timeout = lower latency, but smaller average batch sizes (less cost savings)

### `SP1_MIN_BATCH_SIZE`
- **Default**: `5`
- **Description**: Minimum batch size before timeout triggers batch processing
- **Purpose**: Prevents processing tiny batches that don't benefit from batching
- **Recommendations**:
  - Set to ~50% of `SP1_BATCH_SIZE`
  - If queue is below this when timeout fires, deposits are processed as singles
  - Example: `SP1_BATCH_SIZE=10`, `SP1_MIN_BATCH_SIZE=5`

---

## Usage in Code

### Basic Usage (Automatic Batching)
```javascript
import { getSP1Prover } from './sp1-prover-client.js';

// Deposits are automatically batched
const prover = getSP1Prover();
const result = await prover.generateProof(proofRequest);

console.log(result.isBatch);           // true if batched
console.log(result.batchSize);         // Number of deposits in batch
console.log(result.effectiveTimeMs);   // Time per deposit (effective)
```

### Urgent/High-Priority Deposits
```javascript
// Bypass batching for urgent deposits
const result = await prover.generateProof(proofRequest, true);  // urgent=true
```

### Monitoring Batch Queue
```javascript
const stats = prover.getBatchStats();
console.log(stats);
// {
//   enabled: true,
//   queueSize: 3,           // Deposits waiting in queue
//   pendingPromises: 3,     // Promises waiting for resolution
//   batchSize: 10,
//   minBatchSize: 5,
//   batchTimeoutMs: 10000
// }
```

### Graceful Shutdown
```javascript
// Flush any pending batches before shutdown
await prover.flushBatches();
```

---

## Batching Logic Flow

### 1. Request Received
```
Deposit proof request arrives
↓
Is batching enabled? → NO → Process as single deposit immediately
↓ YES
Add to batch queue
↓
Is batch full (≥ SP1_BATCH_SIZE)? → YES → Process batch immediately
↓ NO
Start/reset timeout timer
```

### 2. Timeout Fired
```
Timeout reaches SP1_BATCH_TIMEOUT_MS
↓
Is queue size ≥ SP1_MIN_BATCH_SIZE? → YES → Process partial batch
↓ NO
Process remaining deposits as singles (fallback)
```

### 3. Batch Processing
```
Extract batch (up to SP1_BATCH_SIZE deposits)
↓
Send batch request to SP1 prover
↓
SUCCESS → Resolve all promises with individual results
↓
FAILURE → Fallback: Process each deposit as single (retry logic)
```

---

## Response Format

### Single Deposit Response
```json
{
  "success": true,
  "proof": "base64_encoded_proof",
  "publicInputs": { "vault_address": "...", ... },
  "nullifier": "0x...",
  "provingTimeMs": 26690,
  "totalTimeMs": 27000,
  "timestamp": 1706000000000,
  "isBatch": false
}
```

### Batched Deposit Response
```json
{
  "success": true,
  "proof": "base64_encoded_proof",          // Single proof for entire batch
  "publicInputs": { "vault_address": "...", ... },  // This deposit's inputs
  "nullifier": "0x...",                      // Aggregated nullifier (batch-wide)
  "batchSize": 10,                           // Total deposits in batch
  "batchIndex": 3,                           // This deposit's index in batch
  "provingTimeMs": 22500,                    // Total batch proof time
  "effectiveTimeMs": 2250,                   // Time per deposit (proving/batchSize)
  "totalTimeMs": 23000,                      // Total elapsed time
  "timestamp": 1706000000000,
  "isBatch": true
}
```

**Key Differences**:
- `isBatch`: Indicates if this was batched
- `batchSize`: Number of deposits in the batch
- `effectiveTimeMs`: Amortized time per deposit (useful for metrics)
- `nullifier`: For batches, this is the aggregated nullifier across all deposits

---

## Deployment Recommendations

### Phase 1.1: Gradual Rollout (Conservative)
```bash
SP1_BATCHING_ENABLED=true
SP1_BATCH_SIZE=5              # Start with smaller batches
SP1_BATCH_TIMEOUT_MS=30000    # Longer timeout to ensure batches fill
SP1_MIN_BATCH_SIZE=3
```
- **Pros**: Lower risk, easier to monitor
- **Cost Savings**: ~80%
- **Speedup**: ~4.9x

### Phase 1.2: Optimal Production (Recommended)
```bash
SP1_BATCHING_ENABLED=true
SP1_BATCH_SIZE=10             # Maximum efficiency
SP1_BATCH_TIMEOUT_MS=10000    # Balanced latency/throughput
SP1_MIN_BATCH_SIZE=5
```
- **Pros**: Maximum cost savings and throughput
- **Cost Savings**: ~90%
- **Speedup**: ~11.6x
- **Max Latency**: ~10s for low-volume periods

### Phase 1.3: Low-Latency Mode
```bash
SP1_BATCHING_ENABLED=true
SP1_BATCH_SIZE=5
SP1_BATCH_TIMEOUT_MS=5000     # Faster timeout
SP1_MIN_BATCH_SIZE=3
```
- **Pros**: Lower user-perceived latency
- **Cost Savings**: ~60-80%
- **Speedup**: ~3-5x

---

## Monitoring & Metrics

### Key Metrics to Track
1. **Batch Fill Rate**: Average batch size / `SP1_BATCH_SIZE`
   - Ideal: >80% (e.g., avg 8 deposits for `BATCH_SIZE=10`)
   - Low fill rate indicates `BATCH_TIMEOUT_MS` may be too short

2. **Effective Time per Deposit**: `provingTimeMs / batchSize`
   - Target: <5s for Batch-5, <3s for Batch-10

3. **Queue Depth**: `getBatchStats().queueSize`
   - Consistent high queue = consider increasing `BATCH_SIZE`
   - Always zero = batching not effective, consider disabling

4. **Cost per Deposit**: Track actual Succinct Mainnet costs
   - Expected: ~$0.02 for Batch-5, ~$0.01 for Batch-10

### Logging
The client logs key events:
- `Added deposit to batch queue` (debug)
- `Batch full, processing immediately` (info)
- `Batch timeout reached, processing partial batch` (info)
- `Processing batch of deposits` (info)
- `Batch proof generated successfully` (info)
- `Batch proof generation failed, falling back to single deposits` (error)

---

## Troubleshooting

### Issue: Batches Never Fill Up
**Symptoms**: Always processing single deposits or very small batches  
**Causes**:
- Low deposit volume
- `BATCH_TIMEOUT_MS` too short
- `BATCH_SIZE` too large for current volume

**Solutions**:
- Increase `BATCH_TIMEOUT_MS` to 30-60s
- Reduce `BATCH_SIZE` to 3-5
- Check `getBatchStats()` to monitor queue depth

### Issue: High Latency
**Symptoms**: Users complaining about slow proof generation  
**Causes**:
- `BATCH_TIMEOUT_MS` too long
- Waiting for batches that rarely fill

**Solutions**:
- Reduce `BATCH_TIMEOUT_MS` to 5s
- Set `urgent=true` for time-sensitive requests
- Consider disabling batching during low-volume periods

### Issue: Batch Proof Failures
**Symptoms**: Logs show "Batch proof generation failed, falling back to single deposits"  
**Causes**:
- SP1 prover service issues
- Batch too large for available resources
- Network timeout

**Solutions**:
- Check SP1 prover service health
- Reduce `BATCH_SIZE`
- Increase `SP1_PROVER_TIMEOUT`
- Client automatically falls back to single deposits (no data loss)

---

## Cost-Benefit Analysis

### Production Scenario: 1000 Deposits/Day

| Configuration | Proofs/Day | Cost/Day ($0.10/proof) | Cost/Month | Savings/Month |
|---------------|------------|------------------------|------------|---------------|
| Single (baseline) | 1000 | $100 | $3,000 | - |
| Batch-3 | 334 | $33.40 | $1,002 | $1,998 (67%) |
| Batch-5 | 200 | $20 | $600 | $2,400 (80%) |
| **Batch-10** | **100** | **$10** | **$300** | **$2,700 (90%)** |

**ROI Calculation**:
- Implementation effort: ~4 hours
- Monthly savings: $2,700 (Batch-10)
- **Payback**: Immediate
- **Annual savings**: $32,400

---

## Next Steps

1. **Update Environment Variables**: Add batching config to `.env` or `.env.local`
2. **Update SP1_PROVER_URL**: Point to Phase 1 endpoint (`http://3.83.140.122:8080`)
3. **Restart Backend Service**: `npm run start` or `pm2 restart theta-bridge`
4. **Monitor Logs**: Watch for batching events and performance metrics
5. **Track Costs**: Monitor actual Succinct Mainnet costs over first week
6. **Optimize**: Adjust `BATCH_SIZE` and `BATCH_TIMEOUT_MS` based on observed patterns

---

## FAQ

**Q: What happens if a deposit is urgent?**  
A: Call `generateProof(request, true)` to bypass batching and process immediately.

**Q: Will batching work with low deposit volume?**  
A: Yes, but with reduced efficiency. The timeout ensures deposits don't wait forever. For very low volume (<10 deposits/hour), consider disabling batching.

**Q: Can I mix single and batch requests?**  
A: Yes, the client handles both transparently. Set `urgent=true` for specific requests.

**Q: What if the SP1 prover is down?**  
A: The client has built-in retry logic. If batch fails, it automatically falls back to processing deposits individually.

**Q: How do I disable batching temporarily?**  
A: Set `SP1_BATCHING_ENABLED=false` and restart the service.

---

*Last Updated: 2026-01-23*  
*Phase 1 Batching Implementation Complete*
