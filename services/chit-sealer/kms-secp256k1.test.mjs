/**
 * Checkpoint signer with an injected KMS client. No network, no credentials,
 * no env-key fallback.
 */
import { readFileSync } from 'node:fs';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { bytesToBig, hexToBytes } from '../../packages/cs2-core/ecdsa/bytes.js';
import { P256, SECP256K1, eip1559Decode, highSDer, publicPoint, signRawDigest } from '../../packages/cs2-core/ecdsa/index.js';
import {
  broadcastAnchor,
  broadcastCommittedAnchor,
  bumpAnchorFees,
  bumpFeeQuote,
  commitAnchorIntent,
  createCheckpointSigner,
  openAnchorIntentLog,
  signCommittedAnchor,
} from './kms-secp256k1.js';

const q14 = JSON.parse(readFileSync(new URL('../../packages/cs2-core/ecdsa/vectors/q14-dry-run.json', import.meta.url), 'utf8'));

function env(extra = {}) {
  return {
    CHIT_CHECKPOINT_KMS_KEY_ID: 'alias/chit-checkpoint-test',
    CHIT_CHECKPOINT_KMS_REGION: 'us-east-1',
    ...extra,
  };
}

function q14Anchor() {
  return {
    chainId: q14.chainId,
    to: q14.contract,
    nonce: q14.nonce,
    epoch: q14.epoch,
    hourStart: q14.hourStart,
    size: q14.size,
    root: q14.root,
    stateRoot: q14.stateRoot,
    calldata: q14.calldata,
  };
}

function mockKms({ spki = q14.spki, signature = q14.kms_der_high_s, signError = null, keySpec = 'ECC_SECG_P256K1' } = {}) {
  const calls = [];
  return {
    calls,
    async send(command, options = {}) {
      calls.push({
        name: command?.name,
        input: command?.input,
        message: command?.input?.Message ? Buffer.from(command.input.Message) : null,
        options,
      });
      if (command?.name === 'GetPublicKey') {
        return {
          KeySpec: keySpec,
          KeyUsage: 'SIGN_VERIFY',
          SigningAlgorithms: ['ECDSA_SHA_256'],
          PublicKey: Buffer.from(spki, 'hex'),
        };
      }
      if (signError) throw signError;
      return { Signature: Buffer.from(signature, 'hex') };
    },
  };
}

function liveMock(d = 0xA11CEn) {
  const pub = publicPoint(d, SECP256K1);
  const calls = [];
  return {
    calls,
    pub,
    async send(command, options = {}) {
      calls.push({ name: command?.name, input: command?.input, options });
      if (command?.name === 'GetPublicKey') {
        const jwk = {
          kty: 'EC',
          crv: 'secp256k1',
          x: Buffer.from(pub.subarray(1, 33)).toString('base64url'),
          y: Buffer.from(pub.subarray(33)).toString('base64url'),
        };
        const { createPublicKey } = await import('node:crypto');
        return {
          KeySpec: 'ECC_SECG_P256K1',
          KeyUsage: 'SIGN_VERIFY',
          SigningAlgorithms: ['ECDSA_SHA_256'],
          PublicKey: createPublicKey({ key: jwk, format: 'jwk' }).export({ type: 'spki', format: 'der' }),
        };
      }
      if (command?.input?.MessageType !== 'DIGEST') throw new Error('kms message type');
      const digest = new Uint8Array(command.input.Message);
      let k = (bytesToBig(digest) % (SECP256K1.order - 3n)) + 2n;
      let sig;
      for (let i = 0; i < 4; i += 1) {
        try {
          sig = signRawDigest(digest, d, k, SECP256K1);
          break;
        } catch (err) {
          if (err.code !== 'bad_nonce') throw err;
          k += 1n;
        }
      }
      return { Signature: highSDer(sig.raw, SECP256K1) };
    },
  };
}

function memoryLog() {
  const order = [];
  const mem = { text: '' };
  const io = {
    mkdirSync() { order.push('mkdir'); },
    openSync() { order.push('open'); return 7; },
    writeSync(_fd, line) { order.push('write'); mem.text += line; return line.length; },
    fsyncSync() { order.push('fsync'); },
    closeSync() { order.push('close'); },
    existsSync() { return mem.text.length > 0; },
    readFileSync() { return mem.text; },
  };
  return { log: openAnchorIntentLog('/tmp/unused-intent-dir', io), order, mem };
}

test('the signer module has no env-key fallback and does not import a cloud client', () => {
  const src = readFileSync(new URL('./kms-secp256k1.js', import.meta.url), 'utf8');
  assert.equal(/PRIVATE_KEY|MNEMONIC|createPrivateKey|signRawDigest|@aws-sdk|from 'ethers'/.test(src), false);
  assert.equal(src.toLowerCase().includes('ffffffff00000000ffffffffffffffffbce6faada7179e84f3b9cac2fc632551'), false);
});

test('a missing client or config refuses, even when an env private key is set', async () => {
  const poisoned = env({
    CHECKPOINT_PRIVATE_KEY: `0x${'ab'.repeat(32)}`,
    RECEIPT_ANCHOR_PRIVATE_KEY: `0x${'cd'.repeat(32)}`,
    CHIT_CHECKPOINT_PRIVATE_KEY: `0x${'11'.repeat(32)}`,
  });
  await assert.rejects(() => createCheckpointSigner({ env: poisoned }), (err) => err.code === 'checkpoint_kms_config');
  await assert.rejects(
    () => createCheckpointSigner({ client: {}, env: poisoned }),
    (err) => err.code === 'checkpoint_kms_config',
  );
  await assert.rejects(
    () => createCheckpointSigner({ client: mockKms(), env: { CHIT_CHECKPOINT_KMS_KEY_ID: 'alias/x' } }),
    (err) => err.code === 'checkpoint_kms_config',
  );
});

test('the kms path reads no private-key env and a KMS failure does not sign', async () => {
  const seen = [];
  const box = new Proxy(env({
    CHECKPOINT_PRIVATE_KEY: `0x${'ab'.repeat(32)}`,
    RECEIPT_ANCHOR_PRIVATE_KEY: `0x${'cd'.repeat(32)}`,
    ISSUER_PRIVATE_KEY: 'pem',
  }), {
    get(target, prop, receiver) {
      if (typeof prop === 'string' && /PRIVATE_KEY|MNEMONIC|SECRET/.test(prop)) seen.push(prop);
      return Reflect.get(target, prop, receiver);
    },
  });
  const client = mockKms({ signError: Object.assign(new Error('throttled'), { name: 'ThrottlingException' }) });
  const signer = await createCheckpointSigner({ client, env: box });
  assert.equal(signer.kind, 'kms-secp256k1');
  assert.equal(signer.address, q14.address);
  await assert.rejects(() => signer.signDigest(hexToBytes(q14.digest)), (err) => err.code === 'checkpoint_sign_unavailable');
  assert.deepEqual(seen, []);
  const signCall = client.calls.filter((call) => call.name === 'Sign').at(-1);
  assert.equal(signCall.input.MessageType, 'DIGEST');
  assert.equal(signCall.input.SigningAlgorithm, 'ECDSA_SHA_256');
  assert.equal(signCall.message.length, 32);
});

test('wrong key spec, usage, or address pin is refused', async () => {
  await assert.rejects(
    () => createCheckpointSigner({ client: mockKms({ keySpec: 'ECC_NIST_P256' }), env: env() }),
    (err) => err.code === 'checkpoint_key_type',
  );
  const badUsage = mockKms();
  badUsage.send = async (command) => {
    if (command.name === 'GetPublicKey') {
      return { KeySpec: 'ECC_SECG_P256K1', KeyUsage: 'ENCRYPT_DECRYPT', SigningAlgorithms: ['ECDSA_SHA_256'], PublicKey: Buffer.from(q14.spki, 'hex') };
    }
    return { Signature: Buffer.from(q14.kms_der_high_s, 'hex') };
  };
  await assert.rejects(() => createCheckpointSigner({ client: badUsage, env: env() }), (err) => err.code === 'checkpoint_key_type');
  await assert.rejects(
    () => createCheckpointSigner({ client: mockKms(), env: env({ CHIT_CHECKPOINT_ADDRESS: `0x${'44'.repeat(20)}` }) }),
    (err) => err.code === 'checkpoint_address_mismatch',
  );
});

test('Q14 dry-run: DIGEST, high-S DER, secp256k1 low-S, y-parity, intent before broadcast', async () => {
  const client = mockKms();
  const signer = await createCheckpointSigner({
    client,
    env: env({ CHIT_CHECKPOINT_ADDRESS: q14.address.toUpperCase().replace('0X', '0x') }),
  });
  const { log, order } = memoryLog();
  let sawIntent = false;
  let sawSigned = false;
  const sent = [];
  const result = await broadcastAnchor({
    signer,
    log,
    anchor: q14Anchor(),
    fees: q14.fees,
    send(raw) {
      const rows = log.read();
      sawIntent = rows.some((row) => row.status === 'intent' && row.epoch === '1' && row.root === q14.root);
      sawSigned = rows.some((row) => row.status === 'signed' && `0x${row.raw}` === q14.raw);
      assert.ok(order.indexOf('write') < order.indexOf('fsync'));
      assert.ok(order.filter((step) => step === 'fsync').length >= 2);
      sent.push(raw);
      return '0x' + 'ab'.repeat(32);
    },
  });
  assert.equal(sawIntent, true);
  assert.equal(sawSigned, true);
  assert.deepEqual(sent, [q14.raw]);
  assert.equal(result.status, 'broadcast');
  assert.equal(result.tx, `0x${'ab'.repeat(32)}`);
  const signCall = client.calls.filter((call) => call.name === 'Sign').at(-1);
  assert.equal(signCall.input.MessageType, 'DIGEST');
  assert.equal(signCall.message.toString('hex'), q14.digest);
  assert.equal(signCall.input.SigningAlgorithm, 'ECDSA_SHA_256');
  const decoded = eip1559Decode(q14.raw);
  const s = BigInt(`0x${decoded.s}`);
  const highS = SECP256K1.order - s;
  assert.equal(s, bytesToBig(hexToBytes(q14.low_s).subarray(32)));
  assert.notEqual(s, P256.order - highS);
  assert.equal(decoded.yParity, q14.y_parity);
  assert.equal(decoded.data, q14.calldata);
  assert.equal(result.domain, q14.domain);
  assert.equal(result.hourStart, String(q14.hourStart));
});

test('a live mock KMS signature round-trips and a second send reuses the raw bytes', async () => {
  const client = liveMock();
  const signer = await createCheckpointSigner({ client, env: env() });
  const dir = mkdtempSync(join(tmpdir(), 'chit-intent-'));
  const log = openAnchorIntentLog(dir);
  const anchor = q14Anchor();
  const fees = q14.fees;
  let first;
  const sent = [];
  first = await broadcastAnchor({
    signer,
    log,
    anchor,
    fees,
    send(raw) {
      sent.push(raw);
      const rows = log.read();
      assert.ok(rows.some((row) => row.status === 'intent'));
      assert.ok(rows.some((row) => row.status === 'signed' && `0x${row.raw}` === raw));
      return '0x' + '11'.repeat(32);
    },
  });
  assert.equal(client.calls.filter((call) => call.name === 'Sign').length, 1);
  const again = await broadcastAnchor({
    signer,
    log,
    anchor,
    fees,
    send(raw) {
      sent.push(raw);
      return '0x' + '11'.repeat(32);
    },
  });
  assert.equal(client.calls.filter((call) => call.name === 'Sign').length, 1);
  assert.equal(sent[0], sent[1]);
  assert.equal(again.raw, first.raw);
  const decoded = eip1559Decode(sent[0]);
  const s = BigInt(`0x${decoded.s}`);
  assert.ok(s <= (SECP256K1.order >> 1n));
  assert.equal(decoded.data, q14.calldata);
  assert.equal(decoded.nonce, 0n);
});

test('KMS failure after the intent is committed does not broadcast and does not fall back', async () => {
  const client = mockKms({ signError: new Error('timeout') });
  const signer = await createCheckpointSigner({ client, env: env({ RECEIPT_ANCHOR_PRIVATE_KEY: `0x${'22'.repeat(32)}` }) });
  const { log } = memoryLog();
  let sent = 0;
  await assert.rejects(
    () => broadcastAnchor({
      signer,
      log,
      anchor: q14Anchor(),
      fees: q14.fees,
      send() { sent += 1; return '0x1'; },
    }),
    (err) => err.code === 'checkpoint_sign_unavailable',
  );
  assert.equal(sent, 0);
  const rows = log.read();
  assert.equal(rows.length, 1);
  assert.equal(rows[0].status, 'intent');
  assert.equal(rows[0].raw, null);
});

test('a rebuilt epoch at a used nonce is refused before another signature', async () => {
  const client = mockKms();
  const signer = await createCheckpointSigner({ client, env: env() });
  const dir = mkdtempSync(join(tmpdir(), 'chit-intent-'));
  const log = openAnchorIntentLog(dir);
  await broadcastAnchor({
    signer,
    log,
    anchor: q14Anchor(),
    fees: q14.fees,
    send() { return '0x' + '33'.repeat(32); },
  });
  const signs = client.calls.filter((call) => call.name === 'Sign').length;
  const rebuilt = { ...q14Anchor(), epoch: 2 };
  assert.throws(
    () => commitAnchorIntent(log, rebuilt, signer.address),
    (err) => err.code === 'nonce_payload_conflict',
  );
  assert.equal(client.calls.filter((call) => call.name === 'Sign').length, signs);
});

test('the same nonce refuses a different hourStart even when the calldata is unchanged', async () => {
  const { log } = memoryLog();
  commitAnchorIntent(log, q14Anchor(), q14.address);
  assert.throws(
    () => commitAnchorIntent(log, { ...q14Anchor(), hourStart: q14.hourStart + 3600 }, q14.address),
    (err) => err.code === 'nonce_payload_conflict',
  );
});

test('calldata that omits the domain is refused before KMS', async () => {
  const client = mockKms();
  const signer = await createCheckpointSigner({ client, env: env() });
  const { log } = memoryLog();
  const anchor = { ...q14Anchor(), calldata: q14.root + q14.stateRoot };
  assert.throws(
    () => commitAnchorIntent(log, anchor, signer.address),
    (err) => err.code === 'intent_payload_mismatch',
  );
  assert.equal(client.calls.some((call) => call.name === 'Sign'), false);
});

test('broadcast without a committed intent does not send', async () => {
  const { log } = memoryLog();
  let sent = 0;
  await assert.rejects(
    () => broadcastCommittedAnchor(log, { nonce: 0, fees: q14.fees }, () => { sent += 1; return '0x1'; }),
    (err) => err.code === 'intent_missing',
  );
  assert.equal(sent, 0);
  log.append({
    v: 1,
    op: 'anchor_intent',
    status: 'signed',
    nonce: '0',
    fingerprint: 'aa',
    raw: '02',
    fees: q14.fees,
    from: q14.address,
  });
  await assert.rejects(
    () => broadcastCommittedAnchor(log, { nonce: 0, fees: q14.fees }, () => { sent += 1; return '0x1'; }),
    (err) => err.code === 'intent_missing',
  );
  assert.equal(sent, 0);
});

test('a fee bump keeps the nonce and the calldata and writes the new raw before send', async () => {
  const client = liveMock();
  const signer = await createCheckpointSigner({ client, env: env() });
  const dir = mkdtempSync(join(tmpdir(), 'chit-intent-'));
  const log = openAnchorIntentLog(dir);
  const first = await broadcastAnchor({
    signer,
    log,
    anchor: q14Anchor(),
    fees: q14.fees,
    send() { return '0x' + '55'.repeat(32); },
  });
  const quote = bumpFeeQuote(q14.fees);
  assert.equal(quote.gasLimit, BigInt(q14.fees.gasLimit));
  assert.equal(quote.maxFeePerGas, (BigInt(q14.fees.maxFeePerGas) * 110n) / 100n + 1n);
  assert.equal(quote.maxPriorityFeePerGas, (BigInt(q14.fees.maxPriorityFeePerGas) * 110n) / 100n + 1n);
  let ready = false;
  const bumped = await bumpAnchorFees({
    signer,
    log,
    nonce: q14.nonce,
    fees: quote,
    send(raw) {
      const rows = log.read();
      ready = rows.some((row) => row.status === 'signed' && `0x${row.raw}` === raw && row.fees.maxFeePerGas === quote.maxFeePerGas.toString());
      return '0x' + '66'.repeat(32);
    },
  });
  assert.equal(ready, true);
  assert.notEqual(bumped.raw, first.raw);
  const a = eip1559Decode(`0x${first.raw}`);
  const b = eip1559Decode(`0x${bumped.raw}`);
  assert.equal(a.data, b.data);
  assert.equal(a.nonce, b.nonce);
  assert.notEqual(a.maxFeePerGas, b.maxFeePerGas);
  assert.equal(client.calls.filter((call) => call.name === 'Sign').length, 2);
  assert.equal(b.s.length, 64);
  assert.ok(BigInt(`0x${b.s}`) <= (SECP256K1.order >> 1n));
});

test('sign without an intent does not call KMS', async () => {
  const client = mockKms();
  const signer = await createCheckpointSigner({ client, env: env() });
  const { log } = memoryLog();
  await assert.rejects(
    () => signCommittedAnchor(signer, log, { nonce: 0, fees: q14.fees }),
    (err) => err.code === 'intent_missing',
  );
  assert.equal(client.calls.some((call) => call.name === 'Sign'), false);
});

test('a signature that does not recover to the KMS key is refused', async () => {
  const other = publicPoint(4n, SECP256K1);
  const digest = hexToBytes(q14.digest);
  const sig = signRawDigest(digest, 4n, 8n, SECP256K1);
  const client = mockKms({ signature: Buffer.from(highSDer(sig.raw, SECP256K1)).toString('hex') });
  const signer = await createCheckpointSigner({ client, env: env() });
  await assert.rejects(() => signer.signDigest(digest), (err) => err.code === 'checkpoint_sign_invalid');
  assert.notEqual(other[1], 0);
});

test('a digest that is not 32 bytes is refused before KMS', async () => {
  const client = mockKms();
  const signer = await createCheckpointSigner({ client, env: env() });
  const before = client.calls.filter((call) => call.name === 'Sign').length;
  await assert.rejects(() => signer.signDigest(new Uint8Array(31)), (err) => err.code === 'checkpoint_sign_invalid');
  assert.equal(client.calls.filter((call) => call.name === 'Sign').length, before);
});

test('GetPublicKey failure is unavailable and does not sign', async () => {
  const client = {
    async send() { throw new Error('network'); },
  };
  await assert.rejects(
    () => createCheckpointSigner({ client, env: env({ CHECKPOINT_PRIVATE_KEY: '0xabc' }) }),
    (err) => err.code === 'checkpoint_sign_unavailable',
  );
});
