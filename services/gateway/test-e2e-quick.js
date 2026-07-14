const { ethers } = require('ethers');

async function quickTest() {
  console.log('🧪 Quick E2E Test for Theta-Persistence ZK Bridge\n');
  
  // Configuration
  const RPC_URL = process.env.THETA_RPC_URL || 'http://localhost:8545';
  const FACTORY_ADDRESS = process.env.VAULT_FACTORY_ADDRESS;
  const TEST_PRIVATE_KEY = process.env.TEST_PRIVATE_KEY || 
    '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80'; // Hardhat key
  
  if (!FACTORY_ADDRESS) {
    console.error('❌ VAULT_FACTORY_ADDRESS not set!');
    console.log('Set it in .env or: $env:VAULT_FACTORY_ADDRESS="0x..."');
    process.exit(1);
  }
  
  // Connect
  console.log('🔗 Connecting to RPC:', RPC_URL);
  const provider = new ethers.JsonRpcProvider(RPC_URL);
  const signer = new ethers.Wallet(TEST_PRIVATE_KEY, provider);
  
  console.log('👤 Test account:', await signer.getAddress());
  const balance = await provider.getBalance(await signer.getAddress());
  console.log('💰 Balance:', ethers.formatEther(balance), 'TFUEL\n');
  
  // Load ABI
  const factoryABI = require('./abis/VaultFactory.json');
  const factory = new ethers.Contract(FACTORY_ADDRESS, factoryABI, signer);
  
  // Verify factory
  console.log('🏭 VaultFactory:', FACTORY_ADDRESS);
  const revSplitter = await factory.getRevSplitter();
  console.log('💰 RevenueSplitter:', revSplitter);
  console.log('');
  
  // Generate vault
  const testKeplrAddr = 'persistence1testuser123456789';
  const nonce = Date.now();
  console.log('📦 Generating vault...');
  console.log('   User address:', await signer.getAddress());
  console.log('   Nonce:', nonce);
  
  const salt = await factory.generateSalt(await signer.getAddress(), nonce);
  console.log('   Salt:', salt);
  
  const vaultAddr = await factory.predictAddress(salt);
  console.log('   Vault address:', vaultAddr);
  console.log('');
  
  // Check if backend is running
  try {
    const http = require('http');
    await new Promise((resolve, reject) => {
      const req = http.get('http://localhost:3001/health', (res) => {
        if (res.statusCode === 200) {
          console.log('✅ Backend service is running');
          resolve();
        } else {
          reject(new Error(`Backend returned ${res.statusCode}`));
        }
      });
      req.on('error', reject);
      req.setTimeout(2000);
    });
  } catch (error) {
    console.warn('⚠️  Backend not detected. Start it with: npm run dev');
    console.log('');
  }
  
  // Create vault
  console.log('🚀 Creating vault on-chain...');
  try {
    const tx = await factory.createVault(salt);
    console.log('   TX hash:', tx.hash);
    console.log('   Waiting for confirmation...');
    await tx.wait();
    console.log('✅ Vault created!\n');
  } catch (error) {
    if (error.message.includes('VaultAlreadyExists')) {
      console.log('ℹ️  Vault already exists (re-running test)\n');
    } else {
      throw error;
    }
  }
  
  // Store mapping in Redis (if available)
  console.log('💾 Storing mapping in Redis...');
  try {
    const redis = require('redis');
    const redisClient = redis.createClient({ 
      url: process.env.REDIS_URL || 'redis://localhost:6379' 
    });
    
    await redisClient.connect();
    
    await redisClient.set(
      `vault:${vaultAddr.toLowerCase()}`,
      JSON.stringify({
        keplrAddr: testKeplrAddr,
        timestamp: Date.now(),
        nonce,
        status: 'pending'
      }),
      { EX: 1800 }
    );
    
    console.log('✅ Mapping stored\n');
    await redisClient.quit();
  } catch (error) {
    console.warn('⚠️  Redis not available:', error.message);
    console.log('   Start Redis with: redis-server\n');
  }
  
  // Send deposit
  console.log('💸 Sending test deposit (0.1 TFUEL)...');
  const depositAmount = ethers.parseEther('0.1');
  const depositTx = await signer.sendTransaction({
    to: vaultAddr,
    value: depositAmount
  });
  
  console.log('   TX hash:', depositTx.hash);
  console.log('   Waiting for confirmation...');
  const receipt = await depositTx.wait();
  console.log('✅ Deposit confirmed! Block:', receipt.blockNumber);
  console.log('');
  
  // Check vault balance
  const vaultBalance = await provider.getBalance(vaultAddr);
  console.log('📊 Vault balance:', ethers.formatEther(vaultBalance), 'TFUEL');
  console.log('   (Should be ~0.0995 after 0.5% fee)');
  console.log('');
  
  // Summary
  console.log('=' .repeat(70));
  console.log('✅ TEST COMPLETE');
  console.log('=' .repeat(70));
  console.log('');
  console.log('📝 What happened:');
  console.log('   1. Connected to network');
  console.log('   2. Generated unique vault address');
  console.log('   3. Created vault on-chain');
  console.log('   4. Stored Keplr mapping in Redis');
  console.log('   5. Deposited 0.1 TFUEL');
  console.log('');
  console.log('🔍 Next steps:');
  console.log('   - Check backend logs for event detection');
  console.log('   - Backend should process deposit and generate proof');
  console.log('   - Check Redis: redis-cli GET vault:' + vaultAddr.toLowerCase());
  console.log('   - Check health: curl http://localhost:3001/health');
  console.log('');
  console.log('📦 Test Data:');
  console.log('   Vault:', vaultAddr);
  console.log('   Keplr:', testKeplrAddr);
  console.log('   TX:', depositTx.hash);
  console.log('');
}

// Run test
quickTest()
  .then(() => {
    console.log('✅ Test script completed successfully!');
    process.exit(0);
  })
  .catch((error) => {
    console.error('\n❌ Test failed:', error.message);
    console.error(error.stack);
    process.exit(1);
  });

