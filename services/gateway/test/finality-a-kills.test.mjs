/**
 * Kills for the finality mutants that the lagging-head tests do not reach.
 * Offline. No production host.
 */
import { createHash, createPublicKey } from 'node:crypto';
import http from 'node:http';
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import assert from 'node:assert/strict';
import { bytesToBig } from '../../../packages/cs2-core/ecdsa/bytes.js';
import { SECP256K1 } from '../../../packages/cs2-core/ecdsa/index.js';
import { publicPoint, signRawDigest } from '../../../packages/cs2-core/ecdsa/sign.js';
import { openStore } from '../../chit-store/store.js';
import { bookLeaf, openIntake, readIntakeLeaves, updateLeaf } from '../../chit-store/intake.js';
import { MAINNET_CHECKPOINT } from '../../chit-sealer/mainnet-pin.js';
import { guardKmsClient } from '../../chit-sealer/anchor-mainnet.js';
import { createCheckpointSigner } from '../../chit-sealer/kms-secp256k1.js';
import { startLagRpc, routeLagFetch } from '../../chit-sealer/test/helpers/lag-rpc.mjs';
import { startV13AnchorScheduler, stopV13AnchorScheduler } from '../src/v13-anchor-scheduler.js';
import {
  houseIssueCallsForTest,
  issueHouseReceipt,
  resetHouseState,
  serveHousePending,
  setV13Runtime,
} from '../src/v13-issue.js';
import { isBaseHousePayment } from '../src/openai-gateway.js';
import { eip1559Decode } from '../../../packages/cs2-core/ecdsa/eip1559.js';

process.env.NODE_ENV = 'test';
process.env.HUB_CATALOG_OFFLINE = 'true';

const CAP = '100000000000';
const PRIMARY = 'http://primary.example.test/rpc';
const SECONDARY = 'http://secondary.example.org/rpc';

function flags(extra = {}) {
  return {
    NODE_ENV: 'test',
    CHIT_V13_ISSUANCE: 'true',
    CHIT_V13_MAINNET_SEALER: 'true',
    CHIT_V13_STORE: 'true',
    CHIT_V13_ANCHOR_SCHEDULER: 'true',
    CHIT_CHECKPOINT_KMS_KEY_ID: 'alias/test-checkpoint',
    CHIT_CHECKPOINT_KMS_REGION: 'us-east-2',
    CHIT_CHECKPOINT_ADDRESS: MAINNET_CHECKPOINT,
    CHIT_CHECKPOINT_MAX_FEE_PER_GAS: CAP,
    CHIT_SEALER_CLOSE_MARGIN_SEC: '0',
    CHIT_SEALER_STUCK_MS: '600000',
    ...extra,
  };
}

function mockKms() {
  const d = 0xA11CEn;
  const pub = publicPoint(d, SECP256K1);
  return {
    async send(command) {
      if (command?.name === 'GetPublicKey') {
        const jwk = {
          kty: 'EC', crv: 'secp256k1',
          x: Buffer.from(pub.subarray(1, 33)).toString('base64url'),
          y: Buffer.from(pub.subarray(33)).toString('base64url'),
        };
        const { createPublicKey: pubKey } = await import('node:crypto');
        return {
          KeySpec: 'ECC_SECG_P256K1',
          KeyUsage: 'SIGN_VERIFY',
          SigningAlgorithms: ['ECDSA_SHA_256'],
          PublicKey: pubKey({ key: jwk, format: 'jwk' }).export({ type: 'spki', format: 'der' }),
        };
      }
      const digest = new Uint8Array(command.input.Message);
      let k = (bytesToBig(digest) % (SECP256K1.order - 3n)) + 2n;
      let sig;
      for (let i = 0; i < 8; i += 1) {
        try { sig = signRawDigest(digest, d, k, SECP256K1); break; } catch (err) {
          if (err.code !== 'bad_nonce') throw err;
          k += 1n;
        }
      }
      return { Signature: sig.der };
    },
  };
}

function world() {
  const root = mkdtempSync(join(tmpdir(), 'fa-kill-'));
  const book = { id: 'aa'.repeat(32), token: 'test-house-token-1', bookPk: new Uint8Array(32).fill(7), wallets: [`0x${'11'.repeat(20)}`] };
  const store = openStore(join(root, 'store'), { books: [book] });
  const sealerDir = join(root, 'sealer');
  mkdirSync(sealerDir, { mode: 0o700 });
  chmodSync(sealerDir, 0o700);
  chmodSync(store.dir, 0o700);
  return { root, store, sealerDir, book, caller: { bookId: book.id, token: book.token } };
}

async function signer() {
  const d = 0xA11CEn;
  const pub = publicPoint(d, SECP256K1);
  const { ethereumAddress } = await import('../../../packages/cs2-core/ecdsa/index.js');
  const address = ethereumAddress(pub);
  const client = mockKms();
  const real = await createCheckpointSigner({
    client: guardKmsClient(client),
    env: {
      CHIT_CHECKPOINT_KMS_KEY_ID: 'alias/DUMMY_KEY_CANARY',
      CHIT_CHECKPOINT_KMS_REGION: 'us-east-1',
      CHIT_CHECKPOINT_ADDRESS: address,
      CHIT_CHECKPOINT_MAX_FEE_PER_GAS: CAP,
    },
  });
  return {
    client,
    signer: {
      kind: real.kind,
      address: MAINNET_CHECKPOINT.toLowerCase(),
      feeCeiling: CAP,
      signDigest: (digest, opts) => real.signDigest(digest, opts),
      signEip1559: (tx, opts) => real.signEip1559(tx, opts),
    },
  };
}

function payment(n, block, hash) {
  return {
    chainId: 8453,
    token: '833589fcd6edb6e08f4c7c32d4f71b54bda02913',
    from: '11'.repeat(20),
    to: '22'.repeat(20),
    authorizer: '11'.repeat(20),
    value: '2000',
    method: 1,
    nonce: createHash('sha256').update(`n-${n}`).digest('hex'),
    saltP: createHash('sha256').update(`s-${n}`).digest('hex'),
    blockHash: hash,
    blockNumber: block,
  };
}

async function book(box, n, block, hash) {
  mkdirSync(join(box.root, 'bind'), { recursive: true });
  const out = await issueHouseReceipt({
    env: flags(),
    dir: join(box.root, 'bind'),
    store: box.store,
    caller: box.caller,
    client: mockKms(),
    send: async () => '0x1',
    payment: payment(n, block, hash),
    observation: {
      blockNumber: block,
      finalizedNumber: null,
      blockHash: hash,
      blockTime: 1_700_000_000,
      txIndex: 0,
      localLogIndex: n,
      txHash: createHash('sha256').update(`tx-${n}`).digest('hex'),
      hourStart: 0,
    },
  });
  assert.equal(out.status, 202, JSON.stringify(out.body));
  return out;
}

async function boot(box, left, right, clock) {
  const who = await signer();
  const env = flags({
    CHIT_V13_SEALER_DIR: box.sealerDir,
    CHIT_SEALER_RPC_URL: PRIMARY,
    CHIT_SEALER_RPC_URL_2: SECONDARY,
  });
  setV13Runtime({ store: box.store, dir: join(box.root, 'bind'), caller: box.caller, client: who.client, send: async () => '0x1' });
  return startV13AnchorScheduler({
    env,
    clock: () => clock.now,
    runtime: { store: box.store, client: who.client },
    deps: { testInjection: true, signer: who.signer, fetch: routeLagFetch(left, right), timeoutMs: 1000 },
  });
}

test('FA6 RPC disagreement and a hash mismatch seal nothing', { timeout: 15000 }, async () => {
  resetHouseState();
  const box = world();
  const left = await startLagRpc({ lag: 0, latest: 20, salt: 'same' });
  const right = await startLagRpc({ lag: 0, latest: 20, salt: 'other' });
  const clock = { now: 7200 };
  try {
    const hash = left.hashOf(10).slice(2);
    await book(box, 1, 10, hash);
    const handle = await boot(box, left, right, clock);
    const missed = await handle.tick();
    assert.equal(missed.reason, 'anchor_finality_unavailable');
    assert.equal(left.sends.length, 0);
    await stopV13AnchorScheduler();
  } finally {
    await left.close();
    await right.close();
    rmSync(box.root, { recursive: true, force: true });
    setV13Runtime(null);
  }
});

test('FA5 a replay re-read books the chain hash, not the stored one', async () => {
  const { settleBoundPayment } = await import('../src/x402-settle.js');
  const { ChallengeStore } = await import('../src/x402-adapter.js');
  const { buildReceipt } = await import('../src/openai-gateway.js');
  resetHouseState();
  const box = world();
  const lag = await startLagRpc({ lag: 0, latest: 30, salt: 'reread' });
  const block = 30;
  const chainHash = lag.hashOf(block).slice(2);
  const storedHash = 'ab'.repeat(32);
  const tx = `0x${'cd'.repeat(32)}`;
  lag.putReceipt({
    txHash: tx,
    blockNumber: block,
    status: '0x1',
    from: `0x${'11'.repeat(20)}`,
    logs: [{
      address: '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913',
      topics: ['0x' + 'dd'.repeat(32), '0x' + '00'.repeat(12) + '11'.repeat(20), '0x' + '00'.repeat(12) + '22'.repeat(20)],
      data: '0x' + '0'.repeat(63) + '1',
    }],
  });
  const prev = {};
  const env = flags();
  for (const name of Object.keys(env)) {
    prev[name] = process.env[name];
    process.env[name] = env[name];
  }
  try {
    const store = new ChallengeStore();
    const nonce = `0x${'a1'.repeat(32)}`;
    const header = Buffer.from(JSON.stringify({
      x402Version: 1,
      network: 'base',
      payload: {
        signature: `0x${'11'.repeat(65)}`,
        authorization: {
          from: `0x${'11'.repeat(20)}`,
          to: `0x${'22'.repeat(20)}`,
          value: '2000',
          validAfter: '0',
          validBefore: String(Math.floor(Date.now() / 1000) + 3600),
          nonce: `0x${'b2'.repeat(32)}`,
        },
      },
      accepted: { asset: '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913' },
    })).toString('base64');
    store.put(nonce, {
      taskId: 'fa5', amount: '2000', asset: '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913',
      network: 'base', payTo: `0x${'22'.repeat(20)}`, resource: '/v1/chat/completions',
      state: 'spent', expiresAt: Date.now() + 60_000, nonce,
    });
    store.markSpent(nonce, {
      txRef: tx,
      amount: '2000',
      payer: `0x${'11'.repeat(20)}`,
      payTo: `0x${'22'.repeat(20)}`,
      route: '/v1/chat/completions',
      quotedAmount: '2000',
      paymentHash: createHash('sha256').update(header, 'utf8').digest('hex'),
      chainId: 8453,
      authNonce: 'b2'.repeat(32),
      token: '833589fcd6edb6e08f4c7c32d4f71b54bda02913',
      authorizer: '11'.repeat(20),
      observation: { blockNumber: block, finalizedNumber: null, blockHash: storedHash, blockTime: 1_700_000_000, txHash: tx },
    });
    const decision = await settleBoundPayment({
      req: { headers: {} },
      taskId: 'fa5',
      amount: '2000',
      nonce,
      paymentHeader: header,
      store,
      serveStoredResponse: true,
      resource: '/v1/chat/completions',
      cfg: {
        network: 'base', payTo: `0x${'22'.repeat(20)}`, asset: '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913',
        facilitatorProvider: 'zan', gatewayUrl: 'http://127.0.0.1:9', apiKey: 'k', baseRpcUrl: lag.url,
        allowUnboundPayments: false,
      },
    });
    assert.equal(decision.kind, 'settled', decision.code);
    assert.equal(decision.observation.blockHash, chainHash);
    assert.notEqual(decision.observation.blockHash, storedHash);
    assert.equal(decision.observation.finalizedNumber, null);
    mkdirSync(join(box.root, 'bind'), { recursive: true });
    setV13Runtime({
      store: box.store, dir: join(box.root, 'bind'), caller: box.caller, client: mockKms(), send: async () => '0x1',
    });
    await buildReceipt({
      task: { taskId: 'fa5', status: 'completed', intent: { type: 'inference_request' }, meta: {} },
      taskId: 'fa5',
      provider: 'example-hub',
      mock: true,
      proverConfigured: false,
      baseUrl: 'http://127.0.0.1:9',
      payment: {
        ref: tx,
        chainId: 8453,
        token: '833589fcd6edb6e08f4c7c32d4f71b54bda02913',
        authorizer: '11'.repeat(20),
        nonce: 'b2'.repeat(32),
        payTo: `0x${'22'.repeat(20)}`,
        settledAmount: '2000',
        observation: decision.observation,
      },
    }).catch(() => {});
    const leaves = readIntakeLeaves(box.store.dir).leaves;
    assert.equal(leaves.length, 1);
    const line = Buffer.from(leaves[0].line, 'hex');
    assert.equal(line.subarray(10, 42).toString('hex'), chainHash);
  } finally {
    for (const name of Object.keys(env)) {
      if (prev[name] == null) delete process.env[name];
      else process.env[name] = prev[name];
    }
    setV13Runtime(null);
    await lag.close();
    rmSync(box.root, { recursive: true, force: true });
  }
});

test('FA8 recovery resends the committed set after finalized drops', async () => {
  resetHouseState();
  const box = world();
  const left = await startLagRpc({ lag: 0, latest: 20, salt: 'rec' });
  const right = await startLagRpc({ lag: 0, latest: 20, salt: 'rec' });
  const clock = { now: 7200 };
  try {
    await book(box, 3, 10, left.hashOf(10).slice(2));
    left.failNextSend();
    right.failNextSend();
    const who = await signer();
    const env = flags({
      CHIT_V13_SEALER_DIR: box.sealerDir,
      CHIT_SEALER_RPC_URL: PRIMARY,
      CHIT_SEALER_RPC_URL_2: SECONDARY,
    });
    const fetchImpl = routeLagFetch(left, right);
    const handle = await startV13AnchorScheduler({
      env,
      clock: () => clock.now,
      runtime: { store: box.store, client: who.client },
      deps: {
        testInjection: true,
        signer: who.signer,
        fetch: async (url, opts) => {
          const res = await fetchImpl(url, opts);
          return res;
        },
        timeoutMs: 1000,
      },
    });
    const crashed = await handle.tick();
    assert.equal(crashed.ok, false);
    const firstWire = left.sends[0] || right.sends[0];
    assert.ok(firstWire);
    const first = eip1559Decode(firstWire).data;
    left.pinFinalized(1);
    right.pinFinalized(1);
    const again = await handle.tick();
    assert.equal(again.ok, true, again.reason);
    const wires = left.sends.concat(right.sends);
    assert.ok(wires.length >= 2);
    assert.equal(eip1559Decode(wires[wires.length - 1]).data, first);
    await stopV13AnchorScheduler();
  } finally {
    await left.close();
    await right.close();
    rmSync(box.root, { recursive: true, force: true });
  }
});

test('FA9 a non-holder gets state only and an unknown id is the generic miss', async () => {
  resetHouseState();
  const box = world();
  mkdirSync(join(box.root, 'bind'), { recursive: true });
  const lag = await startLagRpc({ lag: 0, latest: 5, salt: 'get' });
  try {
    const booked = await book(box, 4, 1, lag.hashOf(1).slice(2));
    setV13Runtime({ store: box.store, dir: join(box.root, 'bind'), caller: box.caller, client: mockKms(), send: async () => '0x1' });
    const hidden = serveHousePending({ receiptId: booked.body.pending_id, paymentHeader: '' });
    assert.equal(hidden.status, 202);
    assert.equal(hidden.body.pending_id, booked.body.pending_id);
    assert.equal(hidden.body.line, undefined);
    assert.equal(hidden.body.proof, undefined);
    assert.equal(serveHousePending({ receiptId: 'ab'.repeat(16), paymentHeader: '' }), null);
  } finally {
    setV13Runtime(null);
    await lag.close();
    rmSync(box.root, { recursive: true, force: true });
  }
});

test('FA11 a non-base payment does not enter house issuance', async () => {
  resetHouseState();
  const { buildReceipt } = await import('../src/openai-gateway.js');
  const prev = {};
  const env = flags();
  for (const name of Object.keys(env)) {
    prev[name] = process.env[name];
    process.env[name] = env[name];
  }
  try {
    assert.equal(isBaseHousePayment({ chainId: null, network: 'solana', observation: null }), false);
    const before = houseIssueCallsForTest();
    const receipt = await buildReceipt({
      task: { taskId: 'fa11', status: 'completed', intent: { type: 'inference_request' }, meta: {} },
      taskId: 'fa11',
      provider: 'example-hub',
      mock: true,
      proverConfigured: false,
      baseUrl: 'http://127.0.0.1:9',
      payment: { chainId: null, network: 'solana', observation: null, ref: 'solana:sig' },
    });
    assert.equal(houseIssueCallsForTest(), before);
    assert.equal(receipt.v, undefined);
    assert.equal(receipt.surface, 'openai-v1');
  } finally {
    for (const name of Object.keys(env)) {
      if (prev[name] == null) delete process.env[name];
      else process.env[name] = prev[name];
    }
  }
});

test('FA15 a seeded dummy secret does not appear in the pending body', async () => {
  resetHouseState();
  const box = world();
  const secret = `alias/${'d'.repeat(8)}-dummy`;
  process.env.CHIT_CHECKPOINT_KMS_KEY_ID = secret;
  try {
    const out = await issueHouseReceipt({
      env: { ...flags(), CHIT_CHECKPOINT_KMS_KEY_ID: secret },
      dir: join(box.root, 'bind'),
      store: box.store,
      caller: box.caller,
      client: mockKms(),
      send: async () => '0x1',
      payment: payment(9, 1, 'ab'.repeat(32)),
      observation: {
        blockNumber: 1, finalizedNumber: null, blockHash: 'ab'.repeat(32), blockTime: 10,
        txIndex: 0, localLogIndex: 0, txHash: 'cd'.repeat(32), hourStart: 0,
      },
      log: [],
    });
    const text = JSON.stringify(out.body);
    assert.equal(text.includes(secret), false);
    assert.equal(text.includes('11'.repeat(65)), false);
  } finally {
    delete process.env.CHIT_CHECKPOINT_KMS_KEY_ID;
    rmSync(box.root, { recursive: true, force: true });
  }
});

test('FA17 an old intake row without finality is re-checked and not sealed early', async () => {
  resetHouseState();
  const box = world();
  const left = await startLagRpc({ lag: 400, latest: 20, salt: 'old' });
  const right = await startLagRpc({ lag: 400, latest: 20, salt: 'old' });
  const clock = { now: 7200 };
  try {
    const booked = await book(box, 8, 10, left.hashOf(10).slice(2));
    assert.equal(booked.status, 202);
    const file = join(box.store.dir, 'pending-intake.json');
    const parsed = JSON.parse(readFileSync(file, 'utf8'));
    delete parsed.leaves[0].finality;
    writeFileSync(file, JSON.stringify(parsed));
    const handle = await boot(box, left, right, clock);
    const waiting = await handle.tick();
    assert.equal(waiting.ok, true);
    assert.equal(left.sends.length, 0);
    assert.equal(box.store.epochs.size, 0);
    await stopV13AnchorScheduler();
  } finally {
    await left.close();
    await right.close();
    rmSync(box.root, { recursive: true, force: true });
    setV13Runtime(null);
  }
});

test('FA7 reorg is not sealed, and a live pending row still conflicts', async () => {
  resetHouseState();
  const box = world();
  const left = await startLagRpc({ lag: 0, latest: 20, salt: 're' });
  const right = await startLagRpc({ lag: 0, latest: 20, salt: 're' });
  const clock = { now: 7200 };
  try {
    await book(box, 6, 10, left.hashOf(10).slice(2));
    left.reorg(10);
    right.reorg(10);
    const handle = await boot(box, left, right, clock);
    const tick = await handle.tick();
    assert.equal(left.sends.length, 0, tick.reason);
    const leaves = readIntakeLeaves(box.store.dir).leaves;
    assert.equal(leaves[0].state, 'reorged');
    const live = await book(box, 7, 10, left.hashOf(12).slice(2));
    const second = readIntakeLeaves(box.store.dir).leaves.find((row) => row.pendingId === live.body.pending_id);
    const clash = bookLeaf(openIntake(box.store.dir), {
      paymentRef: second.paymentRef,
      line: leaves[0].line,
      caller: box.caller,
      rebookedFrom: 'bb'.repeat(32),
    });
    assert.equal(clash.ok, false);
    assert.equal(clash.reason, 'intake_conflict');
    const rightHash = createHash('sha256').update(Buffer.from(second.line, 'hex')).digest('hex');
    const pendingClash = bookLeaf(openIntake(box.store.dir), {
      paymentRef: second.paymentRef,
      line: leaves[0].line,
      caller: box.caller,
      rebookedFrom: rightHash,
    });
    assert.equal(pendingClash.ok, false);
    assert.equal(pendingClash.reason, 'intake_conflict');
    await stopV13AnchorScheduler();
  } finally {
    await left.close();
    await right.close();
    rmSync(box.root, { recursive: true, force: true });
    setV13Runtime(null);
  }
});

test('MF12 gone without a cleared authorization stays reorged', async () => {
  resetHouseState();
  const box = world();
  const left = await startLagRpc({ lag: 0, latest: 20, salt: 'gone' });
  const right = await startLagRpc({ lag: 0, latest: 20, salt: 'gone' });
  const clock = { now: 7200 };
  try {
    await book(box, 11, 10, left.hashOf(10).slice(2));
    const row = readIntakeLeaves(box.store.dir).leaves[0];
    updateLeaf(box.store.dir, row.paymentRef, (target) => { target.state = 'reorged'; });
    const handle = await boot(box, left, right, clock);
    await handle.tick();
    const after = readIntakeLeaves(box.store.dir).leaves[0];
    assert.equal(after.state, 'reorged');
    await stopV13AnchorScheduler();
  } finally {
    await left.close();
    await right.close();
    rmSync(box.root, { recursive: true, force: true });
    setV13Runtime(null);
  }
});

test('FA3-min two finalized heads use the lower one', { timeout: 15000 }, async () => {
  resetHouseState();
  const box = world();
  const left = await startLagRpc({ lag: 0, latest: 40, salt: 'min' });
  const right = await startLagRpc({ lag: 0, latest: 40, salt: 'min' });
  const clock = { now: 7200 };
  try {
    left.pinFinalized(30);
    right.pinFinalized(5);
    await book(box, 21, 20, left.hashOf(20).slice(2));
    const handle = await boot(box, left, right, clock);
    const tick = await handle.tick();
    assert.equal(tick.ok, true, tick.reason);
    assert.equal(left.sends.length + right.sends.length, 0);
    await stopV13AnchorScheduler();
  } finally {
    await left.close();
    await right.close();
    rmSync(box.root, { recursive: true, force: true });
    setV13Runtime(null);
  }
});

test('a mismatched leaf hash is not sealed when the row stays pending', async () => {
  const { closeHour, openSealer } = await import('../../chit-sealer/close.js');
  resetHouseState();
  const box = world();
  try {
    await book(box, 22, 10, 'ab'.repeat(32));
    const who = await signer();
    const sealer = openSealer({
      dir: box.sealerDir,
      store: box.store,
      signer: who.signer,
      chainId: 8453n,
      contract: MAINNET_CHECKPOINT,
      clock: () => 7200,
    });
    const point = { ok: true, F: 100n, blocks: new Map([['10', ['ff'.repeat(32)]]]) };
    await closeHour(sealer, {
      hourStart: 0,
      lines: [],
      fees: { gasLimit: '300000', maxFeePerGas: '10', maxPriorityFeePerGas: '1' },
      send: async () => `0x${'ab'.repeat(32)}`,
      finalityPoint: point,
    });
    const hex = readIntakeLeaves(box.store.dir).leaves[0].line;
    let found = false;
    for (const item of box.store.receipts.values()) if (item.line === hex) found = true;
    assert.equal(found, false);
  } finally {
    rmSync(box.root, { recursive: true, force: true });
  }
});

test('FA12 a Solana pending confirmation is a resolvable hold', async () => {
  const http = await import('node:http');
  const { settleBoundPayment } = await import('../src/x402-settle.js');
  const { ChallengeStore } = await import('../src/x402-adapter.js');
  const { openAiFailurePayload } = await import('../src/openai-gateway.js');
  const fac = await new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      req.on('data', () => {});
      req.on('end', () => {
      res.setHeader('content-type', 'application/json');
      const settled = String(req.url || '').endsWith('/settle');
      res.end(JSON.stringify(settled
        ? { success: true, settled: true, transaction: 'sig', txRef: 'sig', network: 'solana', payer: 'SoLPayer1111111111111111111111111111111111' }
        : { isValid: true, valid: true, payer: 'SoLPayer1111111111111111111111111111111111' }));
      });
    });
    server.listen(0, '127.0.0.1', () => resolve({
      url: `http://127.0.0.1:${server.address().port}`,
      close: () => new Promise((done) => server.close(done)),
    }));
  });
  const store = new ChallengeStore();
  const solHouse = '2SKNEcAnVCiKtFwWhYvj3QjSLepR4eh8rDpHab3xPtP1';
  const solMint = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
  const solFee = 'SoLFeePayer11111111111111111111111111111111';
  const nonce = `0x${'c3'.repeat(32)}`;
  const header = Buffer.from(JSON.stringify({
    x402Version: 2,
    network: 'solana',
    accepted: {
      scheme: 'exact', network: 'solana', amount: '2000', payTo: solHouse, asset: solMint, extra: { feePayer: solFee },
    },
    payload: { transaction: 'AQAAAA==' },
  })).toString('base64');
  store.put(nonce, {
    taskId: 'fa12', amount: '2000', asset: solMint,
    network: 'solana', payTo: solHouse,
    resource: '/v1/chat/completions', state: 'issued', expiresAt: Date.now() + 60_000, nonce,
    feePayer: solFee,
  });
  const decision = await settleBoundPayment({
    req: { headers: {} },
    taskId: 'fa12',
    amount: '2000',
    nonce,
    paymentHeader: header,
    clientVersion: 2,
    resource: '/v1/chat/completions',
    store,
    cfg: {
      network: 'solana',
      payTo: '2SKNEcAnVCiKtFwWhYvj3QjSLepR4eh8rDpHab3xPtP1',
      asset: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
      solana: {
        enabled: true,
        network: 'solana',
        payTo: '2SKNEcAnVCiKtFwWhYvj3QjSLepR4eh8rDpHab3xPtP1',
        facilitatorUrl: fac.url,
      },
      solanaRpcUrl: 'http://127.0.0.1:9',
      facilitatorProvider: 'zan',
      gatewayUrl: fac.url,
      apiKey: 'k',
      chainReader: async () => ({ ok: false, pending: true, code: 'settle_unconfirmed' }),
    },
  });
  try {
    assert.equal(decision.code, 'settle_pending', decision.reason);
    assert.notEqual(openAiFailurePayload(decision).status, 402);
    assert.equal(typeof decision.pendingId, 'string');
  } finally {
    await fac.close();
  }
});

test('a reorged row is not sealed even when its hash still matches', async () => {
  resetHouseState();
  const box = world();
  const left = await startLagRpc({ lag: 0, latest: 20, salt: 'keep' });
  const right = await startLagRpc({ lag: 0, latest: 20, salt: 'keep' });
  const clock = { now: 7200 };
  try {
    const hash = left.hashOf(10).slice(2);
    await book(box, 30, 10, hash);
    await book(box, 31, 10, hash);
    const rows = readIntakeLeaves(box.store.dir).leaves;
    updateLeaf(box.store.dir, rows[0].paymentRef, (target) => { target.state = 'reorged'; });
    const handle = await boot(box, left, right, clock);
    const tick = await handle.tick();
    assert.equal(tick.ok, true, tick.reason);
    const after = readIntakeLeaves(box.store.dir).leaves;
    const reorged = after.find((row) => row.paymentRef === rows[0].paymentRef);
    assert.equal(reorged.state, 'reorged');
    assert.equal(reorged.receiptId, null);
    let sealedReorg = false;
    for (const item of box.store.receipts.values()) {
      if (item.line === reorged.line) sealedReorg = true;
    }
    assert.equal(sealedReorg, false);
    await stopV13AnchorScheduler();
  } finally {
    await left.close();
    await right.close();
    rmSync(box.root, { recursive: true, force: true });
    setV13Runtime(null);
  }
});

test('FA9 a released receipt body is not returned without the payment header', async () => {
  resetHouseState();
  const box = world();
  mkdirSync(join(box.root, 'bind'), { recursive: true });
  try {
    const booked = await book(box, 31, 1, 'ab'.repeat(32));
    const row = readIntakeLeaves(box.store.dir).leaves[0];
    const receiptId = 'cc'.repeat(16);
    updateLeaf(box.store.dir, row.paymentRef, (target) => {
      target.receiptId = receiptId;
      target.epoch = 1;
    });
    box.store.epochs.set('1', {
      epoch: 1, released: true, hourStart: 0, size: 1,
      root: 'ab'.repeat(32), stateRoot: 'cd'.repeat(32),
    });
    box.store.receipts.set(receiptId, {
      id: receiptId, bookId: box.book.id, epoch: 1, index: 0, line: row.line,
      proof: [], epochProof: '00'.repeat(32), paymentProof: '00'.repeat(32),
      saltedBook: '11'.repeat(32), slotKey: '22'.repeat(32), slotValue: '33'.repeat(32),
      slotProof: '44'.repeat(32),
    });
    setV13Runtime({ store: box.store, dir: join(box.root, 'bind'), caller: box.caller, client: mockKms(), send: async () => '0x1' });
    const hidden = serveHousePending({ receiptId: booked.body.pending_id, paymentHeader: '' });
    assert.equal(hidden.status, 200);
    assert.equal(hidden.body.v, undefined);
    assert.equal(hidden.body.line, undefined);
    assert.equal(hidden.body.state, 'released');
    assert.equal(hidden.body.pending_id, booked.body.pending_id);
  } finally {
    setV13Runtime(null);
    rmSync(box.root, { recursive: true, force: true });
  }
});

test('M3 a missing transaction index is a 202 and not a booked line', async () => {
  resetHouseState();
  const box = world();
  try {
    const out = await issueHouseReceipt({
      env: flags(),
      dir: join(box.root, 'bind'),
      store: box.store,
      caller: box.caller,
      client: mockKms(),
      send: async () => '0x1',
      payment: payment(40, 10, 'ab'.repeat(32)),
      observation: {
        blockNumber: 10,
        blockHash: 'ab'.repeat(32),
        blockTime: 1_700_000_000,
        txIndex: null,
        localLogIndex: 1,
        txHash: 'cd'.repeat(32),
      },
    });
    mkdirSync(join(box.root, 'bind'), { recursive: true });
    assert.equal(out.status, 202);
    assert.equal(readIntakeLeaves(box.store.dir).leaves.length, 0);
  } finally {
    rmSync(box.root, { recursive: true, force: true });
  }
});

test('M8 a status-1 read with no block hash is 202 and a later read books one leaf', async () => {
  resetHouseState();
  const box = world();
  mkdirSync(join(box.root, 'bind'), { recursive: true });
  try {
    const first = await issueHouseReceipt({
      env: flags(),
      dir: join(box.root, 'bind'),
      store: box.store,
      caller: box.caller,
      client: mockKms(),
      send: async () => '0x1',
      payment: payment(41, 10, 'ab'.repeat(32)),
      observation: { blockNumber: 10, blockHash: null, blockTime: null, txIndex: 1, localLogIndex: 1, txHash: 'cd'.repeat(32) },
    });
    assert.equal(first.status, 202);
    assert.match(first.body.pending_id, /^[0-9a-f]{32}$/);
    assert.equal(readIntakeLeaves(box.store.dir).leaves.length, 0);
    const second = await book(box, 41, 10, 'ab'.repeat(32));
    assert.equal(second.status, 202);
    assert.equal(readIntakeLeaves(box.store.dir).leaves.length, 1);
  } finally {
    rmSync(box.root, { recursive: true, force: true });
  }
});

test('S1 closeHour without a finality point seals no intake leaf', async () => {
  const { closeHour, openSealer } = await import('../../chit-sealer/close.js');
  resetHouseState();
  const box = world();
  try {
    await book(box, 42, 10, 'ab'.repeat(32));
    const who = await signer();
    const sealer = openSealer({
      dir: box.sealerDir,
      store: box.store,
      signer: who.signer,
      chainId: 8453n,
      contract: '0xC16010f028A00A3addb37609c38D010ec1dF93b1',
      clock: () => 7200,
    });
    const closed = await closeHour(sealer, {
      hourStart: 0,
      lines: [],
      fees: { gasLimit: '21000', maxFeePerGas: '1', maxPriorityFeePerGas: '1' },
      send: async () => '0x1',
    });
    assert.equal(box.store.receipts.size, 0, closed && closed.reason);
  } finally {
    rmSync(box.root, { recursive: true, force: true });
  }
});

test('S2 a hand-edited final row above F is not sealed', async () => {
  resetHouseState();
  const box = world();
  const left = await startLagRpc({ lag: 400, latest: 20, salt: 'hand' });
  const right = await startLagRpc({ lag: 400, latest: 20, salt: 'hand' });
  const clock = { now: 7200 };
  try {
    await book(box, 43, 10, left.hashOf(10).slice(2));
    const file = join(box.store.dir, 'pending-intake.json');
    const parsed = JSON.parse(readFileSync(file, 'utf8'));
    parsed.leaves[0].finality = 'final';
    writeFileSync(file, JSON.stringify(parsed));
    const handle = await boot(box, left, right, clock);
    const tick = await handle.tick();
    assert.equal(left.sends.length, 0, tick.reason);
    await stopV13AnchorScheduler();
  } finally {
    await left.close();
    await right.close();
    rmSync(box.root, { recursive: true, force: true });
    setV13Runtime(null);
  }
});

test('M7 an empty eth_call word does not mean the authorization is clear', async () => {
  const { authorizationCleared } = await import('../../chit-sealer/rpc-base.js');
  const server = http.createServer((req, res) => {
    let raw = '';
    req.on('data', (chunk) => { raw += chunk; });
    req.on('end', () => {
      const body = JSON.parse(raw || '{}');
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify({ jsonrpc: '2.0', id: body.id, result: '0x' }));
    });
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  try {
    const cleared = await authorizationCleared({
      urls: [`http://127.0.0.1:${server.address().port}`],
      token: `0x${'11'.repeat(20)}`,
      authorizer: '22'.repeat(20),
      nonce: '33'.repeat(32),
    });
    assert.equal(cleared, false);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

void createPublicKey;
