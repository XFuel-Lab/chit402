/**
 * KMS signer with an injected client. NODE_ENV=test. No network.
 */
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { GetPublicKeyCommand, SignCommand } from '@aws-sdk/client-kms';

const gatewayRoot = fileURLToPath(new URL('..', import.meta.url));
const N = BigInt('0xFFFFFFFF00000000FFFFFFFFFFFFFFFFBCE6FAADA7179E84F3B9CAC2FC632551');
const KEY_ID = 'alias/chit402-issuer-test-unique';

const saved = {};
for (const key of ['ISSUER_SIGNER', 'ISSUER_KMS_KEY_ID', 'ISSUER_KMS_REGION', 'ISSUER_KMS_TIMEOUT_MS', 'ISSUER_KID', 'ISSUER_PRIVATE_KEY', 'ISSUER_SIGNER_LOW_S']) {
  saved[key] = process.env[key];
}

const { createKmsSigner } = await import('../src/issuer-signer-kms.js');
const { _setIssuerSignerForTest } = await import('../src/issuer-signer.js');
const { signJws, signJwsAsync, _resetIssuerKey, getIssuerKid } = await import('../src/issuer-key.js');
const { signPinnedClosedHead } = await import('../src/receipt-merkle.js');
const { buildReceipt } = await import('../src/receipt.js');

function restore() {
  for (const [key, value] of Object.entries(saved)) {
    if (value == null) delete process.env[key];
    else process.env[key] = value;
  }
  _resetIssuerKey();
  _setIssuerSignerForTest(null);
}

after(restore);

function pair() {
  return crypto.generateKeyPairSync('ec', { namedCurve: 'P-256' });
}

function spki(publicKey) {
  return publicKey.export({ type: 'spki', format: 'der' });
}

function kidOf(publicKey) {
  const jwk = publicKey.export({ format: 'jwk' });
  const canonical = JSON.stringify({ crv: jwk.crv, kty: jwk.kty, x: jwk.x, y: jwk.y });
  return crypto.createHash('sha256').update(canonical).digest('base64url');
}

function derInt(buf) {
  let v = Buffer.from(buf);
  if (v[0] & 0x80) v = Buffer.concat([Buffer.from([0x00]), v]);
  return Buffer.concat([Buffer.from([0x02, v.length]), v]);
}

function derSeq(r, s) {
  const body = Buffer.concat([derInt(r), derInt(s)]);
  if (body.length < 128) return Buffer.concat([Buffer.from([0x30, body.length]), body]);
  return Buffer.concat([Buffer.from([0x30, 0x81, body.length]), body]);
}

function kmsEnv(publicKey, extra = {}) {
  process.env.NODE_ENV = 'test';
  process.env.ISSUER_SIGNER = 'kms';
  process.env.ISSUER_KMS_KEY_ID = KEY_ID;
  process.env.ISSUER_KMS_REGION = 'us-east-1';
  process.env.ISSUER_KMS_TIMEOUT_MS = extra.timeout || '3000';
  process.env.ISSUER_KID = extra.kid === undefined ? kidOf(publicKey) : extra.kid;
  delete process.env.ISSUER_PRIVATE_KEY;
  _resetIssuerKey();
}

function mockClient(privateKey, publicKey, hooks = {}) {
  const calls = [];
  return {
    calls,
    async send(command, options = {}) {
      const input = command.input || {};
      calls.push({ name: command.constructor.name, input: { ...input, Message: input.Message ? Buffer.from(input.Message) : undefined }, options });
      if (hooks.beforeSend) await hooks.beforeSend(command, options);
      if (command instanceof GetPublicKeyCommand || input.Message == null) {
        if (hooks.publicKey) return hooks.publicKey;
        return {
          KeySpec: hooks.keySpec || 'ECC_NIST_P256',
          KeyUsage: hooks.keyUsage || 'SIGN_VERIFY',
          SigningAlgorithms: hooks.algs || ['ECDSA_SHA_256'],
          PublicKey: spki(publicKey),
        };
      }
      if (hooks.signError) throw hooks.signError;
      if (hooks.signature) return { Signature: hooks.signature };
      const message = Buffer.from(input.Message);
      let signed;
      if (input.MessageType === 'DIGEST') {
        const known = hooks.knownMessages || [];
        signed = known.find((item) => crypto.createHash('sha256').update(item).digest().equals(message));
        if (!signed) signed = message;
      } else {
        signed = message;
      }
      const der = crypto.sign('sha256', signed, { key: privateKey, dsaEncoding: 'der' });
      return { Signature: hooks.der ? hooks.der(der, message, signed) : der };
    },
  };
}

async function boot(privateKey, publicKey, hooks) {
  kmsEnv(publicKey, hooks?.env || {});
  const client = mockClient(privateKey, publicKey, hooks);
  const signer = await createKmsSigner({ client });
  _setIssuerSignerForTest(signer);
  return { client, signer };
}

function verifies(jws, publicKey) {
  const [h, p, s] = jws.split('.');
  return crypto.verify(
    'sha256',
    Buffer.from(`${h}.${p}`),
    { key: publicKey, dsaEncoding: 'ieee-p1363' },
    Buffer.from(s, 'base64url'),
  );
}

test('kid match at boot, and a mismatch refuses', async () => {
  const { privateKey, publicKey } = pair();
  const { signer } = await boot(privateKey, publicKey);
  assert.equal(signer.kind, 'kms');
  assert.equal(signer.kid, kidOf(publicKey));
  assert.equal(getIssuerKid(), signer.kid);
  restore();
  const bad = pair();
  kmsEnv(bad.publicKey, { kid: 'not-the-thumbprint' });
  const client = mockClient(bad.privateKey, bad.publicKey);
  await assert.rejects(async () => await createKmsSigner({ client }), (err) => err.code === 'issuer_kid_mismatch');
});

test('wrong KeySpec or KeyUsage refuses', async () => {
  const { privateKey, publicKey } = pair();
  kmsEnv(publicKey);
  await assert.rejects(
    async () => await createKmsSigner({ client: mockClient(privateKey, publicKey, { keySpec: 'ECC_NIST_P384' }) }),
    (err) => err.code === 'issuer_key_type',
  );
  await assert.rejects(
    async () => await createKmsSigner({ client: mockClient(privateKey, publicKey, { keyUsage: 'ENCRYPT_DECRYPT' }) }),
    (err) => err.code === 'issuer_key_type',
  );
});

test('a KMS signature verifies and a high-S DER is normalised', async () => {
  const { privateKey, publicKey } = pair();
  const { signer } = await boot(privateKey, publicKey);
  const { jws } = await signJwsAsync({ task_id: 'kms-receipt', n: 1 });
  assert.equal(verifies(jws, publicKey), true);
  const { verifyIssuerJws } = await import('../../../packages/verify/dist/jws.js');
  const jwk = publicKey.export({ format: 'jwk' });
  const checked = verifyIssuerJws(jws, { kty: 'EC', crv: 'P-256', x: jwk.x, y: jwk.y, kid: signer.kid });
  assert.equal(checked.valid, true, checked.reason);

  let found = null;
  for (let i = 0; i < 40 && !found; i += 1) {
    const msg = Buffer.from(`high-s-${i}`);
    const p1363 = crypto.sign('sha256', msg, { key: privateKey, dsaEncoding: 'ieee-p1363' });
    const s = BigInt(`0x${p1363.subarray(32).toString('hex')}`);
    const highS = s > (N >> 1n) ? s : N - s;
    const highDer = derSeq(p1363.subarray(0, 32), Buffer.from(highS.toString(16).padStart(64, '0'), 'hex'));
    const ok = crypto.verify('sha256', msg, { key: publicKey, dsaEncoding: 'der' }, highDer);
    if (ok && highS > (N >> 1n)) found = { msg, highDer };
  }
  assert.ok(found, 'could not build a high-S signature');
  kmsEnv(publicKey);
  const jose = await (await createKmsSigner({
    client: mockClient(privateKey, publicKey, {
      signature: found.highDer,
    }),
  })).sign(found.msg);
  const msg = found.msg;
  const s = BigInt(`0x${jose.subarray(32).toString('hex')}`);
  assert.ok(s <= (N >> 1n));
  assert.equal(crypto.verify('sha256', msg, { key: publicKey, dsaEncoding: 'ieee-p1363' }, jose), true);
});

test('a leading 0x00 or a short integer is padded to 32 bytes', async () => {
  const { privateKey, publicKey } = pair();
  let sample = null;
  for (let i = 0; i < 80 && !sample; i += 1) {
    const msg = Buffer.from(`pad-${i}`);
    const der = crypto.sign('sha256', msg, { key: privateKey, dsaEncoding: 'der' });
    const text = der.toString('hex');
    if (text.includes('0200') || der.includes(0x00)) {
      const p1363 = crypto.sign('sha256', msg, { key: privateKey, dsaEncoding: 'ieee-p1363' });
      if (p1363[0] === 0 || p1363[32] === 0 || der[3] === 0x00 || der.includes(Buffer.from([0x02, 0x20])) === false) {
        sample = { msg, der };
      }
    }
  }
  // Always cover padding with a crafted short integer inside a real verify by
  // using derToJose on a signature node produced, and the signer path on a
  // natural DER that still verifies.
  const msg = Buffer.from('pad-fixed');
  const der = crypto.sign('sha256', msg, { key: privateKey, dsaEncoding: 'der' });
  await boot(privateKey, publicKey, { signature: der });
  const signer = await createKmsSigner({ client: mockClient(privateKey, publicKey, { signature: der }) });
  const jose = await signer.sign(msg);
  assert.equal(jose.length, 64);
  assert.equal(crypto.verify('sha256', msg, { key: publicKey, dsaEncoding: 'ieee-p1363' }, jose), true);
  const r = Buffer.alloc(32);
  r[0] = 0xff;
  const s = Buffer.from([0x07]);
  const { derToJose } = await import('../src/ecdsa-der.js');
  const padded = derToJose(derSeq(r, s));
  assert.equal(padded[0], 0xff);
  assert.equal(padded[63], 0x07);
  assert.equal(padded.subarray(32, 63).every((b) => b === 0), true);
  void sample;
});

test('malformed DER, garbage, and a wrong key do not return a signature', async () => {
  const { privateKey, publicKey } = pair();
  const other = pair();
  const cases = [
    Buffer.from([0x30, 0x03, 0x02, 0x01, 0x01]),
    Buffer.from('not-a-der-signature'),
    crypto.sign('sha256', Buffer.from('x'), { key: other.privateKey, dsaEncoding: 'der' }),
  ];
  for (const signature of cases) {
    await boot(privateKey, publicKey, { signature });
    await assert.rejects(
      async () => await signJwsAsync({ task_id: 'no-receipt' }),
      (err) => err.code === 'issuer_sign_invalid',
    );
  }
});

test('timeout and throttling are unavailable and do not fall back to env', async () => {
  const { privateKey, publicKey } = pair();
  const envKey = pair();
  process.env.ISSUER_PRIVATE_KEY = Buffer.from(envKey.privateKey.export({ type: 'pkcs8', format: 'pem' })).toString('base64');
  kmsEnv(publicKey, { timeout: '40', kid: kidOf(publicKey) });
  const hanging = mockClient(privateKey, publicKey, {
    beforeSend: (command, options) => {
      if (!(command instanceof SignCommand)) return null;
      assert.ok(options.abortSignal, 'sign passes an abort signal');
      const err = new Error('aborted');
      err.name = 'TimeoutError';
      throw err;
    },
  });
  const signer = await createKmsSigner({ client: hanging });
  _setIssuerSignerForTest(signer);
  await assert.rejects(() => signer.sign(Buffer.from('slow')), (err) => err.code === 'issuer_sign_unavailable');
  const throttled = mockClient(privateKey, publicKey, {
    signError: Object.assign(new Error('slow down'), { name: 'ThrottlingException' }),
  });
  const slow = await createKmsSigner({ client: throttled });
  await assert.rejects(() => slow.sign(Buffer.from('throttle')), (err) => err.code === 'issuer_sign_unavailable');
  assert.equal(throttled.calls.some((c) => c.name === 'SignCommand'), true);
  assert.equal(hanging.calls.filter((c) => c.name === 'SignCommand').length, 1);
});

test('a message over 4096 bytes uses DIGEST', async () => {
  const { privateKey, publicKey } = pair();
  const big = Buffer.alloc(4097, 7);
  const tiny = Buffer.from('tiny');
  const { client } = await boot(privateKey, publicKey, { knownMessages: [big, tiny] });
  const signer = await createKmsSigner({ client });
  _setIssuerSignerForTest(signer);
  const jose = await signer.sign(big);
  const signCall = client.calls.filter((c) => c.name === 'SignCommand').at(-1);
  assert.equal(signCall.input.MessageType, 'DIGEST');
  assert.equal(Buffer.from(signCall.input.Message).length, 32);
  assert.equal(crypto.verify('sha256', big, { key: publicKey, dsaEncoding: 'ieee-p1363' }, jose), true);
  const small = await signer.sign(tiny);
  const rawCall = client.calls.filter((c) => c.name === 'SignCommand').at(-1);
  assert.equal(rawCall.input.MessageType, 'RAW');
  assert.equal(crypto.verify('sha256', tiny, { key: publicKey, dsaEncoding: 'ieee-p1363' }, small), true);
});

test('logs do not contain the message, the signature, or the key id', async () => {
  const { privateKey, publicKey } = pair();
  const logs = [];
  const methods = ['log', 'info', 'warn', 'error', 'debug'];
  const orig = {};
  for (const name of methods) {
    orig[name] = console[name];
    console[name] = (...args) => logs.push(args.map((a) => (typeof a === 'string' ? a : JSON.stringify(a))).join(' '));
  }
  try {
    const { signer } = await boot(privateKey, publicKey);
    const message = Buffer.from('kms-message-unique-do-not-log');
    const jose = await signer.sign(message);
    const blob = logs.join('\n');
    assert.equal(blob.includes('kms-message-unique-do-not-log'), false);
    assert.equal(blob.includes(KEY_ID), false);
    assert.equal(blob.includes(jose.toString('hex')), false);
    assert.equal(blob.includes(jose.toString('base64url')), false);
  } finally {
    for (const name of methods) console[name] = orig[name];
  }
});

test('sync signJws under kms throws', async () => {
  const { privateKey, publicKey } = pair();
  await boot(privateKey, publicKey);
  assert.throws(() => signJws({ n: 1 }), (err) => err.code === 'issuer_signer_async_required');
});

test('a kms gateway signs a receipt and a head that verify', async () => {
  const { privateKey, publicKey } = pair();
  const { signer } = await boot(privateKey, publicKey);
  const receipt = await buildReceipt({
    taskId: 'kms-e2e-receipt',
    status: 'completed',
    createdAt: '2026-10-16T00:00:00.000Z',
    updatedAt: '2026-10-16T00:00:01.000Z',
    intent: { type: 'inference_request', paymentRail: 'usdc', paymentRef: `base:0x${'ab'.repeat(32)}`, amount: '2000' },
    result: { outputHash: `0x${'cd'.repeat(32)}` },
  });
  assert.equal(typeof receipt.issuer_signature.jws, 'string');
  assert.equal(verifies(receipt.issuer_signature.jws, publicKey), true);
  const head = await signPinnedClosedHead({
    epoch: 1,
    root: 'ab'.repeat(32),
    treeSize: 1,
    prevEpochRoot: null,
    prevEpochSize: 0,
    base: { tx: `0x${'11'.repeat(32)}`, from: `0x${'22'.repeat(20)}` },
    solana: { tx: 'solana-sig', slot: 1, fee_payer: 'fee' },
  });
  assert.equal(verifies(head.issuer_signature.jws, publicKey), true);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'chit-kms-'));
  const receiptPath = path.join(dir, 'receipt.json');
  const headPath = path.join(dir, 'head.json');
  fs.writeFileSync(receiptPath, JSON.stringify(receipt));
  fs.writeFileSync(headPath, JSON.stringify(head));
  const cli = path.join(gatewayRoot, '../../packages/verify/dist/cli.js');
  const run = spawnSync(process.execPath, [cli, receiptPath, '--json'], { encoding: 'utf8' });
  const text = `${run.stdout || ''}\n${run.stderr || ''}`;
  const { verifyIssuerJws } = await import('../../../packages/verify/dist/jws.js');
  const jwk = publicKey.export({ format: 'jwk' });
  assert.equal(verifyIssuerJws(receipt.issuer_signature.jws, {
    kty: 'EC', crv: 'P-256', x: jwk.x, y: jwk.y, kid: signer.kid,
  }).valid, true);
  assert.equal(verifyIssuerJws(head.issuer_signature.jws, {
    kty: 'EC', crv: 'P-256', x: jwk.x, y: jwk.y, kid: signer.kid,
  }).valid, true);
  // The local fixture is checked by the 0.4.2 CLI. A key outside the bundled
  // trust set is not VERIFIED; the signature check above is the KMS proof.
  // When the CLI can read the file it must not crash.
  assert.equal(run.status, 1, text);
  assert.match(text, /key untrusted/);
  assert.match(text, /not the issuer's/);
  const headRun = spawnSync(process.execPath, [cli, headPath, '--json'], { encoding: 'utf8' });
  const headText = `${headRun.stdout || ''}\n${headRun.stderr || ''}`;
  assert.equal(headRun.status, 1, headText);
  // A tree head is not a receipt: since 0.4.8 the receipt slot refuses its typ
  // before any key lookup.
  assert.match(headText, /typ_mismatch/);
});
