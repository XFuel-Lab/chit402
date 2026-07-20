# Push SP1 Prover to Amazon ECR - Manual Steps

**Your AWS Account:** 187510174358  
**Region:** us-east-1  
**Image:** sp1-prover-cuda:latest (24.3GB)

---

## Option A: Use AWS Console (Easiest)

### Step 1: Create ECR Repository

1. Go to AWS Console: https://console.aws.amazon.com/ecr
2. Select region: **us-east-1**
3. Click "Create repository"
4. Repository name: `sp1-prover-cuda`
5. Leave as Private
6. Click "Create repository"

### Step 2: Get Push Commands

1. Select your new `sp1-prover-cuda` repository
2. Click "View push commands"
3. Copy the commands for Windows

### Step 3: Run Push Commands

The console will show you something like:

```powershell
# 1. Login to ECR
aws ecr get-login-password --region us-east-1 | docker login --username AWS --password-stdin 187510174358.dkr.ecr.us-east-1.amazonaws.com

# 2. Tag your image
docker tag sp1-prover-cuda:latest 187510174358.dkr.ecr.us-east-1.amazonaws.com/sp1-prover-cuda:latest

# 3. Push
docker push 187510174358.dkr.ecr.us-east-1.amazonaws.com/sp1-prover-cuda:latest
```

---

## Option B: Install AWS CLI First

### Install AWS CLI v2

```powershell
# Download installer
Start-BitsTransfer -Source https://awscli.amazonaws.com/AWSCLIV2.msi -Destination $env:TEMP\AWSCLIV2.msi

# Install
Start-Process msiexec.exe -ArgumentList "/i $env:TEMP\AWSCLIV2.msi /quiet" -Wait

# Restart PowerShell and verify
aws --version
```

### Then run push commands

```powershell
cd C:\Users\seeha\xfuel-protocol\sp1-prover

# 1. Create repository
aws ecr create-repository --repository-name sp1-prover-cuda --region us-east-1

# 2. Login
aws ecr get-login-password --region us-east-1 | docker login --username AWS --password-stdin 187510174358.dkr.ecr.us-east-1.amazonaws.com

# 3. Tag (already done!)
docker tag sp1-prover-cuda:latest 187510174358.dkr.ecr.us-east-1.amazonaws.com/sp1-prover-cuda:latest

# 4. Push (takes 5-10 minutes)
docker push 187510174358.dkr.ecr.us-east-1.amazonaws.com/sp1-prover-cuda:latest
```

---

## Option C: Use Docker Hub Instead (Faster Alternative)

If ECR is taking too long, use Docker Hub:

```powershell
# 1. Login (create account at hub.docker.com if needed)
docker login

# 2. Tag
docker tag sp1-prover-cuda:latest YOUR_DOCKERHUB_USERNAME/sp1-prover-cuda:latest

# 3. Push
docker push YOUR_DOCKERHUB_USERNAME/sp1-prover-cuda:latest

# Your image URL: docker.io/YOUR_DOCKERHUB_USERNAME/sp1-prover-cuda:latest
```

---

## After Push is Complete

### Your Image URLs

**ECR:**
```
187510174358.dkr.ecr.us-east-1.amazonaws.com/sp1-prover-cuda:latest
```

**Docker Hub (if you used it):**
```
docker.io/YOUR_USERNAME/sp1-prover-cuda:latest
```

---

## Deploy on Theta EdgeCloud

### 1. Login to EdgeCloud Dashboard
- URL: https://edgecloud.thetatoken.org

### 2. Create New Deployment

**Basic Configuration:**
- Name: `xfuel-sp1-prover`
- Type: Docker Container
- Image: `187510174358.dkr.ecr.us-east-1.amazonaws.com/sp1-prover-cuda:latest`

**If using ECR (Private Registry):**
- Enable "Private Registry"
- Registry URL: `187510174358.dkr.ecr.us-east-1.amazonaws.com`
- Username: `AWS`
- Password: (Get from `aws ecr get-login-password --region us-east-1`)

**Environment Variables:**
```
SP1_PROVER=cuda
RUST_LOG=info
CUDA_VISIBLE_DEVICES=0
```

**Port Mapping:**
```
Container Port: 8080
Host Port: 8080
Protocol: TCP
```

### 3. Select GPU Resources

**Hardware Selection:**
- ✅ GPU: NVIDIA RTX 4090 (or A100/H100 if available)
- CPU: 4+ cores
- RAM: 16GB
- Storage: 30GB

**GPU Settings:**
- GPU Count: 1
- Runtime: nvidia
- Capabilities: compute, utility

### 4. Deploy & Monitor

- Click "Deploy"
- Wait 2-5 minutes for container to start
- Check logs for: `🖥️  SP1_PROVER=cuda detected`
- Note your endpoint URL

### 5. Test

```powershell
# Health check
curl http://YOUR_EDGECLOUD_IP:8080/health

# Test proof
$json = Get-Content sp1-prover/test-data/deposit-medium.json -Raw
Invoke-RestMethod -Uri http://YOUR_EDGECLOUD_IP:8080/prove `
  -Method Post `
  -ContentType "application/json" `
  -Body $json
```

**Expected:** Proof in 10-30 seconds (depending on GPU tier)

---

## Next Steps

1. ✅ Image tagged for ECR
2. 📤 **YOU:** Push to ECR (or Docker Hub)
3. 🚀 **YOU:** Deploy on EdgeCloud dashboard
4. ✅ Test and benchmark
5. 🔗 Integrate with backend

---

**Ready! Follow Option A (AWS Console) for easiest push, or Option B if you want to install AWS CLI.** 🚀
