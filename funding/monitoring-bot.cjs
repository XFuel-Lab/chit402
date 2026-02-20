/**
 * XFuel Protocol -- Funding and Grant Monitoring Bot
 *
 * Tracks grant application status, funding milestones, and believer round
 * progress. Integrates with Discord/Slack webhooks for real-time updates.
 *
 * Usage:
 *   node funding/monitoring-bot.cjs
 *   node funding/monitoring-bot.cjs --watch
 *   node funding/monitoring-bot.cjs --webhook URL
 *   node funding/monitoring-bot.cjs --report
 *   node funding/monitoring-bot.cjs --milestones
 */
var fs = require('fs');
var path = require('path');
var https = require('https');
var http = require('http');

var POLL_INTERVAL = 60000;

var GRANTS = [
  { id: 'solana', program: 'Solana Foundation', circuit: 'SolanaAIBridge',
    amount: '$150K-$250K', status: 'SUBMIT-READY', url: 'https://solana.org/grants',
    milestones: [
      { id: 'S1', name: 'Anchor Program', status: 'todo', due: 'Month 2' },
      { id: 'S2', name: 'Wormhole Integration', status: 'todo', due: 'Month 3' },
      { id: 'S3', name: 'Provider SDK', status: 'todo', due: 'Month 4' },
      { id: 'S4', name: 'SP1 Circuit', status: 'todo', due: 'Month 5' },
      { id: 'S5', name: 'Testnet Launch', status: 'todo', due: 'Month 6' },
      { id: 'S6', name: 'Security Audit', status: 'todo', due: 'Month 6' },
    ] },
  { id: 'opentensor', program: 'OpenTensor Foundation', circuit: 'TAOCircuit',
    amount: '$150K-$200K', status: 'SUBMIT-READY', url: 'https://opentensor.ai/grants',
    milestones: [
      { id: 'T1', name: 'TAO EVM Deploy', status: 'todo', due: 'Month 2' },
      { id: 'T2', name: 'Subnet Adapter', status: 'todo', due: 'Month 3' },
      { id: 'T3', name: 'SP1 Inference Proof', status: 'todo', due: 'Month 4' },
      { id: 'T4', name: 'AMM Oracle', status: 'todo', due: 'Month 4' },
      { id: 'T5', name: 'Cross-Chain Bridge', status: 'todo', due: 'Month 5' },
      { id: 'T6', name: 'Testnet + Audit', status: 'todo', due: 'Month 6' },
    ] },
  { id: 'general', program: 'Ecosystem Grants', circuit: 'Customizable',
    amount: '$50K-$300K', status: 'SUBMIT-READY', url: '[ecosystem-specific]',
    milestones: [
      { id: 'G1', name: 'Circuit Contract', status: 'todo', due: 'Month 2' },
      { id: 'G2', name: 'Off-chain Handler', status: 'todo', due: 'Month 3' },
      { id: 'G3', name: 'ZK Circuit', status: 'todo', due: 'Month 4' },
      { id: 'G4', name: 'Integration + Test', status: 'todo', due: 'Month 5' },
      { id: 'G5', name: 'Deploy + Audit', status: 'todo', due: 'Month 6' },
    ] },
];

var BELIEVER = { status: 'OPEN', hardCap: '500 TFUEL', maxPerWallet: '5 TFUEL',
  cliff: '90 days', vesting: '365 days', refund: '180 days' };
var TRACTION = { circuits: 16, contracts: 20, tests: '315+',
  smoke: '19/19', health: '19/19', latest: 'UplinkCircuit',
  synergy: 'WirelessDePIN + MappingSensor + Uplink (3-layer DePIN)',
  governance: 'XFP-001 Circuit Allocation Vote (ready)' };

function postWebhook(url, payload) {
  return new Promise(function(resolve, reject) {
    var body = JSON.stringify(payload);
    var u = new URL(url);
    var mod = u.protocol === 'https:' ? https : http;
    var req = mod.request({
      hostname: u.hostname, port: u.port, path: u.pathname + u.search,
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) },
    }, function(res) {
      var data = '';
      res.on('data', function(c) { data += c; });
      res.on('end', function() { resolve(data); });
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

function printStatus() {
  console.log('');
  console.log('  ====================================================');
  console.log('   XFuel Protocol -- Funding Monitor');
  console.log('  ====================================================');
  console.log('  Time: ' + new Date().toISOString());
  console.log('');
  console.log('  -- Grant Applications --');
  GRANTS.forEach(function(g) {
    var icon = g.status === 'SUBMIT-READY' ? 'READY' : g.status === 'SUBMITTED' ? 'SENT' : g.status;
    console.log('    ' + icon.padEnd(8) + g.program.padEnd(28) + g.amount.padEnd(14) + g.circuit);
  });
  var ready = GRANTS.filter(function(g) { return g.status === 'SUBMIT-READY'; }).length;
  console.log('    Pipeline: ' + ready + ' ready, $350K-$750K potential');
  console.log('');
  console.log('  -- Believer Round --');
  Object.keys(BELIEVER).forEach(function(k) { console.log('    ' + k.padEnd(16) + BELIEVER[k]); });
  console.log('');
  console.log('  -- Protocol Traction --');
  Object.keys(TRACTION).forEach(function(k) { console.log('    ' + k.padEnd(16) + TRACTION[k]); });
  console.log('');
  console.log('  -- DePIN Synergy Status --');
  console.log('    Stack:      WirelessDePIN (#15) + MappingSensor (#14) + UplinkCircuit (#16)');
  console.log('    Model:      3-tier incentives (Full/Partial/Frontier coverage)');
  console.log('    Governance: XFP-001 ready for veXF vote');
  console.log('');
}

function printMilestones() {
  console.log('\n  XFuel Protocol -- Grant Milestones\n');
  GRANTS.forEach(function(g) {
    console.log('  ' + g.program + ' (' + g.amount + ')');
    g.milestones.forEach(function(m) {
      var icon = m.status === 'done' ? 'DONE' : m.status === 'wip' ? 'WIP' : 'TODO';
      console.log('    ' + icon.padEnd(6) + m.id + ' ' + m.name.padEnd(22) + 'Due: ' + m.due);
    });
    console.log('');
  });
}

function generateReport() {
  var report = {
    generated: new Date().toISOString(), version: '2.1',
    grants: GRANTS, believerRound: BELIEVER, traction: TRACTION,
    summary: { total: GRANTS.length, ready: GRANTS.filter(function(g) { return g.status === 'SUBMIT-READY'; }).length,
               pipeline: '$350K-$750K' },
  };
  var rDir = path.join(__dirname, 'reports');
  if (!fs.existsSync(rDir)) fs.mkdirSync(rDir, { recursive: true });
  var rFile = path.join(rDir, 'funding-' + Date.now() + '.json');
  fs.writeFileSync(rFile, JSON.stringify(report, null, 2));
  console.log('  Report saved: ' + rFile);
  return report;
}

async function sendWebhook(url) {
  try {
    await postWebhook(url, {
      embeds: [{
        title: 'XFuel Funding Monitor',
        color: 0x7c3aed,
        fields: [
          { name: 'Grants', value: GRANTS.length + ' SUBMIT-READY ($350K-$750K)', inline: true },
          { name: 'Believer Round', value: BELIEVER.status, inline: true },
          { name: 'Circuits', value: String(TRACTION.circuits), inline: true },
          { name: 'Tests', value: TRACTION.tests, inline: true },
          { name: 'Latest', value: TRACTION.latest, inline: true },
        ],
        timestamp: new Date().toISOString(),
      }],
    });
    console.log('  Webhook sent');
  } catch (e) { console.log('  Webhook failed: ' + e.message); }
}

async function main() {
  var args = process.argv.slice(2);
  if (args.includes('--milestones')) { printMilestones(); return; }
  printStatus();
  if (args.includes('--report')) generateReport();
  var wi = args.indexOf('--webhook');
  if (wi >= 0 && args[wi + 1]) await sendWebhook(args[wi + 1]);
  if (args.includes('--watch')) {
    console.log('  Continuous monitoring (interval: ' + POLL_INTERVAL + 'ms)');
    setInterval(function() { printStatus(); }, POLL_INTERVAL);
  }
}

main().catch(function(e) { console.error('Error:', e); process.exit(1); });
