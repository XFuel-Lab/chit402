#!/usr/bin/env node
// Read-only check of a Base Sepolia deployment. Exits nonzero on any mismatch.
// Does not broadcast and does not take a key.
//
//   BASE_SEPOLIA_RPC_URL=... CHIT_ANCHOR_CHECKPOINT=... CHIT_ANCHOR_TX=... \
//     node check-deploy.mjs <deployed-address>
//
// CHIT_ANCHOR_DEPLOYER and CHIT_ANCHOR_NONCE recompute the expected code hash.
// When they are unset, the pinned example in expected-runtime.json is used,
// and the checkpoint must be that example's checkpoint.
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const ROTATION_TOPIC = '0x95d3ad0e28a557ff091289f350472166359808c1308277737cd6cc7cacc4e8b3';

export function decodeRotation(data) {
  const hex = String(data || '').toLowerCase().replace(/^0x/, '');
  if (!/^[0-9a-f]*$/.test(hex) || hex.length < 192) return null;
  const version = BigInt(`0x${hex.slice(0, 64)}`);
  const oldAddr = `0x${hex.slice(88, 128)}`;
  const newAddr = `0x${hex.slice(152, 192)}`;
  return { version, oldAddr, newAddr };
}

export function rotationLogs(payload) {
  const logs = Array.isArray(payload) ? payload : (payload && payload.logs) || [];
  return logs.filter((log) => {
    const topics = log.topics || [];
    return topics.length > 0 && topics[0].toLowerCase() === ROTATION_TOPIC;
  });
}

function fail(message) {
  process.stderr.write(`${message}\n`);
  process.exit(1);
}

function cast(args) {
  const result = spawnSync('cast', args, { encoding: 'utf8' });
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
  const tx = process.env.CHIT_ANCHOR_TX;
  if (!address || !rpc || !checkpoint) {
    process.stderr.write('usage: BASE_SEPOLIA_RPC_URL=... CHIT_ANCHOR_CHECKPOINT=... node check-deploy.mjs <deployed-address>\n');
    process.exit(2);
  }
  const onCheckpoint = cast(['call', address, 'checkpoint()(address)', '--rpc-url', rpc]).toLowerCase();
  const version = BigInt(cast(['call', address, 'checkpointVersion()(uint64)', '--rpc-url', rpc]));
  const code = cast(['code', address, '--rpc-url', rpc]);
  const hash = cast(['keccak', code]).toLowerCase();
  const expected = expectedHash(checkpoint);
  if (onCheckpoint !== checkpoint) fail(`checkpoint() ${onCheckpoint} != ${checkpoint}`);
  if (version !== 1n) fail(`checkpointVersion() is ${version}, expected 1`);
  if (hash !== expected.hash) fail(`code hash ${hash} != ${expected.hash}`);
  if (expected.address && address !== expected.address) fail(`address ${address} != ${expected.address}`);

  const raw = tx
    ? cast(['receipt', tx, '--rpc-url', rpc, '--json'])
    : cast(['logs', '--address', address, '--from-block', '0', ROTATION_TOPIC, '--rpc-url', rpc, '--json']);
  const logs = rotationLogs(JSON.parse(raw));
  if (logs.length !== 1) fail(`expected one rotation event, found ${logs.length}`);
  const decoded = decodeRotation(logs[0].data);
  if (!decoded) fail('rotation event data is not three words');
  if (decoded.version !== 1n) fail(`rotation version is ${decoded.version}, expected 1`);
  if (decoded.oldAddr !== `0x${'0'.repeat(40)}`) fail('genesis rotation old address is not zero');
  if (decoded.newAddr !== checkpoint) fail(`rotation new address ${decoded.newAddr} != ${checkpoint}`);
  process.stdout.write(`ok address=${address} checkpoint=${onCheckpoint} version=1 codeHash=${hash}\n`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) main();
