#!/usr/bin/env node
/**
 * emit-split.js — turn the resolved USDC revenue split (ADR 0001) into a
 * paste-ready Splits v2 deployment on Base.
 *
 * The protocol fee lands at ONE address on Base — a Splits v2 Split — that fans
 * USDC out to the buckets off the hot path (see src/revenue-split.js). This script
 * emits everything needed to deploy that Split with the Split's owner = the protocol
 * Safe, so allocations stay governance-adjustable on-chain with NO bespoke Solidity:
 *
 *   1. a human summary + validation of the configured buckets,
 *   2. the Splits v2 `Split` struct (recipients / allocations / totalAllocation /
 *      distributionIncentive), and
 *   3. the ABI-encoded `createSplit(...)` calldata to send to the SplitFactoryV2
 *      (paste into a Safe tx, or deploy via app.splits.org and use the summary).
 *
 * Default is a DRY RUN (no keys, no broadcast) — deliberately, because the Split's
 * owner is the Safe and we do not want a hot deployer key on the money path. Pass
 * --broadcast (with BASE_RPC_URL + DEPLOYER_PRIVATE_KEY + SPLITS_FACTORY_ADDRESS) to
 * actually createSplit from a throwaway deployer; the Split is still owned by the Safe.
 *
 * Usage:
 *   node services/gateway/scripts/emit-split.js
 *   REVENUE_TREASURY_ADDRESS=0x.. REVENUE_BUYBACK_ADDRESS=0x.. REVENUE_STAKERS_ADDRESS=0x.. \
 *     REVENUE_SPLIT_OWNER=0xSafe node services/gateway/scripts/emit-split.js
 *
 * Env:
 *   REVENUE_* (see src/revenue-split.js), REVENUE_DISTRIBUTION_INCENTIVE
 *   REVENUE_SPLIT_OWNER    Split owner (governance Safe). Required to emit calldata.
 *   REVENUE_SPLIT_CREATOR  optional; defaults to the owner.
 *   SPLITS_FACTORY_ADDRESS SplitFactoryV2 on Base (Push or Pull) — the calldata `to`.
 *                          Get the canonical address from https://docs.splits.org.
 *   --broadcast            BASE_RPC_URL + DEPLOYER_PRIVATE_KEY required to send.
 */
import { ethers } from 'ethers';
import {
  resolveSplit,
  validateSplit,
  toSplitsV2Config,
  describeSplit,
} from '../src/revenue-split.js';

// SplitFactoryV2.createSplit — Splits v2 (0xSplits). Owner keeps governance control.
const FACTORY_ABI = [
  'function createSplit(tuple(address[] recipients, uint256[] allocations, uint256 totalAllocation, uint16 distributionIncentive) splitParams, address owner, address creator) returns (address split)',
];

function log(...a) { console.log(...a); }
function hr() { log('─'.repeat(72)); }

async function main() {
  const broadcast = process.argv.includes('--broadcast');
  const env = process.env;

  const split = resolveSplit(env);
  const errors = validateSplit(split, { requireAddresses: true });

  hr();
  log('XFuel USDC revenue split → Splits v2 on Base (ADR 0001)');
  hr();
  const desc = describeSplit(split);
  log(`model: ${desc.model}`);
  log(`total: ${desc.totalBps} bps`);
  for (const b of desc.buckets) {
    log(`  ${b.key.padEnd(9)} ${String(b.pct).padStart(5)}%   ${b.address || '(address unset)'}   ${b.label}`);
  }

  if (errors.length) {
    hr();
    log('⚠  Not deployable yet — fix these first:');
    for (const e of errors) log(`   - ${e}`);
    log('\nSet REVENUE_TREASURY_ADDRESS / REVENUE_BUYBACK_ADDRESS / REVENUE_STAKERS_ADDRESS');
    log('(or a REVENUE_SPLIT JSON), and ensure bps sum to 10000.');
    process.exitCode = 1;
    return;
  }

  const cfg = toSplitsV2Config(split, {
    distributionIncentive: parseInt(env.REVENUE_DISTRIBUTION_INCENTIVE, 10) || 0,
  });
  const owner = env.REVENUE_SPLIT_OWNER || null;
  const creator = env.REVENUE_SPLIT_CREATOR || owner || null;

  hr();
  log('Splits v2 Split struct:');
  log(JSON.stringify(cfg, null, 2));
  log(`owner   : ${owner || '(REVENUE_SPLIT_OWNER unset — required)'}`);
  log(`creator : ${creator || '(defaults to owner)'}`);

  if (!owner || !ethers.isAddress(owner)) {
    hr();
    log('⚠  Set REVENUE_SPLIT_OWNER to the governance Safe to emit createSplit calldata.');
    process.exitCode = 1;
    return;
  }

  const iface = new ethers.Interface(FACTORY_ABI);
  const data = iface.encodeFunctionData('createSplit', [
    [cfg.recipients, cfg.allocations, cfg.totalAllocation, cfg.distributionIncentive],
    owner,
    creator,
  ]);

  const factory = env.SPLITS_FACTORY_ADDRESS || null;
  hr();
  log('Safe transaction (createSplit):');
  log(`  to    : ${factory || '(SPLITS_FACTORY_ADDRESS unset — SplitFactoryV2 on Base, see docs.splits.org)'}`);
  log(`  value : 0`);
  log(`  data  : ${data}`);
  hr();
  log('Deploy options:');
  log('  A) app.splits.org (Base) → New Split → recipients + %s above, owner = Safe.');
  log('  B) Send the calldata above from the Safe to SPLITS_FACTORY_ADDRESS.');
  log('  Then set REVENUE_SPLIT_ADDRESS (or X402_PAY_TO) to the returned Split address.');

  if (!broadcast) {
    log('\n(dry run — pass --broadcast with BASE_RPC_URL + DEPLOYER_PRIVATE_KEY to send)');
    return;
  }

  // Optional broadcast: throwaway deployer sends createSplit; Split is Safe-owned.
  const rpc = env.BASE_RPC_URL;
  const pk = env.DEPLOYER_PRIVATE_KEY;
  if (!rpc || !pk || !factory) {
    log('\n✗ --broadcast needs BASE_RPC_URL, DEPLOYER_PRIVATE_KEY, and SPLITS_FACTORY_ADDRESS.');
    process.exitCode = 1;
    return;
  }
  const provider = new ethers.JsonRpcProvider(rpc);
  const wallet = new ethers.Wallet(pk, provider);
  const contract = new ethers.Contract(factory, FACTORY_ABI, wallet);
  log(`\nBroadcasting createSplit from ${wallet.address} → ${factory} ...`);
  const tx = await contract.createSplit(
    [cfg.recipients, cfg.allocations, cfg.totalAllocation, cfg.distributionIncentive],
    owner,
    creator,
  );
  log(`  tx: ${tx.hash}`);
  const receipt = await tx.wait();
  log(`  mined in block ${receipt.blockNumber}. Set REVENUE_SPLIT_ADDRESS to the new Split.`);
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
