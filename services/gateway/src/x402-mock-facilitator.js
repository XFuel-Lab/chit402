import http from 'node:http';
import { pathToFileURL } from 'node:url';

/**
 * Mock x402 facilitator for dev/CI.
 *
 * Emulates the ZAN x402 gateway's /verify and /settle endpoints so the full
 * USDC/x402 handshake (challenge → pay → verify → settle) can be exercised
 * end-to-end before a real ZAN gateway is provisioned. Mirrors the zkGPT
 * mock-server pattern used elsewhere in the repo.
 *
 * Contract (matches x402-adapter.js expectations):
 *   POST /verify  { payment, expected? } → 200 { valid:boolean, txRef?, reason? }
 *   POST /settle  { payment, nonce? }     → 200 { settled:boolean, txRef?, reason? }
 *
 * It ALSO speaks the STANDARD x402 facilitator protocol (used by the 'x402'
 * provider path in x402-facilitator.js) — detected when the request body carries
 * a `paymentPayload`:
 *   POST /verify  { paymentPayload, paymentRequirements } → 200 { isValid, invalidReason?, payer? }
 *   POST /settle  { paymentPayload, paymentRequirements } → 200 { success, transaction, network, payer? }
 *
 * Behavior is deterministic and configurable for negative tests:
 *   - valid:false           → verify/settle reject
 *   - requireApiKey:true    → 401 unless x-api-key header present
 *   - amountMustMatch:true  → reject verify if expected.amount is missing
 *
 * Usage (standalone):  node src/x402-mock-facilitator.js   (PORT=X402_MOCK_PORT|8402)
 * Usage (tests):       const { server, url } = await startMockFacilitator();
 */
export function createMockFacilitator(config = {}) {
  const {
    valid = true,
    txRef = '0xmockpaymenttxref0000000000000000000000000000000000000000000000',
    requireApiKey = false,
    amountMustMatch = false,
  } = config;

  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', () => {
      const url = req.url || '';
      const send = (status, obj) => {
        res.statusCode = status;
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify(obj));
      };

      if (req.method !== 'POST') return send(404, { error: 'not_found' });
      if (requireApiKey && !req.headers['x-api-key']) return send(401, { error: 'unauthorized' });

      let parsed = {};
      try { parsed = body ? JSON.parse(body) : {}; } catch { return send(400, { error: 'bad_json' }); }

      // Standard x402 protocol (payload-bearing body) → x402-shaped responses.
      const isStandardX402 = !!parsed.paymentPayload;
      const payer = parsed.paymentPayload?.payload?.authorization?.from || '0xmockpayer';
      const network = parsed.paymentRequirements?.network || 'base-sepolia';

      if (url.endsWith('/verify')) {
        if (isStandardX402) {
          return send(200, valid
            ? { isValid: true, payer }
            : { isValid: false, invalidReason: 'mock_rejected' });
        }
        if (amountMustMatch && !(parsed.expected && parsed.expected.amount)) {
          return send(200, { valid: false, reason: 'amount_mismatch' });
        }
        return send(200, valid
          ? { valid: true, txRef }
          : { valid: false, reason: 'mock_rejected' });
      }

      if (url.endsWith('/settle')) {
        if (isStandardX402) {
          return send(200, valid
            ? { success: true, transaction: txRef, network, payer }
            : { success: false, errorReason: 'mock_settle_rejected' });
        }
        return send(200, valid
          ? { settled: true, txRef }
          : { settled: false, reason: 'mock_settle_rejected' });
      }

      return send(404, { error: 'not_found' });
    });
  });

  return server;
}

/**
 * Start the mock facilitator on an ephemeral port. Returns { server, url, close }.
 * @param {Object} [config] see createMockFacilitator
 * @returns {Promise<{ server: import('node:http').Server, url: string, close: () => Promise<void> }>}
 */
export function startMockFacilitator(config = {}) {
  const server = createMockFacilitator(config);
  return new Promise((resolve) => {
    server.listen(config.port || 0, '127.0.0.1', () => {
      const { port } = server.address();
      resolve({
        server,
        url: `http://127.0.0.1:${port}`,
        close: () => new Promise((r) => server.close(r)),
      });
    });
  });
}

// Standalone runner (cross-platform entry check — file:// URL compare fails on Windows)
if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const port = parseInt(process.env.X402_MOCK_PORT, 10) || 8402;
  const server = createMockFacilitator({
    valid: process.env.X402_MOCK_VALID !== 'false',
    requireApiKey: process.env.X402_MOCK_REQUIRE_KEY === 'true',
  });
  server.listen(port, () => {
    console.log(`[x402-mock] facilitator listening on http://127.0.0.1:${port} (POST /verify, /settle)`);
  });
}
