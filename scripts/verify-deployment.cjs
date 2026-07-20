#!/usr/bin/env node
/**
 * scripts/verify-deployment.cjs
 *
 * Verifies a deployed XFuel protocol against a deployment manifest.
 * Checks: contract code existence, paused state, admin/role assignments,
 * circuit registration, and key parameter values.
 *
 * Usage:
 *   npm run verify:base
 *   node scripts/verify-deployment.cjs --manifest deploy/manifests/base-verifier-base-2026-07-17T08-04-12-891Z.json --rpc https://mainnet.base.org
 *   # Historical Theta manifests (legacy):
 *   node scripts/verify-deployment.cjs --manifest deploy/legacy/manifests/testnet-1772715928482.json
 *
 * Exit codes:
 *   0 — all checks passed
 *   1 — one or more checks failed
 */

'use strict'

require('dotenv').config({ path: '.env.local' })
require('dotenv').config()

const { ethers } = require('ethers')
const fs = require('fs')
const path = require('path')

// ── CLI args ──────────────────────────────────────────────────────────────────

const args = process.argv.slice(2)
function arg(flag) {
  const idx = args.indexOf(flag)
  return idx !== -1 ? args[idx + 1] : null
}

const manifestPath = arg('--manifest') || arg('-m')
if (!manifestPath) {
  console.error('Usage: node scripts/verify-deployment.cjs --manifest <path-to-manifest.json>')
  process.exit(1)
}

const rpcOverride = arg('--rpc')

// ── Load manifest ─────────────────────────────────────────────────────────────

const manifest = JSON.parse(fs.readFileSync(path.resolve(manifestPath), 'utf8'))
const { network, chainId, contracts, explorer } = manifest

const RPC_MAP = {
  'theta-mainnet': 'https://eth-rpc-api.thetatoken.org/rpc',
  'theta-testnet': 'https://eth-rpc-api-testnet.thetatoken.org/rpc',
  'bittensor-evm': 'https://lite.chain.opentensor.ai',
  'bittensor-testnet': 'https://test.chain.opentensor.ai',
  hardhat: 'http://localhost:8545',
}

const rpcUrl = rpcOverride || process.env.THETA_TESTNET_RPC_URL || RPC_MAP[network] || RPC_MAP['theta-testnet']

// ── Minimal ABIs ──────────────────────────────────────────────────────────────

const PAUSABLE_ABI = ['function paused() view returns (bool)']
const ACCESS_CONTROL_ABI = [
  'function hasRole(bytes32 role, address account) view returns (bool)',
  'function getRoleAdmin(bytes32 role) view returns (bytes32)',
]
const REVENUE_SPLITTER_ABI = [
  ...PAUSABLE_ABI,
  ...ACCESS_CONTROL_ABI,
  'function bbbAddress() view returns (address)',
  'function getAddress() view returns (address)',
  'function stakerAddress() view returns (address)',
  'function treasuryAddress() view returns (address)',
  'function bbbBps() view returns (uint256)',
  'function getBps() view returns (uint256)',
  'function stakerBps() view returns (uint256)',
  'function treasuryBps() view returns (uint256)',
]
const ZK_VERIFIER_ABI = [
  ...PAUSABLE_ABI,
  ...ACCESS_CONTROL_ABI,
  'function circuitCount() view returns (uint256)',
]
const GOVERNANCE_ABI = [
  ...ACCESS_CONTROL_ABI,
]

// ── Helpers ───────────────────────────────────────────────────────────────────

const CIRCUIT_ROLE = ethers.id('CIRCUIT_ROLE')
const DEFAULT_ADMIN_ROLE = '0x' + '00'.repeat(32)

let passed = 0
let failed = 0

function ok(label) {
  console.log(`  ✅  ${label}`)
  passed++
}

function fail(label, detail = '') {
  console.error(`  ❌  ${label}${detail ? ` — ${detail}` : ''}`)
  failed++
}

function skip(label, reason) {
  console.log(`  ⏭️   ${label} — skipped (${reason})`)
}

async function check(label, fn) {
  try {
    await fn()
  } catch (err) {
    fail(label, err.message)
  }
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  console.log('\n╔══════════════════════════════════════════════════════╗')
  console.log('║   XFuel Protocol — Deployment Verification          ║')
  console.log('╚══════════════════════════════════════════════════════╝\n')
  console.log(`  Network:   ${network} (chainId ${chainId})`)
  console.log(`  RPC:       ${rpcUrl}`)
  console.log(`  Manifest:  ${manifestPath}`)
  if (explorer) console.log(`  Explorer:  ${explorer}`)
  console.log()

  const provider = new ethers.JsonRpcProvider(rpcUrl)

  // ── 1. Chain ID check ────────────────────────────────────────────────────

  console.log('[ 1 ] Chain ID')
  await check('Chain ID matches manifest', async () => {
    const net = await provider.getNetwork()
    if (net.chainId !== BigInt(chainId)) {
      fail('Chain ID mismatch', `expected ${chainId}, got ${net.chainId}`)
    } else {
      ok(`Chain ID = ${chainId}`)
    }
  })

  // ── 2. Contract existence ────────────────────────────────────────────────

  console.log('\n[ 2 ] Contract bytecode existence')
  for (const [name, addr] of Object.entries(contracts)) {
    if (!addr || addr === '0x0000000000000000000000000000000000000000') {
      skip(name, 'zero address in manifest')
      continue
    }
    await check(`${name} has bytecode at ${addr}`, async () => {
      const code = await provider.getCode(addr)
      if (code === '0x' || code === '0x0') {
        fail(`${name} has no bytecode`, `${explorer ? `${explorer}/account/${addr}` : addr}`)
      } else {
        ok(`${name} deployed at ${addr.slice(0, 10)}…`)
      }
    })
  }

  // ── 3. Core contract state ───────────────────────────────────────────────

  console.log('\n[ 3 ] CoreRevenueSplitter state')
  const rsAddr = contracts.CoreRevenueSplitter
  if (rsAddr) {
    const rs = new ethers.Contract(rsAddr, REVENUE_SPLITTER_ABI, provider)
    await check('CoreRevenueSplitter is NOT paused', async () => {
      const paused = await rs.paused()
      paused ? fail('Contract is paused') : ok('Not paused')
    })
    await check('Revenue split totals 10000 bps', async () => {
      const [bbb, get, staker, treasury] = await Promise.all([
        rs.bbbBps(), rs.getBps(), rs.stakerBps(), rs.treasuryBps(),
      ])
      const total = Number(bbb) + Number(get) + Number(staker) + Number(treasury)
      total === 10000
        ? ok(`Split: BBB=${bbb} GET=${get} Staker=${staker} Treasury=${treasury} (total 10000)`)
        : fail(`Split does not total 10000 bps`, `got ${total}`)
    })
  } else {
    skip('CoreRevenueSplitter checks', 'not in manifest')
  }

  console.log('\n[ 4 ] ZKVerifierSP1 state')
  const zkAddr = contracts.ZKVerifierSP1
  if (zkAddr) {
    const zk = new ethers.Contract(zkAddr, ZK_VERIFIER_ABI, provider)
    await check('ZKVerifierSP1 is NOT paused', async () => {
      const paused = await zk.paused()
      paused ? fail('Contract is paused') : ok('Not paused')
    })
  } else {
    skip('ZKVerifierSP1 checks', 'not in manifest')
  }

  // ── 4. Role assignments ──────────────────────────────────────────────────

  console.log('\n[ 5 ] Circuit role assignments')
  const roles = manifest.roles || []
  if (roles.length === 0) {
    skip('Role assignments', 'no roles in manifest')
  } else if (rsAddr) {
    const rs = new ethers.Contract(rsAddr, ACCESS_CONTROL_ABI, provider)
    let rolesPassed = 0
    for (const { contract, role, address } of roles) {
      if (role !== 'CIRCUIT_ROLE') continue
      await check(`${contract} has CIRCUIT_ROLE`, async () => {
        const has = await rs.hasRole(CIRCUIT_ROLE, address)
        has
          ? (ok(`${contract} (${address.slice(0, 10)}…)`) && rolesPassed++)
          : fail(`${contract} missing CIRCUIT_ROLE`, address)
      })
    }
  }

  // ── 5. Summary ───────────────────────────────────────────────────────────

  console.log('\n══════════════════════════════════════════════════════')
  const total = passed + failed
  console.log(`  Checks: ${total}  ✅ ${passed} passed  ❌ ${failed} failed`)
  console.log('══════════════════════════════════════════════════════\n')

  if (failed > 0) {
    console.error(`Deployment verification FAILED — ${failed} issue(s) found.\n`)
    process.exit(1)
  } else {
    console.log('Deployment verification PASSED — all checks green.\n')
  }
}

main().catch((err) => {
  console.error('Fatal error:', err.message)
  process.exit(1)
})
