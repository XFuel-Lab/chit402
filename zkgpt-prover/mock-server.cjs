#!/usr/bin/env node
/**
 * Mock zkGPT prover HTTP server (Phase 1 — ZKG-1 E2E)
 *
 * Exposes the API expected by backend/theta-bridge zkgpt-prover-client.js and
 * core-layer ai-listener.js. Returns stub proof/publicValues/nullifier so you
 * can E2E test the flow (task with proof_system: zkgpt → this server → handler).
 * Replace with a wrapper around the real C++ prover (security-Anonymous/zkgpt)
 * when building from upstream.
 *
 * Usage:
 *   node zkgpt-prover/mock-server.cjs
 *   ZKGPT_PROVER_PORT=81 node zkgpt-prover/mock-server.cjs
 *
 * Then set ZKGPT_PROVER_URL=http://localhost:81 in backend or core-layer.
 * Reference: eprint.iacr.org/2025/1184; docs/REFERENCES-AND-ATTRIBUTION.md
 */

const http = require('http');
const crypto = require('crypto');

const PORT = parseInt(process.env.ZKGPT_PROVER_PORT || '81', 10);
const MOCK_PROOF_SIZE = 101 * 1024; // ~101 KB placeholder
const MOCK_DELAY_MS = parseInt(process.env.ZKGPT_MOCK_DELAY_MS || '500', 10);

function stubProofBytes() {
  const buf = Buffer.alloc(MOCK_PROOF_SIZE);
  crypto.randomFillSync(buf);
  return '0x' + buf.toString('hex');
}

function stubNullifier(body) {
  const seed = body.task_id || body.output_hash || crypto.randomBytes(32).toString('hex');
  return '0x' + crypto.createHash('sha256').update(seed).digest('hex');
}

const server = http.createServer((req, res) => {
  const cors = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  };

  if (req.method === 'OPTIONS') {
    res.writeHead(204, { ...cors, 'Content-Length': 0 });
    res.end();
    return;
  }

  if (req.method === 'GET' && (req.url === '/' || req.url === '/health')) {
    res.writeHead(200, { 'Content-Type': 'application/json', ...cors });
    res.end(JSON.stringify({ status: 'ok', service: 'zkgpt-mock', phase: 1 }));
    return;
  }

  if (req.method === 'POST' && req.url === '/prove') {
    let body = '';
    req.on('data', (chunk) => { body += chunk; });
    req.on('end', () => {
      let parsed = {};
      try {
        parsed = body ? JSON.parse(body) : {};
      } catch (_) {}

      const delay = Math.min(MOCK_DELAY_MS, 30000);
      setTimeout(() => {
        const proof = stubProofBytes();
        const nullifier = stubNullifier(parsed);
        const publicInputs = {
          task_id: parsed.task_id,
          output_hash: parsed.output_hash,
          net_amount: parsed.net_amount,
          block_number: parsed.block_number,
          merkle_root: parsed.merkle_root,
          identity_commitment: parsed.identity_commitment,
          task_type: parsed.task_type || 'inference_request',
          source_chain: parsed.source_chain || 'theta',
        };
        const response = {
          proof,
          proof_bytes: proof,
          public_inputs: publicInputs,
          publicInputs,
          nullifier,
          nullifier_hex: nullifier.replace(/^0x/, ''),
          proving_time_ms: delay,
          provingTimeMs: delay,
        };
        res.writeHead(200, { 'Content-Type': 'application/json', ...cors });
        res.end(JSON.stringify(response));
      }, delay);
    });
    return;
  }

  res.writeHead(404, { 'Content-Type': 'application/json', ...cors });
  res.end(JSON.stringify({ error: 'Not found', path: req.url }));
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`[zkgpt-mock] Phase 1 mock prover listening on http://localhost:${PORT}`);
  console.log(`[zkgpt-mock] GET /health → 200 | POST /prove → stub proof (~101KB), nullifier, public_inputs`);
  console.log(`[zkgpt-mock] Set ZKGPT_PROVER_URL=http://localhost:${PORT} in backend or core-layer to E2E test.`);
});
