import { createClient } from 'redis';
import config from './config.js';
import logger from './logger.js';

let redisClient = null;

/**
 * Initialize Redis connection
 * @returns {Promise<Object>} Redis client instance
 */
export async function initRedis() {
  if (redisClient) {
    return redisClient;
  }

  const clientConfig = {
    url: config.redis.url,
    database: config.redis.db
  };

  if (config.redis.password) {
    clientConfig.password = config.redis.password;
  }

  redisClient = createClient(clientConfig);

  redisClient.on('error', (err) => {
    logger.error({ err }, 'Redis client error');
  });

  redisClient.on('connect', () => {
    logger.info('Redis client connected');
  });

  redisClient.on('reconnecting', () => {
    logger.warn('Redis client reconnecting');
  });

  await redisClient.connect();
  
  logger.info('Redis initialized successfully');
  return redisClient;
}

/**
 * Store vault mapping (vault address -> Keplr address)
 * @param {string} vaultAddress - Unique SubVault address
 * @param {string} keplrAddress - User's Persistence/Keplr address
 * @param {number} nonce - Nonce used for vault creation
 * @returns {Promise<void>}
 */
export async function storeVaultMapping(vaultAddress, keplrAddress, nonce) {
  if (!redisClient) {
    throw new Error('Redis client not initialized');
  }

  const timestamp = Date.now();
  const expiryMs = config.expiry.milliseconds;
  const expirySeconds = Math.floor(expiryMs / 1000);

  const mapping = {
    keplrAddr: keplrAddress,
    timestamp,
    nonce,
    status: 'pending'
  };

  // Store with TTL
  await redisClient.set(
    `vault:${vaultAddress.toLowerCase()}`,
    JSON.stringify(mapping),
    { EX: expirySeconds }
  );

  logger.info({
    vault: vaultAddress,
    keplrAddr: keplrAddress,
    nonce,
    expiryMinutes: config.expiry.minutes
  }, 'Vault mapping stored in Redis');
}

/**
 * Retrieve vault mapping
 * @param {string} vaultAddress - Unique SubVault address
 * @returns {Promise<Object|null>} Mapping object or null if not found/expired
 */
export async function getVaultMapping(vaultAddress) {
  if (!redisClient) {
    throw new Error('Redis client not initialized');
  }

  const key = `vault:${vaultAddress.toLowerCase()}`;
  const data = await redisClient.get(key);

  if (!data) {
    logger.warn({ vault: vaultAddress }, 'Vault mapping not found or expired');
    return null;
  }

  const mapping = JSON.parse(data);
  
  // Double-check expiry
  const age = Date.now() - mapping.timestamp;
  if (age > config.expiry.milliseconds) {
    logger.warn({ vault: vaultAddress, ageMs: age }, 'Vault mapping expired');
    await redisClient.del(key);
    return null;
  }

  return mapping;
}

/**
 * Update vault mapping status
 * @param {string} vaultAddress - Unique SubVault address
 * @param {string} status - New status (pending, processing, completed, refunded)
 * @returns {Promise<boolean>} True if updated, false if not found
 */
export async function updateVaultStatus(vaultAddress, status) {
  if (!redisClient) {
    throw new Error('Redis client not initialized');
  }

  const key = `vault:${vaultAddress.toLowerCase()}`;
  const data = await redisClient.get(key);

  if (!data) {
    return false;
  }

  const mapping = JSON.parse(data);
  mapping.status = status;
  mapping.lastUpdated = Date.now();

  // Get remaining TTL
  const ttl = await redisClient.ttl(key);
  
  if (ttl > 0) {
    await redisClient.set(key, JSON.stringify(mapping), { EX: ttl });
    logger.info({ vault: vaultAddress, status }, 'Vault status updated');
    return true;
  }

  return false;
}

/**
 * Mark vault as processed/completed
 * @param {string} vaultAddress - Unique SubVault address
 * @param {string} proofHash - Hash of the ZK proof
 * @returns {Promise<boolean>} True if updated
 */
export async function markVaultCompleted(vaultAddress, proofHash) {
  if (!redisClient) {
    throw new Error('Redis client not initialized');
  }

  const key = `vault:${vaultAddress.toLowerCase()}`;
  const data = await redisClient.get(key);

  if (!data) {
    return false;
  }

  const mapping = JSON.parse(data);
  mapping.status = 'completed';
  mapping.proofHash = proofHash;
  mapping.completedAt = Date.now();

  // Keep completed records for 7 days for audit
  const sevenDaysInSeconds = 7 * 24 * 60 * 60;
  await redisClient.set(key, JSON.stringify(mapping), { EX: sevenDaysInSeconds });

  logger.info({ vault: vaultAddress, proofHash }, 'Vault marked as completed');
  return true;
}

/**
 * Mark vault as refunded
 * @param {string} vaultAddress - Unique SubVault address
 * @param {string} txHash - Refund transaction hash
 * @returns {Promise<boolean>} True if updated
 */
export async function markVaultRefunded(vaultAddress, txHash) {
  if (!redisClient) {
    throw new Error('Redis client not initialized');
  }

  const key = `vault:${vaultAddress.toLowerCase()}`;
  const data = await redisClient.get(key);

  if (!data) {
    return false;
  }

  const mapping = JSON.parse(data);
  mapping.status = 'refunded';
  mapping.refundTxHash = txHash;
  mapping.refundedAt = Date.now();

  // Keep refund records for 30 days for audit
  const thirtyDaysInSeconds = 30 * 24 * 60 * 60;
  await redisClient.set(key, JSON.stringify(mapping), { EX: thirtyDaysInSeconds });

  logger.info({ vault: vaultAddress, txHash }, 'Vault marked as refunded');
  return true;
}

/**
 * Get all pending vaults (for monitoring/debugging)
 * @returns {Promise<Array>} Array of pending vault mappings
 */
export async function getPendingVaults() {
  if (!redisClient) {
    throw new Error('Redis client not initialized');
  }

  const keys = await redisClient.keys('vault:*');
  const pendingVaults = [];

  for (const key of keys) {
    const data = await redisClient.get(key);
    if (data) {
      const mapping = JSON.parse(data);
      if (mapping.status === 'pending' || mapping.status === 'processing') {
        pendingVaults.push({
          vault: key.replace('vault:', ''),
          ...mapping
        });
      }
    }
  }

  return pendingVaults;
}

/**
 * Store reverse-burn event from Persistence chain
 * @param {Object} burnData - Burn event data from Persistence
 * @returns {Promise<void>}
 */
export async function storeReverseBurnEvent(burnData) {
  if (!redisClient) {
    throw new Error('Redis client not initialized');
  }

  const key = `reverse-burn:${burnData.txHash}`;
  const timestamp = Date.now();

  const eventData = {
    ...burnData,
    timestamp,
    status: 'pending',
    processedAt: null
  };

  // Store with 7-day TTL
  const sevenDaysInSeconds = 7 * 24 * 60 * 60;
  await redisClient.set(key, JSON.stringify(eventData), { EX: sevenDaysInSeconds });

  logger.info({
    txHash: burnData.txHash,
    burner: burnData.burner,
    ibcUSDCYield: burnData.ibcUSDCYield
  }, 'Reverse-burn event stored in Redis');
}

/**
 * Get pending reverse-burn events
 * @returns {Promise<Array>} Array of pending reverse-burn events
 */
export async function getReverseBurnEvents() {
  if (!redisClient) {
    throw new Error('Redis client not initialized');
  }

  const keys = await redisClient.keys('reverse-burn:*');
  const pendingEvents = [];

  for (const key of keys) {
    const data = await redisClient.get(key);
    if (data) {
      const event = JSON.parse(data);
      if (event.status === 'pending') {
        pendingEvents.push({
          txHash: key.replace('reverse-burn:', ''),
          ...event
        });
      }
    }
  }

  return pendingEvents;
}

/**
 * Mark reverse-burn event as processed
 * @param {string} txHash - Transaction hash of the burn event
 * @param {string} status - Final status (completed, failed, below_threshold)
 * @returns {Promise<boolean>} True if updated
 */
export async function markReverseBurnProcessed(txHash, status) {
  if (!redisClient) {
    throw new Error('Redis client not initialized');
  }

  const key = `reverse-burn:${txHash}`;
  const data = await redisClient.get(key);

  if (!data) {
    return false;
  }

  const event = JSON.parse(data);
  event.status = status;
  event.processedAt = Date.now();

  // Keep processed records for 30 days for audit
  const thirtyDaysInSeconds = 30 * 24 * 60 * 60;
  await redisClient.set(key, JSON.stringify(event), { EX: thirtyDaysInSeconds });

  logger.info({ txHash, status }, 'Reverse-burn event marked as processed');
  return true;
}

/**
 * Get reverse-burn statistics
 * @returns {Promise<Object>} Statistics about reverse-burn events
 */
export async function getReverseBurnStats() {
  if (!redisClient) {
    throw new Error('Redis client not initialized');
  }

  const keys = await redisClient.keys('reverse-burn:*');
  const stats = {
    total: 0,
    pending: 0,
    completed: 0,
    failed: 0,
    belowThreshold: 0
  };

  for (const key of keys) {
    const data = await redisClient.get(key);
    if (data) {
      const event = JSON.parse(data);
      stats.total++;
      
      if (event.status === 'pending') stats.pending++;
      else if (event.status === 'completed') stats.completed++;
      else if (event.status === 'failed') stats.failed++;
      else if (event.status === 'below_threshold') stats.belowThreshold++;
    }
  }

  return stats;
}

/**
 * Close Redis connection
 * @returns {Promise<void>}
 */
export async function closeRedis() {
  if (redisClient) {
    await redisClient.quit();
    redisClient = null;
    logger.info('Redis connection closed');
  }
}

export { redisClient };

