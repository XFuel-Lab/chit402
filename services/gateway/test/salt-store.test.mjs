/**
 * T16–T19: encrypted SaltStore record, AAD, wrap key, rotation, fail closed.
 * Wiring: a memory store refuses v11 issuance when ISSUER_ROOT_ENABLED is set.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  EncryptedSaltStore,
  MemorySaltStore,
  bootSaltStore,
  decryptRecord,
  saltAad,
  assertV11IssuanceAllowed,
} from '../src/salt-store.js';

function tmp() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'chit-salt-'));
}

function keys() {
  return {
    A: crypto.randomBytes(32).toString('base64'),
    B: crypto.randomBytes(32).toString('base64'),
  };
}

test('T16 S1+S2 encrypted record shape and AAD', () => {
  const dir = tmp();
  const wrap = keys();
  const store = new EncryptedSaltStore({
    dir,
    keys: new Map(Object.entries(wrap).map(([kid, value]) => [kid, Buffer.from(value, 'base64')])),
    currentKid: 'A',
  });
  store.put({
    receiptId: 'chit-t16',
    salt: 'ab'.repeat(32),
    privateFields: { model: 'hidden' },
  });
  const record = store.readRecord('chit-t16');
  assert.deepEqual(Object.keys(record).sort(), ['alg', 'ct', 'iv', 'receipt_id', 'tag', 'wrap_kid']);
  assert.equal(record.alg, 'A256GCM');
  assert.equal(record.wrap_kid, 'A');
  assert.equal(record.receipt_id, 'chit-t16');
  const opened = store.get('chit-t16');
  assert.equal(opened.salt, 'ab'.repeat(32));
  assert.equal(opened.privateFields.model, 'hidden');
  const key = Buffer.from(wrap.A, 'base64');
  assert.throws(() => decryptRecord(record, key, 'chit-other'), /unable to authenticate|auth/i);
  assert.equal(saltAad('chit-t16').toString('utf8'), `v11/saltchit-t16`);
});

test('T17 S3+S5 wrap key stays outside the data dir and decrypt fails closed', () => {
  const dir = tmp();
  const inside = path.join(dir, 'wrap.key');
  fs.writeFileSync(inside, crypto.randomBytes(32).toString('base64'));
  const prevFile = process.env.RECEIPT_SALT_WRAP_KEY_FILE;
  const prevDir = process.env.RECEIPT_SALT_DIR;
  const prevKeys = process.env.RECEIPT_SALT_WRAP_KEYS;
  process.env.RECEIPT_SALT_DIR = dir;
  process.env.RECEIPT_SALT_WRAP_KEY_FILE = inside;
  delete process.env.RECEIPT_SALT_WRAP_KEYS;
  try {
    assert.throws(() => bootSaltStore(), /outside the salt data dir/);
  } finally {
    if (prevFile == null) delete process.env.RECEIPT_SALT_WRAP_KEY_FILE;
    else process.env.RECEIPT_SALT_WRAP_KEY_FILE = prevFile;
    if (prevDir == null) delete process.env.RECEIPT_SALT_DIR;
    else process.env.RECEIPT_SALT_DIR = prevDir;
    if (prevKeys == null) delete process.env.RECEIPT_SALT_WRAP_KEYS;
    else process.env.RECEIPT_SALT_WRAP_KEYS = prevKeys;
  }

  const wrap = keys();
  const store = new EncryptedSaltStore({
    dir,
    keys: new Map([['A', Buffer.from(wrap.A, 'base64')]]),
    currentKid: 'A',
  });
  store.put({ receiptId: 'chit-t17', salt: 'cd'.repeat(32), privateFields: { provider: 'p' } });
  const record = store.readRecord('chit-t17');
  const dumped = fs.readFileSync(store.recordPath('chit-t17'), 'utf8');
  assert.equal(dumped.includes(wrap.A), false);
  assert.throws(() => decryptRecord(record, crypto.randomBytes(32)));
  const flipped = { ...record, ct: Buffer.from(record.ct, 'base64').map((byte, i) => (i === 0 ? byte ^ 1 : byte)).toString('base64') };
  assert.throws(() => decryptRecord(flipped, Buffer.from(wrap.A, 'base64')));
});

test('T18 S4 wrap_kid rotation keeps old records and drops an unknown kid', () => {
  const dir = tmp();
  const wrap = keys();
  const both = new Map([
    ['A', Buffer.from(wrap.A, 'base64')],
    ['B', Buffer.from(wrap.B, 'base64')],
  ]);
  const store = new EncryptedSaltStore({ dir, keys: both, currentKid: 'A' });
  store.put({ receiptId: 'chit-old', salt: '11'.repeat(32), privateFields: null });
  store.rotate('B');
  store.put({ receiptId: 'chit-new', salt: '22'.repeat(32), privateFields: null });
  assert.equal(store.get('chit-old').salt, '11'.repeat(32));
  assert.equal(store.get('chit-new').salt, '22'.repeat(32));
  assert.equal(store.readRecord('chit-old').wrap_kid, 'A');
  assert.equal(store.readRecord('chit-new').wrap_kid, 'B');
  const onlyB = new EncryptedSaltStore({
    dir,
    keys: new Map([['B', Buffer.from(wrap.B, 'base64')]]),
    currentKid: 'B',
  });
  assert.throws(() => onlyB.get('chit-old'), /unknown wrap kid/);
  assert.equal(onlyB.get('chit-new').salt, '22'.repeat(32));
});

test('T19 S6 put rejects raw prompts and plaintext outputs', () => {
  const dir = tmp();
  const wrap = keys();
  const store = new EncryptedSaltStore({
    dir,
    keys: new Map([['A', Buffer.from(wrap.A, 'base64')]]),
    currentKid: 'A',
  });
  assert.throws(() => store.put({
    receiptId: 'chit-raw',
    salt: 'ee'.repeat(32),
    privateFields: { prompt: 'SECRET_PROMPT', output_text: 'SECRET_OUTPUT' },
  }), /refusing to store/);
  const files = fs.readdirSync(dir);
  const dumped = files.map((name) => fs.readFileSync(path.join(dir, name), 'utf8')).join('\n');
  assert.equal(dumped.includes('SECRET_PROMPT'), false);
  assert.equal(dumped.includes('SECRET_OUTPUT'), false);
});

test('wiring: prod-config boot with the memory store refuses v11 issuance', async () => {
  assert.doesNotThrow(() => assertV11IssuanceAllowed(new MemorySaltStore(), {}));
  assert.throws(
    () => assertV11IssuanceAllowed(new MemorySaltStore(), { ISSUER_ROOT_ENABLED: 'true' }),
    /ISSUER_ROOT_ENABLED[\s\S]*memory-only/,
  );
  const prev = process.env.ISSUER_ROOT_ENABLED;
  process.env.ISSUER_ROOT_ENABLED = 'true';
  delete process.env.RECEIPT_SALT_WRAP_KEYS;
  delete process.env.RECEIPT_SALT_DIR;
  try {
    const { createApp } = await import('../src/server.js');
    assert.throws(() => createApp(), /ISSUER_ROOT_ENABLED[\s\S]*memory-only/);
  } finally {
    if (prev == null) delete process.env.ISSUER_ROOT_ENABLED;
    else process.env.ISSUER_ROOT_ENABLED = prev;
  }
});
