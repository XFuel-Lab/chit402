# Reverse-Burn Loop Deployment Guide

Complete deployment guide for the XFuelLab Hybrid ZK Bridge reverse-burn loop functionality.

## Table of Contents

1. [Prerequisites](#prerequisites)
2. [Environment Configuration](#environment-configuration)
3. [Docker Deployment](#docker-deployment)
4. [PM2 Deployment](#pm2-deployment)
5. [Kubernetes Deployment](#kubernetes-deployment)
6. [Verification](#verification)
7. [Monitoring](#monitoring)
8. [Troubleshooting](#troubleshooting)

---

## Prerequisites

### Required

- **Node.js**: >= 20.0.0
- **Redis**: >= 7.0
- **Docker** (for Docker deployment): >= 24.0
- **PM2** (for PM2 deployment): >= 5.0

### Required Accounts & Keys

1. **Relayer Wallet**: Ethereum-compatible wallet with TFUEL for gas
2. **Contract Addresses**:
   - VaultFactory (Theta)
   - RevenueSplitter (Theta)
   - Swap Router (Theta DEX)
3. **RPC Access**:
   - Theta mainnet/testnet RPC endpoints
   - Persistence mainnet RPC endpoint
   - Persistence WebSocket endpoint

---

## Environment Configuration

### Step 1: Copy Environment Template

```bash
cd backend/theta-bridge
cp env.example .env
```

### Step 2: Configure Core Settings

Edit `.env` with your values:

```bash
# ============================================
# THETA CONFIGURATION
# ============================================
THETA_RPC_URLS=https://eth-rpc-api.thetatoken.org/rpc,https://theta-eth-rpc.thetatoken.org/rpc

# Contract addresses on Theta
VAULT_FACTORY_ADDRESS=0xYOUR_VAULT_FACTORY_ADDRESS
REVENUE_SPLITTER_ADDRESS=0xYOUR_REVENUE_SPLITTER_ADDRESS
SWAP_ROUTER_ADDRESS=0xYOUR_SWAP_ROUTER_ADDRESS

# ============================================
# PERSISTENCE CONFIGURATION
# ============================================
PERSISTENCE_RPC_URL=https://rpc.persistence.one
PERSISTENCE_WS_URL=wss://rpc.persistence.one/websocket
PERSISTENCE_CHAIN_ID=core-1
PERSISTENCE_BURN_EVENT_TOPIC=burn_ibcTFUEL
PERSISTENCE_POLL_INTERVAL_MS=10000

# ============================================
# REVERSE-BURN LOOP CONFIGURATION
# ============================================
# Yield distribution (must sum to 100)
YIELD_UNWRAP_PERCENTAGE=30
YIELD_REINVEST_PERCENTAGE=70

# Minimum yield to process (1 USDC = 1000000)
MIN_YIELD_AMOUNT=1000000

# ============================================
# RELAYER CONFIGURATION
# ============================================
RELAYER_PRIVATE_KEY=0xYOUR_RELAYER_PRIVATE_KEY
RELAYER_GAS_LIMIT=200000
RELAYER_MAX_FEE_PER_GAS=100000000000

# ============================================
# REDIS CONFIGURATION
# ============================================
REDIS_URL=redis://localhost:6379
REDIS_PASSWORD=
REDIS_DB=0

# ============================================
# SERVICE CONFIGURATION
# ============================================
PORT=3001
LOG_LEVEL=info
NODE_ENV=production

# ============================================
# RETRY & TIMEOUT CONFIGURATION
# ============================================
MAX_RETRIES=3
RETRY_DELAY_MS=5000
RPC_TIMEOUT_MS=30000
REQUIRED_CONFIRMATIONS=3
BLOCK_POLL_INTERVAL_MS=5000
```

### Step 3: Validate Configuration

```bash
# Test configuration loading
node -e "require('dotenv').config(); console.log('✓ Environment loaded');"

# Verify required variables
node -e "
require('dotenv').config();
const required = ['VAULT_FACTORY_ADDRESS', 'RELAYER_PRIVATE_KEY', 'REVENUE_SPLITTER_ADDRESS'];
required.forEach(k => {
  if (!process.env[k]) throw new Error(\`Missing: \${k}\`);
});
console.log('✓ All required variables set');
"
```

---

## Docker Deployment

### Quick Start

```bash
# Navigate to bridge directory
cd backend/theta-bridge

# Build and start all services
docker-compose up -d

# Check logs
docker-compose logs -f theta-bridge

# Verify health
curl http://localhost:3001/health | jq
```

### Step-by-Step Docker Deployment

#### 1. Build Docker Image

```bash
docker-compose build theta-bridge
```

**Expected output:**
```
Successfully built 1234567890ab
Successfully tagged theta-bridge:latest
```

#### 2. Start Services

```bash
# Start in detached mode
docker-compose up -d

# Or start with logs
docker-compose up
```

**Services started:**
- `theta-bridge`: Main service (port 3001)
- `redis`: Redis database (port 6379)

#### 3. Verify Containers

```bash
docker-compose ps
```

**Expected output:**
```
NAME                  STATUS         PORTS
theta-bridge          Up 30 seconds  0.0.0.0:3001->3001/tcp
theta-bridge-redis    Up 30 seconds  0.0.0.0:6379->6379/tcp
```

#### 4. Check Health

```bash
# Wait for startup (40 seconds)
sleep 45

# Check health endpoint
curl http://localhost:3001/health

# Check reverse-burn status specifically
curl http://localhost:3001/health | jq '.components.reverseBurn'
```

**Expected response:**
```json
{
  "enabled": true,
  "persistenceListener": {
    "isListening": true,
    "wsConnected": true,
    "lastBlockHeight": 12345678,
    "processedEventCount": 0
  },
  "yieldUnwrapper": {
    "isProcessing": true,
    "queueSize": 0,
    "config": {
      "unwrapPercentage": 30,
      "reinvestPercentage": 70,
      "minYieldAmount": "1000000"
    }
  },
  "stats": {
    "total": 0,
    "pending": 0,
    "completed": 0,
    "failed": 0,
    "belowThreshold": 0
  }
}
```

### Docker Management Commands

```bash
# View logs
docker-compose logs -f theta-bridge
docker-compose logs -f redis

# Restart service
docker-compose restart theta-bridge

# Stop services
docker-compose stop

# Stop and remove containers
docker-compose down

# Stop and remove with volumes (clean slate)
docker-compose down -v

# Update and restart
docker-compose pull
docker-compose up -d --build
```

### Docker Production Optimization

Edit `docker-compose.yml` for production:

```yaml
services:
  theta-bridge:
    # ... existing config ...
    deploy:
      resources:
        limits:
          cpus: '2'
          memory: 2G
        reservations:
          cpus: '1'
          memory: 1G
    restart: always
```

---

## PM2 Deployment

### Quick Start

```bash
# Navigate to bridge directory
cd backend/theta-bridge

# Install dependencies
npm install

# Install PM2 globally
npm install -g pm2

# Start service
pm2 start ecosystem.config.cjs

# Monitor
pm2 monit
```

### Step-by-Step PM2 Deployment

#### 1. Install Dependencies

```bash
npm install

# Verify installation
npm list --depth=0
```

#### 2. Start Redis (if not using Docker)

```bash
# Option A: Using Docker
docker run -d --name theta-redis -p 6379:6379 redis:7-alpine

# Option B: Native Redis (Linux)
sudo systemctl start redis

# Option C: Native Redis (Mac)
brew services start redis

# Option D: Native Redis (Windows)
redis-server
```

#### 3. Install PM2

```bash
# Install globally
npm install -g pm2

# Verify installation
pm2 --version
```

#### 4. Start Service

```bash
# Start with ecosystem config
pm2 start ecosystem.config.cjs

# Or start manually with options
pm2 start src/index.js --name theta-bridge --time
```

**Expected output:**
```
┌─────┬────────────────┬─────────┬─────────┬─────────┬──────────┬────────┐
│ id  │ name           │ mode    │ ↺       │ status  │ cpu      │ memory │
├─────┼────────────────┼─────────┼─────────┼─────────┼──────────┼────────┤
│ 0   │ theta-bridge   │ fork    │ 0       │ online  │ 0%       │ 45.2mb │
└─────┴────────────────┴─────────┴─────────┴─────────┴──────────┴────────┘
```

#### 5. Verify Running

```bash
# Check status
pm2 status

# View logs
pm2 logs theta-bridge

# Monitor in real-time
pm2 monit
```

#### 6. Check Health

```bash
# Wait for startup
sleep 10

# Check health
curl http://localhost:3001/health | jq
```

### PM2 Management Commands

```bash
# Status and Info
pm2 status                    # List all processes
pm2 info theta-bridge        # Detailed info
pm2 describe theta-bridge    # Same as info

# Logs
pm2 logs                      # All logs
pm2 logs theta-bridge        # Specific process
pm2 logs --lines 100         # Last 100 lines
pm2 flush                    # Clear log files

# Control
pm2 restart theta-bridge     # Restart
pm2 reload theta-bridge      # Zero-downtime reload
pm2 stop theta-bridge        # Stop
pm2 delete theta-bridge      # Remove from PM2

# Monitoring
pm2 monit                    # Real-time monitoring
pm2 plus                     # PM2 Plus monitoring (cloud)

# Startup Script
pm2 startup                  # Generate startup script
pm2 save                     # Save current process list
pm2 unstartup                # Remove startup script
```

### PM2 Production Configuration

For production, update `ecosystem.config.cjs`:

```javascript
module.exports = {
  apps: [{
    name: 'theta-bridge',
    script: './src/index.js',
    instances: 1,
    exec_mode: 'fork',
    autorestart: true,
    watch: false,
    max_memory_restart: '1G',
    
    // Production environment
    env_production: {
      NODE_ENV: 'production',
      LOG_LEVEL: 'info',
      YIELD_UNWRAP_PERCENTAGE: '30',
      YIELD_REINVEST_PERCENTAGE: '70'
    },
    
    // Restart policy
    min_uptime: '10s',
    max_restarts: 10,
    restart_delay: 4000,
    
    // Graceful shutdown
    kill_timeout: 10000,
    listen_timeout: 5000,
    
    // Log rotation
    error_file: './logs/error.log',
    out_file: './logs/out.log',
    log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
    merge_logs: true,
    
    // Cron restart (daily at 3 AM)
    cron_restart: '0 3 * * *'
  }]
};
```

Start with production env:

```bash
pm2 start ecosystem.config.cjs --env production
```

---

## Kubernetes Deployment

### Kubernetes Manifests

Create `k8s/deployment.yaml`:

```yaml
apiVersion: v1
kind: Namespace
metadata:
  name: theta-bridge

---
apiVersion: v1
kind: ConfigMap
metadata:
  name: theta-bridge-config
  namespace: theta-bridge
data:
  THETA_RPC_URLS: "https://eth-rpc-api.thetatoken.org/rpc,https://theta-eth-rpc.thetatoken.org/rpc"
  PERSISTENCE_RPC_URL: "https://rpc.persistence.one"
  PERSISTENCE_WS_URL: "wss://rpc.persistence.one/websocket"
  PERSISTENCE_CHAIN_ID: "core-1"
  PERSISTENCE_BURN_EVENT_TOPIC: "burn_ibcTFUEL"
  PERSISTENCE_POLL_INTERVAL_MS: "10000"
  YIELD_UNWRAP_PERCENTAGE: "30"
  YIELD_REINVEST_PERCENTAGE: "70"
  MIN_YIELD_AMOUNT: "1000000"
  REDIS_URL: "redis://theta-bridge-redis:6379"
  PORT: "3001"
  LOG_LEVEL: "info"
  NODE_ENV: "production"

---
apiVersion: v1
kind: Secret
metadata:
  name: theta-bridge-secrets
  namespace: theta-bridge
type: Opaque
stringData:
  RELAYER_PRIVATE_KEY: "0xYOUR_PRIVATE_KEY"
  VAULT_FACTORY_ADDRESS: "0xYOUR_VAULT_FACTORY"
  REVENUE_SPLITTER_ADDRESS: "0xYOUR_REVENUE_SPLITTER"
  SWAP_ROUTER_ADDRESS: "0xYOUR_SWAP_ROUTER"

---
apiVersion: apps/v1
kind: Deployment
metadata:
  name: theta-bridge
  namespace: theta-bridge
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
      - name: theta-bridge
        image: theta-bridge:latest
        imagePullPolicy: IfNotPresent
        ports:
        - containerPort: 3001
          name: http
        envFrom:
        - configMapRef:
            name: theta-bridge-config
        - secretRef:
            name: theta-bridge-secrets
        resources:
          requests:
            cpu: 500m
            memory: 512Mi
          limits:
            cpu: 2000m
            memory: 2Gi
        livenessProbe:
          httpGet:
            path: /health
            port: 3001
          initialDelaySeconds: 60
          periodSeconds: 30
          timeoutSeconds: 10
        readinessProbe:
          httpGet:
            path: /health
            port: 3001
          initialDelaySeconds: 45
          periodSeconds: 10
          timeoutSeconds: 5

---
apiVersion: v1
kind: Service
metadata:
  name: theta-bridge
  namespace: theta-bridge
spec:
  selector:
    app: theta-bridge
  ports:
  - protocol: TCP
    port: 3001
    targetPort: 3001
  type: LoadBalancer

---
apiVersion: apps/v1
kind: StatefulSet
metadata:
  name: theta-bridge-redis
  namespace: theta-bridge
spec:
  serviceName: theta-bridge-redis
  replicas: 1
  selector:
    matchLabels:
      app: redis
  template:
    metadata:
      labels:
        app: redis
    spec:
      containers:
      - name: redis
        image: redis:7-alpine
        ports:
        - containerPort: 6379
          name: redis
        volumeMounts:
        - name: redis-data
          mountPath: /data
        resources:
          requests:
            cpu: 100m
            memory: 128Mi
          limits:
            cpu: 500m
            memory: 512Mi
  volumeClaimTemplates:
  - metadata:
      name: redis-data
    spec:
      accessModes: ["ReadWriteOnce"]
      resources:
        requests:
          storage: 10Gi

---
apiVersion: v1
kind: Service
metadata:
  name: theta-bridge-redis
  namespace: theta-bridge
spec:
  selector:
    app: redis
  ports:
  - protocol: TCP
    port: 6379
    targetPort: 6379
  clusterIP: None
```

### Deploy to Kubernetes

```bash
# Apply manifests
kubectl apply -f k8s/deployment.yaml

# Check deployment
kubectl get pods -n theta-bridge
kubectl get services -n theta-bridge

# View logs
kubectl logs -f deployment/theta-bridge -n theta-bridge

# Check health
kubectl port-forward service/theta-bridge 3001:3001 -n theta-bridge
curl http://localhost:3001/health
```

---

## Verification

### 1. Service Health Check

```bash
curl http://localhost:3001/health | jq
```

**Verify:**
- ✅ `status: "healthy"`
- ✅ `components.rpc.status: "connected"`
- ✅ `components.redis.status: "connected"`
- ✅ `components.reverseBurn.enabled: true`
- ✅ `components.reverseBurn.persistenceListener.isListening: true`
- ✅ `components.reverseBurn.yieldUnwrapper.isProcessing: true`

### 2. Persistence Connection

```bash
curl http://localhost:3001/health | jq '.components.reverseBurn.persistenceListener'
```

**Verify:**
- ✅ `isListening: true`
- ✅ `wsConnected: true` (or graceful fallback to polling)
- ✅ `reconnectAttempts: 0` (no connection issues)

### 3. Yield Unwrapper

```bash
curl http://localhost:3001/health | jq '.components.reverseBurn.yieldUnwrapper'
```

**Verify:**
- ✅ `isProcessing: true`
- ✅ `config.unwrapPercentage: 30`
- ✅ `config.reinvestPercentage: 70`

### 4. RPC Endpoints

```bash
curl http://localhost:3001/api/rpc/health | jq
```

**Verify:**
- ✅ At least one endpoint with `healthy: true`
- ✅ Active endpoint has low latency (<1000ms)

### 5. Redis Connection

```bash
# Test Redis directly
redis-cli ping
# Expected: PONG

# Check stored data
redis-cli --scan --pattern "reverse-burn:*"
redis-cli --scan --pattern "vault:*"
```

### 6. Forward Flow (Deposit Listener)

```bash
curl http://localhost:3001/status | jq '.listener'
```

**Verify:**
- ✅ `isListening: true`
- ✅ `lastProcessedBlock > 0`

---

## Monitoring

### Real-Time Logs

```bash
# Docker
docker-compose logs -f theta-bridge | grep -i "reverse\|burn\|yield"

# PM2
pm2 logs theta-bridge --lines 100 | grep -i "reverse\|burn\|yield"

# Kubernetes
kubectl logs -f deployment/theta-bridge -n theta-bridge | grep -i "reverse\|burn\|yield"
```

### Key Metrics to Monitor

1. **Reverse-Burn Events Processed**
```bash
watch -n 5 'curl -s http://localhost:3001/health | jq ".components.reverseBurn.stats"'
```

2. **Yield Processing Success Rate**
```bash
curl -s http://localhost:3001/health | jq ".components.reverseBurn.stats" | \
  jq 'if .total > 0 then (.completed / .total * 100) else 0 end'
```

3. **WebSocket Connection Status**
```bash
watch -n 10 'curl -s http://localhost:3001/health | jq ".components.reverseBurn.persistenceListener.wsConnected"'
```

4. **Processing Queue Size**
```bash
watch -n 5 'curl -s http://localhost:3001/health | jq ".components.reverseBurn.yieldUnwrapper.queueSize"'
```

### Prometheus Metrics (Optional)

Add metrics endpoint to `src/index.js`:

```javascript
// Install: npm install prom-client
import client from 'prom-client';

const register = new client.Register();

// Define metrics
const reverseBurnCounter = new client.Counter({
  name: 'reverse_burn_events_total',
  help: 'Total reverse-burn events processed',
  labelNames: ['status'],
  registers: [register]
});

// Metrics endpoint
app.get('/metrics', async (req, res) => {
  res.set('Content-Type', register.contentType);
  res.end(await register.metrics());
});
```

---

## Troubleshooting

### Issue: Reverse-Burn Disabled

**Symptom:**
```json
{"reverseBurn": {"enabled": false}}
```

**Cause:** Missing `REVENUE_SPLITTER_ADDRESS`

**Solution:**
```bash
# Add to .env
echo "REVENUE_SPLITTER_ADDRESS=0xYOUR_ADDRESS" >> .env

# Restart
docker-compose restart theta-bridge
# OR
pm2 restart theta-bridge
```

### Issue: WebSocket Connection Failed

**Symptom:**
```
ERROR: Persistence WebSocket error: connect ECONNREFUSED
```

**Cause:** Persistence RPC WebSocket endpoint unreachable

**Solution:**
1. Check endpoint: `PERSISTENCE_WS_URL=wss://rpc.persistence.one/websocket`
2. Test connectivity: `wscat -c wss://rpc.persistence.one/websocket`
3. System automatically falls back to polling
4. Check firewall/network rules if persistent

### Issue: Events Stuck in Pending

**Symptom:**
```json
{"stats": {"pending": 10, "completed": 0}}
```

**Possible Causes & Solutions:**

1. **Insufficient Gas:**
```bash
# Check relayer balance
curl http://localhost:3001/health | jq '.components.refundManager.relayerBalance'

# Fund relayer wallet with TFUEL
```

2. **Invalid Contract Addresses:**
```bash
# Verify addresses
node -e "require('dotenv').config(); console.log(process.env.REVENUE_SPLITTER_ADDRESS)"
```

3. **Network Issues:**
```bash
# Check RPC health
curl http://localhost:3001/api/rpc/health | jq
```

### Issue: High Error Rate

**Symptom:**
```json
{"stats": {"failed": 50, "completed": 10}}
```

**Diagnosis:**
```bash
# Check error logs
docker-compose logs theta-bridge | grep ERROR | tail -20

# Or with PM2
pm2 logs theta-bridge --err --lines 20
```

**Common Errors:**
- `Refund transaction reverted` → Check relayer permissions
- `Swap failed` → Check swap router configuration
- `Redis connection lost` → Restart Redis

### Issue: Memory Leak

**Symptom:**
Service restarts frequently with `max_memory_restart`

**Diagnosis:**
```bash
# Monitor memory
pm2 monit

# Or Docker stats
docker stats theta-bridge
```

**Solution:**
1. Check for unprocessed events piling up in Redis
2. Increase `max_memory_restart` if needed
3. Review logs for memory-intensive operations

### Issue: Slow Processing

**Symptom:**
Queue size increasing, processing slow

**Diagnosis:**
```bash
# Check queue size
watch -n 5 'curl -s http://localhost:3001/health | jq ".components.reverseBurn.yieldUnwrapper.queueSize"'
```

**Solutions:**
1. Reduce `PERSISTENCE_POLL_INTERVAL_MS` (but watch rate limits)
2. Check network latency to RPC endpoints
3. Ensure Redis is responsive (`redis-cli --latency`)
4. Consider horizontal scaling (multiple workers)

---

## Production Checklist

Before going live:

### Security
- [ ] Move private keys to secrets manager (AWS Secrets, Vault)
- [ ] Enable HTTPS for API endpoints
- [ ] Set up firewall rules (only allow necessary ports)
- [ ] Rotate relayer wallet periodically
- [ ] Implement rate limiting on API endpoints

### Reliability
- [ ] Set up automated backups for Redis data
- [ ] Configure alerting (PagerDuty, Slack, etc.)
- [ ] Test failover scenarios (RPC down, Redis down)
- [ ] Document rollback procedures
- [ ] Set up log aggregation (ELK, Datadog)

### Performance
- [ ] Load test with expected transaction volume
- [ ] Tune `PERSISTENCE_POLL_INTERVAL_MS` based on chain finality
- [ ] Configure Redis persistence (AOF or RDB)
- [ ] Set up CDN/load balancer for API if needed

### Monitoring
- [ ] Set up Prometheus + Grafana dashboard
- [ ] Configure alerts for failed transactions > threshold
- [ ] Monitor relayer wallet balance
- [ ] Track yield processing success rate
- [ ] Set up uptime monitoring (UptimeRobot, Pingdom)

### Documentation
- [ ] Document runbook for common issues
- [ ] Create incident response playbook
- [ ] Train team on monitoring and troubleshooting
- [ ] Document escalation procedures

---

## Next Steps

After successful deployment:

1. **Monitor for 24 hours** - Watch logs and metrics closely
2. **Test end-to-end** - Trigger test burn event on testnet
3. **Verify yield processing** - Confirm 30/70 split working correctly
4. **Check revenue routing** - Verify TFUEL reaching RevenueSplitter
5. **Review logs** - Look for any warnings or errors
6. **Optimize configuration** - Tune polling intervals and thresholds

---

## Support

For deployment issues:

1. Check logs first: `docker-compose logs` or `pm2 logs`
2. Verify health endpoint: `curl http://localhost:3001/health`
3. Review environment variables: Check `.env` file
4. Consult documentation: [REVERSE_BURN_LOOP.md](./REVERSE_BURN_LOOP.md)
5. Check Redis: `redis-cli ping` and `redis-cli INFO`

---

**Deployment Version:** 2.0.0  
**Last Updated:** 2024-01-01  
**Status:** ✅ Production Ready (with placeholder integrations)




