#!/usr/bin/env node
// Read-only check of a Base Sepolia deployment. Exits nonzero on any mismatch.
// Does not broadcast and does not take a key.
//
//   BASE_SEPOLIA_RPC_URL=... CHIT_ANCHOR_CHECKPOINT=... CHIT_ANCHOR_CONTROLLER=... \
//     CHIT_ANCHOR_TX=... node check-deploy.mjs <deployed-address>
//
// CHIT_ANCHOR_DEPLOYER and CHIT_ANCHOR_NONCE recompute the expected code hash.
// When they are unset, the pinned example in expected-runtime.json is used,
// and the checkpoint must be that example's checkpoint.
// The controller must be a Safe proxy. Offline tests call checkController
// with fixture JSON and do not open an RPC.
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
export const ROTATION_TOPIC = '0x95d3ad0e28a557ff091289f350472166359808c1308277737cd6cc7cacc4e8b3';

export function decodeRotation(data) {
  const hex = String(data || '').toLowerCase().replace(/^0x/, '');
  if (!/^[0-9a-f]*$/.test(hex) || hex.length < 192) return null;
  const version = BigInt(`0x${hex.slice(0, 64)}`);
  const oldAddr = `0x${hex.slice(88, 128)}`;
  const newAddr = `0x${hex.slice(152, 192)}`;
  return { version, oldAddr, newAddr };
}

export function receiptBinding(receipt, address) {
  if (!receipt || typeof receipt !== 'object') return 'receipt is missing';
  const status = receipt.status;
  const ok = status === 1 || status === '0x1' || status === '0x01' || String(status) === '1';
  if (!ok) return `receipt status ${status}`;
  const created = String(receipt.contractAddress || '').toLowerCase();
  if (created !== String(address || '').toLowerCase()) {
    return `receipt contractAddress ${created} != ${address}`;
  }
  return '';
}

export function rotationLogs(payload, emitter) {
  const want = String(emitter || '').toLowerCase();
  const logs = Array.isArray(payload) ? payload : (payload && payload.logs) || [];
  return logs.filter((log) => {
    const topics = log.topics || [];
    if (!topics.length || String(topics[0]).toLowerCase() !== ROTATION_TOPIC) return false;
    if (!want) return true;
    return String(log.address || '').toLowerCase() === want;
  });
}

// SafeL2 1.4.1 singleton. Same address on every chain in the canonical registry,
// including Base Sepolia (84532).
export const SAFE_SINGLETON = '0x29fcb43b46531bca003ddc8fcb67ffe91900c762';

// Runtime code of the Safe proxy deployed by Safe Proxy Factory v1.4.1.
// The singleton lives in storage slot 0, not in this bytecode.
export const SAFE_PROXY_RUNTIME = '0x608060405273ffffffffffffffffffffffffffffffffffffffff600054167fa619486e0000000000000000000000000000000000000000000000000000000060003514156050578060005260206000f35b3660008037600080366000845af43d6000803e60008114156070573d6000fd5b3d6000f3fea264697066735822122003d1488ee65e08fa41e58e888a9865554c535f2c77126a82cb4c0f917f31441364736f6c63430007060033';

function normCode(value) {
  const hex = String(value || '').trim().toLowerCase();
  if (!hex || hex === '0x') return '0x';
  return hex.startsWith('0x') ? hex : `0x${hex}`;
}

function normAddr(value) {
  const hex = String(value || '').trim().toLowerCase().replace(/^0x/, '');
  if (!/^[0-9a-f]*$/.test(hex) || hex.length < 40) return '';
  return `0x${hex.slice(-40)}`;
}

function readThreshold(value) {
  const match = String(value ?? '').trim().match(/^(0x[0-9a-f]+|\d+)/i);
  if (!match) return null;
  try {
    return BigInt(match[1]);
  } catch {
    return null;
  }
}

// view is {code, singleton, threshold, owners}. No network.
export function checkController(view) {
  if (!view || typeof view !== 'object') return 'controller view is missing';
  const code = normCode(view.code);
  if (code === '0x') return 'controller is an EOA';
  if (code !== SAFE_PROXY_RUNTIME) return 'controller code is not a Safe proxy';
  const singleton = normAddr(view.singleton);
  if (singleton !== SAFE_SINGLETON) return 'singleton is not the pinned Safe version';
  const threshold = readThreshold(view.threshold);
  if (threshold !== 2n) return 'threshold is not 2';
  if (!Array.isArray(view.owners) || view.owners.length !== 3) return 'owners are not 3';
  return '';
}

function controllerView(controller, rpc) {
  const code = cast(['code', controller], rpc);
  const slot = cast(['storage', controller, '0'], rpc);
  const threshold = cast(['call', controller, 'getThreshold()(uint256)'], rpc);
  const ownersText = cast(['call', controller, 'getOwners()(address[])'], rpc);
  const owners = ownersText.match(/0x[0-9a-fA-F]{40}/g) || [];
  return { code, singleton: normAddr(slot), threshold, owners };
}

function fail(message) {
  process.stderr.write(`${message}\n`);
  process.exit(1);
}

function cast(args, rpc) {
  const result = spawnSync('cast', args, {
    encoding: 'utf8',
    env: { ...process.env, ETH_RPC_URL: rpc },
  });
  if (result.status !== 0) {
    process.stderr.write(result.stderr || result.stdout || 'cast failed\n');
    process.exit(result.status || 1);
  }
  return (result.stdout || '').trim();
}

function expectedHash(checkpoint) {
  const deployer = process.env.CHIT_ANCHOR_DEPLOYER;
  const nonce = process.env.CHIT_ANCHOR_NONCE;
  const doc = JSON.parse(readFileSync(join(here, 'expected-runtime.json'), 'utf8'));
  if (!deployer || nonce === undefined || nonce === '') {
    if (checkpoint.toLowerCase() !== doc.example.checkpoint.toLowerCase()) {
      fail('set CHIT_ANCHOR_DEPLOYER and CHIT_ANCHOR_NONCE to recompute the code hash');
    }
    return { hash: doc.example.runtimeCodeHash.toLowerCase(), address: doc.example.contract.toLowerCase() };
  }
  const preview = spawnSync(process.execPath, [join(here, 'print-runtime.mjs'), deployer, String(nonce), checkpoint], {
    encoding: 'utf8',
  });
  if (preview.status !== 0) {
    process.stderr.write(preview.stderr || preview.stdout || 'preview failed\n');
    process.exit(preview.status || 1);
  }
  const hash = (preview.stdout.match(/runtimeCodeHash=(0x[0-9a-f]{64})/) || [])[1];
  const address = (preview.stdout.match(/address=(0x[0-9a-f]{40})/) || [])[1];
  if (!hash || !address) fail('preview did not print an address and a code hash');
  return { hash, address };
}

function main() {
  const address = (process.argv[2] || '').toLowerCase();
  const rpc = process.env.BASE_SEPOLIA_RPC_URL;
  const checkpoint = (process.env.CHIT_ANCHOR_CHECKPOINT || '').toLowerCase();
  const controller = (process.env.CHIT_ANCHOR_CONTROLLER || '').toLowerCase();
  const tx = process.env.CHIT_ANCHOR_TX;
  if (!address || !rpc || !checkpoint || !controller) {
    process.stderr.write('usage: BASE_SEPOLIA_RPC_URL=... CHIT_ANCHOR_CHECKPOINT=... CHIT_ANCHOR_CONTROLLER=... node check-deploy.mjs <deployed-address>\n');
    process.exit(2);
  }
  const onCheckpoint = cast(['call', address, 'checkpoint()(address)'], rpc).toLowerCase();
  const onController = cast(['call', address, 'controller()(address)'], rpc).toLowerCase();
  const version = BigInt(cast(['call', address, 'checkpointVersion()(uint64)'], rpc));
  const code = cast(['code', address], rpc);
  const hash = cast(['keccak', code], rpc).toLowerCase();
  const expected = expectedHash(checkpoint);
  if (onCheckpoint !== checkpoint) fail(`checkpoint() ${onCheckpoint} != ${checkpoint}`);
  if (onController !== controller) fail(`controller() ${onController} != ${controller}`);
  if (version !== 1n) fail(`checkpointVersion() is ${version}, expected 1`);
  if (hash !== expected.hash) fail(`code hash ${hash} != ${expected.hash}`);
  if (expected.address && address !== expected.address) fail(`address ${address} != ${expected.address}`);
  const controllerProblem = checkController(controllerView(controller, rpc));
  if (controllerProblem) fail(controllerProblem);

  let logs;
  if (tx) {
    const receipt = JSON.parse(cast(['receipt', tx, '--json'], rpc));
    const binding = receiptBinding(receipt, address);
    if (binding) fail(binding);
    logs = rotationLogs(receipt, address);
  } else {
    logs = rotationLogs(JSON.parse(cast(['logs', '--address', address, '--from-block', '0', ROTATION_TOPIC, '--json'], rpc)), address);
  }
  if (logs.length !== 1) fail(`expected one rotation event, found ${logs.length}`);
  const decoded = decodeRotation(logs[0].data);
  if (!decoded) fail('rotation event data is not three words');
  if (decoded.version !== 1n) fail(`rotation version is ${decoded.version}, expected 1`);
  if (decoded.oldAddr !== `0x${'0'.repeat(40)}`) fail('genesis rotation old address is not zero');
  if (decoded.newAddr !== checkpoint) fail(`rotation new address ${decoded.newAddr} != ${checkpoint}`);
  process.stdout.write(`ok address=${address} checkpoint=${onCheckpoint} controller=${onController} version=1 codeHash=${hash}\n`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) main();
