# 🚀 Deployment Guide - XFuelLab Backend with Reverse-Burn Loop

Complete deployment guide for the enhanced Node.js backend service.

---

## 📋 Pre-Deployment Checklist

### 1. Infrastructure Requirements

- [ ] **Server Specs**
  - CPU: 2+ cores
  - RAM: 4GB+ (recommended: 8GB)
  - Disk: 20GB+ SSD
  - OS: Ubuntu 22.04 LTS or similar

- [ ] **Network Requirements**
  - Public IP or domain
  - Open ports: 3001 (backend), 6379 (Redis - internal only)
  - SSL certificate (for HTTPS - optional but recommended)

- [ ] **External Services**
  - Theta RPC endpoints accessible
  - Persistence RPC/WebSocket accessible
  - Redis instance (local or managed)

### 2. Environment Configuration

- [ ] Copy `ENV_TEMPLATE.md` to `.env`
- [ ] Set `VAULT_FACTORY_ADDRESS` (deployed contract on Theta)
- [ ] Set `RELAYER_PRIVATE_KEY` (secure wallet with minimal funds)
- [ ] Configure `REVENUE_SPLITTER_ADDRESS` (for reverse-burn loop)
- [ ] Configure `SWAP_ROUTER_ADDRESS` (DEX router on Theta)
- [ ] Set `PERSISTENCE_WS_URL` and `PERSISTENCE_RPC_URL`
- [ ] Verify all RPC endpoints are reachable

### 3. Security Setup

- [ ] Use environment secrets manager (AWS Secrets, Vault, etc.)
- [ ] Limit relayer wallet funds (~10 TFUEL for gas)
- [ ] Enable firewall (only allow ports 22, 3001)
- [ ] Set up SSL/TLS for HTTPS
- [ ] Configure rate limiting
- [ ] Disable admin endpoints in production

---

## 🐳 Docker Deployment (Recommended)

### Prerequisites

```bash
# Install Docker
curl -fsSL https://get.docker.com -o get-docker.sh
sh get-docker.sh

# Install Docker Compose
sudo curl -L "https://github.com/docker/compose/releases/latest/download/docker-compose-$(uname -s)-$(uname -m)" -o /usr/local/bin/docker-compose
sudo chmod +x /usr/local/bin/docker-compose

# Verify installation
docker --version
docker-compose --version
```

### Deployment Steps

```bash
# 1. Clone repository
git clone https://github.com/xfuellab/xfuel-protocol.git
cd xfuel-protocol/backend/theta-bridge

# 2. Configure environment
cp ENV_TEMPLATE.md .env
nano .env  # Edit configuration

# 3. Create directories
mkdir -p logs circuits abis

# 4. Build and start services
docker-compose up -d

# 5. Check logs
docker-compose logs -f theta-bridge

# 6. Verify health
curl http://localhost:3001/health
```

### Docker Management

```bash
# View logs
docker-compose logs -f theta-bridge
docker-compose logs -f redis

# Restart service
docker-compose restart theta-bridge

# Stop services
docker-compose stop

# Remove containers
docker-compose down

# Rebuild after code changes
docker-compose build
docker-compose up -d

# View resource usage
docker stats theta-bridge theta-bridge-redis
```

---

## 🔧 PM2 Deployment (Alternative)

### Prerequisites

```bash
# Install Node.js 20+
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt-get install -y nodejs

# Install PM2 globally
sudo npm install -g pm2

# Install Redis
sudo apt-get install redis-server
sudo systemctl enable redis-server
sudo systemctl start redis-server
```

### Deployment Steps

```bash
# 1. Clone repository
git clone https://github.com/xfuellab/xfuel-protocol.git
cd xfuel-protocol/backend/theta-bridge

# 2. Install dependencies
npm install

# 3. Configure environment
cp ENV_TEMPLATE.md .env
nano .env  # Edit configuration

# 4. Create directories
mkdir -p logs circuits abis

# 5. Start with PM2
pm2 start ecosystem.config.cjs --env production

# 6. Save PM2 configuration
pm2 save
pm2 startup

# 7. Verify health
curl http://localhost:3001/health
```

### PM2 Management

```bash
# Monitor
pm2 monit

# View logs
pm2 logs theta-bridge
pm2 logs theta-bridge --lines 200

# Restart
pm2 restart theta-bridge

# Stop
pm2 stop theta-bridge

# Delete from PM2
pm2 delete theta-bridge

# View status
pm2 status

# View detailed info
pm2 info theta-bridge
```

---

## ☸️ Kubernetes Deployment (Advanced)

### Prerequisites

- Kubernetes cluster (EKS, GKE, AKS, or self-hosted)
- `kubectl` configured
- Helm 3+ installed

### Deployment Steps

```bash
# 1. Create namespace
kubectl create namespace xfuel-bridge

# 2. Create secret for environment variables
kubectl create secret generic bridge-env \
  --from-literal=RELAYER_PRIVATE_KEY=0x... \
  --from-literal=VAULT_FACTORY_ADDRESS=0x... \
  --from-literal=REVENUE_SPLITTER_ADDRESS=0x... \
  -n xfuel-bridge

# 3. Apply manifests
kubectl apply -f k8s/redis-deployment.yaml
kubectl apply -f k8s/bridge-deployment.yaml
kubectl apply -f k8s/bridge-service.yaml

# 4. Check status
kubectl get pods -n xfuel-bridge
kubectl logs -f deployment/theta-bridge -n xfuel-bridge

# 5. Expose service (LoadBalancer or Ingress)
kubectl apply -f k8s/ingress.yaml
```

### Kubernetes Manifests

**`k8s/bridge-deployment.yaml`:**
```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: theta-bridge
  namespace: xfuel-bridge
spec:
  replicas: 1
  selector:
    matchLabels:
      app: theta-bridge
  template:
    metadata:
      labels:
        app: theta-bridge
    spec:
      containers:
      - name: bridge
        image: xfuellab/theta-bridge:latest
        ports:
        - containerPort: 3001
        envFrom:
        - secretRef:
            name: bridge-env
        resources:
          requests:
            memory: "512Mi"
            cpu: "500m"
          limits:
            memory: "2Gi"
            cpu: "2000m"
        livenessProbe:
          httpGet:
            path: /health
            port: 3001
          initialDelaySeconds: 30
          periodSeconds: 10
        readinessProbe:
          httpGet:
            path: /health
            port: 3001
          initialDelaySeconds: 10
          periodSeconds: 5
```

---

## 📊 Monitoring Setup

### Prometheus Metrics (Optional)

Add `prom-client` to track custom metrics:

```javascript
// src/metrics.js
import client from 'prom-client';

const register = new client.Registry();

const depositsProcessed = new client.Counter({
  name: 'bridge_deposits_processed_total',
  help: 'Total deposits processed',
  registers: [register]
});

const reverseBurnsProcessed = new client.Counter({
  name: 'bridge_reverse_burns_processed_total',
  help: 'Total reverse-burn events processed',
  registers: [register]
});

export { register, depositsProcessed, reverseBurnsProcessed };
```

Expose metrics endpoint:

```javascript
// src/index.js
import { register } from './metrics.js';

app.get('/metrics', async (req, res) => {
  res.set('Content-Type', register.contentType);
  res.end(await register.metrics());
});
```

### Grafana Dashboard

Import pre-built dashboard for visualizations:
- Deposits per hour
- Reverse-burn events processed
- RPC endpoint latency
- Refund rate
- Yield unwrap success rate

---

## 🔒 Production Hardening

### 1. Environment Variables via Secrets Manager

**AWS Secrets Manager:**
```bash
# Store secrets
aws secretsmanager create-secret \
  --name xfuel-bridge/relayer-key \
  --secret-string "0x..."

# Retrieve in application
import { SecretsManager } from '@aws-sdk/client-secrets-manager';
const client = new SecretsManager({ region: 'us-east-1' });
const secret = await client.getSecretValue({ SecretId: 'xfuel-bridge/relayer-key' });
```

### 2. Rate Limiting

```javascript
import rateLimit from 'express-rate-limit';

const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100 // limit each IP to 100 requests per windowMs
});

app.use('/api/', limiter);
```

### 3. HTTPS Configuration

```javascript
import https from 'https';
import fs from 'fs';

const options = {
  key: fs.readFileSync('/path/to/privkey.pem'),
  cert: fs.readFileSync('/path/to/fullchain.pem')
};

https.createServer(options, app).listen(443);
```

### 4. Health Check Alerts

**Uptime Kuma / Pingdom / StatusCake:**
- Monitor: `https://your-domain.com/health`
- Alert on status !== "healthy"
- Alert on relayer balance < 1 TFUEL
- Alert on pending refunds > 10

---

## 🐛 Troubleshooting

### Issue: Container keeps restarting

```bash
# Check logs
docker-compose logs theta-bridge

# Common causes:
# - Invalid environment variables (VAULT_FACTORY_ADDRESS not set)
# - Redis not accessible
# - Port 3001 already in use

# Fix:
docker-compose down
nano .env  # Fix configuration
docker-compose up -d
```

### Issue: Reverse-burn events not detected

```bash
# Test Persistence WebSocket
wscat -c wss://rpc.persistence.one/websocket

# Check Redis
redis-cli KEYS "reverse-burn:*"

# Verify config
docker-compose exec theta-bridge env | grep PERSISTENCE

# Restart listener
docker-compose restart theta-bridge
```

### Issue: Out of memory

```bash
# Increase Docker memory limit
# Edit docker-compose.yml:
services:
  theta-bridge:
    deploy:
      resources:
        limits:
          memory: 2G

# Or PM2 config:
max_memory_restart: '2G'
```

---

## 🔄 Update & Rollback

### Update to New Version

```bash
# Docker
git pull origin main
cd backend/theta-bridge
docker-compose build
docker-compose up -d

# PM2
git pull origin main
cd backend/theta-bridge
npm install
pm2 restart theta-bridge
```

### Rollback

```bash
# Docker
git checkout <previous-commit>
docker-compose build
docker-compose up -d

# PM2
git checkout <previous-commit>
npm install
pm2 restart theta-bridge
```

---

## 📞 Support

- **Documentation**: See `README.md`
- **Issues**: GitHub Issues
- **Emergency**: Discord #tech-support

---

**Deployment complete! 🎉** Monitor the service via `/health` endpoint and review logs regularly.
