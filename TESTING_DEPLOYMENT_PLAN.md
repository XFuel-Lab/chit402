# IBC Channel-190 Testing & Deployment Plan

## 🧪 Phase 1: Local Testing (15 minutes)

### Step 1: Install Dependencies
```bash
npm install
```

**New packages installed:**
- `@cosmjs/cosmwasm-stargate` - CosmWasm contract execution
- `@cosmjs/proto-signing` - Cosmos wallet signing
- `cors` - CORS middleware

### Step 2: Configure Environment
```bash
# Copy .env.local.example to .env.local
# Fill in these required values:

THETA_DEPOSIT_ADDRESS=0x6256D8A728aA102Aa06B6B239ba1247Bd835d816
IBC_CHANNEL=channel-190
PERSISTENCE_DEXTER_ROUTER=persistence1k4q9wtawxxk6v2x5v4t9q8r3j9w3j9j0j0j0j0
PSTAKE_STAKING_CONTRACT=persistence1x5q8j0j0j0j0j0j0j0j0j0j0j0j0j0j0j0j0j0
TFUEL_IBC_DENOM=ibc/...  # Get from Persistence docs
IBC_WALLET_MNEMONIC="your twelve words here"  # SECRET!
```

### Step 3: Start Services (2 Terminals)

**Terminal 1 - Frontend:**
```bash
npm run dev
# Should start on http://localhost:5173
```

**Terminal 2 - IBC Service:**
```bash
npm run dev:ibc
# Should start on http://localhost:3002
```

**Expected Output:**
```
🚀 XFUEL IBC Routing Service
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
✅ Configuration valid
✅ Listener initialized
✅ IBC client initialized
✅ DEX client initialized
✅ Staking client initialized
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
🌐 API server listening on http://localhost:3002
🎧 Starting blockchain listener...
```

### Step 4: Test API Endpoints

```bash
# Health check
curl http://localhost:3002/api/ibc/health

# Expected: {"status":"ok","service":"IBC Routing",...}

# Stats
curl http://localhost:3002/api/ibc/stats

# Expected: {"success":true,"stats":{...}}
```

---

## 🧪 Phase 2: Integration Testing (30 minutes)

### Test 1: Frontend Components

**Test Manual Trigger Modal:**
1. Open http://localhost:5173
2. Navigate to Swap page
3. Click "📱 Deposit TFUEL via QR"
4. QR code should display
5. Deposit address should be copyable

**Test Status Card:**
1. Open browser DevTools console
2. Type: `import('./components/IbcStatusCard')`
3. Verify component renders without errors

### Test 2: API Manual Trigger

```bash
# Test manual trigger with dummy data
curl -X POST http://localhost:3002/api/ibc/trigger \
  -H "Content-Type: application/json" \
  -d '{
    "thetaTxHash": "0xtest123...",
    "recipientAddress": "persistence1testaddress..."
  }'

# Expected: Error (transaction not found) - but validates API works
```

### Test 3: Transaction Database

```bash
# Check database created
cat backend/ibc/transactions.json

# Expected: {"transactions":{},"lastProcessedBlock":0,"lastUpdated":...}
```

---

## 🚀 Phase 3: Testnet Deployment (1 hour)

### Step 1: Set Up Testnet Environment

```bash
# Create .env.testnet
THETA_RPC_URL=https://eth-rpc-api-testnet.thetatoken.org/rpc
THETA_DEPOSIT_ADDRESS=0x...  # Your testnet address
PERSISTENCE_RPC_URL=https://rpc-testnet.core.persistence.one
IBC_WALLET_MNEMONIC="testnet mnemonic here"
```

### Step 2: Fund Testnet Wallet

1. Get Theta testnet TFUEL: https://faucet.testnet.theta.org/request
2. Get Persistence testnet XPRT: https://faucet.persistence.one
3. Verify balances:
```bash
# Check Theta balance
curl -X POST https://eth-rpc-api-testnet.thetatoken.org/rpc \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","method":"eth_getBalance","params":["0x...","latest"],"id":1}'
```

### Step 3: Test Small Deposit

1. Send 1 TFUEL to `THETA_DEPOSIT_ADDRESS`
2. Include recipient address in transaction data:
```javascript
// In Theta Wallet:
data: Buffer.from('persistence1...').toString('hex')
```
3. Monitor logs: `pm2 logs xfuel-ibc`
4. Check transaction status:
```bash
curl http://localhost:3002/api/ibc/status/0x[txhash]
```

---

## 🌐 Phase 4: Production Deployment

### Option A: Deploy to VPS (Recommended)

**Requirements:**
- Ubuntu 20.04+ VPS
- 2GB RAM minimum
- Node.js 24+
- PM2 process manager

**Steps:**

```bash
# 1. SSH into VPS
ssh user@your-vps-ip

# 2. Clone repository
git clone https://github.com/your-org/xfuel-protocol.git
cd xfuel-protocol

# 3. Install dependencies
npm install

# 4. Configure production environment
cp .env.local.example .env.local
nano .env.local  # Fill in production values

# 5. Build services
npm run build:web
npm run build:ibc

# 6. Install PM2
npm install -g pm2

# 7. Start services
pm2 start npm --name "xfuel-web" -- run preview
pm2 start npm --name "xfuel-ibc" -- run dev:ibc
pm2 save
pm2 startup

# 8. Configure Nginx reverse proxy
sudo nano /etc/nginx/sites-available/xfuel
```

**Nginx Config:**
```nginx
server {
    listen 80;
    server_name xfuel.app;

    # Frontend
    location / {
        proxy_pass http://localhost:5173;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_cache_bypass $http_upgrade;
    }

    # IBC API
    location /api/ibc/ {
        proxy_pass http://localhost:3002;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
    }
}
```

### Option B: Deploy to Vercel (Frontend Only)

```bash
# Install Vercel CLI
npm install -g vercel

# Deploy frontend
vercel --prod

# Note: Deploy IBC service separately to VPS
```

---

## ✅ Deployment Checklist

### Pre-Deployment
- [ ] All tests passing locally
- [ ] Environment variables configured
- [ ] Contract addresses verified on Mintscan
- [ ] Testnet testing completed successfully
- [ ] IBC wallet funded with gas (XPRT)
- [ ] Monitoring & alerting set up

### Production Deployment
- [ ] Frontend deployed to Vercel/VPS
- [ ] IBC service running on VPS
- [ ] PM2 process manager configured
- [ ] Nginx reverse proxy configured
- [ ] SSL certificate installed (Let's Encrypt)
- [ ] Firewall configured (allow 80, 443, 3002)
- [ ] Database backup cron job set up
- [ ] Log rotation configured
- [ ] Health check monitoring active

### Post-Deployment
- [ ] API health check returns OK
- [ ] Frontend loads without errors
- [ ] Test small TFUEL deposit (<$10)
- [ ] Monitor first transaction end-to-end
- [ ] Verify stkXPRT arrives in recipient wallet
- [ ] Set up transaction alerts
- [ ] Document any issues encountered

---

## 🔍 Monitoring Commands

```bash
# View logs
pm2 logs xfuel-ibc

# Check service status
pm2 status

# Restart services
pm2 restart xfuel-ibc

# View database
cat backend/ibc/transactions.json

# Check recent transactions
curl http://localhost:3002/api/ibc/transactions/recent?limit=10

# View statistics
curl http://localhost:3002/api/ibc/stats
```

---

## 🚨 Troubleshooting

### Issue: IBC service won't start
**Solution:** Check environment variables
```bash
node -e "require('dotenv').config({path:'.env.local'}); console.log(process.env.IBC_WALLET_MNEMONIC)"
```

### Issue: "THETA_DEPOSIT_ADDRESS not configured"
**Solution:** Verify .env.local exists and contains:
```bash
THETA_DEPOSIT_ADDRESS=0x6256D8A728aA102Aa06B6B239ba1247Bd835d816
```

### Issue: "Invalid DEXTER_ROUTER_ADDRESS"
**Solution:** Must start with `persistence1`:
```bash
PERSISTENCE_DEXTER_ROUTER=persistence1k4q9wtawxxk6v2x5v4t9q8r3j9w3j9j0j0j0j0
```

### Issue: Transaction stuck in "pending"
**Solution:** Check confirmations:
```bash
curl http://localhost:3002/api/ibc/status/0x[txhash]
# Wait for confirmationsRequired (default: 3)
```

### Issue: IBC transfer failed
**Solution:** Check channel-190 status:
- Visit: https://www.mintscan.io/persistence/relayers
- Verify channel is active
- Check relayer is online

---

## 📊 Success Metrics

After deployment, verify:
- ✅ API response time < 200ms
- ✅ Transaction processing time < 5 minutes
- ✅ Success rate > 95%
- ✅ Zero downtime in last 7 days
- ✅ All transactions tracked in database
- ✅ Manual triggers working correctly

---

## 🎯 Next Steps After Deployment

1. **Monitor first 10 transactions closely**
2. **Set up automated alerts** (email/Slack)
3. **Create ops documentation** for common issues
4. **Schedule weekly reviews** of transaction logs
5. **Plan for database migration** to PostgreSQL
6. **Implement retry dashboard** for failed transactions
7. **Add transaction notifications** for users

---

**Ready to deploy? Start with Phase 1! 🚀**

