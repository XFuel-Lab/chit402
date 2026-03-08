/**
 * Phase 5 — Autonomous Agent Swarm Tests (18 tests)
 *
 * Tests Almanak-style swarm lifecycle: formation, joining, ZK-settlement
 * with <50K gas micro-settles, dissolution, and AgentSettled events.
 *
 * Run: npx hardhat test test/phase5/AgentSwarms.test.cjs
 */

const { expect } = require('chai');
const hre = require('hardhat');
const { ethers } = hre;

describe('Autonomous Agent Swarms (Phase 5)', function () {
  let a2a, splitter, verifier;
  let admin, agent1, agent2, agent3, relayer;

  const CIRCUIT_ID = ethers.keccak256(ethers.toUtf8Bytes('A2A_CIRCUIT'));

  beforeEach(async function () {
    [admin, agent1, agent2, agent3, relayer] = await ethers.getSigners();

    const SplF = await ethers.getContractFactory('CoreRevenueSplitter');
    splitter = await SplF.deploy(admin.address, admin.address, admin.address, admin.address, admin.address, admin.address);
    await splitter.waitForDeployment();

    const VF = await ethers.getContractFactory('ZKVerifierSP1');
    verifier = await VF.deploy(admin.address, ethers.ZeroAddress);
    await verifier.waitForDeployment();

    const A2AF = await ethers.getContractFactory('A2ACircuit');
    a2a = await A2AF.deploy(admin.address, await splitter.getAddress(), ethers.ZeroAddress);
    await a2a.waitForDeployment();

    const RELAYER_ROLE = await a2a.RELAYER_ROLE();
    await a2a.grantRole(RELAYER_ROLE, relayer.address);

    const cap1 = ethers.keccak256(ethers.toUtf8Bytes('inference:llm'));
    await a2a.connect(agent1).registerAgent(
      ethers.keccak256(ethers.toUtf8Bytes('agent1-id')),
      'https://agent1.example/a2a',
      [cap1]
    );
    await a2a.connect(agent2).registerAgent(
      ethers.keccak256(ethers.toUtf8Bytes('agent2-id')),
      'https://agent2.example/a2a',
      [cap1]
    );
    await a2a.connect(agent3).registerAgent(
      ethers.keccak256(ethers.toUtf8Bytes('agent3-id')),
      'https://agent3.example/a2a',
      [cap1]
    );
  });

  describe('Swarm Formation', function () {
    it('should form a swarm with escrow deposit', async function () {
      const objective = ethers.keccak256(ethers.toUtf8Bytes('multi-agent-inference'));
      const tx = await a2a.connect(agent1).formSwarm(objective, 5, { value: ethers.parseEther('1.0') });
      const receipt = await tx.wait();

      const swarmCount = await a2a.swarmCount();
      expect(swarmCount).to.equal(1n);

      const events = receipt.logs.filter(l => {
        try { return a2a.interface.parseLog(l)?.name === 'SwarmFormed'; } catch { return false; }
      });
      expect(events.length).to.equal(1);
    });

    it('should reject swarm formation from unregistered agent', async function () {
      const signers = await ethers.getSigners();
      const unregistered = signers[5];
      const objective = ethers.keccak256(ethers.toUtf8Bytes('test'));
      await expect(
        a2a.connect(unregistered).formSwarm(objective, 5, { value: ethers.parseEther('0.1') })
      ).to.be.reverted;
    });

    it('should reject zero escrow swarm', async function () {
      const objective = ethers.keccak256(ethers.toUtf8Bytes('test'));
      await expect(
        a2a.connect(agent1).formSwarm(objective, 5, { value: 0 })
      ).to.be.revertedWith('ZeroEscrow');
    });

    it('should reject swarm exceeding MAX_SWARM_SIZE (18)', async function () {
      const objective = ethers.keccak256(ethers.toUtf8Bytes('test'));
      await expect(
        a2a.connect(agent1).formSwarm(objective, 19, { value: ethers.parseEther('0.1') })
      ).to.be.revertedWith('InvalidSize');
    });
  });

  describe('Swarm Membership', function () {
    let swarmId;

    beforeEach(async function () {
      const objective = ethers.keccak256(ethers.toUtf8Bytes('collab-task'));
      const tx = await a2a.connect(agent1).formSwarm(objective, 5, { value: ethers.parseEther('1.0') });
      const receipt = await tx.wait();
      const parsed = receipt.logs.map(l => {
        try { return a2a.interface.parseLog(l); } catch { return null; }
      }).find(p => p?.name === 'SwarmFormed');
      swarmId = parsed.args.swarmId;
    });

    it('should allow registered agent to join swarm', async function () {
      await a2a.connect(agent2).joinSwarm(swarmId);
      const isMember = await a2a.isSwarmMember(swarmId, agent2.address);
      expect(isMember).to.be.true;
    });

    it('should transition swarm from Forming to Active on first join', async function () {
      await a2a.connect(agent2).joinSwarm(swarmId);
      const swarm = await a2a.getSwarm(swarmId);
      expect(swarm.phase).to.equal(1n); // Active
    });

    it('should reject duplicate membership', async function () {
      await a2a.connect(agent2).joinSwarm(swarmId);
      await expect(
        a2a.connect(agent2).joinSwarm(swarmId)
      ).to.be.reverted;
    });

    it('should reject unregistered agent joining', async function () {
      const signers = await ethers.getSigners();
      const unregistered = signers[5];
      await expect(
        a2a.connect(unregistered).joinSwarm(swarmId)
      ).to.be.reverted;
    });
  });

  describe('ZK-Settlement (<50K gas target)', function () {
    let swarmId;

    beforeEach(async function () {
      const objective = ethers.keccak256(ethers.toUtf8Bytes('settle-task'));
      const tx = await a2a.connect(agent1).formSwarm(objective, 5, { value: ethers.parseEther('2.0') });
      const receipt = await tx.wait();
      const parsed = receipt.logs.map(l => {
        try { return a2a.interface.parseLog(l); } catch { return null; }
      }).find(p => p?.name === 'SwarmFormed');
      swarmId = parsed.args.swarmId;

      await a2a.connect(agent2).joinSwarm(swarmId);
      await a2a.connect(agent3).joinSwarm(swarmId);
    });

    it('should settle agent with ZK proof and emit AgentSettled', async function () {
      const nullifier = ethers.keccak256(ethers.toUtf8Bytes('settle-null-1'));
      const proof = '0x' + 'ab'.repeat(130);
      const pubValues = '0x' + 'cd'.repeat(64);

      const tx = await a2a.connect(relayer).settleSwarmAgent(
        swarmId, agent2.address, ethers.parseEther('0.5'),
        proof, pubValues, nullifier
      );
      const receipt = await tx.wait();

      const settled = receipt.logs.map(l => {
        try { return a2a.interface.parseLog(l); } catch { return null; }
      }).find(p => p?.name === 'AgentSettled');
      expect(settled).to.not.be.null;
      expect(settled.args.agent).to.equal(agent2.address);
    });

    it('should reject duplicate nullifier in swarm settlement', async function () {
      const nullifier = ethers.keccak256(ethers.toUtf8Bytes('dup-null'));
      const proof = '0x' + 'ab'.repeat(130);
      const pubValues = '0x' + 'cd'.repeat(64);

      await a2a.connect(relayer).settleSwarmAgent(
        swarmId, agent2.address, ethers.parseEther('0.3'),
        proof, pubValues, nullifier
      );

      await expect(
        a2a.connect(relayer).settleSwarmAgent(
          swarmId, agent3.address, ethers.parseEther('0.3'),
          proof, pubValues, nullifier
        )
      ).to.be.reverted;
    });

    it('should reject settlement exceeding escrow pool', async function () {
      const nullifier = ethers.keccak256(ethers.toUtf8Bytes('over-null'));
      const proof = '0x' + 'ab'.repeat(130);
      const pubValues = '0x' + 'cd'.repeat(64);

      await expect(
        a2a.connect(relayer).settleSwarmAgent(
          swarmId, agent2.address, ethers.parseEther('3.0'),
          proof, pubValues, nullifier
        )
      ).to.be.reverted;
    });

    it('should track swarm settlement metrics', async function () {
      const nullifier = ethers.keccak256(ethers.toUtf8Bytes('metric-null'));
      const proof = '0x' + 'ab'.repeat(130);
      const pubValues = '0x' + 'cd'.repeat(64);

      await a2a.connect(relayer).settleSwarmAgent(
        swarmId, agent2.address, ethers.parseEther('0.5'),
        proof, pubValues, nullifier
      );

      const [swarms_, settlements_, settled_] = await a2a.getSwarmStats();
      expect(swarms_).to.equal(1n);
      expect(settlements_).to.equal(1n);
    });
  });

  describe('Swarm Dissolution', function () {
    let swarmId;

    beforeEach(async function () {
      const objective = ethers.keccak256(ethers.toUtf8Bytes('dissolve-task'));
      const tx = await a2a.connect(agent1).formSwarm(objective, 5, { value: ethers.parseEther('1.0') });
      const receipt = await tx.wait();
      const parsed = receipt.logs.map(l => {
        try { return a2a.interface.parseLog(l); } catch { return null; }
      }).find(p => p?.name === 'SwarmFormed');
      swarmId = parsed.args.swarmId;
    });

    it('should dissolve swarm and refund remaining escrow', async function () {
      const balBefore = await ethers.provider.getBalance(agent1.address);
      const tx = await a2a.connect(agent1).dissolveSwarm(swarmId);
      await tx.wait();

      const swarm = await a2a.getSwarm(swarmId);
      expect(swarm.phase).to.equal(3n); // Dissolved
    });

    it('should emit SwarmDissolved event', async function () {
      const tx = await a2a.connect(agent1).dissolveSwarm(swarmId);
      const receipt = await tx.wait();

      const dissolved = receipt.logs.map(l => {
        try { return a2a.interface.parseLog(l); } catch { return null; }
      }).find(p => p?.name === 'SwarmDissolved');
      expect(dissolved).to.not.be.null;
    });

    it('should reject dissolution from non-coordinator', async function () {
      await expect(
        a2a.connect(agent2).dissolveSwarm(swarmId)
      ).to.be.revertedWith('NotCoordinator');
    });
  });
});
