/**
 * Solana AI Bridge Circuit — Hardhat Tests (15 tests)
 *
 * Run: npx hardhat test circuits/solana-ai-bridge/test/SolanaAIBridge.test.cjs
 */
const { expect } = require('chai');
const { ethers } = require('hardhat');

describe('SolanaAIBridge', function () {
  let circuit, splitter;
  let admin, relayer, providerOwner1, providerOwner2, requester;
  let bbb, lp, staker, treasury, stakePool;

  const MOCK_PROOF = '0x' + 'ab'.repeat(130);
  const MOCK_PV = '0x' + 'cd'.repeat(64);
  const SOL_PUBKEY = ethers.keccak256(ethers.toUtf8Bytes('solana-provider-pubkey'));
  const CAP_HASH = ethers.keccak256(ethers.toUtf8Bytes('gpu:a100,inference'));
  const TASK_HASH = ethers.keccak256(ethers.toUtf8Bytes('render-3d-scene-v2'));
  const INPUT_HASH = ethers.keccak256(ethers.toUtf8Bytes('encrypted-input'));
  const RESULT_HASH = ethers.keccak256(ethers.toUtf8Bytes('render-output'));
  const VAA_HASH = ethers.keccak256(ethers.toUtf8Bytes('wormhole-vaa-1'));

  let providerId;

  beforeEach(async function () {
    [admin, relayer, providerOwner1, providerOwner2, requester, bbb, lp, staker, treasury, stakePool] =
      await ethers.getSigners();

    const SF = await ethers.getContractFactory('CoreRevenueSplitter');
    splitter = await SF.deploy(admin.address, bbb.address, lp.address, staker.address, treasury.address, stakePool.address);
    await splitter.waitForDeployment();

    const CF = await ethers.getContractFactory('SolanaAIBridge');
    circuit = await CF.deploy(admin.address, await splitter.getAddress(), ethers.ZeroAddress);
    await circuit.waitForDeployment();

    const RELAYER_ROLE = await circuit.RELAYER_ROLE();
    await circuit.grantRole(RELAYER_ROLE, relayer.address);
    const CIRCUIT_ROLE = await splitter.CIRCUIT_ROLE();
    await splitter.grantRole(CIRCUIT_ROLE, await circuit.getAddress());

    // Register provider
    const tx = await circuit.connect(providerOwner1).registerProvider(SOL_PUBKEY, 0, 'render', CAP_HASH);
    const r = await tx.wait();
    const ev = r.logs.find(l => { try { return circuit.interface.parseLog(l)?.name === 'ProviderRegistered'; } catch { return false; } });
    providerId = circuit.interface.parseLog(ev).args.providerId;
  });

  // ═══ PROVIDER REGISTRY ═══
  describe('Provider Registry', function () {
    it('should register a Solana provider', async function () {
      const p = await circuit.getProvider(providerId);
      expect(p.evmOwner).to.equal(providerOwner1.address);
      expect(p.platform).to.equal('render');
      expect(p.active).to.be.true;
    });

    it('should register multiple providers across platforms', async function () {
      await circuit.connect(providerOwner2).registerProvider(
        ethers.keccak256(ethers.toUtf8Bytes('sol-pub-2')), 1, 'grass', CAP_HASH
      );
      expect(await circuit.providerCount()).to.equal(2n);
    });

    it('should reject zero pubkey', async function () {
      await expect(circuit.registerProvider(ethers.ZeroHash, 0, 'bad', CAP_HASH)).to.be.revertedWith('ZeroPubkey');
    });
  });

  // ═══ TASK SUBMISSION ═══
  describe('Task Submission', function () {
    it('should submit a task with payment', async function () {
      const deadline = Math.floor(Date.now() / 1000) + 3600;
      const tx = await circuit.connect(requester).submitTask(providerId, TASK_HASH, INPUT_HASH, deadline, { value: ethers.parseEther('5') });
      const r = await tx.wait();
      const ev = r.logs.find(l => { try { return circuit.interface.parseLog(l)?.name === 'TaskSubmitted'; } catch { return false; } });
      expect(ev).to.not.be.undefined;
      expect(await circuit.taskCount()).to.equal(1n);
    });

    it('should reject zero payment', async function () {
      const deadline = Math.floor(Date.now() / 1000) + 3600;
      await expect(circuit.connect(requester).submitTask(providerId, TASK_HASH, INPUT_HASH, deadline, { value: 0 })).to.be.revertedWith('ZeroPayment');
    });

    it('should cancel and refund pending task', async function () {
      const deadline = Math.floor(Date.now() / 1000) + 3600;
      const tx = await circuit.connect(requester).submitTask(providerId, TASK_HASH, INPUT_HASH, deadline, { value: ethers.parseEther('5') });
      const r = await tx.wait();
      const ev = r.logs.find(l => { try { return circuit.interface.parseLog(l)?.name === 'TaskSubmitted'; } catch { return false; } });
      const taskId = circuit.interface.parseLog(ev).args.taskId;

      const before = await ethers.provider.getBalance(requester.address);
      await circuit.connect(requester).cancelTask(taskId);
      const after = await ethers.provider.getBalance(requester.address);
      expect(after).to.be.gt(before);
    });
  });

  // ═══ BRIDGE RELAY ═══
  describe('Bridge Relay', function () {
    let taskId;
    beforeEach(async function () {
      const deadline = Math.floor(Date.now() / 1000) + 3600;
      const tx = await circuit.connect(requester).submitTask(providerId, TASK_HASH, INPUT_HASH, deadline, { value: ethers.parseEther('10') });
      const r = await tx.wait();
      const ev = r.logs.find(l => { try { return circuit.interface.parseLog(l)?.name === 'TaskSubmitted'; } catch { return false; } });
      taskId = circuit.interface.parseLog(ev).args.taskId;
    });

    it('should bridge task to Solana', async function () {
      await circuit.connect(relayer).bridgeTask(taskId, VAA_HASH);
      const t = await circuit.getTask(taskId);
      expect(t.status).to.equal(1); // Bridged
      expect(await circuit.totalBridged()).to.equal(1n);
    });

    it('should reject bridging already-bridged task', async function () {
      await circuit.connect(relayer).bridgeTask(taskId, VAA_HASH);
      await expect(circuit.connect(relayer).bridgeTask(taskId, VAA_HASH)).to.be.reverted;
    });
  });

  // ═══ SETTLEMENT ═══
  describe('ZK Settlement', function () {
    let taskId;
    beforeEach(async function () {
      const deadline = Math.floor(Date.now() / 1000) + 3600;
      const tx = await circuit.connect(requester).submitTask(providerId, TASK_HASH, INPUT_HASH, deadline, { value: ethers.parseEther('10') });
      const r = await tx.wait();
      const ev = r.logs.find(l => { try { return circuit.interface.parseLog(l)?.name === 'TaskSubmitted'; } catch { return false; } });
      taskId = circuit.interface.parseLog(ev).args.taskId;
      await circuit.connect(relayer).bridgeTask(taskId, VAA_HASH);
    });

    it('should settle with ZK proof and pay provider', async function () {
      const nullifier = ethers.keccak256(ethers.toUtf8Bytes('settle-sol-1'));
      const provBefore = await ethers.provider.getBalance(providerOwner1.address);
      const splBefore = await ethers.provider.getBalance(await splitter.getAddress());

      await circuit.connect(relayer).settleTask(taskId, RESULT_HASH, 9000, MOCK_PROOF, MOCK_PV, nullifier);

      const provAfter = await ethers.provider.getBalance(providerOwner1.address);
      const splAfter = await ethers.provider.getBalance(await splitter.getAddress());

      expect(provAfter - provBefore).to.be.gt(ethers.parseEther('9.9'));
      expect(splAfter - splBefore).to.be.gt(0n);

      const t = await circuit.getTask(taskId);
      expect(t.status).to.equal(3); // Settled
    });

    it('should update provider reputation', async function () {
      const nullifier = ethers.keccak256(ethers.toUtf8Bytes('rep-sol'));
      await circuit.connect(relayer).settleTask(taskId, RESULT_HASH, 8500, MOCK_PROOF, MOCK_PV, nullifier);
      const p = await circuit.getProvider(providerId);
      expect(p.reputation).to.equal(8500n);
      expect(p.tasksCompleted).to.equal(1n);
    });

    it('should reject duplicate nullifier', async function () {
      const nullifier = ethers.keccak256(ethers.toUtf8Bytes('dup-sol'));
      await circuit.connect(relayer).settleTask(taskId, RESULT_HASH, 8000, MOCK_PROOF, MOCK_PV, nullifier);

      const deadline2 = Math.floor(Date.now() / 1000) + 7200;
      const tx2 = await circuit.connect(requester).submitTask(providerId, TASK_HASH, INPUT_HASH, deadline2, { value: ethers.parseEther('5') });
      const r2 = await tx2.wait();
      const ev2 = r2.logs.find(l => { try { return circuit.interface.parseLog(l)?.name === 'TaskSubmitted'; } catch { return false; } });
      const taskId2 = circuit.interface.parseLog(ev2).args.taskId;
      await circuit.connect(relayer).bridgeTask(taskId2, VAA_HASH);

      await expect(circuit.connect(relayer).settleTask(taskId2, RESULT_HASH, 8000, MOCK_PROOF, MOCK_PV, nullifier)).to.be.reverted;
    });

    it('should collect 0.75% protocol fee', async function () {
      const nullifier = ethers.keccak256(ethers.toUtf8Bytes('fee-sol'));
      const splBefore = await ethers.provider.getBalance(await splitter.getAddress());
      await circuit.connect(relayer).settleTask(taskId, RESULT_HASH, 9000, MOCK_PROOF, MOCK_PV, nullifier);
      const splAfter = await ethers.provider.getBalance(await splitter.getAddress());
      const expectedFee = ethers.parseEther('0.075'); // 0.75% of 10 ETH
      expect(splAfter - splBefore).to.equal(expectedFee);
    });
  });

  // ═══ EDGE CASES ═══
  describe('Edge Cases', function () {
    it('should prevent operations when paused', async function () {
      await circuit.pause();
      await expect(circuit.registerProvider(SOL_PUBKEY, 0, 'x', CAP_HASH)).to.be.reverted;
    });

    it('should track global stats', async function () {
      const [prov, tasks_, bridged, settled, vol, fees] = await circuit.getStats();
      expect(prov).to.equal(1n);
      expect(tasks_).to.equal(0n);
    });
  });
});
