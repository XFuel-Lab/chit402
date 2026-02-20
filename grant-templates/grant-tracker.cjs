/**
 * XFuel Protocol — Grant Submission Tracker
 *
 * Tracks grant application status across multiple programs.
 * Outputs a status table, calculates next actions, and generates
 * submission reports.
 *
 * Usage:
 *   node grant-templates/grant-tracker.cjs              # Show status table
 *   node grant-templates/grant-tracker.cjs --report     # Generate full report
 *
 * Grant programs tracked:
 *   1. Solana Foundation Grants (SolanaAIBridge circuit)
 *   2. OpenTensor Foundation (TAOCircuit)
 *   3. General ecosystem (customizable)
 */

const fs = require('fs');
const path = require('path');

const GRANTS = [
  {
    id: 'solana-foundation',
    program: 'Solana Foundation Grants / Superteam',
    template: 'grant-templates/solana-grant.md',
    circuit: 'SolanaAIBridge',
    amount: '$150,000–$250,000',
    duration: '6 months',
    status: 'SUBMIT-READY',
    submissionUrl: 'https://solana.org/grants',
    contacts: ['grants@solana.org', 'superteam@solana.org'],
    milestones: [
      { id: 'M1', name: 'Solana Program (Anchor)', timeline: 'Month 1-2', budget: '$40K', status: 'not_started' },
      { id: 'M2', name: 'Wormhole Integration', timeline: 'Month 2-3', budget: '$30K', status: 'not_started' },
      { id: 'M3', name: 'Provider SDK', timeline: 'Month 3-4', budget: '$25K', status: 'not_started' },
      { id: 'M4', name: 'SP1 Circuit', timeline: 'Month 4-5', budget: '$30K', status: 'not_started' },
      { id: 'M5', name: 'Testnet Launch', timeline: 'Month 5-6', budget: '$15K', status: 'not_started' },
      { id: 'M6', name: 'Security Audit', timeline: 'Month 6', budget: '$25K', status: 'not_started' },
    ],
    traction: {
      tests: 315,
      contracts: 20,
      settleGas: '~327K',
      mainnet: 'Theta (361)',
      newCircuits: 'FilecoinStorage + EnergyGrid + MappingSensor + WirelessDePIN + UplinkCircuit',
      activationScript: 'activation/mainnet-activation.cjs (20 contracts, 19/19 smoke tests)',
      synergy: 'DePIN 3-layer stack (WirelessDePIN + MappingSensor + Uplink) with cross-circuit incentives',
    },
    nextActions: [
      'Submit application via Solana Foundation portal',
      'Attach whitepaper + exec-summary links',
      'Schedule intro call with Superteam regional lead',
      'Prepare demo video: SolanaAIBridge testnet flow',
      'Run: node grant/submission-script.cjs --program solana',
    ],
  },
  {
    id: 'opentensor',
    program: 'OpenTensor Foundation Grants',
    template: 'grant-templates/tao-grant.md',
    circuit: 'TAOCircuit',
    amount: '$150,000–$200,000',
    duration: '6 months',
    status: 'SUBMIT-READY',
    submissionUrl: 'https://opentensor.ai/grants',
    contacts: ['grants@opentensor.ai'],
    milestones: [
      { id: 'M1', name: 'TAO EVM Deployment', timeline: 'Month 1-2', budget: '$30K', status: 'not_started' },
      { id: 'M2', name: 'Subnet Adapter (3 subnets)', timeline: 'Month 2-3', budget: '$25K', status: 'not_started' },
      { id: 'M3', name: 'SP1 Inference Proof', timeline: 'Month 3-4', budget: '$30K', status: 'not_started' },
      { id: 'M4', name: 'AMM Oracle', timeline: 'Month 4', budget: '$15K', status: 'not_started' },
      { id: 'M5', name: 'Cross-Chain Bridge', timeline: 'Month 4-5', budget: '$20K', status: 'not_started' },
      { id: 'M6', name: 'Testnet + Audit', timeline: 'Month 5-6', budget: '$30K', status: 'not_started' },
    ],
    traction: {
      tests: 315,
      contracts: 20,
      settleGas: '~68K',
      mainnet: 'Theta (361)',
      newCircuits: 'FilecoinStorage + EnergyGrid + MappingSensor + WirelessDePIN + UplinkCircuit',
      activationScript: 'activation/mainnet-activation.cjs (20 contracts, 19/19 smoke tests)',
      synergy: 'DePIN 3-layer stack with cross-circuit incentives and veXF governance',
    },
    nextActions: [
      'Submit via OpenTensor grants portal',
      'Attach TAO circuit gas benchmarks (68K settle)',
      'Request subnet access for SN1, SN5, SN8 testing',
      'Join Bittensor Discord and introduce project',
      'Run: node grant/submission-script.cjs --program tao',
    ],
  },
  {
    id: 'general-ecosystem',
    program: '[Ecosystem] Grants Program',
    template: 'grant-templates/general-grant.md',
    circuit: 'Customizable',
    amount: '$50,000–$300,000',
    duration: '3–9 months',
    status: 'SUBMIT-READY',
    submissionUrl: '[ecosystem-specific URL]',
    contacts: ['partnerships@xfuel.app'],
    milestones: [
      { id: 'M1', name: 'Circuit Contract', timeline: 'Month 1-2', budget: 'Variable', status: 'not_started' },
      { id: 'M2', name: 'Off-chain Handler', timeline: 'Month 2-3', budget: 'Variable', status: 'not_started' },
      { id: 'M3', name: 'ZK Circuit', timeline: 'Month 3-4', budget: 'Variable', status: 'not_started' },
      { id: 'M4', name: 'Integration', timeline: 'Month 4-5', budget: 'Variable', status: 'not_started' },
      { id: 'M5', name: 'Testing', timeline: 'Month 5', budget: 'Variable', status: 'not_started' },
      { id: 'M6', name: 'Deploy + Audit', timeline: 'Month 5-6', budget: 'Variable', status: 'not_started' },
    ],
    traction: {
      tests: 315,
      contracts: 20,
      settleGas: '<100K (most circuits)',
      mainnet: 'Theta (361)',
      newCircuits: 'FilecoinStorage + EnergyGrid + MappingSensor + WirelessDePIN + UplinkCircuit',
      activationScript: 'activation/mainnet-activation.cjs (20 contracts, 19/19 smoke tests)',
      synergy: 'DePIN 3-layer stack + governance proposals + community expansion tools',
    },
    nextActions: [
      'Customize template for target ecosystem',
      'Fill in budget amounts per milestone',
      'Add ecosystem-specific problem statement',
      'Attach deployment manifest as evidence',
      'Run: node grant/submission-script.cjs --program general',
    ],
  },
];

function printStatusTable() {
  console.log('╔══════════════════════════════════════════════════════════════╗');
  console.log('║  XFuel Protocol — Grant Submission Tracker                  ║');
  console.log('╚══════════════════════════════════════════════════════════════╝\n');

  for (const g of GRANTS) {
    const icon = g.status === 'SUBMIT-READY' ? '✓' : g.status === 'SUBMITTED' ? '→' : '○';
    console.log(`  ${icon} ${g.program}`);
    console.log(`    Circuit:     ${g.circuit}`);
    console.log(`    Amount:      ${g.amount}`);
    console.log(`    Template:    ${g.template}`);
    console.log(`    Status:      ${g.status}`);
    console.log(`    Submit URL:  ${g.submissionUrl}`);
    console.log(`    Traction:    ${g.traction.tests} tests, ${g.traction.contracts} contracts, settle gas: ${g.traction.settleGas}`);
    console.log(`    Next actions:`);
    for (const a of g.nextActions) {
      console.log(`      □ ${a}`);
    }
    console.log();
  }

  // Summary
  const ready = GRANTS.filter(g => g.status === 'SUBMIT-READY').length;
  const submitted = GRANTS.filter(g => g.status === 'SUBMITTED').length;
  console.log(`  Summary: ${ready} ready, ${submitted} submitted, ${GRANTS.length} total`);
  console.log(`  Total potential funding: $350K–$750K\n`);
}

function generateReport() {
  const report = {
    generated: new Date().toISOString(),
    grants: GRANTS.map(g => ({
      id: g.id,
      program: g.program,
      circuit: g.circuit,
      amount: g.amount,
      status: g.status,
      milestones: g.milestones,
      traction: g.traction,
      nextActions: g.nextActions,
    })),
    summary: {
      total: GRANTS.length,
      ready: GRANTS.filter(g => g.status === 'SUBMIT-READY').length,
      submitted: GRANTS.filter(g => g.status === 'SUBMITTED').length,
    },
  };

  const reportFile = path.join(__dirname, `grant-status-${Date.now()}.json`);
  fs.writeFileSync(reportFile, JSON.stringify(report, null, 2));
  console.log(`\n  Report saved: ${reportFile}`);
  return report;
}

// Main
printStatusTable();
if (process.argv.includes('--report')) {
  generateReport();
}
