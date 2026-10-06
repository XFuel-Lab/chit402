/**
 * Deploy the ChitIssuerRoot bytecode from cursor/chit-issuer-root-contract-729c
 * on a local anvil (chain id 84532) and read keys() through the verifier.
 * No mock ChainView. The anvil account is unlocked; its key is not in this file.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Contract, ContractFactory, Interface, JsonRpcProvider, getAddress } from 'ethers';

const here = dirname(fileURLToPath(import.meta.url));
const sol = join(here, 'fixtures/ChitIssuerRoot.sol');
const bin = '/home/ubuntu/.foundry/bin';
const forge = existsSync(join(bin, 'forge')) ? join(bin, 'forge') : 'forge';
const anvil = existsSync(join(bin, 'anvil')) ? join(bin, 'anvil') : 'anvil';

const GENESIS = 'IvFpmC-vPhkY_v0vidsrWVT9uzlE5XWKZgAEOeJTq1Q';
const NOT_BEFORE = 1788511925;

test('keys() and rootHash match real ChitIssuerRoot bytecode on anvil', async (t) => {
  if (spawnSync(anvil, ['--version'], { encoding: 'utf8' }).status !== 0) {
    t.skip('anvil is not installed');
    return;
  }
  const dir = mkdtempSync(join(tmpdir(), 'chit-issuer-root-'));
  writeFileSync(join(dir, 'foundry.toml'), [
    '[profile.default]',
    'src = "src"',
    'out = "out"',
    'solc = "0.8.24"',
    'optimizer = false',
    '',
  ].join('\n'));
  const srcDir = join(dir, 'src');
  mkdirSync(srcDir, { recursive: true });
  writeFileSync(join(srcDir, 'ChitIssuerRoot.sol'), readFileSync(sol));
  const built = spawnSync(forge, ['build'], { cwd: dir, encoding: 'utf8' });
  if (built.status !== 0) {
    rmSync(dir, { recursive: true, force: true });
    t.skip(`forge build failed: ${built.stderr || built.stdout}`);
    return;
  }
  const compiled = JSON.parse(readFileSync(join(dir, 'out/ChitIssuerRoot.sol/ChitIssuerRoot.json'), 'utf8'));
  rmSync(dir, { recursive: true, force: true });

  const port = 18532 + (process.pid % 1000);
  const child = spawn(anvil, ['--chain-id', '84532', '--port', String(port)], { stdio: 'ignore' });
  const url = `http://127.0.0.1:${port}`;
  await waitFor(async () => {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'eth_chainId', params: [] }),
    });
    if (!res.ok) throw new Error('anvil not ready');
  });
  const provider = new JsonRpcProvider(url, 84532, { staticNetwork: true });
  try {
    await waitFor(async () => { await provider.getBlockNumber(); });
    const signer = await provider.getSigner(0);
    const controller = await signer.getAddress();
    const kid = `0x${Buffer.from(GENESIS, 'base64url').toString('hex')}`;
    const bytecode = compiled.bytecode.object || compiled.bytecode;
    const factory = new ContractFactory(compiled.abi, bytecode, signer);
    const deployed = await factory.deploy(controller, kid, NOT_BEFORE);
    await deployed.waitForDeployment();
    const address = await deployed.getAddress();

    const {
      connectIssuerRootRpc,
      keyVerdictAt,
      recomputeRootHashes,
      REGISTRY_ABI,
    } = await import('../dist/index.js');
    const rpc = connectIssuerRootRpc(url, address, GENESIS);
    const view = await rpc.read('latest');
    const state = view.keys[GENESIS];
    assert.ok(state, 'genesis kid missing from chain logs');
    assert.equal(state.status, 2);
    assert.equal(state.wasActive, true);
    assert.equal(state.notBefore, NOT_BEFORE);
    assert.equal(state.notAfter, 0);
    assert.equal(state.revokedAt, 0);
    assert.equal(state.activatedAt, NOT_BEFORE);
    assert.equal(keyVerdictAt(GENESIS, 1700000000, view), 'key_outside_window');
    assert.equal(keyVerdictAt(GENESIS, NOT_BEFORE, view), 'ok');

    const iface = new Interface(REGISTRY_ABI);
    const before = iface.decodeFunctionResult('keyValidAt', await provider.call({
      to: address,
      data: iface.encodeFunctionData('keyValidAt', [kid, 1700000000]),
    }));
    assert.equal(before.ok, false);
    const after = iface.decodeFunctionResult('keyValidAt', await provider.call({
      to: address,
      data: iface.encodeFunctionData('keyValidAt', [kid, NOT_BEFORE + 10]),
    }));
    assert.equal(after.ok, true);

    const roots = recomputeRootHashes(view.logs, 84532, getAddress(address));
    assert.equal(roots.get(0), view.rootHash.toLowerCase());

    const block = await provider.getBlock('latest');
    const standby = `0x${Buffer.alloc(32, 7).toString('hex')}`;
    const notBefore = Number(block.timestamp) + 24 * 60 * 60 + 30;
    const registry = new Contract(address, REGISTRY_ABI, signer);
    try {
      await registry.commit.staticCall(
        [[1, standby, notBefore, 0]],
        [],
        1,
        `0x${'ab'.repeat(32)}`,
      );
    } catch (err) {
      throw new Error(`commit reverted: ${err.shortMessage || err.message}`);
    }
    const tx = await registry.commit(
      [[1, standby, notBefore, 0]],
      [],
      1,
      `0x${'ab'.repeat(32)}`,
    );
    const receipt = await tx.wait();
    assert.equal(receipt.status, 1);
    const committed = await rpc.read('latest');
    const recomputed = recomputeRootHashes(committed.logs, 84532, getAddress(address));
    assert.equal(recomputed.get(committed.rootSeq), committed.rootHash.toLowerCase());
    assert.equal(
      committed.rootSeq,
      1,
      `read block ${committed.blockNumber} tx block ${receipt.blockNumber} logs ${committed.logs.map((log) => log.event).join(',')}`,
    );
  } finally {
    child.kill('SIGTERM');
    provider.destroy();
  }
});

async function waitFor(fn) {
  let last;
  for (let i = 0; i < 50; i += 1) {
    try {
      await fn();
      return;
    } catch (err) {
      last = err;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }
  throw last;
}
