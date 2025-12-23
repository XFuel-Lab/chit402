import hre from 'hardhat';
const { ethers } = hre;
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

interface PoolConfig {
  address: string;
  name: string;
  token0: string;
  token1: string;
}

interface RebalanceLog {
  timestamp: number;
  pool: string;
  poolName: string;
  ratioBefore: string;
  ratioAfter: string;
  swapAmount: string;
  zeroForOne: boolean;
  txHash: string;
  success: boolean;
}

async function main() {
  console.log('🔄 Starting LP Rebalance Monitor...\n');

  // Load deployment addresses
  const routerPath = path.join(__dirname, '..', 'deployments', 'router-mainnet.json');
  let routerAddress = null;
  let rebalancerAddress = null;

  if (fs.existsSync(routerPath)) {
    const routerDeployment = JSON.parse(fs.readFileSync(routerPath, 'utf8'));
    routerAddress = routerDeployment.router;
    rebalancerAddress = routerDeployment.rebalancer;
  }

  if (!routerAddress) {
    throw new Error('Router deployment not found. Deploy contracts first.');
  }

  if (!rebalancerAddress) {
    console.warn('⚠️  Rebalancer not deployed. Deploy LPRebalancer contract first.');
    console.warn('   You can deploy it with: npx hardhat run scripts/deploy-rebalancer.ts\n');
    process.exit(1);
  }

  // Get contract instances
  const LPRebalancer = await ethers.getContractFactory('LPRebalancer');
  const rebalancer = LPRebalancer.attach(rebalancerAddress);

  const XFUELRouter = await ethers.getContractFactory('XFUELRouter');
  const router = XFUELRouter.attach(routerAddress);

  const XFUELPoolFactory = await ethers.getContractFactory('XFUELPoolFactory');
  const factoryAddress = await router.factory();
  const factory = XFUELPoolFactory.attach(factoryAddress);

  console.log('📋 Contract Addresses:');
  console.log('   Router:', routerAddress);
  console.log('   Rebalancer:', rebalancerAddress);
  console.log('   Factory:', factoryAddress);
  console.log('');

  // Get rebalancer configuration
  const thresholdBps = await rebalancer.rebalanceThresholdBps();
  const minRebalanceAmount = await rebalancer.minRebalanceAmount();
  const rebalanceEnabled = await rebalancer.rebalanceEnabled();
  const treasury = await rebalancer.treasury();

  console.log('⚙️  Rebalancer Configuration:');
  console.log('   Threshold:', thresholdBps.toString(), 'bps', `(${(Number(thresholdBps) / 100).toFixed(2)}%)`);
  console.log('   Min Rebalance Amount:', ethers.formatEther(minRebalanceAmount));
  console.log('   Enabled:', rebalanceEnabled);
  console.log('   Treasury:', treasury);
  console.log('');

  // Discover pools from factory (if available)
  let pools: PoolConfig[] = [];
  
  try {
    const poolCount = await factory.allPoolsLength();
    console.log(`📊 Found ${poolCount.toString()} pools in factory\n`);

    // For demo, we'll check a few pools
    // In production, you might want to maintain a list of pool addresses
    // For now, we'll use an empty array and expect pools to be configured
  } catch (error: any) {
    console.warn('⚠️  Could not read pools from factory:', error.message);
    console.warn('   You can manually configure pools in the script\n');
  }

  // If no pools discovered, use example pools (user should configure these)
  if (pools.length === 0) {
    console.log('💡 To monitor pools, add pool addresses to the pools array in this script.');
    console.log('   Example:\n');
    console.log('   pools = [');
    console.log('     {');
    console.log('       address: "0x...",');
    console.log('       name: "TFUEL/USDC",');
    console.log('       token0: "0x...",');
    console.log('       token1: "0x..."');
    console.log('     }');
    console.log('   ];\n');
  }

  // Monitoring function
  async function checkAndRebalance(poolConfig: PoolConfig) {
    try {
      const poolAddress = poolConfig.address;
      
      // Check if rebalance is needed
      const [needsRebalance, zeroForOne, swapAmount] = await rebalancer.checkRebalanceNeeded(poolAddress);
      
      if (!needsRebalance) {
        const ratio = await rebalancer.getPoolRatio(poolAddress);
        const skew = await rebalancer.calculateSkew(poolAddress);
        console.log(`   ${poolConfig.name}: Ratio ${(Number(ratio) / 100).toFixed(2)}%, Skew: ${(Number(skew) / 100).toFixed(2)}% (OK)`);
        return null;
      }

      console.log(`\n   🔄 ${poolConfig.name} needs rebalancing!`);
      console.log(`      Current skew exceeds ${(Number(thresholdBps) / 100).toFixed(2)}% threshold`);
      console.log(`      Swap: ${swapAmount.toString()} (${zeroForOne ? 'token0→token1' : 'token1→token0'})`);

      // Execute rebalance
      const tx = await rebalancer.rebalance(poolAddress);
      const receipt = await tx.wait();

      if (receipt && receipt.status === 1) {
        // Get rebalance record
        const historyCount = await rebalancer.getRebalanceHistoryCount();
        const record = await rebalancer.getRebalanceRecord(historyCount - 1n);

        console.log(`      ✅ Rebalance executed!`);
        console.log(`      Ratio: ${(Number(record.ratioBefore) / 100).toFixed(2)}% → ${(Number(record.ratioAfter) / 100).toFixed(2)}%`);
        console.log(`      TX Hash: ${receipt.hash}`);

        const log: RebalanceLog = {
          timestamp: Date.now(),
          pool: poolAddress,
          poolName: poolConfig.name,
          ratioBefore: record.ratioBefore.toString(),
          ratioAfter: record.ratioAfter.toString(),
          swapAmount: record.swapAmount.toString(),
          zeroForOne: record.zeroForOne,
          txHash: receipt.hash,
          success: true,
        };

        // Write to log file
        await logRebalance(log);

        return log;
      } else {
        console.log(`      ❌ Rebalance transaction failed`);
        return null;
      }
    } catch (error: any) {
      console.error(`      ❌ Error checking ${poolConfig.name}:`, error.message);
      return null;
    }
  }

  // Log rebalance to file
  async function logRebalance(log: RebalanceLog) {
    const logDir = path.join(__dirname, '..', 'logs');
    if (!fs.existsSync(logDir)) {
      fs.mkdirSync(logDir, { recursive: true });
    }

    const logFile = path.join(logDir, 'rebalance-log.json');
    let logs: RebalanceLog[] = [];

    if (fs.existsSync(logFile)) {
      try {
        logs = JSON.parse(fs.readFileSync(logFile, 'utf8'));
      } catch (error) {
        console.warn('⚠️  Could not parse existing log file, starting fresh');
      }
    }

    logs.push(log);

    // Keep only last 1000 entries
    if (logs.length > 1000) {
      logs = logs.slice(-1000);
    }

    fs.writeFileSync(logFile, JSON.stringify(logs, null, 2));
    console.log(`      📝 Logged to ${logFile}`);
  }

  // Main monitoring loop
  async function monitor() {
    console.log('🔍 Checking pools...\n');

    if (pools.length === 0) {
      console.log('⏭️  No pools configured. Add pools to monitor.');
      return;
    }

    for (const pool of pools) {
      await checkAndRebalance(pool);
    }

    console.log('\n✅ Check complete\n');
  }

  // Run once
  await monitor();

  // If running as daemon, set up interval
  const intervalMinutes = process.env.REBALANCE_INTERVAL_MINUTES 
    ? parseInt(process.env.REBALANCE_INTERVAL_MINUTES) 
    : 60; // Default: check every hour

  if (process.argv.includes('--daemon')) {
    console.log(`⏰ Running as daemon (checking every ${intervalMinutes} minutes)\n`);
    
    setInterval(async () => {
      console.log(`\n[${new Date().toISOString()}] Checking pools...\n`);
      await monitor();
    }, intervalMinutes * 60 * 1000);
  } else {
    console.log('\n💡 To run as daemon: node --loader ts-node/esm scripts/monitor-rebalance.ts --daemon');
    console.log('   Set REBALANCE_INTERVAL_MINUTES env var to change interval (default: 60 minutes)\n');
  }
}

main()
  .then(() => {
    if (!process.argv.includes('--daemon')) {
      process.exit(0);
    }
  })
  .catch((error) => {
    console.error('❌ Monitoring failed:', error);
    process.exit(1);
  });

