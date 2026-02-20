/**
 * XFuel Protocol -- X AMA and Discord Events Script
 *
 * Generates ready-to-post content for X/Twitter AMA sessions and
 * Discord community events. Tracks event scheduling and generates
 * pre/during/post content packages.
 *
 * Usage:
 *   node community/ama-script.cjs --generate ama
 *   node community/ama-script.cjs --generate launch
 *   node community/ama-script.cjs --schedule
 *   node community/ama-script.cjs --stats
 */

var STATS = {
  circuits: 16, contracts: 20, tests: '315+',
  settleGas: '<100K (most)', mainnet: 'Theta (361)',
  grants: '$350K-$750K', believers: 'Round OPEN',
  latest: 'UplinkCircuit (WiFi bandwidth sharing)',
  wireless: 'WirelessDePIN + UplinkCircuit = full connectivity DePIN',
  synergy: 'WirelessDePIN + MappingSensor + Uplink = cross-circuit DePIN stack',
  governance: 'First veXF proposal: XFP-001 Circuit Allocation Vote',
};

var EVENTS = [
  { type: 'X AMA', title: 'XFuel Protocol: ZK-Verified AI Pumping Station',
    date: 'TBD', duration: '60 min', platform: 'X Spaces',
    topics: ['What is XFuel Protocol?', 'ZK proofs with SP1', '16-circuit architecture',
             'Cross-circuit DePIN synergy model', 'Believer Round', 'Grant pipeline', 'Roadmap'] },
  { type: 'Discord', title: 'DePIN Synergy Deep Dive: Wireless + Mapping + Uplink',
    date: 'TBD', duration: '45 min', platform: 'Discord Stage',
    topics: ['3-layer DePIN stack: coverage + mapping + WiFi', 'Cross-circuit incentive model',
             'Synergy scoring and tier multipliers', 'Regional coverage matrix demo',
             'Live synergy-script.cjs walkthrough'] },
  { type: 'X AMA', title: 'XFuel Governance: veXF and Community Proposals',
    date: 'TBD', duration: '45 min', platform: 'X Spaces',
    topics: ['veXF governance (lock, vote, propose)', 'XFP-001: Circuit Allocation Vote',
             'Synergy-weighted fee structure', 'Community role in protocol'] },
  { type: 'Discord', title: 'Community Workshop: Setting Up DePIN Devices',
    date: 'TBD', duration: '60 min', platform: 'Discord Stage',
    topics: ['Register a LoRaWAN/5G hotspot (WirelessDePIN)', 'Share your WiFi router (UplinkCircuit)',
             'Connect a dashcam/sensor (MappingSensor)', 'Earning across all 3 circuits'] },
];

function generateAMA() {
  console.log('\n  ========================================');
  console.log('  X AMA Content Package');
  console.log('  ========================================\n');

  console.log('  --- PRE-AMA THREAD (24h before) ---\n');
  console.log('  Tweet 1:');
  console.log('  Join us for the first @XFuelProtocol X AMA!');
  console.log('  Topic: ZK-Verified AI Pumping Station');
  console.log('  When: [DATE] [TIME] UTC');
  console.log('  Where: X Spaces');
  console.log('  We will cover: 16 circuits, SP1 ZK, Believer Round');
  console.log('  Set your reminder!\n');

  console.log('  Tweet 2:');
  console.log('  Quick stats: ' + STATS.contracts + ' contracts, ' + STATS.tests + ' tests');
  console.log('  ' + STATS.circuits + ' modular circuits, settle gas ' + STATS.settleGas);
  console.log('  Grant pipeline: ' + STATS.grants + '\n');

  console.log('  Tweet 3:');
  console.log('  DePIN Synergy Stack:');
  console.log('  WirelessDePIN: LoRaWAN/5G coverage proofs (Helium-style)');
  console.log('  MappingSensor: Geospatial data marketplace (Hivemapper-style)');
  console.log('  UplinkCircuit: WiFi bandwidth sharing (Uplink-style)');
  console.log('  3 circuits, 1 unified coverage map. Cross-circuit incentive bonuses.\n');

  console.log('  --- DURING AMA (Talking Points) ---\n');
  var points = [
    'Opening: XFuel is an ecosystem-agnostic AI pumping station connecting compute, data, storage, energy, and wireless.',
    'Architecture: Every circuit is fully isolated. Like USB ports for AI ecosystems.',
    'ZK Layer: SP1 zkVM generates RISC-V proofs. On-chain verify in ~270K gas with Groth16.',
    'DePIN Stack: compute (Akash), storage (Filecoin), energy (Daylight), mapping (Hivemapper), wireless (Helium), WiFi (Uplink).',
    'NEW - Synergy Model: WirelessDePIN + MappingSensor + Uplink form a 3-layer DePIN stack. Regions with all 3 get synergy bonuses. Frontier zones get 3x rewards.',
    'Funding: Believer Round is open. 3-month cliff + 12-month vesting. On-chain refund protection.',
    'Governance: XFP-001 Circuit Allocation Vote ready. veXF holders set circuit priority tiers.',
  ];
  points.forEach(function(p, i) { console.log('  ' + (i + 1) + '. ' + p + '\n'); });

  console.log('  --- POST-AMA THREAD ---\n');
  console.log('  Post-Tweet 1: AMA RECAP - ' + STATS.circuits + ' circuits, ZK-verified, Believer Round OPEN');
  console.log('  Post-Tweet 2: Top questions and answers');
  console.log('  Post-Tweet 3: Links (whitepaper, believers, GitHub, Discord)\n');
}

function generateLaunch() {
  console.log('\n  ========================================');
  console.log('  Launch Event Content Package');
  console.log('  ========================================\n');

  console.log('  --- DISCORD ---\n');
  console.log('  @everyone');
  console.log('  XFuel Protocol Mainnet Activation');
  console.log('  Deploying: Core Layer + ' + STATS.circuits + ' circuits + BelieverRound');
  console.log('  Stats: ' + STATS.tests + ' tests, ' + STATS.contracts + ' contracts, 19/19 smoke tests');
  console.log('  Grant pipeline: ' + STATS.grants + '\n');

  console.log('  --- X/TWITTER LAUNCH THREAD ---\n');
  console.log('  Thread 1: XFuel Protocol is LIVE! ' + STATS.circuits + ' modular AI circuits. ZK-verified.');
  console.log('  Thread 2: Core Layer: RevenueSplitter + ZKVerifier + veXFGovernance');
  console.log('  Thread 3: All ' + STATS.circuits + ' circuits deployed, each fully isolated and ZK-verified.');
  console.log('  Thread 4: Latest: WirelessDePIN + UplinkCircuit = complete connectivity DePIN');
  console.log('  Thread 5: Next: veXF governance, grants ($350K-$750K), circuit #17\n');
}

function showSchedule() {
  console.log('\n  XFuel Protocol -- Event Schedule\n');
  EVENTS.forEach(function(e) {
    console.log('  [' + e.type + '] ' + e.title);
    console.log('    Date: ' + e.date + ' | Duration: ' + e.duration + ' | ' + e.platform);
    console.log('    Topics: ' + e.topics.join(', '));
    console.log('');
  });
}

function showStats() {
  console.log('\n  XFuel Protocol -- Community Stats\n');
  Object.keys(STATS).forEach(function(k) {
    console.log('  ' + k.padEnd(20) + STATS[k]);
  });
  console.log('');
}

var args = process.argv.slice(2);
var gi = args.indexOf('--generate');
if (gi >= 0 && args[gi + 1] === 'ama') generateAMA();
else if (gi >= 0 && args[gi + 1] === 'launch') generateLaunch();
else if (args.includes('--schedule')) showSchedule();
else if (args.includes('--stats')) showStats();
else { showSchedule(); }
