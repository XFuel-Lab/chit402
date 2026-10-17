/**
 * Production refuses to boot without the configured issuer key.
 * Unset NODE_ENV is production. ALLOW_EPHEMERAL_ISSUER_KEY and the
 * issuer-root flags do not override that.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const gatewayDir = fileURLToPath(new URL('..', import.meta.url));
const { initIssuerKey, _resetIssuerKey, computeJwkThumbprint, isProductionIssuerEnv } = await import('../src/issuer-key.js');

const PRODUCTION_KID = 'IvFpmC-vPhkY_v0vidsrWVT9uzlE5XWKZgAEOeJTq1Q';

function pem(privateKey) {
  return Buffer.from(privateKey.export({ type: 'pkcs8', format: 'pem' })).toString('base64');
}

function p256() {
  return crypto.generateKeyPairSync('ec', { namedCurve: 'P-256' });
}

function snapshotEnv() {
  return {
    NODE_ENV: process.env.NODE_ENV,
    ISSUER_PRIVATE_KEY: process.env.ISSUER_PRIVATE_KEY,
    ISSUER_KID: process.env.ISSUER_KID,
    ALLOW_EPHEMERAL_ISSUER_KEY: process.env.ALLOW_EPHEMERAL_ISSUER_KEY,
    ISSUER_ROOT_ENABLED: process.env.ISSUER_ROOT_ENABLED,
    ISSUER_ROOT_ALLOW_SKIP: process.env.ISSUER_ROOT_ALLOW_SKIP,
  };
}

function restoreEnv(prev) {
  for (const [key, value] of Object.entries(prev)) {
    if (value == null) delete process.env[key];
    else process.env[key] = value;
  }
  _resetIssuerKey();
}

function childEnv(overrides) {
  const env = { ...process.env };
  for (const [key, value] of Object.entries(overrides)) {
    if (value == null) delete env[key];
    else env[key] = value;
  }
  return env;
}

function bootChild(overrides) {
  const script = `
    import { initIssuerKey } from './src/issuer-key.js';
    try {
      initIssuerKey();
      process.exit(0);
    } catch (err) {
      console.error(err.code || err.message);
      process.exit(1);
    }
  `;
  return spawnSync(process.execPath, ['--input-type=module', '-e', script], {
    cwd: gatewayDir,
    env: childEnv(overrides),
    encoding: 'utf8',
  });
}

test('production is every NODE_ENV other than test and development', () => {
  assert.equal(isProductionIssuerEnv(''), true);
  assert.equal(isProductionIssuerEnv(null), true);
  assert.equal(isProductionIssuerEnv('production'), true);
  assert.equal(isProductionIssuerEnv('Production'), true);
  assert.equal(isProductionIssuerEnv('TEST'), true);
  assert.equal(isProductionIssuerEnv('test'), false);
  assert.equal(isProductionIssuerEnv('development'), false);
});

test('a missing or ephemeral key in production does not boot', () => {
  const prev = snapshotEnv();
  try {
    delete process.env.ISSUER_PRIVATE_KEY;
    delete process.env.ISSUER_KID;
    delete process.env.ALLOW_EPHEMERAL_ISSUER_KEY;
    delete process.env.ISSUER_ROOT_ENABLED;
    delete process.env.ISSUER_ROOT_ALLOW_SKIP;

    for (const nodeEnv of [undefined, 'production', 'Production', 'TEST']) {
      if (nodeEnv == null) delete process.env.NODE_ENV;
      else process.env.NODE_ENV = nodeEnv;
      _resetIssuerKey();
      assert.throws(() => initIssuerKey(), (err) => err.code === 'issuer_key_missing', String(nodeEnv));
    }

    process.env.NODE_ENV = 'production';
    process.env.ISSUER_PRIVATE_KEY = '   \n';
    _resetIssuerKey();
    assert.throws(() => initIssuerKey(), (err) => err.code === 'issuer_key_missing');

    delete process.env.ISSUER_PRIVATE_KEY;
    process.env.ALLOW_EPHEMERAL_ISSUER_KEY = 'true';
    process.env.ISSUER_ROOT_ENABLED = 'true';
    process.env.ISSUER_ROOT_ALLOW_SKIP = 'I_UNDERSTAND';
    _resetIssuerKey();
    assert.throws(() => initIssuerKey(), (err) => err.code === 'issuer_key_missing');

    const { privateKey: wrong } = crypto.generateKeyPairSync('ec', { namedCurve: 'secp256k1' });
    process.env.ISSUER_PRIVATE_KEY = pem(wrong);
    delete process.env.ISSUER_KID;
    _resetIssuerKey();
    assert.throws(() => initIssuerKey(), (err) => err.code === 'issuer_key_type');

    const { publicKey } = p256();
    const random = p256().privateKey;
    process.env.ISSUER_PRIVATE_KEY = pem(random);
    delete process.env.ISSUER_KID;
    _resetIssuerKey();
    assert.throws(() => initIssuerKey(), (err) => err.code === 'issuer_kid_mismatch');
    assert.notEqual(computeJwkThumbprint(publicKey.export({ format: 'jwk' })), PRODUCTION_KID);

    const matched = p256();
    const jwk = matched.publicKey.export({ format: 'jwk' });
    process.env.ISSUER_PRIVATE_KEY = pem(matched.privateKey);
    process.env.ISSUER_KID = computeJwkThumbprint(jwk);
    process.env.ALLOW_EPHEMERAL_ISSUER_KEY = 'true';
    _resetIssuerKey();
    const booted = initIssuerKey();
    assert.equal(booted.kid, process.env.ISSUER_KID);
    assert.equal(booted.publicKeyJwk.crv, 'P-256');
  } finally {
    restoreEnv(prev);
  }
});

test('test and development still mint an ephemeral key', () => {
  const prev = snapshotEnv();
  try {
    delete process.env.ISSUER_PRIVATE_KEY;
    delete process.env.ISSUER_KID;
    delete process.env.ALLOW_EPHEMERAL_ISSUER_KEY;
    for (const nodeEnv of ['test', 'development']) {
      process.env.NODE_ENV = nodeEnv;
      _resetIssuerKey();
      const minted = initIssuerKey();
      assert.equal(minted.publicKeyJwk.crv, 'P-256');
      assert.equal(typeof minted.kid, 'string');
    }
  } finally {
    restoreEnv(prev);
  }
});

test('booting without a production key exits non-zero', () => {
  const missing = bootChild({
    NODE_ENV: 'production',
    ISSUER_PRIVATE_KEY: null,
    ISSUER_KID: null,
    ALLOW_EPHEMERAL_ISSUER_KEY: 'true',
    ISSUER_ROOT_ENABLED: 'true',
    ISSUER_ROOT_ALLOW_SKIP: 'I_UNDERSTAND',
  });
  assert.notEqual(missing.status, 0, missing.stdout + missing.stderr);
  assert.match(missing.stderr, /issuer_key_missing/);

  const unset = bootChild({
    NODE_ENV: null,
    ISSUER_PRIVATE_KEY: null,
    ISSUER_KID: null,
    ALLOW_EPHEMERAL_ISSUER_KEY: null,
  });
  assert.notEqual(unset.status, 0, unset.stdout + unset.stderr);
  assert.match(unset.stderr, /issuer_key_missing/);

  const blank = bootChild({
    NODE_ENV: 'production',
    ISSUER_PRIVATE_KEY: '   ',
    ISSUER_KID: null,
  });
  assert.notEqual(blank.status, 0);
  assert.match(blank.stderr, /issuer_key_missing/);
});
