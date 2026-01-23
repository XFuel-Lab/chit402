# Automated Deployment to Theta EdgeCloud via API

**Much easier than manual dashboard setup!**

---

## 🚀 Prerequisites

1. Theta EdgeCloud API key
2. Your Docker image (already in ECR): `187510174358.dkr.ecr.us-east-1.amazonaws.com/sp1-prover-cuda:latest`
3. TFUEL wallet for payments

---

## Step 1: Get Theta EdgeCloud API Key

### Option A: Via EdgeCloud Dashboard
1. Login to https://edgecloud.thetatoken.org
2. Go to Settings → API Keys
3. Create new API key
4. Copy the key

### Option B: Via CLI (if available)
```bash
theta-edge-cli login
theta-edge-cli api-key create --name "sp1-prover"
```

---

## Step 2: Add API Key to Your Environment

Add to your `.env.local`:

```bash
# Theta EdgeCloud Configuration
THETA_EDGECLOUD_API_KEY=your_api_key_here
THETA_EDGECLOUD_API_URL=https://api.edgecloud.thetatoken.org  # or actual API endpoint
```

---

## Step 3: Automated Deployment Script

I'll create a deployment script that uses the Theta API to deploy your container automatically.

### Using Node.js (Recommended - matches your backend)

Create: `sp1-prover/deploy-edgecloud.js`

```javascript
const https = require('https');
const http = require('http');
require('dotenv').config({ path: '../.env.local' });

const EDGECLOUD_API_KEY = process.env.THETA_EDGECLOUD_API_KEY;
const EDGECLOUD_API_URL = process.env.THETA_EDGECLOUD_API_URL || 'https://api.edgecloud.thetatoken.org';

// Deployment configuration
const deployment = {
  name: 'xfuel-sp1-prover',
  image: '187510174358.dkr.ecr.us-east-1.amazonaws.com/sp1-prover-cuda:latest',
  registry: {
    url: '187510174358.dkr.ecr.us-east-1.amazonaws.com',
    username: 'AWS',
    password: process.env.ECR_PASSWORD || '' // Get from: aws ecr get-login-password
  },
  environment: {
    SP1_PROVER: 'cuda',
    RUST_LOG: 'info',
    CUDA_VISIBLE_DEVICES: '0'
  },
  ports: [
    { container: 8080, host: 8080, protocol: 'tcp' }
  ],
  resources: {
    gpu: {
      type: 'nvidia',
      count: 1,
      model: 'rtx4090' // or 'a100', 'h100'
    },
    cpu: 4,
    memory: '16Gi',
    storage: '30Gi'
  },
  restart: 'unless-stopped',
  healthCheck: {
    path: '/health',
    port: 8080,
    interval: 30
  }
};

async function deployToEdgeCloud() {
  console.log('🚀 Deploying SP1 Prover to Theta EdgeCloud...\n');
  
  // 1. Authenticate
  console.log('🔐 Authenticating...');
  // Implementation depends on Theta EdgeCloud API spec
  
  // 2. Deploy container
  console.log('📦 Creating deployment...');
  const response = await fetch(`${EDGECLOUD_API_URL}/v1/deployments`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${EDGECLOUD_API_KEY}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(deployment)
  });
  
  if (!response.ok) {
    throw new Error(`Deployment failed: ${response.statusText}`);
  }
  
  const result = await response.json();
  console.log('✅ Deployment created!');
  console.log(`   Deployment ID: ${result.id}`);
  console.log(`   Status: ${result.status}`);
  console.log(`   Endpoint: ${result.endpoint}`);
  
  return result;
}

// Run deployment
deployToEdgeCloud()
  .then(result => {
    console.log('\n✅ SUCCESS!');
    console.log(`Your SP1 prover is deployed at: ${result.endpoint}`);
  })
  .catch(error => {
    console.error('\n❌ ERROR:', error.message);
    process.exit(1);
  });
```

---

## Step 4: Alternative - Use Theta CLI

If Theta has a CLI tool:

```bash
# Install Theta CLI
npm install -g @thetatoken/edge-cli

# Login
theta-edge login --api-key YOUR_API_KEY

# Deploy
theta-edge deploy \
  --name xfuel-sp1-prover \
  --image 187510174358.dkr.ecr.us-east-1.amazonaws.com/sp1-prover-cuda:latest \
  --registry-auth AWS:$(aws ecr get-login-password --region us-east-1) \
  --gpu nvidia-rtx4090 \
  --env SP1_PROVER=cuda \
  --env RUST_LOG=info \
  --port 8080:8080

# Check status
theta-edge status xfuel-sp1-prover

# Get endpoint
theta-edge endpoint xfuel-sp1-prover
```

---

## Step 5: Integrate Deployment into Backend

Add to your `backend/theta-bridge/deploy-prover.ts`:

```typescript
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

export async function deployProverToEdgeCloud(): Promise<string> {
  console.log('Deploying SP1 prover to Theta EdgeCloud...');
  
  // Get ECR password
  const { stdout: ecrPassword } = await execAsync(
    'aws ecr get-login-password --region us-east-1'
  );
  
  // Deploy using Theta API or CLI
  const { stdout } = await execAsync(
    `node sp1-prover/deploy-edgecloud.js`
  );
  
  // Parse endpoint from output
  const endpoint = stdout.match(/endpoint: (http[^\s]+)/)?.[1];
  
  if (!endpoint) {
    throw new Error('Failed to get prover endpoint');
  }
  
  console.log(`✅ Prover deployed at: ${endpoint}`);
  return endpoint;
}

// Auto-deploy on backend startup
if (process.env.AUTO_DEPLOY_PROVER === 'true') {
  deployProverToEdgeCloud()
    .then(endpoint => {
      process.env.PROVER_URL = endpoint;
      console.log('✅ Prover ready!');
    })
    .catch(console.error);
}
```

---

## What I Need from You

To create the exact deployment script, I need:

1. **Theta EdgeCloud API documentation URL** (or API endpoint)
2. **Do you have a Theta EdgeCloud API key?** If not, we can get one together
3. **Theta wallet address** (for TFUEL payments)

Alternatively, if Theta EdgeCloud uses a different deployment method (like Kubernetes manifests, Terraform, etc.), let me know and I'll adjust!

---

## Simpler Alternative: Docker Compose on Your Own Server

If Theta EdgeCloud setup is complex, you could also:

**Deploy to your own GPU server:**

```yaml
# docker-compose.production.yml
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
    restart: always
```

Then just:
```bash
ssh your-gpu-server
docker-compose -f docker-compose.production.yml up -d
```

---

**Which approach would you prefer?**

1. **Theta EdgeCloud API** (I'll create the script once you provide the API details)
2. **Your own GPU server** (simpler, but you manage infrastructure)
3. **Help getting Theta EdgeCloud API key** (I'll guide you)

Let me know and I'll get you set up! 🚀
