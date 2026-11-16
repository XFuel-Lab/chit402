/**
 * Read-only measurements.
 *
 * Local λ is the close time from a local run, labeled local.
 * A Base Sepolia deposit observation is an input, not Δ_fin.
 * Q-R20: the Base sequencing window on the OP stack is about 12h.
 * See the deposit flow at docs.optimism.io and docs.base.org.
 * A measured deposit latency is a lower bound only.
 *
 * This file is not a sealer. It does not send a transaction.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const RPC = 'https://sepolia.base.org';

async function rpc(method, params) {
  const res = await fetch(RPC, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
    signal: AbortSignal.timeout(8000),
  });
  if (!res.ok) throw new Error(`http ${res.status}`);
  const body = await res.json();
  if (body.error) throw new Error(body.error.message || 'rpc error');
  return body.result;
}

function localLambda() {
  try {
    const table = JSON.parse(readFileSync(join(here, '../../../e2e/chit-simple/tamper-matrix.json'), 'utf8'));
    const samples = Array.isArray(table.samples) ? table.samples.filter((n) => Number.isFinite(n)) : [];
    if (samples.length === 0) return { label: 'local', status: 'pending: needs a local run' };
    const sorted = [...samples].sort((a, b) => a - b);
    const mid = sorted[Math.floor(sorted.length / 2)];
    return {
      label: 'local',
      unit: 'ms',
      samples: samples.length,
      min: sorted[0],
      median: mid,
      max: sorted[sorted.length - 1],
      note: 'Close time on the local Hardhat chain. Not a Sepolia figure.',
    };
  } catch {
    return { label: 'local', status: 'pending: needs a local run' };
  }
}

let deposit = { status: 'pending: needs network', chain: 'base-sepolia', lowerBoundOnly: true };
try {
  const chainId = await rpc('eth_chainId', []);
  const latest = await rpc('eth_getBlockByNumber', ['latest', false]);
  deposit = {
    status: 'head_observed',
    chain: 'base-sepolia',
    chainId,
    block: latest?.number ?? null,
    timestamp: latest?.timestamp ?? null,
    lowerBoundOnly: true,
    note: 'The public head answered. A deposit latency was not derived from this head. Q-R20 sequences on a window of about 12h; a measured deposit, when one exists, is a lower bound and is not Δ_fin.',
  };
} catch (err) {
  deposit = {
    status: 'pending: needs network',
    chain: 'base-sepolia',
    error: String(err?.message || err),
    lowerBoundOnly: true,
  };
}

const report = {
  collectedAt: new Date().toISOString(),
  lambda: localLambda(),
  deposit,
  citation: 'Q-R20. Base sequencing window, OP stack, about 12h. docs.optimism.io deposit flow and docs.base.org.',
};
writeFileSync(join(here, 'local.json'), `${JSON.stringify(report, null, 2)}\n`);
process.stdout.write(`${JSON.stringify(report)}\n`);
