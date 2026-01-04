import pino from 'pino';
import config from './config.js';

/**
 * Create a logger instance with appropriate configuration
 */
const logger = pino({
  level: config.service.logLevel,
  transport: config.service.nodeEnv === 'development' ? {
    target: 'pino-pretty',
    options: {
      colorize: true,
      translateTime: 'SYS:standard',
      ignore: 'pid,hostname'
    }
  } : undefined,
  formatters: {
    level: (label) => {
      return { level: label };
    }
  },
  timestamp: pino.stdTimeFunctions.isoTime
});

/**
 * Create a child logger with additional context
 * @param {Object} context - Additional context to add to all log entries
 * @returns {Object} Child logger instance
 */
export function createChildLogger(context) {
  return logger.child(context);
}

/**
 * Log an error with stack trace
 * @param {Error} error - Error object to log
 * @param {string} message - Additional message
 * @param {Object} context - Additional context
 */
export function logError(error, message, context = {}) {
  logger.error({
    err: error,
    message,
    stack: error.stack,
    ...context
  });
}

/**
 * Log successful deposit event processing
 * @param {Object} event - Deposit event data
 */
export function logDepositEvent(event) {
  logger.info({
    event: 'DepositReceived',
    vault: event.vault,
    sender: event.sender,
    grossAmount: event.grossAmount.toString(),
    feeAmount: event.feeAmount.toString(),
    netAmount: event.netAmount.toString(),
    blockNumber: event.blockNumber,
    transactionHash: event.transactionHash
  }, 'Deposit event detected');
}

/**
 * Log successful proof generation
 * @param {string} vaultAddress - Vault address
 * @param {string} proofHash - Hash of generated proof
 */
export function logProofGenerated(vaultAddress, proofHash) {
  logger.info({
    event: 'ProofGenerated',
    vault: vaultAddress,
    proofHash
  }, 'ZK proof generated successfully');
}

/**
 * Log refund initiation
 * @param {string} vaultAddress - Vault address
 * @param {string} recipient - Refund recipient
 * @param {string} reason - Reason for refund
 */
export function logRefund(vaultAddress, recipient, reason) {
  logger.warn({
    event: 'RefundInitiated',
    vault: vaultAddress,
    recipient,
    reason
  }, 'Refund initiated');
}

/**
 * Log RPC failover
 * @param {string} failedUrl - URL that failed
 * @param {string} newUrl - New URL being used
 * @param {Error} error - Error that caused failover
 */
export function logRpcFailover(failedUrl, newUrl, error) {
  logger.warn({
    event: 'RpcFailover',
    failedUrl,
    newUrl,
    error: error.message
  }, 'RPC endpoint failed, switching to backup');
}

/**
 * Log service startup
 */
export function logStartup() {
  logger.info({
    event: 'ServiceStartup',
    nodeEnv: config.service.nodeEnv,
    port: config.service.port,
    rpcCount: config.theta.rpcUrls.length
  }, 'Theta-Persistence ZK Bridge service starting');
}

/**
 * Log service shutdown
 */
export function logShutdown() {
  logger.info({
    event: 'ServiceShutdown'
  }, 'Theta-Persistence ZK Bridge service shutting down');
}

/**
 * Log reverse-burn event detected
 * @param {Object} burnData - Burn event data
 */
export function logReverseBurnEvent(burnData) {
  logger.info({
    event: 'ReverseBurnDetected',
    txHash: burnData.txHash,
    burner: burnData.burner,
    ibcTFUELBurned: burnData.amount,
    ibcUSDCYield: burnData.ibcUSDCYield,
    blockHeight: burnData.blockHeight
  }, 'Persistence burn event detected');
}

/**
 * Log yield unwrap completion
 * @param {string} txHash - Burn transaction hash
 * @param {string} tfuelAmount - Amount of TFUEL received from swap
 * @param {string} reinvestedAmount - Amount reinvested
 */
export function logYieldUnwrap(txHash, tfuelAmount, reinvestedAmount) {
  logger.info({
    event: 'YieldUnwrapped',
    txHash,
    tfuelToRevenueSplitter: tfuelAmount,
    reinvestedForLP: reinvestedAmount
  }, 'Yield unwrapped and routed successfully');
}

/**
 * Log revenue routing to RevenueSplitter
 * @param {string} txHash - RevenueSplitter transaction hash
 * @param {string} tfuelAmount - Amount of TFUEL routed
 */
export function logRevenueRouted(txHash, tfuelAmount) {
  logger.info({
    event: 'RevenueRouted',
    txHash,
    tfuelAmount
  }, 'TFUEL routed to RevenueSplitter');
}

export default logger;

