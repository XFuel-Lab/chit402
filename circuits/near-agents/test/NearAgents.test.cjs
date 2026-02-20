/**
 * NEAR Agents Circuit — Hardhat Tests (15 tests)
 *
 * Run: npx hardhat test circuits/near-agents/test/NearAgents.test.cjs
 */
const { expect } = require('chai');
const { ethers } = require('hardhat');

describe('NearAgents', function () {
  let circuit, splitter;
  let admin, solver, agentOwner1, agentOwner2, requester;
  let bbb, lp, staker, treasury, stakePool;

  const MOCK_PROOF = '0x' + 'ab'.repeat(130);
  const MOCK_PV = '0x' + 'cd'.repeat(64);
  const CAP_HASH = ethers.keccak256(ethers.toUtf8Bytes('capability:llm,trading'));
  const ATT_HASH = ethers.keccak256(ethers.toUtf8Bytes('tee-attestation-v1'));
  const INTENT_HASH = ethers.keccak256(ethers.toUtf8Bytes('swap 100 USDC to ETH on best DEX'));
  const CONSTRAINT_HASH = ethers.keccak256(ethers.toUtf8Bytes('slippage<0.5%'));
  const APPROACH_HASH = ethers.keccak256(ethers.toUtf8Bytes('route:1inch+uniswap'));
  const RESULT_HASH = ethers.keccak256(ethers.toUtf8Bytes('result:0.031ETH'));

  let agentId1, agentId2;

  beforeEach(async function () {
    [admin, solver, agentOwner1, agentOwner2, requester, bbb, lp, staker, treasury, stakePool] =
      await ethers.getSigners();

    const SF = await ethers.getContractFactory('CoreRevenueSplitter');
    splitter = await SF.deploy(admin.address, bbb.address, lp.address, staker.address, treasury.address, stakePool.address);
    await splitter.waitForDeployment();

    const CF = await ethers.getContractFactory('NearAgents');
    circuit = await CF.deploy(admin.address, await splitter.getAddress(), ethers.ZeroAddress);
    await circuit.waitForDeployment();

    const SOLVER_ROLE = await circuit.SOLVER_ROLE();
    await circuit.grantRole(SOLVER_ROLE, solver.address);
    const CIRCUIT_ROLE = await splitter.CIRCUIT_ROLE();
    await splitter.grantRole(CIRCUIT_ROLE, await circuit.getAddress());

    // Register two agents
    let tx = await circuit.connect(agentOwner1).registerAgent(CAP_HASH, ATT_HASH, 'llm');
    let r = await tx.wait();
    let ev = r.logs.find(l => { try { return circuit.interface.parseLog(l)?.name === 'AgentRegistered'; } catch { return false; } });
    agentId1 = circuit.interface.parseLog(ev).args.agentId;

    tx = await circuit.connect(agentOwner2).registerAgent(
      ethers.keccak256(ethers.toUtf8Bytes('capability:trading')),
      ATT_HASH, 'trading'
    );
    r = await tx.wait();
    ev = r.logs.find(l => { try { return circuit.interface.parseLog(l)?.name === 'AgentRegistered'; } catch { return false; } });
    agentId2 = circuit.interface.parseLog(ev).args.agentId;
  });

  // ═══ AGENT REGISTRY ═══
  describe('Agent Registry', function () {
    it('should register an agent with capabilities', async function () {
      const a = await circuit.getAgent(agentId1);
      expect(a.owner).to.equal(agentOwner1.address);
      expect(a.agentType).to.equal('llm');
      expect(a.active).to.be.true;
    });

    it('should register multiple independent agents', async function () {
      expect(await circuit.agentCount()).to.equal(2n);
      const a1 = await circuit.getAgent(agentId1);
      const a2 = await circuit.getAgent(agentId2);
      expect(a1.agentType).to.equal('llm');
      expect(a2.agentType).to.equal('trading');
    });

    it('should reject zero capability hash', async function () {
      await expect(
        circuit.connect(agentOwner1).registerAgent(ethers.ZeroHash, ATT_HASH, 'bad')
      ).to.be.revertedWith('ZeroCapability');
    });

    it('should deactivate an agent', async function () {
      await circuit.connect(agentOwner1).deactivateAgent(agentId1);
      const a = await circuit.getAgent(agentId1);
      expect(a.active).to.be.false;
    });
  });

  // ═══ INTENT SUBMISSION ═══
  describe('Intent Submission', function () {
    it('should submit an intent with budget', async function () {
      const tx = await circuit.connect(requester).submitIntent(
        INTENT_HASH, CONSTRAINT_HASH, Math.floor(Date.now() / 1000) + 3600,
        { value: ethers.parseEther('10') }
      );
      const r = await tx.wait();
      const ev = r.logs.find(l => { try { return circuit.interface.parseLog(l)?.name === 'IntentSubmitted'; } catch { return false; } });
      expect(ev).to.not.be.undefined;
      expect(await circuit.intentCount()).to.equal(1n);
    });

    it('should reject zero budget', async function () {
      await expect(
        circuit.connect(requester).submitIntent(INTENT_HASH, CONSTRAINT_HASH, Math.floor(Date.now() / 1000) + 3600, { value: 0 })
      ).to.be.revertedWith('ZeroBudget');
    });

    it('should cancel and refund an open intent', async function () {
      const tx = await circuit.connect(requester).submitIntent(
        INTENT_HASH, CONSTRAINT_HASH, Math.floor(Date.now() / 1000) + 3600,
        { value: ethers.parseEther('5') }
      );
      const r = await tx.wait();
      const ev = r.logs.find(l => { try { return circuit.interface.parseLog(l)?.name === 'IntentSubmitted'; } catch { return false; } });
      const intentId = circuit.interface.parseLog(ev).args.intentId;

      const before = await ethers.provider.getBalance(requester.address);
      await circuit.connect(requester).cancelIntent(intentId);
      const after = await ethers.provider.getBalance(requester.address);
      expect(after).to.be.gt(before);
    });
  });

  // ═══ BIDDING ═══
  describe('Bidding', function () {
    let intentId;

    beforeEach(async function () {
      const tx = await circuit.connect(requester).submitIntent(
        INTENT_HASH, CONSTRAINT_HASH, Math.floor(Date.now() / 1000) + 3600,
        { value: ethers.parseEther('10') }
      );
      const r = await tx.wait();
      const ev = r.logs.find(l => { try { return circuit.interface.parseLog(l)?.name === 'IntentSubmitted'; } catch { return false; } });
      intentId = circuit.interface.parseLog(ev).args.intentId;
    });

    it('should place a bid on an intent', async function () {
      const tx = await circuit.connect(agentOwner1).placeBid(intentId, agentId1, ethers.parseEther('8'), APPROACH_HASH);
      const r = await tx.wait();
      const ev = r.logs.find(l => { try { return circuit.interface.parseLog(l)?.name === 'BidPlaced'; } catch { return false; } });
      expect(ev).to.not.be.undefined;
      const i = await circuit.getIntent(intentId);
      expect(i.bidCount).to.equal(1n);
    });

    it('should reject bid exceeding budget', async function () {
      await expect(
        circuit.connect(agentOwner1).placeBid(intentId, agentId1, ethers.parseEther('20'), APPROACH_HASH)
      ).to.be.reverted;
    });

    it('should accept multiple bids from different agents', async function () {
      await circuit.connect(agentOwner1).placeBid(intentId, agentId1, ethers.parseEther('8'), APPROACH_HASH);
      await circuit.connect(agentOwner2).placeBid(intentId, agentId2, ethers.parseEther('7'), APPROACH_HASH);
      const i = await circuit.getIntent(intentId);
      expect(i.bidCount).to.equal(2n);
    });
  });

  // ═══ ASSIGNMENT & SETTLEMENT ═══
  describe('Assignment & Settlement', function () {
    let intentId, bidId;

    beforeEach(async function () {
      const tx1 = await circuit.connect(requester).submitIntent(
        INTENT_HASH, CONSTRAINT_HASH, Math.floor(Date.now() / 1000) + 3600,
        { value: ethers.parseEther('10') }
      );
      const r1 = await tx1.wait();
      const ev1 = r1.logs.find(l => { try { return circuit.interface.parseLog(l)?.name === 'IntentSubmitted'; } catch { return false; } });
      intentId = circuit.interface.parseLog(ev1).args.intentId;

      const tx2 = await circuit.connect(agentOwner1).placeBid(intentId, agentId1, ethers.parseEther('8'), APPROACH_HASH);
      const r2 = await tx2.wait();
      const ev2 = r2.logs.find(l => { try { return circuit.interface.parseLog(l)?.name === 'BidPlaced'; } catch { return false; } });
      bidId = circuit.interface.parseLog(ev2).args.bidId;

      await circuit.connect(solver).assignIntent(intentId, bidId);
    });

    it('should assign an intent to an agent', async function () {
      const asgn = await circuit.getAssignment(intentId);
      expect(asgn.agentId).to.equal(agentId1);
      expect(asgn.agreedPrice).to.equal(ethers.parseEther('8'));
    });

    it('should settle with ZK proof, pay agent, and refund excess', async function () {
      const nullifier = ethers.keccak256(ethers.toUtf8Bytes('settle-1'));
      const agentBefore = await ethers.provider.getBalance(agentOwner1.address);
      const requesterBefore = await ethers.provider.getBalance(requester.address);

      await circuit.connect(solver).settleIntent(intentId, RESULT_HASH, 9000, MOCK_PROOF, MOCK_PV, nullifier);

      const agentAfter = await ethers.provider.getBalance(agentOwner1.address);
      const requesterAfter = await ethers.provider.getBalance(requester.address);

      // Agent receives ~8 ETH minus 0.5% fee ≈ 7.96 ETH
      expect(agentAfter - agentBefore).to.be.gt(ethers.parseEther('7.9'));
      // Requester gets refund of 2 ETH (10 - 8 budget excess)
      expect(requesterAfter - requesterBefore).to.equal(ethers.parseEther('2'));

      const i = await circuit.getIntent(intentId);
      expect(i.status).to.equal(3); // Settled (Open=0, Assigned=1, Executed=2, Settled=3)
    });

    it('should update agent reputation on settlement', async function () {
      const nullifier = ethers.keccak256(ethers.toUtf8Bytes('rep-update'));
      await circuit.connect(solver).settleIntent(intentId, RESULT_HASH, 9500, MOCK_PROOF, MOCK_PV, nullifier);

      const a = await circuit.getAgent(agentId1);
      expect(a.reputation).to.equal(9500n);
      expect(a.tasksCompleted).to.equal(1n);
    });

    it('should reject duplicate nullifier', async function () {
      const nullifier = ethers.keccak256(ethers.toUtf8Bytes('dup-null'));
      await circuit.connect(solver).settleIntent(intentId, RESULT_HASH, 8000, MOCK_PROOF, MOCK_PV, nullifier);

      // Need a new intent+bid+assign for second attempt
      const tx = await circuit.connect(requester).submitIntent(
        INTENT_HASH, CONSTRAINT_HASH, Math.floor(Date.now() / 1000) + 7200,
        { value: ethers.parseEther('5') }
      );
      const r = await tx.wait();
      const ev = r.logs.find(l => { try { return circuit.interface.parseLog(l)?.name === 'IntentSubmitted'; } catch { return false; } });
      const id2 = circuit.interface.parseLog(ev).args.intentId;
      const txB = await circuit.connect(agentOwner1).placeBid(id2, agentId1, ethers.parseEther('4'), APPROACH_HASH);
      const rB = await txB.wait();
      const evB = rB.logs.find(l => { try { return circuit.interface.parseLog(l)?.name === 'BidPlaced'; } catch { return false; } });
      const bid2 = circuit.interface.parseLog(evB).args.bidId;
      await circuit.connect(solver).assignIntent(id2, bid2);

      await expect(
        circuit.connect(solver).settleIntent(id2, RESULT_HASH, 8000, MOCK_PROOF, MOCK_PV, nullifier)
      ).to.be.reverted;
    });
  });

  // ═══ EDGE CASES ═══
  describe('Edge Cases', function () {
    it('should prevent operations when paused', async function () {
      await circuit.pause();
      await expect(
        circuit.connect(agentOwner1).registerAgent(CAP_HASH, ATT_HASH, 'test')
      ).to.be.reverted;
    });

    it('should track global stats', async function () {
      const [agents_, intents_, bids_, volume_, fees_, settlements_] = await circuit.getStats();
      expect(agents_).to.equal(2n);
      expect(intents_).to.equal(0n);
    });
  });
});
