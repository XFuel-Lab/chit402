/**
 * Dry-run script against a mock KMS client and a JWKS server on 127.0.0.1.
 * NODE_ENV=test. No network beyond the loopback.
 */
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import http from 'node:http';
import { GetPublicKeyCommand } from '@aws-sdk/client-kms';
import { createKmsSigner } from '../src/issuer-signer-kms.js';
import { computeJwkThumbprint } from '../src/issuer-key.js';
import { derToJose, lowS } from '../src/ecdsa-der.js';
import { runIssuerKmsCheck, CHECK_MESSAGE } from '../../../scripts/issuer-kms-check.mjs';

process.env.NODE_ENV = 'test';

function pair() {
  return crypto.generateKeyPairSync('ec', { namedCurve: 'P-256' });
}

function spki(publicKey) {
  return publicKey.export({ type: 'spki', format: 'der' });
}

function publicParts(publicKey) {
  const jwk = publicKey.export({ format: 'jwk' });
  const publicJwk = { kty: 'EC', crv: 'P-256', x: jwk.x, y: jwk.y };
  return { publicJwk, kid: computeJwkThumbprint(publicJwk) };
}

function privateD(privateKey) {
  return privateKey.export({ format: 'jwk' }).d;
}

function fixedDer(privateKey) {
  return crypto.sign('sha256', CHECK_MESSAGE, { key: privateKey, dsaEncoding: 'der' });
}

function joseOf(der) {
  return lowS(derToJose(der));
}

function kmsEnv(kid, extra = {}) {
  return {
    NODE_ENV: 'test',
    ISSUER_SIGNER: 'kms',
    ISSUER_KMS_KEY_ID: 'alias/chit402-issuer-test',
    ISSUER_KMS_REGION: 'eu-west-3',
    ISSUER_KMS_TIMEOUT_MS: '3000',
    ISSUER_KID: kid,
    ...extra,
  };
}

function mockClient(privateKey, publicKey, hooks = {}) {
  const calls = [];
  return {
    calls,
    async send(command) {
      const input = command.input || {};
      calls.push(command.constructor?.name || '');
      const isPublic = command instanceof GetPublicKeyCommand || input.Message == null;
      if (isPublic) {
        return {
          KeySpec: 'ECC_NIST_P256',
          KeyUsage: 'SIGN_VERIFY',
          SigningAlgorithms: ['ECDSA_SHA_256'],
          PublicKey: spki(publicKey),
        };
      }
      if (hooks.signError) throw hooks.signError;
      if (hooks.signature) return { Signature: hooks.signature };
      const der = crypto.sign('sha256', Buffer.from(input.Message), {
        key: privateKey,
        dsaEncoding: 'der',
      });
      return { Signature: der };
    },
  };
}

async function boot(hooks = {}) {
  const { privateKey, publicKey } = hooks.keys || pair();
  const { publicJwk, kid } = publicParts(publicKey);
  const env = kmsEnv(kid, hooks.env || {});
  const client = mockClient(privateKey, publicKey, hooks);
  const signer = await createKmsSigner({ client, env });
  return { privateKey, publicKey, publicJwk, kid, env, client, signer };
}

function jwkEntry(publicJwk, kid) {
  return {
    kty: 'EC',
    crv: 'P-256',
    alg: 'ES256',
    use: 'sig',
    kid,
    x: publicJwk.x,
    y: publicJwk.y,
  };
}

function startJwks({ status = 200, body = { keys: [] }, hang = false } = {}) {
  const methods = [];
  const bodyLengths = [];
  const server = http.createServer((req, res) => {
    methods.push(req.method || '');
    let len = 0;
    req.on('data', (chunk) => {
      len += chunk.length;
    });
    req.on('end', () => {
      bodyLengths.push(len);
      if (hang) return;
      const payload = typeof body === 'string' ? body : JSON.stringify(body);
      res.writeHead(status, { 'content-type': 'application/json' });
      res.end(payload);
    });
  });
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      resolve({
        methods,
        bodyLengths,
        url: `http://127.0.0.1:${port}/.well-known/jwks.json`,
        close() {
          server.closeAllConnections?.();
          return new Promise((done) => server.close(() => done()));
        },
      });
    });
  });
}

async function capture(fn) {
  let out = '';
  const original = process.stdout.write.bind(process.stdout);
  process.stdout.write = (chunk, encoding, cb) => {
    const enc = typeof encoding === 'string' ? encoding : 'utf8';
    const text = typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString(enc);
    if (text.startsWith('kid ')) out += text;
    return original(chunk, encoding, cb);
  };
  try {
    const result = await fn();
    return { result, out };
  } finally {
    process.stdout.write = original;
  }
}

describe('issuer-kms-check', { concurrency: false }, () => {

function assertGetOnly(server) {
  assert.ok(server.methods.length >= 1);
  assert.deepEqual(server.methods, server.methods.map(() => 'GET'));
  assert.deepEqual(server.bodyLengths, server.bodyLengths.map(() => 0));
}

function assertNoLeak(out, parts) {
  for (const part of parts) {
    assert.equal(typeof part, 'string');
    assert.ok(part.length > 8);
    assert.equal(out.includes(part), false);
  }
}

test('PASS when the JWKS key matches the signer', async () => {
  const keys = pair();
  const der = fixedDer(keys.privateKey);
  const jose = joseOf(der);
  const { publicJwk, kid, env, client, signer } = await boot({
    keys,
    signature: der,
  });
  const other = publicParts(pair().publicKey);
  const server = await startJwks({
    body: {
      keys: [
        jwkEntry(other.publicJwk, other.kid),
        jwkEntry(publicJwk, kid),
      ],
    },
  });
  const seen = [];
  const fetchImpl = (url, init) => {
    seen.push({ method: init && init.method, body: init && init.body });
    return globalThis.fetch(url, init);
  };
  try {
    const { result, out } = await capture(() => runIssuerKmsCheck({
      env: { ...env, ISSUER_JWKS_URL: server.url },
      fetchImpl,
      signer,
    }));
    assert.equal(result.exitCode, 0);
    assert.equal(result.ok, true);
    assert.equal(out, `kid ${kid}\njwks match\nPASS\n`);
    assert.equal(client.calls.filter((name) => name === 'SignCommand').length, 1);
    assert.deepEqual(seen.map((row) => row.method), ['GET']);
    assert.deepEqual(seen.map((row) => row.body), [undefined]);
    assertGetOnly(server);
    assertNoLeak(out, [jose.toString('base64url'), jose.toString('hex'), privateD(keys.privateKey)]);
  } finally {
    await server.close();
  }
});

test('jwks mismatch when x differs', async () => {
  const { publicJwk, kid, env, signer } = await boot();
  const other = publicParts(pair().publicKey);
  const server = await startJwks({
    body: { keys: [jwkEntry({ ...publicJwk, x: other.publicJwk.x }, kid)] },
  });
  try {
    const { result, out } = await capture(() => runIssuerKmsCheck({
      env: { ...env, ISSUER_JWKS_URL: server.url },
      signer,
    }));
    assert.equal(result.exitCode, 1);
    assert.equal(out, `kid ${kid}\njwks mismatch\nFAIL jwks_mismatch\n`);
    assertGetOnly(server);
  } finally {
    await server.close();
  }
});

test('FAIL when the signer kid is absent from the JWKS', async () => {
  const { publicJwk, kid, env, signer } = await boot();
  const other = publicParts(pair().publicKey);
  const server = await startJwks({
    body: { keys: [jwkEntry(publicJwk, other.kid)] },
  });
  try {
    const { result, out } = await capture(() => runIssuerKmsCheck({
      env: { ...env, ISSUER_JWKS_URL: server.url },
      signer,
    }));
    assert.equal(result.exitCode, 1);
    assert.equal(out, `kid ${kid}\njwks mismatch\nFAIL jwks_mismatch\n`);
    assert.doesNotMatch(out, /\nPASS\n/);
    assertGetOnly(server);
  } finally {
    await server.close();
  }
});

test('JWKS HTTP 500 is FAIL', async () => {
  const { env, signer, kid } = await boot();
  const server = await startJwks({ status: 500, body: { keys: [] } });
  try {
    const { result, out } = await capture(() => runIssuerKmsCheck({
      env: { ...env, ISSUER_JWKS_URL: server.url },
      signer,
    }));
    assert.equal(result.exitCode, 1);
    assert.equal(out, `kid ${kid}\njwks mismatch\nFAIL jwks_unavailable\n`);
    assert.doesNotMatch(out, /\nPASS\n/);
    assertGetOnly(server);
  } finally {
    await server.close();
  }
});

test('JWKS timeout is FAIL', async () => {
  const { env, signer, kid } = await boot();
  const server = await startJwks({ hang: true });
  const started = Date.now();
  try {
    const { result, out } = await capture(() => runIssuerKmsCheck({
      env: { ...env, ISSUER_JWKS_URL: server.url },
      signer,
    }));
    const elapsed = Date.now() - started;
    assert.ok(elapsed >= 4500);
    assert.equal(result.exitCode, 1);
    assert.equal(out, `kid ${kid}\njwks mismatch\nFAIL jwks_unavailable\n`);
    assert.doesNotMatch(out, /\nPASS\n/);
    assertGetOnly(server);
  } finally {
    await server.close();
  }
});

test('jwks skipped when ISSUER_JWKS_URL is unset still PASS', async () => {
  const { kid, env, signer } = await boot();
  const { result, out } = await capture(() => runIssuerKmsCheck({ env, signer }));
  assert.equal(result.exitCode, 0);
  assert.equal(out, `kid ${kid}\njwks skipped\nPASS\n`);
});

test('mock Sign throws FAIL issuer_sign_unavailable', async () => {
  const secret = 'DUMMY-not-a-real-secret';
  const blown = new Error(`kms sign exploded ${secret}`);
  blown.name = 'ThrottlingException';
  const { kid, env, signer } = await boot({ signError: blown });
  const { result, out } = await capture(() => runIssuerKmsCheck({
    env: { ...env, AWS_SECRET_ACCESS_KEY: secret },
    signer,
  }));
  assert.equal(result.exitCode, 1);
  assert.equal(out, `kid ${kid}\njwks skipped\nFAIL issuer_sign_unavailable\n`);
  assertNoLeak(out, [secret, blown.message, 'AWS_SECRET_ACCESS_KEY']);
});

test('garbage DER is FAIL issuer_sign_invalid', async () => {
  const { kid, env, signer } = await boot({
    signature: Buffer.from([0x30, 0x03, 0x02, 0x01, 0x01]),
  });
  const { result, out } = await capture(() => runIssuerKmsCheck({ env, signer }));
  assert.equal(result.exitCode, 1);
  assert.equal(out, `kid ${kid}\njwks skipped\nFAIL issuer_sign_invalid\n`);
});

test('ISSUER_SIGNER=env is FAIL not_kms', async () => {
  const { result, out } = await capture(() => runIssuerKmsCheck({
    env: { NODE_ENV: 'test', ISSUER_SIGNER: 'env' },
  }));
  assert.equal(result.exitCode, 1);
  assert.equal(out, 'kid \njwks skipped\nFAIL not_kms\n');
});

test('stdout does not leak the signature, private d, secret, or err.message', async () => {
  const keys = pair();
  const der = fixedDer(keys.privateKey);
  const jose = joseOf(der);
  const { env, signer } = await boot({ keys, signature: der });
  const b64 = jose.toString('base64url');
  const hex = jose.toString('hex');
  const d = privateD(keys.privateKey);
  const secret = 'DUMMY-not-a-real-secret';
  const errMessage = `err.message ${b64} ${hex} ${d} ${secret}`;
  const leaking = {
    kind: 'kms',
    kid: signer.kid,
    publicJwk: signer.publicJwk,
    async sign(input) {
      const sig = await signer.sign(input);
      const err = new Error(`${errMessage} ${sig.toString('base64url')} ${sig.toString('hex')}`);
      err.code = 'issuer_sign_unavailable';
      throw err;
    },
  };
  const { result, out } = await capture(() => runIssuerKmsCheck({
    env: { ...env, AWS_SECRET_ACCESS_KEY: secret },
    signer: leaking,
  }));
  assert.equal(result.exitCode, 1);
  assert.equal(out, `kid ${signer.kid}\njwks skipped\nFAIL issuer_sign_unavailable\n`);
  assertNoLeak(out, [b64, hex, d, secret, errMessage, 'AWS_SECRET_ACCESS_KEY']);
});
});
