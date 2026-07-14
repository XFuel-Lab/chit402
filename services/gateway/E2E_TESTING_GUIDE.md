# E2E Testing Guide - Theta-Persistence ZK Bridge

## 🎯 Quick E2E Test Setup

This guide will help you test the complete bridge system end-to-end.

### Option 1: Local Testing (Recommended)

Use for initial testing without deploying to mainnet.

#### Step 1: Start Local Blockchain

```bash
# Terminal 1: Start Hardhat node
npx hardhat node
```

#### Step 2: Deploy Contracts to Local Network

```bash
# Terminal 2: Deploy VaultFactory
cd C:\Users\seeha\xfuel-protocol

# Set RevenueSplitter address (use Phase 1 deployment)
$env:REV_SPLITTER_ADDRESS="0x03973A67449557b14228541Df339Ae041567628B"

# Deploy
npx hardhat run scripts/deploy-vault-factory.cjs --network localhost

# Save the VaultFactory address from output
```

#### Step 3: Configure Backend

```bash
cd backend\theta-bridge

# Edit .env
notepad .env
```

Update these values:
```env
# Use localhost RPC
THETA_RPC_URLS=http://localhost:8545

# VaultFactory address from deployment
VAULT_FACTORY_ADDRESS=0xYourDeployedAddress

# Use a test private key from Hardhat (Account #1 or #2)
RELAYER_PRIVATE_KEY=0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80

# Local Redis
REDIS_URL=redis://localhost:6379
```

#### Step 4: Start Redis

```bash
# Terminal 3: Start Redis
redis-server
```

#### Step 5: Start Backend Service

```bash
# Terminal 4: Start bridge
cd backend\theta-bridge
npm run dev
```

#### Step 6: Test Deposit Flow

```javascript
// Terminal 5: Test script
cd C:\Users\seeha\xfuel-protocol
node backend/theta-bridge/test-e2e.js
```

### Option 2: Theta Testnet

Deploy to Theta testnet for more realistic testing.

#### Step 1: Configure Hardhat

Check `hardhat.config.cjs` has theta-testnet configured:

```javascript
{
  'theta-testnet': {
    url: 'https://eth-rpc-api-testnet.thetatoken.org/rpc',
    accounts: [process.env.THETA_TESTNET_PRIVATE_KEY],
    chainId: 365
  }
}
```

#### Step 2: Deploy to Testnet

```bash
# Set RevenueSplitter (use existing or deploy new)
$env:REV_SPLITTER_ADDRESS="0x03973A67449557b14228541Df339Ae041567628B"

# Deploy
npx hardhat run scripts/deploy-vault-factory.cjs --network theta-testnet
```

#### Step 3: Configure Backend for Testnet

```env
THETA_RPC_URLS=https://eth-rpc-api-testnet.thetatoken.org/rpc
VAULT_FACTORY_ADDRESS=0xYourTestnetAddress
RELAYER_PRIVATE_KEY=0xYourTestnetPrivateKey
```

### Option 3: Theta Mainnet (Production)

⚠️  **Use only after thorough testing!**

#### Prerequisites
- Contracts deployed and tested on testnet
- Relayer wallet funded with TFUEL (>100 TFUEL)
- Redis production setup
- Monitoring configured

#### Deploy

```bash
$env:REV_SPLITTER_ADDRESS="0x03973A67449557b14228541Df339Ae041567628B"
npx hardhat run scripts/deploy-vault-factory.cjs --network theta-mainnet
```

## 🧪 E2E Test Script

Create `backend/theta-bridge/test-e2e.js`:

```javascript
const { ethers } = require('ethers');
const redis = require('redis');

async function testE2E() {
  console.log('🧪 Starting E2E Test\\n');
  
  // 1. Connect to local network
  const provider = new ethers.JsonRpcProvider('http://localhost:8545');
  const signer = await provider.getSigner(0); // Hardhat account 0
  
  console.log('👤 Using account:', await signer.getAddress());
  console.log('💰 Balance:', ethers.formatEther(await provider.getBalance(await signer.getAddress())));
  
  // 2. Connect to VaultFactory
  const factoryAddress = '0xYourVaultFactoryAddress'; // Update this
  const factoryABI = require('./abis/VaultFactory.json');
  const factory = new ethers.Contract(factoryAddress, factoryABI, signer);
  
  // 3. Generate vault for test user
  const testKeplrAddr = 'persistence1testaddress';
  const nonce = Date.now();
  const salt = await factory.generateSalt(await signer.getAddress(), nonce);
  const vaultAddr = await factory.predictAddress(salt);
  
  console.log('\\n📦 Creating vault...');
  console.log('   Salt:', salt);
  console.log('   Predicted address:', vaultAddr);
  
  // 4. Store mapping in Redis (simulating frontend)
  const redisClient = redis.createClient({ url: 'redis://localhost:6379' });
  await redisClient.connect();
  
  await redisClient.set(
    `vault:${vaultAddr.toLowerCase()}`,
    JSON.stringify({
      keplrAddr: testKeplrAddr,
      timestamp: Date.now(),
      nonce,
      status: 'pending'
    }),
    { EX: 1800 } // 30 min TTL
  );
  
  console.log('✅ Mapping stored in Redis');
  
  // 5. Create vault on-chain
  const tx = await factory.createVault(salt);
  console.log('\\n⏳ Waiting for vault creation...');
  await tx.wait();
  console.log('✅ Vault created!');
  
  // 6. Deposit TFUEL
  console.log('\\n💸 Sending deposit...');
  const depositAmount = ethers.parseEther('1.0'); // 1 TFUEL
  const depositTx = await signer.sendTransaction({
    to: vaultAddr,
    value: depositAmount
  });
  
  console.log('   TX Hash:', depositTx.hash);
  await depositTx.wait();
  console.log('✅ Deposit confirmed!');
  
  // 7. Wait for backend to process
  console.log('\\n⏳ Waiting for bridge to process (check backend logs)...');
  console.log('   Watch: npm run dev (in backend/theta-bridge)');
  console.log('');
  
  // 8. Check Redis for status updates
  let processed = false;
  for (let i = 0; i < 30; i++) {
    await new Promise(resolve => setTimeout(resolve, 1000));
    const mapping = await redisClient.get(`vault:${vaultAddr.toLowerCase()}`);
    if (mapping) {
      const data = JSON.parse(mapping);
      console.log(`   [${i+1}s] Status: ${data.status}`);
      if (data.status === 'completed' || data.status === 'failed') {
        processed = true;
        console.log('\\n✅ Bridge processed the deposit!');
        console.log('   Final status:', data.status);
        if (data.proofHash) {
          console.log('   Proof hash:', data.proofHash);
        }
        break;
      }
    }
  }
  
  if (!processed) {
    console.log('\\n⏰ Timeout waiting for processing. Check backend logs.');
  }
  
  await redisClient.quit();
  
  console.log('\\n✅ E2E Test Complete!');
}

testE2E().catch(console.error);
```

## 📊 What to Check

### Backend Logs Should Show:

```
[INFO] Deposit event detected
  vault: 0x...
  sender: 0x...
  grossAmount: 1000000000000000000
  netAmount: 995000000000000000

[INFO] Processing deposit
[INFO] Generating ZK proof
[INFO] Proof generated successfully
[INFO] Deposit processed successfully
```

### Redis Should Contain:

```bash
redis-cli
> GET vault:0xyourvaultaddress
{
  "keplrAddr": "persistence1...",
  "timestamp": 1234567890,
  "nonce": 123,
  "status": "completed",
  "proofHash": "0x..."
}
```

### Check Health:

```bash
curl http://localhost:3001/health
```

## 🐛 Troubleshooting

### Backend not detecting events
- Check VaultFactory address in .env
- Verify RPC URL is correct
- Check logs for RPC errors

### Redis connection failed
- Ensure redis-server is running
- Check REDIS_URL in .env

### Refund triggered instead of processing
- Check mapping exists in Redis before deposit
- Verify mapping hasn't expired (30 min TTL)
- Check timestamp in Redis

### ZK proof in mock mode
- This is expected without circuit files
- Production needs real circuits in `/circuits`

## ✅ Success Criteria

E2E test passes if:

1. ✅ Vault created successfully
2. ✅ Deposit detected by backend
3. ✅ Mapping retrieved from Redis
4. ✅ ZK proof generated (mock or real)
5. ✅ Status updated to "completed"
6. ✅ No errors in backend logs

## 🚀 Next Steps After Success

1. Test refund flow (expired mapping)
2. Test RPC failover (kill one endpoint)
3. Test service restart (should resume)
4. Deploy to testnet
5. Run for 24h monitoring
6. Deploy to mainnet

---

**Ready to test?** Start with Option 1 (Local Testing) first!

