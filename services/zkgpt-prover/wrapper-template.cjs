#!/usr/bin/env node
/**
 * zkGPT Prover HTTP wrapper template (Phase 1 — ZKG-1)
 *
 * Same API as mock-server.cjs (GET /health, POST /prove). Use this to wrap the
 * real C++ prover from security-Anonymous/zkgpt:
 *
 *   1. Build the upstream prover (see zkgpt-prover/README.md).
 *   2. Create a small adapter that reads JSON from stdin and writes JSON to stdout
 *      (proof, public_inputs, nullifier, proving_time_ms). Or set ZKGPT_PROVER_CMD
 *      to a binary that does the same.
 *   3. Run: ZKGPT_PROVER_CMD=/path/to/adapter node zkgpt-prover/wrapper-template.cjs
 *
 * If ZKGPT_PROVER_CMD is not set, this server behaves like the mock (stub proof).
 *
 * Env:
 *   ZKGPT_PROVER_PORT     — port (default 81)
 *   ZKGPT_PROVER_CMD      — optional: command to run for each /prove (stdin=JSON, stdout=JSON)
 *   ZKGPT_PROVER_TIMEOUT  — timeout ms for child (default 120000)
 *   ZKGPT_MOCK_DELAY_MS   — when using built-in mock, delay in ms (default 500)
 *
 * Reference: eprint.iacr.org/2025/1184; docs/REFERENCES-AND-ATTRIBUTION.md
 */

// First thing: prove process started (stderr often unbuffered on containers)
process.stderr.write('[zkgpt-wrapper] process started\n');
process.stdout.write('[zkgpt-wrapper] process started\n');

const http = require('http');
const crypto = require('crypto');
const { spawn } = require('child_process');

console.log('[zkgpt-wrapper] Starting...');
const PORT = parseInt(process.env.ZKGPT_PROVER_PORT || '81', 10);
const PROVER_CMD = process.env.ZKGPT_PROVER_CMD || '';
const PROVER_TIMEOUT_MS = parseInt(process.env.ZKGPT_PROVER_TIMEOUT_MS || '120000', 10);
const WRAPPER_VERSION = '2'; // bump when 502 body includes full adapter error (exit_code, stderr, ld_library_path)
const MOCK_PROOF_SIZE = 101 * 1024;
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

function mockResponse(body) {
  const delay = Math.min(MOCK_DELAY_MS, 30000);
  const proof = stubProofBytes();
  const nullifier = stubNullifier(body);
  const publicInputs = {
    task_id: body.task_id,
    output_hash: body.output_hash,
    net_amount: body.net_amount,
    block_number: body.block_number,
    merkle_root: body.merkle_root,
    identity_commitment: body.identity_commitment,
    task_type: body.task_type || 'inference_request',
    source_chain: body.source_chain || 'theta',
  };
  return {
    proof,
    proof_bytes: proof,
    public_inputs: publicInputs,
    publicInputs: publicInputs,
    nullifier,
    nullifier_hex: nullifier.replace(/^0x/, ''),
    proving_time_ms: delay,
    provingTimeMs: delay,
  };
}

function runProver(bodyJson, callback) {
  if (!PROVER_CMD || PROVER_CMD.trim() === '') {
    setTimeout(() => callback(null, mockResponse(bodyJson)), Math.min(MOCK_DELAY_MS, 30000));
    return;
  }
  const parts = PROVER_CMD.trim().split(/\s+/);
  const bin = parts[0];
  const args = parts.slice(1);
  const child = spawn(bin, args, {
    stdio: ['pipe', 'pipe', 'pipe'],
    shell: process.platform === 'win32',
    cwd: process.platform === 'win32' ? undefined : '/app',
  });
  let stdout = '';
  let stderr = '';
  const timeout = setTimeout(() => {
    child.kill('SIGTERM');
    callback(new Error('Prover timeout'));
  }, PROVER_TIMEOUT_MS);
  child.stdout.on('data', (chunk) => { stdout += chunk; });
  child.stderr.on('data', (chunk) => { stderr += chunk; });
  child.on('error', (err) => {
    clearTimeout(timeout);
    callback(err);
  });
  child.on('close', (code) => {
    clearTimeout(timeout);
    if (code !== 0) {
      // Adapter writes JSON to stdout on failure (prover_failed + binary stderr); surface it
      let errMsg = `Prover exited ${code}: ${stderr.slice(0, 500)}`;
      let errPayload = { error: errMsg };
      try {
        const out = JSON.parse(stdout.trim());
        if (out.error === 'prover_failed' && (out.exit_code != null || out.stderr != null)) {
          errMsg = `Prover exited ${out.exit_code ?? code}: ${(out.stderr || '').slice(0, 500)}`;
          errPayload = { error: errMsg, exit_code: out.exit_code ?? code, stderr: out.stderr, adapter_stderr: stderr.slice(0, 500) };
        }
      } catch (_) {}
      callback(Object.assign(new Error(errMsg), { payload: errPayload }));
      return;
    }
    try {
      const out = JSON.parse(stdout);
      if (!out.proof && !out.proof_bytes) {
        callback(new Error('Prover output missing proof'));
        return;
      }
      callback(null, {
        proof: out.proof || out.proof_bytes,
        proof_bytes: out.proof || out.proof_bytes,
        public_inputs: out.public_inputs || out.publicInputs || {},
        publicInputs: out.public_inputs || out.publicInputs || {},
        nullifier: out.nullifier || (out.nullifier_hex ? '0x' + out.nullifier_hex.replace(/^0x/, '') : '0x' + '00'.repeat(32)),
        nullifier_hex: (out.nullifier || out.nullifier_hex || '').replace(/^0x/, ''),
        proving_time_ms: out.proving_time_ms ?? out.provingTimeMs ?? 0,
        provingTimeMs: out.proving_time_ms ?? out.provingTimeMs ?? 0,
      });
    } catch (e) {
      callback(new Error('Prover output invalid JSON: ' + e.message));
    }
  });
  child.stdin.end(JSON.stringify(bodyJson), 'utf8');
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
    res.end(JSON.stringify({
      status: 'ok',
      service: PROVER_CMD ? 'zkgpt-wrapper' : 'zkgpt-mock',
      phase: 1,
      prover_cmd: PROVER_CMD ? 'set' : 'unset',
      wrapper_version: WRAPPER_VERSION,
    }));
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
      console.log('[zkgpt-wrapper] POST /prove received', parsed.task_id || '(no task_id)');

      runProver(parsed, (err, response) => {
        if (err) {
          console.error('[zkgpt-wrapper] Prover error:', err.message);
          const body = err.payload && typeof err.payload === 'object' ? err.payload : { error: err.message };
          res.writeHead(502, { 'Content-Type': 'application/json', ...cors });
          res.end(JSON.stringify(body));
          return;
        }
        res.writeHead(200, { 'Content-Type': 'application/json', ...cors });
        res.end(JSON.stringify(response));
      });
    });
    return;
  }

  res.writeHead(404, { 'Content-Type': 'application/json', ...cors });
  res.end(JSON.stringify({ error: 'Not found', path: req.url }));
});

server.on('error', (err) => {
  console.error('[zkgpt-wrapper] Server listen error:', err.message);
  process.exitCode = 1;
  process.exit(1);
});

try {
  server.listen(PORT, '0.0.0.0', () => {
    console.log(`[zkgpt-wrapper] Listening on http://localhost:${PORT}`);
    if (PROVER_CMD) {
      console.log(`[zkgpt-wrapper] Prover command: ${PROVER_CMD}`);
    } else {
      console.log(`[zkgpt-wrapper] No ZKGPT_PROVER_CMD — using built-in mock. Set ZKGPT_PROVER_CMD to wrap the C++ prover.`);
    }
  });
} catch (err) {
  console.error('[zkgpt-wrapper] listen() threw:', err && err.message);
  process.exit(1);
}

// Catch any uncaught exception so we log before exit (helps debug 0/20 on Theta)
process.on('uncaughtException', (err) => {
  console.error('[zkgpt-wrapper] uncaughtException:', err && err.message);
  process.exit(1);
});
process.on('unhandledRejection', (reason, p) => {
  console.error('[zkgpt-wrapper] unhandledRejection:', reason);
  process.exit(1);
});
