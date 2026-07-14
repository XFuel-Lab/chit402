module.exports = {
  apps: [{
    name: 'theta-bridge',
    script: './src/index.js',
    instances: 1,
    exec_mode: 'fork',
    autorestart: true,
    watch: false,
    max_memory_restart: '1G',
    env: {
      NODE_ENV: 'production',
      // Reverse-burn loop configuration
      YIELD_UNWRAP_PERCENTAGE: '30',
      YIELD_REINVEST_PERCENTAGE: '70'
    },
    env_development: {
      NODE_ENV: 'development',
      LOG_LEVEL: 'debug',
      YIELD_UNWRAP_PERCENTAGE: '30',
      YIELD_REINVEST_PERCENTAGE: '70'
    },
    error_file: './logs/error.log',
    out_file: './logs/out.log',
    log_file: './logs/combined.log',
    time: true,
    merge_logs: true,
    log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
    // Restart policy
    min_uptime: '10s',
    max_restarts: 10,
    restart_delay: 4000,
    // Graceful shutdown with longer timeout for reverse-burn processing
    kill_timeout: 10000,
    listen_timeout: 5000,
    shutdown_with_message: true,
    // Monitoring
    instance_var: 'INSTANCE_ID',
    // Advanced features
    merge_logs: true,
    autorestart: true,
    watch: false,
    // Cron restart (optional - restart daily at 3 AM)
    // cron_restart: '0 3 * * *',
    // Environment-specific settings
    node_args: '--max-old-space-size=512'
  }]
};

