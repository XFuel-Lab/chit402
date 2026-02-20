/**
 * XFuel Protocol -- Cross-Circuit Synergy Analyzer
 *
 * Analyzes synergy between WirelessDePIN + MappingSensor + UplinkCircuit
 * to create a connectivity-verified mapping overlay. Reads on-chain state
 * from deployment manifests and generates synergy reports.
 *
 * Synergy Model:
 *   WirelessDePIN (LoRaWAN/5G)  -> Coverage hexes with RSSI/SNR proofs
 *   MappingSensor (dashcam/IoT)  -> Geospatial data submissions per region
 *   UplinkCircuit (WiFi)         -> Router density and session counts per region
 *
 *   Cross-reference: regions with ALL THREE active = "Full DePIN Coverage"
 *   Regions with 2/3 = "Partial Coverage" -> incentivize missing layer
 *   Regions with 1/3 = "Frontier" -> high reward multiplier
 *
 * Usage:
 *   node iteration/synergy-script.cjs                      # Show synergy dashboard
 *   node iteration/synergy-script.cjs --manifest <path>    # Load from manifest
 *   node iteration/synergy-script.cjs --simulate           # Simulate cross-circuit data
 *   node iteration/synergy-script.cjs --report             # Generate JSON report
 *   node iteration/synergy-script.cjs --incentives         # Show incentive model
 */
var fs = require('fs');
var path = require('path');
var https = require('https');
var http = require('http');

var SYNERGY_CIRCUITS = {
  wirelessDePIN: {
    name: 'WirelessDePIN', expansion: 15, dataType: 'Coverage Proofs',
    metric: 'hexCoverage', gasAvg: '~279K', description: 'LoRaWAN/5G beacon/witness proofs',
    events: ['CoverageProven', 'HexCoverageUpdated', 'DataTransferred'],
  },
  mappingSensor: {
    name: 'MappingSensor', expansion: 14, dataType: 'Geospatial Data',
    metric: 'regionCoverage', gasAvg: '~306K', description: 'Dashcam/sensor data submissions',
    events: ['DataSubmitted', 'DataPurchased', 'CoverageUpdated'],
  },
  uplinkCircuit: {
    name: 'UplinkCircuit', expansion: 16, dataType: 'WiFi Sessions',
    metric: 'regionRouterCount', gasAvg: '~350K', description: 'WiFi bandwidth sharing sessions',
    events: ['BandwidthProven', 'SessionSettled', 'RouterRegistered'],
  },
};

var SAMPLE_REGIONS = [
  { hex: 'us-east-nyc',     name: 'New York City',    wireless: 42, mapping: 18, uplink: 35 },
  { hex: 'us-west-sf',      name: 'San Francisco',    wireless: 38, mapping: 25, uplink: 28 },
  { hex: 'eu-west-london',  name: 'London',           wireless: 55, mapping: 31, uplink: 40 },
  { hex: 'eu-west-berlin',  name: 'Berlin',           wireless: 30, mapping: 12, uplink: 22 },
  { hex: 'ap-east-tokyo',   name: 'Tokyo',            wireless: 28, mapping: 45, uplink: 15 },
  { hex: 'ap-se-singapore', name: 'Singapore',        wireless: 20, mapping: 8,  uplink: 18 },
  { hex: 'latam-sp',        name: 'Sao Paulo',        wireless: 15, mapping: 5,  uplink: 10 },
  { hex: 'af-west-lagos',   name: 'Lagos',            wireless: 8,  mapping: 2,  uplink: 5  },
];

function classifyRegion(r) {
  var layers = 0;
  if (r.wireless > 0) layers++;
  if (r.mapping > 0) layers++;
  if (r.uplink > 0) layers++;
  if (layers === 3) return { tier: 'FULL', label: 'Full DePIN Coverage', multiplier: 1.0, color: 'green' };
  if (layers === 2) return { tier: 'PARTIAL', label: 'Partial Coverage', multiplier: 1.5, color: 'amber' };
  if (layers === 1) return { tier: 'FRONTIER', label: 'Frontier Zone', multiplier: 3.0, color: 'red' };
  return { tier: 'DEAD', label: 'No Coverage', multiplier: 5.0, color: 'gray' };
}

function getMissing(r) {
  var missing = [];
  if (r.wireless === 0) missing.push('WirelessDePIN (deploy hotspots)');
  if (r.mapping === 0) missing.push('MappingSensor (register dashcams/sensors)');
  if (r.uplink === 0) missing.push('UplinkCircuit (share WiFi routers)');
  return missing;
}

function synergyScore(r) {
  var total = r.wireless + r.mapping + r.uplink;
  var balance = 1 - (Math.abs(r.wireless - r.mapping) + Math.abs(r.mapping - r.uplink) + Math.abs(r.wireless - r.uplink)) / (3 * Math.max(total, 1));
  return Math.round(balance * total);
}

function printDashboard() {
  console.log('');
  console.log('  ================================================================');
  console.log('   XFuel Protocol -- Cross-Circuit Synergy Dashboard');
  console.log('  ================================================================');
  console.log('  Time: ' + new Date().toISOString());
  console.log('');

  console.log('  -- Synergy Circuits --');
  Object.values(SYNERGY_CIRCUITS).forEach(function(c) {
    console.log('    #' + c.expansion + ' ' + c.name.padEnd(18) + c.dataType.padEnd(20) + 'Gas: ' + c.gasAvg);
  });
  console.log('');

  console.log('  -- Regional Coverage Matrix --');
  console.log('  ' + 'Region'.padEnd(18) + 'Wireless'.padEnd(10) + 'Mapping'.padEnd(10) + 'Uplink'.padEnd(10) + 'Tier'.padEnd(10) + 'Score'.padEnd(8) + 'Missing');
  console.log('  ' + '-'.repeat(85));

  var fullCount = 0; var partialCount = 0; var frontierCount = 0;
  SAMPLE_REGIONS.forEach(function(r) {
    var cl = classifyRegion(r);
    var score = synergyScore(r);
    var missing = getMissing(r);
    if (cl.tier === 'FULL') fullCount++;
    if (cl.tier === 'PARTIAL') partialCount++;
    if (cl.tier === 'FRONTIER') frontierCount++;
    console.log('  ' + r.name.padEnd(18) + String(r.wireless).padEnd(10) + String(r.mapping).padEnd(10) + String(r.uplink).padEnd(10) + cl.tier.padEnd(10) + String(score).padEnd(8) + (missing.length > 0 ? missing.join(', ') : '--'));
  });

  console.log('');
  console.log('  -- Summary --');
  console.log('    Full coverage:    ' + fullCount + ' regions (all 3 circuits active)');
  console.log('    Partial:          ' + partialCount + ' regions (2/3 circuits)');
  console.log('    Frontier:         ' + frontierCount + ' regions (1/3 circuits)');
  console.log('    Total devices:    ' + SAMPLE_REGIONS.reduce(function(s, r) { return s + r.wireless + r.mapping + r.uplink; }, 0));
  console.log('');
}

function printIncentives() {
  console.log('');
  console.log('  ================================================================');
  console.log('   XFuel Protocol -- Synergy Incentive Model');
  console.log('  ================================================================\n');

  console.log('  Coverage Tier Multipliers:');
  console.log('    FULL (3/3 circuits):     1.0x base rewards');
  console.log('    PARTIAL (2/3 circuits):  1.5x rewards (incentivize missing layer)');
  console.log('    FRONTIER (1/3 circuits): 3.0x rewards (pioneer bonus)');
  console.log('    DEAD (0/3 circuits):     5.0x rewards (first-mover advantage)');
  console.log('');

  console.log('  Cross-Circuit Bonus:');
  console.log('    When a MappingSensor submission comes from a region with WirelessDePIN');
  console.log('    coverage, the data quality score gets a 10% boost (connectivity-verified).');
  console.log('');
  console.log('    When an UplinkCircuit session is settled in a region with MappingSensor');
  console.log('    data, the router quality EMA gets a 5% boost (map-verified location).');
  console.log('');
  console.log('    When a WirelessDePIN coverage proof overlaps with UplinkCircuit router');
  console.log('    density, the coverage proof gets a 15% reward boost (redundancy bonus).');
  console.log('');

  console.log('  On-Chain Implementation:');
  console.log('    Phase 1: Off-chain synergy scoring via this script');
  console.log('    Phase 2: CoreListener cross-circuit event correlation');
  console.log('    Phase 3: On-chain SynergyOracle contract reading all 3 circuits');
  console.log('    Phase 4: Automated reward multiplier in CoreRevenueSplitter');
  console.log('');

  console.log('  Governance Integration:');
  console.log('    Synergy multipliers are governed by veXF proposals (type: FeeStructure).');
  console.log('    Community votes to adjust tier thresholds and bonus percentages.');
  console.log('');
}

function simulate() {
  console.log('');
  console.log('  ================================================================');
  console.log('   XFuel Protocol -- Synergy Simulation');
  console.log('  ================================================================\n');

  console.log('  Simulating 100 cross-circuit events...\n');

  var events = [];
  var circuitNames = ['WirelessDePIN', 'MappingSensor', 'UplinkCircuit'];
  var eventTypes = [
    { circuit: 'WirelessDePIN', type: 'CoverageProven', gas: 279000 },
    { circuit: 'MappingSensor', type: 'DataSubmitted', gas: 306000 },
    { circuit: 'UplinkCircuit', type: 'SessionSettled', gas: 350000 },
    { circuit: 'WirelessDePIN', type: 'DataTransferred', gas: 394000 },
    { circuit: 'MappingSensor', type: 'DataPurchased', gas: 226000 },
    { circuit: 'UplinkCircuit', type: 'BandwidthProven', gas: 350000 },
  ];

  var totalGas = 0;
  var byCircuit = { WirelessDePIN: 0, MappingSensor: 0, UplinkCircuit: 0 };
  var synergyHits = 0;

  for (var i = 0; i < 100; i++) {
    var evt = eventTypes[i % eventTypes.length];
    var region = SAMPLE_REGIONS[i % SAMPLE_REGIONS.length];
    totalGas += evt.gas;
    byCircuit[evt.circuit]++;

    var cl = classifyRegion(region);
    if (cl.tier === 'FULL') synergyHits++;

    events.push({
      id: i + 1, circuit: evt.circuit, type: evt.type,
      region: region.name, tier: cl.tier, gas: evt.gas,
    });
  }

  console.log('  Event Distribution:');
  Object.keys(byCircuit).forEach(function(c) {
    console.log('    ' + c.padEnd(18) + byCircuit[c] + ' events');
  });
  console.log('');
  console.log('  Synergy Metrics:');
  console.log('    Full-coverage events: ' + synergyHits + '/100 (' + synergyHits + '% synergy rate)');
  console.log('    Total gas consumed:   ' + totalGas.toLocaleString());
  console.log('    Avg gas per event:    ' + Math.round(totalGas / 100).toLocaleString());
  console.log('');

  console.log('  Top 5 Events:');
  events.slice(0, 5).forEach(function(e) {
    console.log('    #' + e.id + ' ' + e.circuit.padEnd(18) + e.type.padEnd(20) + e.region.padEnd(16) + e.tier);
  });
  console.log('    ... (' + (events.length - 5) + ' more events)');
  console.log('');
}

function generateReport() {
  var regions = SAMPLE_REGIONS.map(function(r) {
    var cl = classifyRegion(r);
    return {
      hex: r.hex, name: r.name,
      wireless: r.wireless, mapping: r.mapping, uplink: r.uplink,
      tier: cl.tier, multiplier: cl.multiplier, score: synergyScore(r),
      missing: getMissing(r),
    };
  });

  var report = {
    generated: new Date().toISOString(),
    version: '1.0',
    circuits: SYNERGY_CIRCUITS,
    regions: regions,
    summary: {
      totalRegions: regions.length,
      fullCoverage: regions.filter(function(r) { return r.tier === 'FULL'; }).length,
      partial: regions.filter(function(r) { return r.tier === 'PARTIAL'; }).length,
      frontier: regions.filter(function(r) { return r.tier === 'FRONTIER'; }).length,
      totalDevices: regions.reduce(function(s, r) { return s + r.wireless + r.mapping + r.uplink; }, 0),
      avgSynergyScore: Math.round(regions.reduce(function(s, r) { return s + r.score; }, 0) / regions.length),
    },
  };

  var rDir = path.join(__dirname, 'reports');
  if (!fs.existsSync(rDir)) fs.mkdirSync(rDir, { recursive: true });
  var rFile = path.join(rDir, 'synergy-' + Date.now() + '.json');
  fs.writeFileSync(rFile, JSON.stringify(report, null, 2));
  console.log('  Report saved: ' + rFile);
  return report;
}

// Main
var args = process.argv.slice(2);
if (args.includes('--simulate')) simulate();
else if (args.includes('--incentives')) printIncentives();
else if (args.includes('--report')) { printDashboard(); generateReport(); }
else printDashboard();
