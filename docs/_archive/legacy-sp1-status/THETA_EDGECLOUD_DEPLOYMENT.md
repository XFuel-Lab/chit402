# Theta EdgeCloud GPU Deployment Guide

**Deploy SP1 ZK Prover on Theta's GPU Network - Pay with TFUEL, No External APIs!**

---

## 🌐 Symbiotic Ecosystem Benefits

| Feature | Benefit |
|---------|---------|
| **Pay with TFUEL** | Keep value in Theta ecosystem |
| **Theta GPU Network** | Discounted compute vs cloud providers |
| **Self-Hosted** | No external API dependencies |
| **Decentralized** | Leverage 10,000+ edge nodes |
| **Privacy** | Proofs never leave your infrastructure |

---

## 🎯 What You Need (Simple!)

| Requirement | Need Manual Setup? | Details |
|-------------|-------------------|---------|
| **Theta EdgeCloud Account** | ❌ No | Just sign up at EdgeCloud dashboard |
| **SP1 API Key** | ❌ **NO!** | Not needed for GPU mode |
| **GPU Node Setup** | ❌ **NO!** | Select from marketplace |
| **CUDA Docker Image** | ✅ I provide this | `Dockerfile.cuda` ready to go |
| **Container Registry** | ✅ Push your image | Docker Hub, ECR, etc. |

**You do NOT need to manually set up a GPU node!** Theta EdgeCloud is a marketplace.

---

## 🚀 Deployment Steps (15 minutes)

### Step 1: Build CUDA Image Locally

```bash
cd sp1-prover

# Build the CUDA-enabled image
docker build -f Dockerfile.cuda -t sp1-prover-cuda:latest .

# Test locally (if you have NVIDIA GPU)
docker-compose -f docker-compose.cuda.yml up -d
curl http://localhost:8080/health
```

### Step 2: Push to Container Registry

```bash
# Option A: Docker Hub
docker tag sp1-prover-cuda:latest YOUR_DOCKERHUB/sp1-prover-cuda:latest
docker push YOUR_DOCKERHUB/sp1-prover-cuda:latest

# Option B: Amazon ECR
aws ecr get-login-password --region us-east-1 | docker login --username AWS --password-stdin YOUR_ECR_URL
docker tag sp1-prover-cuda:latest YOUR_ECR_URL/sp1-prover-cuda:latest
docker push YOUR_ECR_URL/sp1-prover-cuda:latest

# Option C: GitHub Container Registry
echo $GITHUB_TOKEN | docker login ghcr.io -u YOUR_USERNAME --password-stdin
docker tag sp1-prover-cuda:latest ghcr.io/YOUR_ORG/sp1-prover-cuda:latest
docker push ghcr.io/YOUR_ORG/sp1-prover-cuda:latest
```

### Step 3: Deploy on Theta EdgeCloud

1. **Log into Theta EdgeCloud Dashboard**
   - https://edgecloud.thetatoken.org (or your EdgeCloud portal)

2. **Create New Deployment**
   - Select "Container" or "Docker" deployment type
   - Enter your image URI: `YOUR_REGISTRY/sp1-prover-cuda:latest`

3. **Select GPU Hardware**
   - Choose from available GPU nodes
   - Recommended: NVIDIA RTX 4090, A100, or H100
   - Higher VRAM = faster proving

4. **Configure Environment**
   ```
   SP1_PROVER=cuda
   RUST_LOG=info
   CUDA_VISIBLE_DEVICES=0
   ```

5. **Set Resources**
   - GPU: 1 (required)
   - CPU: 4+ cores recommended
   - RAM: 16GB+ recommended
   - Port: 8080

6. **Deploy!**
   - Click deploy
   - Wait for container to start
   - Note your endpoint URL

### Step 4: Verify Deployment

```bash
# Health check
curl http://YOUR_EDGECLOUD_ENDPOINT:8080/health

# Test proof generation
curl -X POST http://YOUR_EDGECLOUD_ENDPOINT:8080/prove \
  -H "Content-Type: application/json" \
  -d @test-data/deposit-medium.json
```

---

## 📋 Environment Variables Reference

| Variable | Description | Example |
|----------|-------------|---------|
| `SP1_PRIVATE_KEY` | Direct SP1 API key | `sp_xxx...` |
| `SP1_PRIVATE_KEY_ARN` | AWS Secrets Manager ARN | `arn:aws:secretsmanager:...` |
| `SP1_PROVER` | Prover mode | `local`, `network`, `cuda` |
| `AWS_REGION` | AWS region | `us-east-1` |
| `AWS_ACCESS_KEY_ID` | AWS access key | `AKIA...` |
| `AWS_SECRET_ACCESS_KEY` | AWS secret key | `xxx...` |
| `RUST_LOG` | Log level | `info`, `debug` |

---

## 🧪 Testing the Deployment

### 1. Health Check

```bash
curl http://your-edgecloud-endpoint:8080/health
```

**Expected:**
```json
{"status": "healthy", "prover": "ready"}
```

### 2. Test Proof Generation

```bash
# Using the test data
curl -X POST http://your-edgecloud-endpoint:8080/prove \
  -H "Content-Type: application/json" \
  -d @test-data/deposit-medium.json
```

**Expected (Network mode):**
```json
{
  "proof": "base64...",
  "nullifier": "0x...",
  "proving_time_ms": 500
}
```

### 3. Benchmark

```bash
# Run 5 proof generations
for i in {1..5}; do
  echo "Run $i..."
  time curl -s -X POST http://your-edgecloud-endpoint:8080/prove \
    -H "Content-Type: application/json" \
    -d @test-data/deposit-medium.json | jq '.proving_time_ms'
done
```

---

## 🔒 Security Considerations

### 1. Never Hardcode Keys

```bash
# ❌ BAD - Don't do this
SP1_PRIVATE_KEY=sp_xxx_actual_key

# ✅ GOOD - Use AWS Secrets Manager
SP1_PRIVATE_KEY_ARN=arn:aws:secretsmanager:...
```

### 2. Use IAM Roles in Production

```yaml
# ECS Task Definition example
executionRoleArn: arn:aws:iam::123456789012:role/ecsTaskExecutionRole
taskRoleArn: arn:aws:iam::123456789012:role/xfuel-sp1-prover-role
```

### 3. Rotate Keys Regularly

```bash
# Update secret in AWS
aws secretsmanager update-secret \
  --secret-id xfuel/sp1-private-key \
  --secret-string "NEW_KEY_HERE"

# Restart containers to pick up new key
docker-compose restart
```

### 4. Monitor for Anomalies

- Track proving times (sudden spikes may indicate issues)
- Alert on failed proof attempts
- Log all proof requests with IP addresses

---

## 📊 Cost Comparison

### SP1 Network Mode
- **Per-proof cost:** ~$0.001-0.01 (estimated)
- **Monthly (10k proofs):** ~$10-100
- **No infrastructure management**

### Theta EdgeCloud GPU
- **GPU compute:** EdgeCloud pricing
- **Monthly (10k proofs @ 30s each):** ~$X (based on EdgeCloud rates)
- **Full infrastructure control**

### Recommendation

**Start with SP1 Network Mode** for simplicity and speed.

**Consider EdgeCloud GPU** if:
- Volume exceeds 100k+ proofs/month
- Need air-gapped/private proving
- Have existing GPU infrastructure

---

## 🚀 Quick Start Commands

```bash
# 1. Set up AWS secret (one-time)
aws secretsmanager create-secret \
  --name xfuel/sp1-private-key \
  --secret-string "YOUR_SP1_KEY"

# 2. Export ARN
export SP1_PRIVATE_KEY_ARN=$(aws secretsmanager describe-secret \
  --secret-id xfuel/sp1-private-key --query 'ARN' --output text)

# 3. Build and deploy
cd sp1-prover
docker-compose build
docker-compose up -d

# 4. Test
curl http://localhost:8080/health
```

---

## 📞 Support

- **SP1 Network Issues:** https://discord.gg/succinct
- **EdgeCloud Issues:** Theta EdgeCloud support
- **XFuel Issues:** GitHub Issues

---

**Ready to deploy! 🚀**
