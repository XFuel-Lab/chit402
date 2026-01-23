# PHASE 1 IMPLEMENTATION PLAN: BATCH PROVING

**Date:** 2026-01-23  
**Goal:** Achieve <5-8s effective time per deposit via batching  
**Approach:** Single-proof-for-multiple-deposits (not recursion/aggregation)

---

## Strategy: Batch Processing (Priority 1)

**Core Concept:**  
Instead of generating 10 separate proofs (23s each = 230s total), generate **ONE proof that validates 10 deposits** (23s total = 2.3s per deposit).

**Why This Works:**
- SP1 proving time is roughly constant regardless of circuit complexity (within reason)
- Network proving cost is per-proof, not per-deposit
- Validating 10 deposits vs 1 deposit adds minimal cycles (~10x more work, but SP1 handles it efficiently)

**Expected Results:**
- Batch size 5: ~4.6s per deposit (23s / 5)
- Batch size 10: ~2.3s per deposit (23s / 10)
- Target: **<5-8s achieved with batch size 3-5**

---

## Architecture Changes

### 1. Guest Program (`program/src/main.rs`)

**Current:** Validates single `DepositInput`  
**New:** Validates `Vec<DepositInput>` (batch)

```rust
// NEW: Batch input structure
#[derive(Serialize, Deserialize)]
struct BatchPublicInputs {
    batch_size: u32,
    deposits: Vec<PublicInputs>,  // One per deposit
}

#[derive(Serialize, Deserialize)]
struct BatchPrivateInputs {
    deposits: Vec<PrivateInputs>,  // One per deposit
}

#[derive(Serialize, Deserialize)]
struct BatchOutput {
    batch_size: u32,
    nullifiers: Vec<Hash256>,       // One per deposit
    net_amounts: Vec<U256>,         // One per deposit
    batch_commitment: Hash256,      // Aggregated commitment
}
```

**Key Changes:**
1. **Loop through deposits**: Validate each deposit independently
2. **Collect outputs**: Store all nullifiers and net amounts
3. **Batch commitment**: Hash all outputs together for verifier
4. **Backward compatibility**: Batch size 1 = single deposit
5. **Max batch size**: Configurable via env var (default 10, max 20)

### 2. Host API (`host/src/main.rs`)

**Current:** `/prove` endpoint accepts single deposit JSON  
**New:** `/prove` endpoint accepts batch JSON

```json
// Single deposit (backward compatible)
{
  "public": {...},
  "private": {...}
}

// Batch (new format)
{
  "batch": true,
  "deposits": [
    {"public": {...}, "private": {...}},
    {"public": {...}, "private": {...}}
  ]
}
```

**Key Changes:**
1. **Detect batch vs single**: Check for `batch` field or `deposits` array
2. **Same proving logic**: Both use same `prove()` call
3. **Response format**: Include batch metadata

```json
{
  "success": true,
  "batch_size": 5,
  "proving_time_ms": 23450,
  "effective_time_per_deposit_ms": 4690,
  "nullifiers": ["0x...", "0x..."],
  "proof": "0x...",
  "batch_commitment": "0x..."
}
```

### 3. Backend Client (`backend/theta-bridge/src/sp1-prover-client.js`)

**Current:** Sends each deposit immediately  
**New:** Accumulate deposits, send batches

**Batching Logic:**
```javascript
class SP1ProverClient {
  constructor() {
    this.batchQueue = [];
    this.batchSize = parseInt(process.env.BATCH_SIZE) || 5;
    this.batchTimeout = parseInt(process.env.BATCH_TIMEOUT_MS) || 30000;
    this.batchTimer = null;
  }

  async proveDeposit(depositData) {
    // Add to queue
    this.batchQueue.push(depositData);

    // Start timer if first deposit
    if (this.batchQueue.length === 1) {
      this.batchTimer = setTimeout(() => this.flushBatch(), this.batchTimeout);
    }

    // Flush if batch full
    if (this.batchQueue.length >= this.batchSize) {
      clearTimeout(this.batchTimer);
      return await this.flushBatch();
    }

    // Return pending promise
    return new Promise((resolve) => {
      this.batchQueue[this.batchQueue.length - 1].resolve = resolve;
    });
  }

  async flushBatch() {
    if (this.batchQueue.length === 0) return;

    const deposits = [...this.batchQueue];
    this.batchQueue = [];

    // Send batch proof request
    const response = await fetch(`${this.proverUrl}/prove`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        batch: true,
        deposits: deposits.map(d => d.data)
      })
    });

    const result = await response.json();

    // Resolve all pending promises
    deposits.forEach((d, i) => {
      d.resolve({
        nullifier: result.nullifiers[i],
        proof: result.proof,  // Same proof for all
        batch_commitment: result.batch_commitment
      });
    });

    return result;
  }
}
```

**Fallback Mode:**
- If `ENABLE_BATCHING=false`, send deposits immediately (Phase 0.5 behavior)
- Allows easy A/B testing

---

## Implementation Steps

### Step 1: Update Guest Program ✅

**File:** `sp1-prover/program/src/main.rs`

1. Add batch input structures (above)
2. Update `main()` to handle batch:

```rust
pub fn main() {
    // Check if batch or single
    let batch_public: BatchPublicInputs = sp1_zkvm::io::read();
    let batch_private: BatchPrivateInputs = sp1_zkvm::io::read();

    assert!(
        batch_public.batch_size == batch_public.deposits.len() as u32,
        "Batch size mismatch"
    );
    assert!(
        batch_public.batch_size <= 20,
        "Batch size too large (max 20)"
    );

    let mut nullifiers = Vec::new();
    let mut net_amounts = Vec::new();

    // Validate each deposit
    for i in 0..batch_public.batch_size as usize {
        let pub_in = &batch_public.deposits[i];
        let priv_in = &batch_private.deposits[i];

        // [EXISTING VALIDATION LOGIC HERE - extract to validate_deposit()]
        let nullifier = /* generate nullifier */;
        let net_amount = pub_in.net_amount.clone();

        nullifiers.push(nullifier);
        net_amounts.push(net_amount);
    }

    // Compute batch commitment
    let batch_commitment = compute_batch_commitment(&nullifiers, &net_amounts);

    // Commit outputs
    sp1_zkvm::io::commit(&BatchOutput {
        batch_size: batch_public.batch_size,
        nullifiers,
        net_amounts,
        batch_commitment,
    });
}

fn validate_deposit(pub_in: &PublicInputs, priv_in: &PrivateInputs) {
    // [MOVE EXISTING VALIDATION HERE]
}
```

### Step 2: Update Host API ✅

**File:** `sp1-prover/host/src/main.rs`

1. Add batch request/response types
2. Update `/prove` endpoint:

```rust
#[derive(Deserialize)]
#[serde(untagged)]
enum ProveRequest {
    Single { public: PublicInputs, private: PrivateInputs },
    Batch { batch: bool, deposits: Vec<DepositData> },
}

async fn generate_proof(req: ProveRequest) -> Result<ProofResponse> {
    let ctx = get_or_init_prover().await?;

    let mut stdin = SP1Stdin::new();

    match req {
        ProveRequest::Single { public, private } => {
            // Convert to batch of 1
            stdin.write(&BatchPublicInputs {
                batch_size: 1,
                deposits: vec![public],
            });
            stdin.write(&BatchPrivateInputs {
                deposits: vec![private],
            });
        }
        ProveRequest::Batch { deposits, .. } => {
            stdin.write(&BatchPublicInputs {
                batch_size: deposits.len() as u32,
                deposits: deposits.iter().map(|d| d.public.clone()).collect(),
            });
            stdin.write(&BatchPrivateInputs {
                deposits: deposits.iter().map(|d| d.private.clone()).collect(),
            });
        }
    }

    // Generate proof (same for both)
    let (proof, public_values) = ctx.client.prove(&ctx.pk, &stdin).run()?;

    // Parse batch output
    let output: BatchOutput = public_values.read();

    Ok(ProofResponse {
        batch_size: output.batch_size,
        nullifiers: output.nullifiers,
        proof: /* encode proof */,
        batch_commitment: output.batch_commitment,
        // ...
    })
}
```

### Step 3: Update Backend Client (Optional - Test with curl first) 🔜

**File:** `backend/theta-bridge/src/sp1-prover-client.js`

- Implement batching queue (as shown above)
- Add env vars: `ENABLE_BATCHING`, `BATCH_SIZE`, `BATCH_TIMEOUT_MS`
- For Phase 1, we can test with manual batch requests first

### Step 4: Build & Deploy ✅

```bash
# Build
cd sp1-prover
docker build -f Dockerfile.network -t sp1-prover-network:phase1-batch .

# Push to ECR
./push-ecr-alternative.ps1

# Update ECS
aws ecs update-service --cluster sp1-prover-cluster \
  --service sp1-prover-service \
  --task-definition sp1-prover-task:9 \
  --force-new-deployment
```

### Step 5: Benchmark ✅

**Test Plan (20 proofs):**
- 5 single deposits (batch_size=1) - baseline comparison
- 5 batch-of-3 (15 deposits total)
- 5 batch-of-5 (25 deposits total)
- 5 batch-of-10 (50 deposits total)

**Metrics to Track:**
- Total proving time (should still be ~23s per proof)
- Effective time per deposit (should be 23s / batch_size)
- Success rate
- Proof size (should be similar regardless of batch size)
- Cost per deposit (should be $0.20 / batch_size)

**Expected Results:**
| Batch Size | Proving Time | Effective Time/Deposit | Cost/Deposit |
|------------|--------------|------------------------|--------------|
| 1 (baseline) | 23s | 23s | $0.20 |
| 3 | 23s | 7.67s | $0.067 |
| 5 | 23s | 4.6s | $0.04 |
| 10 | 23s | 2.3s | $0.02 |

**Target Met:** Batch size 5 achieves <5s per deposit! ✅

---

## Risk Mitigation

1. **Cycle Count Explosion**: If 10 deposits = 10x cycles, proving might fail
   - **Mitigation**: Start with batch_size=3, test incrementally
   - **Fallback**: Cap at batch_size=5 if needed

2. **Proof Size Growth**: Larger proofs might timeout on network
   - **Mitigation**: Monitor proof sizes in benchmark
   - **Fallback**: Reduce batch size if proof >5MB

3. **Latency for First Deposit**: Waiting for batch to fill = delay
   - **Mitigation**: Set batch_timeout=30s (max wait)
   - **Fallback**: Allow "force immediate" flag for urgent deposits

4. **Backward Compatibility**: Existing clients expect single-deposit format
   - **Mitigation**: Support both formats (auto-detect)
   - **Testing**: Phase 1 benchmark includes single deposits

---

## Success Criteria

✅ **Phase 1 Goal Achieved IF:**
- Batch-of-5 proves successfully in ~23s
- Effective time per deposit <5s
- Success rate ≥ 95%
- Backward compatible with single deposits

🚀 **Stretch Goal:**
- Batch-of-10 works → 2.3s per deposit (90% cost reduction!)

---

## Post-Phase 1: Next Steps

If Phase 1 succeeds:
1. **Deploy to production** with `BATCH_SIZE=5`
2. **Monitor real-world batching** (how often batches fill)
3. **A/B test** batch sizes (3 vs 5 vs 10)
4. **Phase 2: Recursion** (if needed - combine multiple batch proofs)
5. **Phase 3: GPU** (defer until revenue justifies cost)

If Phase 1 fails (cycle explosion):
- **Fallback:** Optimize guest program further
- **Alternative:** Use SP1 Groth16 compression (smaller proofs, might be faster)

---

**Status:** Ready to implement!  
**Next Action:** Update guest program (`program/src/main.rs`) with batch validation
