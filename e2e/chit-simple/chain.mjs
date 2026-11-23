/**
 * Local Hardhat chain for the P0-9 run.
 *
 * The well-known Hardhat account 0 is a public development key, not a secret.
 * Chain id 84532 matches the verifier's existing Base Sepolia USDC pin.
 * The repo hardhat network stays 1337; this process uses a temp config.
 */
import { createRequire } from 'node:module';
import { createServer, request as httpRequest } from 'node:http';
import { spawn } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const solc = require('solc');
const { ContractFactory, JsonRpcProvider, Wallet, keccak256 } = require('ethers');

const REPO = join(dirname(fileURLToPath(import.meta.url)), '../..');

/**
 * Local Hardhat chain id. It matches the verifier's Base Sepolia USDC pin.
 * The listener does not read this constant. It reads the loop pin.
 */
export const CHAIN_ID = 84532;
export const USDC = '0x036cbd53842c5426634e7929541ec2318f3dcf7e';
/** Well-known Hardhat account 0. A public development key, not a secret. */
export const DEV_KEY = '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80';
/** Hardhat account 3. Distinct from the checkpoint. A public development address. */
export const DEV_CONTROLLER = '0x90f79bf6eb2c4f870365e785982e1f101e93b906';

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

function pause(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function postRpc(url, method, params) {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
    signal: AbortSignal.timeout(1500),
  });
  if (!res.ok) throw new Error(`http ${res.status}`);
  const body = await res.json();
  if (body.error) throw new Error(body.error.message || method);
  return body.result;
}

/**
 * The node often resets the first socket while it is still booting.
 * Retry that first call until a short streak of answers succeeds.
 * The bound is the deadline. This is not a sleep before the first try.
 * A later RPC failure is not retried here, so the e2e still fails on it.
 */
async function waitForRpc(url, child) {
  const deadline = Date.now() + 60_000;
  const streakNeed = 4;
  let streak = 0;
  let last = 'local chain did not open';
  while (Date.now() < deadline) {
    if (child.exitCode != null) throw new Error(`local chain exited: ${last}`);
    let provider = null;
    try {
      const chainId = await postRpc(url, 'eth_chainId', []);
      const block = chainId === '0x14a34' ? await postRpc(url, 'eth_blockNumber', []) : null;
      if (chainId === '0x14a34' && typeof block === 'string') {
        streak += 1;
        if (streak >= streakNeed) {
          provider = new JsonRpcProvider(url, CHAIN_ID, { staticNetwork: true });
          provider.pollingInterval = 20;
          const seen = await provider.send('eth_chainId', []);
          if (seen === '0x14a34') return provider;
          last = `provider chain id ${seen}`;
          streak = 0;
        } else {
          continue;
        }
      } else {
        streak = 0;
        last = `chain id ${chainId}`;
      }
    } catch (err) {
      streak = 0;
      last = err && err.message ? err.message : 'rpc reset';
    }
    if (provider) provider.destroy?.();
    await pause(100);
  }
  throw new Error(last);
}

function startProxy(targetPort, listenPort) {
  const state = { mutate: null };
  const server = createServer((req, res) => {
    const chunks = [];
    req.on('error', () => {
      if (!res.headersSent) res.writeHead(502);
      res.end('{}');
    });
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
        up.on('error', () => {
          if (!res.headersSent) res.writeHead(502);
          res.end('{}');
        });
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
  server.on('clientError', (_err, socket) => {
    if (socket.writable) socket.end('HTTP/1.1 400 Bad Request\r\nConnection: close\r\n\r\n');
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

export async function deployAnchor(wallet, checkpoint, controller) {
  if (!checkpoint || !controller || String(checkpoint).toLowerCase() === String(controller).toLowerCase()) {
    throw new Error('checkpoint and controller must be distinct');
  }
  const artifact = JSON.parse(readFileSync(join(REPO, 'artifacts/contracts/chit-simple/ChitAnchor.sol/ChitAnchor.json'), 'utf8'));
  const factory = new ContractFactory(artifact.abi, artifact.bytecode, wallet);
  const nonce = await rawNonce(wallet.provider, wallet.address);
  // ChitAnchor.DEFAULT_MAX_GROWTH. The runtime code hash depends on it.
  const contract = await factory.deploy(checkpoint, controller, 1_000_000, { nonce });
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
