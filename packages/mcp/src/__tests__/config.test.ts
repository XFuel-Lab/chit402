import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_BASE_URL, PUBLIC_DEMO_API_KEY } from 'xfuel-sdk';
import { parseArgs } from '../config.js';

/**
 * parseArgs reads process.env, so each test isolates the env vars it cares
 * about. Save/restore the full XFUEL_* surface to keep tests order-independent.
 */
const ENV_KEYS = [
  'XFUEL_API_URL',
  'XFUEL_API_KEY',
  'CHIT402_API_URL',
  'CHIT402_API_KEY',
  'CHIT_API_URL',
  'CHIT_API_KEY',
  'XFUEL_MCP_TRANSPORT',
  'XFUEL_MCP_PORT',
  'XFUEL_MCP_AUTH_TOKEN',
  'XFUEL_RPC_URL',
  'ZK_VERIFIER_ADDRESS',
];

function withCleanEnv<T>(fn: () => T): T {
  const saved: Record<string, string | undefined> = {};
  for (const k of ENV_KEYS) {
    saved[k] = process.env[k];
    delete process.env[k];
  }
  try {
    return fn();
  } finally {
    for (const k of ENV_KEYS) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
  }
}

test('defaults to stdio + hosted public beta when nothing is set', () => {
  withCleanEnv(() => {
    const { config, action } = parseArgs([]);
    assert.equal(action, undefined);
    assert.equal(config.transport, 'stdio');
    assert.equal(config.port, 3033);
    assert.equal(config.apiUrl, DEFAULT_BASE_URL);
    assert.equal(config.apiKey, PUBLIC_DEMO_API_KEY);
    assert.equal(config.httpAuthToken, undefined);
    assert.equal(config.rpcUrl, undefined);
    assert.equal(config.zkVerifierAddress, undefined);
    assert.equal('payerPrivateKey' in config, false);
  });
});

test('does not read a human payer-key path from env or flags', () => {
  withCleanEnv(() => {
    const parsed = parseArgs(['--payer-private-key', '0x1234']);
    assert.equal('payerPrivateKey' in parsed.config, false);
    const json = JSON.stringify(parsed.config);
    assert.doesNotMatch(json, /payerPrivateKey/);
    assert.doesNotMatch(json, /0x1234/);
  });
});

test('CLI flags override defaults', () => {
  withCleanEnv(() => {
    const { config } = parseArgs([
      '--http',
      '--port', '4100',
      '--api-url', 'http://localhost:3002',
      '--api-key', 'sk_test_123',
    ]);
    assert.equal(config.transport, 'http');
    assert.equal(config.port, 4100);
    assert.equal(config.apiUrl, 'http://localhost:3002');
    assert.equal(config.apiKey, 'sk_test_123');
  });
});

test('CLI flags take precedence over environment variables', () => {
  withCleanEnv(() => {
    process.env.XFUEL_MCP_TRANSPORT = 'http';
    process.env.XFUEL_MCP_PORT = '5000';
    process.env.XFUEL_API_URL = 'http://env-host:3002';
    const { config } = parseArgs(['--stdio', '--port', '6000', '--api-url', 'http://cli-host:3002']);
    assert.equal(config.transport, 'stdio');
    assert.equal(config.port, 6000);
    assert.equal(config.apiUrl, 'http://cli-host:3002');
  });
});

test('environment variables are used when no CLI flag is given', () => {
  withCleanEnv(() => {
    process.env.XFUEL_API_KEY = 'sk_env_key';
    process.env.XFUEL_RPC_URL = 'https://rpc.example';
    process.env.ZK_VERIFIER_ADDRESS = '0xVerifier';
    process.env.XFUEL_MCP_AUTH_TOKEN = 'bearer-token';
    const { config } = parseArgs([]);
    assert.equal(config.apiKey, 'sk_env_key');
    assert.equal(config.rpcUrl, 'https://rpc.example');
    assert.equal(config.zkVerifierAddress, '0xVerifier');
    assert.equal(config.httpAuthToken, 'bearer-token');
  });
});

test('--help and --version short-circuit with an action', () => {
  withCleanEnv(() => {
    assert.equal(parseArgs(['--help']).action, 'help');
    assert.equal(parseArgs(['-h']).action, 'help');
    assert.equal(parseArgs(['--version']).action, 'version');
    assert.equal(parseArgs(['-v']).action, 'version');
  });
});

test('CHIT402 / CHIT env aliases resolve when XFUEL vars are unset', () => {
  withCleanEnv(() => {
    process.env.CHIT402_API_URL = 'https://api.chit402.com';
    process.env.CHIT402_API_KEY = 'chit402-demo';
    const { config } = parseArgs([]);
    assert.equal(config.apiUrl, 'https://api.chit402.com');
    assert.equal(config.apiKey, 'chit402-demo');
  });
});

test('XFUEL env vars take precedence over CHIT402 aliases', () => {
  withCleanEnv(() => {
    process.env.XFUEL_API_URL = 'https://api.xfuel.app';
    process.env.CHIT402_API_URL = 'https://api.chit402.com';
    const { config } = parseArgs([]);
    assert.equal(config.apiUrl, 'https://api.xfuel.app');
  });
});

test('unknown flags are ignored rather than crashing', () => {
  withCleanEnv(() => {
    const { config, action } = parseArgs(['--not-a-real-flag', '--http']);
    assert.equal(action, undefined);
    assert.equal(config.transport, 'http');
  });
});

test('invalid --port falls back to the default', () => {
  withCleanEnv(() => {
    const { config } = parseArgs(['--port', 'not-a-number']);
    assert.equal(config.port, 3033);
  });
});
