import { ethers } from 'ethers';
import config from './config.js';
import logger, { logRpcFailover } from './logger.js';

/**
 * Multi-RPC Provider with automatic failover
 * Manages multiple Theta RPC endpoints and switches on failure
 */
class MultiRpcProvider {
  constructor(rpcUrls) {
    this.rpcUrls = rpcUrls;
    this.currentIndex = 0;
    this.providers = [];
    this.activeProvider = null;
    this.failureCount = new Map(); // Track failures per endpoint
    
    this.initProviders();
  }

  /**
   * Initialize all provider instances
   */
  initProviders() {
    this.providers = this.rpcUrls.map((url, index) => {
      const provider = new ethers.JsonRpcProvider(url, undefined, {
        staticNetwork: true,
        batchMaxCount: 1
      });
      
      // Set timeout
      provider.pollingInterval = config.theta.blockPollInterval;
      
      this.failureCount.set(index, 0);
      
      logger.info({ url, index }, 'RPC provider initialized');
      return provider;
    });

    this.activeProvider = this.providers[0];
    logger.info({ url: this.rpcUrls[0] }, 'Active RPC provider set');
  }

  /**
   * Get the current active provider
   * @returns {ethers.JsonRpcProvider}
   */
  getProvider() {
    return this.activeProvider;
  }

  /**
   * Switch to next available RPC endpoint
   * @param {Error} error - Error that triggered the switch
   * @returns {boolean} True if switched successfully
   */
  async switchToNextProvider(error) {
    const failedUrl = this.rpcUrls[this.currentIndex];
    const failedIndex = this.currentIndex;
    
    // Increment failure count
    this.failureCount.set(failedIndex, this.failureCount.get(failedIndex) + 1);

    // Try next provider
    this.currentIndex = (this.currentIndex + 1) % this.providers.length;
    
    // If we've cycled through all providers, wait before retrying
    if (this.currentIndex === failedIndex) {
      logger.error('All RPC providers failed, waiting before retry');
      await this.sleep(config.retry.delayMs);
      
      // Reset failure counts
      this.failureCount.forEach((_, key) => this.failureCount.set(key, 0));
    }

    this.activeProvider = this.providers[this.currentIndex];
    const newUrl = this.rpcUrls[this.currentIndex];

    logRpcFailover(failedUrl, newUrl, error);
    
    // Test the new provider
    try {
      await this.activeProvider.getBlockNumber();
      logger.info({ url: newUrl }, 'Successfully switched to backup RPC');
      return true;
    } catch (testError) {
      logger.error({ err: testError, url: newUrl }, 'Backup RPC also failed');
      return false;
    }
  }

  /**
   * Execute a provider method with automatic retry and failover
   * @param {Function} fn - Function to execute (receives provider as argument)
   * @param {number} retries - Number of retries remaining
   * @returns {Promise<*>} Result of the function
   */
  async executeWithRetry(fn, retries = config.retry.maxRetries) {
    try {
      // Add timeout wrapper
      const timeoutPromise = new Promise((_, reject) => {
        setTimeout(() => reject(new Error('RPC timeout')), config.theta.timeout);
      });

      const result = await Promise.race([
        fn(this.activeProvider),
        timeoutPromise
      ]);

      // Reset failure count on success
      this.failureCount.set(this.currentIndex, 0);
      
      return result;
    } catch (error) {
      logger.warn({ 
        err: error, 
        retries, 
        url: this.rpcUrls[this.currentIndex] 
      }, 'RPC call failed');

      if (retries > 0) {
        // Try to switch provider
        const switched = await this.switchToNextProvider(error);
        
        if (switched || retries > 1) {
          // Wait before retry
          await this.sleep(config.retry.delayMs);
          return this.executeWithRetry(fn, retries - 1);
        }
      }

      throw error;
    }
  }

  /**
   * Get current block number with retry
   * @returns {Promise<number>}
   */
  async getBlockNumber() {
    return this.executeWithRetry(async (provider) => {
      return await provider.getBlockNumber();
    });
  }

  /**
   * Get transaction receipt with retry
   * @param {string} txHash - Transaction hash
   * @returns {Promise<Object>}
   */
  async getTransactionReceipt(txHash) {
    return this.executeWithRetry(async (provider) => {
      return await provider.getTransactionReceipt(txHash);
    });
  }

  /**
   * Get transaction with retry
   * @param {string} txHash - Transaction hash
   * @returns {Promise<Object>}
   */
  async getTransaction(txHash) {
    return this.executeWithRetry(async (provider) => {
      return await provider.getTransaction(txHash);
    });
  }

  /**
   * Get block with retry
   * @param {number|string} blockHashOrNumber - Block hash or number
   * @returns {Promise<Object>}
   */
  async getBlock(blockHashOrNumber) {
    return this.executeWithRetry(async (provider) => {
      return await provider.getBlock(blockHashOrNumber);
    });
  }

  /**
   * Wait for transaction with confirmations
   * @param {string} txHash - Transaction hash
   * @param {number} confirmations - Number of confirmations to wait for
   * @returns {Promise<Object>}
   */
  async waitForTransaction(txHash, confirmations = config.theta.requiredConfirmations) {
    return this.executeWithRetry(async (provider) => {
      return await provider.waitForTransaction(txHash, confirmations);
    });
  }

  /**
   * Get contract instance
   * @param {string} address - Contract address
   * @param {Array} abi - Contract ABI
   * @returns {ethers.Contract}
   */
  getContract(address, abi) {
    return new ethers.Contract(address, abi, this.activeProvider);
  }

  /**
   * Get signer (for transactions)
   * @param {string} privateKey - Private key
   * @returns {ethers.Wallet}
   */
  getSigner(privateKey) {
    return new ethers.Wallet(privateKey, this.activeProvider);
  }

  /**
   * Get network information
   * @returns {Promise<Object>}
   */
  async getNetwork() {
    return this.executeWithRetry(async (provider) => {
      return await provider.getNetwork();
    });
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
   * Get health status of all providers
   * @returns {Promise<Array>}
   */
  async getHealthStatus() {
    const status = [];

    for (let i = 0; i < this.providers.length; i++) {
      const provider = this.providers[i];
      const url = this.rpcUrls[i];
      
      try {
        const start = Date.now();
        await provider.getBlockNumber();
        const latency = Date.now() - start;
        
        status.push({
          url,
          healthy: true,
          latency,
          failures: this.failureCount.get(i),
          active: i === this.currentIndex
        });
      } catch (error) {
        status.push({
          url,
          healthy: false,
          error: error.message,
          failures: this.failureCount.get(i),
          active: i === this.currentIndex
        });
      }
    }

    return status;
  }
}

// Create singleton instance
let multiRpcProvider = null;

/**
 * Initialize the multi-RPC provider
 * @returns {MultiRpcProvider}
 */
export function initProvider() {
  if (!multiRpcProvider) {
    multiRpcProvider = new MultiRpcProvider(config.theta.rpcUrls);
    logger.info('Multi-RPC provider initialized');
  }
  return multiRpcProvider;
}

/**
 * Get the active provider instance
 * @returns {MultiRpcProvider}
 */
export function getProvider() {
  if (!multiRpcProvider) {
    throw new Error('Provider not initialized. Call initProvider() first.');
  }
  return multiRpcProvider;
}

export default MultiRpcProvider;

