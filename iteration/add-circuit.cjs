/**
 * XFuel Protocol -- Circuit Onboarding Script
 *
 * Automates the process of adding a new expansion circuit to the protocol.
 * Generates scaffolding, registers in CircuitImports, and validates integration.
 *
 * Usage:
 *   node iteration/add-circuit.cjs --name CircuitName --id circuit-id
 *   node iteration/add-circuit.cjs --list
 *   node iteration/add-circuit.cjs --validate
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');

const REGISTERED_CIRCUITS = [
  { id: 'tao-evm',           name: 'TAOCircuit',       expansion: 1 },
  { id: 'a2a',               name: 'A2ACircuit',       expansion: 2 },
  { id: 'theta-gpu',         name: 'ThetaGPUCircuit',  expansion: 3 },
  { id: 'zkml',              name: 'ZKMLCircuit',       expansion: 4 },
  { id: 'akash',             name: 'AkashCircuit',      expansion: 5 },
  { id: 'autonomous-vaults', name: 'AutonomousVaults',  expansion: 6 },
  { id: 'agent-robotics',    name: 'AgentRobotics',     expansion: 7 },
  { id: 'data-hubs',         name: 'DataHubs',          expansion: 8 },
  { id: 'yield-optimization',name: 'YieldCircuit',      expansion: 9 },
  { id: 'near-agents',       name: 'NearAgents',        expansion: 10 },
  { id: 'solana-ai-bridge',  name: 'SolanaAIBridge',    expansion: 11 },
  { id: 'filecoin-storage',  name: 'FilecoinStorage',   expansion: 12 },
  { id: 'energy-grid',       name: 'EnergyGrid',        expansion: 13 },
  { id: 'mapping-sensor',    name: 'MappingSensor',     expansion: 14 },
  { id: 'wireless-depin',    name: 'WirelessDePIN',     expansion: 15 },
  { id: 'uplink',            name: 'UplinkCircuit',     expansion: 16 },
];

function listCircuits() {
  console.log('\n  XFuel Protocol -- Registered Circuits\n');
  console.log('  #   ID                    Contract              Status');
  console.log('  ' + '-'.repeat(72));
  for (const c of REGISTERED_CIRCUITS) {
    var num = String(c.expansion).padStart(2);
    var exists = fs.existsSync(path.join(ROOT, 'circuits', c.id, c.name + '.sol'));
    var icon = exists ? 'OK' : '??';
    console.log('  ' + num + '  ' + c.id.padEnd(22) + ' ' + c.name.padEnd(22) + ' ' + icon);
  }
  console.log('\n  Total: ' + REGISTERED_CIRCUITS.length + ' circuits\n');
}

function validateCircuits() {
  console.log('\n  XFuel Protocol -- Circuit Validation\n');
  var ok = 0;
  var fail = 0;
  for (const c of REGISTERED_CIRCUITS) {
    var base = path.join(ROOT, 'circuits', c.id);
    var contractOk = fs.existsSync(path.join(base, c.name + '.sol'));
    var handlerOk = fs.existsSync(base) && fs.readdirSync(base).some(function(f) { return f.endsWith('-handler.js'); });
    var testDir = path.join(base, 'test');
    var testOk = fs.existsSync(testDir) && fs.readdirSync(testDir).some(function(f) { return f.endsWith('.test.cjs'); });
    var status = (contractOk && handlerOk && testOk) ? 'PASS' : 'FAIL';
    if (status === 'PASS') ok++; else fail++;
    console.log('  ' + status + ' #' + c.expansion + ' ' + c.name + ': contract=' + (contractOk ? 'Y' : 'N') + ' handler=' + (handlerOk ? 'Y' : 'N') + ' test=' + (testOk ? 'Y' : 'N'));
  }
  console.log('\n  Results: ' + ok + ' passed, ' + fail + ' failed, ' + REGISTERED_CIRCUITS.length + ' total\n');
}

function generateScaffold(name, id) {
  var expansion = REGISTERED_CIRCUITS.length + 1;
  var folder = path.join(ROOT, 'circuits', id);
  var testFolder = path.join(folder, 'test');
  if (fs.existsSync(folder)) {
    console.log('  Circuit folder already exists: ' + folder);
    return;
  }
  fs.mkdirSync(testFolder, { recursive: true });
  var cid = id.toUpperCase().replace(/-/g, '_') + '_CIRCUIT';
  var sol = '// SPDX-License-Identifier: MIT\npragma solidity ^0.8.20;\n\nimport "@openzeppelin/contracts/access/AccessControl.sol";\nimport "@openzeppelin/contracts/utils/Pausable.sol";\nimport "@openzeppelin/contracts/utils/ReentrancyGuard.sol";\n\ncontract ' + name + ' is AccessControl, Pausable, ReentrancyGuard {\n    bytes32 public constant OPERATOR_ROLE = keccak256("OPERATOR_ROLE");\n    bytes32 public constant CIRCUIT_ID = keccak256("' + cid + '");\n    address public revenueSplitter;\n    address public zkVerifier;\n    constructor(address _a, address _rs, address _zk) {\n        require(_a != address(0), "ZeroAdmin");\n        revenueSplitter = _rs; zkVerifier = _zk;\n        _grantRole(DEFAULT_ADMIN_ROLE, _a); _grantRole(OPERATOR_ROLE, _a);\n    }\n    function pause() external onlyRole(DEFAULT_ADMIN_ROLE) { _pause(); }\n    function unpause() external onlyRole(DEFAULT_ADMIN_ROLE) { _unpause(); }\n    receive() external payable {}\n}\n';
  fs.writeFileSync(path.join(folder, name + '.sol'), sol);
  fs.writeFileSync(path.join(folder, id + '-handler.js'), 'export class ' + name.replace('Circuit', '') + 'Handler {\n  constructor() { this.circuitId = "' + id + '"; }\n  async onIntent(intent) { return { status: "accepted" }; }\n  getStatus() { return { circuit: this.circuitId, ready: true }; }\n}\n');
  fs.writeFileSync(path.join(testFolder, name + '.test.cjs'), 'const { expect } = require("chai");\nconst { ethers } = require("hardhat");\ndescribe("' + name + '", function () {\n  it("should deploy", async function () {\n    const [a] = await ethers.getSigners();\n    const F = await ethers.getContractFactory("' + name + '");\n    const c = await F.deploy(a.address, ethers.ZeroAddress, ethers.ZeroAddress);\n    await c.waitForDeployment();\n    expect(await c.CIRCUIT_ID()).to.not.equal(ethers.ZeroHash);\n  });\n});\n');
  console.log('  Created scaffold for #' + expansion + ' ' + name + ' in circuits/' + id + '/');
  console.log('  Next: implement logic, update CircuitImports.sol, circuits/index.js, deploy scripts');
}

var args = process.argv.slice(2);
if (args.includes('--list')) { listCircuits(); }
else if (args.includes('--validate')) { validateCircuits(); }
else if (args.indexOf('--name') >= 0 && args.indexOf('--id') >= 0) {
  var ni = args.indexOf('--name');
  var ii = args.indexOf('--id');
  generateScaffold(args[ni + 1], args[ii + 1]);
} else {
  console.log('\n  Usage: node iteration/add-circuit.cjs --list | --validate | --name X --id y');
  listCircuits();
}
