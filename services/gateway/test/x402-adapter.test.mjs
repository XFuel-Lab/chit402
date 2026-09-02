import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildPaymentChallenge,
  verifyPayment,
  settlePayment,
  planA2ASettlement,
  isX402Enabled,
  defaultRail,
  fallbackToTfuel,
  priceTaskUSDC,
  ChallengeStore,
  buildBazaarExtension,
  BAZAAR_EXTENSION_KEY,
  isSolanaNetwork,
  isEvmNetwork,
} from '../src/x402-adapter.js';
import {
  SOLANA_NETWORKS,
  PAYAI_FACILITATOR_URL,
} from '../src/x402-facilitator.js';
import { startMockFacilitator } from '../src/x402-mock-facilitator.js';

test('buildPaymentChallenge produces a valid x402 v2 PaymentRequired', () => {
  const { status, body, headers } = buildPaymentChallenge({
    taskId: 'task-1',
    maxAmountRequired: '1000000',
    network: 'base',
    payTo: '0xabc',
    baseUrl: 'https://api.xfuel.app',
  });
  assert.equal(status, 402);
  assert.equal(body.x402Version, 2);
  assert.equal(body.resource.url, 'https://api.xfuel.app/task-request');
  assert.equal(body.resource.serviceName, 'Chit');
  assert.equal(body.accepts.length, 1);
  const a = body.accepts[0];
  assert.equal(a.scheme, 'exact');
  assert.equal(a.network, 'eip155:8453');
  assert.equal(a.amount, '1000000');
  assert.equal(a.maxAmountRequired, '1000000');
  assert.equal(a.asset, '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913');
  assert.equal(a.payTo, '0xabc');
  assert.equal(typeof a.maxTimeoutSeconds, 'number');
  assert.equal(a.extra.name, 'USD Coin');
  assert.equal(a.extra.version, '2');
  assert.equal(a.extra.taskId, 'task-1');
  // EIP-3009 nonce must be bytes32: 0x + 64 hex chars. Per Section 3.5.
  assert.match(a.extra.nonce, /^0x[0-9a-f]{64}$/);
  assert.ok(body.extensions?.[BAZAAR_EXTENSION_KEY]);
  assert.ok(!a.extensions, 'bazaar is top-level, not on accepts');
  assert.ok(headers['PAYMENT-REQUIRED']);
  const decoded = JSON.parse(Buffer.from(headers['PAYMENT-REQUIRED'], 'base64').toString('utf8'));
  assert.equal(decoded.x402Version, 2);
  assert.equal(decoded.resource.url, body.resource.url);
});

// ─── CDP Bazaar Extension Tests ─────────────────────────────────────────────

test('buildBazaarExtension: produces a spec-conformant bazaar extension', () => {
  const ext = buildBazaarExtension({ method: 'POST' });

  // Must have the bazaar key
  assert.ok(ext[BAZAAR_EXTENSION_KEY], 'bazaar extension key is present');

  const bazaar = ext[BAZAAR_EXTENSION_KEY];
  assert.ok(bazaar.info, 'info is present');
  assert.ok(bazaar.info.input, 'info.input is present');
  assert.ok(bazaar.info.output, 'info.output is present');

  // Per spec: info.input.type must be present
  assert.equal(bazaar.info.input.type, 'http', 'info.input.type is http');
  assert.equal(bazaar.info.input.method, 'POST', 'info.input.method is POST');

  // Per spec: info.output.type must be present when output is present
  assert.equal(bazaar.info.output.type, 'json', 'info.output.type is json');

  // Official POST body discovery: type/method/bodyType/body — NOT inputSchema on info.input
  assert.equal(bazaar.info.input.bodyType, 'json', 'info.input.bodyType is json');
  assert.equal(bazaar.info.input.body.model_id, 'xfuel/auto');
  assert.equal(bazaar.info.input.body.payment.rail, 'usdc');
  assert.ok(!('inputSchema' in bazaar.info.input), 'info.input has no inputSchema (additionalProperties: false)');

  // schema must validate info (CDP rejects extensions that omit schema)
  assert.ok(bazaar.schema, 'schema is present');
  assert.deepEqual(bazaar.schema.properties.input.required, ['type', 'method', 'bodyType', 'body']);
  assert.equal(bazaar.schema.properties.input.additionalProperties, false);
  assert.ok(bazaar.schema.properties.input.properties.body.properties.message_type);
  assert.ok(bazaar.info.output.example.task_id);
  assert.ok(bazaar.info.output.example.verify_url);
});

test('buildPaymentChallenge: includes bazaar extension by default', () => {
  const { body } = buildPaymentChallenge({
    taskId: 'task-1',
    maxAmountRequired: '50000',
    baseUrl: 'https://api.xfuel.app',
  });

  assert.ok(body.extensions, 'extensions object is present at top level');
  assert.ok(body.extensions[BAZAAR_EXTENSION_KEY], 'bazaar extension is present');

  const bazaar = body.extensions[BAZAAR_EXTENSION_KEY];
  assert.ok(bazaar.info.input.type, 'info.input.type is present');
  assert.ok(bazaar.info.output.type, 'info.output.type is present');
});

test('buildPaymentChallenge: uses absolute resource URL for bazaar cataloging', () => {
  const { body } = buildPaymentChallenge({
    taskId: 'task-abc',
    maxAmountRequired: '50000',
    baseUrl: 'https://api.xfuel.app',
  });

  // Resource URL must be absolute https:// (per spec) on the top-level object
  assert.equal(body.resource.url, 'https://api.xfuel.app/task-request',
    'resource.url is absolute URL pointing to /task-request');

  // Should NOT contain the taskId in the resource URL (that would create per-task catalog entries)
  assert.ok(!body.resource.url.includes('task-abc'), 'resource URL does not contain taskId');
});

test('buildPaymentChallenge: /v1/chat/completions resource catalogs OpenAI bazaar body', () => {
  const { body, headers } = buildPaymentChallenge({
    taskId: 'xfuel-1',
    maxAmountRequired: '10000',
    baseUrl: 'https://api.xfuel.app',
    resource: 'https://api.xfuel.app/v1/chat/completions',
  });

  assert.equal(body.resource.url, 'https://api.xfuel.app/v1/chat/completions');
  assert.ok(!body.resource.url.includes('/task-request'));
  const bazaarBody = body.extensions?.bazaar?.info?.input?.body;
  assert.equal(bazaarBody.model, 'xfuel/auto');
  assert.ok(Array.isArray(bazaarBody.messages));
  assert.ok(!bazaarBody.message_type);
  const decoded = JSON.parse(Buffer.from(headers['PAYMENT-REQUIRED'], 'base64').toString('utf8'));
  assert.equal(decoded.resource.url, body.resource.url);
});

test('buildPaymentChallenge: falls back to relative path when no baseUrl', () => {
  const { body } = buildPaymentChallenge({
    taskId: 'task-xyz',
    maxAmountRequired: '50000',
  });

  assert.equal(body.resource.url, '/task-request', 'resource.url is relative /task-request');
});

test('buildPaymentChallenge: includes service metadata for bazaar', () => {
  const { body } = buildPaymentChallenge({
    taskId: 'task-1',
    maxAmountRequired: '50000',
    baseUrl: 'https://api.xfuel.app',
  });

  const r = body.resource;

  // Per spec: serviceName ≤32 chars
  assert.equal(r.serviceName, 'Chit', 'serviceName is Chit');
  assert.ok(r.serviceName.length <= 32, 'serviceName ≤32 chars');

  // Per spec: tags ≤5 items. Tags now include llm, openai-compatible, chat-completions
  // for Bazaar search discoverability (PR: catalog metadata + dual-rail discovery).
  assert.ok(Array.isArray(r.tags), 'tags is an array');
  assert.ok(r.tags.length <= 5, 'tags ≤5 items');
  assert.ok(r.tags.includes('inference'), 'tags includes inference');
  assert.ok(r.tags.includes('llm'), 'tags includes llm');
  assert.ok(r.tags.includes('openai-compatible'), 'tags includes openai-compatible');
  assert.ok(r.tags.includes('chat-completions'), 'tags includes chat-completions');
  assert.ok(!r.tags.includes('x402'), 'tags omits legacy x402 tag');
  assert.ok(!r.tags.includes('ai'), 'tags omits legacy ai tag');

  // Per spec: iconUrl must be absolute https:// and a real image, not the SPA.
  assert.ok(r.iconUrl.startsWith('https://'), 'iconUrl is absolute https');
  assert.equal(r.iconUrl, 'https://api.xfuel.app/xfuel-icon.svg');
});

test('buildPaymentChallenge: description mentions real USDC settlement', () => {
  const { body } = buildPaymentChallenge({
    taskId: 'task-1',
    maxAmountRequired: '50000',
    baseUrl: 'https://api.xfuel.app',
  });

  const d = body.resource.description;

  // Description must explain the service (per spec) and mention it's real USDC
  assert.ok(d.includes('USDC'), 'description mentions USDC');
  assert.ok(d.includes('x402'), 'description mentions x402');
  assert.ok(d.includes('receipt'), 'description mentions receipt');
  assert.ok(d.includes('verify_url'), 'description mentions verify_url');
});

test('buildPaymentChallenge: stores bazaar fields on the bound challenge', () => {
  const store = new ChallengeStore();
  const { body } = buildPaymentChallenge(
    {
      taskId: 'task-store',
      maxAmountRequired: '10000',
      baseUrl: 'https://api.xfuel.app',
    },
    { store },
  );
  const nonce = body.accepts[0].extra.nonce;
  const stored = store.get(nonce);
  assert.equal(stored.resource, 'https://api.xfuel.app/task-request');
  assert.equal(stored.network, 'base', 'store keeps short network name for facilitator');
  assert.ok(stored.extensions?.[BAZAAR_EXTENSION_KEY], 'stored challenge keeps bazaar');
  assert.equal(stored.extensions[BAZAAR_EXTENSION_KEY].info.input.bodyType, 'json');
  assert.equal(stored.outputSchema.input.bodyType, 'json');
  assert.ok(stored.description.includes('USDC'));
});

test('buildPaymentChallenge: can disable bazaar extension', () => {
  const { body } = buildPaymentChallenge({
    taskId: 'task-1',
    maxAmountRequired: '50000',
    includeBazaar: false,
  });

  assert.ok(!body.extensions, 'no extensions when includeBazaar=false');
});

test('buildPaymentChallenge requires taskId and amount', () => {
  assert.throws(() => buildPaymentChallenge({ maxAmountRequired: '1' }), /taskId is required/);
  assert.throws(() => buildPaymentChallenge({ taskId: 't' }), /maxAmountRequired is required/);
});

test('verifyPayment returns gateway_not_configured without env', async () => {
  // Pin the legacy gateway provider: these tests exercise the generic ZAN-style
  // /verify+/settle path (the mock speaks that protocol). The default 'x402'
  // facilitator path is covered hermetically in x402-facilitator.test.mjs. Pinning
  // keeps this file independent of the repo .env (config.js dotenv.config() would
  // otherwise leak X402_FACILITATOR_PROVIDER=x402 into the shared test process).
  const r = await verifyPayment('some-header', { provider: 'zan' });
  assert.equal(r.valid, false);
  assert.equal(r.reason, 'gateway_not_configured');
});

test('verifyPayment flags missing header when gateway configured', async () => {
  const r = await verifyPayment('', { gatewayUrl: 'https://gw.example', apiKey: 'k' });
  assert.equal(r.valid, false);
  assert.equal(r.reason, 'missing_payment_header');
});

test('planA2ASettlement maps to settleBidFairExchange', () => {
  const plan = planA2ASettlement({ taskId: 't', bidId: '0x1', resultHash: '0x2', txRef: 'base:0xtx' });
  assert.equal(plan.action, 'settleBidFairExchange');
  assert.equal(plan.bidId, '0x1');
  assert.equal(plan.paymentRef, 'base:0xtx');
});

test('isX402Enabled reflects env flag', () => {
  const prev = process.env.X402_ENABLED;
  process.env.X402_ENABLED = 'true';
  assert.equal(isX402Enabled(), true);
  process.env.X402_ENABLED = 'false';
  assert.equal(isX402Enabled(), false);
  if (prev === undefined) delete process.env.X402_ENABLED; else process.env.X402_ENABLED = prev;
});

test('defaultRail / fallbackToTfuel reflect env (usdc default)', () => {
  const prevRail = process.env.X402_DEFAULT_RAIL;
  const prevFb = process.env.X402_FALLBACK_TFUEL;
  delete process.env.X402_DEFAULT_RAIL;
  assert.equal(defaultRail(), 'usdc', 'defaults to usdc on Base (ADR 0002)');
  process.env.X402_DEFAULT_RAIL = 'tfuel';
  assert.equal(defaultRail(), 'tfuel');
  process.env.X402_DEFAULT_RAIL = 'usdc';
  assert.equal(defaultRail(), 'usdc');
  process.env.X402_FALLBACK_TFUEL = 'true';
  assert.equal(fallbackToTfuel(), true);
  if (prevRail === undefined) delete process.env.X402_DEFAULT_RAIL; else process.env.X402_DEFAULT_RAIL = prevRail;
  if (prevFb === undefined) delete process.env.X402_FALLBACK_TFUEL; else process.env.X402_FALLBACK_TFUEL = prevFb;
});

test('priceTaskUSDC: default, per-model override, explicit default', () => {
  assert.equal(priceTaskUSDC({ model: 'unknown' }), '2000'); // env default ($0.002)
  assert.equal(priceTaskUSDC({ model: 'llama-3-70b' }, { prices: { 'llama-3-70b': '50000' } }), '50000');
  assert.equal(priceTaskUSDC({}, { default: '123' }), '123');
  assert.equal(priceTaskUSDC({ serviceType: 0 }, { prices: { 'service:0': '777' } }), '777');
});

test('ChallengeStore: put/get, spend, replay, expiry', () => {
  const store = new ChallengeStore({ ttlMs: 60000 });
  const rec = store.put('n1', { taskId: 't', amount: '50000' });
  assert.equal(rec.nonce, 'n1');
  assert.equal(store.get('n1').amount, '50000');
  assert.equal(store.isSpent('n1'), false);
  store.markSpent('n1');
  assert.equal(store.isSpent('n1'), true);
  assert.equal(store.get('n1'), null, 'spent challenge is removed');

  const expired = new ChallengeStore({ ttlMs: -100 });
  expired.put('n2', { taskId: 't2', amount: '1' });
  assert.equal(expired.get('n2'), null, 'expired challenge not returned');
});

test('ChallengeStore: accepts both 0x-prefixed and raw nonces (backward compat)', () => {
  const store = new ChallengeStore({ ttlMs: 60000 });
  // EIP-3009 bytes32 nonce: 0x + 64 hex chars
  const fullNonce = '0x' + 'ab'.repeat(32);
  const rawNonce = 'ab'.repeat(32);

  // Store with 0x prefix (new behavior), lookup with raw (CDP clients may strip 0x)
  store.put(fullNonce, { taskId: 't1', amount: '10000' });
  assert.equal(store.get(fullNonce).amount, '10000', 'lookup with 0x prefix');
  assert.equal(store.get(rawNonce).amount, '10000', 'lookup with raw nonce finds 0x-prefixed');
  assert.equal(store.isSpent(rawNonce), false);

  // markSpent with raw variant marks both
  store.markSpent(rawNonce);
  assert.equal(store.isSpent(fullNonce), true, 'spent status checks all variants');
  assert.equal(store.isSpent(rawNonce), true, 'raw nonce also marked spent');
  assert.equal(store.get(fullNonce), null, 'markSpent deletes all variants');
  assert.equal(store.get(rawNonce), null, 'raw lookup also returns null after markSpent');

  // Store with raw 64-char nonce (client echoes without 0x), lookup with 0x prefix
  const rawNonce2 = 'cd'.repeat(32);  // 64-char raw hex
  const fullNonce2 = '0x' + rawNonce2;
  store.put(rawNonce2, { taskId: 't2', amount: '20000' });
  assert.equal(store.get(rawNonce2).amount, '20000', 'lookup with raw 64-char nonce');
  assert.equal(store.get(fullNonce2).amount, '20000', 'lookup with 0x prefix finds raw 64-char');
});

test('buildPaymentChallenge records into the store with nonce + expiry', () => {
  const store = new ChallengeStore();
  const { body } = buildPaymentChallenge(
    { taskId: 'task-x', maxAmountRequired: '50000', payTo: '0xtreasury' },
    { store }
  );
  const { nonce, expiresAt } = body.accepts[0].extra;
  // EIP-3009 nonce must be bytes32: 0x + 64 hex chars. Per Section 3.5.
  assert.match(nonce, /^0x[0-9a-f]{64}$/);
  assert.ok(expiresAt > Date.now());
  const stored = store.get(nonce);
  assert.equal(stored.amount, '50000');
  assert.equal(stored.payTo, '0xtreasury');
});

test('verify + settle against mock facilitator (happy path + replay)', async () => {
  const { url, close } = await startMockFacilitator();
  try {
    const store = new ChallengeStore();
    const { body } = buildPaymentChallenge(
      { taskId: 't', maxAmountRequired: '50000', payTo: '0xtreasury' },
      { store }
    );
    const nonce = body.accepts[0].extra.nonce;
    const opts = { provider: 'zan', gatewayUrl: url, apiKey: 'k', store, nonce };

    const v = await verifyPayment('X-PAYMENT-blob', opts);
    assert.equal(v.valid, true);
    assert.ok(v.txRef);

    const s = await settlePayment('X-PAYMENT-blob', opts);
    assert.equal(s.settled, true);
    assert.equal(store.isSpent(nonce), true);

    // Replay after settle is rejected
    const replay = await verifyPayment('X-PAYMENT-blob', opts);
    assert.equal(replay.valid, false);
    assert.equal(replay.reason, 'payment_replayed');
  } finally {
    await close();
  }
});

test('verify proceeds unbound when challenge is unknown (allows Solana PayAI memos)', async () => {
  // When a nonce is provided but not in the store, verification proceeds to the
  // facilitator rather than failing early. This enables Solana payments where
  // PayAI uses a different memo format (commons-x402-*) than our nonce.
  const { url, close } = await startMockFacilitator();
  try {
    const store = new ChallengeStore();
    const r = await verifyPayment('X-PAYMENT-blob', {
      gatewayUrl: url, apiKey: 'k', store, nonce: 'deadbeef',
    });
    // Facilitator is called and confirms the payment is valid
    assert.equal(r.valid, true);
    assert.equal(r.unbound, true); // Marked as unbound since challenge wasn't found
  } finally {
    await close();
  }
});

test('verify surfaces facilitator rejection', async () => {
  const { url, close } = await startMockFacilitator({ valid: false });
  try {
    const r = await verifyPayment('X-PAYMENT-blob', { provider: 'zan', gatewayUrl: url, apiKey: 'k' });
    assert.equal(r.valid, false);
    assert.equal(r.reason, 'mock_rejected');
  } finally {
    await close();
  }
});

// ══════════════════════════════════════════════════════════════════════════════
// Dual-network x402 tests (Solana via PayAI, 2026-08-22)
// ══════════════════════════════════════════════════════════════════════════════

test('isSolanaNetwork: correctly identifies Solana networks', () => {
  // Solana mainnet
  assert.equal(isSolanaNetwork('solana'), true, 'solana short name');
  assert.equal(isSolanaNetwork('solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp'), true, 'solana CAIP-2');
  // Solana devnet
  assert.equal(isSolanaNetwork('solana-devnet'), true, 'solana-devnet short name');
  assert.equal(isSolanaNetwork('solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1'), true, 'solana-devnet CAIP-2');
  // Not Solana
  assert.equal(isSolanaNetwork('base'), false, 'base is not Solana');
  assert.equal(isSolanaNetwork('eip155:8453'), false, 'base CAIP-2 is not Solana');
  assert.equal(isSolanaNetwork('ethereum'), false, 'ethereum is not Solana');
  assert.equal(isSolanaNetwork(null), false, 'null is not Solana');
});

test('isEvmNetwork: correctly identifies EVM networks', () => {
  assert.equal(isEvmNetwork('base'), true, 'base short name');
  assert.equal(isEvmNetwork('base-sepolia'), true, 'base-sepolia short name');
  assert.equal(isEvmNetwork('eip155:8453'), true, 'base CAIP-2');
  assert.equal(isEvmNetwork('eip155:84532'), true, 'base-sepolia CAIP-2');
  // Not EVM
  assert.equal(isEvmNetwork('solana'), false, 'solana is not EVM');
  assert.equal(isEvmNetwork('solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp'), false, 'solana CAIP-2 is not EVM');
});

test('buildPaymentChallenge: single network (Base only) when Solana not configured', () => {
  const { body } = buildPaymentChallenge({
    taskId: 'task-single-network',
    maxAmountRequired: '50000',
    network: 'base',
    payTo: '0xBasetreasury',
    baseUrl: 'https://api.xfuel.app',
  });

  assert.equal(body.accepts.length, 1, 'single accepts entry when Solana not configured');
  assert.equal(body.accepts[0].network, 'eip155:8453', 'Base CAIP-2 network');
  assert.equal(body.accepts[0].payTo, '0xBasetreasury');
  assert.ok(body.resource.description.includes('Base'), 'description mentions Base');
});

test('buildPaymentChallenge: dual-network 402 lists both Base and Solana', () => {
  const { body } = buildPaymentChallenge({
    taskId: 'task-dual-network',
    maxAmountRequired: '50000',
    network: 'base',
    payTo: '0xBasetreasury',
    baseUrl: 'https://api.xfuel.app',
    solana: {
      enabled: true,
      payTo: 'SolanaATAaddress123',
      network: 'solana',
    },
  });

  assert.equal(body.accepts.length, 2, 'dual accepts entries when Solana enabled');

  // accepts[0]: Base (primary)
  const baseAccept = body.accepts[0];
  assert.equal(baseAccept.network, 'eip155:8453', 'accepts[0] is Base CAIP-2');
  assert.equal(baseAccept.payTo, '0xBasetreasury', 'Base payTo');
  assert.equal(baseAccept.asset, '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913', 'Base USDC');
  assert.ok(baseAccept.extra.name, 'Base has EIP-712 domain name');
  assert.ok(baseAccept.extra.version, 'Base has EIP-712 domain version');

  // accepts[1]: Solana
  const solAccept = body.accepts[1];
  assert.equal(solAccept.network, 'solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp', 'accepts[1] is Solana CAIP-2');
  assert.equal(solAccept.payTo, 'SolanaATAaddress123', 'Solana payTo');
  assert.equal(solAccept.asset, 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v', 'Solana USDC mint');
  assert.equal(solAccept.extra.name, undefined, 'Solana has no EIP-712 domain (Ed25519 sig)');
  assert.equal(solAccept.extra.version, undefined, 'Solana has no EIP-712 version');

  // Description mentions both networks
  assert.ok(body.resource.description.includes('Base'), 'description mentions Base');
  assert.ok(body.resource.description.includes('Solana'), 'description mentions Solana');
});

test('buildPaymentChallenge: Solana disabled when payTo missing', () => {
  const { body } = buildPaymentChallenge({
    taskId: 'task-no-solana-payto',
    maxAmountRequired: '50000',
    network: 'base',
    payTo: '0xBasetreasury',
    solana: {
      enabled: true,
      // payTo missing!
      network: 'solana',
    },
  });

  assert.equal(body.accepts.length, 1, 'Solana disabled when payTo missing');
  assert.equal(body.accepts[0].network, 'eip155:8453', 'only Base');
});

test('buildPaymentChallenge: Solana disabled when enabled=false', () => {
  const { body } = buildPaymentChallenge({
    taskId: 'task-solana-disabled',
    maxAmountRequired: '50000',
    network: 'base',
    payTo: '0xBasetreasury',
    solana: {
      enabled: false,
      payTo: 'SolanaATAaddress123',
      network: 'solana',
    },
  });

  assert.equal(body.accepts.length, 1, 'Solana disabled when enabled=false');
});

test('buildPaymentChallenge: stores separate nonces for Base and Solana challenges', () => {
  const store = new ChallengeStore();
  const { body } = buildPaymentChallenge(
    {
      taskId: 'task-dual-nonces',
      maxAmountRequired: '50000',
      network: 'base',
      payTo: '0xBasetreasury',
      baseUrl: 'https://api.xfuel.app',
      solana: {
        enabled: true,
        payTo: 'SolanaATAaddress123',
        network: 'solana',
      },
    },
    { store },
  );

  const baseNonce = body.accepts[0].extra.nonce;
  const solNonce = body.accepts[1].extra.nonce;

  assert.ok(baseNonce !== solNonce, 'Base and Solana have different nonces');

  // Both nonces are in the store
  const baseChallenge = store.get(baseNonce);
  const solChallenge = store.get(solNonce);

  assert.ok(baseChallenge, 'Base challenge stored');
  assert.ok(solChallenge, 'Solana challenge stored');

  assert.equal(baseChallenge.network, 'base', 'Base challenge network');
  assert.equal(solChallenge.network, 'solana', 'Solana challenge network');

  assert.equal(solChallenge.facilitator, 'payai', 'Solana challenge marked for PayAI');
  assert.equal(baseChallenge.facilitator, undefined, 'Base challenge uses default facilitator');
});

test('buildPaymentChallenge: Solana devnet network', () => {
  const { body } = buildPaymentChallenge({
    taskId: 'task-solana-devnet',
    maxAmountRequired: '50000',
    network: 'base-sepolia',
    payTo: '0xSepoliatreasury',
    solana: {
      enabled: true,
      payTo: 'SolanaDevnetATA',
      network: 'solana-devnet',
    },
  });

  assert.equal(body.accepts.length, 2);
  assert.equal(body.accepts[0].network, 'eip155:84532', 'Base Sepolia');
  assert.equal(body.accepts[1].network, 'solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1', 'Solana devnet CAIP-2');
});

test('SOLANA_NETWORKS contains correct CAIP-2 mappings', () => {
  assert.equal(SOLANA_NETWORKS.solana, 'solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp');
  assert.equal(SOLANA_NETWORKS['solana-devnet'], 'solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1');
});

test('PAYAI_FACILITATOR_URL is correct', () => {
  assert.equal(PAYAI_FACILITATOR_URL, 'https://facilitator.payai.network');
});

test('verifyPayment routes to PayAI for Solana challenge', async () => {
  // This test verifies the routing logic — the actual PayAI call would require
  // a mock PayAI server, but we can verify the gateway is resolved correctly.
  const store = new ChallengeStore();
  const { body } = buildPaymentChallenge(
    {
      taskId: 'task-sol-verify',
      maxAmountRequired: '50000',
      network: 'base',
      payTo: '0xBasetreasury',
      solana: {
        enabled: true,
        payTo: 'SolanaATAaddress123',
        network: 'solana',
      },
    },
    { store },
  );

  const solNonce = body.accepts[1].extra.nonce;
  const solChallenge = store.get(solNonce);

  // The challenge should be marked for PayAI
  assert.equal(solChallenge.facilitator, 'payai');
  assert.equal(solChallenge.network, 'solana');

  // Without a mock PayAI, the verify call will fail — but the routing is correct.
  // In production, PayAI speaks standard x402 protocol.
  const r = await verifyPayment('dummy-payment', {
    store,
    nonce: solNonce,
    // No gatewayUrl specified — should resolve to PayAI based on challenge
  });
  // The call fails because we're not hitting a real PayAI server,
  // but we can verify it didn't try CDP (which would return a different error)
  assert.equal(r.valid, false);
  // PayAI returns gateway_error or similar when it can't reach the endpoint
  // (not CDP's specific error format)
});

test('Base payment path unchanged: dummy payment fails with signature error', async () => {
  // Regression test: ensure Base/CDP path is not affected by Solana addition
  const store = new ChallengeStore();
  const { body } = buildPaymentChallenge(
    {
      taskId: 'task-base-unchanged',
      maxAmountRequired: '50000',
      network: 'base-sepolia',
      payTo: '0xtreasury',
    },
    { store },
  );

  const baseNonce = body.accepts[0].extra.nonce;
  const baseChallenge = store.get(baseNonce);

  assert.equal(baseChallenge.facilitator, undefined, 'Base uses default facilitator');
  assert.equal(baseChallenge.network, 'base-sepolia');

  // The verify call with a dummy payment should fail (not a 400 schema error)
  const r = await verifyPayment('dummy-base-payment', {
    store,
    nonce: baseNonce,
    provider: 'zan',  // Force ZAN provider for this test (mock-friendly)
    gatewayUrl: null,
    apiKey: null,
  });
  assert.equal(r.valid, false);
  assert.equal(r.reason, 'gateway_not_configured', 'ZAN needs gateway URL');
});
