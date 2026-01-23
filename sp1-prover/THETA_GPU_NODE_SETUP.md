# Theta EdgeCloud GPU Node Deployment Guide

Based on your dashboard, here's what to do:

---

## Option 1: Create GPU Node (RECOMMENDED)

This gives you a dedicated GPU instance where you can run your Docker container.

### Step 1: Create GPU Node
1. Click "Create GPU Node" (or similar option)
2. Select GPU type:
   - **RTX 4090** (good for proving, cost-effective)
   - **A100** (better performance, higher cost)
   - **H100** (best performance, highest cost)
3. Choose location (closest to your users)
4. Set compute hours or on-demand pricing

### Step 2: Connect to Your GPU Node
Once provisioned, you'll get:
- **SSH access:** `ssh user@your-node-ip`
- **Node IP address:** `XX.XX.XX.XX`
- **Credentials** to login

### Step 3: Deploy Your Container on the Node
SSH into your GPU node and run:

```bash
# SSH to your Theta GPU node
ssh user@your-theta-node-ip

# Install Docker (if not already installed)
# Most Theta nodes come with Docker + NVIDIA runtime pre-installed

# Check GPU is available
nvidia-smi

# Login to ECR (you'll need AWS credentials)
# Option A: If AWS CLI is installed on the node
aws ecr get-login-password --region us-east-1 | \
  docker login --username AWS --password-stdin \
  187510174358.dkr.ecr.us-east-1.amazonaws.com

# Option B: If no AWS CLI, use a long-lived token
# (Get token from your local machine first):
# Run locally: aws ecr get-login-password --region us-east-1
# Then on the node:
echo "YOUR_ECR_PASSWORD" | docker login --username AWS --password-stdin \
  187510174358.dkr.ecr.us-east-1.amazonaws.com

# Pull and run your SP1 prover
docker run -d \
  --name sp1-prover \
  --gpus all \
  -p 8080:8080 \
  -e SP1_PROVER=cuda \
  -e RUST_LOG=info \
  --restart unless-stopped \
  187510174358.dkr.ecr.us-east-1.amazonaws.com/sp1-prover-cuda:latest

# Check it's running
docker ps
docker logs sp1-prover

# Test the endpoint
curl http://localhost:8080/health
```

### Step 4: Access from Outside
Your prover will be available at:
- `http://YOUR-THETA-NODE-IP:8080`

Make sure port 8080 is open in the node's firewall/security group.

---

## Option 2: If Theta Uses Pre-configured Deployments

If the dashboard only shows "Llama API" or similar pre-configured services, you might need to:

### A. Use Docker Compose on the GPU Node
If you can SSH to a GPU node, create a `docker-compose.yml`:

```yaml
version: '3.8'
services:
  sp1-prover:
    image: 187510174358.dkr.ecr.us-east-1.amazonaws.com/sp1-prover-cuda:latest
    ports:
      - "8080:8080"
    environment:
      - SP1_PROVER=cuda
      - RUST_LOG=info
    deploy:
      resources:
        reservations:
          devices:
            - driver: nvidia
              count: 1
              capabilities: [gpu]
    restart: unless-stopped
```

Then:
```bash
docker-compose up -d
```

### B. Use Kubernetes (if Theta supports it)
If Theta uses Kubernetes for deployments:

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: sp1-prover
spec:
  replicas: 1
  selector:
    matchLabels:
      app: sp1-prover
  template:
    metadata:
      labels:
        app: sp1-prover
    spec:
      containers:
      - name: sp1-prover
        image: 187510174358.dkr.ecr.us-east-1.amazonaws.com/sp1-prover-cuda:latest
        ports:
        - containerPort: 8080
        env:
        - name: SP1_PROVER
          value: cuda
        - name: RUST_LOG
          value: info
        resources:
          limits:
            nvidia.com/gpu: 1
---
apiVersion: v1
kind: Service
metadata:
  name: sp1-prover
spec:
  type: LoadBalancer
  ports:
  - port: 8080
    targetPort: 8080
  selector:
    app: sp1-prover
```

---

## What You Need to Tell Me

To give you exact steps, please check:

1. **After clicking "Create GPU Node"**, what options do you see?
   - Does it give you SSH access?
   - Does it show a way to deploy containers?
   - What's the setup process?

2. **Screenshot or describe the interface** you're seeing
   - What are all the available options?
   - Is there a "Custom Container" or "Docker Deployment" option?

3. **Theta EdgeCloud documentation link** (if available)
   - Do they have docs on deploying custom containers?

---

## Fastest Path Forward

**I recommend: Create GPU Node**

Once you create a GPU node:
1. You'll get SSH access
2. You can run Docker commands directly
3. Full control over your container
4. You can update/restart the prover anytime

**Click "Create GPU Node" and let me know what happens next!**

I'll guide you through the exact commands once you have the node provisioned.

---

## Alternative: Local Testing First

While figuring out Theta, you can test locally if you have a GPU:

```powershell
# On your local machine (if you have NVIDIA GPU)
docker run -d --gpus all -p 8080:8080 \
  -e SP1_PROVER=cuda \
  187510174358.dkr.ecr.us-east-1.amazonaws.com/sp1-prover-cuda:latest

# Test
curl http://localhost:8080/health
```

This way you can verify the image works while setting up Theta!
