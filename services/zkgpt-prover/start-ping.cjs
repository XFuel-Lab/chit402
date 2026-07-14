#!/usr/bin/env node
/**
 * Minimal HTTP server for Theta startup debugging.
 * Use as start command: node /app/start-ping.cjs
 * If this reaches 1/1 and /health works, the platform can run Node; then try wrapper-template.cjs.
 */
const http = require('http');
const port = parseInt(process.env.ZKGPT_PROVER_PORT || '81', 10);
console.log('[zkgpt-ping] Starting minimal server on port', port);
const server = http.createServer((req, res) => {
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ status: 'ok', service: 'zkgpt-ping', port }));
});
server.on('error', (err) => {
  console.error('[zkgpt-ping] Server listen error:', err.message);
  process.exitCode = 1;
  process.exit(1);
});
server.listen(port, '0.0.0.0', () => {
  console.log('[zkgpt-ping] Listening on port', port);
});
