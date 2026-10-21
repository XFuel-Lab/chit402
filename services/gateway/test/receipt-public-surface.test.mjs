/**
 * Public receipt routes carry one receipt. Another receipt shows up only as
 * a sibling hash or a count. These tests are the attacks: each one fails if
 * the old body, header, or lookup comes back.
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

process.env.HUB_CATALOG_OFFLINE = 'true';
delete process.env.RECEIPT_ANCHOR_PRIVATE_KEY;
delete process.env.SOLANA_ANCHOR_SECRET_KEY;
delete process.env.SOLANA_RPC_URL;

const { createApp } = await import('../src/server.js');
const { initAIListener, getAIListener } = await import('../src/ai-listener.js');
const { getReceiptMerkleTree, resetReceiptMerkleTree } = await import('../src/receipt-merkle.js');
const {
  epochRecordClaims,
  epochRecordWithUnlogged,
  unloggedSection,
  publicEpochRecord,
} = await import('../src/receipt-log-epoch.js');
const { signJws } = await import('../src/issuer-key.js');
const { preimageField } = await import('../src/receipt-preimage.js');
const { PINNED_BASE_ANCHOR_WALLET, PINNED_SOLANA_ANCHOR_FEE_PAYERS } = await import('../src/anchor-wallets.js');

const A = 'xfuel-pub-a-11111111-1111-4111-8111-111111111111';
const B = 'xfuel-pub-b-22222222-2222-4222-8222-222222222222';
const PRE = 'xfuel-pub-pre-33333333-3333-4333-8333-333333333333';
const AGENT_B = 918273645;
const ROW_B = 'row-foreign-b-not-shared';
const WALLET_B = '0xB0B0B0B0B0B0B0B0B0B0B0B0B0B0B0B0B0B0B0B0';
const TX_A = `0x${'a1'.repeat(32)}`;
const TX_B = `0x${'b2'.repeat(32)}`;
const REF_A = `base:${TX_A}`;
// Private sentinels planted on A. None of them is a public field.
const WALLET_A = '0x9F8951CB8b060f52fdf87297b3c5B00f7aa18f52';
const AGENT_PUBKEY_A = '0xA9e9A9e9A9e9A9e9A9e9A9e9A9e9A9e9A9e9A9e9';
const API_KEY_RAW = 'sk-probe-raw-api-key-quokka';
const API_KEY_HASH = `${'7e'.repeat(31)}5a`;
const EMAIL = 'leak-probe@example.invalid';
const PROMPT_TEXT = 'prompt-probe-text-wombat';
const OUTPUT_TEXT = 'output-probe-text-numbat';
// Public by design: the payee and asset on every paid receipt.
const PAY_TO = '0x23f713411c30BBd9A989c9cbC22EB0b55F7f7334';
const ASSET = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913';
const REF_B = `base:${TX_B}`;
// Solana-shaped probes (base58): an address and a signature that are not ours.
const SOL_ADDR_PROBE = '7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU';
const SOL_SIG_PROBE = '5VERv8NMvzbJMEkV8xnrLkEaWRtSz9CosKDYjCJjBRnbJLgp8uirBgmQpjKhoR4tjF3ZpRzrFmBV6UjKdiSZkQUW';

// Leak matcher for the usage sentinels (4242, 4343). Hash-like runs are
// removed first: 0x hex, bare hex of 16+ and base64url of 24+ (JWS segments,
// log roots, ids), so a hash that happens to contain the digits is not a leak.
// What is left is matched on digit boundaries only, so letters, underscores and
// suffixes glued to the number still count, plus the grouped (4,242 / 4 242)
// and exponent (4.242e3) forms.
function stripHashLike(text) {
  return String(text)
    .replace(/0x[0-9a-fA-F]+/g, ' ')
    .replace(/[0-9a-fA-F]{16,}/g, ' ')
    .replace(/[A-Za-z0-9_-]{24,}/g, ' ');
}
function leaksNumber(text, n) {
  const d = String(n);
  const head = d.slice(0, d.length - 3);
  const tail = d.slice(-3);
  const forms = [
    `(?<![0-9])${d}(?![0-9])`,
    `(?<![0-9])${head}[,\u00a0\u202f ]${tail}(?![0-9])`,
    `(?<![0-9])${d[0]}\\.${d.slice(1)}0*[eE]\\+?${d.length - 1}(?![0-9])`,
  ];
  const clean = stripHashLike(text);
  return forms.some((f) => new RegExp(f).test(clean));
}

// Text plus the decoded payload of any compact JWS in it, so a value inside a
// signed segment is scanned too (stripHashLike drops base64url runs).
function withDecodedJws(text) {
  const parts = [String(text)];
  for (const m of String(text).matchAll(/[A-Za-z0-9_-]{8,}\.([A-Za-z0-9_-]{8,})\.[A-Za-z0-9_-]{8,}/g)) {
    try { parts.push(Buffer.from(m[1], 'base64url').toString('utf8')); } catch { /* not base64url */ }
  }
  return parts.join('\n');
}

const EMAIL_RE = /[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}/;

/**
 * Private values that no public receipt view may carry. Public by design and
 * allowed: this receipt's own signed payee, asset and payment tx, Merkle nodes
 * of the seeded log, and on log pages the signed epoch record's values and the
 * pinned anchor wallets. ALLOW is filled in before() from those signed inputs
 * only, never from the response under test, so a value planted in a body
 * cannot allow itself.
 */
const ALLOW = {
  receipt: { tx: new Set(), addr: new Set(), hash: new Set(), b58: new Set() },
  log: { tx: new Set(), addr: new Set(), hash: new Set(), b58: new Set() },
};

// Any 32- or 20-byte hex run, with or without 0x / 0X, on hex boundaries.
const HEX64_RE = /(?<![0-9a-fA-F])(?:0[xX])?[0-9a-fA-F]{64}(?![0-9a-fA-F])/g;
const HEX40_RE = /(?<![0-9a-fA-F])(?:0[xX])?[0-9a-fA-F]{40}(?![0-9a-fA-F])/g;
// Shortened addresses: 0x1234…abcd or 0x1234...abcd.
const SHORT_ADDR_RE = /0[xX]([0-9a-fA-F]{4})(?:\u2026|\.{2,3})([0-9a-fA-F]{4})(?![0-9a-fA-F])/g;
const hexNorm = (v) => String(v).replace(/^0[xX]/, '').toLowerCase();

// Solana addresses (32-44) and signatures (64-88) in base58. Compact JWS are
// scanned through their decoded payloads, so the segments themselves are
// dropped first; hex-only runs are checked as hex above.
function base58Runs(text) {
  const noJws = String(text).replace(/[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/g, ' ');
  const out = [];
  for (const m of noJws.matchAll(/[A-Za-z0-9_-]+/g)) {
    const t = m[0];
    if (!/^[1-9A-HJ-NP-Za-km-z]+$/.test(t) || /^[0-9a-fA-F]+$/.test(t)) continue;
    if ((t.length >= 32 && t.length <= 44) || (t.length >= 64 && t.length <= 88)) out.push(t);
  }
  return out;
}

// RFC 6962 node hashes over every contiguous range of the seeded leaf hashes:
// a superset of every leaf, sibling, root and consistency node the log serves.
function merkleNodes(leaves) {
  const node = (l, r) => createHash('sha256').update(Buffer.concat([Buffer.from([0x01]), l, r])).digest();
  const memo = new Map();
  const mth = (a, b) => {
    const key = `${a}:${b}`;
    if (memo.has(key)) return memo.get(key);
    let h;
    if (b - a === 1) h = Buffer.from(leaves[a]);
    else {
      let k = 1;
      while (k * 2 < b - a) k *= 2;
      h = node(mth(a, a + k), mth(a + k, b));
    }
    memo.set(key, h);
    return h;
  };
  const out = new Set();
  for (let a = 0; a < leaves.length; a++) {
    for (let b = a + 1; b <= leaves.length; b++) out.add(mth(a, b).toString('hex'));
  }
  return out;
}

function collectHex(value, allow) {
  const walk = (v) => {
    if (Array.isArray(v)) { v.forEach(walk); return; }
    if (v && typeof v === 'object') { Object.values(v).forEach(walk); return; }
    if (typeof v !== 'string') return;
    for (const m of v.matchAll(HEX64_RE)) allow.hash.add(hexNorm(m[0]));
    for (const m of v.matchAll(HEX40_RE)) allow.addr.add(hexNorm(m[0]));
  };
  walk(value);
}

// The payer wallet, agent key, raw key and planted texts of receipt A, plus
// receipt B's values. Checked on every public route, including static ones.
function assertNoSentinels(text, label) {
  const hay = withDecodedJws(text);
  const lower = hay.toLowerCase();
  for (const n of [4242, 4343, 8585]) {
    assert.equal(leaksNumber(hay, n), false, `${label} carries usage ${n}`);
  }
  assert.equal(lower.includes(hexNorm(WALLET_A)), false, `${label} carries the payer wallet`);
  for (const [, a, b] of hay.matchAll(SHORT_ADDR_RE)) {
    const short = `${a}${b}`.toLowerCase();
    assert.notEqual(short, `${hexNorm(WALLET_A).slice(0, 4)}${hexNorm(WALLET_A).slice(-4)}`, `${label} carries the short payer wallet`);
  }
  assert.equal(lower.includes(hexNorm(AGENT_PUBKEY_A)), false, `${label} carries the agent key`);
  assert.equal(hay.includes(API_KEY_RAW), false, `${label} carries the raw API key`);
  assert.equal(lower.includes(API_KEY_HASH), false, `${label} carries the API key hash`);
  assert.equal(hay.includes(EMAIL), false, `${label} carries the planted email`);
  assert.equal(hay.includes(PROMPT_TEXT), false, `${label} carries prompt text`);
  assert.equal(hay.includes(OUTPUT_TEXT), false, `${label} carries output text`);
  assert.equal(hay.includes(B), false, `${label} names the other task`);
  assert.equal(hay.includes(ROW_B), false, `${label} names the other row`);
  assert.equal(lower.includes(hexNorm(WALLET_B)), false, `${label} names the other wallet`);
  assert.equal(lower.includes(hexNorm(TX_B)), false, `${label} names the other payment`);
}

function assertNoPrivate(text, label, { scope = 'receipt' } = {}) {
  const allow = ALLOW[scope];
  assert.ok(allow && allow.tx.size > 0 && allow.addr.size > 0 && allow.hash.size > 0, `${label}: allow list not built`);
  assertNoSentinels(text, label);
  const hay = withDecodedJws(text);
  assert.equal(EMAIL_RE.test(hay), false, `${label} carries an email address`);
  assert.equal(/\b[A-Za-z0-9._%+-]+\s*(?:\(at\)|\[at\]|\sat\s)\s*[A-Za-z0-9-]+\s*(?:\(dot\)|\[dot\]|\sdot\s)\s*[A-Za-z]{2,}\b/i.test(hay), false, `${label} carries a spelled-out email`);
  assert.equal(/\bsk-[A-Za-z0-9_-]{12,}/.test(hay), false, `${label} carries an API key`);
  for (const key of ['caller_binding', 'payer_wallet', 'agent_pubkey', 'api_key_hash', 'prompt_tokens', 'total_tokens',
    'callerBinding', 'payerWallet', 'agentPubkey', 'apiKeyHash', 'apiKey', 'promptTokens', 'totalTokens', 'desk_']) {
    assert.equal(hay.includes(key), false, `${label} names ${key}`);
  }
  // Every 32-byte value must be an allowed tx or log hash; every 20-byte one an allowed address.
  for (const m of hay.matchAll(HEX64_RE)) {
    const v = hexNorm(m[0]);
    assert.equal(allow.tx.has(v) || allow.hash.has(v), true, `${label} carries 32-byte value ${m[0].slice(0, 10)}…`);
  }
  for (const m of hay.matchAll(HEX40_RE)) {
    assert.equal(allow.addr.has(hexNorm(m[0])), true, `${label} carries address ${m[0].slice(0, 8)}…`);
  }
  // The page shortens its own payee, asset and tx for display; nothing else.
  const shorts = new Set([...allow.addr, ...allow.tx].map((a) => `${a.slice(0, 4)}${a.slice(-4)}`));
  for (const [whole, a, b] of hay.matchAll(SHORT_ADDR_RE)) {
    assert.equal(shorts.has(`${a}${b}`.toLowerCase()), true, `${label} carries short address ${whole}`);
  }
  for (const t of base58Runs(hay)) {
    assert.equal(allow.b58.has(t), true, `${label} carries base58 value ${t.slice(0, 6)}…`);
  }
}

let server;
let base;
let httpApp;
const planted = [];

function leafHash(body) {
  return createHash('sha256').update(Buffer.concat([Buffer.from([0x00]), Buffer.from(body)])).digest('hex');
}

function paidTask(taskId, ref, agentId, wallet) {
  return {
    taskId,
    status: 'completed',
    createdAt: 1_790_432_737_000,
    updatedAt: 1_790_432_738_000,
    intent: {
      type: 'inference_request',
      paymentRail: 'usdc',
      paymentRef: ref,
      amount: '2000',
      modelId: 'akash/meta-llama/Llama-3.3-70B-Instruct',
    },
    meta: {
      payerWallet: wallet,
      payTo: PAY_TO,
      paymentAsset: ASSET,
      provider: 'akash-network',
      chain: 'base',
      agentId,
    },
    result: {
      provider: 'akash-network',
      model: 'akash/meta-llama/Llama-3.3-70B-Instruct',
    },
  };
}

before(async () => {
  resetReceiptMerkleTree();
  await initAIListener();
  const store = getAIListener().activeTasks;
  httpApp = await createApp();
  const tree = getReceiptMerkleTree();
  const ledger = httpApp.locals.__test.usageSettled;
  const plant = async (taskId, rowHash, ref, agentId, wallet) => {
    await tree.appendReceipt(taskId, rowHash, { publish: false });
    store.set(taskId, paidTask(taskId, ref, agentId, wallet));
    planted.push(taskId);
  };
  await plant(A, 'row-own-a', REF_A, 187, WALLET_A);
  await plant(B, ROW_B, REF_B, AGENT_B, WALLET_B);
  store.set(PRE, paidTask(PRE, `base:0x${'c3'.repeat(32)}`, 188, '0x1111111111111111111111111111111111111111'));
  planted.push(PRE);
  const taskA = store.get(A);
  taskA.usage = { prompt_tokens: 4242, completion_tokens: 4343, total_tokens: 8585, source: 'provider' };
  taskA.meta.requestedModel = 'xfuel/auto';
  taskA.meta.agentPubkey = AGENT_PUBKEY_A;
  taskA.meta.apiKey = API_KEY_RAW;
  taskA.meta.apiKeyHash = API_KEY_HASH;
  taskA.meta.email = EMAIL;
  taskA.intent.prompt = PROMPT_TEXT;
  taskA.intent.messages = [{ role: 'user', content: PROMPT_TEXT }];
  taskA.request = { messages: [{ role: 'user', content: PROMPT_TEXT }] };
  taskA.result.output = OUTPUT_TEXT;
  taskA.result.content = OUTPUT_TEXT;
  taskA.meta.modelSubstituted = true;
  taskA.meta.providerCogs = {
    provider: 'akash-network',
    float_id: 'akash-network',
    estimated: '12',
    actual: '12',
    basis: 'measured',
    below_low_water: true,
  };
  await ledger._index({
    task_id: A,
    agent_id: 187,
    evidence: 'collected',
    amount: '2000',
    collected_at: '2026-09-05T17:14:11.000Z',
  }, { persist: false, notify: false });
  const claims = epochRecordWithUnlogged(epochRecordClaims(), [
    { task_id: B, agent_id: AGENT_B, reason: 'forked' },
  ]);
  const { jws, kid } = signJws(claims, { typ: 'chit402-tree-epoch+jwt' });
  tree.epochRecord = { ...claims, issuer_signature: { jws, kid } };
  await new Promise((resolve) => {
    server = httpApp.listen(0, '127.0.0.1', () => {
      base = `http://127.0.0.1:${server.address().port}`;
      resolve();
    });
  });

  // Allow lists from signed inputs only (see ALLOW).
  const { buildReceipt } = await import('../src/receipt.js');
  const ownerA = await buildReceipt(store.get(A), { baseUrl: base, readOnly: true });
  const signedA = JSON.parse(Buffer.from(ownerA.issuer_signature.jws.split('.')[1], 'base64url').toString('utf8'));
  const r = ALLOW.receipt;
  r.tx.add(hexNorm(String(signedA.payment.ref).replace(/^base:/, '')));
  r.addr.add(hexNorm(signedA.payment.payee));
  r.addr.add(hexNorm(signedA.payment.asset));
  for (const h of merkleNodes(tree.leaves)) r.hash.add(h);
  r.b58.add(ownerA.issuer_signature.kid);
  r.b58.add(kid);
  const l = ALLOW.log;
  for (const k of Object.keys(r)) for (const v of r[k]) l[k].add(v);
  const signedEpoch = JSON.parse(Buffer.from(jws.split('.')[1], 'base64url').toString('utf8'));
  collectHex(signedEpoch, l);
  l.addr.add(hexNorm(PINNED_BASE_ANCHOR_WALLET));
  for (const p of PINNED_SOLANA_ANCHOR_FEE_PAYERS) l.b58.add(p);
});

after(async () => {
  if (server) await new Promise((resolve) => server.close(resolve));
  try {
    const store = getAIListener().activeTasks;
    for (const id of planted) store.delete(id);
  } catch { /* listener already down */ }
  resetReceiptMerkleTree();
});

async function fetchText(path, headers = {}) {
  const res = await fetch(`${base}${path}`, { headers, redirect: 'manual' });
  const text = await res.text();
  return { status: res.status, text, headers: res.headers };
}

function assertNoForeign(text, label) {
  const hay = String(text);
  assert.equal(hay.includes(B), false, `${label} names the other task`);
  assert.equal(hay.includes(String(AGENT_B)), false, `${label} names the other agent`);
  assert.equal(hay.includes(ROW_B), false, `${label} names the other row`);
  assert.equal(hay.includes(WALLET_B), false, `${label} names the other wallet`);
  assert.equal(hay.includes(TX_B), false, `${label} names the other payment`);
  assert.equal(hay.includes(`${B}|${ROW_B}`), false, `${label} names the other leaf body`);
}

function assertPrivateNegotiated(res, label) {
  const cc = res.headers.get('cache-control') || '';
  assert.match(cc, /private/, label);
  assert.match(cc, /no-store/, label);
  assert.match(res.headers.get('vary') || '', /accept/i, label);
}

test('prototype field names are not a preimage', () => {
  const fields = { payload_hash: { preimage_utf8: 'own' } };
  assert.equal(preimageField({ fields }, '__proto__'), null);
  assert.equal(preimageField({ fields }, 'constructor'), null);
  assert.equal(preimageField({ fields }, 'prototype'), null);
  assert.equal(preimageField({ fields }, 'toString'), null);
  assert.equal(preimageField({ fields }, 'payload_hash').preimage_utf8, 'own');
  const viaProto = Object.create({ inherited: { preimage_utf8: 'nope' } });
  viaProto.payload_hash = { preimage_utf8: 'own' };
  assert.equal(preimageField({ fields: viaProto }, 'inherited'), null);
});

test('a version 2 row list is not served as an unsigned stub', () => {
  const rows = [{ task_id: B, agent_id: AGENT_B, reason: 'forked' }];
  const legacy = { ...epochRecordClaims(), payload_version: 2, unlogged: unloggedSection(rows) };
  assert.equal(publicEpochRecord(legacy), null);
  const v1 = {
    ...epochRecordClaims(),
    issuer_signature: { jws: 'v1-header.v1-payload.v1-sig', kid: 'k' },
  };
  const served = publicEpochRecord(legacy, v1);
  assert.equal(served, v1);
  assert.equal(served.issuer_signature.jws, v1.issuer_signature.jws);
  assert.equal(JSON.stringify(served).includes(B), false);
  assert.equal(JSON.stringify(served).includes('withheld'), false);
});

test('?tx= cannot serve another receipt under this id', async () => {
  const swapped = await fetchText(`/receipt/${A}?format=json&tx=${TX_B}`);
  assert.equal(swapped.status, 404, swapped.text.slice(0, 180));
  assert.deepEqual(JSON.parse(swapped.text), { error: 'not_found' });
  assertNoForeign(swapped.text, 'tx swap');

  const missing = await fetchText(`/receipt/xfuel-does-not-exist?format=json&tx=${encodeURIComponent(REF_B)}`);
  assert.equal(missing.status, 404);
  assert.deepEqual(JSON.parse(missing.text), { error: 'not_found' });
  assertNoForeign(missing.text, 'tx fallback');

  const own = await fetchText(`/receipt/${A}?format=json&tx=${encodeURIComponent(REF_A)}`);
  assert.equal(own.status, 200, own.text.slice(0, 180));
  assert.equal(JSON.parse(own.text).task_id, A);
  assertNoForeign(own.text, 'own tx');

  const bare = await fetchText(`/receipt/${A}?format=json&tx=${TX_A}`);
  assert.equal(bare.status, 200, bare.text.slice(0, 120));
  assert.equal(JSON.parse(bare.text).task_id, A);

  for (const flag of ['ref', 'task_id']) {
    const other = await fetchText(`/receipt/${A}?format=json&${flag}=${B}`);
    assert.equal(other.status, 200, flag);
    assert.equal(JSON.parse(other.text).task_id, A);
    assertNoForeign(other.text, flag);
  }
});

test('error bodies are fixed and do not echo the request', async () => {
  const nasty = '<script>alert(1)</script>';
  const probes = [
    [`/receipt/${encodeURIComponent(nasty)}?format=json`, 404],
    [`/receipt/${encodeURIComponent(nasty)}`, 404],
    [`/receipt/${'z'.repeat(4000)}?format=json`, 404],
    [`/receipt/${A}/preimage/${encodeURIComponent(nasty)}`, 404],
    [`/receipt/${A}/preimage/__proto__`, 404],
    [`/receipt/${A}/preimage/constructor`, 404],
    [`/refusal/${encodeURIComponent(nasty)}?format=json`, 404],
    [`/refusal/${encodeURIComponent(nasty)}`, 404],
    [`/receipt/by-tx?tx=${encodeURIComponent(nasty)}&format=json`, 404],
    ['/this-route-is-not-real', 404],
    [`/v1/receipts/${encodeURIComponent(nasty)}/inclusion`, 404],
  ];
  for (const [path, status] of probes) {
    const res = await fetchText(path);
    assert.equal(res.status, status, `${path} ${res.status} ${res.text.slice(0, 120)}`);
    assert.equal(res.text.includes(nasty), false, path);
    assert.equal(res.text.includes('<script>'), false, path);
    assert.equal(res.text.includes('alert(1)'), false, path);
    assert.equal(res.text.includes('z'.repeat(80)), false, path);
    assert.equal(res.text.includes('Available:'), false, path);
    assert.equal(res.text.includes('POST /task-request'), false, path);
    assert.equal(res.text.includes('__proto__'), false, path);
    assert.ok(res.text.length < 2500, `${path} body is ${res.text.length} bytes`);
    if (path.endsWith('/inclusion')) {
      assert.deepEqual(JSON.parse(res.text), { error: 'not_in_tree' });
    }
  }
  const proto = await fetchText(`/receipt/${A}/preimage/__proto__`);
  assert.notEqual(proto.text.trim(), '{}');
  assert.deepEqual(JSON.parse(proto.text), { error: 'not_found' });
});

test('a thrown refusal error does not return err.message', async () => {
  const ledger = httpApp.locals.__test.usageSettled;
  const original = ledger.findByRefusal.bind(ledger);
  const secret = 'ENOENT /var/lib/chit-secret-refusal-path';
  ledger.findByRefusal = () => {
    throw new Error(secret);
  };
  try {
    for (const path of [
      '/refusal/any-id?format=json',
      '/refusal/any-id/preimage',
      '/refusal/any-id/preimage/nonce',
    ]) {
      const res = await fetchText(path);
      assert.equal(res.status, 500, `${path} ${res.text}`);
      assert.equal(res.text.includes(secret), false, path);
      assert.equal(res.text.includes('ENOENT'), false, path);
      assert.equal(res.text.includes('/var/lib'), false, path);
      const body = JSON.parse(res.text);
      assert.equal(body.error, 'internal');
      assert.equal(typeof body.code, 'string');
      assert.equal(body.message, undefined);
      assert.match(res.headers.get('cache-control') || '', /no-store/);
    }
  } finally {
    ledger.findByRefusal = original;
  }
});

test('the listed public 500 handlers do not interpolate err.message', () => {
  const src = readFileSync(fileURLToPath(new URL('../src/server.js', import.meta.url)), 'utf8');
  for (const label of [
    'GET /refusal/:refusalId error',
    'GET /refusal preimage error',
    'GET /refusal preimage field error',
    'GET issuer-history error',
    'GET anchor-wallets error',
    'GET /.well-known/agent-card.json error',
    'inclusion error',
  ]) {
    const at = src.indexOf(label);
    assert.ok(at > 0, label);
    const window = src.slice(at, at + 280);
    assert.equal(window.includes('err.message'), false, window);
  }
});

test('consistency rejects a leading zero the way a tree size does', async () => {
  const ok = await fetchText('/v1/receipts/tree/consistency?first=1&second=2');
  assert.equal(ok.status, 200, ok.text.slice(0, 160));
  for (const q of ['first=01&second=2', 'first=1&second=02', 'first=01&second=03', 'first=1e2&second=2', 'first=+1&second=2', 'first=0&second=1', 'first=%201&second=2', 'first=1%20&second=2']) {
    const res = await fetchText(`/v1/receipts/tree/consistency?${q}`);
    assert.equal(res.status, 400, `${q} ${res.status} ${res.text}`);
    assert.deepEqual(JSON.parse(res.text), { error: 'bad_tree_size' });
    assert.equal(res.text.includes('01'), false, q);
  }
  for (const q of ['first=1&second=2&epoch=01', 'first=1&second=2&epoch=%201', 'first=1&second=2&epoch=1e2']) {
    const res = await fetchText(`/v1/receipts/tree/consistency?${q}`);
    assert.equal(res.status, 400, `${q} ${res.status} ${res.text}`);
    assert.deepEqual(JSON.parse(res.text), { error: 'bad_epoch' });
    assert.equal(res.text.includes('01'), false, q);
  }
  const epochPath = await fetchText('/v1/receipts/tree/epoch/01/head');
  assert.equal(epochPath.status, 400, epochPath.text);
  assert.deepEqual(JSON.parse(epochPath.text), { error: 'bad_epoch' });
  assert.equal(epochPath.text.includes('01'), false);
  for (const q of ['tree_size=01', 'tree_size=+1', 'tree_size=1e2', 'tree_size=0', 'tree_size=02']) {
    const res = await fetchText(`/v1/receipts/${A}/inclusion?${q}`);
    assert.equal(res.status, 400, `${q} ${res.status} ${res.text}`);
    assert.equal(JSON.parse(res.text).error, 'bad_tree_size');
    assert.equal(res.text.includes(A), false, q);
    assert.equal(res.text.includes('01'), false, q);
    assertNoForeign(res.text, q);
  }
});

test('an inclusion failure does not return err.message or another agent', async () => {
  const tree = getReceiptMerkleTree();
  const original = tree.inclusion.bind(tree);
  const secret = 'ENOENT /var/lib/chit-secret-inclusion-path';
  tree.inclusion = () => {
    throw new Error(secret);
  };
  try {
    const res = await fetchText(`/v1/receipts/${A}/inclusion`);
    assert.equal(res.status, 500, res.text);
    assert.equal(res.text.includes(secret), false);
    assert.equal(res.text.includes('ENOENT'), false);
    assert.equal(res.text.includes(A), false);
    assert.deepEqual(JSON.parse(res.text), { error: 'internal', code: 'inclusion_failed' });
    assertNoForeign(res.text, 'inclusion 500');
  } finally {
    tree.inclusion = original;
  }
  const missing = await fetchText('/v1/receipts/xfuel-not-a-leaf/inclusion');
  assert.equal(missing.status, 404);
  assert.deepEqual(JSON.parse(missing.text), { error: 'not_in_tree' });
  assertNoForeign(missing.text, 'unlogged inclusion');
});

test('negotiated receipt responses are private and preimages do not publish the other leaf', async () => {
  const negotiated = [
    [`/receipt/${A}`, { Accept: 'text/html' }],
    [`/receipt/${A}`, { Accept: 'application/json' }],
    [`/receipt/${A}`, { Accept: '*/*' }],
    [`/receipt/${A}`, { Accept: 'application/json;q=0.1, text/html' }],
    [`/receipt/${A}`, {}],
    [`/receipt/${A}?format=json`, { Accept: 'text/html' }],
    [`/receipt/${A}?format=auditor`, {}],
    [`/receipt/${A}?format=auditor&view=html`, {}],
    [`/receipt/${A}.json`, {}],
    [`/receipt/by-tx?tx=${TX_A}&format=json`, {}],
    [`/refusal/missing-refusal`, { Accept: 'text/html' }],
    [`/refusal/missing-refusal?format=json`, {}],
  ];
  for (const [path, headers] of negotiated) {
    const res = await fetchText(path, headers);
    assertPrivateNegotiated(res, path);
    assertNoForeign(res.text, path);
    if (res.status === 200 && path.startsWith(`/receipt/${A}`) && !path.includes('auditor')) {
      assert.equal(res.text.includes(A) || res.text.includes('chit-pub-a'), true, path);
    }
  }

  const field = await fetchText(`/receipt/${A}/preimage/tree_head_hash`);
  assert.equal(field.status, 404, field.text.slice(0, 160));
  assert.deepEqual(JSON.parse(field.text), { error: 'not_found' });
  assert.match(field.headers.get('cache-control') || '', /private/);
  assert.match(field.headers.get('cache-control') || '', /no-store/);
  assertNoForeign(field.text, 'field preimage');

  const canonical = await fetchText(`/receipt/${A}/preimage`);
  assertNoForeign(canonical.text, 'canonical preimage');
  assert.equal(canonical.status, 200, canonical.text.slice(0, 160));
  assert.match(canonical.headers.get('cache-control') || '', /private/);
  assert.match(canonical.headers.get('cache-control') || '', /no-store/);
  const shellDoc = JSON.parse(canonical.text);
  assert.equal(shellDoc.schema, 'chit402.receipt_shell.v1');

  const card = await fetchText(`/receipt/${A}/og.png`);
  assert.equal(card.status, 200, card.text.slice(0, 80));
  assert.match(card.headers.get('cache-control') || '', /private/);
  assert.match(card.headers.get('cache-control') || '', /no-store/);
  assert.equal(card.headers.get('cache-control').includes('immutable'), false);
  assertNoForeign(card.text, 'og.png');

  const epoch = await fetchText('/v1/receipts/tree/epoch');
  assert.equal(epoch.status, 200);
  assertNoForeign(epoch.text, 'epoch');
  const epochDoc = JSON.parse(epoch.text);
  assert.equal(epochDoc.unlogged.rows, undefined);
  assert.equal(epochDoc.unlogged.count, 1);
  assert.match(epochDoc.unlogged.commitment, /^[0-9a-f]{64}$/);
  assert.match(epoch.headers.get('cache-control') || '', /no-store/);

  const inclusion = await fetchText(`/v1/receipts/${A}/inclusion`);
  assert.equal(inclusion.status, 200, inclusion.text.slice(0, 160));
  assertNoForeign(inclusion.text, 'inclusion');
  assert.match(inclusion.headers.get('cache-control') || '', /no-store/);

  const missingInclusion = await fetchText('/v1/receipts/not-a-leaf/inclusion');
  assert.deepEqual(JSON.parse(missingInclusion.text), { error: 'not_in_tree' });
  assertNoForeign(missingInclusion.text, 'inclusion 404');
});

test('a disclosing epoch record serves the last signed v1 or 404', async () => {
  const tree = getReceiptMerkleTree();
  const saved = tree.epochRecord;
  const savedV1 = tree.epochRecordV1;
  const v2 = {
    ...epochRecordClaims(),
    payload_version: 2,
    unlogged: unloggedSection([{ task_id: B, agent_id: AGENT_B, reason: 'forked' }]),
    issuer_signature: { jws: 'v2.payload.sig', kid: 'k2' },
  };
  try {
    tree.epochRecord = v2;
    tree.epochRecordV1 = null;
    const missing = await fetchText('/v1/receipts/tree/epoch');
    assert.equal(missing.status, 404, missing.text);
    assert.deepEqual(JSON.parse(missing.text), { error: 'not_found' });
    assert.equal(missing.text.includes('withheld'), false);
    assert.equal(missing.text.includes(B), false);
    assertNoForeign(missing.text, 'epoch 404');

    const v1 = {
      ...epochRecordClaims(),
      issuer_signature: { jws: 'v1-header.v1-payload.v1-sig', kid: 'k1' },
    };
    tree.epochRecordV1 = v1;
    const served = await fetchText('/v1/receipts/tree/epoch');
    assert.equal(served.status, 200, served.text.slice(0, 180));
    const body = JSON.parse(served.text);
    assert.equal(body.issuer_signature.jws, v1.issuer_signature.jws);
    assert.equal(body.payload_version, 1);
    assert.equal(body.unlogged, undefined);
    assert.equal(body.status, undefined);
    assert.equal(served.text.includes('withheld'), false);
    assertNoForeign(served.text, 'epoch v1');
  } finally {
    tree.epochRecord = saved;
    tree.epochRecordV1 = savedV1;
  }
});

test('a public shell preimage is not publicly cacheable', async () => {
  const pre = await fetchText(`/receipt/${PRE}/preimage`);
  assert.equal(pre.status, 200, pre.text.slice(0, 180));
  assert.match(pre.headers.get('cache-control') || '', /private/);
  assert.match(pre.headers.get('cache-control') || '', /no-store/);
  assert.equal((pre.headers.get('cache-control') || '').includes('max-age=300'), false);
  const meta = await fetchText(`/receipt/${PRE}/preimage?meta=1`);
  assert.equal(meta.status, 200, meta.text.slice(0, 120));
  assert.match(meta.headers.get('cache-control') || '', /no-store/);
  const leafed = await fetchText(`/receipt/${A}/preimage`);
  assert.equal(leafed.status, 200, leafed.text.slice(0, 160));
  assert.match(leafed.headers.get('cache-control') || '', /private/);
  assert.match(leafed.headers.get('cache-control') || '', /no-store/);
  assert.equal((leafed.headers.get('cache-control') || '').includes('max-age=300'), false);
});

test('leak matcher: catches glued and formatted sentinels, ignores hashes', () => {
  const caught = [
    '4242', '"prompt_tokens":4242', '4242.00', '0.4242', 'id-4242-x',
    'amt4242usd', 'tok4242', '_4242_', '4242n', '4,242', '4 242', '4.242e3', '4.242E+3',
    '<td>4242</td>', 'tokens=4242&x=1',
  ];
  for (const plant of caught) {
    assert.equal(leaksNumber(`before ${plant} after`, 4242), true, `missed ${plant}`);
  }
  assert.equal(leaksNumber('x4343y', 4343), true);
  assert.equal(leaksNumber('4,343', 4343), true);
  const clean = [
    '42420', '14242', '424.2', '0.004242e9',
    // Hash-like runs that contain the digits are not leaks.
    `root ${'54dfe1b5ca3419b1642425d3'}${'0'.repeat(40)}`,
    `0x${'ab'.repeat(10)}4242${'cd'.repeat(10)}`,
    `chit-${'f'.repeat(12)}4242${'e'.repeat(12)}`,
    `eyJhbGciOiJFUzI1NiJ9.eyJ2IjoxMSwiYW1vdW50Ijo${'4242'}xQnZ9.sig${'A'.repeat(40)}`,
  ];
  for (const text of clean) {
    assert.equal(leaksNumber(text, 4242), false, `false positive on ${text}`);
  }
  // A leak next to a hash is still caught.
  assert.equal(leaksNumber(`${'a1'.repeat(32)} amt4242usd`, 4242), true);
  // A value inside a JWS payload segment is scanned after decoding.
  const seg = Buffer.from(JSON.stringify({ caller_binding: { payer_wallet: WALLET_A } })).toString('base64url');
  const inJws = `eyJhbGciOiJFUzI1NiJ9.${seg}.${'S'.repeat(86)}`;
  assert.equal(inJws.toLowerCase().includes(WALLET_A.toLowerCase()), false);
  assert.throws(() => assertNoPrivate(inJws, 'jws'), /payer wallet/);
});

test('allow lists come from signed inputs, and each value class is caught', () => {
  const other40 = 'c4'.repeat(20);
  const other64 = 'e6'.repeat(32);
  const throwsOn = (text, scope, re, what) => assert.throws(() => assertNoPrivate(text, 'probe', { scope }), re, `missed ${what}`);
  // Clean: this receipt's signed payee, asset and tx, their display forms, and log nodes.
  const root = [...ALLOW.receipt.hash][0];
  const clean = JSON.stringify({ pay_to: PAY_TO, asset: ASSET, payment_tx: TX_A, root, short: `${PAY_TO.slice(0, 6)}…${PAY_TO.slice(-4)}`, txs: `${TX_A.slice(0, 6)}...${TX_A.slice(-4)}` });
  assertNoPrivate(clean, 'clean');
  assertNoPrivate(`${clean} ${TX_A.slice(2).toUpperCase()} ${PAY_TO.slice(2)} 0X${ASSET.slice(2).toUpperCase()}`, 'clean case and prefix forms');
  // F2: bare and 0X hex.
  throwsOn(`x 0X${other40.toUpperCase()} y`, 'receipt', /carries address/, '0X upper address');
  throwsOn(`"a":"${other40}"`, 'receipt', /carries address/, 'bare 40-hex');
  throwsOn(`"a":"${other64}"`, 'receipt', /32-byte value/, 'bare 64-hex');
  throwsOn(`"a":"0X${other64.toUpperCase()}"`, 'receipt', /32-byte value/, '0X 64-hex');
  throwsOn(`"a":"${WALLET_A.slice(2)}"`, 'receipt', /payer wallet/, 'bare payer wallet');
  throwsOn(`"a":"0x${'0'.repeat(24)}${WALLET_A.slice(2)}"`, 'receipt', /payer wallet/, 'zero-padded payer wallet');
  throwsOn(`paid by ${WALLET_A.slice(0, 6)}...${WALLET_A.slice(-4)}`, 'receipt', /short payer wallet/, 'ASCII-dot short payer');
  throwsOn(`paid by 0x${other40.slice(0, 4)}…${other40.slice(-4)}`, 'receipt', /short address/, 'short other address');
  // F3: Solana.
  throwsOn(`"payer":"${SOL_ADDR_PROBE}"`, 'receipt', /base58/, 'Solana address');
  throwsOn(`"sig":"${SOL_SIG_PROBE}"`, 'log', /base58/, 'Solana signature');
  assertNoPrivate(`"fee_payer":"${PINNED_SOLANA_ANCHOR_FEE_PAYERS[0]}"`, 'pinned fee payer on a log page', { scope: 'log' });
  throwsOn(`"fee_payer":"${PINNED_SOLANA_ANCHOR_FEE_PAYERS[0]}"`, 'receipt', /base58/, 'fee payer outside the log');
  // F1: a tx under an anchor key does not allow itself.
  for (const key of ['anchor_tx', 'base_tx', 'payment_tx', 'last_anchored_tx']) {
    throwsOn(JSON.stringify({ [key]: `0x${other64}` }), 'log', /32-byte value/, `foreign ${key}`);
  }
  // F4: the payee is this receipt's signed payee, not any constant.
  throwsOn(JSON.stringify({ pay_to: `0x${other40}` }), 'receipt', /carries address/, 'other payee');
  throwsOn(JSON.stringify({ pay_to: PINNED_BASE_ANCHOR_WALLET }), 'receipt', /carries address/, 'anchor wallet as payee');
  assertNoPrivate(JSON.stringify({ wallet: PINNED_BASE_ANCHOR_WALLET }), 'anchor wallet on a log page', { scope: 'log' });
  // Names, keys and spelled-out emails.
  throwsOn('{"callerBinding":{}}', 'receipt', /callerBinding/, 'callerBinding');
  throwsOn('{"desk_notes":"x"}', 'receipt', /desk_/, 'desk_notes');
  throwsOn('reach ops at example dot com', 'receipt', /spelled-out email/, 'spelled-out email');
  throwsOn('key sk-live-abcdef0123456789', 'receipt', /API key/, 'other API key');
  // JWS segments and kids are not Solana values.
  const seg = Buffer.from('{"a":1}').toString('base64url');
  assertNoPrivate(`eyJhbGciOiJFUzI1NiJ9.${seg}.${'S'.repeat(86)}`, 'jws segment');
  assertNoPrivate(`"receipt_id":"${A}"`, 'receipt id');
});

test('public receipt views drop unsigned token, route, stamp, and float fields', async () => {
  const { redactPublicReceipt } = await import('../src/receipt.js');
  const stamped = redactPublicReceipt({
    task_id: A,
    issuer_signature: { jws: 'keep.this.jws', payload_hash: 'abc' },
    stamp: { fee_usd: '0.002', payment_ref: 'base:0xstampfee', paid_by: 'submitter' },
    usage: { prompt_tokens: 4242, completion_tokens: 4343, total_tokens: 8585, source: 'provider' },
    route: { model: 'served', resolved: 'served', requested: 'xfuel/auto', requested_model: 'xfuel/auto', substituted: true },
    provider_cogs: { actual: '12', below_low_water: true },
  });
  assert.equal(stamped.issuer_signature.jws, 'keep.this.jws');
  assert.equal(stamped.issuer_signature.payload_hash, 'abc');
  assert.equal(stamped.stamp.fee_usd, '0.002');
  assert.equal(stamped.stamp.payment_ref, undefined);
  assert.equal(stamped.stamp.paid_by, 'submitter');
  assert.equal(stamped.usage.prompt_tokens, undefined);
  assert.equal(stamped.usage.source, 'provider');
  assert.equal(stamped.route.model, 'served');
  assert.equal(stamped.route.resolved, undefined);
  assert.equal(stamped.route.requested, undefined);
  assert.equal(stamped.provider_cogs.actual, '12');
  assert.equal(stamped.provider_cogs.below_low_water, undefined);

  const json = await fetchText(`/receipt/${A}?format=json`);
  assert.equal(json.status, 200, json.text.slice(0, 160));
  const doc = JSON.parse(json.text);
  assert.equal(doc.schema, 'chit402.receipt_shell.v1');
  assert.equal(doc.unsigned, true);
  assert.equal(doc.issuer_signature, undefined);
  assert.equal(doc.usage, undefined);
  assert.equal(doc.route, undefined);
  assert.equal(doc.provider_cogs, undefined);
  assert.equal(json.text.includes('Llama'), false);
  assert.equal(json.text.includes('xfuel/auto'), false);
  assert.equal(leaksNumber(json.text, 4242), false);
  assert.equal(leaksNumber(json.text, 4343), false);
  assert.equal(leaksNumber(json.text, 8585), false);
  assert.equal(json.text.includes('below_low_water'), false);
  const again = await fetchText(`/receipt/${A}?format=json`);
  assert.equal(JSON.parse(again.text).schema, doc.schema);
  assert.equal(JSON.parse(again.text).task_id, doc.task_id);

  const html = await fetchText(`/receipt/${A}`);
  assert.equal(html.status, 200);
  assert.equal(html.text.includes('xfuel/auto'), false);
  assert.equal(leaksNumber(html.text, 4242), false);
  assert.equal(leaksNumber(html.text, 4343), false);
  assert.equal(leaksNumber(html.text, 8585), false);
  assert.equal(html.text.includes('low water'), false);
  assert.equal(html.text.includes('below_low_water'), false);

  const auditor = await fetchText(`/receipt/${A}?format=auditor`);
  assert.equal(auditor.status, 200, auditor.text.slice(0, 120));
  assert.equal(auditor.text.includes('xfuel/auto'), false);
  assert.equal(leaksNumber(auditor.text, 4242), false);
  assert.equal(leaksNumber(auditor.text, 4343), false);
  assert.equal(leaksNumber(auditor.text, 8585), false);
  assert.equal(auditor.text.includes('below_low_water'), false);

  const card = await fetchText(`/receipt/${A}/og.png`);
  assert.equal(card.status, 200);
  assert.equal(card.text.includes('xfuel/auto'), false);
  assert.equal(leaksNumber(card.text, 4242), false);
  assert.equal(leaksNumber(card.text, 4343), false);
  assert.equal(leaksNumber(card.text, 8585), false);

  const followed = await fetchText(`/receipt/by-tx?tx=${TX_A}&format=json`);
  assert.equal(followed.status, 302, followed.text);
  const loc = followed.headers.get('location') || '';
  const canonical = await fetchText(new URL(loc).pathname + new URL(loc).search);
  assert.equal(canonical.status, 200, canonical.text.slice(0, 120));
  assert.equal(canonical.text.includes('xfuel/auto'), false);
  assert.equal(leaksNumber(canonical.text, 4242), false);
  assert.equal(leaksNumber(canonical.text, 4343), false);
  assert.equal(leaksNumber(canonical.text, 8585), false);
});

test('the planted private values reach the owner receipt (the public checks are not vacuous)', async () => {
  const { buildReceipt } = await import('../src/receipt.js');
  const receipt = await buildReceipt(getAIListener().activeTasks.get(A), { baseUrl: base, readOnly: true });
  const owner = JSON.stringify(receipt).toLowerCase();
  assert.equal(owner.includes(WALLET_A.toLowerCase()), true, 'payer wallet');
  assert.equal(owner.includes(AGENT_PUBKEY_A.toLowerCase()), true, 'agent key');
  assert.equal(owner.includes(API_KEY_HASH), true, 'api key hash');
  assert.equal(owner.includes('caller_binding'), true, 'caller_binding');
  assert.equal(leaksNumber(owner, 4242), true, 'usage');
  // Raw keys, emails, prompts and output never enter a receipt at all.
  assert.equal(owner.includes(API_KEY_RAW.toLowerCase()), false);
  assert.equal(owner.includes(EMAIL), false);
  assert.equal(owner.includes(PROMPT_TEXT), false);
  assert.equal(owner.includes(OUTPUT_TEXT), false);
});

test('public receipt views carry no usage, wallet, key, email, prompt, binding or foreign tx', async () => {
  const paths = [
    `/receipt/${A}`,
    `/receipt/${A}?format=json`,
    `/receipt/${A}?format=html`,
    `/receipt/${A}?format=auditor`,
    `/receipt/${A}?format=audit`,
    `/receipt/${A}?format=auditor&view=html`,
    `/receipt/${A}.json`,
    `/receipt/${A}/preimage`,
    `/receipt/${A}/preimage?meta=1`,
    `/receipt/${A}/preimage?raw=1`,
    `/v1/receipts/${A}/inclusion`,
    '/v1/receipts/tree/head',
    '/v1/receipts/tree/head?tree_size=3',
    '/v1/receipts/tree/epoch',
    `/receipt/${A}/legacy-proof`,
    `/receipt/${A}/preimage/payload_hash`,
    `/receipt/${A}/preimage/task_id`,
    '/v1/receipts/tree/consistency?first=1&second=2',
    '/v1/receipts/tree/consistency?first=2&second=3',
    '/v1/receipts/tree/consistency?first=1&second=3&epoch=1',
    '/v1/receipts/tree/epoch/1/head',
    '/v1/receipts/tree/epoch/2/head',
  ];
  const accepts = [undefined, 'text/html', 'application/json'];
  for (const path of paths) {
    for (const accept of accepts) {
      const res = await fetchText(path, accept ? { Accept: accept } : {});
      const label = `${path} accept=${accept || 'none'}`;
      assert.ok(res.status < 500, `${label} ${res.status}`);
      const logPage = path.startsWith('/v1/receipts/tree/');
      assertNoPrivate(res.text, label, { scope: logPage ? 'log' : 'receipt' });
    }
  }

  // Static public routes carry their own redacted specimens, so only receipt
  // A's private values and receipt B are checked there.
  const staticPaths = [
    '/public/specimens/hemei-stranger-export.csv',
    '/public/specimens/hemei-stranger-export.json',
    '/public/specimens/hemei-path-rotate-observe.json',
    '/public/specimens/tier2-in-proof-binding.json',
    '/public/specimens/fulfillment-foreign-research.json',
    '/public/export/hemei-treasury',
    '/public/export/hemei-treasury?format=csv',
  ];
  for (const path of staticPaths) {
    const res = await fetchText(path);
    assert.ok(res.status < 500, `${path} ${res.status}`);
    assertNoSentinels(res.text, path);
  }

  // by-tx lands on the canonical page; both forms are checked after the redirect.
  for (const q of ['', '&format=json']) {
    const hop = await fetchText(`/receipt/by-tx?tx=${TX_A}${q}`);
    assert.equal(hop.status, 302, hop.text);
    assertNoPrivate(hop.text, `by-tx redirect${q}`);
    const loc = new URL(hop.headers.get('location') || '', base);
    const canonical = await fetchText(loc.pathname + loc.search);
    assert.equal(canonical.status, 200, canonical.text.slice(0, 120));
    assertNoPrivate(canonical.text, `by-tx canonical${q}`);
  }

  // og.png is pixels: check the SVG text the route rasterizes, from the same input.
  const { buildReceipt, redactPublicReceipt } = await import('../src/receipt.js');
  const { buildReceiptOgSvg } = await import('../src/receipt-og.js');
  const receipt = await buildReceipt(getAIListener().activeTasks.get(A), { baseUrl: base, readOnly: true });
  const svg = buildReceiptOgSvg(redactPublicReceipt(receipt));
  assert.match(svg, /<svg /);
  assertNoPrivate(svg, 'og svg');
  const png = await fetchText(`/receipt/${A}/og.png`);
  assert.equal(png.status, 200);
  assertNoPrivate(png.text, 'og png bytes');
});

test('a shell with a public attestation shows only public claims and the advisory minimum', async () => {
  const { buildReceipt } = await import('../src/receipt.js');
  const { toPublicShell, renderReceiptShellHtml } = await import('../src/receipt-shell.js');
  const pa = await import('../src/public-attestation.js');
  const { VERIFIER_MIN } = await import('../src/verifier-min.js');
  const receipt = await buildReceipt(getAIListener().activeTasks.get(A), { baseUrl: base, readOnly: true });
  const shell = toPublicShell(receipt, { inclusion: null, signedHead: null });
  const claims = {
    attested_at: '2026-10-17T18:30:00.000Z',
    iss: 'chit402',
    issued_at: shell.issued_at,
    log: { epoch: 1, leaf_hash: leafHash(`${A}|row-own-a`), leaf_index: 0 },
    payment: { asset: ASSET, gross_amount: '2000', payee: PAY_TO, rail: 'usdc', ref: REF_A, settled_amount: '2000' },
    task_id: A,
  };
  const b64 = (v) => Buffer.from(v).toString('base64url');
  const jws = `${b64(JSON.stringify({ alg: 'ES256', typ: pa.PUBLIC_RECEIPT_TYP, kid: 'k' }))}.${b64(pa.publicPayloadUtf8(claims))}.${b64('s'.repeat(64))}`;
  shell.public_attestation = { jws };
  const json = JSON.stringify(shell);
  const html = renderReceiptShellHtml(shell);
  assertNoPrivate(json, 'attested shell json');
  assertNoPrivate(html, 'attested shell html');
  assert.ok(html.includes(`Signed. Check it with chit402-verify ${VERIFIER_MIN} or later: run npx chit402-verify@latest.`), 'attestation row names the minimum');
  assert.doesNotMatch(html, /0\.4\.6 or later|0\.4\.2 or later/);
  // The served shell is a fixed key list. Each key here is public by design.
  assert.deepEqual(Object.keys(shell).sort(), [
    'amount_gross', 'amount_settled', 'asset', 'chain', 'inclusion', 'issued_at', 'pay_to',
    'payload_version', 'payment_tx', 'public_attestation', 'receipt_id', 'schema', 'task_id', 'unsigned',
  ]);
});

test('published fixtures keep their verdict after unsigned fields are dropped', async () => {
  const { readFileSync } = await import('node:fs');
  const { redactPublicReceipt } = await import('../src/receipt.js');
  const { verifyReceipt } = await import('../../../packages/verify/dist/index.js');
  const dir = fileURLToPath(new URL('../../../packages/verify/test/fixtures/public/', import.meta.url));
  for (const name of ['chit-1ebc5616.json', 'chit-39af100b.json']) {
    const original = JSON.parse(readFileSync(`${dir}${name}`, 'utf8'));
    const jws = original.issuer_signature.jws;
    const redacted = redactPublicReceipt(original);
    assert.equal(redacted.issuer_signature.jws, jws, name);
    assert.equal(redacted.usage?.prompt_tokens, undefined, name);
    assert.equal(redacted.usage?.completion_tokens, undefined, name);
    assert.equal(redacted.route?.resolved, undefined, name);
    assert.equal(redacted.route?.requested, undefined, name);
    assert.equal(redacted.provider_cogs?.below_low_water, undefined, name);
    assert.equal(redacted.stamp?.payment_ref, undefined, name);
    assert.equal(original.issuer_signature.jws, jws, name);
    const before = await verifyReceipt(original, {});
    const after = await verifyReceipt(redacted, {});
    // chit402-verify 0.4.11: overall follows the shared verdict; the library
    // does not fetch the log, so a full library pass is partial (exit 2).
    assert.equal(before.overall, 'partial', name);
    assert.equal(after.overall, 'partial', name);
    assert.deepEqual(after.verdict, before.verdict, name);
    assert.equal(after.verdict.checks.signature, 'pass', name);
    assert.equal(before.issuer_signature.valid, true, name);
    assert.equal(after.issuer_signature.valid, true, name);
  }
});

test('non-receipt 500 bodies do not echo the exception', async () => {
  const src = readFileSync(fileURLToPath(new URL('../src/server.js', import.meta.url)), 'utf8');
  for (const label of [
    'GET /.well-known/x402 error',
    'GET /openapi.json error',
    'GET /stats error',
    'GET /stats/door error',
    'GET /health error',
    'book export get error',
    'book export post error',
    'book gaps error',
    'POST /task-quote error',
    'POST /task-request error',
    'POST /v1/agents/register error',
  ]) {
    const at = src.indexOf(label);
    assert.ok(at > 0, label);
    const window = src.slice(at, at + 220);
    assert.equal(window.includes('err.message'), false, window);
  }
  assert.equal(src.includes("status: 'error', message: err.message"), false);

  const secret = 'ENOENT /var/lib/chit-secret-nonreceipt';
  const tree = getReceiptMerkleTree();
  const bundle = tree.bundleStatus.bind(tree);
  tree.bundleStatus = () => { throw new Error(secret); };
  try {
    const health = await fetchText('/health');
    assert.equal(health.status, 503, health.text);
    assert.deepEqual(JSON.parse(health.text), { error: 'internal', code: 'health_failed' });
    assert.equal(health.text.includes(secret), false);
    assert.equal(health.text.includes('ENOENT'), false);
  } finally {
    tree.bundleStatus = bundle;
  }

  const store = getAIListener().activeTasks;
  const hadSnapshots = typeof store.allSnapshots === 'function';
  const snapshots = hadSnapshots ? store.allSnapshots.bind(store) : null;
  store.allSnapshots = () => ({
    [Symbol.iterator]() { throw new Error(secret); },
  });
  try {
    for (const [path, code] of [['/stats?format=json', 'stats_failed'], ['/stats/door', 'stats_door_failed']]) {
      const res = await fetchText(path);
      assert.equal(res.status, 500, `${path} ${res.text}`);
      assert.deepEqual(JSON.parse(res.text), { error: 'internal', code });
      assert.equal(res.text.includes(secret), false, path);
      assert.equal(res.text.includes('/var/lib'), false, path);
    }
  } finally {
    if (hadSnapshots) store.allSnapshots = snapshots;
    else delete store.allSnapshots;
  }

  const { getFloatManager } = await import('../src/provider-float.js');
  const floats = getFloatManager();
  const select = floats.selectForQuote.bind(floats);
  floats.selectForQuote = () => { throw new Error(secret); };
  try {
    const quote = await fetch(`${base}/task-quote`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{}',
    });
    const text = await quote.text();
    assert.equal(quote.status, 500, text.slice(0, 180));
    assert.deepEqual(JSON.parse(text), { error: 'internal', code: 'task_quote_failed' });
    assert.equal(text.includes(secret), false);
  } finally {
    floats.selectForQuote = select;
  }

  const config = (await import('../src/config.js')).default;
  const savedX402 = config.x402;
  config.x402 = new Proxy({}, { get() { throw new Error(secret); } });
  try {
    for (const [path, code] of [['/.well-known/x402', 'x402_failed'], ['/openapi.json', 'openapi_failed']]) {
      const res = await fetchText(path);
      assert.equal(res.status, 500, `${path} ${res.text.slice(0, 160)}`);
      assert.deepEqual(JSON.parse(res.text), { error: 'internal', code });
      assert.equal(res.text.includes(secret), false, path);
    }
  } finally {
    config.x402 = savedX402;
  }

  const registry = httpApp.locals.__test.agentRegistry;
  const getAgent = registry.get.bind(registry);
  registry.get = () => { throw new Error(secret); };
  try {
    for (const [path, code] of [
      ['/v1/agents/1/book/export', 'book_export_failed'],
      ['/v1/agents/1/book/gaps', 'book_gaps_failed'],
    ]) {
      const res = await fetchText(path, { 'x-xfuel-session': 'not-a-session' });
      assert.equal(res.status, 500, `${path} ${res.text.slice(0, 160)}`);
      assert.deepEqual(JSON.parse(res.text), { error: 'internal', code });
      assert.equal(res.text.includes(secret), false, path);
    }
    const posted = await fetch(`${base}/v1/agents/1/book/export`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-xfuel-session': 'not-a-session' },
      body: '{}',
    });
    const postedText = await posted.text();
    assert.equal(posted.status, 500, postedText.slice(0, 160));
    assert.deepEqual(JSON.parse(postedText), { error: 'internal', code: 'book_export_failed' });
    assert.equal(postedText.includes(secret), false);
  } finally {
    registry.get = getAgent;
  }
});

test('filesWithoutCompletion lists files that did not finish', async () => {
  const { filesWithoutCompletion } = await import('../scripts/run-tests.mjs');
  const a = '/tmp/a.test.mjs';
  const b = '/tmp/b.test.mjs';
  const both = `${JSON.stringify({ file: a, passed: true })}\n${JSON.stringify({ file: b, passed: true })}\n`;
  assert.deepEqual(filesWithoutCompletion(both, [a, b]), []);
  assert.deepEqual(filesWithoutCompletion(`${JSON.stringify({ file: a, passed: true })}\n`, [a, b]), [b]);
  assert.deepEqual(filesWithoutCompletion('', [a, b]), [a, b]);
  assert.deepEqual(
    filesWithoutCompletion(`${JSON.stringify({ file: a, passed: false })}\n{"fi`, [a, b]),
    [b],
  );
});

test('the file-done reporter records a finished file', async () => {
  const { mkdtempSync, writeFileSync, rmSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const { spawnSync } = await import('node:child_process');
  const { filesWithoutCompletion } = await import('../scripts/run-tests.mjs');
  const dir = mkdtempSync(join(tmpdir(), 'file-done-'));
  const file = join(dir, 'one.test.mjs');
  const out = join(dir, 'files.jsonl');
  writeFileSync(file, "import { test } from 'node:test';\ntest('one', () => {});\n");
  const reporter = fileURLToPath(new URL('../scripts/file-done-reporter.mjs', import.meta.url));
  const env = { ...process.env };
  delete env.NODE_TEST_CONTEXT;
  const result = spawnSync(process.execPath, [
    '--test',
    `--test-reporter=${reporter}`,
    `--test-reporter-destination=${out}`,
    file,
  ], { env, encoding: 'utf8' });
  try {
    assert.equal(result.status, 0, result.stderr || result.stdout);
    assert.deepEqual(filesWithoutCompletion(readFileSync(out, 'utf8'), [file]), []);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('public receipt routes for one id do not carry the other receipt', async () => {
  const paths = [
    `/receipt/${A}`,
    `/receipt/${A}?format=json`,
    `/receipt/${A}?format=html`,
    `/receipt/${A}?format=auditor`,
    `/receipt/${A}?format=audit`,
    `/receipt/${A}?format=auditor&view=html`,
    `/receipt/${A}.json`,
    `/receipt/${A}/preimage`,
    `/receipt/${A}/preimage?meta=1`,
    `/receipt/${A}/preimage?raw=1`,
    `/receipt/${A}/preimage/tree_head_hash`,
    `/receipt/${A}/preimage/tree_head_hash?raw=1`,
    `/receipt/${A}/preimage/no-such-field`,
    `/receipt/${A}/og.png`,
    `/v1/receipts/${A}/inclusion`,
    '/v1/receipts/tree/head',
    '/v1/receipts/tree/epoch',
    '/v1/receipts/tree/consistency?first=1&second=2',
    `/receipt/not-planted?format=json&tx=${TX_B}`,
    '/receipt/not-planted?format=json',
    '/this-route-is-not-real',
  ];
  const accepts = [undefined, 'text/html', 'application/json', '*/*', 'application/xml'];
  for (const path of paths) {
    for (const accept of accepts) {
      const headers = accept ? { Accept: accept } : {};
      const res = await fetchText(path, headers);
      assertNoForeign(res.text, `${path} accept=${accept || 'none'}`);
      assert.equal(res.text.includes(leafHash(`${B}|${ROW_B}`)) && !res.text.includes('"hash":"' + leafHash(`${B}|${ROW_B}`) + '"'), false);
    }
  }
});
