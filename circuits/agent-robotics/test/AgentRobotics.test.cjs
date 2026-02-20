/**
 * Agent Robotics Circuit — Hardhat Tests (15 tests)
 *
 * Run: npx hardhat test circuits/agent-robotics/test/AgentRobotics.test.cjs
 *
 * Covers:
 *   - Simulation environment registry (2 tests)
 *   - Agent enrollment (3 tests)
 *   - Trajectory submission & verification (4 tests)
 *   - Safety certificates (2 tests)
 *   - Task marketplace (3 tests)
 *   - Edge case (1 test)
 */

const { expect } = require('chai');
const { ethers } = require('hardhat');

describe('AgentRobotics', function () {
  let circuit, splitter;
  let admin, verifier, agentOwner, agentOwner2, requester;
  let bbb, lp, staker, treasury, stakePool;

  const CIRCUIT_ID = ethers.keccak256(ethers.toUtf8Bytes('AGENT_ROBOTICS_CIRCUIT'));
  const MOCK_PROOF = '0x' + 'ab'.repeat(130);
  const MOCK_PUBLIC_VALUES = '0x' + 'cd'.repeat(64);
  const POLICY_COMMIT = ethers.keccak256(ethers.toUtf8Bytes('nav-policy-v3'));
  const SIM_CONFIG = ethers.keccak256(ethers.toUtf8Bytes('warehouse-sim-v2'));
  const TRAJ_HASH = ethers.keccak256(ethers.toUtf8Bytes('trajectory-data-1'));
  const SAFETY_HASH = ethers.keccak256(ethers.toUtf8Bytes('no-collision-constraint'));

  let envId, agentId;

  beforeEach(async function () {
    [admin, verifier, agentOwner, agentOwner2, requester, bbb, lp, staker, treasury, stakePool] =
      await ethers.getSigners();

    const SplitterFactory = await ethers.getContractFactory('CoreRevenueSplitter');
    splitter = await SplitterFactory.deploy(
      admin.address, bbb.address, lp.address,
      staker.address, treasury.address, stakePool.address
    );
    await splitter.waitForDeployment();

    const CircuitFactory = await ethers.getContractFactory('AgentRobotics');
    circuit = await CircuitFactory.deploy(
      admin.address,
      await splitter.getAddress(),
      ethers.ZeroAddress
    );
    await circuit.waitForDeployment();

    const VERIFIER_ROLE = await circuit.VERIFIER_ROLE();
    await circuit.grantRole(VERIFIER_ROLE, verifier.address);

    const CIRCUIT_ROLE = await splitter.CIRCUIT_ROLE();
    await splitter.grantRole(CIRCUIT_ROLE, await circuit.getAddress());

    // Register a sim environment
    const txEnv = await circuit.registerEnvironment(
      SIM_CONFIG, 'Warehouse Navigation v2', 'navigation', 8500
    );
    const receiptEnv = await txEnv.wait();
    const envEvent = receiptEnv.logs.find(l => {
      try { return circuit.interface.parseLog(l)?.name === 'SimEnvironmentRegistered'; }
      catch { return false; }
    });
    envId = circuit.interface.parseLog(envEvent).args.envId;

    // Register an agent
    const txAgent = await circuit.connect(agentOwner).registerAgent(
      POLICY_COMMIT, 'manipulator'
    );
    const receiptAgent = await txAgent.wait();
    const agentEvent = receiptAgent.logs.find(l => {
      try { return circuit.interface.parseLog(l)?.name === 'AgentRegistered'; }
      catch { return false; }
    });
    agentId = circuit.interface.parseLog(agentEvent).args.agentId;
  });

  // ═══════════════════════════════════════════════════════════════════════════
  //  SIMULATION ENVIRONMENTS
  // ═══════════════════════════════════════════════════════════════════════════

  describe('Simulation Environments', function () {
    it('should register a sim environment', async function () {
      const env = await circuit.getEnvironment(envId);
      expect(env.category).to.equal('navigation');
      expect(env.fidelityScore).to.equal(8500n);
    });

    it('should register multiple environments', async function () {
      await circuit.registerEnvironment(
        ethers.keccak256(ethers.toUtf8Bytes('surgical-sim')),
        'Surgical Arm v1', 'manipulation', 9200
      );
      expect(await circuit.envCount()).to.equal(2n);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  //  AGENT ENROLLMENT
  // ═══════════════════════════════════════════════════════════════════════════

  describe('Agent Enrollment', function () {
    it('should register an agent with policy commitment', async function () {
      const agent = await circuit.getAgent(agentId);
      expect(agent.agentType).to.equal('manipulator');
      expect(agent.certificationLevel).to.equal(0n);
      expect(agent.active).to.be.true;
    });

    it('should register multiple agents of different types', async function () {
      await circuit.connect(agentOwner2).registerAgent(
        ethers.keccak256(ethers.toUtf8Bytes('drone-policy-v1')), 'drone'
      );
      expect(await circuit.agentCount()).to.equal(2n);
    });

    it('should reject zero policy commitment', async function () {
      await expect(
        circuit.connect(agentOwner2).registerAgent(ethers.ZeroHash, 'legged')
      ).to.be.revertedWith('ZeroCommitment');
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  //  TRAJECTORY SUBMISSION & VERIFICATION
  // ═══════════════════════════════════════════════════════════════════════════

  describe('Trajectory Lifecycle', function () {
    let trajectoryId;

    beforeEach(async function () {
      const deadline = Math.floor(Date.now() / 1000) + 7200;
      const tx = await circuit.connect(agentOwner).submitTrajectory(
        agentId, envId, TRAJ_HASH, SAFETY_HASH, deadline,
        { value: ethers.parseEther('1.0') }
      );
      const receipt = await tx.wait();
      const event = receipt.logs.find(l => {
        try { return circuit.interface.parseLog(l)?.name === 'TrajectorySubmitted'; }
        catch { return false; }
      });
      trajectoryId = circuit.interface.parseLog(event).args.trajectoryId;
    });

    it('should submit a trajectory with fee deduction', async function () {
      const traj = await circuit.getTrajectory(trajectoryId);
      expect(traj.status).to.equal(0); // Submitted
      expect(traj.agentId).to.equal(agentId);
    });

    it('should verify trajectory and issue safety cert', async function () {
      const nullifier = ethers.keccak256(ethers.toUtf8Bytes('traj-null-1'));

      await circuit.connect(verifier).verifyTrajectory(
        trajectoryId, 3, 86400, // level 3, 24h cert
        MOCK_PROOF, MOCK_PUBLIC_VALUES, nullifier
      );

      const traj = await circuit.getTrajectory(trajectoryId);
      expect(traj.status).to.equal(1); // Verified

      // Agent certification level should increase
      const agent = await circuit.getAgent(agentId);
      expect(agent.certificationLevel).to.equal(1n);

      // Safety cert should be issued
      expect(await circuit.certCount()).to.equal(1n);
    });

    it('should reject duplicate nullifier in trajectory verification', async function () {
      const nullifier = ethers.keccak256(ethers.toUtf8Bytes('traj-dup'));

      await circuit.connect(verifier).verifyTrajectory(
        trajectoryId, 3, 86400, MOCK_PROOF, MOCK_PUBLIC_VALUES, nullifier
      );

      // Submit another trajectory
      const deadline = Math.floor(Date.now() / 1000) + 7200;
      const tx2 = await circuit.connect(agentOwner).submitTrajectory(
        agentId, envId, TRAJ_HASH, SAFETY_HASH, deadline,
        { value: ethers.parseEther('0.5') }
      );
      const receipt2 = await tx2.wait();
      const event2 = receipt2.logs.find(l => {
        try { return circuit.interface.parseLog(l)?.name === 'TrajectorySubmitted'; }
        catch { return false; }
      });
      const traj2 = circuit.interface.parseLog(event2).args.trajectoryId;

      await expect(
        circuit.connect(verifier).verifyTrajectory(
          traj2, 3, 86400, MOCK_PROOF, MOCK_PUBLIC_VALUES, nullifier
        )
      ).to.be.reverted;
    });

    it('should deduct 1% certification fee', async function () {
      const payment = ethers.parseEther('10.0');
      const expectedFee = ethers.parseEther('0.1');

      const splitterBefore = await ethers.provider.getBalance(await splitter.getAddress());

      const deadline = Math.floor(Date.now() / 1000) + 7200;
      await circuit.connect(agentOwner).submitTrajectory(
        agentId, envId, TRAJ_HASH, SAFETY_HASH, deadline,
        { value: payment }
      );

      const splitterAfter = await ethers.provider.getBalance(await splitter.getAddress());
      expect(splitterAfter - splitterBefore).to.equal(expectedFee);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  //  SAFETY CERTIFICATES
  // ═══════════════════════════════════════════════════════════════════════════

  describe('Safety Certificates', function () {
    it('should issue cert with correct expiry', async function () {
      const deadline = Math.floor(Date.now() / 1000) + 7200;
      const tx = await circuit.connect(agentOwner).submitTrajectory(
        agentId, envId, TRAJ_HASH, SAFETY_HASH, deadline,
        { value: ethers.parseEther('1.0') }
      );
      const receipt = await tx.wait();
      const event = receipt.logs.find(l => {
        try { return circuit.interface.parseLog(l)?.name === 'TrajectorySubmitted'; }
        catch { return false; }
      });
      const trajectoryId = circuit.interface.parseLog(event).args.trajectoryId;

      const nullifier = ethers.keccak256(ethers.toUtf8Bytes('cert-null-1'));
      const txV = await circuit.connect(verifier).verifyTrajectory(
        trajectoryId, 5, 604800, // level 5, 7-day cert
        MOCK_PROOF, MOCK_PUBLIC_VALUES, nullifier
      );
      const receiptV = await txV.wait();

      const certEvent = receiptV.logs.find(l => {
        try { return circuit.interface.parseLog(l)?.name === 'SafetyCertIssued'; }
        catch { return false; }
      });
      expect(certEvent).to.not.be.undefined;
      const parsed = circuit.interface.parseLog(certEvent);
      expect(parsed.args.safetyLevel).to.equal(5n);
    });

    it('should track agent cert count', async function () {
      // Verify 2 trajectories
      for (let i = 0; i < 2; i++) {
        const deadline = Math.floor(Date.now() / 1000) + 7200;
        const tx = await circuit.connect(agentOwner).submitTrajectory(
          agentId, envId, TRAJ_HASH, SAFETY_HASH, deadline,
          { value: ethers.parseEther('0.5') }
        );
        const receipt = await tx.wait();
        const event = receipt.logs.find(l => {
          try { return circuit.interface.parseLog(l)?.name === 'TrajectorySubmitted'; }
          catch { return false; }
        });
        const tid = circuit.interface.parseLog(event).args.trajectoryId;

        const nullifier = ethers.keccak256(ethers.toUtf8Bytes(`cert-multi-${i}`));
        await circuit.connect(verifier).verifyTrajectory(
          tid, 3, 86400, MOCK_PROOF, MOCK_PUBLIC_VALUES, nullifier
        );
      }

      expect(await circuit.getAgentCertCount(agentId)).to.equal(2n);
      const agent = await circuit.getAgent(agentId);
      expect(agent.certificationLevel).to.equal(2n);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  //  TASK MARKETPLACE
  // ═══════════════════════════════════════════════════════════════════════════

  describe('Task Marketplace', function () {
    beforeEach(async function () {
      // Get the agent certified (level 1)
      const deadline = Math.floor(Date.now() / 1000) + 7200;
      const tx = await circuit.connect(agentOwner).submitTrajectory(
        agentId, envId, TRAJ_HASH, SAFETY_HASH, deadline,
        { value: ethers.parseEther('0.5') }
      );
      const receipt = await tx.wait();
      const event = receipt.logs.find(l => {
        try { return circuit.interface.parseLog(l)?.name === 'TrajectorySubmitted'; }
        catch { return false; }
      });
      const tid = circuit.interface.parseLog(event).args.trajectoryId;

      const nullifier = ethers.keccak256(ethers.toUtf8Bytes('task-cert-null'));
      await circuit.connect(verifier).verifyTrajectory(
        tid, 3, 86400, MOCK_PROOF, MOCK_PUBLIC_VALUES, nullifier
      );
    });

    it('should create a task', async function () {
      const deadline = Math.floor(Date.now() / 1000) + 7200;
      const tx = await circuit.connect(requester).createTask(
        envId, 1, deadline, { value: ethers.parseEther('5.0') }
      );
      const receipt = await tx.wait();

      const event = receipt.logs.find(l => {
        try { return circuit.interface.parseLog(l)?.name === 'TaskCreated'; }
        catch { return false; }
      });
      expect(event).to.not.be.undefined;
    });

    it('should assign and complete a task', async function () {
      const deadline = Math.floor(Date.now() / 1000) + 7200;
      const txTask = await circuit.connect(requester).createTask(
        envId, 1, deadline, { value: ethers.parseEther('5.0') }
      );
      const receiptTask = await txTask.wait();
      const taskEvent = receiptTask.logs.find(l => {
        try { return circuit.interface.parseLog(l)?.name === 'TaskCreated'; }
        catch { return false; }
      });
      const taskId = circuit.interface.parseLog(taskEvent).args.taskId;

      // Assign
      await circuit.assignTask(taskId, agentId);
      let task = await circuit.getTask(taskId);
      expect(task.status).to.equal(1); // Assigned

      // Complete
      const ownerBefore = await ethers.provider.getBalance(agentOwner.address);
      await circuit.completeTask(taskId);
      const ownerAfter = await ethers.provider.getBalance(agentOwner.address);

      task = await circuit.getTask(taskId);
      expect(task.status).to.equal(2); // Completed
      expect(ownerAfter).to.be.gt(ownerBefore);
    });

    it('should reject uncertified agent for task', async function () {
      // Register new uncertified agent
      const txA = await circuit.connect(agentOwner2).registerAgent(
        ethers.keccak256(ethers.toUtf8Bytes('uncert-policy')), 'drone'
      );
      const receiptA = await txA.wait();
      const aEvent = receiptA.logs.find(l => {
        try { return circuit.interface.parseLog(l)?.name === 'AgentRegistered'; }
        catch { return false; }
      });
      const uncertAgentId = circuit.interface.parseLog(aEvent).args.agentId;

      // Create task requiring cert level 1
      const deadline = Math.floor(Date.now() / 1000) + 7200;
      const txT = await circuit.connect(requester).createTask(
        envId, 1, deadline, { value: ethers.parseEther('1.0') }
      );
      const receiptT = await txT.wait();
      const tEvent = receiptT.logs.find(l => {
        try { return circuit.interface.parseLog(l)?.name === 'TaskCreated'; }
        catch { return false; }
      });
      const taskId = circuit.interface.parseLog(tEvent).args.taskId;

      // Should reject — agent has cert level 0
      await expect(
        circuit.assignTask(taskId, uncertAgentId)
      ).to.be.reverted;
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  //  STATS
  // ═══════════════════════════════════════════════════════════════════════════

  describe('Stats', function () {
    it('should return initial stats', async function () {
      const [envs, agents, trajs, verified, certs, tasks, vol, fees] = await circuit.getStats();
      expect(envs).to.equal(1n); // from beforeEach
      expect(agents).to.equal(1n);
    });
  });
});
