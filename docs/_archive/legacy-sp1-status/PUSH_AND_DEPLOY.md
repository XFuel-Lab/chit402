# Push & Deploy to Theta EdgeCloud - Quick Guide

## Step 1: Push to Container Registry

### Option A: Docker Hub

```powershell
# Login
docker login

# Tag
docker tag sp1-prover-cuda:latest YOUR_DOCKERHUB_USERNAME/sp1-prover-cuda:latest

# Push
docker push YOUR_DOCKERHUB_USERNAME/sp1-prover-cuda:latest

# Your image URL:
# docker.io/YOUR_DOCKERHUB_USERNAME/sp1-prover-cuda:latest
```

### Option B: Amazon ECR

```powershell
# Login (replace with your region and account ID)
aws ecr get-login-password --region us-east-1 | docker login --username AWS --password-stdin YOUR_ACCOUNT_ID.dkr.ecr.us-east-1.amazonaws.com

# Create repository (first time only)
aws ecr create-repository --repository-name sp1-prover-cuda --region us-east-1

# Tag
docker tag sp1-prover-cuda:latest YOUR_ACCOUNT_ID.dkr.ecr.us-east-1.amazonaws.com/sp1-prover-cuda:latest

# Push
docker push YOUR_ACCOUNT_ID.dkr.ecr.us-east-1.amazonaws.com/sp1-prover-cuda:latest

# Your image URL:
# YOUR_ACCOUNT_ID.dkr.ecr.us-east-1.amazonaws.com/sp1-prover-cuda:latest
```

### Option C: GitHub Container Registry

```powershell
# Login (create token at github.com/settings/tokens)
echo $env:GITHUB_TOKEN | docker login ghcr.io -u YOUR_USERNAME --password-stdin

# Tag
docker tag sp1-prover-cuda:latest ghcr.io/YOUR_ORG/sp1-prover-cuda:latest

# Push
docker push ghcr.io/YOUR_ORG/sp1-prover-cuda:latest

# Your image URL:
# ghcr.io/YOUR_ORG/sp1-prover-cuda:latest
```

---

## Step 2: Deploy on Theta EdgeCloud

### Via EdgeCloud Dashboard

1. **Login to Theta EdgeCloud**
   - URL: https://edgecloud.thetatoken.org
   - Or your EdgeCloud portal

2. **Create New Deployment**
   - Click "Deploy Container" or "New Service"
   - Deployment Type: Docker Container

3. **Configure Container**
   
   **Image:**
   ```
   YOUR_REGISTRY/sp1-prover-cuda:latest
   ```
   
   **Environment Variables:**
   ```
   SP1_PROVER=cuda
   RUST_LOG=info
   CUDA_VISIBLE_DEVICES=0
   ```
   
   **Port Mapping:**
   ```
   Container Port: 8080
   Host Port: 8080 (or your preferred port)
   ```

4. **Select GPU Hardware**
   - Resource Type: GPU-enabled node
   - GPU: NVIDIA (RTX 4090, A100, or H100)
   - Recommended:
     - GPU: 1x NVIDIA RTX 4090 or better
     - CPU: 4+ cores
     - RAM: 16GB+
     - Storage: 30GB+

5. **Advanced Settings (if available)**
   
   **Runtime:**
   ```
   nvidia
   ```
   
   **GPU Capabilities:**
   ```
   compute, utility
   ```

6. **Deploy!**
   - Review configuration
   - Click "Deploy" or "Launch"
   - Wait for deployment (2-5 minutes)

7. **Get Your Endpoint**
   - Note the public IP or domain
   - Format: `http://YOUR_EDGECLOUD_IP:8080`

---

## Step 3: Verify Deployment

```powershell
# Health check
curl http://YOUR_EDGECLOUD_ENDPOINT:8080/health

# Expected response:
# {"status": "healthy", "prover": "ready"}

# Test proof generation
$json = Get-Content sp1-prover/test-data/deposit-medium.json -Raw
Invoke-RestMethod -Uri http://YOUR_EDGECLOUD_ENDPOINT:8080/prove `
  -Method Post `
  -ContentType "application/json" `
  -Body $json

# Expected: Proof in ~10-30 seconds (depending on GPU)
```

---

## Step 4: Benchmark Performance

```powershell
# Run benchmark against EdgeCloud endpoint
cd sp1-prover
$env:PROVER_URL = "http://YOUR_EDGECLOUD_ENDPOINT:8080"

# Quick test (1 proof)
$start = Get-Date
$json = Get-Content test-data/deposit-medium.json -Raw
$result = Invoke-RestMethod -Uri "$env:PROVER_URL/prove" -Method Post -Body $json
$elapsed = ((Get-Date) - $start).TotalSeconds
Write-Host "Proof generated in: $($result.proving_time_ms)ms (total: ${elapsed}s)"

# Expected on Theta GPU:
# - RTX 4090: 10-20 seconds
# - A100: 5-15 seconds
# - H100: 3-10 seconds
```

---

## Troubleshooting

### Image pull fails
- Check registry credentials in EdgeCloud
- Make image public or add registry auth

### Container crashes
```bash
# Check logs in EdgeCloud dashboard
# Common issues:
# - GPU not detected: Ensure GPU-enabled node selected
# - Out of memory: Increase RAM allocation
# - Port conflict: Change host port
```

### GPU not detected
- Verify node has NVIDIA GPU
- Check `CUDA_VISIBLE_DEVICES` is set
- Ensure nvidia runtime is enabled

### Slow proving (>60s)
- Check GPU utilization in dashboard
- Verify CUDA is actually being used
- Consider upgrading to higher-tier GPU

---

## Cost Optimization

### TFUEL Usage Estimates

| GPU Type | Proving Time | Estimated Cost/Proof |
|----------|--------------|---------------------|
| RTX 4090 | ~15s | X TFUEL* |
| A100 | ~10s | Y TFUEL* |
| H100 | ~5s | Z TFUEL* |

*Check current EdgeCloud GPU pricing

### Tips to Reduce Costs

1. **Batch Processing:** Queue multiple proofs
2. **Auto-scaling:** Scale down during low traffic
3. **Spot Instances:** Use if EdgeCloud supports it
4. **Right-size GPU:** Don't over-provision

---

## Integration with Backend

Update your backend to use the EdgeCloud endpoint:

```typescript
// backend/theta-bridge/.env
PROVER_URL=http://YOUR_EDGECLOUD_ENDPOINT:8080
PROVER_TIMEOUT_MS=60000  # 60 seconds for GPU proving
```

---

## Monitoring

### Key Metrics to Track

- **Proving Time:** Should be 10-30s
- **Success Rate:** Should be >99%
- **GPU Utilization:** Should be high during proving
- **TFUEL Costs:** Monitor daily spend

### Alerts to Set Up

- Proving time > 60 seconds
- Success rate < 95%
- Container restart
- High TFUEL burn rate

---

## Next Steps

1. ✅ Image built: `sp1-prover-cuda:latest`
2. 📤 Push to registry (follow Option A/B/C above)
3. 🚀 Deploy on EdgeCloud dashboard
4. ✅ Test and benchmark
5. 🔗 Integrate with backend

---

**You're ready to deploy! Choose your registry and let's push the image.** 🚀
