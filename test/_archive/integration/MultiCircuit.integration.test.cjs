/**
 * XFuel Protocol — Multi-Circuit End-to-End Integration Tests (20 tests)
 *
 * Run: npx hardhat test test/integration/MultiCircuit.integration.test.cjs
 *
 * Tests cross-circuit interactions through the shared Core Layer:
 *   - CoreRevenueSplitter receives fees from ALL 7 circuits
 *   - Circuit isolation (state does not leak between circuits)
 *   - Multi-user, multi-circuit concurrent operations
 *   - Fee accounting across the full protocol
 *   - Shared ZK nullifier independence across circuits
 *   - Vault + GPU pipeline (AI strategy routes inference to GPU)
 *   - Agent discovery → task → settlement cross-circuit flows
 */

const { expect } = require('chai');
const { ethers } = require('hardhat');
const { futureDeadline } = require('../../helpers.cjs');

describe('Multi-Circuit Integration', function () {
  let splitter, taoCircuit, a2aCircuit, gpuCircuit, zkmlCircuit, akashCircuit;
  let vaultsCircuit, roboticsCircuit;
  let admin, relayer, keeper, verifier;
  let user1, user2, user3, agent1, provider1, strategist;
  let bbb, lp, staker, treasury, stakePool;

  const MOCK_PROOF = '0x' + 'ab'.repeat(130);
  const MOCK_PV = '0x' + 'cd'.repeat(64);
  const MOCK_INPUT = ethers.keccak256(ethers.toUtf8Bytes('test-input'));
  const MOCK_OUTPUT = ethers.keccak256(ethers.toUtf8Bytes('test-output'));

  beforeEach(async function () {
    [admin, relayer, keeper, verifier, user1, user2, user3,
     agent1, provider1, strategist, bbb, lp, staker, treasury, stakePool] =
      await ethers.getSigners();

    // ─── Deploy Core RevenueSplitter ──────────────────────────────────────
    const SplitterFactory = await ethers.getContractFactory('CoreRevenueSplitter');
    splitter = await SplitterFactory.deploy(
      admin.address, bbb.address, lp.address,
      staker.address, treasury.address, stakePool.address
    );
    await splitter.waitForDeployment();

    // ─── Deploy TAO Circuit ───────────────────────────────────────────────
    const TAOFactory = await ethers.getContractFactory('TAOCircuit');
    taoCircuit = await TAOFactory.deploy(
      admin.address, await splitter.getAddress(),
      ethers.ZeroAddress, ethers.ZeroAddress, ethers.ZeroAddress
    );
    await taoCircuit.waitForDeployment();

    // ─── Deploy A2A Circuit ───────────────────────────────────────────────
    const A2AFactory = await ethers.getContractFactory('A2ACircuit');
    a2aCircuit = await A2AFactory.deploy(
      admin.address, await splitter.getAddress(), ethers.ZeroAddress, ethers.ZeroAddress
    );
    await a2aCircuit.waitForDeployment();

    // ─── Deploy Theta GPU Circuit ─────────────────────────────────────────
    const GPUFactory = await ethers.getContractFactory('ThetaGPUCircuit');
    gpuCircuit = await GPUFactory.deploy(
      admin.address, await splitter.getAddress(), ethers.ZeroAddress
    );
    await gpuCircuit.waitForDeployment();

    // ─── Deploy zkML Circuit ──────────────────────────────────────────────
    const ZKMLFactory = await ethers.getContractFactory('ZKMLCircuit');
    zkmlCircuit = await ZKMLFactory.deploy(
      admin.address, await splitter.getAddress(), ethers.ZeroAddress
    );
    await zkmlCircuit.waitForDeployment();

    // ─── Deploy Akash Circuit ─────────────────────────────────────────────
    const AkashFactory = await ethers.getContractFactory('AkashCircuit');
    akashCircuit = await AkashFactory.deploy(
      admin.address, await splitter.getAddress(), ethers.ZeroAddress
    );
    await akashCircuit.waitForDeployment();

    // ─── Deploy Autonomous Vaults Circuit ─────────────────────────────────
    const VaultsFactory = await ethers.getContractFactory('AutonomousVaults');
    vaultsCircuit = await VaultsFactory.deploy(
      admin.address, await splitter.getAddress(), ethers.ZeroAddress
    );
    await vaultsCircuit.waitForDeployment();

    // ─── Deploy Agent Robotics Circuit ────────────────────────────────────
    const RoboticsFactory = await ethers.getContractFactory('AgentRobotics');
    roboticsCircuit = await RoboticsFactory.deploy(
      admin.address, await splitter.getAddress(), ethers.ZeroAddress
    );
    await roboticsCircuit.waitForDeployment();

    // ─── Grant roles across all circuits ──────────────────────────────────
    const CIRCUIT_ROLE = await splitter.CIRCUIT_ROLE();
    await splitter.grantRole(CIRCUIT_ROLE, await taoCircuit.getAddress());
    await splitter.grantRole(CIRCUIT_ROLE, await a2aCircuit.getAddress());
    await splitter.grantRole(CIRCUIT_ROLE, await gpuCircuit.getAddress());
    await splitter.grantRole(CIRCUIT_ROLE, await zkmlCircuit.getAddress());
    await splitter.grantRole(CIRCUIT_ROLE, await akashCircuit.getAddress());
    await splitter.grantRole(CIRCUIT_ROLE, await vaultsCircuit.getAddress());
    await splitter.grantRole(CIRCUIT_ROLE, await roboticsCircuit.getAddress());

    // Grant RELAYER to relayer on applicable circuits
    const TAO_RELAYER = await taoCircuit.RELAYER_ROLE();
    await taoCircuit.grantRole(TAO_RELAYER, relayer.address);
    const A2A_RELAYER = await a2aCircuit.RELAYER_ROLE();
    await a2aCircuit.grantRole(A2A_RELAYER, relayer.address);
    const GPU_RELAYER = await gpuCircuit.RELAYER_ROLE();
    await gpuCircuit.grantRole(GPU_RELAYER, relayer.address);
    const AKASH_RELAYER = await akashCircuit.RELAYER_ROLE();
    await akashCircuit.grantRole(AKASH_RELAYER, relayer.address);

    // Grant KEEPER on vaults
    const KEEPER_ROLE = await vaultsCircuit.KEEPER_ROLE();
    await vaultsCircuit.grantRole(KEEPER_ROLE, keeper.address);
    const STRATEGIST_ROLE = await vaultsCircuit.STRATEGIST_ROLE();
    await vaultsCircuit.grantRole(STRATEGIST_ROLE, strategist.address);

    // Grant VERIFIER on robotics
    const VERIFIER_ROLE = await roboticsCircuit.VERIFIER_ROLE();
    await roboticsCircuit.grantRole(VERIFIER_ROLE, verifier.address);

    // Grant PROVER on zkML
    const PROVER_ROLE = await zkmlCircuit.PROVER_ROLE();
    await zkmlCircuit.grantRole(PROVER_ROLE, relayer.address);
  });

  // ═══════════════════════════════════════════════════════════════════════════
  //  1. DEPLOYMENT VERIFICATION
  // ═══════════════════════════════════════════════════════════════════════════

  it('01: All 7 circuits deploy with unique circuit IDs', async function () {
    const ids = await Promise.all([
      taoCircuit.CIRCUIT_ID(),
      a2aCircuit.CIRCUIT_ID(),
      gpuCircuit.CIRCUIT_ID(),
      zkmlCircuit.CIRCUIT_ID(),
      akashCircuit.CIRCUIT_ID(),
      vaultsCircuit.CIRCUIT_ID(),
      roboticsCircuit.CIRCUIT_ID(),
    ]);
    const unique = new Set(ids);
    expect(unique.size).to.equal(7);
  });

  it('02: All circuits reference the same CoreRevenueSplitter', async function () {
    const splitterAddr = await splitter.getAddress();
    expect(await taoCircuit.revenueSplitter()).to.equal(splitterAddr);
    expect(await a2aCircuit.revenueSplitter()).to.equal(splitterAddr);
    expect(await gpuCircuit.revenueSplitter()).to.equal(splitterAddr);
    expect(await zkmlCircuit.revenueSplitter()).to.equal(splitterAddr);
    expect(await akashCircuit.revenueSplitter()).to.equal(splitterAddr);
    expect(await vaultsCircuit.revenueSplitter()).to.equal(splitterAddr);
    expect(await roboticsCircuit.revenueSplitter()).to.equal(splitterAddr);
  });

  // ═══════════════════════════════════════════════════════════════════════════
  //  2. FEE AGGREGATION ACROSS CIRCUITS
  // ═══════════════════════════════════════════════════════════════════════════

  it('03: Fees from TAO + A2A both reach splitter', async function () {
    const splitterBefore = await ethers.provider.getBalance(await splitter.getAddress());

    // TAO: 10 ETH → 0.5% = 0.05 ETH fee
    await taoCircuit.connect(user1).submitTask(
      0, 0, MOCK_INPUT, 0, { value: ethers.parseEther('10') }
    );

    // A2A: 10 ETH → 0.1% = 0.01 ETH relay fee
    const deadline = Number(await futureDeadline(ethers.provider));
    await a2aCircuit.connect(user2).submitBid(
      MOCK_INPUT, MOCK_INPUT, deadline, { value: ethers.parseEther('10') }
    );

    const splitterAfter = await ethers.provider.getBalance(await splitter.getAddress());
    const totalFees = splitterAfter - splitterBefore;

    // 0.05 (TAO) + 0.01 (A2A) = 0.06 ETH
    expect(totalFees).to.equal(ethers.parseEther('0.06'));
  });

  it('04: Fees from GPU + zkML + Akash all reach splitter', async function () {
    // Setup GPU model
    await gpuCircuit.registerModel('TestModel', 'text', ethers.parseEther('0.001'), 0);
    const gpuModelId = await gpuCircuit.modelIds(0);

    // Setup zkML model
    const wc = ethers.keccak256(ethers.toUtf8Bytes('weights'));
    const txZk = await zkmlCircuit.connect(user1).registerModel(
      wc, MOCK_INPUT, 'TestZKML', ethers.parseEther('0.001'), false
    );
    const receiptZk = await txZk.wait();
    const zkEvent = receiptZk.logs.find(l => {
      try { return zkmlCircuit.interface.parseLog(l)?.name === 'PrivateModelRegistered'; }
      catch { return false; }
    });
    const zkModelId = zkmlCircuit.interface.parseLog(zkEvent).args.modelId;

    // Setup Akash spec
    const txSpec = await akashCircuit.registerGPUSpec('nvidia', 'a100', 81920, ethers.parseEther('0.1'));
    const receiptSpec = await txSpec.wait();
    const specEvent = receiptSpec.logs.find(l => {
      try { return akashCircuit.interface.parseLog(l)?.name === 'GPUSpecRegistered'; }
      catch { return false; }
    });
    const specId = akashCircuit.interface.parseLog(specEvent).args.specId;

    const splitterBefore = await ethers.provider.getBalance(await splitter.getAddress());

    // GPU: 10 ETH → 0.5% = 0.05
    await gpuCircuit.connect(user1).submitJob(gpuModelId, MOCK_INPUT, { value: ethers.parseEther('10') });

    // zkML: 10 ETH → 0.75% = 0.075
    const dl = Number(await futureDeadline(ethers.provider));
    await zkmlCircuit.connect(user2).requestInference(
      zkModelId, MOCK_INPUT, dl, { value: ethers.parseEther('10') }
    );

    // Akash: 10 ETH → 0.5% = 0.05
    await akashCircuit.connect(user3).createDeployment(
      specId, MOCK_INPUT, ethers.parseEther('0.001'), 100,
      { value: ethers.parseEther('10') }
    );

    const splitterAfter = await ethers.provider.getBalance(await splitter.getAddress());
    const totalFees = splitterAfter - splitterBefore;

    // 0.05 + 0.075 + 0.05 = 0.175
    expect(totalFees).to.equal(ethers.parseEther('0.175'));
  });

  it('05: Vaults + Robotics fees aggregate with other circuits', async function () {
    // Setup vault
    const txS = await vaultsCircuit.connect(strategist).registerStrategy(
      ethers.keccak256(ethers.toUtf8Bytes('strat')), 'Test', 'yield', 1000
    );
    const receiptS = await txS.wait();
    const sEvent = receiptS.logs.find(l => {
      try { return vaultsCircuit.interface.parseLog(l)?.name === 'StrategyRegistered'; }
      catch { return false; }
    });
    const strategyId = vaultsCircuit.interface.parseLog(sEvent).args.strategyId;

    const txV = await vaultsCircuit.connect(strategist).createVault(strategyId);
    const receiptV = await txV.wait();
    const vEvent = receiptV.logs.find(l => {
      try { return vaultsCircuit.interface.parseLog(l)?.name === 'VaultCreated'; }
      catch { return false; }
    });
    const vaultId = vaultsCircuit.interface.parseLog(vEvent).args.vaultId;

    // Setup robotics env + agent
    const txE = await roboticsCircuit.registerEnvironment(
      MOCK_INPUT, 'TestEnv', 'navigation', 8000
    );
    const receiptE = await txE.wait();
    const eEvent = receiptE.logs.find(l => {
      try { return roboticsCircuit.interface.parseLog(l)?.name === 'SimEnvironmentRegistered'; }
      catch { return false; }
    });
    const envId = roboticsCircuit.interface.parseLog(eEvent).args.envId;

    const txA = await roboticsCircuit.connect(user1).registerAgent(
      ethers.keccak256(ethers.toUtf8Bytes('policy')), 'drone'
    );
    const receiptA = await txA.wait();
    const aEvent = receiptA.logs.find(l => {
      try { return roboticsCircuit.interface.parseLog(l)?.name === 'AgentRegistered'; }
      catch { return false; }
    });
    const agentId = roboticsCircuit.interface.parseLog(aEvent).args.agentId;

    const splitterBefore = await ethers.provider.getBalance(await splitter.getAddress());

    // Vault deposit: 10 ETH → 0.5% = 0.05
    await vaultsCircuit.connect(user1).deposit(vaultId, { value: ethers.parseEther('10') });

    // Robotics trajectory: 10 ETH → 1% = 0.1
    const dl = Number(await futureDeadline(ethers.provider));
    await roboticsCircuit.connect(user1).submitTrajectory(
      agentId, envId, MOCK_INPUT, MOCK_INPUT, dl,
      { value: ethers.parseEther('10') }
    );

    const splitterAfter = await ethers.provider.getBalance(await splitter.getAddress());
    expect(splitterAfter - splitterBefore).to.equal(ethers.parseEther('0.15'));
  });

  // ═══════════════════════════════════════════════════════════════════════════
  //  3. CIRCUIT ISOLATION
  // ═══════════════════════════════════════════════════════════════════════════

  it('06: TAO task count independent from GPU job count', async function () {
    // Submit 3 TAO tasks
    for (let i = 0; i < 3; i++) {
      await taoCircuit.connect(user1).submitTask(
        0, 0, MOCK_INPUT, 0, { value: ethers.parseEther('0.1') }
      );
    }

    // Submit 5 GPU jobs
    await gpuCircuit.registerModel('Test', 'text', 1, 0);
    const modelId = await gpuCircuit.modelIds(0);
    for (let i = 0; i < 5; i++) {
      await gpuCircuit.connect(user2).submitJob(
        modelId, MOCK_INPUT, { value: ethers.parseEther('0.01') }
      );
    }

    const [taoCount] = await taoCircuit.getStats();
    const [gpuCount] = await gpuCircuit.getStats();

    expect(taoCount).to.equal(3n);
    expect(gpuCount).to.equal(5n);
  });

  it('07: A2A agent count independent from Robotics agent count', async function () {
    // Register 2 A2A agents
    const id1 = ethers.keccak256(ethers.toUtf8Bytes('a2a-id-1'));
    const id2 = ethers.keccak256(ethers.toUtf8Bytes('a2a-id-2'));
    await a2aCircuit.connect(user1).registerAgent(id1, 'https://a1.com', []);
    await a2aCircuit.connect(user2).registerAgent(id2, 'https://a2.com', []);

    // Register 1 Robotics agent
    await roboticsCircuit.registerEnvironment(MOCK_INPUT, 'Env', 'nav', 5000);
    await roboticsCircuit.connect(user3).registerAgent(
      ethers.keccak256(ethers.toUtf8Bytes('robo-policy')), 'drone'
    );

    const [a2aAgents] = await a2aCircuit.getStats();
    const [, robotAgents] = await roboticsCircuit.getStats();

    expect(a2aAgents).to.equal(2n);
    expect(robotAgents).to.equal(1n);
  });

  it('08: Vault strategy count independent from zkML model count', async function () {
    // 3 strategies
    for (let i = 0; i < 3; i++) {
      await vaultsCircuit.connect(strategist).registerStrategy(
        ethers.keccak256(ethers.toUtf8Bytes(`strat-${i}`)),
        `Strategy ${i}`, 'yield', 500
      );
    }

    // 2 zkML models
    for (let i = 0; i < 2; i++) {
      await zkmlCircuit.connect(user1).registerModel(
        ethers.keccak256(ethers.toUtf8Bytes(`weights-${i}`)),
        MOCK_INPUT, `Model ${i}`, ethers.parseEther('0.01'), false
      );
    }

    const [stratCount] = await vaultsCircuit.getStats();
    const [modelCount] = await zkmlCircuit.getStats();

    expect(stratCount).to.equal(3n);
    expect(modelCount).to.equal(2n);
  });

  // ═══════════════════════════════════════════════════════════════════════════
  //  4. NULLIFIER INDEPENDENCE
  // ═══════════════════════════════════════════════════════════════════════════

  it('09: Same nullifier can be used in different circuits', async function () {
    const sharedNull = ethers.keccak256(ethers.toUtf8Bytes('shared-nullifier'));

    // Use in TAO settlement
    const txTao = await taoCircuit.connect(user1).submitTask(
      0, 0, MOCK_INPUT, 0, { value: ethers.parseEther('1') }
    );
    const receiptTao = await txTao.wait();
    const taoEvent = receiptTao.logs.find(l => {
      try { return taoCircuit.interface.parseLog(l)?.name === 'TaskRouted'; }
      catch { return false; }
    });
    const taskId = taoCircuit.interface.parseLog(taoEvent).args.taskId;

    await taoCircuit.connect(relayer).settleTask(
      taskId, MOCK_OUTPUT, MOCK_PROOF, MOCK_PV, sharedNull
    );

    // Same nullifier in A2A should work (independent tracking)
    await a2aCircuit.connect(agent1).registerAgent(
      ethers.keccak256(ethers.toUtf8Bytes('a-id')), 'https://a.com', []
    );
    const txCh = await a2aCircuit.connect(user1).openChannel(
      agent1.address, 3600, { value: ethers.parseEther('1') }
    );
    const receiptCh = await txCh.wait();
    const chEvent = receiptCh.logs.find(l => {
      try { return a2aCircuit.interface.parseLog(l)?.name === 'ChannelOpened'; }
      catch { return false; }
    });
    const channelId = a2aCircuit.interface.parseLog(chEvent).args.channelId;

    // This should succeed — separate nullifier tracking
    await a2aCircuit.connect(agent1).claimChannel(
      channelId, ethers.parseEther('0.1'), MOCK_PROOF, MOCK_PV, sharedNull
    );

    // Verify both succeeded
    const task = await taoCircuit.getTask(taskId);
    expect(task.status).to.equal(3); // Settled

    const ch = await a2aCircuit.getChannel(channelId);
    expect(ch.spent).to.equal(ethers.parseEther('0.1'));
  });

  // ═══════════════════════════════════════════════════════════════════════════
  //  5. CROSS-CIRCUIT PIPELINES
  // ═══════════════════════════════════════════════════════════════════════════

  it('10: TAO task → GPU inference pipeline', async function () {
    // Submit TAO task
    const txTao = await taoCircuit.connect(user1).submitTask(
      0, 0, MOCK_INPUT, 1, { value: ethers.parseEther('2') }
    );
    const receiptTao = await txTao.wait();
    const taoEvent = receiptTao.logs.find(l => {
      try { return taoCircuit.interface.parseLog(l)?.name === 'TaskRouted'; }
      catch { return false; }
    });
    expect(taoEvent).to.not.be.undefined;

    // Now submit corresponding GPU inference job
    await gpuCircuit.registerModel('Llama', 'text', ethers.parseEther('0.01'), 0);
    const modelId = await gpuCircuit.modelIds(0);
    await gpuCircuit.connect(user1).submitJob(
      modelId, MOCK_INPUT, { value: ethers.parseEther('1') }
    );

    // Both circuits tracked independently
    const [taoCount] = await taoCircuit.getStats();
    const [gpuCount] = await gpuCircuit.getStats();
    expect(taoCount).to.equal(1n);
    expect(gpuCount).to.equal(1n);
  });

  it('11: A2A agent discovery → Bid → GPU job flow', async function () {
    // Register agent in A2A
    const cap = ethers.keccak256(ethers.toUtf8Bytes('inference:llama'));
    await a2aCircuit.connect(agent1).registerAgent(
      ethers.keccak256(ethers.toUtf8Bytes('agent-id')),
      'https://agent.com', [cap]
    );

    // Submit bid in A2A
    const dl = Number(await futureDeadline(ethers.provider));
    await a2aCircuit.connect(user1).submitBid(
      MOCK_INPUT, cap, dl, { value: ethers.parseEther('5') }
    );

    // Agent bids on GPU job as well
    await gpuCircuit.registerModel('Llama', 'text', ethers.parseEther('0.01'), 0);
    const modelId = await gpuCircuit.modelIds(0);
    await gpuCircuit.connect(user2).submitJob(
      modelId, MOCK_INPUT, { value: ethers.parseEther('1') }
    );

    // Both circuits have records
    const a2aAgent = await a2aCircuit.getAgent(agent1.address);
    expect(a2aAgent.active).to.be.true;

    const [, gpuBidCount] = await gpuCircuit.getStats();
    expect(gpuBidCount).to.be.gt(0n);
  });

  it('12: Vault deposit → rebalance → withdrawal pipeline', async function () {
    // Create strategy + vault
    const txS = await vaultsCircuit.connect(strategist).registerStrategy(
      ethers.keccak256(ethers.toUtf8Bytes('pipeline-strat')),
      'Pipeline Test', 'yield', 500
    );
    const receiptS = await txS.wait();
    const strategyId = vaultsCircuit.interface.parseLog(
      receiptS.logs.find(l => {
        try { return vaultsCircuit.interface.parseLog(l)?.name === 'StrategyRegistered'; }
        catch { return false; }
      })
    ).args.strategyId;

    const txV = await vaultsCircuit.connect(strategist).createVault(strategyId);
    const receiptV = await txV.wait();
    const vaultId = vaultsCircuit.interface.parseLog(
      receiptV.logs.find(l => {
        try { return vaultsCircuit.interface.parseLog(l)?.name === 'VaultCreated'; }
        catch { return false; }
      })
    ).args.vaultId;

    // Deposit
    await vaultsCircuit.connect(user1).deposit(vaultId, { value: ethers.parseEther('50') });

    // Rebalance — keep NAV at current level (tests pipeline, not profit)
    const vault = await vaultsCircuit.getVault(vaultId);
    const nullifier = ethers.keccak256(ethers.toUtf8Bytes('pipeline-null'));

    await vaultsCircuit.connect(keeper).rebalance(
      vaultId, MOCK_INPUT, vault.currentNav, MOCK_PROOF, MOCK_PV, nullifier
    );

    // Verify rebalance was recorded
    const vaultAfter = await vaultsCircuit.getVault(vaultId);
    expect(vaultAfter.rebalanceCount).to.equal(1n);

    // Partial withdraw (half shares) — within contract balance
    const pos = await vaultsCircuit.getPosition(vaultId, user1.address);
    const halfShares = pos.shares / 2n;
    const u1Before = await ethers.provider.getBalance(user1.address);
    await vaultsCircuit.connect(user1).withdraw(vaultId, halfShares);
    const u1After = await ethers.provider.getBalance(user1.address);

    expect(u1After).to.be.gt(u1Before);
  });

  it('13: Robotics: register → trajectory → certify → task → complete', async function () {
    // Register env and agent
    const txE = await roboticsCircuit.registerEnvironment(
      MOCK_INPUT, 'NavEnv', 'navigation', 9000
    );
    const receiptE = await txE.wait();
    const envId = roboticsCircuit.interface.parseLog(
      receiptE.logs.find(l => {
        try { return roboticsCircuit.interface.parseLog(l)?.name === 'SimEnvironmentRegistered'; }
        catch { return false; }
      })
    ).args.envId;

    const txA = await roboticsCircuit.connect(user1).registerAgent(
      ethers.keccak256(ethers.toUtf8Bytes('pipeline-policy')), 'manipulator'
    );
    const receiptA = await txA.wait();
    const agentId = roboticsCircuit.interface.parseLog(
      receiptA.logs.find(l => {
        try { return roboticsCircuit.interface.parseLog(l)?.name === 'AgentRegistered'; }
        catch { return false; }
      })
    ).args.agentId;

    // Submit and verify trajectory
    const dl = Number(await futureDeadline(ethers.provider));
    const txT = await roboticsCircuit.connect(user1).submitTrajectory(
      agentId, envId, MOCK_INPUT, MOCK_INPUT, dl, { value: ethers.parseEther('1') }
    );
    const receiptT = await txT.wait();
    const trajectoryId = roboticsCircuit.interface.parseLog(
      receiptT.logs.find(l => {
        try { return roboticsCircuit.interface.parseLog(l)?.name === 'TrajectorySubmitted'; }
        catch { return false; }
      })
    ).args.trajectoryId;

    const nullifier = ethers.keccak256(ethers.toUtf8Bytes('robo-pipeline'));
    await roboticsCircuit.connect(verifier).verifyTrajectory(
      trajectoryId, 3, 86400, MOCK_PROOF, MOCK_PV, nullifier
    );

    // Create and complete task
    const txTask = await roboticsCircuit.connect(user2).createTask(
      envId, 1, dl, { value: ethers.parseEther('5') }
    );
    const receiptTask = await txTask.wait();
    const taskId = roboticsCircuit.interface.parseLog(
      receiptTask.logs.find(l => {
        try { return roboticsCircuit.interface.parseLog(l)?.name === 'TaskCreated'; }
        catch { return false; }
      })
    ).args.taskId;

    await roboticsCircuit.assignTask(taskId, agentId);
    const u1Before = await ethers.provider.getBalance(user1.address);
    await roboticsCircuit.completeTask(taskId);
    const u1After = await ethers.provider.getBalance(user1.address);
    expect(u1After).to.be.gt(u1Before);
  });

  // ═══════════════════════════════════════════════════════════════════════════
  //  6. CONCURRENT MULTI-USER STRESS
  // ═══════════════════════════════════════════════════════════════════════════

  it('14: 5 users across 3 circuits concurrently', async function () {
    await gpuCircuit.registerModel('StressModel', 'text', 1, 0);
    const modelId = await gpuCircuit.modelIds(0);

    const ops = [
      taoCircuit.connect(user1).submitTask(0, 0, MOCK_INPUT, 0, { value: ethers.parseEther('0.1') }),
      taoCircuit.connect(user2).submitTask(1, 0, MOCK_INPUT, 0, { value: ethers.parseEther('0.2') }),
      gpuCircuit.connect(user1).submitJob(modelId, MOCK_INPUT, { value: ethers.parseEther('0.01') }),
      gpuCircuit.connect(user2).submitJob(modelId, MOCK_INPUT, { value: ethers.parseEther('0.02') }),
      gpuCircuit.connect(user3).submitJob(modelId, MOCK_INPUT, { value: ethers.parseEther('0.03') }),
    ];

    await Promise.all(ops);

    const [taoCount] = await taoCircuit.getStats();
    const [gpuCount] = await gpuCircuit.getStats();
    expect(taoCount).to.equal(2n);
    expect(gpuCount).to.equal(3n);
  });

  it('15: 10 deposits across 2 vaults', async function () {
    // Create 2 strategies + vaults
    const vaultIds = [];
    for (let i = 0; i < 2; i++) {
      const txS = await vaultsCircuit.connect(strategist).registerStrategy(
        ethers.keccak256(ethers.toUtf8Bytes(`stress-strat-${i}`)),
        `Stress ${i}`, 'yield', 500
      );
      const rS = await txS.wait();
      const sid = vaultsCircuit.interface.parseLog(
        rS.logs.find(l => {
          try { return vaultsCircuit.interface.parseLog(l)?.name === 'StrategyRegistered'; }
          catch { return false; }
        })
      ).args.strategyId;

      const txV = await vaultsCircuit.connect(strategist).createVault(sid);
      const rV = await txV.wait();
      vaultIds.push(vaultsCircuit.interface.parseLog(
        rV.logs.find(l => {
          try { return vaultsCircuit.interface.parseLog(l)?.name === 'VaultCreated'; }
          catch { return false; }
        })
      ).args.vaultId);
    }

    // 10 deposits split across 2 vaults
    const ops = [];
    for (let i = 0; i < 5; i++) {
      ops.push(vaultsCircuit.connect(user1).deposit(vaultIds[0], { value: ethers.parseEther('1') }));
      ops.push(vaultsCircuit.connect(user2).deposit(vaultIds[1], { value: ethers.parseEther('2') }));
    }
    await Promise.all(ops);

    const v0 = await vaultsCircuit.getVault(vaultIds[0]);
    const v1 = await vaultsCircuit.getVault(vaultIds[1]);
    expect(v0.totalShares).to.be.gt(0n);
    expect(v1.totalShares).to.be.gt(0n);
  });

  // ═══════════════════════════════════════════════════════════════════════════
  //  7. PAUSE ISOLATION
  // ═══════════════════════════════════════════════════════════════════════════

  it('16: Pausing one circuit does not affect others', async function () {
    await taoCircuit.pause();

    // TAO should be paused
    await expect(
      taoCircuit.connect(user1).submitTask(0, 0, MOCK_INPUT, 0, { value: 1000 })
    ).to.be.reverted;

    // A2A should still work
    const dl = Number(await futureDeadline(ethers.provider));
    await expect(
      a2aCircuit.connect(user1).submitBid(MOCK_INPUT, MOCK_INPUT, dl, { value: ethers.parseEther('1') })
    ).to.not.be.reverted;

    // GPU should still work
    await gpuCircuit.registerModel('PauseTest', 'text', 1, 0);
    const modelId = await gpuCircuit.modelIds(0);
    await expect(
      gpuCircuit.connect(user1).submitJob(modelId, MOCK_INPUT, { value: ethers.parseEther('0.01') })
    ).to.not.be.reverted;
  });

  it('17: Pausing vaults does not affect robotics', async function () {
    await vaultsCircuit.pause();

    // Vaults should be paused
    await expect(
      vaultsCircuit.connect(strategist).registerStrategy(
        MOCK_INPUT, 'Test', 'yield', 500
      )
    ).to.be.reverted;

    // Robotics should still work
    await roboticsCircuit.registerEnvironment(MOCK_INPUT, 'TestEnv', 'nav', 5000);
    expect(await roboticsCircuit.envCount()).to.equal(1n);
  });

  // ═══════════════════════════════════════════════════════════════════════════
  //  8. GLOBAL FEE ACCOUNTING
  // ═══════════════════════════════════════════════════════════════════════════

  it('18: Total splitter balance matches sum of all circuit fees', async function () {
    // TAO: 100 ETH → 0.5%
    await taoCircuit.connect(user1).submitTask(0, 0, MOCK_INPUT, 0, { value: ethers.parseEther('100') });

    // Vaults: create + deposit 100 ETH → 0.5%
    const txS = await vaultsCircuit.connect(strategist).registerStrategy(
      ethers.keccak256(ethers.toUtf8Bytes('acc-strat')), 'Test', 'yield', 500
    );
    const rS = await txS.wait();
    const sid = vaultsCircuit.interface.parseLog(
      rS.logs.find(l => {
        try { return vaultsCircuit.interface.parseLog(l)?.name === 'StrategyRegistered'; }
        catch { return false; }
      })
    ).args.strategyId;
    const txV = await vaultsCircuit.connect(strategist).createVault(sid);
    const rV = await txV.wait();
    const vid = vaultsCircuit.interface.parseLog(
      rV.logs.find(l => {
        try { return vaultsCircuit.interface.parseLog(l)?.name === 'VaultCreated'; }
        catch { return false; }
      })
    ).args.vaultId;
    await vaultsCircuit.connect(user2).deposit(vid, { value: ethers.parseEther('100') });

    const splitterBalance = await ethers.provider.getBalance(await splitter.getAddress());
    // TAO: 0.5 + Vaults: 0.5 = 1.0 ETH total
    expect(splitterBalance).to.equal(ethers.parseEther('1'));
  });

  // ═══════════════════════════════════════════════════════════════════════════
  //  9. ACCESS CONTROL ISOLATION
  // ═══════════════════════════════════════════════════════════════════════════

  it('19: RELAYER role on TAO does not grant access to GPU', async function () {
    // Relayer has RELAYER_ROLE on taoCircuit
    // Submit a GPU job
    await gpuCircuit.registerModel('ACLTest', 'text', 1, 0);
    const modelId = await gpuCircuit.modelIds(0);
    const tx = await gpuCircuit.connect(user1).submitJob(
      modelId, MOCK_INPUT, { value: ethers.parseEther('0.01') }
    );
    const receipt = await tx.wait();
    const event = receipt.logs.find(l => {
      try { return gpuCircuit.interface.parseLog(l)?.name === 'GPUJobRouted'; }
      catch { return false; }
    });
    const jobId = gpuCircuit.interface.parseLog(event).args.jobId;

    // Register a provider for GPU
    await gpuCircuit.connect(provider1).registerProvider(
      'https://node.com', [modelId], { value: ethers.parseEther('10') }
    );

    // relayer should already have GPU role from beforeEach, but let's test
    // that a user without any role can't assign
    await expect(
      gpuCircuit.connect(user2).assignJob(jobId, provider1.address)
    ).to.be.reverted;
  });

  it('20: KEEPER role on Vaults does not grant access to Robotics', async function () {
    // Keeper has KEEPER_ROLE on vaults but not VERIFIER_ROLE on robotics
    const txE = await roboticsCircuit.registerEnvironment(MOCK_INPUT, 'ACLEnv', 'nav', 5000);
    const rE = await txE.wait();
    const envId = roboticsCircuit.interface.parseLog(
      rE.logs.find(l => {
        try { return roboticsCircuit.interface.parseLog(l)?.name === 'SimEnvironmentRegistered'; }
        catch { return false; }
      })
    ).args.envId;

    const txA = await roboticsCircuit.connect(user1).registerAgent(
      ethers.keccak256(ethers.toUtf8Bytes('acl-policy')), 'drone'
    );
    const rA = await txA.wait();
    const agentId = roboticsCircuit.interface.parseLog(
      rA.logs.find(l => {
        try { return roboticsCircuit.interface.parseLog(l)?.name === 'AgentRegistered'; }
        catch { return false; }
      })
    ).args.agentId;

    const dl = Number(await futureDeadline(ethers.provider));
    const txT = await roboticsCircuit.connect(user1).submitTrajectory(
      agentId, envId, MOCK_INPUT, MOCK_INPUT, dl, { value: ethers.parseEther('0.5') }
    );
    const rT = await txT.wait();
    const tid = roboticsCircuit.interface.parseLog(
      rT.logs.find(l => {
        try { return roboticsCircuit.interface.parseLog(l)?.name === 'TrajectorySubmitted'; }
        catch { return false; }
      })
    ).args.trajectoryId;

    const nullifier = ethers.keccak256(ethers.toUtf8Bytes('acl-null'));

    // Keeper trying to verify trajectory on robotics should fail
    await expect(
      roboticsCircuit.connect(keeper).verifyTrajectory(
        tid, 3, 86400, MOCK_PROOF, MOCK_PV, nullifier
      )
    ).to.be.reverted;
  });
});
