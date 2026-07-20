# Deploy SP1 Prover on Theta EdgeCloud - Step by Step

**Your Image:** `187510174358.dkr.ecr.us-east-1.amazonaws.com/sp1-prover-cuda:latest`

---

## 🚀 Deployment Steps

### Step 1: Access Theta EdgeCloud Dashboard

1. Go to: **https://edgecloud.thetatoken.org** (or your EdgeCloud portal URL)
2. Login with your Theta credentials
3. Navigate to "Deployments" or "Containers" section

### Step 2: Create New Deployment

Click **"New Deployment"** or **"Deploy Container"**

### Step 3: Container Configuration

**Basic Settings:**

| Field | Value |
|-------|-------|
| **Name** | `xfuel-sp1-prover` (or any name you prefer) |
| **Deployment Type** | Docker Container |
| **Image** | `187510174358.dkr.ecr.us-east-1.amazonaws.com/sp1-prover-cuda:latest` |

**Registry Authentication (IMPORTANT - Private ECR):**

Since this is a private ECR repository, you need to authenticate:

- ☑️ Enable "Private Registry" or "Registry Auth"
- **Registry URL:** `187510174358.dkr.ecr.us-east-1.amazonaws.com`
- **Username:** `AWS`
- **Password:** Run this in PowerShell to get the password:
  ```powershell
  aws ecr get-login-password --region us-east-1
  ```
  Copy the output (long token starting with "eyJ...")

### Step 4: Environment Variables

Add these environment variables:

```
SP1_PROVER=cuda
RUST_LOG=info
CUDA_VISIBLE_DEVICES=0
```

### Step 5: Port Configuration

**Port Mapping:**

| Container Port | Host Port | Protocol |
|----------------|-----------|----------|
| 8080 | 8080 | TCP |

Or use any available host port (e.g., 80, 443, 3000)

### Step 6: GPU Resource Selection

**CRITICAL: Select GPU-enabled node**

**Recommended Configuration:**

| Resource | Recommendation |
|----------|----------------|
| **GPU** | 1x NVIDIA RTX 4090 (or A100/H100 if available) |
| **CPU** | 4-8 cores |
| **RAM** | 16GB - 32GB |
| **Storage** | 30GB - 50GB |

**GPU Settings (if available):**
- Runtime: `nvidia`
- GPU Capabilities: `compute, utility`
- GPU Count: `1`

### Step 7: Advanced Settings (Optional)

**Restart Policy:**
- Restart: `Unless Stopped` or `Always`

**Health Check (if supported):**
- Path: `/health`
- Port: `8080`
- Interval: `30s`

### Step 8: Review & Deploy

1. Review all settings
2. Click **"Deploy"** or **"Launch"**
3. Wait 2-5 minutes for deployment

---

## ✅ Verify Deployment

### 1. Check Deployment Status

In the EdgeCloud dashboard:
- Status should be: **Running** or **Healthy**
- Note your **public IP** or **endpoint URL**

### 2. Check Container Logs

Look for these success messages:
```
🖥️  SP1_PROVER=cuda detected - using CUDA GPU proving mode
   Running on local GPU (10-30s per proof)
   Perfect for Theta EdgeCloud GPU nodes!
🚀 Starting SP1 prover HTTP server on port 8080
✅ Server listening on 0.0.0.0:8080
```

### 3. Test Health Endpoint

```powershell
# Replace YOUR_IP with your EdgeCloud endpoint
curl http://YOUR_IP:8080/health
```

**Expected Response:**
```json
{"status":"healthy","prover":"ready"}
```

### 4. Test Proof Generation

```powershell
# Test a proof (takes 10-30s on GPU)
$endpoint = "http://YOUR_IP:8080"
$json = Get-Content C:\Users\seeha\xfuel-protocol\sp1-prover\test-data\deposit-medium.json -Raw

$start = Get-Date
$result = Invoke-RestMethod -Uri "$endpoint/prove" `
  -Method Post `
  -ContentType "application/json" `
  -Body $json `
  -TimeoutSec 120

$elapsed = ((Get-Date) - $start).TotalSeconds

Write-Host "✅ Proof generated!" -ForegroundColor Green
Write-Host "Proving time: $($result.proving_time_ms)ms" -ForegroundColor Yellow
Write-Host "Total time: ${elapsed}s" -ForegroundColor Cyan
```

**Expected Performance:**
- RTX 4090: ~10-20 seconds
- A100: ~5-15 seconds
- H100: ~3-10 seconds

---

## 🔧 Troubleshooting

### Issue: "Image pull failed"

**Solution:** Check registry authentication
- Verify password is correct (regenerate if needed)
- Password expires after 12 hours - regenerate: `aws ecr get-login-password --region us-east-1`

### Issue: "Container keeps restarting"

**Solution:** Check logs for errors
- Common cause: No GPU detected
- Ensure GPU-enabled node is selected
- Check `CUDA_VISIBLE_DEVICES` is set

### Issue: "GPU not detected"

**Solution:**
- Verify node has NVIDIA GPU
- Check runtime is set to `nvidia`
- Ensure GPU capabilities are enabled

### Issue: "Slow proving (>60s)"

**Solution:**
- Check GPU utilization in dashboard
- Verify CUDA is being used (check logs)
- Consider upgrading to higher-tier GPU

---

## 📊 Monitor Performance

### Key Metrics to Track

1. **Proving Time:** Should be 10-30s (depending on GPU)
2. **Success Rate:** Should be >99%
3. **GPU Utilization:** Should be high during proving
4. **TFUEL Cost:** Monitor daily spend

### Set Up Alerts

- Proving time > 60 seconds
- Container restart
- Success rate < 95%
- High TFUEL burn rate

---

## 🔗 Integrate with Backend

Once deployed, update your backend configuration:

**File:** `backend/theta-bridge/.env`

```bash
# SP1 Prover Configuration
PROVER_URL=http://YOUR_EDGECLOUD_IP:8080
PROVER_TIMEOUT_MS=60000  # 60 seconds for GPU proving
```

**File:** `backend/theta-bridge/listener.ts`

Use the `ProverClient` class (from PRODUCTION_ENABLEMENT.md) to call your EdgeCloud endpoint.

---

## 💰 Cost Optimization

### Estimated TFUEL Costs

| GPU Type | Proving Time | Proofs/Hour | Daily Cost (1000 proofs) |
|----------|--------------|-------------|--------------------------|
| RTX 4090 | ~15s | ~240 | X TFUEL* |
| A100 | ~10s | ~360 | Y TFUEL* |
| H100 | ~5s | ~720 | Z TFUEL* |

*Check current EdgeCloud GPU pricing

### Tips to Reduce Costs

1. **Batch Processing:** Queue multiple proofs to keep GPU busy
2. **Auto-scaling:** Scale down during low traffic hours
3. **Right-size GPU:** Don't over-provision
4. **Monitor Usage:** Track costs daily

---

## 🎯 Next Steps

1. ✅ Deploy on EdgeCloud (follow steps above)
2. ✅ Test and verify performance
3. ✅ Update backend configuration
4. ✅ Monitor costs and performance
5. ✅ Scale as needed

---

## 📞 Support

- **Theta EdgeCloud:** https://discord.gg/thetatoken
- **SP1 Issues:** https://discord.gg/succinct
- **XFuel Issues:** GitHub Issues

---

**You're ready to deploy! Follow the steps above and you'll have GPU-accelerated ZK proving on Theta EdgeCloud!** 🚀

**Deployment Time: 5-10 minutes**
**Expected Performance: 10-30s per proof**
**No external APIs needed - Pure Theta ecosystem!**
