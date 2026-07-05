import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import SP1ProverClient from '../src/sp1-prover-client.js';

/**
 * Spin up a tiny gated prover that requires an API key header, emulating a ZAN
 * PowerZebra endpoint. Serves the JSON /prove contract the client expects.
 */
function startGatedProver({ apiKey = 'secret', header = 'x-api-key' } = {}) {
  let calls = 0;
  let lastAuth = null;
  const server = http.createServer((req, res) => {
    calls += 1;
    lastAuth = req.headers[header] ?? null;
    if (req.headers[header] !== apiKey) {
      res.writeHead(401, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'unauthorized' }));
      return;
    }
    if (req.method === 'GET' && (req.url === '/health' || req.url === '/healthz')) {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ status: 'ok' }));
      return;
    }
    if (req.method === 'POST' && req.url === '/prove') {
      req.on('data', () => {});
      req.on('end', () => {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          proof: 'MOCK_PROOF',
          public_inputs: { ok: true },
          nullifier: '0x' + 'ab'.repeat(32),
          proving_time_ms: 42,
          batch_size: 1,
        }));
      });
      return;
    }
    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'not_found' }));
  });
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      resolve({
        url: `http://127.0.0.1:${port}`,
        stats: () => ({ calls, lastAuth }),
        close: () => new Promise((r) => server.close(r)),
      });
    });
  });
}

const REQUEST = { vault_address: '0xabc', net_amount: '1000', block_number: 1 };

function baseEnv(url, key) {
  process.env.SP1_PROVER = 'zan';
  process.env.ZAN_PROVER_URL = url;
  process.env.ZAN_PROVER_API_KEY = key;
  delete process.env.SP1_PROVER_URL;   // no CUDA fallback for this test
  delete process.env.SP1_FALLBACK_URL;
  process.env.SP1_BATCHING_ENABLED = 'false';
  process.env.SP1_PROVER_RETRIES = '1';
}

test('SP1_PROVER=zan sends the API key and receives a proof', async () => {
  const gw = await startGatedProver({ apiKey: 'secret' });
  baseEnv(gw.url, 'secret');

  const client = new SP1ProverClient();
  client._binarySupported = false; // force the JSON /prove path (simpler wire)
  assert.equal(client.proverMode, 'zan');
  assert.equal(client.primaryUrl, gw.url);

  const res = await client.generateProof(REQUEST, true);
  assert.equal(res.success, true);
  assert.equal(res.nullifier, '0x' + 'ab'.repeat(32));

  const { lastAuth } = gw.stats();
  assert.equal(lastAuth, 'secret', 'client must forward the ZAN API key');

  client._keepAliveAgent.destroy();
  client._keepAliveHttpsAgent.destroy();
  await gw.close();
});

test('SP1_PROVER=zan with a wrong API key is rejected (401, no fallback)', async () => {
  const gw = await startGatedProver({ apiKey: 'secret' });
  baseEnv(gw.url, 'WRONG-KEY');

  const client = new SP1ProverClient();
  client._binarySupported = false;

  await assert.rejects(
    () => client.generateProof(REQUEST, true),
    /SP1 proof generation failed/,
  );

  client._keepAliveAgent.destroy();
  client._keepAliveHttpsAgent.destroy();
  await gw.close();
});
