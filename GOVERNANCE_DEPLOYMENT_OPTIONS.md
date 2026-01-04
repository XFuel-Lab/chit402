# 🏛️ Governance-Based Deployment (Unauthorized Fix)

## ⚠️ Important Note About "Unauthorized" Error

If you got an "unauthorized" error, it means direct WASM uploads are restricted on Persistence mainnet and require governance approval.

**However**, governance proposals typically take **3-7 days** for voting period.

---

## 🎯 Three Options

### Option 1: Governance Proposal (Slow but Official) ⏰

**Time**: 3-7 days  
**Cost**: 2 XPRT deposit (1 XPRT per proposal)  
**Process**: Community voting required

**Run:**
```bash
docker run --rm -v "${PWD}:/app" --env-file .env.docker \
  xfuel-protocol-persistence-deployer:latest \
  /app/scripts/docker-deploy-persistence-gov.sh
```

**Then**:
1. Wait for voting period
2. Community votes
3. Proposals pass
4. Code automatically stored
5. Instantiate contracts

---

### Option 2: Testnet Deployment (Fast & Free) 🚀

**Time**: 5 minutes  
**Cost**: Free (faucet tokens)  
**Process**: No restrictions

**Steps:**

1. **Create testnet script:**
```bash
# Copy and modify for testnet
cp scripts/docker-deploy-persistence.sh scripts/deploy-testnet.sh

# Edit deploy-testnet.sh:
# Change: core-1 → test-core-1  
# Change: rpc.core.persistence.one → rpc.testnet.persistence.one
```

2. **Get testnet tokens:**
   - Visit: https://faucet.persistence.one/
   - Enter: `persistence1cgzppukxwdzmhmm342mgrf00atkk8nvg4azpfy`
   - Request tokens

3. **Deploy:**
```bash
docker run --rm -v "${PWD}:/app" --env-file .env.docker \
  xfuel-protocol-persistence-deployer:latest \
  /app/scripts/deploy-testnet.sh
```

---

### Option 3: Request Permissions (Recommended) 💼

**Time**: Varies (hours to days)  
**Process**: Contact Persistence team

**Steps:**

1. **Join Persistence Discord/Telegram**
   - Discord: https://discord.gg/persistence
   - Telegram: https://t.me/PersistenceOne

2. **Request upload permissions for your address:**
   ```
   Address: persistence1cgzppukxwdzmhmm342mgrf00atkk8nvg4azpfy
   Project: XFuel Protocol ZK Bridge
   Contracts: 2 (ZK Verifier + Minter, optimized ~360KB total)
   Purpose: Cross-chain TFUEL bridging with ZK proofs
   ```

3. **Once granted, run original script:**
```bash
docker run --rm -v "${PWD}:/app" --env-file .env.docker \
  xfuel-protocol-persistence-deployer:latest \
  /app/scripts/docker-deploy-persistence.sh
```

---

## 📋 Governance Proposal Details

If you choose Option 1, here's what happens:

### Proposal Submission
```bash
# ZK Verifier Proposal
Title: "Store XFuel ZK Verifier Contract"
Description: "166KB optimized contract for ZK bridge"
Deposit: 1,000,000 uxprt (1 XPRT)
Run As: persistence1cgzppukxwdzmhmm342mgrf00atkk8nvg4azpfy

# Minter Proposal  
Title: "Store XFuel ibcTFUEL Minter Contract"
Description: "194KB optimized CW20 minter"
Deposit: 1,000,000 uxprt (1 XPRT)
```

### Voting Period
- Duration: 3-7 days (chain-specific)
- Quorum: Must reach minimum participation
- Threshold: >50% YES votes required
- Your vote: Automatically cast YES

### After Passing
- Code stored automatically
- Code IDs assigned
- Ready for instantiation

---

## 🚀 RECOMMENDED: Start with Testnet

For immediate testing and development, **use Option 2 (Testnet)** because:

✅ **Fast**: Deploy in 5 minutes  
✅ **Free**: Faucet tokens available  
✅ **No restrictions**: Direct upload allowed  
✅ **Full testing**: Same features as mainnet  
✅ **Easy iteration**: Quick redeploy if needed

Then once tested, either:
- Request mainnet permissions (Option 3)
- Submit governance proposal (Option 1)

---

## 📝 Testnet Quick Start

```bash
# 1. Get faucet tokens
# Visit: https://faucet.persistence.one/
# Address: persistence1cgzppukxwdzmhmm342mgrf00atkk8nvg4azpfy

# 2. Update environment for testnet
cat > .env.docker.testnet << EOF
KEPLR_MNEMONIC="your mnemonic here"
PERSISTENCE_CHAIN_ID=test-core-1
PERSISTENCE_NODE=https://rpc.testnet.persistence.one:443
EOF

# 3. Deploy to testnet
docker run --rm -v "${PWD}:/app" \
  --env-file .env.docker.testnet \
  xfuel-protocol-persistence-deployer:latest bash -c '
  
  # Update script for testnet
  sed -i "s/core-1/test-core-1/g" /app/scripts/docker-deploy-persistence.sh
  sed -i "s/rpc.core.persistence.one/rpc.testnet.persistence.one/g" /app/scripts/docker-deploy-persistence.sh
  
  # Run deployment
  /app/scripts/docker-deploy-persistence.sh
'
```

---

## ❓ Which Option Should You Choose?

| Scenario | Recommended Option |
|----------|-------------------|
| **Immediate testing needed** | Option 2 (Testnet) |
| **Production ready, have time** | Option 1 (Governance) |
| **Production ready, need fast** | Option 3 (Request permissions) |
| **Community/DAO project** | Option 1 (Governance) |
| **Private/Corporate project** | Option 3 (Permissions) |

---

## 🔧 Governance Deployment Command

If you want to proceed with governance (3-7 day wait):

```bash
# Run governance-based deployment
docker run --rm -v "${PWD}:/app" --env-file .env.docker \
  xfuel-protocol-persistence-deployer:latest \
  /app/scripts/docker-deploy-persistence-gov.sh
```

**This will:**
1. Submit 2 governance proposals
2. Deposit 2 XPRT total (1 per proposal)
3. Auto-vote YES
4. Save proposal IDs to `.env`
5. Wait for community voting

---

## 📞 Get Help

- **Persistence Discord**: https://discord.gg/persistence
- **Persistence Docs**: https://docs.persistence.one/
- **Governance Guide**: https://docs.persistence.one/build/governance

---

**My Recommendation**: Start with **Testnet (Option 2)** to test everything works, then move to mainnet via **Request Permissions (Option 3)** for fastest production deployment!

Let me know which option you'd like to proceed with! 🚀

