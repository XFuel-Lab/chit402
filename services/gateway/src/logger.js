import pino from 'pino';
import config from './config.js';

/**
 * Create a logger instance with appropriate configuration
 */
/** Salt and the disclosure header never reach a log line. */
export const LOG_REDACT = {
  paths: [
    'salt',
    'request.salt',
    'req.headers["x-chit-request-salt"]',
    'headers["x-chit-request-salt"]',
    'res.headers["x-chit-request-salt"]',
  ],
  censor: '[Redacted]',
};

const logger = pino({
  level: config.service.logLevel,
  redact: LOG_REDACT,
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

export default logger;
