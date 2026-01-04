import { ethers } from 'ethers';
import { getProvider } from './provider.js';
import { getVaultMapping, markVaultRefunded } from './redis-client.js';
import config from './config.js';
import logger, { logRefund } from './logger.js';
import { readFile } from 'fs/promises';

/**
 * Refund Manager
 * Handles refunds for expired or invalid vault deposits
 */
class RefundManager {
  constructor() {
    this.relayerWallet = null;
    this.vaultFactoryContract = null;
    this.pendingRefunds = new Map();
  }

  /**
   * Initialize the refund manager
   * @returns {Promise<void>}
   */
  async init() {
    try {
      const provider = getProvider();
      
      // Create relayer wallet
      this.relayerWallet = provider.getSigner(config.relayer.privateKey);
      
      logger.info({
        relayerAddress: await this.relayerWallet.getAddress()
      }, 'Refund manager initialized');

      // Load VaultFactory ABI
      const vaultFactoryAbi = JSON.parse(
        await readFile(config.contracts.vaultFactoryAbiPath, 'utf8')
      );

      // Create VaultFactory contract instance
      this.vaultFactoryContract = new ethers.Contract(
        config.contracts.vaultFactoryAddress,
        vaultFactoryAbi,
        this.relayerWallet
      );

      logger.info({
        factoryAddress: config.contracts.vaultFactoryAddress
      }, 'VaultFactory contract loaded');
    } catch (error) {
      logger.error({ err: error }, 'Failed to initialize refund manager');
      throw error;
    }
  }

  /**
   * Process refund for expired/invalid vault mapping
   * @param {string} vaultAddress - Vault address to refund from
   * @param {string} reason - Reason for refund
   * @returns {Promise<string|null>} Transaction hash or null if failed
   */
  async processRefund(vaultAddress, reason) {
    try {
      // Check if refund is already pending
      if (this.pendingRefunds.has(vaultAddress)) {
        logger.warn({ vault: vaultAddress }, 'Refund already pending for this vault');
        return null;
      }

      // Get vault mapping to find original sender
      const mapping = await getVaultMapping(vaultAddress);
      
      // If no mapping exists, we need to check on-chain vault balance
      const provider = getProvider();
      const balance = await provider.executeWithRetry(async (p) => {
        return await p.getBalance(vaultAddress);
      });

      if (balance === 0n) {
        logger.info({ vault: vaultAddress }, 'Vault has no balance, skipping refund');
        return null;
      }

      // Mark as pending
      this.pendingRefunds.set(vaultAddress, {
        timestamp: Date.now(),
        reason
      });

      logger.info({
        vault: vaultAddress,
        balance: ethers.formatEther(balance),
        reason
      }, 'Initiating refund');

      // Determine recipient (original sender from mapping or fallback)
      let recipient;
      if (mapping && mapping.keplrAddr) {
        // For expired mappings, we need to determine the original depositor
        // This would typically be stored in the mapping or retrieved from events
        recipient = await this.getOriginalDepositor(vaultAddress);
      } else {
        recipient = await this.getOriginalDepositor(vaultAddress);
      }

      if (!recipient) {
        logger.error({ vault: vaultAddress }, 'Cannot determine refund recipient');
        this.pendingRefunds.delete(vaultAddress);
        return null;
      }

      // Execute refund via VaultFactory
      const txHash = await this.executeRefund(vaultAddress, recipient, balance);

      if (txHash) {
        // Update Redis
        await markVaultRefunded(vaultAddress, txHash);
        
        logRefund(vaultAddress, recipient, reason);
        
        logger.info({
          vault: vaultAddress,
          recipient,
          amount: ethers.formatEther(balance),
          txHash
        }, 'Refund completed successfully');
      }

      // Remove from pending
      this.pendingRefunds.delete(vaultAddress);

      return txHash;
    } catch (error) {
      logger.error({ err: error, vault: vaultAddress }, 'Refund processing failed');
      this.pendingRefunds.delete(vaultAddress);
      return null;
    }
  }

  /**
   * Execute refund transaction
   * @param {string} vaultAddress - Vault address
   * @param {string} recipient - Refund recipient
   * @param {bigint} amount - Amount to refund
   * @returns {Promise<string>} Transaction hash
   */
  async executeRefund(vaultAddress, recipient, amount) {
    try {
      // Estimate gas
      const gasEstimate = await this.vaultFactoryContract.refundFromVault.estimateGas(
        vaultAddress,
        recipient,
        amount
      );

      // Add 20% buffer to gas estimate
      const gasLimit = (gasEstimate * 120n) / 100n;

      logger.info({
        vault: vaultAddress,
        recipient,
        amount: ethers.formatEther(amount),
        gasLimit: gasLimit.toString()
      }, 'Executing refund transaction');

      // Execute refund
      const tx = await this.vaultFactoryContract.refundFromVault(
        vaultAddress,
        recipient,
        amount,
        {
          gasLimit: gasLimit > BigInt(config.relayer.gasLimit) 
            ? gasLimit 
            : BigInt(config.relayer.gasLimit)
        }
      );

      logger.info({
        txHash: tx.hash,
        vault: vaultAddress
      }, 'Refund transaction submitted');

      // Wait for confirmation
      const provider = getProvider();
      const receipt = await provider.waitForTransaction(
        tx.hash,
        config.theta.requiredConfirmations
      );

      if (receipt.status === 0) {
        throw new Error('Refund transaction failed');
      }

      return tx.hash;
    } catch (error) {
      // Check if it's a revert with reason
      if (error.reason) {
        logger.error({
          err: error,
          reason: error.reason,
          vault: vaultAddress
        }, 'Refund transaction reverted');
      } else {
        logger.error({
          err: error,
          vault: vaultAddress
        }, 'Refund transaction failed');
      }
      throw error;
    }
  }

  /**
   * Get original depositor from past events
   * @param {string} vaultAddress - Vault address
   * @returns {Promise<string|null>} Depositor address
   */
  async getOriginalDepositor(vaultAddress) {
    try {
      const provider = getProvider();
      
      // Load SubVault ABI
      const subVaultAbi = JSON.parse(
        await readFile(config.contracts.subVaultAbiPath, 'utf8')
      );

      // Create contract instance
      const vaultContract = new ethers.Contract(
        vaultAddress,
        subVaultAbi,
        provider.getProvider()
      );

      // Query past DepositReceived events
      const filter = vaultContract.filters.DepositReceived();
      const events = await provider.executeWithRetry(async (p) => {
        return await vaultContract.queryFilter(filter);
      });

      if (events.length > 0) {
        // Return the sender from the first (or most recent) deposit
        const latestEvent = events[events.length - 1];
        return latestEvent.args.sender;
      }

      logger.warn({ vault: vaultAddress }, 'No deposit events found for vault');
      return null;
    } catch (error) {
      logger.error({ err: error, vault: vaultAddress }, 'Failed to get original depositor');
      return null;
    }
  }

  /**
   * Check if vault mapping is expired
   * @param {Object} mapping - Vault mapping object
   * @returns {boolean}
   */
  isExpired(mapping) {
    if (!mapping || !mapping.timestamp) {
      return true;
    }

    const age = Date.now() - mapping.timestamp;
    return age > config.expiry.milliseconds;
  }

  /**
   * Check vault and process refund if expired
   * @param {string} vaultAddress - Vault address
   * @returns {Promise<boolean>} True if refund was processed
   */
  async checkAndRefund(vaultAddress) {
    const mapping = await getVaultMapping(vaultAddress);

    if (!mapping) {
      logger.info({ vault: vaultAddress }, 'Initiating refund - mapping not found');
      const txHash = await this.processRefund(vaultAddress, 'mapping_not_found');
      return txHash !== null;
    }

    if (this.isExpired(mapping)) {
      logger.info({ vault: vaultAddress }, 'Initiating refund - mapping expired');
      const txHash = await this.processRefund(vaultAddress, 'mapping_expired');
      return txHash !== null;
    }

    return false;
  }

  /**
   * Get relayer wallet balance
   * @returns {Promise<string>} Balance in TFUEL
   */
  async getRelayerBalance() {
    try {
      const provider = getProvider();
      const address = await this.relayerWallet.getAddress();
      const balance = await provider.executeWithRetry(async (p) => {
        return await p.getBalance(address);
      });
      return ethers.formatEther(balance);
    } catch (error) {
      logger.error({ err: error }, 'Failed to get relayer balance');
      return '0';
    }
  }

  /**
   * Get pending refunds
   * @returns {Array} List of pending refunds
   */
  getPendingRefunds() {
    return Array.from(this.pendingRefunds.entries()).map(([vault, data]) => ({
      vault,
      ...data
    }));
  }
}

// Create singleton instance
let refundManager = null;

/**
 * Initialize the refund manager
 * @returns {Promise<RefundManager>}
 */
export async function initRefundManager() {
  if (!refundManager) {
    refundManager = new RefundManager();
    await refundManager.init();
  }
  return refundManager;
}

/**
 * Get the refund manager instance
 * @returns {RefundManager}
 */
export function getRefundManager() {
  if (!refundManager) {
    throw new Error('Refund manager not initialized. Call initRefundManager() first.');
  }
  return refundManager;
}

export default RefundManager;

