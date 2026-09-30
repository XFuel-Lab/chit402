/**
 * Clock bound on a signed tree head. RPC is mocked; nothing here dials a chain.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const {
  clock_tolerance_s,
  toleranceSeconds,
  applyAnchorClock,
  verifyAnchorClock,
  assessInclusion,
  formatAnchorClock,
  receiptTimestampSeconds,
} = await import('../src/receipt-anchor-clock.js');

const {
  ReceiptMerkleTree,
  verifyTreeHead,
  verifyInclusion,
  leafHash,
  renderInclusionSection,
  resetReceiptMerkleTree,
  TREE_HEAD_JWT_TYP,
} = await import('../src/receipt-merkle.js');

const { signJws, getIssuerPublicKeyJwk } = await import('../src/issuer-key.js');

function headFromClaims(claims, anchor) {
  const { jws, kid } = signJws(claims, { typ: TREE_HEAD_JWT_TYP });
  return {
    ...claims,
    anchor,
    issuer_signature: {
      alg: 'ES256',
      typ: TREE_HEAD_JWT_TYP,
      payload_version: claims.payload_version,
      jws,
      kid,
      issuer_jwk: getIssuerPublicKeyJwk(),
    },
  };
}

function withAnchorKey(fn) {
  const prevKey = process.env.RECEIPT_ANCHOR_PRIVATE_KEY;
  const prevBase = process.env.BASE_RPC_URL;
  const prevSettlement = process.env.SETTLEMENT_RPC_URL;
  const prevSol = process.env.SOLANA_ANCHOR_SECRET_KEY;
  const prevSolRpc = process.env.SOLANA_RPC_URL;
  delete process.env.BASE_RPC_URL;
  delete process.env.SETTLEMENT_RPC_URL;
  delete process.env.SOLANA_ANCHOR_SECRET_KEY;
  delete process.env.SOLANA_RPC_URL;
  process.env.RECEIPT_ANCHOR_PRIVATE_KEY = `0x${'ab'.repeat(32)}`;
  return Promise.resolve()
    .then(fn)
    .finally(() => {
      if (prevKey == null) delete process.env.RECEIPT_ANCHOR_PRIVATE_KEY;
      else process.env.RECEIPT_ANCHOR_PRIVATE_KEY = prevKey;
      if (prevBase == null) delete process.env.BASE_RPC_URL;
      else process.env.BASE_RPC_URL = prevBase;
      if (prevSettlement == null) delete process.env.SETTLEMENT_RPC_URL;
      else process.env.SETTLEMENT_RPC_URL = prevSettlement;
      if (prevSol == null) delete process.env.SOLANA_ANCHOR_SECRET_KEY;
      else process.env.SOLANA_ANCHOR_SECRET_KEY = prevSol;
      if (prevSolRpc == null) delete process.env.SOLANA_RPC_URL;
      else process.env.SOLANA_RPC_URL = prevSolRpc;
      resetReceiptMerkleTree();
    });
}

test('clock_tolerance_s is named per chain and does not bump the head version', () => {
  assert.equal(clock_tolerance_s.base, 300);
  assert.equal(clock_tolerance_s.solana, 150);
  assert.equal(toleranceSeconds('base', null), 300);
  assert.equal(toleranceSeconds('solana', null), 150);
  assert.equal(toleranceSeconds('base', { base: 100000, solana: 100000 }), 300);
  assert.equal(toleranceSeconds('solana', { base: 100000, solana: 50 }), 50);
});

test('a block outside the bound is not published as anchored', async () => {
  await withAnchorKey(async () => {
    const tree = new ReceiptMerkleTree();
    tree.appendReceipt('late', 'hh');
    const head = await tree.publishHead({
      force: true,
      send: async () => `0x${'cd'.repeat(32)}`,
      blockTimestamp: 1,
    });
    assert.equal(head.payload_version, 1);
    assert.equal(head.anchor_status, 'pending');
    assert.equal(head.anchor.status, 'pending');
    assert.equal(head.anchor.reason, 'anchor_clock_drift');
    assert.equal(head.anchor.tx, null);
    assert.equal(head.anchor_tx, null);
    assert.equal(head.anchor.rejected_tx, `0x${'cd'.repeat(32)}`);
    assert.equal(head.anchors.base.reason, 'anchor_clock_drift');
    assert.equal(head.anchors.base.status, 'pending');
    assert.deepEqual(head.clock_tolerance_s, { base: 300, solana: 150 });
    const payload = JSON.parse(Buffer.from(head.issuer_signature.jws.split('.')[1], 'base64url').toString());
    assert.equal(payload.payload_version, 1);
    assert.equal(payload.anchor_status, 'pending');
    assert.equal(payload.clock_tolerance_s.base, 300);
    assert.equal(payload.clock_tolerance_s.solana, 150);
    assert.equal(payload.published_at, head.published_at);
    assert.equal(verifyTreeHead(head).valid, true);
    assert.match(renderInclusionSection(tree.inclusion('late')), /pending anchor/);
  });
});

test('a block inside the bound stays anchored, and an old head still verifies', async () => {
  await withAnchorKey(async () => {
    const tree = new ReceiptMerkleTree();
    tree.appendReceipt('on-time', 'hh');
    const head = await tree.publishHead({
      force: true,
      send: async () => `0x${'ef'.repeat(32)}`,
      blockTimestamp: Math.floor(Date.now() / 1000),
    });
    assert.equal(head.anchor_status, 'anchored');
    assert.equal(head.anchor.tx, `0x${'ef'.repeat(32)}`);
    assert.equal(head.payload_version, 1);
    assert.equal(verifyTreeHead(head).valid, true);
    assert.match(renderInclusionSection(tree.inclusion('on-time')), /anchored in Base tx/);

    const edited = { ...head, published_at: '2000-01-01T00:00:00.000Z' };
    assert.equal(verifyTreeHead(edited).reason, 'head_mismatch');

    const oldClaims = {
      schema: 'chit402.tree_head.v1',
      payload_version: 1,
      tree_size: 1,
      root: 'ab'.repeat(32),
      anchor_status: 'pending',
      anchor_tx: null,
      anchor_from: null,
    };
    const oldHead = headFromClaims(oldClaims, { status: 'pending', chain: 'base', tx: null });
    oldHead.published_at = '2020-01-01T00:00:00.000Z';
    assert.equal(verifyTreeHead(oldHead).valid, true);
    assert.equal(verifyTreeHead(oldHead).payload.clock_tolerance_s, undefined);
  });
});

test('applyAnchorClock clears the tx on drift and leaves an unseen block alone', () => {
  const side = { status: 'anchored', chain: 'base', tx: '0xabc', calldata: '0xroot' };
  const drifted = applyAnchorClock(side, { publishedAt: '2026-09-30T00:00:00.000Z', blockTs: 1, chain: 'base' });
  assert.equal(drifted.status, 'pending');
  assert.equal(drifted.reason, 'anchor_clock_drift');
  assert.equal(drifted.tx, null);
  assert.equal(drifted.rejected_tx, '0xabc');
  assert.equal(drifted.calldata, '0xroot');
  const unseen = applyAnchorClock(side, { publishedAt: '2026-09-30T00:00:00.000Z', blockTs: null, chain: 'base' });
  assert.equal(unseen.status, 'anchored');
  assert.equal(unseen.tx, '0xabc');
});

function rpcMock({ baseTs = null, solanaTs = null, calls }) {
  return async (url, method) => {
    calls.push({ url, method });
    if (method === 'eth_getTransactionReceipt') return { blockNumber: '0x10' };
    if (method === 'eth_getBlockByNumber') {
      return baseTs == null ? { timestamp: null } : { timestamp: `0x${baseTs.toString(16)}` };
    }
    if (method === 'getTransaction') return solanaTs == null ? {} : { blockTime: solanaTs };
    return null;
  };
}

test('without --rpc the clock check is skipped and does not call RPC', async () => {
  const calls = [];
  const published = '2026-09-30T12:00:00.000Z';
  const tx = `0x${'11'.repeat(32)}`;
  const claims = {
    schema: 'chit402.tree_head.v1',
    payload_version: 1,
    tree_size: 2,
    root: 'ab'.repeat(32),
    anchor_status: 'anchored',
    anchor_tx: tx,
    anchor_from: null,
    published_at: published,
    clock_tolerance_s: { base: 300, solana: 150 },
  };
  const head = headFromClaims(claims, { status: 'anchored', chain: 'base', tx });
  const verified = verifyTreeHead(head);
  const result = await verifyAnchorClock({
    head,
    signedPayload: verified.payload,
    signatureValid: verified.valid,
    enabled: false,
    rpcUrl: 'http://rpc.test',
    call: rpcMock({ baseTs: 1, calls }),
  });
  assert.equal(result.status, 'skipped');
  assert.equal(result.reason, 'no_rpc');
  assert.equal(calls.length, 0);
  assert.match(formatAnchorClock(result), /skipped \(no --rpc\)/);
  assert.doesNotMatch(formatAnchorClock(result), /passed/);
});

test('mocked RPC refuses anchor_clock_drift and a receipt newer than the head', async () => {
  await withAnchorKey(async () => {
    const tree = new ReceiptMerkleTree();
    tree.appendReceipt('row-1', 'rowhash');
    const blockTs = Math.floor(Date.now() / 1000);
    const head = await tree.publishHead({
      force: true,
      send: async () => `0x${'22'.repeat(32)}`,
      blockTimestamp: blockTs,
    });
    const verified = verifyTreeHead(head);
    const inclusion = tree.inclusion('row-1');
    const receipt = {
      task_id: 'row-1',
      row_hash: 'rowhash',
      created_at: new Date((blockTs - 30) * 1000).toISOString(),
      inclusion,
    };
    const proof = assessInclusion({
      receipt, inclusion, head, verifyInclusion, leafHash,
    });
    assert.equal(proof.proven, true);

    const calls = [];
    const ok = await verifyAnchorClock({
      head,
      signedPayload: verified.payload,
      signatureValid: true,
      enabled: true,
      rpcUrl: 'http://base.test',
      receiptTs: receiptTimestampSeconds(receipt),
      proven: true,
      call: rpcMock({ baseTs: blockTs, calls }),
    });
    assert.equal(ok.status, 'passed');
    assert.equal(calls.some((row) => row.method === 'eth_getTransactionReceipt'), true);
    assert.match(formatAnchorClock(ok), /passed/);

    const lateReceiptTs = Math.floor(Date.parse(head.published_at) / 1000) + clock_tolerance_s.base + 5;
    const late = await verifyAnchorClock({
      head,
      signedPayload: verified.payload,
      signatureValid: true,
      enabled: true,
      rpcUrl: 'http://base.test',
      receiptTs: lateReceiptTs,
      proven: true,
      call: rpcMock({ baseTs: blockTs, calls: [] }),
    });
    assert.equal(late.status, 'failed');
    assert.equal(late.reason, 'anchor_clock_drift');
    assert.match(late.detail, /receipt timestamp/);

    const drifted = await verifyAnchorClock({
      head,
      signedPayload: verified.payload,
      signatureValid: true,
      enabled: true,
      rpcUrl: 'http://base.test',
      receiptTs: receiptTimestampSeconds(receipt),
      proven: true,
      call: rpcMock({ baseTs: blockTs + 10_000, calls: [] }),
    });
    assert.equal(drifted.status, 'failed');
    assert.equal(drifted.reason, 'anchor_clock_drift');
    assert.match(drifted.detail, /base \|published_at - block_ts\|/);
  });
});

test('a signed tolerance wider than the constant does not loosen the check', async () => {
  const publishedAt = '2026-09-30T12:00:00.000Z';
  const published = Math.floor(Date.parse(publishedAt) / 1000);
  const tx = `0x${'33'.repeat(32)}`;
  const claims = {
    schema: 'chit402.tree_head.v1',
    payload_version: 1,
    tree_size: 1,
    root: 'cd'.repeat(32),
    anchor_status: 'anchored',
    anchor_tx: tx,
    anchor_from: null,
    published_at: publishedAt,
    clock_tolerance_s: { base: 100000, solana: 100000 },
  };
  const head = headFromClaims(claims, { status: 'anchored', chain: 'base', tx });
  const verified = verifyTreeHead(head);
  assert.equal(verified.valid, true);
  const result = await verifyAnchorClock({
    head,
    signedPayload: verified.payload,
    signatureValid: true,
    enabled: true,
    rpcUrl: 'http://base.test',
    proven: null,
    call: rpcMock({ baseTs: published + 5_000, calls: [] }),
  });
  assert.equal(result.status, 'failed');
  assert.equal(result.reason, 'anchor_clock_drift');
  assert.equal(result.chains[0].tolerance, 300);
});

test('Solana block time uses the tighter bound', async () => {
  const publishedAt = '2026-09-30T12:00:00.000Z';
  const published = Math.floor(Date.parse(publishedAt) / 1000);
  const tx = `0x${'44'.repeat(32)}`;
  const signature = 'solana-sig';
  const claims = {
    schema: 'chit402.tree_head.v1',
    payload_version: 1,
    tree_size: 2,
    root: 'ef'.repeat(32),
    anchor_status: 'anchored',
    anchor_tx: tx,
    anchor_from: null,
    published_at: publishedAt,
    clock_tolerance_s: { base: 300, solana: 150 },
    anchors: {
      base: { status: 'anchored', chain: 'base', tx },
      solana: { status: 'anchored', signature, cluster: 'mainnet-beta' },
    },
  };
  const head = headFromClaims(claims, claims.anchors.base);
  head.anchors = claims.anchors;
  const verified = verifyTreeHead(head);
  assert.equal(verified.valid, true);

  const withinBaseOnly = published + 200;
  const drifted = await verifyAnchorClock({
    head,
    signedPayload: verified.payload,
    signatureValid: true,
    enabled: true,
    rpcUrl: 'http://base.test',
    solanaRpcUrl: 'http://solana.test',
    proven: null,
    call: rpcMock({ baseTs: published, solanaTs: withinBaseOnly, calls: [] }),
  });
  assert.equal(drifted.status, 'failed');
  assert.equal(drifted.reason, 'anchor_clock_drift');
  assert.match(drifted.detail, /solana/);

  const ok = await verifyAnchorClock({
    head,
    signedPayload: verified.payload,
    signatureValid: true,
    enabled: true,
    rpcUrl: 'http://base.test',
    solanaRpcUrl: 'http://solana.test',
    proven: null,
    call: rpcMock({ baseTs: published + 10, solanaTs: published + 10, calls: [] }),
  });
  assert.equal(ok.status, 'passed');

  const baseOnly = await verifyAnchorClock({
    head,
    signedPayload: verified.payload,
    signatureValid: true,
    enabled: true,
    rpcUrl: 'http://base.test',
    proven: null,
    call: rpcMock({ baseTs: published, calls: [] }),
  });
  assert.equal(baseOnly.status, 'skipped');
  assert.notEqual(baseOnly.status, 'passed');
});

test('verify-receipt.mjs reports the clock check skipped unless --rpc is set', () => {
  const dir = mkdtempSync(join(tmpdir(), 'chit-clock-'));
  const receipt = {
    task_id: 't1',
    payment: {
      rail: 'usdc',
      ref: null,
      gross_amount: '1',
      net_amount: '1',
      fee_amount: '0',
      protocol_fee_bps: 0,
      platform_fee: '0',
      platform_fee_bps: 0,
    },
    provider_cogs: { actual: null },
    route: { model: 'm', model_commitment: { commitment: null }, provider: 'p' },
    output: { hash: null },
    binding: { expected_commitment: null },
  };
  const payload = JSON.stringify([
    receipt.task_id,
    receipt.payment.rail,
    receipt.payment.ref,
    receipt.payment.gross_amount,
    receipt.payment.net_amount,
    receipt.payment.fee_amount,
    receipt.payment.protocol_fee_bps,
    receipt.payment.platform_fee,
    receipt.payment.platform_fee_bps,
    null,
    receipt.route.model,
    null,
    receipt.route.provider,
    null,
    null,
  ]);
  receipt.signature = {
    value: `sha256=${createHmac('sha256', 'secret').update(payload).digest('hex')}`,
    role: 'primary',
  };
  const receiptPath = join(dir, 'receipt.json');
  const headPath = join(dir, 'head.json');
  writeFileSync(receiptPath, JSON.stringify(receipt));
  writeFileSync(headPath, JSON.stringify({
    schema: 'chit402.tree_head.v1',
    payload_version: 1,
    root: 'ab'.repeat(32),
    tree_size: 1,
    published_at: '2026-09-30T12:00:00.000Z',
    anchor_status: 'pending',
    anchor: { status: 'pending', chain: 'base', tx: null },
  }));
  const script = join(dirname(fileURLToPath(import.meta.url)), '..', 'scripts', 'verify-receipt.mjs');
  const skipped = spawnSync(process.execPath, [script, receiptPath, 'secret', '--head', headPath], {
    encoding: 'utf8',
  });
  assert.equal(skipped.status, 0, skipped.stderr);
  assert.match(skipped.stdout, /VALID/);
  assert.match(skipped.stdout, /Anchor clock: skipped \(no --rpc\)/);
  assert.doesNotMatch(skipped.stdout, /Anchor clock: passed/);

  const refused = spawnSync(process.execPath, [
    script, receiptPath, 'secret', '--head', headPath, '--rpc', 'http://127.0.0.1:9',
  ], { encoding: 'utf8' });
  assert.equal(refused.status, 1);
  assert.match(refused.stdout, /Anchor clock: FAILED/);
  assert.doesNotMatch(refused.stdout, /Anchor clock: passed/);
});
