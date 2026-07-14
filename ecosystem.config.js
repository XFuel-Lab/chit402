module.exports = {
  apps: [{
    name: 'xfuel-backend',
    script: './services/gateway/src/server.js',
    instances: 1,
    exec_mode: 'fork',
    watch: false,
    node_args: '--max-old-space-size=1024',
    max_memory_restart: '1G',
    
    // Auto-restart configuration
    autorestart: true,
    max_restarts: 10,
    min_uptime: '10s',
    restart_delay: 5000,
    
    // Timeout configuration
    listen_timeout: 5000,
    kill_timeout: 5000,
    
    // Logging
    error_file: './logs/backend-error.log',
    out_file: './logs/backend-out.log',
    log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
    merge_logs: true,
    
    // Environment variables
    env: {
      NODE_ENV: 'development',
      PORT: 3000
    },
    env_production: {
      NODE_ENV: 'production',
      PORT: 3000,
      BACKEND_POLL_INTERVAL: 2000,
      BACKEND_BATCH_SIZE: 100,
      BACKEND_CACHE_TTL: 60
    }
  }]
};

