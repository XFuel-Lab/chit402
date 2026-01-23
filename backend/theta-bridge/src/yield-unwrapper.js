import { ethers } from 'ethers';
import { getProvider } from './provider.js';
import { getReverseBurnEvents, markReverseBurnProcessed } from './redis-client.js';
import config from './config.js';
import logger from './logger.js';
import { readFile } from 'fs/promises';

/**
 * Yield Unwrapper
 * Processes Persistence burn events, unwraps 30% ibcUSDC yields to TFUEL,
 * routes to RevenueSplitter, and reinvests 70% for LP growth
 */
class YieldUnwrapper {
  constructor() {
    this.relayerWallet = null;
    this.swapRouterContract = null;
    this.revenueSplitterContract = null;
    this.isProcessing = false;
    this.processingQueue = [];
  }

  /**
   * Initialize the yield unwrapper
   * @returns {Promise<void>}
   */
  async init() {
    try {
      const provider = getProvider();
      
      // Create relayer wallet
      this.relayerWallet = provider.getSigner(config.relayer.privateKey);
      
      const relayerAddress = await this.relayerWallet.getAddress();
      
      logger.info({
        relayerAddress,
        revenueSplitterAddress: config.yield.revenueSplitterAddress,
        unwrapPercentage: config.yield.unwrapPercentage,
        reinvestPercentage: config.yield.reinvestPercentage
      }, 'Yield unwrapper initialized');

      // Load swap router contract (for ibcUSDC -> TFUEL swap)
      if (config.yield.swapRouterAddress) {
        // NOTE: In production, load proper swap router ABI
        // For now, use a simple interface
        const swapRouterAbi = [
          'function swapExactTokensForETH(uint256 amountIn, uint256 amountOutMin, address[] calldata path, address to, uint256 deadline) external returns (uint256[] memory amounts)',
          'function getAmountsOut(uint256 amountIn, address[] calldata path) external view returns (uint256[] memory amounts)'
        ];

        this.swapRouterContract = new ethers.Contract(
          config.yield.swapRouterAddress,
          swapRouterAbi,
          this.relayerWallet
        );

        logger.info({
          swapRouterAddress: config.yield.swapRouterAddress
        }, 'Swap router contract loaded');
      }

      // Load RevenueSplitter contract
      if (config.yield.revenueSplitterAddress) {
        // Load RevenueSplitter ABI
        const revenueSplitterAbi = JSON.parse(
          await readFile('./abis/RevenueSplitter.json', 'utf8')
        );

        this.revenueSplitterContract = new ethers.Contract(
          config.yield.revenueSplitterAddress,
          revenueSplitterAbi,
          this.relayerWallet
        );

        logger.info({
          revenueSplitterAddress: config.yield.revenueSplitterAddress
        }, 'RevenueSplitter contract loaded');
      }
    } catch (error) {
      logger.error({ err: error }, 'Failed to initialize yield unwrapper');
      throw error;
    }
  }

  /**
   * Start processing reverse-burn events
   * @returns {Promise<void>}
   */
  async startProcessing() {
    if (this.isProcessing) {
      logger.warn('Yield unwrapper already processing');
      return;
    }

    this.isProcessing = true;
    logger.info('Starting yield unwrapper processing loop');

    // Start processing loop
    this.processLoop();
  }

  /**
   * Main processing loop
   */
  async processLoop() {
    while (this.isProcessing) {
      try {
        // Get pending reverse-burn events from Redis
        const events = await getReverseBurnEvents();

        if (events.length > 0) {
          logger.info({ count: events.length }, 'Processing reverse-burn events');

          for (const event of events) {
            await this.processReverseBurn(event);
          }
        }

        // Wait before next poll
        await this.sleep(config.persistence.pollInterval);
      } catch (error) {
        logger.error({ err: error }, 'Error in yield unwrapper processing loop');
        
        // Wait before retry
        await this.sleep(config.retry.delayMs);
      }
    }
  }

  /**
   * Process a single reverse-burn event
   * @param {Object} event - Reverse-burn event data
   * @returns {Promise<void>}
   */
  async processReverseBurn(event) {
    try {
      logger.info({
        txHash: event.txHash,
        burner: event.burner,
        ibcUSDCYield: event.ibcUSDCYield
      }, 'Processing reverse-burn event');

      // Parse yield amount
      const totalYield = BigInt(event.ibcUSDCYield);

      // Check minimum threshold
      if (totalYield < BigInt(config.yield.minYieldAmount)) {
        logger.info({
          amount: totalYield.toString(),
          minimum: config.yield.minYieldAmount
        }, 'Yield amount below minimum threshold, skipping');
        
        await markReverseBurnProcessed(event.txHash, 'below_threshold');
        return;
      }

      // Calculate splits: 30% unwrap, 70% reinvest
      const unwrapAmount = (totalYield * BigInt(config.yield.unwrapPercentage)) / 100n;
      const reinvestAmount = totalYield - unwrapAmount;

      logger.info({
        totalYield: ethers.formatUnits(totalYield, 6), // USDC has 6 decimals
        unwrapAmount: ethers.formatUnits(unwrapAmount, 6),
        reinvestAmount: ethers.formatUnits(reinvestAmount, 6)
      }, 'Calculated yield splits');

      // Step 1: Unwrap 30% ibcUSDC to TFUEL
      let tfuelAmount = 0n;
      if (unwrapAmount > 0n) {
        tfuelAmount = await this.swapIbcUSDCToTFUEL(unwrapAmount);
        
        logger.info({
          ibcUSDCAmount: ethers.formatUnits(unwrapAmount, 6),
          tfuelAmount: ethers.formatEther(tfuelAmount)
        }, 'Swapped ibcUSDC to TFUEL');
      }

      // Step 2: Route TFUEL to RevenueSplitter
      if (tfuelAmount > 0n && this.revenueSplitterContract) {
        await this.routeToRevenueSplitter(tfuelAmount);
        
        logger.info({
          tfuelAmount: ethers.formatEther(tfuelAmount)
        }, 'Routed TFUEL to RevenueSplitter');
      }

      // Step 3: Reinvest 70% (placeholder - would route back to LP in production)
      if (reinvestAmount > 0n) {
        await this.reinvestYield(reinvestAmount, event.burner);
        
        logger.info({
          reinvestAmount: ethers.formatUnits(reinvestAmount, 6),
          burner: event.burner
        }, 'Yield reinvested for LP growth');
      }

      // Mark as processed
      await markReverseBurnProcessed(event.txHash, 'completed');

      logger.info({
        txHash: event.txHash,
        tfuelRouted: ethers.formatEther(tfuelAmount),
        reinvested: ethers.formatUnits(reinvestAmount, 6)
      }, 'Reverse-burn event processed successfully');
    } catch (error) {
      logger.error({
        err: error,
        txHash: event.txHash
      }, 'Failed to process reverse-burn event');

      // Mark as failed
      await markReverseBurnProcessed(event.txHash, 'failed');
    }
  }

  /**
   * Swap ibcUSDC to TFUEL using swap router
   * @param {bigint} amount - Amount of ibcUSDC to swap
   * @returns {Promise<bigint>} Amount of TFUEL received
   */
  async swapIbcUSDCToTFUEL(amount) {
    try {
      // NOTE: This is a PLACEHOLDER for actual swap logic
      // In production, this would:
      // 1. Approve swap router to spend ibcUSDC
      // 2. Get optimal swap route (ibcUSDC -> intermediate -> TFUEL)
      // 3. Execute swap with slippage protection
      // 4. Return TFUEL amount received

      logger.warn({ amount: amount.toString() }, 'MOCK swap ibcUSDC -> TFUEL (not implemented)');

      // For now, simulate a 1:1 swap ratio (adjust decimals: USDC 6, TFUEL 18)
      // Real price would come from DEX/oracle
      const mockTFUELAmount = amount * BigInt(1e12); // Convert USDC (6 decimals) to TFUEL (18 decimals)

      logger.info({
        ibcUSDC: ethers.formatUnits(amount, 6),
        tfuel: ethers.formatEther(mockTFUELAmount)
      }, 'MOCK swap executed');

      return mockTFUELAmount;

      /* Production code would look like:
      
      // Get ibcUSDC token contract
      const ibcUSDC = new ethers.Contract(ibcUSDCAddress, erc20Abi, this.relayerWallet);
      
      // Approve swap router
      const approveTx = await ibcUSDC.approve(config.yield.swapRouterAddress, amount);
      await approveTx.wait();
      
      // Get swap path (ibcUSDC -> WETH -> TFUEL or direct if pool exists)
      const path = [ibcUSDCAddress, wrappedNativeAddress];
      
      // Get expected output
      const amountsOut = await this.swapRouterContract.getAmountsOut(amount, path);
      const expectedTFUEL = amountsOut[amountsOut.length - 1];
      
      // Apply slippage tolerance (e.g., 1%)
      const minTFUEL = (expectedTFUEL * 99n) / 100n;
      
      // Execute swap
      const deadline = Math.floor(Date.now() / 1000) + 600; // 10 minutes
      const swapTx = await this.swapRouterContract.swapExactTokensForETH(
        amount,
        minTFUEL,
        path,
        this.relayerWallet.address,
        deadline
      );
      
      const receipt = await swapTx.wait();
      
      // Extract TFUEL amount from receipt
      return expectedTFUEL;
      */
    } catch (error) {
      logger.error({ err: error }, 'Failed to swap ibcUSDC to TFUEL');
      throw error;
    }
  }

  /**
   * Route TFUEL to RevenueSplitter contract
   * @param {bigint} tfuelAmount - Amount of TFUEL to route
   * @returns {Promise<void>}
   */
  async routeToRevenueSplitter(tfuelAmount) {
    try {
      logger.info({
        tfuelAmount: ethers.formatEther(tfuelAmount),
        revenueSplitter: config.yield.revenueSplitterAddress
      }, 'Routing TFUEL to RevenueSplitter');

      // Call RevenueSplitter.splitRevenueNative() with TFUEL
      const tx = await this.revenueSplitterContract.splitRevenueNative({
        value: tfuelAmount,
        gasLimit: BigInt(config.relayer.gasLimit) * 2n // Extra gas for complex split logic
      });

      logger.info({ txHash: tx.hash }, 'RevenueSplitter transaction submitted');

      // Wait for confirmation
      const provider = getProvider();
      const receipt = await provider.waitForTransaction(
        tx.hash,
        config.theta.requiredConfirmations
      );

      if (receipt.status === 0) {
        throw new Error('RevenueSplitter transaction failed');
      }

      logger.info({
        txHash: tx.hash,
        blockNumber: receipt.blockNumber
      }, 'TFUEL successfully routed to RevenueSplitter');
    } catch (error) {
      logger.error({ err: error }, 'Failed to route TFUEL to RevenueSplitter');
      throw error;
    }
  }

  /**
   * Reinvest 70% of yield for LP growth
   * @param {bigint} amount - Amount of ibcUSDC to reinvest
   * @param {string} beneficiary - Original burner who earned the yield
   * @returns {Promise<void>}
   */
  async reinvestYield(amount, beneficiary) {
    try {
      // NOTE: This is a PLACEHOLDER for actual reinvestment logic
      // In production, this would:
      // 1. Add liquidity to LP pools
      // 2. Compound staking positions
      // 3. Track reinvested amounts per user
      // 4. Mint LP tokens to user's account

      logger.warn({
        amount: ethers.formatUnits(amount, 6),
        beneficiary
      }, 'MOCK reinvestment for LP growth (not implemented)');

      // For now, just log the reinvestment
      logger.info({
        ibcUSDCAmount: ethers.formatUnits(amount, 6),
        beneficiary,
        purpose: 'LP_GROWTH'
      }, 'Yield reinvestment logged');

      /* Production code would look like:
      
      // Get LP pool contract
      const lpPool = new ethers.Contract(lpPoolAddress, lpPoolAbi, this.relayerWallet);
      
      // Approve LP pool to spend ibcUSDC
      const ibcUSDC = new ethers.Contract(ibcUSDCAddress, erc20Abi, this.relayerWallet);
      await ibcUSDC.approve(lpPoolAddress, amount);
      
      // Add liquidity or compound position
      const addLiquidityTx = await lpPool.addLiquidityForUser(
        beneficiary,
        amount,
        { gasLimit: config.relayer.gasLimit }
      );
      
      await addLiquidityTx.wait();
      
      logger.info({ beneficiary, amount }, 'Yield reinvested successfully');
      */
    } catch (error) {
      logger.error({ err: error }, 'Failed to reinvest yield');
      throw error;
    }
  }

  /**
   * Stop processing
   */
  stopProcessing() {
    this.isProcessing = false;
    logger.info('Yield unwrapper processing stopped');
  }

  /**
   * Helper sleep function
   * @param {number} ms - Milliseconds to sleep
   * @returns {Promise<void>}
   */
  sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Get unwrapper status
   * @returns {Object}
   */
  getStatus() {
    return {
      isProcessing: this.isProcessing,
      queueSize: this.processingQueue.length,
      config: {
        unwrapPercentage: config.yield.unwrapPercentage,
        reinvestPercentage: config.yield.reinvestPercentage,
        minYieldAmount: config.yield.minYieldAmount
      }
    };
  }
}

// Create singleton instance
let yieldUnwrapper = null;

/**
 * Initialize the yield unwrapper
 * @returns {Promise<YieldUnwrapper>}
 */
export async function initYieldUnwrapper() {
  if (!yieldUnwrapper) {
    yieldUnwrapper = new YieldUnwrapper();
    await yieldUnwrapper.init();
  }
  return yieldUnwrapper;
}

/**
 * Get the yield unwrapper instance
 * @returns {YieldUnwrapper}
 */
export function getYieldUnwrapper() {
  if (!yieldUnwrapper) {
    throw new Error('Yield unwrapper not initialized. Call initYieldUnwrapper() first.');
  }
  return yieldUnwrapper;
}

export default YieldUnwrapper;




