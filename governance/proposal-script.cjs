/**
 * XFuel Protocol -- veXF Governance Proposal Script
 *
 * Creates and manages governance proposals via the veXFGovernance contract.
 * Supports all proposal types: CircuitPriority, LPAllocation, FeeStructure,
 * TreasurySpend, and EmergencyPause.
 *
 * Usage:
 *   node governance/proposal-script.cjs --create allocation   # Create allocation vote
 *   node governance/proposal-script.cjs --create fee          # Create fee change vote
 *   node governance/proposal-script.cjs --create treasury     # Create treasury spend vote
 *   node governance/proposal-script.cjs --create emergency    # Create emergency pause
 *   node governance/proposal-script.cjs --create synergy      # Create DePIN synergy incentive vote
 *   node governance/proposal-script.cjs --list                # List proposals
 *   node governance/proposal-script.cjs --vote <id> <yes|no>  # Cast vote
 *   node governance/proposal-script.cjs --simulate            # Simulate first proposal
 *
 * On-chain contract: veXFGovernance.sol
 *   - ProposalType: CircuitPriority(0), LPAllocation(1), FeeStructure(2),
 *                   TreasurySpend(3), EmergencyPause(4)
 *   - Quorum: 10% of total voting power (67% for emergency)
 *   - Voting period: 3 days (by block)
 */
const fs = require('fs');
const path = require('path');

// All current circuits with their CIRCUIT_IDs
const CIRCUITS = [
  { name: 'TAOCircuit',       id: 'TAO_CIRCUIT',             expansion: 1 },
  { name: 'A2ACircuit',       id: 'A2A_CIRCUIT',             expansion: 2 },
  { name: 'ThetaGPUCircuit',  id: 'THETA_GPU_CIRCUIT',       expansion: 3 },
  { name: 'ZKMLCircuit',      id: 'ZKML_CIRCUIT',            expansion: 4 },
  { name: 'AkashCircuit',     id: 'AKASH_CIRCUIT',           expansion: 5 },
  { name: 'AutonomousVaults', id: 'AUTONOMOUS_VAULTS_CIRCUIT', expansion: 6 },
  { name: 'AgentRobotics',    id: 'AGENT_ROBOTICS_CIRCUIT',  expansion: 7 },
  { name: 'DataHubs',         id: 'DATA_HUBS_CIRCUIT',       expansion: 8 },
  { name: 'YieldCircuit',     id: 'YIELD_CIRCUIT',           expansion: 9 },
  { name: 'NearAgents',       id: 'NEAR_AGENTS_CIRCUIT',     expansion: 10 },
  { name: 'SolanaAIBridge',   id: 'SOLANA_AI_BRIDGE_CIRCUIT', expansion: 11 },
  { name: 'FilecoinStorage',  id: 'FILECOIN_STORAGE_CIRCUIT', expansion: 12 },
  { name: 'EnergyGrid',       id: 'ENERGY_GRID_CIRCUIT',     expansion: 13 },
  { name: 'MappingSensor',    id: 'MAPPING_SENSOR_CIRCUIT',  expansion: 14 },
  { name: 'WirelessDePIN',    id: 'WIRELESS_DEPIN_CIRCUIT',  expansion: 15 },
  { name: 'UplinkCircuit',    id: 'UPLINK_CIRCUIT',          expansion: 16 },
];

// Proposal templates
const PROPOSAL_TEMPLATES = {
  allocation: {
    type: 0, // CircuitPriority
    title: 'XFP-001: Circuit Allocation Priority Vote',
    description: `Proposal to set circuit priority allocation for the next quarter.

This vote determines which circuits receive priority development resources,
marketing focus, and grant attention. veXF holders vote to rank circuits.

Priority allocation affects:
- Developer allocation for circuit-specific features
- Marketing budget distribution across circuit campaigns
- Grant submission priority ordering
- Dashboard prominence and community spotlights

Current circuit count: ${CIRCUITS.length}
Latest additions: WirelessDePIN (#15), UplinkCircuit (#16)

Proposed tiers:
  Tier 1 (High Priority): TAOCircuit, SolanaAIBridge, WirelessDePIN, UplinkCircuit
  Tier 2 (Medium Priority): AkashCircuit, FilecoinStorage, EnergyGrid, MappingSensor
  Tier 3 (Standard): All remaining circuits

Vote YES to approve this allocation.
Vote NO to request revision.`,
    targetCircuit: 'bytes32(0)', // global
  },

  fee: {
    type: 2, // FeeStructure
    title: 'XFP-002: Adjust DePIN Circuit Fee Structure',
    description: `Proposal to adjust protocol fees for DePIN circuits.

Current fees:
- All circuits: 0.5% (50 bps)
- Max allowed: 2.0% (200 bps)

Proposed change:
- Compute circuits (TAO, Akash, ThetaGPU, ZKML): 0.5% (unchanged)
- DePIN circuits (Wireless, Uplink, Energy, Mapping): 0.4% (reduced to incentivize growth)
- Storage circuits (Filecoin): 0.3% (reduced to compete with native storage pricing)
- Bridge circuits (Solana, NEAR): 0.75% (unchanged)

Rationale: DePIN circuits benefit from lower fees during the growth phase.
Revenue impact: ~10% reduction in short-term fees, offset by higher volume.

Vote YES to approve fee adjustment.
Vote NO to keep current fee structure.`,
    targetCircuit: 'bytes32(0)',
  },

  treasury: {
    type: 3, // TreasurySpend
    title: 'XFP-003: Treasury Allocation for Security Audit',
    description: `Proposal to allocate treasury funds for a comprehensive security audit.

Requested: 150,000 XF tokens ($15,000 equivalent)
Recipient: [Audit firm TBD — shortlist: Trail of Bits, OpenZeppelin, Cyfrin]

Scope:
- Core Layer contracts (CoreRevenueSplitter, ZKVerifierSP1, veXFGovernance)
- Top 5 circuits by volume (TAO, Solana, Akash, Filecoin, Wireless)
- BelieverRound vesting contract
- Deployment scripts and role management

Timeline: 4-6 weeks from approval
Deliverable: Public audit report published to GitHub

Vote YES to approve treasury spend.
Vote NO to reject.`,
    targetCircuit: 'bytes32(0)',
  },

  emergency: {
    type: 4, // EmergencyPause
    title: 'XFP-EMERGENCY: Circuit Pause Request',
    description: `Emergency proposal to pause a specific circuit.

This proposal requires 67% supermajority (vs 10% quorum for standard proposals).

Use this template when a circuit vulnerability is discovered and immediate
pause is needed while a fix is developed.

Target circuit: [SPECIFY]
Reason: [DESCRIBE VULNERABILITY]
Expected fix timeline: [ESTIMATE]

Vote YES to pause the circuit.
Vote NO to keep it active.`,
    targetCircuit: 'bytes32(0)',
  },

  synergy: {
    type: 2, // FeeStructure (adjusts cross-circuit incentives)
    title: 'XFP-004: DePIN Synergy Incentive Activation',
    description: `Proposal to activate cross-circuit synergy incentives for the DePIN stack.

The XFuel DePIN stack consists of three complementary circuits:
  - WirelessDePIN (#15): LoRaWAN/5G coverage proofs (Helium model)
  - MappingSensor (#14): Geospatial data marketplace (Hivemapper model)
  - UplinkCircuit (#16): WiFi bandwidth sharing (Uplink model)

Proposed synergy incentive tiers:
  FULL (3/3 circuits in region):     1.0x base rewards
  PARTIAL (2/3 circuits in region):  1.5x rewards (incentivize missing layer)
  FRONTIER (1/3 circuits in region): 3.0x rewards (pioneer bonus)
  DEAD (0/3 circuits in region):     5.0x rewards (first-mover advantage)

Cross-Circuit Bonuses:
  - MappingSensor data from wireless-covered regions: +10% quality boost
  - UplinkCircuit sessions in mapped regions: +5% quality EMA boost
  - WirelessDePIN proofs with router density: +15% reward boost

Implementation phases:
  Phase 1: Off-chain synergy scoring (iteration/synergy-script.cjs)
  Phase 2: CoreListener cross-circuit event correlation
  Phase 3: On-chain SynergyOracle contract
  Phase 4: Automated reward multiplier in CoreRevenueSplitter

Vote YES to activate synergy incentives.
Vote NO to keep circuits independent (no cross-circuit bonuses).`,
    targetCircuit: 'bytes32(0)',
  },
};

function listProposals() {
  console.log('\n  XFuel Protocol -- Governance Proposals\n');
  console.log('  Available proposal templates:\n');

  for (const [key, p] of Object.entries(PROPOSAL_TEMPLATES)) {
    const typeName = ['CircuitPriority', 'LPAllocation', 'FeeStructure', 'TreasurySpend', 'EmergencyPause'][p.type];
    console.log(`  [${key}] ${p.title}`);
    console.log(`    Type:   ${typeName} (${p.type})`);
    console.log(`    Quorum: ${p.type === 4 ? '67%' : '10%'}`);
    console.log(`    Period: 3 days`);
    console.log('');
  }

  console.log('  Registered circuits for proposals:');
  for (const c of CIRCUITS) {
    console.log(`    #${String(c.expansion).padStart(2)} ${c.name.padEnd(22)} ${c.id}`);
  }
  console.log('');
}

function createProposal(type) {
  const template = PROPOSAL_TEMPLATES[type];
  if (!template) {
    console.log('  Unknown proposal type: ' + type);
    console.log('  Available: allocation, fee, treasury, emergency');
    return;
  }

  console.log('\n  ========================================');
  console.log('  Creating Governance Proposal');
  console.log('  ========================================\n');
  console.log('  Title: ' + template.title);
  console.log('  Type:  ' + ['CircuitPriority', 'LPAllocation', 'FeeStructure', 'TreasurySpend', 'EmergencyPause'][template.type]);
  console.log('  Quorum: ' + (template.type === 4 ? '67% supermajority' : '10% of total voting power'));
  console.log('  Period: 3 days');
  console.log('\n  Description:');
  console.log('  ' + template.description.split('\n').join('\n  '));

  // Generate on-chain call data
  console.log('\n  ========================================');
  console.log('  On-Chain Submission (Hardhat)');
  console.log('  ========================================\n');
  console.log('  // Requires: veXF holder with sufficient voting power');
  console.log('  // Contract: veXFGovernance.createProposal(pType, targetCircuit, description)');
  console.log('');
  console.log('  const governance = await ethers.getContractAt("veXFGovernance", GOVERNANCE_ADDRESS);');
  console.log(`  const pType = ${template.type}; // ${['CircuitPriority', 'LPAllocation', 'FeeStructure', 'TreasurySpend', 'EmergencyPause'][template.type]}`);
  console.log('  const targetCircuit = ethers.ZeroHash; // global');
  console.log(`  const description = "${template.title}";`);
  console.log('  const tx = await governance.createProposal(pType, targetCircuit, description);');
  console.log('  const receipt = await tx.wait();');
  console.log('  console.log("Proposal created:", receipt.hash);');
  console.log('');

  // Save proposal to file
  const pDir = path.join(__dirname, 'proposals');
  if (!fs.existsSync(pDir)) fs.mkdirSync(pDir, { recursive: true });
  const pFile = path.join(pDir, type + '-' + Date.now() + '.json');
  fs.writeFileSync(pFile, JSON.stringify({
    title: template.title,
    type: template.type,
    typeName: ['CircuitPriority', 'LPAllocation', 'FeeStructure', 'TreasurySpend', 'EmergencyPause'][template.type],
    description: template.description,
    quorum: template.type === 4 ? '67%' : '10%',
    votingPeriod: '3 days',
    created: new Date().toISOString(),
    circuits: CIRCUITS.length,
  }, null, 2));
  console.log('  Proposal saved: ' + pFile);
}

function simulateFirstProposal() {
  console.log('\n  ========================================');
  console.log('  Simulating First Governance Proposal');
  console.log('  ========================================\n');

  const p = PROPOSAL_TEMPLATES.allocation;
  console.log('  Proposal: ' + p.title);
  console.log('  Type: CircuitPriority');
  console.log('');

  console.log('  Simulation steps:');
  console.log('  1. Deploy veXFGovernance with XF token');
  console.log('  2. Lock 1000 XF for 365 days -> get voting power');
  console.log('  3. createProposal(0, bytes32(0), "XFP-001: Circuit Allocation")');
  console.log('  4. Voting opens for 3 days (~17280 blocks)');
  console.log('  5. vote(proposalId, true) with veXF weight');
  console.log('  6. After voting period: check quorum (>= 10%)');
  console.log('  7. executeProposal(proposalId) if quorum met');
  console.log('');

  console.log('  Hardhat simulation script:');
  console.log('  ```');
  console.log('  npx hardhat run governance/proposal-script.cjs --simulate');
  console.log('');
  console.log('  // This would execute on a local Hardhat node:');
  console.log('  // 1. Deploy MockERC20 + veXFGovernance');
  console.log('  // 2. Mint tokens, approve, lock');
  console.log('  // 3. Create proposal');
  console.log('  // 4. Vote');
  console.log('  // 5. Mine blocks to pass voting period');
  console.log('  // 6. Execute');
  console.log('  ```');
  console.log('');

  console.log('  Expected gas costs:');
  console.log('    createProposal: ~120K gas');
  console.log('    vote:           ~80K gas');
  console.log('    executeProposal: ~60K gas');
  console.log('');

  console.log('  veXF voting power formula:');
  console.log('    votingPower = amount * lockDuration / MAX_LOCK');
  console.log('    MAX_LOCK = 4 years (1461 days)');
  console.log('    Example: 1000 XF locked 1 year = 1000 * 365 / 1461 = 249.8 veXF');
  console.log('');
}

// Main
const args = process.argv.slice(2);
const createIdx = args.indexOf('--create');

if (createIdx >= 0 && args[createIdx + 1]) {
  createProposal(args[createIdx + 1]);
} else if (args.includes('--list')) {
  listProposals();
} else if (args.includes('--simulate')) {
  simulateFirstProposal();
} else {
  console.log('\n  XFuel Protocol -- Governance Proposal Script');
  console.log('  Usage:');
  console.log('    node governance/proposal-script.cjs --list');
  console.log('    node governance/proposal-script.cjs --create allocation');
  console.log('    node governance/proposal-script.cjs --create fee');
  console.log('    node governance/proposal-script.cjs --create treasury');
  console.log('    node governance/proposal-script.cjs --create emergency');
  console.log('    node governance/proposal-script.cjs --simulate');
  console.log('');
  listProposals();
}
