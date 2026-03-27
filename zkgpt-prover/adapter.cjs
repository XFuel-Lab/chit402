#!/usr/bin/env node
/**
 * Adapter: stdin JSON (task_id, output_hash, ...) → run demo_llm_run → stdout JSON
 * (proof, public_inputs, nullifier, proving_time_ms).
 * Used by wrapper-template.cjs via ZKGPT_PROVER_CMD="node adapter.cjs".
 * Binary path: ZKGPT_DEMO_BINARY (default /app/demo_llm_run).
 * The upstream demo doesn't output proof bytes; we return stub proof + real proving time from stdout.
 */

const { spawn } = require('child_process');
const crypto = require('crypto');

const BINARY = process.env.ZKGPT_DEMO_BINARY || '/app/demo_llm_run';
const PROVER_TIMEOUT_MS = parseInt(process.env.ZKGPT_PROVER_TIMEOUT_MS || '300000', 10); // 5 min for full run
const MOCK_PROOF_SIZE = 101 * 1024;

// Ensure child gets LD_LIBRARY_PATH so demo_llm_run finds libmcl.so.1 (some runtimes don't inherit env)
const CHILD_ENV = { ...process.env, LD_LIBRARY_PATH: process.env.LD_LIBRARY_PATH || '/app/lib' };

function stubProofHex() {
  const buf = Buffer.alloc(MOCK_PROOF_SIZE);
  crypto.randomFillSync(buf);
  return '0x' + buf.toString('hex');
}

function nullifierFrom(body) {
  const seed = body.task_id || body.output_hash || crypto.randomBytes(32).toString('hex');
  return '0x' + crypto.createHash('sha256').update(seed).digest('hex');
}

function main() {
  let input = '';
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', (chunk) => { input += chunk; });
  process.stdin.on('end', () => {
    let body;
    try {
      body = JSON.parse(input.trim());
    } catch (e) {
      const err = { error: 'invalid_input', message: e.message };
      process.stdout.write(JSON.stringify(err) + '\n');
      process.exit(1);
    }

    const child = spawn(BINARY, [], {
      stdio: ['ignore', 'pipe', 'pipe'],
      shell: false,
      env: CHILD_ENV,
      cwd: '/app',
    });

    let stdout = '';
    let stderr = '';
    const timeout = setTimeout(() => {
      child.kill('SIGTERM');
      const err = { error: 'timeout', message: 'Prover timed out' };
      process.stdout.write(JSON.stringify(err) + '\n');
      process.exit(2);
    }, PROVER_TIMEOUT_MS);

    child.stdout.on('data', (chunk) => { stdout += chunk; });
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    child.on('error', (err) => {
      clearTimeout(timeout);
      process.stdout.write(JSON.stringify({ error: 'spawn', message: err.message }) + '\n');
      process.exit(3);
    });
    child.on('close', (code) => {
      clearTimeout(timeout);
      if (code !== 0) {
        const err = {
          error: 'prover_failed',
          exit_code: code,
          stderr: stderr.slice(-1000),
          ld_library_path: CHILD_ENV.LD_LIBRARY_PATH,
          binary: BINARY,
        };
        process.stdout.write(JSON.stringify(err) + '\n');
        process.exit(code || 1);
        return;
      }
      // Parse "time: 38.4003" from stdout for proving_time_ms (seconds → ms)
      let provingTimeMs = 0;
      const timeMatch = stdout.match(/time:\s*([\d.]+)/);
      if (timeMatch) provingTimeMs = Math.round(parseFloat(timeMatch[1]) * 1000);

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
      const proofHex = stubProofHex();
      const result = {
        proof: proofHex,
        proof_bytes: proofHex,
        public_inputs: publicInputs,
        publicInputs: publicInputs,
        nullifier: nullifierFrom(body),
        nullifier_hex: nullifierFrom(body).replace(/^0x/, ''),
        proving_time_ms: provingTimeMs,
        provingTimeMs: provingTimeMs,
      };
      process.stdout.write(JSON.stringify(result) + '\n');
      process.exit(0);
    });
  });
}

main();
