/**
 * v11 privacy: allowlist, commitments, salt confinement, and the SaltStore boot guard.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'crypto';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'node:url';
import pino from 'pino';

process.env.HUB_CATALOG_OFFLINE = 'true';
process.env.TASK_STORE_PERSIST = 'false';

const { buildReceipt, buildAuditorExport, decodeReceiptClaims, renderReceiptHtml, storedReceiptJson, stampCoveringTreeHead } = await import('../src/receipt.js');
const { issueRefusalReceipt, verifyRefusalReceipt } = await import('../src/refusal-receipt.js');
const { getReceiptMerkleTree, resetReceiptMerkleTree } = await import('../src/receipt-merkle.js');
const {
  applyRequestSaltHeader,
  bindSaltReceipt,
  bodyCommitmentHex,
  clientRequestForRefusal,
  requestDigest,
  requestSalt,
  resetIdempotencyStore,
  claimIdempotency,
} = await import('../src/request-binding.js');
const {
  EncryptedSaltStore,
  MemorySaltStore,
  SALT_RECORD_FIELDS,
  getSaltStore,
  openSaltRecord,
  resetSaltStore,
  setSaltStore,
  saltAad,
} = await import('../src/salt-store.js');
const {
  accountingOpening,
  bookRefForInternal,
  outputBytesOf,
  resetBookRefs,
  routingOpening,
  refusalOpening,
  v11Commit,
  V11_LABEL_ACCOUNTING,
  V11_LABEL_BODY,
  V11_LABEL_OUTPUT,
  V11_LABEL_REFUSAL,
  V11_LABEL_ROUTING,
  V11_SIGNED_FIELDS,
  assertExactFields,
} = await import('../src/v11-seal.js');
const { assertIssuanceOpen, assertIssuerRootStartup, _resetIssuerRootStartupState } = await import('../src/issuer-root.js');
const { _resetIssuerKey, computeJwkThumbprint, getIssuerPublicKeyJwk, initIssuerKey } = await import('../src/issuer-key.js');
const { resetIssuerHistoryStore } = await import('../src/issuer-history.js');
const { buildLegacyReceiptSet } = await import('../src/legacy-receipt-merkle.js');
const { jcsRfc8785 } = await import('../src/offer-receipt.js');
const { writeCanonicalPreimage } = await import('../src/canonical-preimage.js');
const { buildReceiptOgSvg } = await import('../src/receipt-og.js');
const { buildForeignReceipt } = await import('../src/foreign-x402-ingest.js');
const { LOG_REDACT } = await import('../src/logger.js');
const { PersistentTaskStore } = await import('../src/task-store.js');
const { UsageSettledLedger } = await import('../src/usage-settled.js');

const CHAIN = JSON.parse(fs.readFileSync(fileURLToPath(new URL('./fixtures/issuer-root-chain.json', import.meta.url)), 'utf8'));
const ROOT_ENV = [
  'ISSUER_ROOT_ENABLED', 'ISSUER_ROOT_CHAIN_ID', 'ISSUER_ROOT_REGISTRY', 'ISSUER_ROOT_SEQ',
  'ISSUER_ROOT_HASH', 'ISSUER_ROOT_STARTUP_CHECK', 'ISSUER_ROOT_RPC_URL', 'ISSUER_ROOT_RPC_URL_2',
  'ISSUER_ROOT_LEGACY_SET', 'ISSUER_PRIVATE_KEY', 'ISSUER_KEY_NOT_BEFORE', 'ISSUER_ROOT_CUTOVER',
  'ISSUER_ROOT_ALLOW_SKIP', 'NODE_ENV', 'SALT_STORE_ALLOW_EPHEMERAL', 'ISSUER_KID', 'ALLOW_EPHEMERAL_ISSUER_KEY',
];

function snapshotEnv() {
  return Object.fromEntries(ROOT_ENV.map((key) => [key, process.env[key]]));
}

function restoreEnv(prev) {
  for (const key of ROOT_ENV) {
    if (prev[key] == null) delete process.env[key];
    else process.env[key] = prev[key];
  }
  _resetIssuerKey();
  resetIssuerHistoryStore();
  _resetIssuerRootStartupState();
  resetIdempotencyStore();
  resetSaltStore();
  resetBookRefs();
  resetReceiptMerkleTree();
}

function useStableKey() {
  const { privateKey, publicKey } = crypto.generateKeyPairSync('ec', { namedCurve: 'P-256' });
  process.env.ISSUER_PRIVATE_KEY = Buffer.from(privateKey.export({ type: 'pkcs8', format: 'pem' })).toString('base64');
  process.env.ISSUER_KID = computeJwkThumbprint(publicKey.export({ format: 'jwk' }));
  process.env.ISSUER_KEY_NOT_BEFORE = '2026-09-04T08:52:05Z';
  _resetIssuerKey();
  resetIssuerHistoryStore();
}

function chainFetch() {
  return async (_url, opts) => {
    const body = JSON.parse(opts.body);
    if (body.method === 'eth_chainId') return { ok: true, json: async () => ({ result: '0x14a34' }) };
    if (body.method === 'eth_getBlockByNumber') {
      const tag = body.params[0];
      if (tag === 'finalized') {
        return { ok: true, json: async () => ({ result: { number: `0x${CHAIN.finalizedNumber.toString(16)}`, hash: CHAIN.finalizedHash } }) };
      }
      if (Number(tag) === CHAIN.frozenBlock) {
        return { ok: true, json: async () => ({ result: { number: CHAIN.frozen.blockNumber, hash: CHAIN.frozenBlockHash } }) };
      }
      throw new Error(`unexpected block ${tag}`);
    }
    if (body.method === 'eth_getLogs') {
      const topic0 = body.params[0].topics[0];
      if (topic0 === CHAIN.frozen.topics[0]) return { ok: true, json: async () => ({ result: [CHAIN.frozen] }) };
      if (topic0 === CHAIN.rootCommitted.topics[0]) return { ok: true, json: async () => ({ result: [CHAIN.rootCommitted] }) };
      return { ok: true, json: async () => ({ result: [] }) };
    }
    throw new Error(body.method);
  };
}

async function arm() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'v11-priv-'));
  const file = path.join(dir, 'set.json');
  fs.writeFileSync(file, JSON.stringify(CHAIN.legacy || buildLegacyReceiptSet([])));
  useStableKey();
  process.env.ISSUER_ROOT_ENABLED = 'true';
  process.env.ISSUER_ROOT_CHAIN_ID = 'eip155:84532';
  process.env.ISSUER_ROOT_REGISTRY = CHAIN.registry;
  process.env.ISSUER_ROOT_SEQ = CHAIN.rootSeq;
  process.env.ISSUER_ROOT_HASH = CHAIN.rootHash;
  process.env.ISSUER_ROOT_STARTUP_CHECK = 'strict';
  process.env.ISSUER_ROOT_RPC_URL = 'http://rpc.provider-a.example:9';
  process.env.ISSUER_ROOT_RPC_URL_2 = 'http://rpc.provider-b.test:10';
  process.env.ISSUER_ROOT_LEGACY_SET = file;
  delete process.env.ISSUER_ROOT_CUTOVER;
  await assertIssuerRootStartup({ fetchImpl: chainFetch(), log() {} });
}

function paidTask(taskId, { output = 'ok', agentId = 4, payer = '0x1111111111111111111111111111111111111111', body = '{"model":"xfuel/auto"}', quoted = '2000', settled = '2000', chain = 'base' } = {}) {
  const tx = chain === 'solana'
    ? '5'.repeat(87)
    : `0x${'ab'.repeat(32)}`;
  const payTo = chain === 'solana'
    ? 'CjNFTjvBhbJJd2B5ePPMHRLx1ELZpa8dwQgGL727eKww'
    : '0x2222222222222222222222222222222222222222';
  return {
    taskId,
    status: 'completed',
    createdAt: '2026-09-26T17:27:32.000Z',
    updatedAt: '2026-09-26T17:27:32.000Z',
    intent: {
      type: 'inference_request',
      paymentRail: 'usdc',
      paymentRef: `${chain}:${tx}`,
      amount: '9999',
      modelId: 'theta/qwen3',
      prompt: 'super-secret-prompt-text',
    },
    meta: {
      payerWallet: payer,
      payTo,
      provider: 'theta-edgecloud',
      agentId,
      quotedAmount: quoted,
      boundSettledAmount: settled,
    },
    result: { provider: 'theta-edgecloud', model: 'theta/qwen3', content: output },
    request: {
      method: 'POST',
      path: '/v1/chat/completions',
      body,
      idempotency_key: `idem-${taskId}`,
      nonce: null,
      payer,
    },
  };
}

function headersFrom(receipt, request) {
  const headers = {};
  applyRequestSaltHeader({
    setHeader(name, value) { headers[name.toLowerCase()] = value; },
  }, receipt, request);
  return headers;
}

test('SaltStore records are A256GCM ciphertext with no plaintext salt', () => {
  resetSaltStore();
  const memory = getSaltStore();
  assert.equal(memory.kind, 'memory');
  memory.put('rcpt-1', Buffer.from('ab'.repeat(32), 'hex'));
  const record = memory.peek('rcpt-1');
  assert.deepEqual(Object.keys(record).sort(), [...SALT_RECORD_FIELDS].sort());
  assert.equal(record.alg, 'A256GCM');
  assert.equal(Object.hasOwn(record, 'salt'), false);
  assert.equal(record.wrap_kid, 'memory-ephemeral');
  assert.equal(record.receipt_id, 'rcpt-1');
  const wrap = crypto.randomBytes(32);
  const encrypted = new EncryptedSaltStore(wrap);
  encrypted.put('rcpt-1', Buffer.from('cd'.repeat(32), 'hex'));
  const encRecord = encrypted.peek('rcpt-1');
  assert.deepEqual(Object.keys(encRecord).sort(), [...SALT_RECORD_FIELDS].sort());
  assert.equal(encRecord.alg, 'A256GCM');
  assert.equal(Object.hasOwn(encRecord, 'salt'), false);
  assert.equal(encrypted.get('rcpt-1').toString('hex'), 'cd'.repeat(32));
  const saltHex = 'cd'.repeat(32);
  assert.equal(encrypted.receiptIdForSalt(saltHex), 'rcpt-1');
  const indexKey = crypto.createHmac('sha256', wrap).update(Buffer.from(saltHex, 'hex')).digest('hex');
  assert.equal(encrypted._bySalt.has(saltHex), false);
  assert.equal(encrypted._bySalt.get(indexKey), 'rcpt-1');
  assert.throws(() => openSaltRecord({ ...encRecord, receipt_id: 'other' }, wrap));
  assert.equal(saltAad('rcpt-1').toString('utf8'), 'v11/saltrcpt-1');
});

test('production boot with the memory store refuses v11 issuance', async () => {
  const prev = snapshotEnv();
  try {
    useStableKey();
    process.env.NODE_ENV = 'production';
    process.env.ISSUER_ROOT_ENABLED = 'true';
    process.env.ISSUER_ROOT_CHAIN_ID = 'eip155:84532';
    process.env.ISSUER_ROOT_REGISTRY = CHAIN.registry;
    process.env.ISSUER_ROOT_SEQ = String(CHAIN.rootSeq);
    process.env.ISSUER_ROOT_HASH = CHAIN.rootHash;
    process.env.ISSUER_ROOT_STARTUP_CHECK = 'strict';
    process.env.ISSUER_ROOT_RPC_URL = 'http://rpc.provider-a.example:9';
    process.env.ISSUER_ROOT_RPC_URL_2 = 'http://rpc.provider-b.test:10';
    resetSaltStore();
    assert.equal(getSaltStore().kind, 'memory');
    let called = 0;
    await assert.rejects(
      () => assertIssuerRootStartup({ fetchImpl: async () => { called += 1; return { ok: false }; } }),
      /encrypted SaltStore/,
    );
    assert.equal(called, 0);
    assert.throws(() => assertIssuanceOpen(), (err) => err.code === 'salt_store_refused');
    setSaltStore(new EncryptedSaltStore(crypto.randomBytes(32)));
    assert.equal(getSaltStore().durable, false);
    assert.throws(() => assertIssuanceOpen(), (err) => err.code === 'salt_store_refused');
    setSaltStore(new EncryptedSaltStore(crypto.randomBytes(32), undefined, { durable: true }));
    assert.equal(getSaltStore().kind, 'encrypted');
    assert.equal(getSaltStore().durable, false);
    assert.equal(getSaltStore()._disk, false);
    assert.throws(() => assertIssuanceOpen(), (err) => err.code === 'salt_store_refused');
    const saltDir = fs.mkdtempSync(path.join(os.tmpdir(), 'chit-salt-durable-'));
    setSaltStore(new EncryptedSaltStore({
      dir: saltDir,
      keys: new Map([['current', crypto.randomBytes(32)]]),
      currentKid: 'current',
    }));
    assert.equal(getSaltStore().durable, true);
    assert.equal(getSaltStore()._disk, true);
    assert.doesNotThrow(() => {
      try { assertIssuanceOpen(); } catch (err) {
        if (err.code === 'salt_store_refused') throw err;
      }
    });
    setSaltStore(new MemorySaltStore());
    delete process.env.NODE_ENV;
    assert.throws(() => assertIssuanceOpen(), (err) => err.code === 'salt_store_refused');
    process.env.NODE_ENV = 'staging';
    assert.throws(() => assertIssuanceOpen(), (err) => err.code === 'salt_store_refused');
    process.env.SALT_STORE_ALLOW_EPHEMERAL = 'true';
    assert.doesNotThrow(() => {
      try { assertIssuanceOpen(); } catch (err) {
        if (err.code === 'salt_store_refused') throw err;
      }
    });
  } finally {
    restoreEnv(prev);
  }
});

test('v11 public receipt hides output, route, economics, and book ids', async () => {
  const prev = snapshotEnv();
  try {
    await arm();
    const task = paidTask('xfuel-v11-open', { output: 'ok', agentId: 4 });
    const receipt = buildReceipt(task, { signingSecret: 's', agentId: 4 });
    const claims = decodeReceiptClaims(receipt);
    assert.deepEqual(Object.keys(claims).sort(), [...V11_SIGNED_FIELDS].sort());
    assert.equal(claims.v, 11);
    assert.equal(claims.issued_at, '2026-09-26T17:27Z');
    assert.match(claims.output_commitment, /^[0-9a-f]{64}$/);
    assert.equal(claims.book_ref.length, 32);
    assert.equal(claims.amount_gross, '2000');
    assert.equal(claims.amount_settled, '2000');
    assert.equal(claims.amount_settled === '9999', false);
    const published = JSON.stringify(receipt);
    assert.equal(published.includes('"4"'), false);
    assert.equal(published.includes('theta'), false);
    assert.equal(published.includes('super-secret'), false);
    assert.equal(published.includes('"ok"'), false);
    assert.equal(Object.hasOwn(receipt, 'output'), false);
    const headers = headersFrom(receipt, task.request);
    assert.match(headers['x-chit-request-salt'], /^[0-9a-f]{64}$/);
    assert.equal(headers['cache-control'], 'private, no-store');
    const salt = headers['x-chit-request-salt'];
    assert.equal(v11Commit(salt, V11_LABEL_OUTPUT, Buffer.from('ok')), claims.output_commitment);
    assert.match(claims.accounting_commitment, /^[0-9a-f]{64}$/);
    assert.match(claims.routing_commitment, /^[0-9a-f]{64}$/);
    assert.notEqual(claims.accounting_commitment, claims.routing_commitment);
    const sameBytes = Buffer.from('ok');
    assert.notEqual(v11Commit(salt, V11_LABEL_OUTPUT, sameBytes), v11Commit(salt, V11_LABEL_BODY, sameBytes));
    const other = buildReceipt(paidTask('xfuel-v11-open-2', { output: 'ok', agentId: 4 }), { signingSecret: 's', agentId: 4 });
    assert.notEqual(other.output_commitment, receipt.output_commitment);
    assert.equal(other.book_ref, receipt.book_ref);
    const stranger = buildReceipt(paidTask('xfuel-v11-open-3', { output: 'ok', agentId: 9 }), { signingSecret: 's', agentId: 9 });
    assert.notEqual(stranger.book_ref, receipt.book_ref);
    const nums = [Number.parseInt(receipt.book_ref, 16), Number.parseInt(stranger.book_ref, 16)];
    assert.notEqual(Math.abs(nums[0] - nums[1]), 1);

    const guesses = ['', 'ok', 'pong', 'hello', '0'];
    for (let i = 0; i < 1000; i += 1) guesses.push(String(i));
    const publics = Object.values(claims).filter((value) => typeof value === 'string');
    for (const guess of guesses) {
      const hashes = [
        crypto.createHash('sha256').update(guess).digest('hex'),
        crypto.createHmac('sha256', Buffer.alloc(32)).update(guess).digest('hex'),
        crypto.createHmac('sha256', Buffer.alloc(0)).update(guess).digest('hex'),
      ];
      for (const hash of hashes) assert.equal(publics.includes(hash), false);
    }

    assert.throws(() => assertExactFields({ ...claims, provider: 'x' }, V11_SIGNED_FIELDS), /disallowed/);
    const html = renderReceiptHtml(receipt);
    assert.equal(html.includes('theta'), false);
    assert.equal(html.includes('token'), false);
    assert.equal(storedReceiptJson(receipt).provider, undefined);

    task.issuerSignature = {
      alg: 'ES256',
      kid: receipt.issuer_signature.kid,
      jws: receipt.issuer_signature.jws,
      payload_version: 11,
    };
    const again = buildReceipt(task, { signingSecret: 's', agentId: 4 });
    getReceiptMerkleTree().appendReceipt(task.taskId, 'row-later');
    const after = buildReceipt(task, { signingSecret: 's', agentId: 4 });
    assert.equal(after.issuer_signature.jws, receipt.issuer_signature.jws);
    stampCoveringTreeHead(after);
    assert.equal(after.issuer_signature.jws, receipt.issuer_signature.jws);
    resetSaltStore();
    resetIdempotencyStore();
    const restarted = buildReceipt(task, { signingSecret: 's', agentId: 4 });
    assert.equal(restarted.issuer_signature.jws, receipt.issuer_signature.jws);
    const restartedHeaders = headersFrom(restarted, task.request);
    assert.equal(restartedHeaders['x-chit-request-salt'], undefined);
    assert.equal(again.issuer_signature.jws, receipt.issuer_signature.jws);
  } finally {
    restoreEnv(prev);
  }
});

test('idempotency does not hand one principal the other salt', async () => {
  const prev = snapshotEnv();
  try {
    await arm();
    const body = '{"model":"xfuel/auto","messages":[{"role":"user","content":"hello"}]}';
    const a = paidTask('xfuel-v11-a', { body, payer: '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', agentId: 4 });
    const b = paidTask('xfuel-v11-b', { body, payer: '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb', agentId: 9 });
    a.request.idempotency_key = 'shared-key';
    b.request.idempotency_key = 'shared-key';
    const receiptA = buildReceipt(a, { signingSecret: 's', agentId: 4 });
    const saltA = headersFrom(receiptA, a.request)['x-chit-request-salt'];
    const receiptB = buildReceipt(b, { signingSecret: 's', agentId: 9 });
    const saltB = headersFrom(receiptB, b.request)['x-chit-request-salt'];
    assert.notEqual(saltA, saltB);
    assert.equal(JSON.stringify(receiptB).includes(saltA), false);
    const changed = { ...a.request, body: `${body} ` };
    const changedDigest = requestDigest(changed);
    assert.notEqual(changedDigest, receiptA.request_digest);
    assert.throws(
      () => claimIdempotency('shared-key', changedDigest, { principal: receiptA.payer }),
      (err) => err.code === 'idempotency_conflict',
    );
  } finally {
    restoreEnv(prev);
  }
});

test('refusals at different caps publish the same shape', async () => {
  const prev = snapshotEnv();
  try {
    await arm();
    const row = (id, cap) => ({
      policy_code: 'cap',
      reason: 'over cap',
      agent_id: 4,
      task_id: id,
      cap_atomic: cap,
      spent_atomic: '10',
      period_start: '2026-09-01T00:00:00Z',
      collected_at: '2026-09-26T17:27:32Z',
      seq: 3,
      request: {
        method: 'POST',
        path: '/v1/chat/completions',
        body: '{"n":1}',
        idempotency_key: id,
        nonce: null,
        payer: '0x1111111111111111111111111111111111111111',
      },
    });
    const left = issueRefusalReceipt(row('xfuel-cap-a', '100'));
    const right = issueRefusalReceipt(row('xfuel-cap-b', '999'));
    assert.equal(left.reason, 'cap_exceeded');
    assert.equal(right.reason, 'cap_exceeded');
    assert.deepEqual(Object.keys(left).sort(), Object.keys(right).sort());
    assert.equal(JSON.stringify(left).includes('"100"'), false);
    assert.equal(JSON.stringify(right).includes('"999"'), false);
    assert.equal(Object.hasOwn(left, 'cap_atomic'), false);
    assert.equal(verifyRefusalReceipt(left).valid, true);
    const salt = requestSalt(row('xfuel-cap-a', '100').request) || getSaltStore().get(left.refusal_id).toString('hex');
    const book = bookRefForInternal(4);
    assert.equal(v11Commit(salt, V11_LABEL_REFUSAL, jcsRfc8785(refusalOpening({
      cap: '100', spent: '10', period_start: '2026-09-01T00:00:00Z', book_ref: book,
    }))), left.refusal_commitment);
  } finally {
    restoreEnv(prev);
  }
});

test('disk snapshots keep the commitment and drop the prompt, salt, and output', async () => {
  const prev = snapshotEnv();
  try {
    await arm();
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'v11-disk-'));
    const store = new PersistentTaskStore({ dir, persist: true, autoFlushMs: 0 });
    const task = paidTask('xfuel-v11-disk', { output: 'plaintext-output', body: 'raw-prompt-body' });
    task.request.salt = 'cd'.repeat(32);
    store.set(task.taskId, task);
    const file = fs.readFileSync(path.join(dir, `${encodeURIComponent(task.taskId)}.json`), 'utf8');
    assert.equal(file.includes('raw-prompt-body'), false);
    assert.equal(file.includes('plaintext-output'), false);
    assert.equal(file.includes('super-secret-prompt-text'), false);
    assert.equal(file.includes('cd'.repeat(32)), false);
    const ledger = new UsageSettledLedger({ dir, persist: true });
    const recorded = ledger.recordPolicyBlocked({
      agentId: 4,
      taskId: 'xfuel-v11-disk-refusal',
      policyCode: 'cap',
      reason: 'cap',
      request: task.request,
    });
    assert.equal(recorded.ok, true);
    const line = fs.readFileSync(path.join(dir, 'usage-settled.jsonl'), 'utf8');
    assert.equal(line.includes('raw-prompt-body'), false);
    assert.equal(line.includes('plaintext-output'), false);
    assert.match(line, /request_digest|body_commitment/);
  } finally {
    restoreEnv(prev);
  }
});

test('logs redact the salt header', () => {
  const lines = [];
  const log = pino({ redact: LOG_REDACT }, { write(chunk) { lines.push(chunk); } });
  log.info({ salt: 'ab'.repeat(32), request: { salt: 'cd'.repeat(32) }, headers: { 'x-chit-request-salt': 'ef'.repeat(32) } }, 'paid');
  const text = lines.join('');
  assert.equal(text.includes('ab'.repeat(32)), false);
  assert.equal(text.includes('cd'.repeat(32)), false);
  assert.match(text, /Redacted/);
});

test('body commitment uses the v11/body subkey', () => {
  const salt = '01'.repeat(32);
  const body = 'hello';
  assert.equal(bodyCommitmentHex(salt, body), v11Commit(salt, V11_LABEL_BODY, Buffer.from(body)));
  assert.notEqual(bodyCommitmentHex(salt, body), crypto.createHmac('sha256', Buffer.from(salt, 'hex')).update(body).digest('hex'));
  assert.equal(outputBytesOf({ result: { content: 'ok' } }).toString(), 'ok');
});

function publicKeys(doc) {
  return Object.keys(doc).sort();
}

const PUBLIC_V11 = [...V11_SIGNED_FIELDS, 'issuer_signature', 'verify_url'].sort();

function capturePreimage(receipt) {
  let body = null;
  const res = {
    status() { return this; },
    set() { return this; },
    type() { return this; },
    json(obj) { body = obj; return this; },
    send(buf) { body = Buffer.isBuffer(buf) ? buf.toString('utf8') : String(buf); return this; },
  };
  writeCanonicalPreimage(res, receipt, {});
  return body;
}

test('amount_settled is the bound transfer and a short or missing value is not signed', async () => {
  const prev = snapshotEnv();
  try {
    await arm();
    const over = buildReceipt(paidTask('xfuel-v11-over', { quoted: '2000', settled: '2001' }), { signingSecret: 's', agentId: 4 });
    const overClaims = decodeReceiptClaims(over);
    assert.equal(overClaims.amount_gross, '2000');
    assert.equal(overClaims.amount_settled, '2001');
    const missing = buildReceipt(paidTask('xfuel-v11-missing', { settled: null }), { signingSecret: 's', agentId: 4 });
    assert.equal(missing.issuer_signature, null);
    assert.equal(missing.proof_outcome, 'pending');
    assert.equal(Object.hasOwn(missing, 'usage'), false);
    const short = buildReceipt(paidTask('xfuel-v11-short', { quoted: '2000', settled: '1999' }), { signingSecret: 's', agentId: 4 });
    assert.equal(short.issuer_signature, null);
    const unbound = paidTask('xfuel-v11-placeholder', { quoted: '2000', settled: '2000' });
    unbound.intent.paymentRef = 'base:unknown';
    const placeholder = buildReceipt(unbound, { signingSecret: 's', agentId: 4 });
    assert.equal(placeholder.issuer_signature, null);
    const solanaPayer = 'E6TfVNynPrffpkssHAkLyBFcHebo4q3R631c1oT8H5mh';
    const solana = buildReceipt(paidTask('xfuel-v11-sol', { chain: 'solana', payer: solanaPayer }), { signingSecret: 's', agentId: 4 });
    assert.equal(decodeReceiptClaims(solana).chain, 'solana');
    assert.equal(decodeReceiptClaims(solana).amount_settled, '2000');
  } finally {
    restoreEnv(prev);
  }
});

test('flag off still serves the stored v11 document on every public view', async () => {
  const prev = snapshotEnv();
  try {
    await arm();
    const task = paidTask('xfuel-v11-flag-off', { output: 'secret-output' });
    task.usage = { prompt_tokens: 11, completion_tokens: 7, total_tokens: 18 };
    task.meta.pricing = { floor_applied: true, basis: 'test' };
    const first = buildReceipt(task, { signingSecret: 's', agentId: 4 });
    task.issuerSignature = first.issuer_signature;
    process.env.ISSUER_ROOT_ENABLED = 'false';
    const json = storedReceiptJson(buildReceipt(task, { signingSecret: 's', agentId: 4 }));
    assert.deepEqual(publicKeys(json), PUBLIC_V11);
    const text = JSON.stringify(json);
    assert.equal(text.includes('usage'), false);
    assert.equal(text.includes('fulfillment'), false);
    assert.equal(text.includes('payment_meta'), false);
    assert.equal(text.includes('prompt_tokens'), false);
    assert.equal(text.includes('floor_applied'), false);
    const auditor = buildAuditorExport(json);
    assert.deepEqual(publicKeys(auditor), PUBLIC_V11);
    const html = renderReceiptHtml(json);
    assert.equal(html.includes('usage'), false);
    assert.equal(html.includes('prompt_tokens'), false);
    assert.equal(html.includes('floor_applied'), false);
    const og = buildReceiptOgSvg(json);
    assert.equal(og.includes('prompt_tokens'), false);
    assert.equal(og.includes('theta'), false);
    const preimage = capturePreimage(json);
    const preimageDoc = JSON.parse(preimage);
    assert.deepEqual(Object.keys(preimageDoc).sort(), [...V11_SIGNED_FIELDS].sort());
    assert.equal(JSON.stringify(preimageDoc).includes('usage'), false);
  } finally {
    restoreEnv(prev);
  }
});

test('T4 T8 T12 public surfaces hide the salt and reject injected fields', async () => {
  const prev = snapshotEnv();
  try {
    await arm();
    const task = paidTask('xfuel-v11-surface', { output: 'ok' });
    task.meta.internal_breakdown = { provider_cogs_amount: '1' };
    task.meta.cap = '9';
    task.meta.spent = '1';
    const receipt = buildReceipt(task, { signingSecret: 's', agentId: 4 });
    const salt = headersFrom(receipt, task.request)['x-chit-request-salt'];
    const surfaces = [
      JSON.stringify(receipt),
      JSON.stringify(storedReceiptJson(receipt)),
      renderReceiptHtml(receipt),
      buildReceiptOgSvg(receipt),
      JSON.stringify(buildAuditorExport(receipt)),
      capturePreimage(receipt),
    ];
    for (const surface of surfaces) {
      assert.equal(surface.includes(salt), false);
      assert.equal(surface.includes('prompt_tokens'), false);
      assert.equal(surface.includes('internal_breakdown'), false);
      assert.equal(surface.includes('ISSUER_PRIVATE_KEY'), false);
    }
    assert.deepEqual(publicKeys(receipt), PUBLIC_V11);
    const again = JSON.stringify(buildReceipt({ ...task, issuerSignature: receipt.issuer_signature }, { signingSecret: 's', agentId: 4 }));
    assert.equal(again, JSON.stringify(receipt));
  } finally {
    restoreEnv(prev);
  }
});

test('T5 a spoofed X-Payer is not the principal', () => {
  const spoof = '0xspoofspoofspoofspoofspoofspoofspoofspoof';
  const settled = '0x1111111111111111111111111111111111111111';
  const req = {
    method: 'POST',
    headers: { 'x-payer': spoof, 'idempotency-key': 'k' },
    body: { payer: spoof },
    rawBody: Buffer.from('{}'),
    payer: spoof,
  };
  const request = clientRequestForRefusal(req, '/v1/chat/completions');
  assert.equal(request.payer, undefined);
  delete request.payer;
  request.payer = settled;
  assert.equal(request.payer, settled);
  assert.equal(JSON.stringify(request).includes(spoof), false);
});

test('T16 an AAD swap does not open the salt', () => {
  const wrap = crypto.randomBytes(32);
  const store = new EncryptedSaltStore(wrap, 'wrap-test');
  const saltA = crypto.randomBytes(32);
  const saltB = crypto.randomBytes(32);
  store.put('rcpt-a', saltA);
  store.put('rcpt-b', saltB);
  const recordA = store.peek('rcpt-a');
  const recordB = store.peek('rcpt-b');
  assert.throws(() => openSaltRecord({ ...recordA, receipt_id: recordB.receipt_id }, wrap));
  assert.throws(() => openSaltRecord({ ...recordB, receipt_id: recordA.receipt_id }, wrap));
  assert.throws(() => openSaltRecord({
    ...recordA,
    iv: recordB.iv,
    ct: recordB.ct,
    tag: recordB.tag,
  }, wrap));
  store._rows.get('rcpt-a').record = { ...recordB, receipt_id: 'rcpt-a' };
  assert.equal(store.get('rcpt-a'), null);
  assert.equal(store.get('rcpt-b').equals(saltB), true);
});

test('T17 the salt wrap key is not the issuer key', () => {
  const prev = snapshotEnv();
  try {
    process.env.NODE_ENV = 'test';
    delete process.env.ISSUER_PRIVATE_KEY;
    delete process.env.ISSUER_KID;
    delete process.env.ALLOW_EPHEMERAL_ISSUER_KEY;
    _resetIssuerKey();
    const issuer = initIssuerKey();
    const pem = issuer.privateKey.export({ type: 'pkcs8', format: 'pem' });
    const der = issuer.privateKey.export({ type: 'pkcs8', format: 'der' });
    assert.throws(() => new EncryptedSaltStore(Buffer.from(pem)));
    assert.throws(() => new EncryptedSaltStore(der));
    const wrap = crypto.randomBytes(32);
    const store = new EncryptedSaltStore(wrap, 'wrap-not-issuer');
    assert.equal(store._key.equals(wrap), true);
    assert.equal(store._key.equals(der), false);
    assert.equal(der.includes(store._key), false);
    assert.notEqual(store._kid, issuer.kid);
    const saltSrc = fs.readFileSync(fileURLToPath(new URL('../src/salt-store.js', import.meta.url)), 'utf8');
    assert.equal(saltSrc.includes('ISSUER_PRIVATE_KEY'), false);
    assert.equal(saltSrc.includes('initIssuerKey'), false);
  } finally {
    _resetIssuerKey();
    restoreEnv(prev);
  }
});

test('T18 public receipt GETs do not read the salt', () => {
  const src = fs.readFileSync(fileURLToPath(new URL('../src/server.js', import.meta.url)), 'utf8');
  const start = src.indexOf("app.get('/receipt/by-tx'");
  const end = src.indexOf("app.post('/receipt/:taskId/handoff/origin'");
  assert.ok(start > 0 && end > start);
  const gets = src.slice(start, end);
  for (const needle of ['getSaltStore', 'requestSalt', 'applyRequestSaltHeader', 'X-Chit-Request-Salt', 'openSaltRecord']) {
    assert.equal(gets.includes(needle), false, needle);
  }
  const publishStart = src.indexOf('function publishReceipt');
  const publishEnd = src.indexOf('function sendPreimage');
  const publish = src.slice(publishStart, publishEnd);
  assert.equal(publish.includes('getSaltStore'), false);
  assert.equal(publish.includes('requestSalt'), false);
  const refusalStart = src.indexOf("app.get('/refusal/");
  if (refusalStart > 0) {
    const refusal = src.slice(refusalStart, refusalStart + 2500);
    assert.equal(refusal.includes('getSaltStore'), false);
    assert.equal(refusal.includes('applyRequestSaltHeader'), false);
  }
});

test('T19 the owner view keeps one book ref and the public document has no salt', async () => {
  const prev = snapshotEnv();
  try {
    await arm();
    const task = paidTask('xfuel-v11-owner', { output: 'ok', agentId: 4 });
    const receipt = buildReceipt(task, { signingSecret: 's', agentId: 4 });
    const salt = headersFrom(receipt, task.request)['x-chit-request-salt'];
    assert.match(salt, /^[0-9a-f]{64}$/);
    assert.equal(v11Commit(salt, V11_LABEL_OUTPUT, Buffer.from('ok')), receipt.output_commitment);
    assert.notEqual(v11Commit(salt, V11_LABEL_ACCOUNTING, Buffer.from('ok')), receipt.output_commitment);
    const surfaces = [
      JSON.stringify(receipt),
      JSON.stringify(storedReceiptJson(receipt)),
      renderReceiptHtml(receipt),
      buildReceiptOgSvg(receipt),
      JSON.stringify(buildAuditorExport(receipt)),
      capturePreimage(receipt),
    ];
    for (const surface of surfaces) {
      assert.equal(surface.includes(salt), false);
      assert.equal(surface.includes('x-chit-request-salt'), false);
    }
    const persisted = task.meta.v11BookRef;
    assert.equal(persisted, receipt.book_ref);
    resetBookRefs();
    task.issuerSignature = receipt.issuer_signature;
    const rebuilt = buildReceipt(task, { signingSecret: 's', agentId: 4 });
    assert.equal(rebuilt.book_ref, persisted);
    assert.equal(rebuilt.issuer_signature.jws, receipt.issuer_signature.jws);
    const otherAgent = paidTask('xfuel-v11-owner-b', { agentId: 8 });
    const other = buildReceipt(otherAgent, { signingSecret: 's', agentId: 8 });
    assert.notEqual(other.book_ref, persisted);
    const holder = {};
    bindSaltReceipt(holder, 'rcpt');
    assert.equal(Object.keys(holder).length, 0);
    const symbol = Object.getOwnPropertySymbols(holder)[0];
    assert.equal(Object.getOwnPropertyDescriptor(holder, symbol).enumerable, false);
  } finally {
    restoreEnv(prev);
  }
});

test('foreign ingest refuses to sign while v11 issuance is on', async () => {
  const prev = snapshotEnv();
  try {
    await arm();
    assert.throws(() => buildForeignReceipt({}), (err) => err.code === 'v11_foreign_unsupported');
  } finally {
    restoreEnv(prev);
  }
});

test('production issuer key rejects a missing, wrong-type, or mismatched key', () => {
  const prev = snapshotEnv();
  try {
    delete process.env.NODE_ENV;
    delete process.env.ISSUER_PRIVATE_KEY;
    delete process.env.ALLOW_EPHEMERAL_ISSUER_KEY;
    process.env.ISSUER_ROOT_ALLOW_SKIP = 'I_UNDERSTAND';
    _resetIssuerKey();
    assert.throws(() => initIssuerKey(), (err) => err.code === 'issuer_key_missing');

    process.env.NODE_ENV = 'production';
    process.env.ISSUER_PRIVATE_KEY = '   \n';
    _resetIssuerKey();
    assert.throws(() => initIssuerKey(), (err) => err.code === 'issuer_key_missing');

    const { privateKey: wrong } = crypto.generateKeyPairSync('ec', { namedCurve: 'secp256k1' });
    process.env.ISSUER_PRIVATE_KEY = Buffer.from(wrong.export({ type: 'pkcs8', format: 'pem' })).toString('base64');
    _resetIssuerKey();
    assert.throws(() => initIssuerKey(), (err) => err.code === 'issuer_key_type');

    const { privateKey } = crypto.generateKeyPairSync('ec', { namedCurve: 'P-256' });
    process.env.ISSUER_PRIVATE_KEY = Buffer.from(privateKey.export({ type: 'pkcs8', format: 'pem' })).toString('base64');
    process.env.ISSUER_KID = 'not-the-thumbprint';
    _resetIssuerKey();
    assert.throws(() => initIssuerKey(), (err) => err.code === 'issuer_kid_mismatch');

    delete process.env.NODE_ENV;
    delete process.env.ISSUER_PRIVATE_KEY;
    delete process.env.ISSUER_KID;
    process.env.ALLOW_EPHEMERAL_ISSUER_KEY = 'true';
    _resetIssuerKey();
    const minted = initIssuerKey();
    assert.equal(minted.publicKeyJwk.crv, 'P-256');
  } finally {
    restoreEnv(prev);
  }
});
