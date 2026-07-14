# SIMPLE DEPLOYMENT GUIDE - No Automation Needed

Your Docker image is already in ECR and ready to go!
**Image:** `187510174358.dkr.ecr.us-east-1.amazonaws.com/sp1-prover-cuda:latest`

---

## ✅ EASIEST OPTION: Manual Theta EdgeCloud Dashboard

Since the automation is hitting AWS credential issues, let's just deploy manually:

### Step 1: Login to Theta EdgeCloud Dashboard
Go to: https://edgecloud.thetatoken.org (or your Theta dashboard URL)

### Step 2: Create New Container Deployment
Click: "Deploy New Container" or "Create Deployment"

### Step 3: Fill in These Values

```
Deployment Name: xfuel-sp1-prover
Container Image: 187510174358.dkr.ecr.us-east-1.amazonaws.com/sp1-prover-cuda:latest

Registry Authentication:
  - Username: AWS
  - Password: (Run this in your working PowerShell):
      aws ecr get-login-password --region us-east-1
    Copy the output and paste it here

Environment Variables:
  - SP1_PROVER=cuda
  - RUST_LOG=info
  - CUDA_VISIBLE_DEVICES=0

Ports:
  - Container Port: 8080
  - Host Port: 8080
  - Protocol: TCP

Resources:
  - GPU: 1x NVIDIA RTX 4090 (or better: A100, H100)
  - CPU: 4 cores
  - Memory: 16Gi
  - Storage: 30Gi

Restart Policy: unless-stopped

Health Check:
  - Path: /health
  - Port: 8080
  - Interval: 30s
```

### Step 4: Deploy!
Click "Deploy" or "Create"

Wait 2-5 minutes for the container to pull and start.

### Step 5: Get Your Endpoint
Once deployed, Theta will give you an endpoint like:
- `http://node-123.edgecloud.theta.tv:8080`
- Or an IP: `http://XX.XX.XX.XX:8080`

### Step 6: Test It!
```powershell
curl http://YOUR-ENDPOINT:8080/health
```

Should return: `{"status":"healthy"}`

---

## 🚀 ALTERNATIVE: Deploy to Your Own GPU Server

If you have a server with an NVIDIA GPU:

```bash
# SSH to your server
ssh your-gpu-server

# Login to ECR (need AWS credentials on the server)
aws ecr get-login-password --region us-east-1 | \
  docker login --username AWS --password-stdin \
  187510174358.dkr.ecr.us-east-1.amazonaws.com

# Pull and run
docker run -d \
  --name sp1-prover \
  --gpus all \
  -p 8080:8080 \
  -e SP1_PROVER=cuda \
  -e RUST_LOG=info \
  --restart unless-stopped \
  187510174358.dkr.ecr.us-east-1.amazonaws.com/sp1-prover-cuda:latest

# Check status
docker logs sp1-prover
curl http://localhost:8080/health
```

---

## 📝 After Deployment

Once you have your prover endpoint, update your backend:

**In `.env.local`:**
```bash
SP1_PROVER_URL=http://your-theta-node:8080
```

**Test the integration:**
```bash
curl -X POST http://your-theta-node:8080/prove \
  -H "Content-Type: application/json" \
  -d @test-data/deposit-1tfuel.json
```

Should return a proof in ~10-30 seconds (GPU mode)!

---

## 🎯 Next Steps After Successful Deployment

1. ✅ Verify proof generation works
2. ✅ Update backend to use the prover endpoint
3. ✅ Run end-to-end test (deposit → proof → verify)
4. ✅ Monitor performance and costs

---

**Which deployment method are you using?**
1. Theta EdgeCloud Dashboard (manual)
2. Your own GPU server
3. Need help finding Theta API documentation
