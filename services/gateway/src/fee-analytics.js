#!/usr/bin/env node

/**
 * XFuel Protocol — Fee Analytics Script
 *
 * Real-time monitoring of protocol revenue across all fee streams:
 *   • AI task fees (0.5-1% via calculate_task_fee from api.js/server.js)
 *   • A2A relay fees (0.1% on escrow amounts)
 *   • Bridge fees (0.5% forward + reverse)
 *   • LP swap fees (0.01% Osmosis/Dexter)
 *
 * Simulates the 30/30/25/15 revenue split (BBB / LP / veXF / Treasury)
 * and differentiates AI vs. yield volume (target: 60% AI, 25% data/comms,
 * 15% financial settlements).
 *
 * Integrations:
 *   - FeeCollector.wasm   → CW20 Receive/Query (accumulated_fees, total_burned)
 *   - server.js           → /task-request fees, /task-status settlements
 *   - api.js              → calculateTaskFee, FEE_CONFIG, REVENUE_SPLIT constants
 *   - AIVerifier.wasm     → RouteTask / SettleTask fee collection
 *   - RevenueSplitter.sol → On-chain 30/30/25/15 distribution
 *
 * Outputs:
 *   - Console summary (default)
 *   - JSON (--format json)
 *   - Prometheus-compatible metrics (--format prometheus)
 *   - Charts data for FeeVisualizer frontend component (--charts)
 *
 * Usage:
 *   node fee-analytics.js --chain osmosis --period 24h
 *   node fee-analytics.js --chain akash --period 7d --format json
 *   node fee-analytics.js --period 30d --format prometheus --port 9100
 *   node fee-analytics.js --simulate --volume 2000000 --ai-share 0.6
 *   node fee-analytics.js --charts --output fee-charts.json
 *
 * Environment Variables:
 *   M2M_API_URL           Backend M2M API URL (default: http://localhost:3002)
 *   M2M_API_KEY           API key for authenticated endpoints
 *   OSMOSIS_LCD_URL       Osmosis LCD endpoint for FeeCollector queries
 *   FEE_COLLECTOR_ADDR    FeeCollector.wasm contract address on Osmosis
 *   PROM_PORT             Prometheus metrics server port (default: 9100)
 *
 * @module fee-analytics
 * @version 1.0.0
 * @since v4.5 — Osmosis/Akash Direct + AI DePIN Bridge Edition
 */

import http from 'http';

// ─── CLI Argument Parsing ─────────────────────────────────────────────────────

const args = process.argv.slice(2);

function getFlag(name) {
  return args.includes(`--${name}`);
}

function getArg(name, defaultVal) {
  const idx = args.indexOf(`--${name}`);
  if (idx === -1 || idx + 1 >= args.length) return defaultVal;
  return args[idx + 1];
}

const CLI = {
  chain:     getArg('chain', 'all'),          // osmosis | akash | theta | bittensor | persistence | all
  period:    getArg('period', '24h'),          // 1h, 6h, 24h, 7d, 30d
  format:    getArg('format', 'console'),      // console | json | prometheus
  port:      parseInt(getArg('port', process.env.PROM_PORT || '9100'), 10),
  simulate:  getFlag('simulate'),
  simulateSensitivity: getFlag('simulate-sensitivity'),
  volume:    parseFloat(getArg('volume', '2000000')),
  aiShare:   parseFloat(getArg('ai-share', '0.6')),
  charts:    getFlag('charts'),
  output:    getArg('output', ''),
  watch:     getFlag('watch'),
  interval:  parseInt(getArg('interval', '60'), 10), // seconds between watch cycles
  help:      getFlag('help') || getFlag('h'),
};

if (CLI.help) {
  console.log(`
╔══════════════════════════════════════════════════════════════════════════════╗
║  XFuel Fee Analytics — Revenue Monitoring for XFuel Protocol v4.5          ║
╚══════════════════════════════════════════════════════════════════════════════╝

USAGE:
  node fee-analytics.js [options]

OPTIONS:
  --chain <name>      Filter by chain: osmosis, akash, theta, bittensor,
                      persistence, all (default: all)
  --period <span>     Time period: 1h, 6h, 24h, 7d, 30d (default: 24h)
  --format <fmt>      Output format: console, json, prometheus (default: console)
  --port <n>          Prometheus metrics server port (default: 9100)
  --simulate          Run revenue simulation (no live data needed)
  --volume <n>        Simulated monthly volume in USD (default: 2000000)
  --ai-share <0-1>    AI task share of volume (default: 0.6)
  --charts            Output chart data for FeeVisualizer frontend component
  --simulate-sensitivity  Run full tokenomics sensitivity sweep + dilution model (MD output)
  --output <file>     Write output to file (e.g. fee-charts.json)
  --watch             Continuously poll and update metrics
  --interval <s>      Watch poll interval in seconds (default: 60)
  --help, -h          Show this help

EXAMPLES:
  node fee-analytics.js --chain osmosis --period 24h
  node fee-analytics.js --simulate --volume 5000000 --ai-share 0.65
  node fee-analytics.js --format prometheus --port 9100 --watch
  node fee-analytics.js --charts --output fee-charts.json
  node fee-analytics.js --chain akash --period 7d --format json

ENVIRONMENT:
  M2M_API_URL         Backend API URL (default: http://localhost:3002)
  M2M_API_KEY         API key for authenticated endpoints
  OSMOSIS_LCD_URL     Osmosis LCD for FeeCollector queries
  FEE_COLLECTOR_ADDR  FeeCollector.wasm address on Osmosis
  PROM_PORT           Prometheus metrics port (default: 9100)
`);
  process.exit(0);
}

// ─── Constants (synced with server.js / api.js / main.rs) ─────────────────────

const FEE_CONFIG = {
  defaultBps:     50,     // 0.5%
  minBps:         50,
  maxBps:         100,    // 1.0%
  a2aRelayBps:    10,     // 0.1%
  bridgeBps:      50,     // 0.5%
  lpSwapBps:      1,      // 0.01%
  denominator:    10000,
  minTaskAmount:  10000,
};

const REVENUE_SPLIT = {
  bbb:      { label: 'Buyback & Burn (BBB)', pct: 30, color: '#ff5252' },
  lp:       { label: 'LP Reinvestment',      pct: 30, color: '#69f0ae' },
  vexf:     { label: 'veXF Stakers',         pct: 25, color: '#00e5ff' },
  treasury: { label: 'Treasury',             pct: 15, color: '#b388ff' },
};

const CHAINS = ['theta', 'osmosis', 'akash', 'bittensor', 'persistence'];

const MESSAGE_TYPES = [
  'compute_bid', 'compute_result', 'inference_request',
  'capability_query', 'data_attestation',
];

/** Target volume composition (Phase E steady-state from whitepaper v4.5) */
const VOLUME_MIX_TARGETS = {
  aiTasks:    { pct: 60, label: 'AI Tasks (inference, compute bids)' },
  dataComms:  { pct: 25, label: 'Data & Communications (A2A/M2M)' },
  settlements: { pct: 15, label: 'Financial Settlements (bridge fees)' },
};

// ─── Fee Calculation (mirrors calculate_task_fee from api.js / server.js) ─────

/**
 * Calculate task fee — mirrors calculate_task_fee() in:
 *   - frontend/src/utils/api.js
 *   - backend/theta-bridge/src/server.js
 *   - sp1-prover/program/src/main.rs
 *   - contracts/AIDePINRouter.sol
 *
 * @param {string|number|bigint} grossAmount  Total task value
 * @param {number}               feeBps       Fee rate in BPS (50-100)
 * @returns {{ grossAmount: string, feeAmount: string, netAmount: string, feeBps: number, feePct: string }}
 */
function calculateTaskFee(grossAmount, feeBps = FEE_CONFIG.defaultBps) {
  const gross = BigInt(grossAmount || 0);
  const bps = BigInt(Math.min(Math.max(feeBps, FEE_CONFIG.minBps), FEE_CONFIG.maxBps));
  const fee = (gross * bps) / BigInt(FEE_CONFIG.denominator);
  const net = gross - fee;
  return {
    grossAmount: gross.toString(),
    feeAmount: fee.toString(),
    netAmount: net.toString(),
    feeBps: Number(bps),
    feePct: (Number(bps) / 100).toFixed(1),
  };
}

/**
 * Calculate A2A relay fee (0.1% on escrow) — mirrors calculateRelayFee in api.js.
 */
function calculateRelayFee(escrowAmount) {
  const escrow = BigInt(escrowAmount || 0);
  if (escrow <= 0n) return { feeAmount: '0', feeBps: 0 };
  const fee = (escrow * BigInt(FEE_CONFIG.a2aRelayBps)) / BigInt(FEE_CONFIG.denominator);
  return { feeAmount: fee.toString(), feeBps: FEE_CONFIG.a2aRelayBps };
}

/**
 * Apply the 30/30/25/15 revenue split to a total fee amount.
 */
function applySplit(totalFeeAmount) {
  const total = Number(totalFeeAmount);
  return {
    bbb:      { amount: total * 0.30, pct: 30 },
    lp:       { amount: total * 0.30, pct: 30 },
    vexf:     { amount: total * 0.25, pct: 25 },
    treasury: { amount: total * 0.15, pct: 15 },
  };
}

// ─── Period Parsing ───────────────────────────────────────────────────────────

function parsePeriodMs(period) {
  const match = period.match(/^(\d+)(h|d|m)$/);
  if (!match) return 24 * 60 * 60 * 1000; // default 24h
  const val = parseInt(match[1], 10);
  switch (match[2]) {
    case 'h': return val * 60 * 60 * 1000;
    case 'd': return val * 24 * 60 * 60 * 1000;
    case 'm': return val * 60 * 1000;
    default:  return 24 * 60 * 60 * 1000;
  }
}

// ─── Live Data Fetchers ───────────────────────────────────────────────────────

const M2M_API_URL = process.env.M2M_API_URL || 'http://localhost:3002';
const M2M_API_KEY = process.env.M2M_API_KEY || '';
const OSMOSIS_LCD_URL = process.env.OSMOSIS_LCD_URL || 'https://lcd.osmosis.zone';
const FEE_COLLECTOR_ADDR = process.env.FEE_COLLECTOR_ADDR || '';

/**
 * Fetch from the M2M API (server.js) with optional auth.
 */
async function fetchM2M(path) {
  const url = `${M2M_API_URL}${path}`;
  const headers = { 'Content-Type': 'application/json' };
  if (M2M_API_KEY) headers['X-API-Key'] = M2M_API_KEY;

  try {
    const res = await fetch(url, { headers, signal: AbortSignal.timeout(10000) });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

/**
 * Query FeeCollector.wasm state via Osmosis LCD (CosmWasm smart query).
 *
 * Returns: { accumulated_fees, total_burned, total_burns_count, last_burn_time }
 */
async function queryFeeCollectorState() {
  if (!FEE_COLLECTOR_ADDR) return null;
  const query = btoa(JSON.stringify({ state: {} }));
  const url = `${OSMOSIS_LCD_URL}/cosmwasm/wasm/v1/contract/${FEE_COLLECTOR_ADDR}/smart/${query}`;

  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(10000) });
    if (!res.ok) return null;
    const json = await res.json();
    return json.data || null;
  } catch {
    return null;
  }
}

/**
 * Query FeeCollector.wasm ready-to-burn status.
 */
async function queryFeeCollectorReady() {
  if (!FEE_COLLECTOR_ADDR) return null;
  const query = btoa(JSON.stringify({ ready_to_burn: {} }));
  const url = `${OSMOSIS_LCD_URL}/cosmwasm/wasm/v1/contract/${FEE_COLLECTOR_ADDR}/smart/${query}`;

  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(10000) });
    if (!res.ok) return null;
    const json = await res.json();
    return json.data || null;
  } catch {
    return null;
  }
}

/**
 * Fetch health metrics from server.js /health endpoint.
 */
async function fetchServerHealth() {
  return fetchM2M('/health');
}

// ─── Simulation Engine ────────────────────────────────────────────────────────

/**
 * Simulate protocol revenue for a given monthly volume.
 *
 * Models the three fee streams and applies the 30/30/25/15 split.
 * Differentiates AI vs. yield volume per whitepaper v4.5 targets.
 *
 * @param {number} monthlyVolume   Total monthly volume in units (e.g. USD)
 * @param {number} aiTaskShare     AI task volume share (0-1, default 0.6)
 * @returns {Object} Full simulation result
 */
function simulateRevenue(monthlyVolume, aiTaskShare = 0.6) {
  const dataCommsShare   = 0.25;
  const settlementShare  = 1 - aiTaskShare - dataCommsShare;

  // Volume breakdown
  const aiVolume          = monthlyVolume * aiTaskShare;
  const dataCommsVolume   = monthlyVolume * dataCommsShare;
  const settlementVolume  = monthlyVolume * settlementShare;

  // Fee calculations
  // AI tasks: average 0.75% (midpoint of 0.5-1% range)
  const aiTaskFee      = calculateTaskFee(Math.round(aiVolume).toString(), 75);
  // A2A relay: 0.1% on ~40% of data/comms volume (escrow-bearing messages)
  const a2aEscrow      = dataCommsVolume * 0.4;
  const a2aRelayFee    = calculateRelayFee(Math.round(a2aEscrow).toString());
  // Data attestation: 0.25% on ~30% of data/comms volume
  const attestVolume   = dataCommsVolume * 0.3;
  const attestFee      = calculateTaskFee(Math.round(attestVolume).toString(), 50); // 0.5% conservative
  // Bridge fees: 0.5% on settlement volume
  const bridgeFee      = calculateTaskFee(Math.round(settlementVolume).toString(), 50);

  // Total fees
  const totalFees = Number(aiTaskFee.feeAmount)
    + Number(a2aRelayFee.feeAmount)
    + Number(attestFee.feeAmount)
    + Number(bridgeFee.feeAmount);

  // Revenue split
  const split = applySplit(totalFees);

  // Burns simulation
  const monthlyBurns = split.bbb.amount;
  const yearlyBurns  = monthlyBurns * 12;

  // TVL milestone tracking ($5M unlocks from Phase D)
  const tvlUnlock = 5_000_000;
  const currentTvlEstimate = monthlyVolume * 2.5; // rough TVL multiplier

  return {
    period: '30d',
    monthlyVolume,
    volumeBreakdown: {
      aiTasks:     { volume: aiVolume, share: aiTaskShare, label: VOLUME_MIX_TARGETS.aiTasks.label },
      dataComms:   { volume: dataCommsVolume, share: dataCommsShare, label: VOLUME_MIX_TARGETS.dataComms.label },
      settlements: { volume: settlementVolume, share: settlementShare, label: VOLUME_MIX_TARGETS.settlements.label },
    },
    feeStreams: {
      aiTask: {
        label: 'AI Task Fees (0.5-1%)',
        volume: aiVolume,
        avgBps: 75,
        fees: Number(aiTaskFee.feeAmount),
        example: `$${aiVolume.toFixed(0)} volume × 0.75% = $${Number(aiTaskFee.feeAmount).toFixed(2)} fees`,
      },
      a2aRelay: {
        label: 'A2A Relay Fees (0.1%)',
        escrowVolume: a2aEscrow,
        bps: FEE_CONFIG.a2aRelayBps,
        fees: Number(a2aRelayFee.feeAmount),
        example: `$${a2aEscrow.toFixed(0)} escrow × 0.1% = $${Number(a2aRelayFee.feeAmount).toFixed(2)} relay fees`,
      },
      dataAttestation: {
        label: 'Data Attestation Fees (0.25-0.5%)',
        volume: attestVolume,
        bps: 50,
        fees: Number(attestFee.feeAmount),
      },
      bridge: {
        label: 'Bridge Fees (0.5% fwd + rev)',
        volume: settlementVolume,
        bps: FEE_CONFIG.bridgeBps,
        fees: Number(bridgeFee.feeAmount),
        example: `$${settlementVolume.toFixed(0)} settlements × 0.5% = $${Number(bridgeFee.feeAmount).toFixed(2)} bridge fees`,
      },
    },
    totalFees,
    revenueSplit: split,
    burns: {
      monthlyBBB: monthlyBurns,
      yearlyBBB: yearlyBurns,
      note: '30% of all fees → market buy XF → permanent burn',
    },
    tvlTracking: {
      currentEstimate: currentTvlEstimate,
      unlockThreshold: tvlUnlock,
      unlocked: currentTvlEstimate >= tvlUnlock,
      note: `$5M TVL unlocks Phase D mainnet deployment`,
    },
    examples: [
      {
        scenario: '$100 INFERENCE_REQUEST task → Akash GPU',
        grossAmount: '100',
        feeBps: 50,
        ...calculateTaskFee('10000000', 50), // 100 USD in micro-units
        splitBreakdown: {
          fee: '$0.50',
          bbb: '$0.15 (30%) → buy + burn XF',
          lp: '$0.15 (30%) → deepen Osmosis/Dexter pools',
          vexf: '$0.125 (25%) → distribute to veXF lockers',
          treasury: '$0.075 (15%) → operations + AI infra',
        },
      },
      {
        scenario: '$1,000 COMPUTE_BID task → Bittensor subnet 18',
        grossAmount: '1000',
        feeBps: 75,
        ...calculateTaskFee('100000000', 75),
        splitBreakdown: {
          fee: '$7.50',
          bbb: '$2.25 (30%)',
          lp: '$2.25 (30%)',
          vexf: '$1.875 (25%)',
          treasury: '$1.125 (15%)',
        },
      },
      {
        scenario: '$250 A2A COMPUTE_BID escrow (Theta → Akash)',
        escrowAmount: '250',
        relayFeeBps: 10,
        relayFee: '$0.25',
        splitBreakdown: {
          fee: '$0.25 (0.1% relay)',
          bbb: '$0.075 (30%)',
          lp: '$0.075 (30%)',
          vexf: '$0.0625 (25%)',
          treasury: '$0.0375 (15%)',
        },
      },
    ],
  };
}

// ─── Tokenomics Constants ─────────────────────────────────────────────────────

const TOKENOMICS = {
  totalSupply:       1_000_000_000,  // 1B XF (parameterised; adjust if tokenomics change)
  volumeToTvlRatio:  0.4,           // monthly volume ≈ 40% of TVL (whitepaper: $5M TVL → $2M vol)
  avgFeeBps:         50,            // 0.5% default (whitepaper steady-state)
};

// ─── Sensitivity Sweep ────────────────────────────────────────────────────────

/**
 * Generate a multi-dimensional sensitivity table across AI volume share,
 * TVL levels, and fee BPS rates.
 *
 * Anchored to whitepaper: $5M TVL → $2M monthly volume → $10K fees → $120K annual.
 *
 * @param {Object} [opts]
 * @param {number[]} [opts.aiShares]  AI volume shares (0-1)
 * @param {number[]} [opts.tvlLevels] TVL levels in USD
 * @param {number[]} [opts.bpsLevels] Fee rates in BPS
 * @returns {{ rows: Object[], summary: Object }}
 */
function sensitivitySweep(opts = {}) {
  const aiShares  = opts.aiShares  || [0.3, 0.4, 0.5, 0.6, 0.7, 0.8];
  const tvlLevels = opts.tvlLevels || Array.from({ length: 20 }, (_, i) => (i + 1) * 5_000_000);
  const bpsLevels = opts.bpsLevels || Array.from({ length: 20 }, (_, i) => 10 + i * (90 / 19));

  const rows = [];

  for (const tvl of tvlLevels) {
    const monthlyVolume = tvl * TOKENOMICS.volumeToTvlRatio;
    for (const aiShare of aiShares) {
      for (const bps of bpsLevels) {
        const roundedBps = Math.round(bps);
        const effectiveBps = Math.min(Math.max(roundedBps, FEE_CONFIG.minBps), FEE_CONFIG.maxBps);

        // Primary fee: task fee BPS applied to all volume (matches whitepaper flat-rate model).
        // A2A relay (10 BPS on ~40% of non-AI escrow) is additive but minor — included separately.
        const taskFees = (monthlyVolume * effectiveBps) / FEE_CONFIG.denominator;
        const a2aEscrowVolume = monthlyVolume * (1 - aiShare) * 0.4;
        const a2aRelayFees = (a2aEscrowVolume * FEE_CONFIG.a2aRelayBps) / FEE_CONFIG.denominator;
        const monthlyFees = taskFees + a2aRelayFees;
        const annualFees  = monthlyFees * 12;

        const split = applySplit(monthlyFees);
        const annualYieldOnTvl = tvl > 0 ? (annualFees / tvl) * 100 : 0;

        rows.push({
          tvl,
          monthlyVolume,
          aiShare,
          feeBps: effectiveBps,
          monthlyFees,
          annualFees,
          annualYieldPct: annualYieldOnTvl,
          monthlyBBB:      split.bbb.amount,
          monthlyVeXF:     split.vexf.amount,
          monthlyTreasury: split.treasury.amount,
          monthlyLP:       split.lp.amount,
        });
      }
    }
  }

  // Bear-market resilience: 60% volume drop from base case
  const baseCase = rows.find(r =>
    r.tvl === 5_000_000 && r.aiShare === 0.6 && r.feeBps === FEE_CONFIG.defaultBps
  );
  const bearVolume = baseCase ? baseCase.monthlyVolume * 0.4 : 800_000;
  const bearFees   = baseCase ? baseCase.monthlyFees * 0.4 : (bearVolume * FEE_CONFIG.defaultBps) / FEE_CONFIG.denominator;
  const bearAnnual = bearFees * 12;
  const bearOpsRunway = baseCase
    ? (baseCase.monthlyTreasury * 12) / (bearFees > 0 ? bearFees : 1)
    : 0;
  const resilienceScore = baseCase && baseCase.annualFees > 0
    ? Math.min(100, Math.round((bearAnnual / baseCase.annualFees) * 100))
    : 0;

  return {
    rows,
    baseCase,
    bearScenario: {
      volumeDropPct: 60,
      bearMonthlyVolume: bearVolume,
      bearMonthlyFees: bearFees,
      bearAnnualFees: bearAnnual,
      opsRunwayYears: bearOpsRunway,
      resilienceScore,
      note: `Resilience score: ${resilienceScore}% (target >50%). A score of 40% means 40% of base revenue survives a 60% volume crash.`,
    },
    summary: {
      tvlRange:   [tvlLevels[0], tvlLevels[tvlLevels.length - 1]],
      aiRange:    [aiShares[0], aiShares[aiShares.length - 1]],
      bpsRange:   [Math.round(bpsLevels[0]), Math.round(bpsLevels[bpsLevels.length - 1])],
      totalScenarios: rows.length,
    },
  };
}

// ─── Dilution Model ───────────────────────────────────────────────────────────

/**
 * Simulate BBB deflationary impact and treasury spend on XF supply & veXF yields.
 *
 * Models 1–3 year horizon with configurable treasury spend rate and BBB burn rate.
 * veXF yield multiplier capped at 3x (per governance cap in veXFGovernance.sol).
 *
 * @param {Object} [opts]
 * @param {number} [opts.initialSupply]      Starting circulating supply (default 1B)
 * @param {number} [opts.monthlyVolume]      Monthly protocol volume
 * @param {number} [opts.feeBps]             Average fee BPS
 * @param {number} [opts.treasurySpendPct]   Treasury spend as % of treasury fees (15-30%)
 * @param {number} [opts.xfPrice]            Starting XF price in USD
 * @param {number} [opts.veXFLockedPct]      % of supply locked as veXF
 * @param {number} [opts.years]              Simulation horizon (1-3)
 * @param {number} [opts.maxMultiplier]      veXF yield multiplier cap
 * @returns {{ months: Object[], summary: Object }}
 */
function dilutionModel(opts = {}) {
  const {
    initialSupply     = TOKENOMICS.totalSupply,
    monthlyVolume     = 2_000_000,
    feeBps            = FEE_CONFIG.defaultBps,
    treasurySpendPct  = 20,
    xfPrice           = 0.001,
    veXFLockedPct     = 15,
    years             = 3,
    maxMultiplier     = 3,
  } = opts;

  const totalMonths = years * 12;
  const months = [];

  let circulatingSupply = initialSupply;
  let totalBurned       = 0;
  let cumulativeRevenue = 0;
  let cumulativeBBB     = 0;
  let cumulativeVeXF    = 0;

  for (let m = 1; m <= totalMonths; m++) {
    const monthlyFees = (monthlyVolume * feeBps) / FEE_CONFIG.denominator;
    const split       = applySplit(monthlyFees);

    // BBB: buy XF at current price → burn
    const bbbUSD    = split.bbb.amount;
    const xfBought  = xfPrice > 0 ? bbbUSD / xfPrice : 0;
    const xfBurned  = Math.min(xfBought, circulatingSupply * 0.01); // cap at 1% of supply per month
    circulatingSupply -= xfBurned;
    totalBurned       += xfBurned;

    // Treasury spend
    const treasuryIncome = split.treasury.amount;
    const treasurySpend  = treasuryIncome * (treasurySpendPct / 100);
    const treasuryRetained = treasuryIncome - treasurySpend;

    // veXF yield
    const veXFLocked     = circulatingSupply * (veXFLockedPct / 100);
    const veXFRewardUSD  = split.vexf.amount;
    const veXFYieldMonthly = veXFLocked > 0 ? veXFRewardUSD / (veXFLocked * xfPrice) : 0;
    const veXFYieldAnnual  = veXFYieldMonthly * 12;

    // Effective multiplier (capped at maxMultiplier)
    const rawMultiplier = initialSupply > 0 ? initialSupply / circulatingSupply : 1;
    const effectiveMultiplier = Math.min(rawMultiplier, maxMultiplier);

    cumulativeRevenue += monthlyFees;
    cumulativeBBB     += bbbUSD;
    cumulativeVeXF    += veXFRewardUSD;

    // Deflation percentage from initial
    const deflationPct = initialSupply > 0 ? ((initialSupply - circulatingSupply) / initialSupply) * 100 : 0;

    months.push({
      month: m,
      year: Math.ceil(m / 12),
      circulatingSupply: Math.round(circulatingSupply),
      totalBurned: Math.round(totalBurned),
      deflationPct: parseFloat(deflationPct.toFixed(4)),
      monthlyFees,
      monthlyBBB: bbbUSD,
      xfBurnedThisMonth: Math.round(xfBurned),
      treasuryIncome,
      treasurySpend,
      treasuryRetained,
      veXFRewardUSD,
      veXFYieldMonthlyPct: parseFloat((veXFYieldMonthly * 100).toFixed(4)),
      veXFYieldAnnualPct:  parseFloat((veXFYieldAnnual * 100).toFixed(2)),
      effectiveMultiplier: parseFloat(effectiveMultiplier.toFixed(4)),
      cumulativeRevenue,
      cumulativeBBB,
      cumulativeVeXF,
    });
  }

  const lastMonth = months[months.length - 1];
  const year1 = months[11];
  const year2 = months[23];

  // Treasury spend sweep
  const treasurySpendSweep = [15, 20, 25, 30].map(pct => {
    const monthlyFees = (monthlyVolume * feeBps) / FEE_CONFIG.denominator;
    const treasuryIncome = monthlyFees * 0.15; // 15% split
    const annualSpend = treasuryIncome * 12 * (pct / 100);
    const annualRetained = treasuryIncome * 12 * (1 - pct / 100);
    return { spendPct: pct, annualSpend, annualRetained, monthlyBudget: annualSpend / 12 };
  });

  return {
    months,
    params: { initialSupply, monthlyVolume, feeBps, treasurySpendPct, xfPrice, veXFLockedPct, years, maxMultiplier },
    summary: {
      finalSupply:        lastMonth.circulatingSupply,
      totalBurned:        lastMonth.totalBurned,
      deflationPct:       lastMonth.deflationPct,
      cumulativeRevenue:  lastMonth.cumulativeRevenue,
      cumulativeBBB:      lastMonth.cumulativeBBB,
      cumulativeVeXF:     lastMonth.cumulativeVeXF,
      finalMultiplier:    lastMonth.effectiveMultiplier,
      year1VeXFYield:     year1?.veXFYieldAnnualPct || 0,
      year2VeXFYield:     year2?.veXFYieldAnnualPct || 0,
      year3VeXFYield:     lastMonth.veXFYieldAnnualPct,
    },
    treasurySpendSweep,
  };
}

// ─── Sensitivity Markdown Formatter ───────────────────────────────────────────

/**
 * Render the full sensitivity + dilution analysis as a Markdown document.
 */
function formatSensitivityMarkdown() {
  const sweep = sensitivitySweep();
  const dilution = dilutionModel();

  const lines = [];
  const hr = '---';

  lines.push('# XFuel Protocol — Tokenomics Sensitivity Analysis');
  lines.push('');
  lines.push('> Auto-generated by `fee-analytics.js --simulate-sensitivity`');
  lines.push(`> Generated: ${new Date().toISOString()}`);
  lines.push('');
  lines.push(`Total scenarios modelled: **${sweep.summary.totalScenarios.toLocaleString()}**`);
  lines.push('');
  lines.push(hr);
  lines.push('');

  // ── Section 1: Revenue Sensitivity by TVL ──────────────────────────────
  lines.push('## 1. Revenue Sensitivity by TVL');
  lines.push('');
  lines.push('Fixed: AI share = 60%, Fee = 50 BPS (0.5%). Anchored to whitepaper: $5M TVL → $120K annual.');
  lines.push('');
  lines.push('| TVL | Monthly Vol | Monthly Fees | Annual Fees | Yield on TVL | BBB/mo | veXF/mo | Treasury/mo |');
  lines.push('|----:|------------:|------------:|------------:|------------:|-------:|--------:|------------:|');

  const tvlRows = sweep.rows.filter(r => r.aiShare === 0.6 && r.feeBps === FEE_CONFIG.defaultBps);
  const seenTvl = new Set();
  for (const r of tvlRows) {
    if (seenTvl.has(r.tvl)) continue;
    seenTvl.add(r.tvl);
    lines.push(
      `| $${fmtNum(r.tvl)} | $${fmtNum(r.monthlyVolume)} | $${fmtNum(r.monthlyFees)} ` +
      `| $${fmtNum(r.annualFees)} | ${r.annualYieldPct.toFixed(2)}% ` +
      `| $${fmtNum(r.monthlyBBB)} | $${fmtNum(r.monthlyVeXF)} | $${fmtNum(r.monthlyTreasury)} |`
    );
  }
  lines.push('');
  lines.push(hr);
  lines.push('');

  // ── Section 2: AI Volume Share Impact ──────────────────────────────────
  lines.push('## 2. AI Volume Share Impact');
  lines.push('');
  lines.push('Fixed: TVL = $5M, Fee = 50 BPS. Shows how shifting from 30% to 80% AI-driven volume affects revenue.');
  lines.push('');
  lines.push('| AI Share | Monthly Fees | Annual Fees | Yield % |');
  lines.push('|--------:|------------:|------------:|--------:|');

  const aiRows = sweep.rows.filter(r => r.tvl === 5_000_000 && r.feeBps === FEE_CONFIG.defaultBps);
  const seenAi = new Set();
  for (const r of aiRows) {
    if (seenAi.has(r.aiShare)) continue;
    seenAi.add(r.aiShare);
    lines.push(
      `| ${(r.aiShare * 100).toFixed(0)}% ` +
      `| $${fmtNum(r.monthlyFees)} | $${fmtNum(r.annualFees)} | ${r.annualYieldPct.toFixed(2)}% |`
    );
  }
  lines.push('');
  lines.push(hr);
  lines.push('');

  // ── Section 3: Fee BPS Sweep ───────────────────────────────────────────
  lines.push('## 3. Fee BPS Sweep');
  lines.push('');
  lines.push('Fixed: TVL = $20M, AI share = 60%. Effective BPS clamped to [50, 100] per server.js/main.rs.');
  lines.push('');
  lines.push('| Fee BPS | Monthly Fees | Annual Fees | BBB/mo | veXF/mo | Treasury/mo |');
  lines.push('|-------:|------------:|------------:|-------:|--------:|------------:|');

  const bpsRows = sweep.rows.filter(r => r.tvl === 20_000_000 && r.aiShare === 0.6);
  const seenBps = new Set();
  for (const r of bpsRows) {
    if (seenBps.has(r.feeBps)) continue;
    seenBps.add(r.feeBps);
    lines.push(
      `| ${r.feeBps} | $${fmtNum(r.monthlyFees)} | $${fmtNum(r.annualFees)} ` +
      `| $${fmtNum(r.monthlyBBB)} | $${fmtNum(r.monthlyVeXF)} | $${fmtNum(r.monthlyTreasury)} |`
    );
  }
  lines.push('');
  lines.push(hr);
  lines.push('');

  // ── Section 4: Bear Market Resilience ──────────────────────────────────
  lines.push('## 4. Bear Market Resilience');
  lines.push('');
  const bear = sweep.bearScenario;
  lines.push(`Simulated **${bear.volumeDropPct}% volume crash** from the $5M TVL base case.`);
  lines.push('');
  lines.push('| Metric | Base Case | Bear (-60%) |');
  lines.push('|--------|----------:|------------:|');
  if (sweep.baseCase) {
    lines.push(`| Monthly Volume | $${fmtNum(sweep.baseCase.monthlyVolume)} | $${fmtNum(bear.bearMonthlyVolume)} |`);
    lines.push(`| Monthly Fees | $${fmtNum(sweep.baseCase.monthlyFees)} | $${fmtNum(bear.bearMonthlyFees)} |`);
    lines.push(`| Annual Revenue | $${fmtNum(sweep.baseCase.annualFees)} | $${fmtNum(bear.bearAnnualFees)} |`);
  }
  lines.push(`| **Resilience Score** | 100% | **${bear.resilienceScore}%** |`);
  lines.push('');
  lines.push(`> ${bear.note}`);
  lines.push('');
  lines.push(hr);
  lines.push('');

  // ── Section 5: Dilution Model ──────────────────────────────────────────
  lines.push('## 5. BBB Deflation & veXF Yield Model');
  lines.push('');
  lines.push(`Parameters: ${fmtNum(dilution.params.initialSupply)} XF supply, $${fmtNum(dilution.params.monthlyVolume)}/mo volume, ` +
    `${dilution.params.feeBps} BPS fee, ${dilution.params.veXFLockedPct}% veXF locked, ` +
    `$${dilution.params.xfPrice} XF price, ${dilution.params.treasurySpendPct}% treasury spend.`);
  lines.push('');
  lines.push('| Year | Circulating Supply | Total Burned | Deflation % | Cumulative Revenue | veXF APY | Multiplier |');
  lines.push('|-----:|-------------------:|-------------:|------------:|-------------------:|---------:|-----------:|');

  for (const m of dilution.months) {
    if (m.month % 12 !== 0) continue;
    lines.push(
      `| Y${m.year} | ${fmtNum(m.circulatingSupply)} | ${fmtNum(m.totalBurned)} ` +
      `| ${m.deflationPct.toFixed(2)}% | $${fmtNum(m.cumulativeRevenue)} ` +
      `| ${m.veXFYieldAnnualPct.toFixed(2)}% | ${m.effectiveMultiplier.toFixed(2)}x |`
    );
  }
  lines.push('');

  // Monthly detail for first year
  lines.push('### Year 1 Monthly Detail');
  lines.push('');
  lines.push('| Month | Supply | Burned/mo | Deflation % | Fees/mo | BBB/mo | veXF Yield |');
  lines.push('|------:|-------:|----------:|------------:|--------:|-------:|-----------:|');
  for (const m of dilution.months) {
    if (m.month > 12) break;
    lines.push(
      `| ${m.month} | ${fmtNum(m.circulatingSupply)} | ${fmtNum(m.xfBurnedThisMonth)} ` +
      `| ${m.deflationPct.toFixed(4)}% | $${fmtNum(m.monthlyFees)} ` +
      `| $${fmtNum(m.monthlyBBB)} | ${m.veXFYieldAnnualPct.toFixed(2)}% |`
    );
  }
  lines.push('');
  lines.push(hr);
  lines.push('');

  // ── Section 6: Treasury Spend Sweep ────────────────────────────────────
  lines.push('## 6. Treasury Spend Scenarios');
  lines.push('');
  lines.push('How different treasury spend rates (of the 15% treasury allocation) affect operational budget:');
  lines.push('');
  lines.push('| Spend Rate | Annual Spend | Annual Retained | Monthly Budget |');
  lines.push('|-----------:|------------:|----------------:|---------------:|');
  for (const s of dilution.treasurySpendSweep) {
    lines.push(
      `| ${s.spendPct}% | $${fmtNum(s.annualSpend)} | $${fmtNum(s.annualRetained)} | $${fmtNum(s.monthlyBudget)} |`
    );
  }
  lines.push('');
  lines.push(hr);
  lines.push('');

  // ── Section 7: Believer Round Impact ───────────────────────────────────
  lines.push('## 7. Believer Round Impact');
  lines.push('');
  lines.push('The BelieverRound contract (cliff: 90 days, linear vesting: 365 days) enables community ');
  lines.push('micro-commitments that directly impact protocol bootstrapping:');
  lines.push('');

  const believerScenarios = [
    { raised: 50_000,  label: 'Minimum viable',    auditPct: 60, treasuryPct: 40 },
    { raised: 150_000, label: 'Target',             auditPct: 50, treasuryPct: 50 },
    { raised: 500_000, label: 'Strong oversubscription', auditPct: 30, treasuryPct: 70 },
  ];

  lines.push('| Scenario | Raised | Audit Allocation | Treasury Injection | TVL Boost Est. | Revenue Impact |');
  lines.push('|----------|-------:|-----------------:|-------------------:|---------------:|---------------:|');

  for (const sc of believerScenarios) {
    const auditAlloc    = sc.raised * (sc.auditPct / 100);
    const treasuryAlloc = sc.raised * (sc.treasuryPct / 100);
    // Treasury injection increases TVL via LP seeding (30% of treasury)
    const tvlBoost      = treasuryAlloc * 0.3 * 2; // LP doubles via matching
    const addlVolume    = tvlBoost * TOKENOMICS.volumeToTvlRatio;
    const addlFees      = (addlVolume * FEE_CONFIG.defaultBps) / FEE_CONFIG.denominator;
    const annualImpact  = addlFees * 12;

    lines.push(
      `| ${sc.label} | $${fmtNum(sc.raised)} | $${fmtNum(auditAlloc)} (${sc.auditPct}%) ` +
      `| $${fmtNum(treasuryAlloc)} (${sc.treasuryPct}%) ` +
      `| +$${fmtNum(tvlBoost)} TVL | +$${fmtNum(annualImpact)}/yr |`
    );
  }
  lines.push('');
  lines.push('**Effects of BelieverRound funding:**');
  lines.push('');
  lines.push('1. **Audit funding** — CertiK/Quantstamp engagement de-risks protocol, unlocking institutional TVL');
  lines.push('2. **Treasury injection** — Extends operational runway by 6-18 months depending on raise');
  lines.push('3. **LP seeding** — Direct liquidity addition via GET allocation deepens pools, reduces slippage');
  lines.push('4. **Community signal** — Active Believer participation correlates with organic TVL growth (2-5x multiplier on raised capital)');
  lines.push('5. **Vesting alignment** — 3-month cliff + 12-month linear release prevents dump pressure, aligning believer incentives with protocol growth');
  lines.push('');
  lines.push(hr);
  lines.push('');

  // ── Whitepaper Anchor ──────────────────────────────────────────────────
  lines.push('## Whitepaper Anchor Validation');
  lines.push('');
  lines.push('| Metric | Whitepaper | Model |');
  lines.push('|--------|----------:|------:|');
  if (sweep.baseCase) {
    lines.push(`| $5M TVL Monthly Fees | $10,000 | $${fmtNum(sweep.baseCase.monthlyFees)} |`);
    lines.push(`| $5M TVL Annual Revenue | $120,000 | $${fmtNum(sweep.baseCase.annualFees)} |`);
  }
  lines.push(`| Revenue Split | 30/30/25/15 | 30/30/25/15 |`);
  lines.push(`| Fee Range | 0.5-1% | ${FEE_CONFIG.minBps}-${FEE_CONFIG.maxBps} BPS |`);
  lines.push('');

  return lines.join('\n');
}

function fmtNum(n) {
  if (typeof n !== 'number' || isNaN(n)) return '0';
  if (Math.abs(n) >= 1_000_000) return (n / 1_000_000).toFixed(2) + 'M';
  if (Math.abs(n) >= 1_000) return (n / 1_000).toFixed(1) + 'K';
  return n.toFixed(2);
}

// ─── Live Analytics Collector ─────────────────────────────────────────────────

/**
 * Collect live fee analytics from server.js and FeeCollector.wasm.
 */
async function collectLiveAnalytics() {
  const [health, feeCollectorState, feeCollectorReady] = await Promise.all([
    fetchServerHealth(),
    queryFeeCollectorState(),
    queryFeeCollectorReady(),
  ]);

  const result = {
    timestamp: new Date().toISOString(),
    chain: CLI.chain,
    period: CLI.period,
    periodMs: parsePeriodMs(CLI.period),
    server: {
      status: health?.status || 'unreachable',
      uptime_s: health?.uptime_s || 0,
      a2a_messages_total: health?.a2a_messages_total || 0,
      feeConfig: health?.fee_config || null,
      chains: health?.chains || CHAINS,
      messageTypes: health?.message_types || MESSAGE_TYPES,
    },
    feeCollector: feeCollectorState ? {
      accumulatedFees: feeCollectorState.accumulated_fees || '0',
      totalBurned: feeCollectorState.total_burned || '0',
      totalBurnsCount: feeCollectorState.total_burns_count || 0,
      lastBurnTime: feeCollectorState.last_burn_time || 0,
      readyToBurn: feeCollectorReady?.ready || false,
      minimum: feeCollectorReady?.minimum || '0',
    } : {
      status: 'not_configured',
      note: 'Set FEE_COLLECTOR_ADDR and OSMOSIS_LCD_URL to query on-chain state',
    },
    aiListener: health?.ai_listener || null,
    revenueSplit: REVENUE_SPLIT,
    feeConfig: FEE_CONFIG,
    volumeMixTargets: VOLUME_MIX_TARGETS,
  };

  // If we have AI listener metrics, compute fee breakdown
  if (health?.ai_listener) {
    const metrics = health.ai_listener;
    const totalTasksProcessed = metrics.tasksProcessed || 0;
    const totalFeesCollected = metrics.feesCollected || 0;

    result.feeBreakdown = {
      totalTasksProcessed,
      totalFeesCollected,
      split: applySplit(totalFeesCollected),
    };
  }

  return result;
}

// ─── Charts Data for FeeVisualizer ────────────────────────────────────────────

/**
 * Generate chart data compatible with FeeVisualizer frontend component.
 * Output matches Recharts data format used by FeeVisualizer.js.
 */
function generateChartsData(analytics) {
  const simulation = simulateRevenue(CLI.volume, CLI.aiShare);

  return {
    // Revenue split pie chart (matches FeeVisualizer pie)
    revenueSplitPie: Object.entries(REVENUE_SPLIT).map(([key, val]) => ({
      name: val.label,
      value: val.pct,
      color: val.color,
      amount: simulation.totalFees * (val.pct / 100),
    })),

    // Volume mix pie chart
    volumeMixPie: Object.entries(simulation.volumeBreakdown).map(([key, val]) => ({
      name: val.label,
      value: val.share * 100,
      volume: val.volume,
    })),

    // Fee streams bar chart
    feeStreamsBar: Object.entries(simulation.feeStreams).map(([key, stream]) => ({
      name: stream.label,
      fees: stream.fees,
      volume: stream.volume || stream.escrowVolume || 0,
      bps: stream.avgBps || stream.bps,
    })),

    // BPS comparison table (50/60/70/80/90/100 BPS)
    bpsComparisonTable: [50, 60, 70, 80, 90, 100].map(bps => {
      const sampleAmount = 1_000_000;
      const { feeAmount, netAmount } = calculateTaskFee(sampleAmount.toString(), bps);
      const fee = Number(feeAmount);
      return {
        bps,
        pct: `${(bps / 100).toFixed(1)}%`,
        grossAmount: sampleAmount,
        feeAmount: fee,
        netAmount: Number(netAmount),
        bbb: fee * 0.30,
        lp: fee * 0.30,
        vexf: fee * 0.25,
        treasury: fee * 0.15,
      };
    }),

    // Scenario comparison (AI vs A2A vs Bridge)
    scenarioComparison: [
      { name: 'AI Inference (Akash, 0.5%)', gross: 1000000, bps: 50, type: 'ai' },
      { name: 'Compute Bid (TAO, 0.75%)', gross: 1000000, bps: 75, type: 'ai' },
      { name: 'AI Training (1.0%)', gross: 1000000, bps: 100, type: 'ai' },
      { name: 'A2A Relay (0.1%)', gross: 1000000, bps: 10, type: 'a2a' },
      { name: 'Forward Bridge (0.5%)', gross: 1000000, bps: 50, type: 'bridge' },
      { name: 'Reverse Bridge (0.5%)', gross: 1000000, bps: 50, type: 'bridge' },
    ].map(s => {
      const { feeAmount, netAmount } = calculateTaskFee(s.gross.toString(), s.bps);
      return {
        ...s,
        feeAmount: Number(feeAmount),
        netToProvider: Number(netAmount),
        protocolFee: Number(feeAmount),
        split: applySplit(feeAmount),
      };
    }),

    // TVL milestone tracking
    tvlMilestones: [
      { label: 'Phase C (current)', tvl: 0, status: 'complete' },
      { label: 'Phase D unlock', tvl: 5_000_000, status: 'pending' },
      { label: 'Phase E target', tvl: 20_000_000, status: 'pending' },
      { label: 'Phase F target', tvl: 100_000_000, status: 'pending' },
    ],

    // Fee examples from whitepaper
    feeExamples: simulation.examples,

    // Metadata
    meta: {
      generatedAt: new Date().toISOString(),
      period: CLI.period,
      chain: CLI.chain,
      simulatedVolume: CLI.volume,
      aiShare: CLI.aiShare,
      note: 'Data for FeeVisualizer frontend component (Recharts-compatible)',
    },
  };
}

// ─── Output Formatters ────────────────────────────────────────────────────────

/**
 * Pretty-print console output.
 */
function formatConsole(analytics, simulation) {
  const divider = '═'.repeat(72);
  const lines = [];

  lines.push('');
  lines.push(`╔${'═'.repeat(70)}╗`);
  lines.push(`║  XFuel Fee Analytics — Revenue Monitoring (v4.5)${' '.repeat(20)}║`);
  lines.push(`╚${'═'.repeat(70)}╝`);
  lines.push('');
  lines.push(`  Timestamp:  ${analytics.timestamp}`);
  lines.push(`  Chain:      ${CLI.chain}`);
  lines.push(`  Period:     ${CLI.period}`);
  lines.push(`  Server:     ${analytics.server.status}`);
  lines.push('');

  // FeeCollector on-chain state
  lines.push(`┌── FeeCollector.wasm (On-Chain) ${'─'.repeat(40)}`);
  if (analytics.feeCollector.status === 'not_configured') {
    lines.push(`│  Status:  Not configured (set FEE_COLLECTOR_ADDR)`);
  } else {
    lines.push(`│  Accumulated Fees:  ${analytics.feeCollector.accumulatedFees}`);
    lines.push(`│  Total Burned:      ${analytics.feeCollector.totalBurned}`);
    lines.push(`│  Burn Count:        ${analytics.feeCollector.totalBurnsCount}`);
    lines.push(`│  Ready to Burn:     ${analytics.feeCollector.readyToBurn ? 'YES' : 'No'}`);
  }
  lines.push('│');

  // AI Listener metrics
  lines.push(`├── AI Listener Metrics ${'─'.repeat(48)}`);
  if (analytics.aiListener) {
    lines.push(`│  Tasks Processed:  ${analytics.aiListener.tasksProcessed || 0}`);
    lines.push(`│  Fees Collected:   ${analytics.aiListener.feesCollected || 0}`);
    lines.push(`│  Active Tasks:     ${analytics.aiListener.activeTasks || 0}`);
  } else {
    lines.push(`│  Status:  AI Listener not active (start with AI_LISTENER_ENABLED=true)`);
  }
  lines.push('│');

  // Simulation results
  if (simulation) {
    lines.push(`├── Revenue Simulation ${'─'.repeat(49)}`);
    lines.push(`│  Monthly Volume:   $${simulation.monthlyVolume.toLocaleString()}`);
    lines.push('│');
    lines.push('│  Volume Mix:');
    for (const [key, val] of Object.entries(simulation.volumeBreakdown)) {
      const bar = '█'.repeat(Math.round(val.share * 30));
      lines.push(`│    ${bar} ${(val.share * 100).toFixed(0)}% ${val.label} ($${val.volume.toLocaleString()})`);
    }
    lines.push('│');
    lines.push('│  Fee Streams:');
    for (const [key, stream] of Object.entries(simulation.feeStreams)) {
      lines.push(`│    ${stream.label}: $${stream.fees.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`);
      if (stream.example) lines.push(`│      └─ ${stream.example}`);
    }
    lines.push('│');
    lines.push(`│  TOTAL FEES:  $${simulation.totalFees.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}/month`);
    lines.push('│');
    lines.push('│  30/30/25/15 Revenue Split:');
    for (const [key, bucket] of Object.entries(simulation.revenueSplit)) {
      const label = REVENUE_SPLIT[key].label;
      lines.push(`│    ${bucket.pct}% ${label}: $${bucket.amount.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`);
    }
    lines.push('│');
    lines.push(`│  Burns:  $${simulation.burns.monthlyBBB.toLocaleString(undefined, { minimumFractionDigits: 2 })}/month → $${simulation.burns.yearlyBBB.toLocaleString(undefined, { minimumFractionDigits: 2 })}/year`);
    lines.push('│');

    // Worked examples
    lines.push(`├── Fee Examples (AI-Driven) ${'─'.repeat(44)}`);
    for (const ex of simulation.examples) {
      lines.push(`│  ${ex.scenario}`);
      if (ex.splitBreakdown) {
        lines.push(`│    Fee: ${ex.splitBreakdown.fee || ex.splitBreakdown.relayFee}`);
        lines.push(`│    ├── BBB:      ${ex.splitBreakdown.bbb}`);
        lines.push(`│    ├── LP:       ${ex.splitBreakdown.lp}`);
        lines.push(`│    ├── veXF:     ${ex.splitBreakdown.vexf}`);
        lines.push(`│    └── Treasury: ${ex.splitBreakdown.treasury}`);
      }
      lines.push('│');
    }

    // TVL tracking
    lines.push(`├── TVL Milestone Tracking ${'─'.repeat(46)}`);
    lines.push(`│  Estimated TVL:  $${simulation.tvlTracking.currentEstimate.toLocaleString()}`);
    lines.push(`│  $5M Unlock:     ${simulation.tvlTracking.unlocked ? '✅ UNLOCKED' : '⏳ Pending'}`);
    lines.push('│');
  }

  lines.push(`└${'─'.repeat(71)}`);
  lines.push('');

  return lines.join('\n');
}

/**
 * Format Prometheus-compatible metrics output.
 */
function formatPrometheus(analytics, simulation) {
  const lines = [];
  const ts = Date.now();

  lines.push('# HELP xfuel_server_up Whether the M2M API server is reachable');
  lines.push('# TYPE xfuel_server_up gauge');
  lines.push(`xfuel_server_up ${analytics.server.status === 'ok' ? 1 : 0}`);
  lines.push('');

  lines.push('# HELP xfuel_server_uptime_seconds Server uptime in seconds');
  lines.push('# TYPE xfuel_server_uptime_seconds gauge');
  lines.push(`xfuel_server_uptime_seconds ${analytics.server.uptime_s}`);
  lines.push('');

  lines.push('# HELP xfuel_a2a_messages_total Total A2A messages processed');
  lines.push('# TYPE xfuel_a2a_messages_total counter');
  lines.push(`xfuel_a2a_messages_total ${analytics.server.a2a_messages_total}`);
  lines.push('');

  // FeeCollector metrics
  if (analytics.feeCollector.status !== 'not_configured') {
    lines.push('# HELP xfuel_fee_collector_accumulated Accumulated fees in FeeCollector.wasm');
    lines.push('# TYPE xfuel_fee_collector_accumulated gauge');
    lines.push(`xfuel_fee_collector_accumulated ${analytics.feeCollector.accumulatedFees}`);
    lines.push('');

    lines.push('# HELP xfuel_fee_collector_total_burned Total fees burned from FeeCollector.wasm');
    lines.push('# TYPE xfuel_fee_collector_total_burned counter');
    lines.push(`xfuel_fee_collector_total_burned ${analytics.feeCollector.totalBurned}`);
    lines.push('');

    lines.push('# HELP xfuel_fee_collector_burns_count Total burn operations');
    lines.push('# TYPE xfuel_fee_collector_burns_count counter');
    lines.push(`xfuel_fee_collector_burns_count ${analytics.feeCollector.totalBurnsCount}`);
    lines.push('');

    lines.push('# HELP xfuel_fee_collector_ready_to_burn Whether fees meet burn threshold');
    lines.push('# TYPE xfuel_fee_collector_ready_to_burn gauge');
    lines.push(`xfuel_fee_collector_ready_to_burn ${analytics.feeCollector.readyToBurn ? 1 : 0}`);
    lines.push('');
  }

  // AI Listener metrics
  if (analytics.aiListener) {
    lines.push('# HELP xfuel_ai_tasks_processed Total AI tasks processed');
    lines.push('# TYPE xfuel_ai_tasks_processed counter');
    lines.push(`xfuel_ai_tasks_processed ${analytics.aiListener.tasksProcessed || 0}`);
    lines.push('');

    lines.push('# HELP xfuel_ai_fees_collected Total AI task fees collected');
    lines.push('# TYPE xfuel_ai_fees_collected counter');
    lines.push(`xfuel_ai_fees_collected ${analytics.aiListener.feesCollected || 0}`);
    lines.push('');
  }

  // Simulation metrics (always available)
  if (simulation) {
    lines.push('# HELP xfuel_sim_monthly_volume Simulated monthly volume');
    lines.push('# TYPE xfuel_sim_monthly_volume gauge');
    lines.push(`xfuel_sim_monthly_volume ${simulation.monthlyVolume}`);
    lines.push('');

    lines.push('# HELP xfuel_sim_total_fees Simulated total monthly fees');
    lines.push('# TYPE xfuel_sim_total_fees gauge');
    lines.push(`xfuel_sim_total_fees ${simulation.totalFees.toFixed(2)}`);
    lines.push('');

    for (const [key, bucket] of Object.entries(simulation.revenueSplit)) {
      lines.push(`# HELP xfuel_sim_split_${key} Simulated ${key} revenue amount`);
      lines.push(`# TYPE xfuel_sim_split_${key} gauge`);
      lines.push(`xfuel_sim_split_${key} ${bucket.amount.toFixed(2)}`);
      lines.push('');
    }

    // Volume mix
    for (const [key, val] of Object.entries(simulation.volumeBreakdown)) {
      const metricKey = key.replace(/([A-Z])/g, '_$1').toLowerCase();
      lines.push(`# HELP xfuel_sim_volume_${metricKey} Simulated ${key} volume`);
      lines.push(`# TYPE xfuel_sim_volume_${metricKey} gauge`);
      lines.push(`xfuel_sim_volume_${metricKey} ${val.volume.toFixed(2)}`);
      lines.push('');
    }

    // Fee streams
    for (const [key, stream] of Object.entries(simulation.feeStreams)) {
      const metricKey = key.replace(/([A-Z])/g, '_$1').toLowerCase();
      lines.push(`# HELP xfuel_sim_fees_${metricKey} Simulated ${key} fees`);
      lines.push(`# TYPE xfuel_sim_fees_${metricKey} gauge`);
      lines.push(`xfuel_sim_fees_${metricKey} ${stream.fees.toFixed(2)}`);
      lines.push('');
    }

    lines.push('# HELP xfuel_sim_monthly_burns Simulated monthly XF burns (BBB 30%)');
    lines.push('# TYPE xfuel_sim_monthly_burns gauge');
    lines.push(`xfuel_sim_monthly_burns ${simulation.burns.monthlyBBB.toFixed(2)}`);
    lines.push('');

    lines.push('# HELP xfuel_tvl_estimate Estimated TVL');
    lines.push('# TYPE xfuel_tvl_estimate gauge');
    lines.push(`xfuel_tvl_estimate ${simulation.tvlTracking.currentEstimate}`);
    lines.push('');

    lines.push('# HELP xfuel_tvl_unlock_threshold TVL unlock threshold ($5M Phase D)');
    lines.push('# TYPE xfuel_tvl_unlock_threshold gauge');
    lines.push(`xfuel_tvl_unlock_threshold ${simulation.tvlTracking.unlockThreshold}`);
    lines.push('');
  }

  // Fee config
  lines.push('# HELP xfuel_fee_default_bps Default task fee in basis points');
  lines.push('# TYPE xfuel_fee_default_bps gauge');
  lines.push(`xfuel_fee_default_bps ${FEE_CONFIG.defaultBps}`);
  lines.push('');

  lines.push('# HELP xfuel_fee_a2a_relay_bps A2A relay fee in basis points');
  lines.push('# TYPE xfuel_fee_a2a_relay_bps gauge');
  lines.push(`xfuel_fee_a2a_relay_bps ${FEE_CONFIG.a2aRelayBps}`);
  lines.push('');

  return lines.join('\n');
}

// ─── Prometheus HTTP Server ───────────────────────────────────────────────────

async function startPrometheusServer(port) {
  const server = http.createServer(async (req, res) => {
    if (req.url === '/metrics' || req.url === '/') {
      try {
        const analytics = await collectLiveAnalytics();
        const simulation = simulateRevenue(CLI.volume, CLI.aiShare);
        const body = formatPrometheus(analytics, simulation);
        res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
        res.end(body);
      } catch (err) {
        res.writeHead(500, { 'Content-Type': 'text/plain' });
        res.end(`# Error collecting metrics: ${err.message}\n`);
      }
    } else {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('Not found. Use /metrics\n');
    }
  });

  server.listen(port, () => {
    console.log(`[fee-analytics] Prometheus metrics server listening on :${port}/metrics`);
  });

  return server;
}

// ─── File Output ──────────────────────────────────────────────────────────────

import { writeFile } from 'fs/promises';

async function writeOutput(data) {
  if (!CLI.output) return;
  const content = typeof data === 'string' ? data : JSON.stringify(data, null, 2);
  await writeFile(CLI.output, content, 'utf-8');
  console.log(`[fee-analytics] Output written to ${CLI.output}`);
}

// ─── Main Entry Point ─────────────────────────────────────────────────────────

async function main() {
  // Collect live analytics
  const analytics = await collectLiveAnalytics();

  // Always run simulation (for console display and as fallback)
  const simulation = simulateRevenue(CLI.volume, CLI.aiShare);

  // ── Sensitivity mode ─────────────────────────────────────────────────────
  if (CLI.simulateSensitivity) {
    const md = formatSensitivityMarkdown();
    if (CLI.output) {
      await writeOutput(md);
    } else {
      console.log(md);
    }
    return;
  }

  // ── Charts mode ──────────────────────────────────────────────────────────
  if (CLI.charts) {
    const chartsData = generateChartsData(analytics);
    if (CLI.output) {
      await writeOutput(chartsData);
    } else {
      console.log(JSON.stringify(chartsData, null, 2));
    }
    return;
  }

  // ── Prometheus server mode ───────────────────────────────────────────────
  if (CLI.format === 'prometheus' && CLI.watch) {
    await startPrometheusServer(CLI.port);
    console.log(`[fee-analytics] Watching with ${CLI.interval}s interval. Press Ctrl+C to stop.`);
    // Keep alive — the HTTP server handles metrics requests
    return;
  }

  // ── Format output ────────────────────────────────────────────────────────
  let output;

  switch (CLI.format) {
    case 'json':
      output = JSON.stringify({
        analytics,
        simulation: CLI.simulate ? simulation : undefined,
        chartsData: CLI.charts ? generateChartsData(analytics) : undefined,
      }, null, 2);
      break;

    case 'prometheus':
      output = formatPrometheus(analytics, simulation);
      break;

    case 'console':
    default:
      output = formatConsole(analytics, simulation);
      break;
  }

  // ── Write or print ───────────────────────────────────────────────────────
  if (CLI.output) {
    await writeOutput(output);
  } else {
    console.log(output);
  }

  // ── Watch mode ───────────────────────────────────────────────────────────
  if (CLI.watch) {
    console.log(`[fee-analytics] Watching with ${CLI.interval}s interval. Press Ctrl+C to stop.`);
    setInterval(async () => {
      try {
        const freshAnalytics = await collectLiveAnalytics();
        const freshSimulation = simulateRevenue(CLI.volume, CLI.aiShare);
        const freshOutput = CLI.format === 'json'
          ? JSON.stringify({ analytics: freshAnalytics, simulation: freshSimulation }, null, 2)
          : formatConsole(freshAnalytics, freshSimulation);
        if (CLI.output) {
          await writeOutput(freshOutput);
        } else {
          console.clear();
          console.log(freshOutput);
        }
      } catch (err) {
        console.error(`[fee-analytics] Watch cycle error: ${err.message}`);
      }
    }, CLI.interval * 1000);
  }
}

main().catch(err => {
  console.error(`[fee-analytics] Fatal error: ${err.message}`);
  process.exit(1);
});

export {
  calculateTaskFee, calculateRelayFee, applySplit, simulateRevenue,
  generateChartsData, sensitivitySweep, dilutionModel, formatSensitivityMarkdown,
  TOKENOMICS, FEE_CONFIG, REVENUE_SPLIT,
};
