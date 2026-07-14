# Theta-Persistence ZK Bridge - Quick Reference

## 🎯 What is This?

A Node.js backend service that bridges TFUEL deposits from Theta blockchain to Persistence chain using zero-knowledge proofs.

## 📦 What's Included

```
backend/theta-bridge/
├── src/
│   ├── index.js           - Main orchestrator
│   ├── config.js          - Configuration
│   ├── logger.js          - Logging
│   ├── provider.js        - Multi-RPC with failover
│   ├── redis-client.js    - Redis operations
│   ├── listener.js        - Event monitoring
│   ├── prover.js          - ZK proof generation
│   └── refund-manager.js  - Refund handling
├── abis/                  - Contract ABIs
├── circuits/              - ZK circuits (for production)
├── package.json
├── ecosystem.config.cjs   - PM2 config
├── Dockerfile
├── docker-compose.yml
├── README.md              - Full documentation
├── DEPLOYMENT.md          - Deployment guide
└── env.example            - Environment template
```

## ⚡ Quick Start

### Development

```bash
cd backend/theta-bridge
npm install
cp env.example .env
# Edit .env with your configuration
npm run dev
```

### Production

```bash
npm ci --only=production
# Configure .env
npm run pm2:start
```

### Docker

```bash
docker-compose up -d
```

## 🔑 Key Features

### 1. Multi-RPC Failover
- Multiple Theta RPC endpoints
- Automatic failover on errors
- Health monitoring for all endpoints

### 2. Event Listening
- Monitors `DepositReceived` events
- Real-time processing
- Periodic scanning for missed events

### 3. ZK Proof Generation
- Proves transaction inclusion
- Proves deposit amount
- Mock mode for development

### 4. Automatic Refunds
- Detects expired mappings (>30 min)
- Refunds to original depositor
- Admin-controlled via relayer wallet

### 5. Redis Caching
- Temporary vault mappings
- TTL-based expiry
- Status tracking

## 🔄 Process Flow

```
1. User deposits TFUEL → SubVault
2. SubVault emits DepositReceived event
3. Bridge listener detects event
4. Checks Redis for vault → Keplr mapping
5. If valid:
   a. Wait for confirmations
   b. Generate ZK proof
   c. Queue for Persistence (Phase 3)
   d. Mark completed
6. If invalid/expired:
   a. Retrieve original depositor
   b. Execute refund via VaultFactory
   c. Mark refunded
```

## 📝 Configuration Checklist

Required in `.env`:
- ✅ `VAULT_FACTORY_ADDRESS` - Your deployed VaultFactory
- ✅ `RELAYER_PRIVATE_KEY` - Wallet for refund transactions
- ✅ `THETA_RPC_URLS` - Comma-separated RPC endpoints
- ⚙️ `REDIS_URL` - Default: `redis://localhost:6379`
- ⚙️ `EXPIRY_MINUTES` - Default: `30`

## 🚨 Important Notes

### Security
- Keep `RELAYER_PRIVATE_KEY` secure
- Don't expose refund API endpoint publicly
- Use Redis password in production

### Fee Handling
- **DO NOT** transfer fee again in backend
- SubVault already deducts and sends fee
- Backend works with `netAmount` only

### ZK Circuits
- Production requires real circuit files
- Development uses mock proofs
- See `circuits/README.md` for setup

### Phase 3 Integration
- Placeholder code in `listener.js`
- Needs Persistence chain integration
- See TODO comments in code

## 📊 Monitoring

### Health Check
```bash
curl http://localhost:3001/health
```

### View Logs
```bash
pm2 logs theta-bridge
```

### Check Status
```bash
curl http://localhost:3001/status
```

## 🔧 Common Commands

```bash
# Start
npm run pm2:start

# Restart
pm2 restart theta-bridge

# Stop
pm2 stop theta-bridge

# Logs
pm2 logs theta-bridge

# Monitor
pm2 monit

# Docker
docker-compose up -d
docker-compose logs -f
docker-compose down
```

## 📚 Documentation

- `README.md` - Full documentation
- `DEPLOYMENT.md` - Production deployment guide
- `circuits/README.md` - ZK circuit setup
- `env.example` - Configuration template

## 🐛 Troubleshooting

### Service won't start
1. Check Redis is running: `redis-cli ping`
2. Verify `.env` exists and is configured
3. Check logs: `pm2 logs theta-bridge --err`

### RPC errors
- Check `THETA_RPC_URLS` are accessible
- Service will auto-failover to backup RPCs
- View RPC health: `curl http://localhost:3001/api/rpc/health`

### Missing events
- Check `lastProcessedBlock` in logs
- Service auto-scans every 30 seconds
- Verify contract addresses in `.env`

### Refunds failing
- Check relayer has TFUEL for gas
- Verify relayer has permissions on VaultFactory
- Check gas limits in config

## ✅ Pre-Production Checklist

- [ ] VaultFactory deployed and tested
- [ ] Relayer wallet funded (>100 TFUEL)
- [ ] Redis configured and secured
- [ ] Environment variables set
- [ ] Circuit files uploaded (or mock mode acknowledged)
- [ ] Test deposit processed successfully
- [ ] Test refund executed successfully
- [ ] Monitoring configured
- [ ] Backups set up

## 📞 Quick Help

**Can't connect to Redis?**
```bash
redis-cli ping
# Should return PONG
```

**Low relayer balance?**
```bash
# Fund the relayer wallet
# Address is derived from RELAYER_PRIVATE_KEY
```

**Events not being detected?**
```bash
# Check VaultFactory address is correct
curl http://localhost:3001/status
```

**Need to trigger refund manually?**
```bash
curl -X POST http://localhost:3001/api/refund/0xVAULT_ADDRESS
```

## 🎓 Learning Resources

- [Ethers.js v6 Docs](https://docs.ethers.org/v6/)
- [Redis Node Client](https://github.com/redis/node-redis)
- [Pino Logger](https://getpino.io/)
- [PM2 Documentation](https://pm2.keymetrics.io/)
- [SP1 zkVM Documentation](https://docs.succinct.xyz/)

## 📈 Next Steps

1. **Deploy to testnet** first
2. **Test all flows** (deposit, refund, errors)
3. **Set up monitoring** (health checks, alerts)
4. **Implement Phase 3** (Persistence integration)
5. **Deploy to mainnet** with proper security

---

For full details, see `README.md` and `DEPLOYMENT.md`.

