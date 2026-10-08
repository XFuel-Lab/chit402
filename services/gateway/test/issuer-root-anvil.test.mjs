/**
 * Deploys the ChitIssuerRoot creation bytecode on Anvil (chain 84532) and
 * runs the strict startup check against two RPC URLs. The logs are the
 * contract's, not a hand-encoded fixture.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { ContractFactory, JsonRpcProvider, Wallet, ZeroHash, zeroPadBytes } from 'ethers';
import { buildLegacyReceiptSet, legacyUniverseId } from '../src/legacy-receipt-merkle.js';
import {
  EVENT_TOPICS,
  ROOT_COMMITTED_TOPIC,
  _resetIssuerRootStartupState,
  assertIssuerRootStartup,
} from '../src/issuer-root.js';
import { buildReceipt, decodeReceiptClaims } from '../src/receipt.js';
import { _resetIssuerKey } from '../src/issuer-key.js';
import { resetIssuerHistoryStore } from '../src/issuer-history.js';

process.env.HUB_CATALOG_OFFLINE = 'true';
process.env.TASK_STORE_PERSIST = 'false';

function anvilPath() {
  const home = process.env.HOME || '';
  const prefixes = ['/home/ubuntu/.foundry/bin', home ? `${home}/.foundry/bin` : ''].filter(Boolean);
  const path = [...prefixes, ...(process.env.PATH || '').split(':')].filter(Boolean).join(':');
  const probe = spawnSync('anvil', ['--version'], { encoding: 'utf8', env: { ...process.env, PATH: path } });
  if (probe.status === 0) return path;
  return null;
}

const ANVIL_PATH = anvilPath();
if (ANVIL_PATH) process.env.PATH = ANVIL_PATH;

const abi = JSON.parse(fs.readFileSync(fileURLToPath(new URL('../abi/ChitIssuerRoot.json', import.meta.url)), 'utf8')).abi;
const bytecode = fs.readFileSync(fileURLToPath(new URL('./fixtures/ChitIssuerRoot.creation.hex', import.meta.url)), 'utf8').trim();

function startAnvil(port) {
  const child = spawn('anvil', ['--chain-id', '84532', '--port', String(port)], {
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let text = '';
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`anvil ${port} did not start`)), 10000);
    const onData = (chunk) => {
      text += chunk.toString();
      const key = text.match(/\(0\)\s+(0x[0-9a-fA-F]{64})/);
      if (key && text.includes('Listening')) {
        clearTimeout(timer);
        resolve({ child, key: key[1] });
      }
    };
    child.stdout.on('data', onData);
    child.stderr.on('data', onData);
    child.on('exit', (code) => {
      if (!text.includes('Listening')) reject(new Error(`anvil exited ${code}`));
    });
  });
}

function proxyTo(port, targetPort) {
  const server = http.createServer((req, res) => {
    const chunks = [];
    req.on('data', (chunk) => chunks.push(chunk));
    req.on('end', () => {
      const upstream = http.request({
        hostname: '127.0.0.1',
        port: targetPort,
        method: req.method,
        path: req.url,
        headers: req.headers,
      }, (up) => {
        res.writeHead(up.statusCode || 500, up.headers);
        up.pipe(res);
      });
      upstream.on('error', () => {
        if (!res.headersSent) res.writeHead(502);
        res.end();
      });
      upstream.end(Buffer.concat(chunks));
    });
  });
  return new Promise((resolve) => {
    server.listen(port, '127.0.0.1', () => resolve(server));
  });
}

test('strict startup accepts two RPCs serving Anvil chain 84532 bytecode', {
  skip: ANVIL_PATH ? false : 'anvil is not installed (Foundry). This strict startup check is skipped until anvil is on PATH.',
}, async () => {
  const port = 18621;
  const proxyPort = 18622;
  const anvil = await startAnvil(port);
  const proxy = await proxyTo(proxyPort, port);
  const url = `http://127.0.0.1:${port}`;
  const url2 = `http://127.0.0.1:${proxyPort}`;
  const prev = {};
  const keys = [
    'ISSUER_ROOT_ENABLED', 'ISSUER_ROOT_CHAIN_ID', 'ISSUER_ROOT_REGISTRY', 'ISSUER_ROOT_SEQ',
    'ISSUER_ROOT_HASH', 'ISSUER_ROOT_STARTUP_CHECK', 'ISSUER_ROOT_RPC_URL', 'ISSUER_ROOT_RPC_URL_2',
    'ISSUER_ROOT_ALLOW_SKIP', 'ISSUER_ROOT_LEGACY_SET', 'ISSUER_ROOT_CUTOVER', 'ISSUER_PRIVATE_KEY',
    'ISSUER_KEY_NOT_BEFORE',
  ];
  for (const key of keys) prev[key] = process.env[key];
  const dir = fs.mkdtempSync('/tmp/issuer-root-anvil-');
  try {
    const provider = new JsonRpcProvider(url);
    const wallet = new Wallet(anvil.key, provider);
    const factory = new ContractFactory(abi, bytecode, wallet);
    const deployed = await factory.deploy(wallet.address, zeroPadBytes('0x22', 32), 1700000000);
    await deployed.waitForDeployment();
    const registry = await deployed.getAddress();
    const artifact = buildLegacyReceiptSet([{
      task_id: 'xfuel-anvil-legacy',
      issuer_signature: { payload_version: 10, payload_hash: '33'.repeat(32), jws: 'h.p.s' },
    }]);
    const nonce = await provider.getTransactionCount(wallet.address);
    const tx = await deployed.commit([], [{
      universeId: zeroPadBytes(`0x${legacyUniverseId()}`, 32),
      universeHash: artifact.root,
      enumeratedCount: artifact.enumerated_count,
    }], 1, ZeroHash, { nonce });
    const mined = await tx.wait();
    const commitBlock = Number(mined.blockNumber);
    for (let i = 0; i < 40; i += 1) {
      const fin = await provider.getBlock('finalized');
      if (fin && Number(fin.number) >= commitBlock) break;
      await provider.send('anvil_mine', ['0x10']);
    }
    const fin = await provider.getBlock('finalized');
    assert.ok(Number(fin.number) >= commitBlock, 'finalized block includes the commit');
    const logs = await provider.getLogs({ address: registry, fromBlock: 0, toBlock: Number(fin.number) });
    const rootLog = logs.find((log) => log.topics[0] === ROOT_COMMITTED_TOPIC);
    assert.ok(rootLog, 'bytecode emitted RootCommitted');
    assert.equal(rootLog.topics[0], EVENT_TOPICS.RootCommitted);
    assert.equal(EVENT_TOPICS.KeyActivated, logs.find((log) => log.topics[0] === EVENT_TOPICS.KeyActivated)?.topics[0]);
    assert.ok(logs.some((log) => log.topics[0] === EVENT_TOPICS.GenesisSeeded));

    const setFile = `${dir}/set.json`;
    fs.writeFileSync(setFile, JSON.stringify(artifact));
    const { privateKey } = crypto.generateKeyPairSync('ec', { namedCurve: 'P-256' });
    process.env.ISSUER_PRIVATE_KEY = Buffer.from(privateKey.export({ type: 'pkcs8', format: 'pem' })).toString('base64');
    process.env.ISSUER_KEY_NOT_BEFORE = '2026-09-04T08:52:05Z';
    process.env.ISSUER_ROOT_ENABLED = 'true';
    process.env.ISSUER_ROOT_CHAIN_ID = 'eip155:84532';
    process.env.ISSUER_ROOT_REGISTRY = registry;
    process.env.ISSUER_ROOT_SEQ = (await deployed.rootSeq()).toString();
    process.env.ISSUER_ROOT_HASH = await deployed.rootHash();
    process.env.ISSUER_ROOT_STARTUP_CHECK = 'strict';
    const logicalA = 'http://anvil.provider-a.example:18621';
    const logicalB = 'http://anvil.provider-b.test:18622';
    process.env.ISSUER_ROOT_RPC_URL = logicalA;
    process.env.ISSUER_ROOT_RPC_URL_2 = logicalB;
    process.env.ISSUER_ROOT_LEGACY_SET = setFile;
    delete process.env.ISSUER_ROOT_CUTOVER;
    delete process.env.ISSUER_ROOT_ALLOW_SKIP;
    _resetIssuerKey();
    _resetIssuerRootStartupState();
    resetIssuerHistoryStore();

    const started = await assertIssuerRootStartup({
      fetchImpl: (input, init) => {
        const raw = String(input);
        const target = raw === logicalA ? url : raw === logicalB ? url2 : raw;
        return fetch(target, init);
      },
    });
    assert.equal(started.checked, true);
    assert.equal(started.reason, 'finalized');
    const chainId = await fetch(url2, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'eth_chainId', params: [] }),
    }).then((res) => res.json());
    assert.equal(Number(chainId.result), 84532);

    const receipt = buildReceipt({
      taskId: 'xfuel-anvil-v11',
      status: 'completed',
      createdAt: '2026-09-26T17:27:32Z',
      updatedAt: '2026-09-26T17:27:32Z',
      intent: {
        type: 'inference_request',
        paymentRail: 'usdc',
        paymentRef: `base:0x${'ab'.repeat(32)}`,
        amount: '2000',
        modelId: 'theta/qwen3',
      },
      meta: {
        payerWallet: '0x1111111111111111111111111111111111111111',
        payTo: '0x2222222222222222222222222222222222222222',
        provider: 'theta-edgecloud',
        agentId: 4,
      },
      result: { provider: 'theta-edgecloud', model: 'theta/qwen3', output: 'private' },
    }, { signingSecret: 's', agentId: 4 });
    assert.equal(decodeReceiptClaims(receipt).payload_version, 11);
    assert.equal(decodeReceiptClaims(receipt).issuer_root.root_hash, process.env.ISSUER_ROOT_HASH);

    const lied = JSON.parse(fs.readFileSync(setFile, 'utf8'));
    lied.leaves[0].payload_hash = '44'.repeat(32);
    fs.writeFileSync(setFile, JSON.stringify(lied));
    assert.throws(() => buildReceipt({
      taskId: 'xfuel-anvil-paused',
      status: 'completed',
      createdAt: '2026-09-26T17:27:32Z',
      updatedAt: '2026-09-26T17:27:32Z',
      intent: {
        type: 'inference_request',
        paymentRail: 'usdc',
        paymentRef: `base:0x${'cd'.repeat(32)}`,
        amount: '2000',
        modelId: 'theta/qwen3',
      },
      meta: {
        payerWallet: '0x1111111111111111111111111111111111111111',
        payTo: '0x2222222222222222222222222222222222222222',
        provider: 'theta-edgecloud',
        agentId: 4,
      },
      result: { provider: 'theta-edgecloud', model: 'theta/qwen3' },
    }, { signingSecret: 's', agentId: 4 }), (err) => err.code === 'issuer_root_cutover_pause');
  } finally {
    proxy.close();
    anvil.child.kill();
    fs.rmSync(dir, { recursive: true, force: true });
    for (const key of keys) {
      if (prev[key] == null) delete process.env[key];
      else process.env[key] = prev[key];
    }
    _resetIssuerKey();
    _resetIssuerRootStartupState();
    resetIssuerHistoryStore();
  }
});
