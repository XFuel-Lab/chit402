#!/usr/bin/env node
/**
 * E2E prover test (Phase 1 — ZKG-1)
 *
 * Spawns the wrapper-template (same service used on Theta EdgeCloud), sends a
 * proof request in the exact shape the backend sends (zkgpt-prover-client.js),
 * and asserts the response matches what the backend and handlers expect.
 * Confirms the prover is in E2E-ready state.
 *
 * Run from repo root: node zkgpt-prover/e2e-prover-test.cjs
 * Or: npm run test:zkgpt-e2e
 */

const http = require('http');
const { spawn } = require('child_process');
const path = require('path');

const PORT = parseInt(process.env.ZKGPT_E2E_PORT || '8098', 10);
const ROOT = path.resolve(__dirname, '..');
const WRAPPER_SCRIPT = path.join(__dirname, 'wrapper-template.cjs');

function get(url) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const req = http.request(
      { hostname: u.hostname, port: u.port || 80, path: u.pathname, method: 'GET' },
      (res) => {
        let body = '';
        res.on('data', (c) => { body += c; });
        res.on('end', () => resolve({ status: res.statusCode, body }));
      }
    );
    req.on('error', reject);
    req.setTimeout(5000, () => { req.destroy(); reject(new Error('timeout')); });
    req.end();
  });
}

function post(url, body) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(body);
    const u = new URL(url);
    const req = http.request({
      hostname: u.hostname,
      port: u.port || 80,
      path: u.pathname,
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) },
    }, (res) => {
      let out = '';
      res.on('data', (c) => { out += c; });
      res.on('end', () => {
        try {
          resolve({ status: res.statusCode, data: JSON.parse(out) });
        } catch {
          resolve({ status: res.statusCode, data: null, raw: out });
        }
      });
    });
    req.on('error', reject);
    req.setTimeout(120000, () => { req.destroy(); reject(new Error('timeout')); });
    req.end(data);
  });
}

async function waitForHealth(baseUrl, maxAttempts = 30) {
  for (let i = 0; i < maxAttempts; i++) {
    try {
      const r = await get(`${baseUrl}/health`);
      if (r.status === 200) return true;
    } catch (_) {}
    await new Promise((r) => setTimeout(r, 200));
  }
  return false;
}

async function main() {
  const baseUrl = `http://127.0.0.1:${PORT}`;
  const child = spawn(process.execPath, [WRAPPER_SCRIPT], {
    env: { ...process.env, ZKGPT_PROVER_PORT: String(PORT), ZKGPT_MOCK_DELAY_MS: '100' },
    cwd: ROOT,
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  let stderr = '';
  child.stderr.on('data', (c) => { stderr += c.toString(); });
  child.on('error', (err) => {
    console.error('Failed to start wrapper:', err.message);
    process.exit(1);
  });

  const exit = new Promise((resolve) => child.on('exit', (code, sig) => resolve({ code, sig })));

  try {
    const ready = await waitForHealth(baseUrl);
    if (!ready) {
      console.error('Wrapper did not become ready. stderr:', stderr);
      child.kill('SIGTERM');
      process.exit(1);
    }

    // Exact body shape sent by backend/theta-bridge/src/zkgpt-prover-client.js generateProof()
    const proveBody = {
      task_id: 'e2e-task-' + Date.now(),
      net_amount: '995000',
      block_number: 12345,
      merkle_root: '0x' + 'cd'.repeat(32),
      identity_commitment: '0x' + 'ef'.repeat(32),
      output_hash: '0x' + 'ab'.repeat(32),
      task_type: 'inference_request',
      source_chain: 'theta',
    };

    const res = await post(`${baseUrl}/prove`, proveBody);
    if (res.status !== 200) {
      console.error('POST /prove returned', res.status, res.raw || res.data);
      process.exit(1);
    }
    const d = res.data;
    if (!d) {
      console.error('POST /prove returned invalid JSON');
      process.exit(1);
    }

    const proof = d.proof ?? d.proof_bytes;
    const nullifier = d.nullifier ?? ('0x' + (d.nullifier_hex || '').replace(/^0x/, ''));
    const publicInputs = d.public_inputs ?? d.publicInputs;
    const provingTimeMs = d.proving_time_ms ?? d.provingTimeMs;

    if (!proof || (typeof proof === 'string' && proof.length < 100)) {
      console.error('Response missing or too small proof');
      process.exit(1);
    }
    if (!nullifier || !nullifier.startsWith('0x')) {
      console.error('Response missing valid nullifier (0x-prefixed)');
      process.exit(1);
    }
    if (!publicInputs || typeof publicInputs !== 'object') {
      console.error('Response missing public_inputs object');
      process.exit(1);
    }
    if (provingTimeMs == null) {
      console.error('Response missing proving_time_ms');
      process.exit(1);
    }

    const proofSize = typeof proof === 'string'
      ? (proof.startsWith('0x') ? (proof.length - 2) / 2 : Buffer.from(proof, 'base64').length)
      : (proof.length || 0);
    console.log('E2E prover OK: wrapper-template responded to backend-shaped request');
    console.log('  proof size:', Math.round(proofSize / 1024) + 'KB, nullifier:', nullifier.slice(0, 20) + '..., proving_time_ms:', provingTimeMs);
  } finally {
    child.kill('SIGTERM');
    await exit;
  }
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
