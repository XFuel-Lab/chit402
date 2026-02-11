#!/usr/bin/env node

/**
 * @title Governance Vote Simulation — veXF Quorum & Threshold
 * @notice Simulates Osmosis governance votes for AIVerifier deployment proposals.
 *
 * Features:
 *   - veXF voting power distribution simulation
 *   - Quorum validation (default 20%)
 *   - Threshold validation (default 67% Yes)
 *   - Veto threshold (default 33.4% NoWithVeto)
 *   - Multiple scenario simulation (pass, fail, veto, quorum miss)
 *   - Turnout projections at various participation rates
 *
 * Usage:
 *   node governance-mocks/governance-vote-sim.js
 *   node governance-mocks/governance-vote-sim.js --quorum 20 --threshold 67
 *   node governance-mocks/governance-vote-sim.js --scenario all
 *
 * Reference: Whitepaper v5.1 Section 11.3
 */

// ─── CLI Args ─────────────────────────────────────────────────────────────────

const args = process.argv.slice(2);
function getArg(name, defaultVal) {
  const idx = args.indexOf(`--${name}`);
  if (idx === -1 || idx + 1 >= args.length) return defaultVal;
  return args[idx + 1];
}

const QUORUM_PCT = parseFloat(getArg('quorum', '20'));
const THRESHOLD_PCT = parseFloat(getArg('threshold', '67'));
const VETO_THRESHOLD_PCT = parseFloat(getArg('veto-threshold', '33.4'));
const SCENARIO = getArg('scenario', 'all');

// ─── Governance Constants ─────────────────────────────────────────────────────

const GOV_CONFIG = {
  totalVeXFSupply: 10_000_000,        // 10M veXF total (locked XF)
  votingPeriodDays: 5,
  depositOsmo: 500,
  quorumPct: QUORUM_PCT,
  thresholdPct: THRESHOLD_PCT,
  vetoThresholdPct: VETO_THRESHOLD_PCT,
};

/**
 * Voter distribution model (Phase D steady-state)
 * Mirrors veXF lock distribution from whitepaper
 */
const VOTER_DISTRIBUTION = {
  whales:      { count: 15,   avgPower: 200_000, label: '>100K veXF' },
  midTier:     { count: 120,  avgPower: 20_000,  label: '10K-100K veXF' },
  retail:      { count: 2000, avgPower: 1_000,   label: '1K-10K veXF' },
  microHolders: { count: 5000, avgPower: 100,     label: '<1K veXF' },
};

// ─── Vote Simulation ──────────────────────────────────────────────────────────

/**
 * Simulate a governance vote with given participation and vote distribution.
 *
 * @param {Object} params
 * @param {number} params.participationPct   % of veXF that votes (0-100)
 * @param {number} params.yesPct             % of participating votes that are Yes
 * @param {number} params.noPct              % that are No
 * @param {number} params.noWithVetoPct      % that are NoWithVeto
 * @param {number} params.abstainPct         % that are Abstain
 * @returns {Object} Vote result
 */
function simulateVote({ participationPct, yesPct, noPct, noWithVetoPct, abstainPct }) {
  const totalSupply = GOV_CONFIG.totalVeXFSupply;
  const participatingPower = totalSupply * (participationPct / 100);

  const yesVotes = participatingPower * (yesPct / 100);
  const noVotes = participatingPower * (noPct / 100);
  const noWithVetoVotes = participatingPower * (noWithVetoPct / 100);
  const abstainVotes = participatingPower * (abstainPct / 100);

  // Quorum check: participating power >= quorum % of total supply
  const quorumMet = participationPct >= GOV_CONFIG.quorumPct;

  // Threshold check: Yes / (Yes + No + NoWithVeto) >= threshold
  const activeVotes = yesVotes + noVotes + noWithVetoVotes;
  const yesRatio = activeVotes > 0 ? (yesVotes / activeVotes) * 100 : 0;
  const thresholdMet = yesRatio >= GOV_CONFIG.thresholdPct;

  // Veto check: NoWithVeto / (Yes + No + NoWithVeto) < veto threshold
  const vetoRatio = activeVotes > 0 ? (noWithVetoVotes / activeVotes) * 100 : 0;
  const vetoed = vetoRatio >= GOV_CONFIG.vetoThresholdPct;

  // Final outcome
  let outcome;
  if (!quorumMet) outcome = 'REJECTED (quorum not met)';
  else if (vetoed) outcome = 'VETOED (NoWithVeto threshold exceeded)';
  else if (thresholdMet) outcome = 'PASSED';
  else outcome = 'REJECTED (threshold not met)';

  return {
    participationPct,
    participatingPower: Math.round(participatingPower),
    votes: {
      yes: Math.round(yesVotes),
      no: Math.round(noVotes),
      noWithVeto: Math.round(noWithVetoVotes),
      abstain: Math.round(abstainVotes),
    },
    ratios: {
      yesRatio: yesRatio.toFixed(1),
      vetoRatio: vetoRatio.toFixed(1),
    },
    quorumMet,
    thresholdMet,
    vetoed,
    outcome,
  };
}

// ─── Scenarios ────────────────────────────────────────────────────────────────

const SCENARIOS = {
  pass_strong: {
    label: 'Strong Pass (high participation, overwhelming Yes)',
    params: { participationPct: 45, yesPct: 85, noPct: 10, noWithVetoPct: 2, abstainPct: 3 },
  },
  pass_narrow: {
    label: 'Narrow Pass (moderate participation, close vote)',
    params: { participationPct: 25, yesPct: 70, noPct: 20, noWithVetoPct: 5, abstainPct: 5 },
  },
  fail_threshold: {
    label: 'Fail: Threshold Not Met (too much opposition)',
    params: { participationPct: 30, yesPct: 55, noPct: 35, noWithVetoPct: 5, abstainPct: 5 },
  },
  fail_quorum: {
    label: 'Fail: Quorum Not Met (low participation)',
    params: { participationPct: 15, yesPct: 80, noPct: 10, noWithVetoPct: 5, abstainPct: 5 },
  },
  vetoed: {
    label: 'Vetoed: NoWithVeto Exceeds 33.4%',
    params: { participationPct: 35, yesPct: 40, noPct: 20, noWithVetoPct: 35, abstainPct: 5 },
  },
  whale_dominated: {
    label: 'Whale-Dominated Pass (few large voters)',
    params: { participationPct: 22, yesPct: 90, noPct: 5, noWithVetoPct: 2, abstainPct: 3 },
  },
  bear_market_turnout: {
    label: 'Bear Market (low turnout, AI revenue focus)',
    params: { participationPct: 18, yesPct: 75, noPct: 15, noWithVetoPct: 5, abstainPct: 5 },
  },
};

// ─── Output ───────────────────────────────────────────────────────────────────

function formatResult(name, scenario, result) {
  const lines = [];
  lines.push(`  ┌── ${scenario.label}`);
  lines.push(`  │  Participation:  ${result.participationPct}% (${result.participatingPower.toLocaleString()} veXF)`);
  lines.push(`  │  Yes:            ${result.votes.yes.toLocaleString()} (${result.ratios.yesRatio}%)`);
  lines.push(`  │  No:             ${result.votes.no.toLocaleString()}`);
  lines.push(`  │  NoWithVeto:     ${result.votes.noWithVeto.toLocaleString()} (${result.ratios.vetoRatio}%)`);
  lines.push(`  │  Abstain:        ${result.votes.abstain.toLocaleString()}`);
  lines.push(`  │  Quorum Met:     ${result.quorumMet ? '✅' : '❌'} (need ${GOV_CONFIG.quorumPct}%)`);
  lines.push(`  │  Threshold Met:  ${result.thresholdMet ? '✅' : '❌'} (need ${GOV_CONFIG.thresholdPct}%)`);
  lines.push(`  │  Vetoed:         ${result.vetoed ? '⚠️ YES' : '✅ No'}`);
  lines.push(`  │  Outcome:        ${result.outcome}`);
  lines.push('  └──');
  return lines.join('\n');
}

// ─── Main ─────────────────────────────────────────────────────────────────────

function main() {
  console.log('');
  console.log('╔══════════════════════════════════════════════════════════════════╗');
  console.log('║  XFuel Governance Vote Simulation — veXF Quorum & Threshold    ║');
  console.log('╚══════════════════════════════════════════════════════════════════╝');
  console.log('');
  console.log(`  Total veXF Supply:    ${GOV_CONFIG.totalVeXFSupply.toLocaleString()}`);
  console.log(`  Quorum Required:      ${GOV_CONFIG.quorumPct}%`);
  console.log(`  Pass Threshold:       ${GOV_CONFIG.thresholdPct}%`);
  console.log(`  Veto Threshold:       ${GOV_CONFIG.vetoThresholdPct}%`);
  console.log(`  Voting Period:        ${GOV_CONFIG.votingPeriodDays} days`);
  console.log('');

  // Voter distribution
  console.log('  Voter Distribution (Phase D steady-state):');
  for (const [, tier] of Object.entries(VOTER_DISTRIBUTION)) {
    const totalPower = tier.count * tier.avgPower;
    const pct = ((totalPower / GOV_CONFIG.totalVeXFSupply) * 100).toFixed(1);
    console.log(`    ${tier.label}: ${tier.count} voters × ${tier.avgPower.toLocaleString()} avg = ${totalPower.toLocaleString()} (${pct}%)`);
  }
  console.log('');

  // Run scenarios
  const scenariosToRun = SCENARIO === 'all'
    ? Object.entries(SCENARIOS)
    : [[SCENARIO, SCENARIOS[SCENARIO]]].filter(([, v]) => v);

  if (scenariosToRun.length === 0) {
    console.error(`  Unknown scenario: ${SCENARIO}`);
    console.error(`  Available: ${Object.keys(SCENARIOS).join(', ')}`);
    process.exit(1);
  }

  console.log('  ═══ Vote Scenarios ═══');
  console.log('');

  for (const [name, scenario] of scenariosToRun) {
    const result = simulateVote(scenario.params);
    console.log(formatResult(name, scenario, result));
    console.log('');
  }

  // Summary
  const allResults = Object.entries(SCENARIOS).map(([name, s]) => ({
    name,
    label: s.label,
    ...simulateVote(s.params),
  }));

  const passed = allResults.filter(r => r.outcome === 'PASSED').length;
  const failed = allResults.length - passed;

  console.log('  ═══ Summary ═══');
  console.log(`  Total scenarios: ${allResults.length}`);
  console.log(`  Passed: ${passed}`);
  console.log(`  Failed/Vetoed: ${failed}`);
  console.log('');
}

main();

export { simulateVote, GOV_CONFIG, SCENARIOS, VOTER_DISTRIBUTION };
