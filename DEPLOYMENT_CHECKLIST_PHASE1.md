# Phase 1 Deployment Checklist

## ✅ Status: READY TO DEPLOY

All Phase 1 implementation is complete. Follow these steps to enable batching in production.

---

## 🚀 Quick Deployment (5 minutes)

### Step 1: Update Environment Variables
Add these to your `.env` or `.env.local` file in `backend/theta-bridge/`:

```bash
# Update prover URL to Phase 1 endpoint
SP1_PROVER_URL=http://3.83.140.122:8080

# Enable batching (Phase 1)
SP1_BATCHING_ENABLED=true
SP1_BATCH_SIZE=10
SP1_BATCH_TIMEOUT_MS=10000
SP1_MIN_BATCH_SIZE=5
```

### Step 2: Restart Backend Service
```bash
cd backend/theta-bridge
npm run start
# OR if using PM2:
pm2 restart theta-bridge
```

### Step 3: Verify
Check logs for confirmation:
```
SP1ProverClient initialized with batching configuration
  batchingEnabled: true
  batchSize: 10
  batchTimeoutMs: 10000
  minBatchSize: 5
```

---

## 📊 Expected Results

After deployment, you should see:

1. **Cost Reduction**: 90% (from ~$100/day to ~$10/day for 1000 deposits)
2. **Performance**: 2.25s effective time per deposit
3. **Throughput**: 11.6x increase
4. **Latency**: Max 10s wait for batching (configurable)

---

## 🔍 Monitoring (First Week)

### Watch These Logs
```bash
# Backend logs
pm2 logs theta-bridge

# Key events to monitor:
# - "Added deposit to batch queue" (deposits accumulating)
# - "Batch full, processing immediately" (batches filling up)
# - "Batch proof generated successfully" (batches completing)
# - "Batch timeout reached" (partial batches due to low volume)
```

### Check Batch Stats (Optional)
In your backend code, you can add monitoring:
```javascript
import { getSP1Prover } from './sp1-prover-client.js';

setInterval(() => {
  const stats = getSP1Prover().getBatchStats();
  console.log('Batch stats:', stats);
}, 60000); // Every minute
```

---

## 🐛 Troubleshooting

### Issue: Batches Never Fill
**Symptom**: Always seeing "processing as single deposits"  
**Solution**: Increase `SP1_BATCH_TIMEOUT_MS` to 30000 (30s) or reduce `SP1_BATCH_SIZE` to 5

### Issue: High Latency
**Symptom**: Users complaining about slow proofs  
**Solution**: Reduce `SP1_BATCH_TIMEOUT_MS` to 5000 (5s)

### Issue: Want to Disable Temporarily
**Solution**: Set `SP1_BATCHING_ENABLED=false` and restart

---

## 📚 Documentation

For detailed configuration options, see:
- `backend/theta-bridge/BATCHING_CONFIGURATION.md` - Full configuration guide
- `sp1-prover/BENCHMARK_RESULTS_PHASE1.md` - Performance benchmarks
- `sp1-prover/PHASE1_EXECUTION_LOG.md` - Complete implementation log

---

## 🎯 Next Steps After Deployment

1. **Week 1**: Monitor batch fill rates and cost savings
2. **Week 2**: Optimize `BATCH_SIZE` and `BATCH_TIMEOUT_MS` based on observed patterns
3. **Month 1**: Evaluate if GPU testing (Phase 2) is justified by revenue

---

**All files updated:**
- ✅ `backend/theta-bridge/src/sp1-prover-client.js` (batching logic)
- ✅ `sp1-prover/program/src/main.rs` (batch validation)
- ✅ `sp1-prover/host/src/main.rs` (batch API)
- ✅ ECS service deployed (`http://3.83.140.122:8080`)
- ✅ Benchmarked (20/20 tests passed, 100% success rate)
- ✅ Documented (4 comprehensive guides)

**Ready to deploy!** 🚀
