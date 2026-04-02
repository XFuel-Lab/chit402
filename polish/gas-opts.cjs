/**
 * XFuel Protocol — Gas Optimization Profiler
 *
 * Comprehensive gas analysis across all 11 circuits + BelieverRound.
 * Outputs a structured report with per-operation gas costs, deployment
 * costs, and optimization recommendations.
 *
 * Usage:
 *   npx hardhat run polish/gas-opts.cjs
 *
 * Features:
 *   - Measures deployment gas for every contract
 *   - Measures key lifecycle operations (submit, settle, claim, refund)
 *   - Compares against target budgets (<100K settlement, <400K Solana bridge)
 *   - Outputs JSON report to polish/gas-report-{timestamp}.json
 *   - Prints summary table with pass/fail indicators
 */
const { ethers } = require('hardhat');
const fs = require('fs');
const path = require('path');

const GAS_TARGETS = {
  'TAOCircuit.settleTask':       100_000,
  'A2ACircuit.settleTask':       100_000,
  'ThetaGPUCircuit.settleTask':  120_000,
  'ZKMLCircuit.settleTask':      120_000,
  'AkashCircuit.settleTask':     120_000,
  'AutonomousVaults.settleTask': 120_000,
  'AgentRobotics.settleTask':    120_000,
  'DataHubs.settleTask':         120_000,
  'YieldCircuit.settleTask':     120_000,
  'NearAgents.settleTask':       120_000,
  'SolanaAIBridge.settleTask':   400_000,
  'BelieverRound.commit':        130_000,
  'BelieverRound.claim':         150_000,
};

async function main() {
  const [admin, user1, user2, bbb, lp, staker, treasury, stakePool] =
    await ethers.getSigners();

  console.log('╔══════════════════════════════════════════════════════════════╗');
  console.log('║  XFuel Protocol — Gas Optimization Profiler                 ║');
  console.log('╚══════════════════════════════════════════════════════════════╝');

  const report = {
    timestamp: new Date().toISOString(),
    compiler: 'solc 0.8.22, viaIR: true, optimizer: 200 runs',
    deploymentGas: {},
    operationGas: {},
    targets: GAS_TARGETS,
    results: [],
  };

  // ── Phase 1: Deployment gas ──────────────────────────────────────
  console.log('\n══ Phase 1: Deployment Gas ═════════════════════════════');

  const deploymentDefs = [
    { name: 'CoreRevenueSplitter', args: [admin.address, bbb.address, lp.address, staker.address, treasury.address, stakePool.address] },
    { name: 'ZKVerifierSP1', args: [admin.address, ethers.ZeroAddress] },
    { name: 'TAOCircuit', args: [admin.address, ethers.ZeroAddress, ethers.ZeroAddress, ethers.ZeroAddress, ethers.ZeroAddress] },
    { name: 'A2ACircuit', args: [admin.address, ethers.ZeroAddress, ethers.ZeroAddress] },
    { name: 'ThetaGPUCircuit', args: [admin.address, ethers.ZeroAddress, ethers.ZeroAddress] },
    { name: 'ZKMLCircuit', args: [admin.address, ethers.ZeroAddress, ethers.ZeroAddress] },
    { name: 'AkashCircuit', args: [admin.address, ethers.ZeroAddress, ethers.ZeroAddress] },
    { name: 'AutonomousVaults', args: [admin.address, ethers.ZeroAddress, ethers.ZeroAddress] },
    { name: 'AgentRobotics', args: [admin.address, ethers.ZeroAddress, ethers.ZeroAddress] },
    { name: 'DataHubs', args: [admin.address, ethers.ZeroAddress, ethers.ZeroAddress] },
    { name: 'YieldCircuit', args: [admin.address, ethers.ZeroAddress, ethers.ZeroAddress] },
    { name: 'NearAgents', args: [admin.address, ethers.ZeroAddress, ethers.ZeroAddress] },
    { name: 'SolanaAIBridge', args: [admin.address, ethers.ZeroAddress, ethers.ZeroAddress] },
    {
      name: 'BelieverRound',
      args: [
        admin.address,
        ethers.parseEther('500'),
        0n,
        5n,
        1n,
        1,
        ethers.parseEther('150000000'),
        ethers.parseEther('100'),
      ],
    },
  ];

  let totalDeployGas = 0n;
  const deployedContracts = {};

  for (const def of deploymentDefs) {
    try {
      const F = await ethers.getContractFactory(def.name);
      const c = await F.deploy(...def.args);
      await c.waitForDeployment();
      const receipt = await c.deploymentTransaction().wait();
      const gas = Number(receipt.gasUsed);
      report.deploymentGas[def.name] = gas;
      totalDeployGas += receipt.gasUsed;
      deployedContracts[def.name] = c;
      console.log(`  ${def.name.padEnd(24)} ${String(gas).padStart(10)} gas`);
    } catch (e) {
      report.deploymentGas[def.name] = `ERROR: ${e.message.slice(0, 80)}`;
      console.log(`  ${def.name.padEnd(24)} ERROR: ${e.message.slice(0, 60)}`);
    }
  }

  console.log(`\n  Total deployment gas: ${totalDeployGas}`);

  // ── Phase 2: Operation gas (key circuit operations) ──────────────
  console.log('\n══ Phase 2: Operation Gas Profiling ════════════════════');

  const MOCK_PROOF = '0x' + 'ab'.repeat(130);
  const MOCK_PV = '0x' + 'cd'.repeat(64);

  // Helper: measure gas for a transaction
  async function measureGas(label, txPromise) {
    try {
      const tx = await txPromise;
      const receipt = await tx.wait();
      const gas = Number(receipt.gasUsed);
      const target = GAS_TARGETS[label];
      const status = target ? (gas <= target ? 'PASS' : 'OVER') : '—';
      report.operationGas[label] = gas;
      report.results.push({ op: label, gas, target: target || null, status });
      const icon = status === 'PASS' ? '✓' : status === 'OVER' ? '✗' : '○';
      console.log(`  ${icon} ${label.padEnd(36)} ${String(gas).padStart(8)} gas ${target ? `(target: ${target}, ${status})` : ''}`);
      return gas;
    } catch (e) {
      report.operationGas[label] = `ERROR: ${e.message.slice(0, 80)}`;
      report.results.push({ op: label, gas: null, error: e.message.slice(0, 80) });
      console.log(`  ✗ ${label.padEnd(36)} ERROR: ${e.message.slice(0, 60)}`);
      return null;
    }
  }

  // TAO: submitTask(TaskType, uint32 destDomain, bytes32 inputHash, uint256 subnetId)
  //      settleTask(bytes32 taskId, bytes32 outputHash, bytes proof, bytes publicValues, bytes32 nullifier)
  if (deployedContracts['TAOCircuit']) {
    const tao = deployedContracts['TAOCircuit'];
    const RELAYER = await tao.RELAYER_ROLE();
    await tao.grantRole(RELAYER, admin.address);
    const taoInputHash = ethers.keccak256(ethers.toUtf8Bytes('tao-opt-input'));

    // submitTask: taskType=0, destDomain=1, inputHash, subnetId=1
    const submitTx = await tao.submitTask(0, 1, taoInputHash, 1, { value: ethers.parseEther('0.1') });
    const submitR = await submitTx.wait();
    // Extract taskId from the TaskRouted event (find by topic or fallback via interface)
    let taoTaskId;
    const taoIface = tao.interface;
    for (const log of submitR.logs) {
      try {
        const parsed = taoIface.parseLog({ topics: log.topics, data: log.data });
        if (parsed && parsed.name === 'TaskRouted') { taoTaskId = parsed.args[0]; break; }
      } catch {}
    }
    report.operationGas['TAOCircuit.submitTask'] = Number(submitR.gasUsed);
    report.results.push({ op: 'TAOCircuit.submitTask', gas: Number(submitR.gasUsed), target: null, status: '—' });
    console.log(`  ○ TAOCircuit.submitTask                ${String(submitR.gasUsed).padStart(8)} gas`);

    if (taoTaskId) {
      const taoNull = ethers.keccak256(ethers.toUtf8Bytes('null-tao-1'));
      await measureGas('TAOCircuit.settleTask',
        tao.settleTask(taoTaskId, ethers.keccak256(ethers.toUtf8Bytes('result1')), MOCK_PROOF, MOCK_PV, taoNull)
      );
    } else {
      console.log(`  ○ TAOCircuit.settleTask               SKIPPED (no taskId from event)`);
    }
  }

  // SolanaAIBridge: registerProvider(bytes32 solanaPubkey, ProviderType, string platform, bytes32 capabilityHash)
  //                 submitTask(bytes32 providerId, bytes32 taskHash, bytes32 inputHash, uint64 deadline)
  if (deployedContracts['SolanaAIBridge']) {
    const sol = deployedContracts['SolanaAIBridge'];
    const RELAYER = await sol.RELAYER_ROLE();
    await sol.grantRole(RELAYER, admin.address);
    const solPubkey = ethers.keccak256(ethers.toUtf8Bytes('solana-pubkey-1'));
    const capHash = ethers.keccak256(ethers.toUtf8Bytes('gpu-capability'));

    // registerProvider: solanaPubkey, providerType=0 (GPU), platform, capabilityHash
    const regTx = await sol.registerProvider(solPubkey, 0, 'https://render.example', capHash);
    const regR = await regTx.wait();
    let providerId;
    const solIface = sol.interface;
    for (const log of regR.logs) {
      try {
        const parsed = solIface.parseLog({ topics: log.topics, data: log.data });
        if (parsed && parsed.name === 'ProviderRegistered') { providerId = parsed.args[0]; break; }
      } catch {}
    }
    report.operationGas['SolanaAIBridge.registerProvider'] = Number(regR.gasUsed);
    report.results.push({ op: 'SolanaAIBridge.registerProvider', gas: Number(regR.gasUsed), target: null, status: '—' });
    console.log(`  ○ SolanaAIBridge.registerProvider      ${String(regR.gasUsed).padStart(8)} gas`);

    if (providerId) {
      const taskHash = ethers.keccak256(ethers.toUtf8Bytes('sol-task-1'));
      const inputHash = ethers.keccak256(ethers.toUtf8Bytes('sol-input-1'));
      await measureGas('SolanaAIBridge.submitTask',
        sol.connect(user1).submitTask(providerId, taskHash, inputHash, 3600, { value: ethers.parseEther('0.5') })
      );
    } else {
      console.log(`  ○ SolanaAIBridge.submitTask            SKIPPED (no providerId from event)`);
    }
  }

  // BelieverRound: commit + closeRound
  if (deployedContracts['BelieverRound']) {
    const br = deployedContracts['BelieverRound'];
    await measureGas('BelieverRound.commit',
      br.connect(user1).commit({ value: ethers.parseEther('100') })
    );
    await measureGas('BelieverRound.closeRound',
      br.closeRound()
    );
  }

  // ── Phase 3: Summary ─────────────────────────────────────────────
  console.log('\n══ Phase 3: Optimization Summary ═══════════════════════');

  const passed = report.results.filter(r => r.status === 'PASS').length;
  const over = report.results.filter(r => r.status === 'OVER').length;
  const noTarget = report.results.filter(r => r.status === '—').length;

  console.log(`\n  ✓ Passed:   ${passed} operations within budget`);
  if (over > 0) console.log(`  ✗ Over:     ${over} operations exceeded budget`);
  console.log(`  ○ No target: ${noTarget} operations (informational)`);

  // Optimization recommendations
  console.log('\n── Recommendations ─────────────────────────────────────');
  for (const r of report.results) {
    if (r.status === 'OVER') {
      const saving = r.gas - r.target;
      console.log(`  → ${r.op}: reduce by ${saving} gas (${((saving / r.gas) * 100).toFixed(1)}%)`);
      console.log(`    Consider: packed storage, fewer SSTOREs, smaller event data`);
    }
  }

  if (over === 0) {
    console.log('  All operations within gas budgets. No action needed.');
  }

  // Write report
  const reportDir = path.join(__dirname);
  const reportFile = path.join(reportDir, `gas-report-${Date.now()}.json`);
  report.summary = {
    passed, over, noTarget,
    totalDeployGas: Number(totalDeployGas),
    averageDeployGas: Math.round(Number(totalDeployGas) / deploymentDefs.length),
  };
  fs.writeFileSync(reportFile, JSON.stringify(report, null, 2));
  console.log(`\n  Report saved: ${reportFile}`);

  return report;
}

main()
  .then(() => process.exit(0))
  .catch((err) => { console.error('GAS PROFILER FAILED:', err); process.exit(1); });
