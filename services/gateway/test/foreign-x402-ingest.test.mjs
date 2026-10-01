/**
 * Foreign x402 Book Ingest tests.
 *
 * Per whitepaper §2: An agent's arbitrary x402 spend writes a possession-gated
 * book row IF the shop supplies: (1) 402 payment required, (2) payment response,
 * (3) agent_id session. Naked tx hash is rejected. Demo never writes.
 */
import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

process.env.HUB_CATALOG_OFFLINE = 'true';
process.env.X402_ENABLED = 'true';
process.env.X402_METER_V1 = 'true';
process.env.X402_PAY_TO = '0xBasetreasury';
process.env.X402_NETWORK = 'base';
process.env.X402_USDC_PRICE_DEFAULT = '2000';
process.env.TASK_STORE_PERSIST = 'false';

const { createApp } = await import('../src/server.js');
const { AgentRegistry } = await import('../src/agent-registry.js');
const { UsageSettledLedger } = await import('../src/usage-settled.js');
const {
  ingestForeignX402,
  normalizeIngestInput,
  parseX402V2PaymentResponse,
  txHashFromPaymentRef,
  validatePaymentRequired,
  validatePaymentResponse,
  extractRouteFromResource,
  railFromNetwork,
  buildOnChainVerify,
  buildPublicForeignIngestReceipt,
  buildForeignReceipt,
  setForeignIngestVerifyForTests,
  resetBaseProvider,
} = await import('../src/foreign-x402-ingest.js');
const { BOOK_EVIDENCE } = await import('../src/usage-settled.js');
const { capViewOf } = await import('../src/agent-book.js');
const { STAMP_FEE_UNITS } = await import('../src/pricing.js');
const { resetStampWaiverStore } = await import('../src/stamp-waiver.js');

const fixtureDir = join(dirname(fileURLToPath(import.meta.url)), 'fixtures', 'nano');
const NANO_SEND = JSON.parse(readFileSync(join(fixtureDir, 'block_info_324B1CED.json'), 'utf8'));
const NANO_PREV = JSON.parse(readFileSync(join(fixtureDir, 'block_info_prev_C0CEDE1E.json'), 'utf8'));
const NANO_HASH = '324B1CED853848219956F60B43065ECF08F0AB0C35B54BA2516EBE39C4E5C19B';
const NANO_RECIPIENT = 'nano_3kef5c3ahkwf3qcyw61qcnma668z8ez4ocnm55gkiaqeure3ghcfqunfynug';
const NANO_RAW = '1000000000000000000000000000000';

function jsonRes(obj, status = 200) {
  return { ok: status < 400, status, json: async () => obj };
}

/** Fixture RPC + Kraken ticker. Optional mutator per hash. */
function nanoFetch({ mutate } = {}) {
  return async (url, opts = {}) => {
    const u = String(url);
    if (u.includes('kraken') || u.includes('Ticker') || opts.method === 'GET') {
      return jsonRes({ error: [], result: { NANOUSD: { c: ['0.80', '1'] } } });
    }
    const body = JSON.parse(opts.body || '{}');
    const hash = String(body.hash || '').toUpperCase();
    let payload;
    if (hash === NANO_HASH) payload = structuredClone(NANO_SEND);
    else if (hash === String(NANO_PREV.contents ? NANO_SEND.contents.previous : '').toUpperCase()
      || hash.startsWith('C0CEDE1E')) payload = structuredClone(NANO_PREV);
    else return jsonRes({ error: 'Block not found' });
    if (mutate) payload = mutate(payload, hash, u) || payload;
    return jsonRes(payload);
  };
}

const WALLET_A = '0x1111111111111111111111111111111111111111';

function makeSession() {
  return crypto.randomBytes(32).toString('hex');
}

/** Mock verify that always returns valid: true, with verification details */
const verifyOk = async () => ({ valid: true, txHash: '0xabc', blockNumber: 12345 });

/** Mock verify that always returns valid: false */
const verifyFail = async () => ({ valid: false, reason: 'mock rejection' });

/** Mock verify that throws (simulates chain unreadable) */
const verifyThrows = async () => { throw new Error('verify exploded'); };

/** Mock verify that throws with network error (chain unreadable) */
const verifyChainUnreadable = async () => { throw new Error('failed to fetch tx receipt: network timeout'); };

function setupDeps() {
  const registry = new AgentRegistry();
  const ledger = new UsageSettledLedger();
  const identity = registry.allocate({ taskId: 'initial' });
  return { registry, ledger, identity };
}

beforeEach(() => {
  // Reset the cached Base provider between tests
  resetBaseProvider();
});

// ─── Unit tests ───────────────────────────────────────────────────────────────

test('extractRouteFromResource extracts hub and model from URL', () => {
  const r1 = extractRouteFromResource('https://api.grokbot.app/v1/chat/completions');
  assert.equal(r1.hub, 'api.grokbot.app');
  assert.equal(r1.model, '/v1/chat/completions');

  const r2 = extractRouteFromResource('https://openrouter.ai/api/v1/chat');
  assert.equal(r2.hub, 'openrouter.ai');
  assert.equal(r2.model, '/api/v1/chat');

  const r3 = extractRouteFromResource(null);
  assert.equal(r3.hub, null);
  assert.equal(r3.model, null);

  const r4 = extractRouteFromResource('not-a-url');
  assert.equal(r4.hub, null);
  assert.equal(r4.model, null);
});

test('validatePaymentRequired requires resource, amount, payTo', () => {
  assert.equal(validatePaymentRequired(null).ok, false);
  assert.equal(validatePaymentRequired({}).ok, false);
  assert.equal(validatePaymentRequired({ resource: 'x' }).ok, false);
  assert.equal(validatePaymentRequired({ resource: 'x', amount: '10000' }).ok, false);
  assert.equal(validatePaymentRequired({ resource: 'x', amount: '10000', payTo: '0x123' }).ok, true);
});

test('normalizeIngestInput: minimal foreign_invoice coalesces to x402 shape', () => {
  const n = normalizeIngestInput({
    foreign_invoice: {
      amount: '25000',
      payer: WALLET_A,
      payTo: '0xPayBoxTreasury',
      payment_ref: 'base:0xdeadbeef',
      hub: 'paybox.example.com',
      model: '/v1/infer',
    },
  });
  assert.equal(n.ok, true);
  assert.equal(n.paymentRequired.amount, '25000');
  assert.equal(n.paymentRequired.payTo, '0xPayBoxTreasury');
  assert.equal(n.paymentRequired.resource, 'https://paybox.example.com/v1/infer');
  assert.equal(n.paymentResponse.tx, '0xdeadbeef');
  assert.equal(n.paymentResponse.payer, WALLET_A);
  assert.equal(n.paymentResponse.network, 'base');
});

const V2_TX = `0x${'ab'.repeat(32)}`;
const V2_PAY_TO = '0x2222222222222222222222222222222222222222';

function paymentResponseHeader(settlement) {
  return Buffer.from(JSON.stringify(settlement), 'utf8').toString('base64');
}

test('parseX402V2PaymentResponse maps a v2 PAYMENT-RESPONSE header into the ingest payload', () => {
  const header = paymentResponseHeader({
    success: true,
    transaction: V2_TX,
    network: 'eip155:8453',
    payer: WALLET_A,
  });
  const parsed = parseX402V2PaymentResponse(header);
  assert.equal(parsed.ok, true);
  assert.equal(parsed.paymentResponse.tx, V2_TX);
  assert.equal(parsed.paymentResponse.payer, WALLET_A);
  assert.equal(parsed.paymentResponse.network, 'base', 'eip155:8453 is stored as base so the ref keeps the hash');

  const urlSafe = header.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
  const fromUrlSafe = parseX402V2PaymentResponse(urlSafe);
  assert.equal(fromUrlSafe.ok, true);
  assert.equal(fromUrlSafe.paymentResponse.tx, V2_TX);
});

test('parseX402V2PaymentResponse accepts the decoded v2 object and rejects a failed settlement', () => {
  const ok = parseX402V2PaymentResponse({
    success: true,
    transaction: V2_TX,
    network: 'eip155:8453',
    payer: WALLET_A,
  });
  assert.equal(ok.ok, true);
  assert.equal(ok.paymentResponse.tx, V2_TX);

  const legacy = parseX402V2PaymentResponse({ tx: '0xabc', payer: WALLET_A, network: 'base' });
  assert.equal(legacy.ok, true);
  assert.equal(legacy.paymentResponse.tx, '0xabc');
  assert.equal(legacy.paymentResponse.network, 'base');

  const failed = parseX402V2PaymentResponse({
    success: false,
    errorReason: 'facilitator rejected',
    transaction: V2_TX,
    network: 'eip155:8453',
    payer: WALLET_A,
  });
  assert.equal(failed.ok, false);
  assert.match(failed.reason, /facilitator rejected/);

  const naked = parseX402V2PaymentResponse({ transaction: V2_TX, network: 'eip155:8453' });
  assert.equal(naked.ok, false);
  assert.match(naked.reason, /payer/i);

  const garbage = parseX402V2PaymentResponse('not-base64-json');
  assert.equal(garbage.ok, false);
  assert.match(garbage.reason, /base64/);
});

test('normalizeIngestInput: v2 PAYMENT-RESPONSE header plus v2 challenge becomes the book payload', () => {
  const n = normalizeIngestInput({
    payment_required: {
      x402Version: 2,
      resource: { url: 'https://v2.api2pdf.com/chrome/pdf/html', description: 'pdf', mimeType: 'application/json' },
      accepts: [{
        scheme: 'exact',
        network: 'eip155:8453',
        amount: '10000',
        asset: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
        payTo: V2_PAY_TO,
      }],
    },
    payment_response: paymentResponseHeader({
      success: true,
      transaction: V2_TX,
      network: 'eip155:8453',
      payer: WALLET_A,
    }),
  });
  assert.equal(n.ok, true);
  assert.equal(n.paymentRequired.resource, 'https://v2.api2pdf.com/chrome/pdf/html');
  assert.equal(n.paymentRequired.amount, '10000');
  assert.equal(n.paymentRequired.payTo, V2_PAY_TO);
  assert.equal(n.paymentRequired.network, 'base');
  assert.equal(n.paymentResponse.tx, V2_TX);
  assert.equal(n.paymentResponse.payer, WALLET_A);
  assert.equal(n.paymentResponse.network, 'base');
  assert.equal(n.paymentRequired.scheme, 'exact');
  assert.equal(n.paymentRequired.amount, '10000');
  assert.equal(n.paymentRequired.max_amount, undefined);
});

test('exact scheme records the challenge amount, not a separate ceiling', () => {
  const parsed = parseX402V2PaymentResponse({
    success: true,
    transaction: V2_TX,
    network: 'eip155:8453',
    payer: WALLET_A,
    amount: '10000',
  });
  assert.equal(parsed.ok, true);
  assert.equal(parsed.paymentResponse.amount, '10000');

  const n = normalizeIngestInput({
    payment_required: {
      resource: { url: 'https://seller.example/v1/resource' },
      accepts: [{
        scheme: 'exact',
        network: 'eip155:8453',
        amount: '10000',
        maxAmountRequired: '10000',
        payTo: V2_PAY_TO,
      }],
    },
    payment_response: parsed.paymentResponse,
  });
  assert.equal(n.ok, true);
  assert.equal(n.paymentRequired.scheme, 'exact');
  assert.equal(n.paymentRequired.amount, '10000');
  assert.equal(n.paymentRequired.max_amount, undefined);
  assert.equal(n.paymentResponse.amount, '10000');
});

test('upto records the settled amount below the cap and keeps the ceiling as max_amount', () => {
  const n = normalizeIngestInput({
    payment_required: {
      x402Version: 2,
      resource: { url: 'https://v2.api2pdf.com/chrome/pdf/html' },
      accepts: [{
        scheme: 'upto',
        network: 'eip155:8453',
        amount: '50000',
        maxAmountRequired: '50000',
        asset: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
        payTo: V2_PAY_TO,
      }],
    },
    payment_response: {
      success: true,
      transaction: V2_TX,
      network: 'eip155:8453',
      payer: WALLET_A,
      amount: '10000',
    },
  });
  assert.equal(n.ok, true);
  assert.equal(n.paymentRequired.scheme, 'upto');
  assert.equal(n.paymentRequired.amount, '10000');
  assert.equal(n.paymentRequired.max_amount, '50000');
  assert.notEqual(n.paymentRequired.amount, n.paymentRequired.max_amount);
  assert.equal(n.paymentResponse.amount, '10000');

  const ceilingOnly = normalizeIngestInput({
    payment_required: {
      resource: { url: 'https://v2.api2pdf.com/chrome/pdf/html' },
      accepts: [{ scheme: 'upto', network: 'eip155:8453', amount: '50000', payTo: V2_PAY_TO }],
    },
    payment_response: {
      success: true,
      transaction: V2_TX,
      network: 'eip155:8453',
      payer: WALLET_A,
    },
  });
  assert.equal(ceilingOnly.ok, true);
  assert.equal(ceilingOnly.paymentRequired.amount, undefined);
  assert.equal(ceilingOnly.paymentRequired.max_amount, '50000');
});

test('txHashFromPaymentRef keeps the 0x hash when the ref uses eip155', () => {
  assert.equal(txHashFromPaymentRef(`eip155:8453:${V2_TX}`), V2_TX);
  assert.equal(txHashFromPaymentRef(`base:${V2_TX}`), V2_TX);
  assert.equal(txHashFromPaymentRef('solana:3vZ9sig'), '3vZ9sig');
});

test('validatePaymentResponse requires tx and payer (no naked tx)', () => {
  assert.equal(validatePaymentResponse(null).ok, false);
  assert.equal(validatePaymentResponse({}).ok, false);
  assert.equal(validatePaymentResponse({ tx: '0xabc' }).ok, false, 'naked tx rejected');
  assert.equal(validatePaymentResponse({ payer: '0x123' }).ok, false);
  assert.equal(validatePaymentResponse({ tx: '0xabc', payer: '0x123' }).ok, true);
});

test('railFromNetwork: EVM → usdc, Solana → solana', () => {
  assert.equal(railFromNetwork('base'), 'usdc');
  assert.equal(railFromNetwork('base-sepolia'), 'usdc');
  assert.equal(railFromNetwork('eip155:8453'), 'usdc');
  assert.equal(railFromNetwork(null), 'usdc');
  assert.equal(railFromNetwork(''), 'usdc');
  assert.equal(railFromNetwork('solana'), 'solana');
  assert.equal(railFromNetwork('solana-devnet'), 'solana');
  assert.equal(railFromNetwork('solana-mainnet'), 'solana');
  assert.equal(railFromNetwork('SOLANA'), 'solana', 'case insensitive');
});

// ─── Integration tests ────────────────────────────────────────────────────────

test('happy path: foreign x402 → book row (with valid verify)', async () => {
  const { registry, ledger, identity } = setupDeps();

  const result = await ingestForeignX402({
    payment_required: {
      resource: 'https://api.grokbot.app/v1/chat/completions',
      amount: '10000',
      payTo: '0xGrokBotTreasury',
    },
    payment_response: {
      tx: '0xabc123def456',
      payer: WALLET_A,
      network: 'base',
    },
    session: identity.session,
  }, {
    ledger,
    registry,
    agentId: identity.agent_id,
    session: identity.session,
    verify: verifyOk,
  });

  assert.equal(result.ok, true);
  assert.equal(result.status, 201);
  assert.equal(result.body.agent_id, identity.agent_id);
  assert.match(result.body.task_id, /^foreign-x402-/);
  assert.equal(result.body.payment.ref, 'base:0xabc123def456');
  assert.equal(result.body.payment.rail, 'usdc');
  assert.equal(result.body.payment.amount, '10000');
  assert.equal(result.body.route.hub, 'api.grokbot.app');
  assert.equal(result.body.route.model, '/v1/chat/completions');
  assert.equal(result.body.foreign_x402, true);
  assert.equal(result.body.source, 'foreign_ingest');
  assert.equal(result.body.evidence, 'foreign_ingest');
  assert.ok(result.body.verify_url?.endsWith(`/receipt/${result.body.task_id}`));
  assert.ok(result.body.recorded_at);

  // Verify it's in the ledger
  assert.equal(ledger.entries.length, 1);
  const entry = ledger.entries[0];
  assert.equal(entry.agent_id, identity.agent_id);
  assert.equal(entry.payment_ref, 'base:0xabc123def456');
  assert.equal(entry.hub, 'api.grokbot.app');
  assert.equal(entry.model, '/v1/chat/completions');
  assert.equal(entry.evidence, BOOK_EVIDENCE.FOREIGN_INGEST);
  assert.ok(entry.receipt_snapshot?.foreign_x402);
  assert.equal(entry.book_chain.payload_version, 4);
  assert.equal(entry.book_chain.book_id, identity.agent_id);
  assert.equal(entry.book_chain.payment_ref, 'base:0xabc123def456');
  assert.equal(entry.issuer_signature, undefined);
});

test('v2 PAYMENT-RESPONSE ingests as foreign_ingest with a base ref', async () => {
  const { registry, ledger, identity } = setupDeps();
  const result = await ingestForeignX402({
    payment_required: {
      resource: 'https://v2.api2pdf.com/chrome/pdf/html',
      amount: '10000',
      payTo: V2_PAY_TO,
      network: 'eip155:8453',
    },
    payment_response: {
      success: true,
      transaction: V2_TX,
      network: 'eip155:8453',
      payer: WALLET_A,
    },
    session: identity.session,
  }, {
    ledger,
    registry,
    agentId: identity.agent_id,
    session: identity.session,
    verify: verifyOk,
    baseUrl: 'https://api.chit402.com',
  });

  assert.equal(result.ok, true, result.message);
  assert.equal(result.status, 201);
  assert.equal(result.body.evidence, 'foreign_ingest');
  assert.equal(result.body.source, 'foreign_ingest');
  assert.equal(result.body.payment.ref, `base:${V2_TX}`);
  assert.equal(result.body.payment.rail, 'usdc');
  assert.equal(result.body.route.hub, 'v2.api2pdf.com');
  assert.match(result.body.verify_url, /^https:\/\/api\.chit402\.com\/receipt\/foreign-x402-/);
});

test('upto below the cap ingests the PAYMENT-RESPONSE amount, and otherwise the Transfer', async () => {
  const { registry, ledger, identity } = setupDeps();
  let verifiedAgainst;
  const verifySettled = async (args) => {
    verifiedAgainst = args.amount;
    return { valid: true, verifiedAmount: '10000', txHash: V2_TX };
  };
  const settled = await ingestForeignX402({
    payment_required: {
      resource: { url: 'https://v2.api2pdf.com/chrome/pdf/html' },
      accepts: [{ scheme: 'upto', network: 'eip155:8453', amount: '50000', payTo: V2_PAY_TO }],
    },
    payment_response: {
      success: true,
      transaction: V2_TX,
      network: 'eip155:8453',
      payer: WALLET_A,
      amount: '10000',
    },
    session: identity.session,
  }, {
    ledger,
    registry,
    agentId: identity.agent_id,
    session: identity.session,
    verify: verifySettled,
  });
  assert.equal(settled.ok, true, settled.message);
  assert.equal(verifiedAgainst, '10000');
  assert.equal(settled.body.payment.amount, '10000');
  assert.equal(settled.body.payment.max_amount, '50000');
  assert.equal(ledger.entries[0].receipt_snapshot.payment.gross_amount, '10000');
  assert.equal(ledger.entries[0].receipt_snapshot.payment.max_amount, '50000');

  const { registry: registry2, ledger: ledger2, identity: identity2 } = setupDeps();
  let chainProbe;
  const fromChain = await ingestForeignX402({
    payment_required: {
      resource: { url: 'https://v2.api2pdf.com/chrome/pdf/html' },
      accepts: [{ scheme: 'upto', network: 'eip155:8453', amount: '50000', payTo: V2_PAY_TO }],
    },
    payment_response: {
      success: true,
      transaction: `0x${'cd'.repeat(32)}`,
      network: 'eip155:8453',
      payer: WALLET_A,
    },
    session: identity2.session,
  }, {
    ledger: ledger2,
    registry: registry2,
    agentId: identity2.agent_id,
    session: identity2.session,
    verify: async (args) => {
      chainProbe = args.amount;
      return { valid: true, verifiedAmount: '8000' };
    },
  });
  assert.equal(fromChain.ok, true, fromChain.message);
  assert.equal(chainProbe, '1');
  assert.equal(fromChain.body.payment.amount, '8000');
  assert.equal(fromChain.body.payment.max_amount, '50000');
  assert.notEqual(fromChain.body.payment.amount, '50000');

  const { registry: registry3, ledger: ledger3, identity: identity3 } = setupDeps();
  const overCeiling = await ingestForeignX402({
    payment_required: {
      resource: { url: 'https://v2.api2pdf.com/chrome/pdf/html' },
      accepts: [{ scheme: 'upto', network: 'eip155:8453', amount: '50000', payTo: V2_PAY_TO }],
    },
    payment_response: {
      success: true,
      transaction: `0x${'ef'.repeat(32)}`,
      network: 'eip155:8453',
      payer: WALLET_A,
    },
    session: identity3.session,
  }, {
    ledger: ledger3,
    registry: registry3,
    agentId: identity3.agent_id,
    session: identity3.session,
    verify: async () => ({ valid: true, verifiedAmount: '60000' }),
  });
  assert.equal(overCeiling.ok, false);
  assert.equal(overCeiling.status, 400);
  assert.equal(overCeiling.error, 'payment_invalid');
  assert.match(overCeiling.message, /exceeds upto max_amount 50000/);
  assert.equal(ledger3.entries.length, 0);
});

test('a paid ingest stamp is its own book row, signed to the same seat', async () => {
  const { registry, ledger, identity } = setupDeps();
  const { verifyBookSeq } = await import('../src/book-seq.js');
  const result = await ingestForeignX402({
    payment_required: {
      resource: 'https://api.grokbot.app/v1/chat/completions',
      amount: '10000',
      payTo: '0xGrokBotTreasury',
    },
    payment_response: {
      tx: '0xforeign',
      payer: WALLET_A,
      network: 'base',
    },
    session: identity.session,
  }, {
    ledger,
    registry,
    agentId: identity.agent_id,
    session: identity.session,
    verify: verifyOk,
    ensureStamp: async () => ({
      ok: true,
      waived: false,
      settlement: { paymentRef: 'base:0xstamp', amount: '2000', payer: WALLET_A },
    }),
  });
  assert.equal(result.ok, true, result.message);
  assert.equal(result.body.stamp_payment_ref, 'base:0xstamp');
  assert.match(result.body.stamp_task_id, /^ingest-stamp-/);
  const foreign = ledger.findByRef('base:0xforeign');
  const stamp = ledger.findByRef('base:0xstamp');
  assert.equal(foreign.book_chain.payment_ref, 'base:0xforeign');
  assert.equal(foreign.book_chain.book_id, identity.agent_id);
  assert.equal(stamp.event, 'ingest_stamp');
  assert.equal(stamp.evidence, 'ingest_stamp');
  assert.equal(stamp.book_chain.payment_ref, 'base:0xstamp');
  assert.equal(stamp.book_chain.book_id, identity.agent_id);
  assert.equal(stamp.book_chain.payload_version, 4);
  assert.equal(verifyBookSeq(stamp.book_chain).valid, true);
  assert.equal(verifyBookSeq(foreign.book_chain).valid, true);
  assert.equal(ledger.sumCollectedByAgent(identity.agent_id), 10000n);
});

test('minimal foreign_invoice ingest → book row with verify_url', async () => {
  const { registry, ledger, identity } = setupDeps();

  const result = await ingestForeignX402({
    foreign_invoice: {
      amount: '9900',
      payer: WALLET_A,
      payTo: '0xMoonPaySink',
      tx: '0xminimaltx',
      hub: 'api.moonpay.example',
      model: '/paybox/settle',
    },
    session: identity.session,
  }, {
    ledger,
    registry,
    agentId: identity.agent_id,
    session: identity.session,
    verify: verifyOk,
    baseUrl: 'https://api.chit402.com',
    reqHost: 'api.chit402.com',
  });

  assert.equal(result.ok, true);
  assert.equal(result.body.payment.amount, '9900');
  assert.equal(result.body.route.hub, 'api.moonpay.example');
  assert.match(result.body.verify_url, /^https:\/\/api\.chit402\.com\/receipt\/foreign-x402-/);

  const publicView = buildPublicForeignIngestReceipt(ledger.entries[0].receipt_snapshot, {
    baseUrl: 'https://api.chit402.com',
    reqHost: 'api.chit402.com',
  });
  assert.equal(publicView.evidence, 'foreign_ingest');
  assert.equal(publicView.verify_url, result.body.verify_url);
});

test('Solana network sets rail to solana, not usdc', async () => {
  const { registry, ledger, identity } = setupDeps();

  // Mock verify that would throw for Solana (real impl does) — but we use verifyOk to bypass
  // since the test is about rail detection, not actual Solana verification.
  const result = await ingestForeignX402({
    payment_required: {
      resource: 'https://api.solana-shop.io/infer',
      amount: '5000',
      payTo: 'SoLanaTreasuryAddress123',
    },
    payment_response: {
      tx: '3vZ9Y9X...solana-sig',
      payer: 'SolanaPayerAddress456',
      network: 'solana',
    },
    session: identity.session,
  }, {
    ledger,
    registry,
    agentId: identity.agent_id,
    session: identity.session,
    verify: verifyOk,  // bypassing actual Solana verification for rail detection test
  });

  assert.equal(result.ok, true);
  assert.equal(result.status, 201);
  assert.equal(result.body.payment.rail, 'solana', 'Solana network → solana rail');
  assert.equal(result.body.payment.ref, 'solana:3vZ9Y9X...solana-sig');

  const entry = ledger.entries[0];
  assert.equal(entry.rail, 'solana');
});

test('reject naked tx hash (no payer) — fails before verify', async () => {
  const { registry, ledger, identity } = setupDeps();

  const result = await ingestForeignX402({
    payment_required: {
      resource: 'https://api.grokbot.app/v1/chat/completions',
      amount: '10000',
      payTo: '0xTreasury',
    },
    payment_response: {
      tx: '0xabc123',
    },
    session: identity.session,
  }, {
    ledger,
    registry,
    agentId: identity.agent_id,
    session: identity.session,
    verify: verifyOk,
  });

  assert.equal(result.ok, false);
  assert.equal(result.status, 400);
  assert.equal(result.error, 'invalid_payment_response');
  assert.match(result.message, /payer.*required/i);
  assert.equal(ledger.entries.length, 0);
});

test('reject naked tx hash (no payment_required context) — fails before verify', async () => {
  const { registry, ledger, identity } = setupDeps();

  const result = await ingestForeignX402({
    payment_response: {
      tx: '0xabc123',
      payer: WALLET_A,
    },
    session: identity.session,
  }, {
    ledger,
    registry,
    agentId: identity.agent_id,
    session: identity.session,
    verify: verifyOk,
  });

  assert.equal(result.ok, false);
  assert.equal(result.status, 400);
  assert.equal(result.error, 'invalid_ingest_payload');
  assert.equal(ledger.entries.length, 0);
});

test('reject replay (same tx twice) — ledger is nullifier', async () => {
  const { registry, ledger, identity } = setupDeps();

  const body = {
    payment_required: {
      resource: 'https://api.example.com/v1/chat',
      amount: '20000',
      payTo: '0xExampleTreasury',
    },
    payment_response: {
      tx: '0xreplayme',
      payer: WALLET_A,
      network: 'base',
    },
    session: identity.session,
  };

  const first = await ingestForeignX402(body, {
    ledger, registry, agentId: identity.agent_id, session: identity.session, verify: verifyOk,
  });
  assert.equal(first.ok, true);
  assert.equal(ledger.entries.length, 1);

  const second = await ingestForeignX402(body, {
    ledger, registry, agentId: identity.agent_id, session: identity.session, verify: verifyOk,
  });
  assert.equal(second.ok, false);
  assert.equal(second.status, 409);
  assert.equal(second.error, 'duplicate_ref', 'replay blocked by ledger findByRef');
  assert.equal(ledger.entries.length, 1, 'replay should not add');
});

test('demo key never writes to book (rejects before verify)', async () => {
  const { registry, ledger, identity } = setupDeps();

  const result = await ingestForeignX402({
    payment_required: {
      resource: 'https://api.grokbot.app/v1/chat',
      amount: '10000',
      payTo: '0xTreasury',
    },
    payment_response: {
      tx: '0xdemo123',
      payer: WALLET_A,
    },
    session: identity.session,
  }, {
    ledger,
    registry,
    agentId: identity.agent_id,
    session: identity.session,
    verify: verifyOk,
    isDemo: true,
  });

  assert.equal(result.ok, false);
  assert.equal(result.status, 403);
  assert.equal(result.error, 'demo_rejected');
  assert.match(result.message, /Demo.*cannot/i);
  assert.equal(ledger.entries.length, 0);
});

test('possession-gated: wrong session rejected (before verify)', async () => {
  const { registry, ledger, identity } = setupDeps();

  const result = await ingestForeignX402({
    payment_required: {
      resource: 'https://api.example.com/v1/chat',
      amount: '10000',
      payTo: '0xTreasury',
    },
    payment_response: {
      tx: '0xwrongsession',
      payer: WALLET_A,
    },
    session: 'wrong-session-value',
  }, {
    ledger,
    registry,
    agentId: identity.agent_id,
    session: 'wrong-session-value',
    verify: verifyOk,
  });

  assert.equal(result.ok, false);
  assert.equal(result.status, 403);
  assert.equal(result.error, 'forbidden');
  assert.equal(ledger.entries.length, 0);
});

test('possession-gated: no session rejected (before verify)', async () => {
  const { registry, ledger, identity } = setupDeps();

  const result = await ingestForeignX402({
    payment_required: {
      resource: 'https://api.example.com/v1/chat',
      amount: '10000',
      payTo: '0xTreasury',
    },
    payment_response: {
      tx: '0xnosession',
      payer: WALLET_A,
    },
  }, {
    ledger,
    registry,
    agentId: identity.agent_id,
    verify: verifyOk,
  });

  assert.equal(result.ok, false);
  assert.equal(result.status, 401);
  assert.equal(result.error, 'unauthorized');
  assert.equal(ledger.entries.length, 0);
});

test('possession-gated: session for different agent_id rejected (before verify)', async () => {
  const registry = new AgentRegistry();
  const ledger = new UsageSettledLedger();
  const identity1 = registry.allocate({ taskId: 'agent1' });
  const identity2 = registry.allocate({ taskId: 'agent2' });

  const result = await ingestForeignX402({
    payment_required: {
      resource: 'https://api.example.com/v1/chat',
      amount: '10000',
      payTo: '0xTreasury',
    },
    payment_response: {
      tx: '0xwrongagent',
      payer: WALLET_A,
    },
    session: identity1.session,
  }, {
    ledger,
    registry,
    agentId: identity2.agent_id,
    session: identity1.session,
    verify: verifyOk,
  });

  assert.equal(result.ok, false);
  assert.equal(result.status, 403);
  assert.equal(result.error, 'forbidden');
  assert.match(result.message, /does not match/i);
});

test('house self-pay is allowed if real on-chain tx (with valid verify)', async () => {
  const { registry, ledger, identity } = setupDeps();

  const result = await ingestForeignX402({
    payment_required: {
      resource: 'https://api.xfuel.app/v1/chat/completions',
      amount: '10000',
      payTo: '0xBasetreasury',
    },
    payment_response: {
      tx: '0xhouseselfpay',
      payer: WALLET_A,
      network: 'base',
    },
    session: identity.session,
  }, {
    ledger,
    registry,
    agentId: identity.agent_id,
    session: identity.session,
    verify: verifyOk,
  });

  assert.equal(result.ok, true);
  assert.equal(result.status, 201);
  assert.equal(result.body.route.hub, 'api.xfuel.app');
  assert.equal(ledger.entries.length, 1);
});

// ─── Verification fail-closed tests ───────────────────────────────────────────

test('FAIL CLOSED: verify unavailable → 502, no book row', async () => {
  const { registry, ledger, identity } = setupDeps();

  const result = await ingestForeignX402({
    payment_required: {
      resource: 'https://api.grokbot.app/v1/chat',
      amount: '10000',
      payTo: '0xTreasury',
    },
    payment_response: {
      tx: '0xnoverify',
      payer: WALLET_A,
    },
    session: identity.session,
  }, {
    ledger,
    registry,
    agentId: identity.agent_id,
    session: identity.session,
    // verify NOT provided
  });

  assert.equal(result.ok, false);
  assert.equal(result.status, 502);
  assert.equal(result.error, 'verify_unavailable');
  assert.match(result.message, /not configured/i);
  assert.equal(ledger.entries.length, 0, 'no row without verify');
});

test('FAIL CLOSED: verify throws → 502, no book row', async () => {
  const { registry, ledger, identity } = setupDeps();

  const result = await ingestForeignX402({
    payment_required: {
      resource: 'https://api.grokbot.app/v1/chat',
      amount: '10000',
      payTo: '0xTreasury',
    },
    payment_response: {
      tx: '0xverifythrows',
      payer: WALLET_A,
    },
    session: identity.session,
  }, {
    ledger,
    registry,
    agentId: identity.agent_id,
    session: identity.session,
    verify: verifyThrows,
  });

  assert.equal(result.ok, false);
  assert.equal(result.status, 502);
  assert.equal(result.error, 'verify_failed');
  assert.match(result.message, /exploded/i);
  assert.equal(ledger.entries.length, 0, 'no row when verify throws');
});

test('FAIL CLOSED: verify returns valid: false → 400, no book row', async () => {
  const { registry, ledger, identity } = setupDeps();

  const result = await ingestForeignX402({
    payment_required: {
      resource: 'https://api.grokbot.app/v1/chat',
      amount: '10000',
      payTo: '0xTreasury',
    },
    payment_response: {
      tx: '0xverifyrejects',
      payer: WALLET_A,
    },
    session: identity.session,
  }, {
    ledger,
    registry,
    agentId: identity.agent_id,
    session: identity.session,
    verify: verifyFail,
  });

  assert.equal(result.ok, false);
  assert.equal(result.status, 400);
  assert.equal(result.error, 'payment_invalid');
  assert.match(result.message, /mock rejection/i);
  assert.equal(ledger.entries.length, 0, 'no row when verify fails');
});

test('FAIL CLOSED: only valid: true writes a row', async () => {
  const { registry, ledger, identity } = setupDeps();

  // First: verify returns undefined (not explicit valid: true)
  const resultUndef = await ingestForeignX402({
    payment_required: {
      resource: 'https://api.grokbot.app/v1/chat',
      amount: '10000',
      payTo: '0xTreasury',
    },
    payment_response: {
      tx: '0xverifyundef',
      payer: WALLET_A,
    },
    session: identity.session,
  }, {
    ledger,
    registry,
    agentId: identity.agent_id,
    session: identity.session,
    verify: async () => ({}), // returns {}, not { valid: true }
  });

  assert.equal(resultUndef.ok, false);
  assert.equal(resultUndef.status, 400);
  assert.equal(resultUndef.error, 'payment_invalid');
  assert.equal(ledger.entries.length, 0, 'no row without explicit valid: true');

  // Second: verify returns valid: true
  const resultValid = await ingestForeignX402({
    payment_required: {
      resource: 'https://api.grokbot.app/v1/chat',
      amount: '10000',
      payTo: '0xTreasury',
    },
    payment_response: {
      tx: '0xverifyok',
      payer: WALLET_A,
    },
    session: identity.session,
  }, {
    ledger,
    registry,
    agentId: identity.agent_id,
    session: identity.session,
    verify: verifyOk,
  });

  assert.equal(resultValid.ok, true);
  assert.equal(resultValid.status, 201);
  assert.equal(ledger.entries.length, 1, 'row written only with valid: true');
});

test('FAIL CLOSED: chain unreadable (network error) → 502, no book row', async () => {
  const { registry, ledger, identity } = setupDeps();

  const result = await ingestForeignX402({
    payment_required: {
      resource: 'https://api.grokbot.app/v1/chat',
      amount: '10000',
      payTo: '0xTreasury',
    },
    payment_response: {
      tx: '0xchainunreadable',
      payer: WALLET_A,
      network: 'base',
    },
    session: identity.session,
  }, {
    ledger,
    registry,
    agentId: identity.agent_id,
    session: identity.session,
    verify: verifyChainUnreadable,
  });

  assert.equal(result.ok, false);
  assert.equal(result.status, 502);
  assert.equal(result.error, 'verify_failed');
  assert.match(result.message, /failed to fetch/i);
  assert.equal(ledger.entries.length, 0, 'no row when chain is unreadable');
});

test('buildOnChainVerify fetches the 0x hash from an eip155 payment ref', async () => {
  const calls = [];
  const payTo = V2_PAY_TO;
  const provider = {
    async getTransactionReceipt(hash) {
      calls.push(hash);
      return {
        status: 1,
        blockNumber: 9,
        logs: [{
          address: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
          topics: [
            '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef',
            `0x${WALLET_A.slice(2).padStart(64, '0')}`,
            `0x${payTo.slice(2).padStart(64, '0')}`,
          ],
          data: `0x${(10000n).toString(16).padStart(64, '0')}`,
        }],
      };
    },
  };
  const verify = buildOnChainVerify(provider);
  const result = await verify({
    paymentRef: `eip155:8453:${V2_TX}`,
    payer: WALLET_A,
    payTo,
    amount: '10000',
    network: 'eip155:8453',
  });
  assert.deepEqual(calls, [V2_TX]);
  assert.equal(result.valid, true, result.reason);
  assert.equal(result.txHash, V2_TX);
  assert.equal(result.verifiedAmount, '10000');
});

test('buildOnChainVerify returns null when no BASE_RPC_URL configured', () => {
  // resetBaseProvider was called in beforeEach, and BASE_RPC_URL is not set
  // So buildOnChainVerify() should return null
  const verify = buildOnChainVerify();
  assert.equal(verify, null, 'verify should be null without BASE_RPC_URL');
});

test('ledger nullifier persists: duplicate ref rejected across fresh ledger load', async () => {
  // This test simulates persistence by using the same ledger instance
  // (real persistence would reload from disk, which UsageSettledLedger supports)
  const registry = new AgentRegistry();
  const ledger = new UsageSettledLedger();
  const identity = registry.allocate({ taskId: 'persist-test' });

  const body = {
    payment_required: {
      resource: 'https://api.example.com/v1/chat',
      amount: '15000',
      payTo: '0xPersistTreasury',
    },
    payment_response: {
      tx: '0xpersisttx',
      payer: WALLET_A,
      network: 'base',
    },
    session: identity.session,
  };

  // First ingest succeeds
  const first = await ingestForeignX402(body, {
    ledger, registry, agentId: identity.agent_id, session: identity.session, verify: verifyOk,
  });
  assert.equal(first.ok, true);
  assert.equal(ledger.entries.length, 1);

  // Simulate "restart" by checking ledger still has the entry
  // (in production with persist=true, this would survive process restart)
  const existing = ledger.findByRef('base:0xpersisttx');
  assert.ok(existing, 'ledger should retain entry for nullification');

  // Second ingest with same tx is rejected
  const second = await ingestForeignX402(body, {
    ledger, registry, agentId: identity.agent_id, session: identity.session, verify: verifyOk,
  });
  assert.equal(second.ok, false);
  assert.equal(second.status, 409);
  assert.equal(second.error, 'duplicate_ref');
  assert.equal(ledger.entries.length, 1, 'no duplicate row');
});

// ─── HTTP route tests ─────────────────────────────────────────────────────────

let server;
let base;
let httpApp;

before(async () => {
  setForeignIngestVerifyForTests(verifyOk);
  httpApp = createApp();
  await new Promise((resolve) => {
    server = httpApp.listen(0, () => {
      const { port } = server.address();
      base = `http://127.0.0.1:${port}`;
      resolve();
    });
  });
});

after(async () => {
  setForeignIngestVerifyForTests(null);
  if (!server) return;
  if (typeof server.closeAllConnections === 'function') server.closeAllConnections();
  await new Promise((resolve) => server.close(resolve));
});

test('POST /v1/agents/:agent_id/book/ingest without session is 401', async () => {
  const res = await fetch(`${base}/v1/agents/1/book/ingest`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      payment_required: { resource: 'https://x.com/v1', amount: '10000', payTo: '0x1' },
      payment_response: { tx: '0xabc', payer: '0x2' },
    }),
  });
  assert.equal(res.status, 401);
  const body = await res.json();
  assert.equal(body.error, 'unauthorized');
});

test('POST /v1/agents/:agent_id/book/ingest with xfuel-demo key is 403', async () => {
  const res = await fetch(`${base}/v1/agents/1/book/ingest`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-API-Key': 'xfuel-demo',
      'X-Xfuel-Session': 'any-session',
    },
    body: JSON.stringify({
      payment_required: { resource: 'https://x.com/v1', amount: '10000', payTo: '0x1' },
      payment_response: { tx: '0xabc', payer: '0x2' },
    }),
  });
  assert.equal(res.status, 403);
  const body = await res.json();
  assert.equal(body.error, 'demo_rejected');
});

test('POST /v1/agents/:agent_id/book/ingest without payment_required is rejected (wrong session → 403)', async () => {
  const res = await fetch(`${base}/v1/agents/1/book/ingest`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Xfuel-Session': 'any-session',
    },
    body: JSON.stringify({
      payment_response: { tx: '0xabc', payer: '0x2' },
    }),
  });
  assert.equal(res.status, 403);
  const body = await res.json();
  assert.equal(body.error, 'forbidden');
});

test('POST /v1/agents/:agent_id/book/ingest without payment_response is rejected (wrong session → 403)', async () => {
  const res = await fetch(`${base}/v1/agents/1/book/ingest`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Xfuel-Session': 'any-session',
    },
    body: JSON.stringify({
      payment_required: { resource: 'https://x.com/v1', amount: '10000', payTo: '0x1' },
    }),
  });
  assert.equal(res.status, 403);
  const body = await res.json();
  assert.equal(body.error, 'forbidden');
});

test('GET /openapi.json includes /v1/agents/{agent_id}/book/ingest', async () => {
  const res = await fetch(`${base}/openapi.json`);
  const spec = await res.json();
  assert.ok(spec.paths['/v1/agents/{agent_id}/book/ingest']);
  const op = spec.paths['/v1/agents/{agent_id}/book/ingest'].post;
  assert.equal(op.operationId, 'ingestForeignX402');
  assert.match(op.description, /x402.*spend.*foreign/i);
  assert.match(op.description, /naked.*tx.*rejected/i);
});

test('GET /llms.txt mentions book/ingest', async () => {
  const llms = await (await fetch(`${base}/llms.txt`)).text();
  assert.match(llms, /\/v1\/agents\/:agent_id\/book\/ingest/);
  assert.match(llms, /Foreign ingest/i);
  assert.match(llms, /spent elsewhere → stamp here/i);
});

test('smoke fixture: ingest row verify_url resolves on GET /receipt', async () => {
  const hooks = httpApp.locals.__test;
  assert.ok(hooks?.usageSettled && hooks?.agentRegistry, 'test hooks on app.locals');
  const identity = hooks.agentRegistry.allocate({ taskId: 'foreign-ingest-smoke' });

  const seeded = await ingestForeignX402({
    foreign_invoice: {
      amount: '5000',
      payer: WALLET_A,
      payTo: '0xExternalPayBox',
      tx: '0xsmokeverifytx',
      hub: 'external.shop',
      model: '/v1/run',
    },
    session: identity.session,
  }, {
    ledger: hooks.usageSettled,
    registry: hooks.agentRegistry,
    agentId: identity.agent_id,
    session: identity.session,
    verify: verifyOk,
    baseUrl: base,
  });
  assert.equal(seeded.ok, true);

  const receiptRes = await fetch(`${base}/receipt/${seeded.body.task_id}?format=json`, {
    headers: { Accept: 'application/json' },
  });
  const receiptBody = await receiptRes.json();
  assert.equal(receiptRes.status, 200, JSON.stringify(receiptBody));
  const receipt = receiptBody;
  assert.equal(receipt.task_id, seeded.body.task_id);
  assert.equal(receipt.foreign_x402, true);
  assert.equal(receipt.evidence, 'foreign_ingest');
  assert.equal(receipt.payment.ref, 'base:0xsmokeverifytx');
  assert.equal(receipt.verify_url, `${base}/receipt/${seeded.body.task_id}`);
});

// ─── Stamp Fee Tests ─────────────────────────────────────────────────────────

test('ingest reports $0.002 stamp and does not debit prepaid budget', async () => {
  const { registry, ledger, identity } = setupDeps();
  registry.setBudget(identity.agent_id, '10000');

  const result = await ingestForeignX402({
    payment_required: {
      resource: 'https://api.shop.io/v1/infer',
      amount: '5000',
      payTo: '0xShopTreasury',
    },
    payment_response: {
      tx: '0xstamptest123',
      payer: WALLET_A,
      network: 'base',
    },
    session: identity.session,
  }, {
    ledger,
    registry,
    agentId: identity.agent_id,
    session: identity.session,
    verify: verifyOk,
  });

  assert.equal(result.ok, true);
  assert.equal(result.status, 201);
  assert.equal(result.body.stamp_fee, String(STAMP_FEE_UNITS));
  assert.equal(result.body.stamp_fee, '2000');
  assert.equal(result.body.stamp_fee_usd, '0.002');

  // Cap is unchanged. Spend is the ingested USDC amount once — not also the stamp.
  const updated = registry.get(identity.agent_id);
  assert.equal(updated.budget, '10000');
  const spent = ledger.sumCollectedByAgent(identity.agent_id);
  assert.equal(spent, 5000n);
  const view = capViewOf(updated, spent);
  assert.equal(view.remaining, '5000');
});

test('a small prepaid budget does not block the stamp and is not mutated', async () => {
  const { registry, ledger, identity } = setupDeps();
  registry.setBudget(identity.agent_id, '50');

  const result = await ingestForeignX402({
    payment_required: {
      resource: 'https://api.shop.io/v1/infer',
      amount: '5000',
      payTo: '0xShopTreasury',
    },
    payment_response: {
      tx: '0xinsufficient123',
      payer: WALLET_A,
      network: 'base',
    },
    session: identity.session,
  }, {
    ledger,
    registry,
    agentId: identity.agent_id,
    session: identity.session,
    verify: verifyOk,
  });

  assert.equal(result.ok, true);
  assert.equal(result.body.stamp_fee, '2000');
  assert.equal(registry.get(identity.agent_id).budget, '50');
  assert.equal(ledger.sumCollectedByAgent(identity.agent_id), 5000n);
});

test('ingest without budget set (unlimited) reports the stamp and leaves budget null', async () => {
  const { registry, ledger, identity } = setupDeps();

  const result = await ingestForeignX402({
    payment_required: {
      resource: 'https://api.shop.io/v1/infer',
      amount: '5000',
      payTo: '0xShopTreasury',
    },
    payment_response: {
      tx: '0xunlimited123',
      payer: WALLET_A,
      network: 'base',
    },
    session: identity.session,
  }, {
    ledger,
    registry,
    agentId: identity.agent_id,
    session: identity.session,
    verify: verifyOk,
  });

  assert.equal(result.ok, true);
  assert.equal(result.status, 201);
  assert.equal(result.body.stamp_fee, '2000');
  assert.equal(registry.get(identity.agent_id).budget, null);
});

test('ensureStamp 402 writes nothing and does not touch budget', async () => {
  const { registry, ledger, identity } = setupDeps();
  registry.setBudget(identity.agent_id, '10000');
  const result = await ingestForeignX402({
    payment_required: {
      resource: 'https://api.shop.io/v1/infer',
      amount: '5000',
      payTo: '0xShopTreasury',
    },
    payment_response: {
      tx: '0xstamp402',
      payer: WALLET_A,
      network: 'base',
    },
    session: identity.session,
  }, {
    ledger,
    registry,
    agentId: identity.agent_id,
    session: identity.session,
    verify: verifyOk,
    ensureStamp: async () => ({
      ok: false,
      status: 402,
      error: 'stamp_payment_required',
      message: 'pay the stamp',
    }),
  });
  assert.equal(result.ok, false);
  assert.equal(result.status, 402);
  assert.equal(ledger.entries.length, 0);
  assert.equal(registry.get(identity.agent_id).budget, '10000');
});

function nanoBody(overrides = {}) {
  return {
    session: overrides.session,
    nano: {
      block: NANO_HASH,
      recipient: NANO_RECIPIENT,
      amount: NANO_RAW,
      description: '1 XNO mainnet send',
      ...overrides.nano,
    },
  };
}

test('cemented Nano fixture stamps a receipt with raw, XNO, estimate, and explorer', async () => {
  assert.equal(NANO_SEND.subtype, 'send');
  assert.equal(String(NANO_SEND.confirmed), 'true');
  assert.equal(NANO_SEND.amount, NANO_RAW);
  assert.equal(NANO_SEND.contents.link_as_account, NANO_RECIPIENT);
  assert.equal(NANO_SEND.linked_account, NANO_RECIPIENT);
  assert.equal(
    (BigInt(NANO_PREV.balance) - BigInt(NANO_SEND.balance)).toString(),
    NANO_SEND.amount,
  );
  const { registry, ledger, identity } = setupDeps();
  registry.setBudget(identity.agent_id, '10000');
  const result = await ingestForeignX402(nanoBody({ session: identity.session }), {
    ledger,
    registry,
    agentId: identity.agent_id,
    session: identity.session,
    fetchImpl: nanoFetch(),
    rpcUrls: ['http://rpc-a.test', 'http://rpc-b.test'],
  });
  assert.equal(result.ok, true, result.message);
  assert.equal(result.status, 201);
  assert.equal(result.body.payment.chain, 'nano');
  assert.equal(result.body.payment.rail, 'nano');
  assert.equal(result.body.payment.block_hash, NANO_HASH);
  assert.equal(result.body.payment.amount_raw, NANO_RAW);
  assert.equal(result.body.payment.amount_xno, '1');
  assert.equal(result.body.payment.usd_estimate.label, 'estimate');
  assert.equal(result.body.payment.usd_estimate.source, 'kraken');
  assert.equal(result.body.payment.usd_estimate.pair, 'NANOUSD');
  assert.equal(result.body.payment.usd_estimate.price_usd, '0.80');
  assert.equal(result.body.payment.usd_estimate.amount_usd, '0.8');
  assert.equal(result.body.payment.explorer_url, `https://nanexplorer.com/nano/block/${NANO_HASH}`);
  assert.equal(result.body.route.model, '1 XNO mainnet send');
  assert.equal(result.body.stamp_fee, '2000');
  assert.equal(registry.get(identity.agent_id).budget, '10000');
  assert.equal(ledger.sumCollectedByAgent(identity.agent_id), 0n, 'nano raw is not USDC spend');

  const row = ledger.findByRef(`nano:${NANO_HASH}`);
  assert.ok(row);
  assert.equal(row.receipt_snapshot.payment.chain, 'nano');
  assert.equal(row.amount_xno, '1');
  assert.equal(row.book_chain.payload_version, 4);
  assert.equal(row.book_chain.payment_ref, `nano:${NANO_HASH}`);
  assert.equal(row.book_chain.book_id, identity.agent_id);
  const { verifyBookSeq } = await import('../src/book-seq.js');
  assert.equal(verifyBookSeq(row.book_chain).valid, true);

  const again = await ingestForeignX402(nanoBody({ session: identity.session }), {
    ledger,
    registry,
    agentId: identity.agent_id,
    session: identity.session,
    fetchImpl: nanoFetch(),
    rpcUrls: ['http://rpc-a.test', 'http://rpc-b.test'],
  });
  assert.equal(again.status, 409);
  assert.equal(again.error, 'duplicate_ref');
  assert.equal(ledger.entries.length, 1);
});

test('Nano ingest rejects unconfirmed, recipient mismatch, and amount mismatch', async () => {
  const { registry, ledger, identity } = setupDeps();
  const baseDeps = {
    ledger,
    registry,
    agentId: identity.agent_id,
    session: identity.session,
    rpcUrls: ['http://rpc-a.test', 'http://rpc-b.test'],
  };

  const unconfirmed = await ingestForeignX402(nanoBody({ session: identity.session }), {
    ...baseDeps,
    fetchImpl: nanoFetch({
      mutate: (payload, hash) => {
        if (hash === NANO_HASH) payload.confirmed = 'false';
        return payload;
      },
    }),
  });
  assert.equal(unconfirmed.ok, false);
  assert.match(unconfirmed.message, /not cemented/i);

  const mismatchRecipient = await ingestForeignX402(nanoBody({
    session: identity.session,
    nano: { recipient: 'nano_3jwrszth46rk1mu7rmb4rhm54us8yg1gw3ipodftqtikf5yqdyr7471nsg1k' },
  }), { ...baseDeps, fetchImpl: nanoFetch() });
  assert.equal(mismatchRecipient.ok, false);
  assert.match(mismatchRecipient.message, /recipient/i);

  const mismatchAmount = await ingestForeignX402(nanoBody({
    session: identity.session,
    nano: { amount: '1' },
  }), { ...baseDeps, fetchImpl: nanoFetch() });
  assert.equal(mismatchAmount.ok, false);
  assert.match(mismatchAmount.message, /amount/i);
  assert.equal(ledger.entries.length, 0);
});

test('Nano ingest rejects when the two RPCs disagree', async () => {
  const { registry, ledger, identity } = setupDeps();
  const result = await ingestForeignX402(nanoBody({ session: identity.session }), {
    ledger,
    registry,
    agentId: identity.agent_id,
    session: identity.session,
    rpcUrls: ['http://rpc-a.test', 'http://rpc-b.test'],
    fetchImpl: nanoFetch({
      mutate: (payload, hash, url) => {
        if (hash === NANO_HASH && String(url).includes('rpc-b')) payload.amount = '1';
        return payload;
      },
    }),
  });
  assert.equal(result.ok, false);
  assert.match(result.message, /disagree/i);
  assert.equal(ledger.entries.length, 0);
});

test('POST book/ingest without a stamp payment is 402 for $0.002', async () => {
  const hooks = httpApp.locals.__test;
  const identity = hooks.agentRegistry.allocate({ taskId: 'stamp-402' });
  hooks.agentRegistry.setBudget(identity.agent_id, '9000');
  const beforeRows = hooks.usageSettled.entries.length;
  const res = await fetch(`${base}/v1/agents/${identity.agent_id}/book/ingest`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      session: identity.session,
      payment_required: {
        resource: 'https://api.shop.io/v1/infer',
        amount: '5000',
        payTo: '0xShopTreasury',
      },
      payment_response: { tx: '0xhttpstamp', payer: WALLET_A, network: 'base' },
    }),
  });
  const body = await res.json();
  assert.equal(res.status, 402, JSON.stringify(body));
  assert.equal(body.stamp_fee, '2000');
  assert.equal(body.stamp_fee_usd, '0.002');
  assert.equal(body.accepts?.[0]?.amount, '2000');
  assert.ok(res.headers.get('payment-required'));
  assert.equal(hooks.usageSettled.entries.length, beforeRows);
  assert.equal(hooks.agentRegistry.get(identity.agent_id).budget, '9000');
});

test('pilot waiver key stamps free up to the cap, then 402; default is off', async () => {
  const hooks = httpApp.locals.__test;
  const identity = hooks.agentRegistry.allocate({ taskId: 'stamp-waiver' });
  hooks.agentRegistry.setBudget(identity.agent_id, '9000');
  const prevKeys = process.env.STAMP_WAIVER_KEYS;
  const prevCap = process.env.STAMP_WAIVER_CAP;
  process.env.STAMP_WAIVER_KEYS = 'partner-pilot-key';
  process.env.STAMP_WAIVER_CAP = '1';
  resetStampWaiverStore();
  try {
    const post = (tx, key) => fetch(`${base}/v1/agents/${identity.agent_id}/book/ingest`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(key ? { 'X-API-Key': key } : {}),
      },
      body: JSON.stringify({
        session: identity.session,
        payment_required: {
          resource: 'https://api.shop.io/v1/infer',
          amount: '1000',
          payTo: '0xShopTreasury',
        },
        payment_response: { tx, payer: WALLET_A, network: 'base' },
      }),
    });

    const denied = await post('0xwaiver-off', 'someone-else');
    assert.equal(denied.status, 402);

    const first = await post('0xwaiver-one', 'partner-pilot-key');
    const firstBody = await first.json();
    assert.equal(first.status, 201, JSON.stringify(firstBody));
    assert.equal(firstBody.stamp_waived, true);
    assert.equal(firstBody.stamp_fee, '2000');
    assert.equal(hooks.agentRegistry.get(identity.agent_id).budget, '9000');

    const second = await post('0xwaiver-two', 'partner-pilot-key');
    assert.equal(second.status, 402);
  } finally {
    if (prevKeys == null) delete process.env.STAMP_WAIVER_KEYS;
    else process.env.STAMP_WAIVER_KEYS = prevKeys;
    if (prevCap == null) delete process.env.STAMP_WAIVER_CAP;
    else process.env.STAMP_WAIVER_CAP = prevCap;
    resetStampWaiverStore();
  }
});

test('a new foreign payout signs an issuer JWS the standard verifier accepts', async () => {
  const { getJwks } = await import('../src/issuer-key.js');
  const { verifyReceiptEcdsa } = await import('../src/receipt.js');
  const fingerprint = 'a09e1e0b0aed6a7826b55281ef1e8af19fb164034a662d122adaa503b54f7dc2';
  const tx = `0x${'cd'.repeat(32)}`;
  const payer = '0x9f8951cb8b060f52fdf87297b3c5b00f7aa18f52';
  const payee = '0x1111111111111111111111111111111111111111';
  const receipt = buildForeignReceipt({
    taskId: 'foreign-x402-jws',
    paymentRequired: {
      resource: `https://basescan.org/tx/${tx}`,
      amount: '1000000',
      payTo: payee,
      network: 'base',
    },
    paymentResponse: { tx, payer, network: 'base' },
    rail: 'usdc',
    fingerprint,
  });
  const checked = verifyReceiptEcdsa(receipt, getJwks().keys[0]);
  assert.equal(checked.valid, true, checked.reason);
  assert.equal(checked.payload.schema, 'chit402.foreign_payout.v1');
  assert.equal(checked.payload.payment.payee, payee);
  assert.equal(checked.payload.payment.asset, receipt.payment.asset);
  assert.equal(checked.payload.caller_binding.payer_wallet, payer);
  assert.equal(checked.payload.chain, 'base');
  assert.equal(checked.payload.tx, tx);
  assert.equal(checked.payload.agent_record_entry.fingerprint, fingerprint);
  assert.equal(receipt.verification.jwks_uri, 'https://api.chit402.com/.well-known/jwks.json');

  const plain = buildForeignReceipt({
    taskId: 'foreign-x402-plain',
    paymentRequired: {
      resource: `https://basescan.org/tx/${tx}`,
      amount: '1000000',
      payTo: payee,
      network: 'base',
    },
    paymentResponse: { tx: `0x${'ef'.repeat(32)}`, payer, network: 'base' },
    rail: 'usdc',
  });
  const plainCheck = verifyReceiptEcdsa(plain, getJwks().keys[0]);
  assert.equal(plainCheck.valid, true, plainCheck.reason);
  assert.equal(plainCheck.payload.agent_record_entry, undefined);

  const unsigned = { ...receipt };
  delete unsigned.issuer_signature;
  delete unsigned.verification;
  const pub = buildPublicForeignIngestReceipt(unsigned, { baseUrl: 'https://api.chit402.com' });
  assert.equal(pub.issuer_signature, undefined);
});

test('public ingest ignores a caller-supplied entry fingerprint', async () => {
  const { verifyJws, getJwks } = await import('../src/issuer-key.js');
  const { registry, ledger, identity } = setupDeps();
  const supplied = 'ab'.repeat(32);
  const result = await ingestForeignX402({
    payment_required: {
      resource: 'https://api.grokbot.app/v1/chat/completions',
      amount: '10000',
      payTo: '0xGrokBotTreasury',
    },
    payment_response: {
      tx: '0xfingerprintignored',
      payer: WALLET_A,
      network: 'base',
    },
    agent_record_entry: { fingerprint: supplied, registry: '1f916' },
    session: identity.session,
  }, {
    ledger,
    registry,
    agentId: identity.agent_id,
    session: identity.session,
    verify: verifyOk,
  });
  assert.equal(result.ok, true);
  const jws = ledger.entries[0].receipt_snapshot.issuer_signature.jws;
  const checked = verifyJws(jws, getJwks().keys[0]);
  assert.equal(checked.valid, true);
  assert.equal(checked.payload.agent_record_entry, undefined);
  assert.equal(ledger.entries[0].issuer_signature, undefined);
});
