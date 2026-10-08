/**
 * Salt store checks at runtime, in the production key format.
 * Throwaway keys only.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { bootSaltStore, openSaltRecord, sealSaltRecord } from '../src/salt-store.js';

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'chit-salt-prod-'));

test('a wrap key equal to the issuer scalar refuses when the issuer key is a base64 PEM', () => {
  const { privateKey } = crypto.generateKeyPairSync('ec', { namedCurve: 'P-256' });
  const pem = privateKey.export({ type: 'pkcs8', format: 'pem' });
  const issuerEnvForm = Buffer.from(pem).toString('base64');
  const d = Buffer.from(privateKey.export({ format: 'jwk' }).d, 'base64url').toString('base64');
  assert.throws(
    () => bootSaltStore({ RECEIPT_SALT_DIR: tmp(), SALT_WRAP_KEY: d }, issuerEnvForm),
    /must not be the issuer key/,
  );
  assert.doesNotThrow(
    () => bootSaltStore({ RECEIPT_SALT_DIR: tmp(), SALT_WRAP_KEY: crypto.randomBytes(32).toString('base64') }, issuerEnvForm),
  );
});

test('a truncated GCM tag does not open a salt record', () => {
  const dir = tmp();
  const store = bootSaltStore({
    RECEIPT_SALT_DIR: dir,
    RECEIPT_SALT_WRAP_KEYS: JSON.stringify({ current: crypto.randomBytes(32).toString('base64') }),
  });
  const salt = crypto.randomBytes(32).toString('hex');
  store.put({ receiptId: 'chit-tagprobe01', salt, privateFields: null });
  const file = path.join(dir, fs.readdirSync(dir).find((n) => n.includes('tagprobe01')));
  const original = JSON.parse(fs.readFileSync(file, 'utf8'));
  assert.ok(store.get('chit-tagprobe01'));
  for (const n of [4, 8, 12]) {
    const cut = { ...original, tag: Buffer.from(original.tag, 'base64').subarray(0, n).toString('base64') };
    fs.writeFileSync(file, JSON.stringify(cut));
    assert.equal(store.get('chit-tagprobe01'), null, `tag of ${n} bytes opened`);
  }
  const key = crypto.randomBytes(32);
  const sealed = sealSaltRecord('chit-tagprobe02', crypto.randomBytes(32), key, 'current');
  for (const n of [4, 8, 12]) {
    const tag = Buffer.from(sealed.tag, 'base64url').subarray(0, n).toString('base64url');
    assert.throws(() => openSaltRecord({ ...sealed, tag }, key));
  }
});
