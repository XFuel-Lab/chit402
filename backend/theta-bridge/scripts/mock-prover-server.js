#!/usr/bin/env node
/**
 * Mock SP1 Prover Server  — SIMULATED, NOT A REAL PROVER.
 *
 * Speaks the exact HTTP wire contract that benchmark-prover.js and
 * sp1-prover-client.js expect (`/healthz`, `/health`, `/metrics`,
 * `/prove`, `/prove/binary`) so the full benchmark A/B pipeline can be
 * validated end-to-end WITHOUT a GPU, the SP1 toolchain, or a provisioned
 * ZAN/EdgeCloud prover.
 *
 * It injects a configurable `proving_time_ms` (base ± jitter, with simple
 * batch amortization) and optionally sleeps that long so round-trip timings
 * are realistic. The emitted GPU times are SIMULATED — use this only to
 * validate the harness and to dry-run the exact commands you will later run
 * against a real prover (Theta EdgeCloud CUDA baseline vs a ZAN PowerZebra
 * candidate). See docs/BENCHMARK_POWERZEBRA.md.
 *
 * Usage:
 *   node scripts/mock-prover-server.js [--port 8091] [--prove-ms 520] [--jitter 40] [--no-sleep]
 *   node scripts/mock-prover-server.js --require-key --api-key testkey   # emulate a gated ZAN endpoint
 * Env equivalents: MOCK_PORT, MOCK_PROVE_MS, MOCK_JITTER_MS, MOCK_SLEEP=false,
 *                  MOCK_REQUIRE_KEY=true, MOCK_API_KEY, MOCK_API_KEY_HEADER
 */
import http from 'node:http';

function arg(name, dflt) {
  const i = process.argv.indexOf(`--${name}`);
  return i !== -1 && process.argv[i + 1] && !process.argv[i + 1].startsWith('--')
    ? process.argv[i + 1]
    : dflt;
}
const PORT = parseInt(arg('port', process.env.MOCK_PORT || '8091'));
const PROVE_MS = parseInt(arg('prove-ms', process.env.MOCK_PROVE_MS || '520'));
const JITTER_MS = parseInt(arg('jitter', process.env.MOCK_JITTER_MS || '40'));
const SLEEP = !process.argv.includes('--no-sleep') && process.env.MOCK_SLEEP !== 'false';
const SLEEP_CAP_MS = parseInt(process.env.MOCK_SLEEP_CAP_MS || '2000');
// Optional API-key gating — emulate a ZAN-style authenticated endpoint.
const REQUIRE_KEY = process.argv.includes('--require-key') || process.env.MOCK_REQUIRE_KEY === 'true';
const API_KEY = arg('api-key', process.env.MOCK_API_KEY || 'dev-key');
const API_KEY_HEADER = arg('api-key-header', process.env.MOCK_API_KEY_HEADER || 'x-api-key').toLowerCase();

const started = Date.now();
let proofsServed = 0;
let binaryProofs = 0;
let jsonProofs = 0;
const times = [];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Simulated GPU proving time for a batch of `n` (base + amortized extra + jitter). */
function simProvingTime(n) {
  const extraPerDeposit = PROVE_MS * 0.12; // batch amortization: extra deposits are cheaper
  const base = PROVE_MS + Math.max(0, n - 1) * extraPerDeposit;
  const jitter = (Math.random() * 2 - 1) * JITTER_MS;
  return Math.max(1, Math.round(base + jitter));
}

function readBody(req) {
  return new Promise((resolve) => {
    let b = '';
    req.on('data', (c) => (b += c));
    req.on('end', () => resolve(b));
  });
}

/** bincode-compatible encoder matching sp1-prover-client._decodeBinaryResponse field order. */
function encodeBinary({ proof, publicValues, isBatch, batchSize, provingTimeMs, nullifiers, batchCommitment }) {
  const u64 = (n) => { const b = Buffer.alloc(8); b.writeBigUInt64LE(BigInt(n)); return b; };
  const u32 = (n) => { const b = Buffer.alloc(4); b.writeUInt32LE(n >>> 0); return b; };
  const chunks = [
    u64(proof.length), proof,
    u64(publicValues.length), publicValues,
    Buffer.from([isBatch ? 1 : 0]),
    u32(batchSize),
    u64(provingTimeMs),
    u64(nullifiers.length),
  ];
  for (const n of nullifiers) chunks.push(u64(n.length), n);
  chunks.push(u64(batchCommitment.length), batchCommitment);
  return Buffer.concat(chunks);
}

function parseBatchSize(payload) {
  try {
    const j = JSON.parse(payload);
    if (Array.isArray(j?.deposits)) return Math.max(1, j.deposits.length);
    return 1;
  } catch { return 1; }
}

const server = http.createServer(async (req, res) => {
  const url = req.url || '/';

  // Gated-endpoint emulation: reject any request missing the correct API key.
  if (REQUIRE_KEY && req.headers[API_KEY_HEADER] !== API_KEY) {
    res.writeHead(401, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'unauthorized', mock: true, header: API_KEY_HEADER }));
    return;
  }

  if (req.method === 'GET' && (url === '/healthz' || url === '/health')) {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ status: 'ok', mock: true, uptime_seconds: Math.floor((Date.now() - started) / 1000), proofs_served: proofsServed }));
    return;
  }

  if (req.method === 'GET' && url === '/metrics') {
    const avg = times.length ? Math.round(times.reduce((a, b) => a + b, 0) / times.length) : 0;
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      mock: true,
      proofs_served_total: proofsServed,
      binary_proofs: binaryProofs,
      json_proofs: jsonProofs,
      avg_prove_time_ms: avg,
      last_prove_time_ms: times[times.length - 1] || 0,
      errors_total: 0,
      current_queue_depth: 0,
      uptime_seconds: Math.floor((Date.now() - started) / 1000),
      gpu: { utilization_pct: 0, memory_used_mb: 0, memory_total_mb: 0, temperature_c: 0, note: 'SIMULATED' },
    }));
    return;
  }

  if (req.method === 'POST' && (url === '/prove' || url === '/prove/binary')) {
    const body = await readBody(req);
    const batchSize = parseBatchSize(body);
    const provingTimeMs = simProvingTime(batchSize);
    if (SLEEP) await sleep(Math.min(provingTimeMs, SLEEP_CAP_MS));
    proofsServed++;
    times.push(provingTimeMs);
    if (times.length > 500) times.shift();

    const proof = Buffer.alloc(260, 7);          // ~260-byte Groth16-ish blob
    const publicValues = Buffer.alloc(320, 3);
    const nullifiers = Array.from({ length: batchSize }, (_, i) => Buffer.alloc(32, i + 1));
    const batchCommitment = Buffer.alloc(32, 9);

    if (url === '/prove/binary') {
      binaryProofs++;
      const buf = encodeBinary({ proof, publicValues, isBatch: batchSize > 1, batchSize, provingTimeMs, nullifiers, batchCommitment });
      res.writeHead(200, { 'Content-Type': 'application/octet-stream' });
      res.end(buf);
    } else {
      jsonProofs++;
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        proof: proof.toString('base64'),
        public_inputs: { mock: true },
        nullifier: '0x' + nullifiers[0].toString('hex'),
        batch_size: batchSize,
        proving_time_ms: provingTimeMs,
      }));
    }
    return;
  }

  res.writeHead(404, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ error: 'not_found', path: url }));
});

server.listen(PORT, () => {
  console.log(`[mock-prover] SIMULATED prover on http://127.0.0.1:${PORT}  prove_ms=${PROVE_MS}±${JITTER_MS}  sleep=${SLEEP}`);
  console.log(`[mock-prover] auth: ${REQUIRE_KEY ? `REQUIRED (${API_KEY_HEADER})` : 'none'}`);
  console.log('[mock-prover] WARNING: emitted GPU times are SIMULATED — not real proving measurements.');
});
