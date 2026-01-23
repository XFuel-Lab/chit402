# SP1 Network Mode Deployment Guide

**Simpler, faster alternative to GPU proving!**

---

## Why SP1 Network Mode?

✅ **Sub-second proving** (< 1s)
✅ **No GPU needed** (simpler deployment)
✅ **No CUDA hassles** (just works everywhere)
✅ **Pay-as-you-go** (PROVE tokens)
✅ **Deploy anywhere** (AWS, Railway, Render, even Theta!)

---

## Step 1: Build Network Mode Image

```powershell
cd sp1-prover

# Build
docker build -f Dockerfile.network -t xfuel/sp1-prover-network:latest .

# Push to Docker Hub
docker push xfuel/sp1-prover-network:latest
```

---

## Step 2: Deploy (Multiple Options)

### Option A: AWS ECS/Fargate (Recommended)
- Simple, scalable, integrates with your AWS setup
- Uses existing SP1_PRIVATE_KEY from Secrets Manager
- $20-40/month for small instance

### Option B: Railway.app
- Super simple deployment
- Connect GitHub repo
- Add `SP1_PRIVATE_KEY` env var
- Auto-deploy on push
- ~$5/month

### Option C: Render.com
- Similar to Railway
- Docker-based
- ~$7/month

### Option D: Theta EdgeCloud (Non-GPU)
- Same as before but without GPU
- Much cheaper than GPU nodes
- Uses your TFUEL

---

## Step 3: Environment Setup

Whichever platform you choose, you need to inject `SP1_PRIVATE_KEY`:

### If using AWS Secrets Manager:
```bash
SP1_PRIVATE_KEY_ARN=arn:aws:secretsmanager:us-east-1:187510174358:secret:SP1_PRIVATE_KEY-XXXXX
```

### Or direct (less secure):
```bash
SP1_PRIVATE_KEY=your_key_here
```

---

## Step 4: Test

Once deployed:
```powershell
# Health check
curl https://YOUR-ENDPOINT/health

# Generate proof (should be < 1s!)
curl -X POST https://YOUR-ENDPOINT/prove \
  -H "Content-Type: application/json" \
  -d @test-data/deposit-1tfuel.json
```

---

## Next Steps

Which deployment option do you prefer?

1. **AWS ECS** - Integrates with your existing AWS setup
2. **Railway/Render** - Simplest deployment (5 minutes)
3. **Theta EdgeCloud** - Keep it on Theta (non-GPU)

Let me know and I'll guide you through!
