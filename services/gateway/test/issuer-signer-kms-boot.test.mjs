/**
 * KMS issuer boot refuses a missing static credential pair before any client
 * is built, and bounds init with ISSUER_KMS_TIMEOUT_MS. NODE_ENV=test.
 * Dummy values only. No network and no IMDS.
 */
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import net from 'node:net';
import { readFileSync } from 'node:fs';

process.env.NODE_ENV = 'test';

const ACCESS = 'dummy-access-key';
const SECRET = 'dummy-secret-key';
const SESSION = 'dummy-session-token';
const KEY_ID = 'alias/dummy-issuer-key';
const PAYLOAD = 'dummy-payload-do-not-log';
const ENV_ACCESS = 'dummy-env-access-key';
const ENV_SECRET = 'dummy-env-secret-key';

const WATCH = [
  'NODE_ENV',
  'AWS_ACCESS_KEY_ID',
  'AWS_SECRET_ACCESS_KEY',
  'AWS_SESSION_TOKEN',
  'AWS_PROFILE',
  'AWS_SHARED_CREDENTIALS_FILE',
  'AWS_EC2_METADATA_DISABLED',
  'ISSUER_SIGNER',
  'ISSUER_PRIVATE_KEY',
  'ISSUER_KID',
  'ISSUER_KMS_KEY_ID',
  'ISSUER_KMS_REGION',
  'ISSUER_KMS_TIMEOUT_MS',
  'ISSUER_ROOT_ENABLED',
  'ISSUER_TEST_KEY',
  'ISSUER_SIGNER_LOW_S',
];

const {
  initIssuerSigner,
  logIssuerSignerBootRefusal,
  _setIssuerSignerForTest,
} = await import('../src/issuer-signer.js');
const { createIssuerKmsClient } = await import('../src/issuer-kms-client.js');
const { _resetIssuerKey } = await import('../src/issuer-key.js');
const { wireV13Runtime } = await import('../src/v13-boot.js');
const { default: logger } = await import('../src/logger.js');

const saved = {};
for (const key of WATCH) saved[key] = process.env[key];

function restoreEnv() {
  for (const key of WATCH) {
    if (saved[key] == null) delete process.env[key];
    else process.env[key] = saved[key];
  }
}

function fresh() {
  _setIssuerSignerForTest(null);
  _resetIssuerKey();
}

after(() => {
  fresh();
  restoreEnv();
});

function guardSockets() {
  const hits = [];
  const orig = net.Socket.prototype.connect;
  net.Socket.prototype.connect = function connect(...args) {
    const blob = args.map((part) => {
      if (part && typeof part === 'object') {
        try { return JSON.stringify(part); } catch { return ''; }
      }
      return String(part);
    }).join(' ');
    if (blob.includes('169.254.169.254') || blob.includes('fd00:ec2::254')) hits.push('imds');
    const err = new Error('socket opened during issuer boot test');
    err.code = 'socket_opened';
    throw err;
  };
  void orig;
  return {
    hits,
    restore() { net.Socket.prototype.connect = orig; },
  };
}

function captureLogs() {
  const lines = [];
  const orig = logger.error;
  logger.error = (obj, msg) => {
    lines.push(obj, msg);
    return orig.call(logger, obj, msg);
  };
  const methods = ['log', 'info', 'warn', 'error', 'debug'];
  const consoles = {};
  for (const name of methods) {
    consoles[name] = console[name];
    console[name] = (...args) => { lines.push(...args); };
  }
  return {
    lines,
    text() {
      return lines.map((part) => (typeof part === 'string' ? part : JSON.stringify(part))).join('\n');
    },
    restore() {
      logger.error = orig;
      for (const name of methods) console[name] = consoles[name];
    },
  };
}

function assertNoSecrets(text) {
  for (const secret of [ACCESS, SECRET, SESSION, KEY_ID, PAYLOAD, ENV_ACCESS, ENV_SECRET]) {
    assert.equal(text.includes(secret), false, `log leaked ${secret}`);
  }
}

function kmsEnv(extra = {}) {
  return {
    NODE_ENV: 'test',
    ISSUER_SIGNER: 'kms',
    ISSUER_KMS_REGION: 'us-east-1',
    ISSUER_KMS_KEY_ID: KEY_ID,
    ISSUER_KMS_TIMEOUT_MS: '40',
    ISSUER_TEST_KEY: '1',
    AWS_SESSION_TOKEN: SESSION,
    ...extra,
  };
}

async function refuse(extra) {
  fresh();
  const logs = captureLogs();
  const sockets = guardSockets();
  const started = Date.now();
  let err = null;
  try {
    await Promise.race([
      initIssuerSigner(kmsEnv(extra)),
      new Promise((_, reject) => {
        setTimeout(() => reject(Object.assign(new Error('init hung'), { code: 'hung' })), 800);
      }),
    ]);
  } catch (caught) {
    err = caught;
  } finally {
    sockets.restore();
    logs.restore();
  }
  return { err, elapsed: Date.now() - started, logs: logs.text(), hits: sockets.hits };
}

test('kms without either AWS key refuses before a client and does not contact IMDS', async () => {
  delete process.env.AWS_ACCESS_KEY_ID;
  delete process.env.AWS_SECRET_ACCESS_KEY;
  delete process.env.AWS_SESSION_TOKEN;
  try {
    for (const extra of [{}, { AWS_ACCESS_KEY_ID: '', AWS_SECRET_ACCESS_KEY: '' }]) {
      const out = await refuse(extra);
      assert.equal(out.err && out.err.code, 'issuer_creds_missing');
      assert.ok(out.elapsed < 1000, `elapsed ${out.elapsed}`);
      assert.equal(out.hits.length, 0);
      assert.match(out.logs, /issuer_creds_missing/);
      assert.match(out.logs, /issuer signer boot refused/);
      assertNoSecrets(out.logs);
    }
  } finally {
    restoreEnv();
  }
});

test('kms with one key or a whitespace-only key refuses and does not contact IMDS', async () => {
  delete process.env.AWS_ACCESS_KEY_ID;
  delete process.env.AWS_SECRET_ACCESS_KEY;
  try {
    const cases = [
      { AWS_ACCESS_KEY_ID: ACCESS },
      { AWS_SECRET_ACCESS_KEY: SECRET },
      { AWS_ACCESS_KEY_ID: '   ', AWS_SECRET_ACCESS_KEY: SECRET },
      { AWS_ACCESS_KEY_ID: ACCESS, AWS_SECRET_ACCESS_KEY: ' \t ' },
      { AWS_ACCESS_KEY_ID: '   ', AWS_SECRET_ACCESS_KEY: '   ' },
    ];
    for (const extra of cases) {
      const out = await refuse(extra);
      assert.equal(out.err && out.err.code, 'issuer_creds_missing');
      assert.ok(out.elapsed < 1000, `elapsed ${out.elapsed}`);
      assert.equal(out.hits.length, 0);
      assert.match(out.logs, /issuer_creds_missing/);
      assertNoSecrets(out.logs);
    }
  } finally {
    restoreEnv();
  }
});

test('kms init timeout bounds a send that ignores abort and logs only the code', async () => {
  fresh();
  process.env.AWS_ACCESS_KEY_ID = ENV_ACCESS;
  process.env.AWS_SECRET_ACCESS_KEY = ENV_SECRET;
  const seen = [];
  let sendCalled = false;
  const logs = captureLogs();
  const sockets = guardSockets();
  const started = Date.now();
  let err = null;
  try {
    await Promise.race([
      initIssuerSigner(kmsEnv({
        AWS_ACCESS_KEY_ID: `  ${ACCESS}  `,
        AWS_SECRET_ACCESS_KEY: `  ${SECRET}  `,
      }), {
        clientFactory(opts) {
          seen.push(opts);
          return {
            async send() {
              sendCalled = true;
              return new Promise(() => {});
            },
          };
        },
      }),
      new Promise((_, reject) => {
        setTimeout(() => reject(Object.assign(new Error('init hung'), { code: 'hung' })), 800);
      }),
    ]);
  } catch (caught) {
    err = caught;
  } finally {
    sockets.restore();
    logs.restore();
    restoreEnv();
    fresh();
  }
  const elapsed = Date.now() - started;
  assert.equal(err && err.code, 'issuer_sign_unavailable');
  assert.ok(elapsed < 500, `elapsed ${elapsed}`);
  assert.equal(sendCalled, true);
  assert.equal(seen.length, 1);
  assert.equal(seen[0].region, 'us-east-1');
  assert.deepEqual(seen[0].credentials, { accessKeyId: ACCESS, secretAccessKey: SECRET });
  assert.equal(sockets.hits.length, 0);
  const text = logs.text();
  assert.match(text, /issuer_sign_unavailable/);
  assert.match(text, /issuer signer boot refused/);
  assertNoSecrets(text);
});

test('kms init timeout bounds client construction before send', async () => {
  fresh();
  let factoryCalled = false;
  let sendCalled = false;
  const logs = captureLogs();
  const sockets = guardSockets();
  const started = Date.now();
  let err = null;
  try {
    await Promise.race([
      initIssuerSigner(kmsEnv({
        AWS_ACCESS_KEY_ID: ACCESS,
        AWS_SECRET_ACCESS_KEY: SECRET,
      }), {
        clientFactory() {
          factoryCalled = true;
          return new Promise(() => {});
        },
      }),
      new Promise((_, reject) => {
        setTimeout(() => reject(Object.assign(new Error('init hung'), { code: 'hung' })), 800);
      }),
    ]);
  } catch (caught) {
    err = caught;
  } finally {
    sockets.restore();
    logs.restore();
    fresh();
  }
  const elapsed = Date.now() - started;
  assert.equal(err && err.code, 'issuer_sign_unavailable');
  assert.ok(elapsed < 500, `elapsed ${elapsed}`);
  assert.equal(factoryCalled, true);
  assert.equal(sendCalled, false);
  assert.equal(sockets.hits.length, 0);
  assert.match(logs.text(), /issuer_sign_unavailable/);
  assertNoSecrets(logs.text());
});

test('env signer and an unset signer still boot with AWS keys unset', async () => {
  const sockets = guardSockets();
  try {
    for (const mode of [undefined, 'env']) {
      fresh();
      delete process.env.AWS_ACCESS_KEY_ID;
      delete process.env.AWS_SECRET_ACCESS_KEY;
      delete process.env.AWS_SESSION_TOKEN;
      delete process.env.ISSUER_PRIVATE_KEY;
      delete process.env.ISSUER_KID;
      delete process.env.ISSUER_KMS_KEY_ID;
      delete process.env.ISSUER_ROOT_ENABLED;
      process.env.NODE_ENV = 'test';
      if (mode == null) delete process.env.ISSUER_SIGNER;
      else process.env.ISSUER_SIGNER = mode;
      const signer = await initIssuerSigner(process.env);
      assert.equal(signer.kind, 'env');
      assert.equal(typeof signer.kid, 'string');
      assert.ok(signer.kid.length > 0);
    }
    assert.equal(sockets.hits.length, 0);
  } finally {
    sockets.restore();
    fresh();
    restoreEnv();
  }
});

test('flags off do not construct a checkpoint client when every store and checkpoint name is set', async () => {
  const names = [
    'CHIT_V13_STORE_PATH',
    'CHIT_V13_BIND_DIR',
    'CHIT_V13_ENV_FILE',
    'CHIT_V13_HOUSE_BOOK_ID',
    'CHIT_V13_HOUSE_TOKEN_FILE',
    'CHIT_CHECKPOINT_KMS_KEY_ID',
    'CHIT_CHECKPOINT_KMS_REGION',
    'CHIT_CHECKPOINT_ADDRESS',
    'CHIT_CHECKPOINT_MAX_FEE_PER_GAS',
    'CHIT_CHECKPOINT_KMS_TIMEOUT_MS',
    'CHIT_CHECKPOINT_AWS_CREDENTIALS_FILE',
    'CHIT_CHECKPOINT_AWS_PROFILE',
  ];
  assert.equal(names.length, 12);
  const base = {
    CHIT_V13_ISSUANCE: 'false',
    CHIT_V13_MAINNET_SEALER: 'false',
    CHIT_V13_STORE: 'false',
    CHIT_V13_STORE_PATH: '/tmp/chit-dummy-store',
    CHIT_V13_BIND_DIR: '/tmp/chit-dummy-bind',
    CHIT_V13_ENV_FILE: '/tmp/chit-dummy-env',
    CHIT_V13_HOUSE_BOOK_ID: 'ab'.repeat(32),
    CHIT_V13_HOUSE_TOKEN_FILE: '/tmp/chit-dummy-house-token',
    CHIT_CHECKPOINT_KMS_KEY_ID: 'alias/dummy-checkpoint',
    CHIT_CHECKPOINT_KMS_REGION: 'us-east-1',
    CHIT_CHECKPOINT_ADDRESS: `0x${'ab'.repeat(20)}`,
    CHIT_CHECKPOINT_MAX_FEE_PER_GAS: '1',
    CHIT_CHECKPOINT_KMS_TIMEOUT_MS: '1000',
    CHIT_CHECKPOINT_AWS_CREDENTIALS_FILE: '/tmp/chit-dummy-checkpoint-creds',
    CHIT_CHECKPOINT_AWS_PROFILE: 'dummy-checkpoint-profile',
  };
  for (const name of names) assert.equal(typeof base[name], 'string');
  const reads = [];
  const env = new Proxy(base, {
    get(target, prop, receiver) {
      if (typeof prop === 'string' && prop.startsWith('CHIT_')) reads.push(prop);
      return Reflect.get(target, prop, receiver);
    },
  });
  const sockets = guardSockets();
  let out = null;
  try {
    out = await wireV13Runtime(env, {
      openStore() { throw new Error('store opened'); },
      fs: {
        lstatSync() { throw new Error('statted'); },
        openSync() { throw new Error('opened'); },
      },
    });
  } finally {
    sockets.restore();
  }
  assert.deepEqual(out, { ok: true, wired: false });
  const flags = new Set(['CHIT_V13_ISSUANCE', 'CHIT_V13_MAINNET_SEALER', 'CHIT_V13_STORE']);
  assert.deepEqual(reads.filter((name) => !flags.has(name)), []);
  assert.equal(sockets.hits.length, 0);
});

test('issuer boot refusal log is the reason code and not the secret-bearing error', () => {
  const err = new Error(`boom ${ACCESS} ${SECRET} ${SESSION} ${KEY_ID} ${PAYLOAD}`);
  err.code = 'issuer_creds_missing';
  const seen = [];
  logIssuerSignerBootRefusal(err, {
    error(obj, msg) { seen.push([obj, msg]); },
  });
  assert.deepEqual(seen, [[{ code: 'issuer_creds_missing' }, 'issuer signer boot refused']]);
  assertNoSecrets(JSON.stringify(seen));
});

test('explicit issuer credentials resolve without IMDS or the process env pair', async () => {
  process.env.AWS_ACCESS_KEY_ID = ENV_ACCESS;
  process.env.AWS_SECRET_ACCESS_KEY = ENV_SECRET;
  process.env.AWS_SESSION_TOKEN = SESSION;
  delete process.env.AWS_EC2_METADATA_DISABLED;
  const sockets = guardSockets();
  let client = null;
  try {
    client = createIssuerKmsClient({
      region: 'us-east-1',
      credentials: { accessKeyId: ACCESS, secretAccessKey: SECRET },
    });
    const resolved = await client.config.credentials();
    assert.equal(resolved.accessKeyId, ACCESS);
    assert.equal(resolved.secretAccessKey, SECRET);
    assert.equal(resolved.sessionToken, undefined);
    assert.equal(sockets.hits.length, 0);
  } finally {
    if (client && typeof client.destroy === 'function') client.destroy();
    sockets.restore();
    restoreEnv();
  }
});

test('startServer logs the issuer refusal code and rethrows', () => {
  const src = readFileSync(new URL('../src/server.js', import.meta.url), 'utf8');
  const start = src.slice(src.indexOf('export async function startServer'));
  const at = start.indexOf('await initIssuerSigner()');
  const end = start.indexOf('Issuer ECDSA key initialized');
  assert.ok(at >= 0 && end > at);
  const block = start.slice(at, end);
  assert.match(block, /logIssuerSignerBootRefusal\(err, logger\);\s*throw err;/);
  assert.equal(block.includes('AWS_ACCESS_KEY_ID'), false);
  assert.equal(block.includes('AWS_SECRET_ACCESS_KEY'), false);
  assert.equal(block.includes('{ err'), false);
  assert.equal(block.includes(ACCESS), false);
});
