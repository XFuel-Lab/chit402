/**
 * Local Hardhat chain for the P0-9 run.
 *
 * The well-known Hardhat account 0 is a public development key, not a secret.
 * Chain id 84532 matches the verifier's existing Base Sepolia USDC pin.
 * The repo hardhat network stays 1337; this process uses a temp config.
 */
import { createRequire } from 'node:module';
import http, { createServer, request as httpRequest } from 'node:http';

// ethers attaches its request error listener after request.end(). A reset in
// that gap is an uncaught exception and skips the chain's teardown.
const rawRequest = http.request;
http.request = function requestWithError(...args) {
  const req = rawRequest.apply(this, args);
  req.on('error', () => {});
  return req;
};
process.on('unhandledRejection', (err) => {
  if (err && (err.code === 'ECONNRESET' || err.code === 'ECONNREFUSED')) return;
  throw err;
});
import { spawn } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const solc = require('solc');
const { ContractFactory, JsonRpcProvider, Wallet, keccak256 } = require('ethers');

const REPO = join(dirname(fileURLToPath(import.meta.url)), '../..');
export const CHAIN_ID = 84532;
export const USDC = '0x036cbd53842c5426634e7929541ec2318f3dcf7e';
/** Well-known Hardhat account 0. A public development key, not a secret. */
export const DEV_KEY = '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80';

function compileMock() {
  const source = readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'MockUSDC.sol'), 'utf8');
  const input = {
    language: 'Solidity',
    sources: { 'MockUSDC.sol': { content: source } },
    settings: { outputSelection: { '*': { '*': ['abi', 'evm.bytecode.object'] } } },
  };
  const out = JSON.parse(solc.compile(JSON.stringify(input)));
  const contract = out.contracts?.['MockUSDC.sol']?.MockUSDC;
  if (!contract) throw new Error(`mock compile failed ${JSON.stringify(out.errors || out)}`);
  return { abi: contract.abi, bytecode: `0x${contract.evm.bytecode.object}` };
}

function waitForRpc(url, child) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('local chain did not open')), 60_000);
    const poll = async () => {
      if (child.exitCode != null) {
        clearTimeout(timer);
        reject(new Error('local chain exited'));
        return;
      }
      try {
        const res = await fetch(url, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'eth_chainId', params: [] }),
          signal: AbortSignal.timeout(1000),
        });
        const body = await res.json();
        if (body.result === '0x14a34') {
          clearTimeout(timer);
          const provider = new JsonRpcProvider(url, CHAIN_ID, { staticNetwork: true });
          provider.pollingInterval = 20;
          provider.on('error', () => {});
          resolve(provider);
          return;
        }
      } catch { /* not up yet */ }
      setTimeout(poll, 200);
    };
    poll();
  });
}

function startProxy(targetPort, listenPort) {
  const state = { mutate: null };
  const server = createServer((req, res) => {
    const chunks = [];
    req.on('data', (chunk) => chunks.push(chunk));
    req.on('end', () => {
      const body = Buffer.concat(chunks);
      const call = httpRequest({
        hostname: '127.0.0.1',
        port: targetPort,
        method: 'POST',
        path: '/',
        headers: { 'content-type': 'application/json', 'content-length': body.length },
      }, (up) => {
        const out = [];
        up.on('data', (chunk) => out.push(chunk));
        up.on('end', () => {
          let text = Buffer.concat(out).toString('utf8');
          try {
            const req = JSON.parse(body.toString('utf8'));
            const resJson = JSON.parse(text);
            // Hardhat names a revert in more than one way. The verifier already
            // treats the words "execution reverted" as a revert, which is not
            // a failure for the v0 getters. Both proxies apply the same words.
            if (req.method === 'eth_call' && resJson.error && typeof resJson.error.message === 'string' && !/execution reverted/i.test(resJson.error.message)) {
              resJson.error.message = `execution reverted: ${resJson.error.message}`;
            }
            const next = state.mutate ? state.mutate(req, resJson) : resJson;
            if (next) text = JSON.stringify(next);
          } catch { /* forward the node bytes */ }
          res.writeHead(up.statusCode || 200, { 'content-type': 'application/json' });
          res.end(text);
        });
      });
      call.on('error', () => {
        if (!res.headersSent) res.writeHead(502);
        res.end('{}');
      });
      call.end(body);
    });
  });
  return new Promise((resolve) => {
    server.listen(listenPort, '127.0.0.1', () => resolve({
      state,
      close() {
        server.closeAllConnections?.();
        server.close();
        server.unref();
      },
    }));
  });
}

export async function startChain() {
  const dir = mkdtempSync(join(tmpdir(), 'chit-p09-'));
  const configPath = join(dir, 'hardhat.cjs');
  writeFileSync(configPath, `const base = require(${JSON.stringify(join(REPO, 'hardhat.config.cjs'))});\nbase.networks.hardhat.chainId = ${CHAIN_ID};\nmodule.exports = base;\n`);
  const node = spawn('npx', ['hardhat', 'node', '--hostname', '127.0.0.1', '--port', '18545', '--config', configPath], {
    cwd: REPO,
    detached: true,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let log = '';
  node.stdout.on('data', (chunk) => { log += chunk; if (log.length > 20_000) log = log.slice(-10_000); });
  node.stderr.on('data', (chunk) => { log += chunk; if (log.length > 20_000) log = log.slice(-10_000); });
  node.unref();
  node.stdout.unref();
  node.stderr.unref();
  const stopNode = async () => {
    try { process.kill(-node.pid, 'SIGKILL'); } catch { try { node.kill('SIGKILL'); } catch { /* already gone */ } }
    await Promise.race([
      new Promise((resolve) => node.once('exit', resolve)),
      new Promise((resolve) => setTimeout(resolve, 1000)),
    ]);
  };
  try {
    const provider = await waitForRpc('http://127.0.0.1:18545', node);
    const proxy = await startProxy(18545, 18546);
    const mirror = await startProxy(18545, 18547);
    const wallet = new Wallet(DEV_KEY, provider);
    return {
      provider,
      wallet,
      urls: ['http://127.0.0.1:18546', 'http://127.0.0.1:18547'],
      proxy,
      mirror,
      log: () => log,
      async stop() {
        proxy.close();
        mirror.close();
        provider.destroy?.();
        await stopNode();
      },
    };
  } catch (err) {
    await stopNode();
    throw new Error(`${err.message}\n${log.slice(-2000)}`);
  }
}

async function rawNonce(provider, address) {
  const value = await provider.send('eth_getTransactionCount', [address, 'latest']);
  return Number(value);
}

export async function deployAnchor(wallet, checkpoint) {
  const artifact = JSON.parse(readFileSync(join(REPO, 'artifacts/contracts/chit-simple/ChitAnchor.sol/ChitAnchor.json'), 'utf8'));
  const factory = new ContractFactory(artifact.abi, artifact.bytecode, wallet);
  const nonce = await rawNonce(wallet.provider, wallet.address);
  const contract = await factory.deploy(checkpoint, { nonce });
  const mined = await contract.deploymentTransaction().wait();
  if (!mined || mined.status !== 1) throw new Error('anchor deploy reverted');
  const address = (await contract.getAddress()).toLowerCase();
  const code = await wallet.provider.getCode(address);
  return { address, codeHash: keccak256(code), contract };
}

export async function installUsdc(wallet) {
  const compiled = compileMock();
  const factory = new ContractFactory(compiled.abi, compiled.bytecode, wallet);
  const deployed = await factory.deploy({ nonce: await rawNonce(wallet.provider, wallet.address) });
  const mined = await deployed.deploymentTransaction().wait();
  if (!mined || mined.status !== 1) throw new Error('mock deploy reverted');
  const code = await wallet.provider.getCode(await deployed.getAddress());
  await wallet.provider.send('hardhat_setCode', [USDC, code]);
  return new ContractFactory(compiled.abi, compiled.bytecode, wallet).attach(USDC);
}

export async function rpc(method, params, url = 'http://127.0.0.1:18545') {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
    signal: AbortSignal.timeout(8000),
  });
  const body = await res.json();
  if (body.error) {
    const err = new Error(`${body.error.message || method} ${JSON.stringify(body.error.data ?? '')}`);
    throw err;
  }
  return body.result;
}

export function bump(hexQty) {
  const n = BigInt(hexQty);
  return `0x${(n + 1n).toString(16)}`;
}
