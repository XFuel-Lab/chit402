// ThetaInferenceCircuit -- Branch Coverage Expansion (8 tests)
//
// Targets uncovered branches to push from 65% to 70%+ branch coverage:
//   1. Constructor zero-admin revert
//   2. updatePreset / updateService invalid-ID reverts + admin setters
//   3. submitPresetIntent: invalid preset, inactive preset, missing service, inactive service
//   4. completeIntent: non-existent intent, invalid status + failIntent with refund
//   5. settleIntent / failIntent non-existent + getEffectivePrice + submitIntent bogus service
//   6. settleIntent with zkVerifier != address(0) via EOA + successful submitPresetIntent flow
//   7. Fee forwarding: splitter=address(0) skip path + MockRevenueSplitter fallback
//   8. Paused-state rejection for submitIntent, submitPresetIntent, settleIntent

const { expect } = require('chai');
const { ethers } = require('hardhat');

describe('ThetaInferenceCircuit — Branch Coverage', function () {
  let circuit, splitter;
  let admin, relayer, user, user2;
  let bbb, lp, staker, treasury, stakePool;

  const MOCK_INPUT = ethers.keccak256(ethers.toUtf8Bytes('branch-cov-input'));
  const MOCK_OUTPUT = ethers.keccak256(ethers.toUtf8Bytes('branch-cov-output'));
  const MOCK_MODEL = ethers.keccak256(ethers.toUtf8Bytes('branch-cov-model'));
  const MOCK_PROOF = '0x' + 'ab'.repeat(130);
  const MOCK_PV = '0x' + 'cd'.repeat(64);
  const BOGUS = ethers.keccak256(ethers.toUtf8Bytes('bogus-nonexistent'));

  const SVC_LLM = 0;
  const GPU_RTX = 0;
  const GPU_H100 = 2;

  function findEvent(receipt, contract, name) {
    const log = receipt.logs.find(l => {
      try { return contract.interface.parseLog(l)?.name === name; }
      catch { return false; }
    });
    return log ? contract.interface.parseLog(log) : null;
  }

  beforeEach(async function () {
    [admin, relayer, user, user2, bbb, lp, staker, treasury, stakePool] =
      await ethers.getSigners();

    const SF = await ethers.getContractFactory('CoreRevenueSplitter');
    splitter = await SF.deploy(
      admin.address, bbb.address, lp.address,
      staker.address, treasury.address, stakePool.address
    );
    await splitter.waitForDeployment();

    const CF = await ethers.getContractFactory('ThetaInferenceCircuit');
    circuit = await CF.deploy(admin.address, await splitter.getAddress(), ethers.ZeroAddress);
    await circuit.waitForDeployment();

    await circuit.grantRole(await circuit.RELAYER_ROLE(), relayer.address);
  });

  // -- 1. Constructor: zero admin -------------------------------------------------

  it('should revert constructor when admin is zero address', async function () {
    const CF = await ethers.getContractFactory('ThetaInferenceCircuit');
    await expect(
      CF.deploy(ethers.ZeroAddress, ethers.ZeroAddress, ethers.ZeroAddress)
    ).to.be.revertedWith('ZeroAdmin');
  });

  // -- 2. updatePreset / updateService invalid IDs + admin setters ----------------

  it('should revert updatePreset and updateService on non-existent IDs and handle admin setters', async function () {
    await expect(circuit.updatePreset(BOGUS, false))
      .to.be.reverted;

    await expect(circuit.updateService(BOGUS, 1000, true))
      .to.be.reverted;

    await circuit.registerPreset('X', SVC_LLM, 'llama', GPU_RTX, '');
    const pid = await circuit.presetIds(0);
    await circuit.updatePreset(pid, false);
    expect((await circuit.getPreset(pid)).active).to.be.false;
    await circuit.updatePreset(pid, true);
    expect((await circuit.getPreset(pid)).active).to.be.true;

    await circuit.setFee(25);
    expect(await circuit.feeBps()).to.equal(25);
    await expect(circuit.setFee(5)).to.be.reverted;
    await expect(circuit.setFee(200)).to.be.reverted;

    await circuit.setRevenueSplitter(user.address);
    expect(await circuit.revenueSplitter()).to.equal(user.address);
    await circuit.setZKVerifier(user.address);
    expect(await circuit.zkVerifier()).to.equal(user.address);

    await circuit.setGpuMultiplier(GPU_H100, 60000);
    expect(await circuit.getGpuMultiplier(GPU_H100)).to.equal(60000n);
    await expect(circuit.setGpuMultiplier(GPU_RTX, 1000)).to.be.reverted;
    await expect(circuit.setGpuMultiplier(GPU_RTX, 300000)).to.be.reverted;
  });

  // -- 3. submitPresetIntent: all four error paths --------------------------------

  it('should revert submitPresetIntent for invalid preset, inactive preset, missing service, and inactive service', async function () {
    await circuit.registerService(SVC_LLM, 'llama', ethers.parseEther('0.01'), 5000);
    const sid = await circuit.serviceIds(0);
    await circuit.registerPreset('P', SVC_LLM, 'llama', GPU_RTX, '');
    const pid = await circuit.presetIds(0);

    await expect(
      circuit.connect(user).submitPresetIntent(BOGUS, GPU_RTX, sid, MOCK_INPUT, { value: ethers.parseEther('0.01') })
    ).to.be.reverted;

    await circuit.updatePreset(pid, false);
    await expect(
      circuit.connect(user).submitPresetIntent(pid, GPU_RTX, sid, MOCK_INPUT, { value: ethers.parseEther('0.01') })
    ).to.be.reverted;

    await circuit.updatePreset(pid, true);
    await expect(
      circuit.connect(user).submitPresetIntent(pid, GPU_RTX, BOGUS, MOCK_INPUT, { value: ethers.parseEther('0.01') })
    ).to.be.reverted;

    await circuit.updateService(sid, ethers.parseEther('0.01'), false);
    await expect(
      circuit.connect(user).submitPresetIntent(pid, GPU_RTX, sid, MOCK_INPUT, { value: ethers.parseEther('0.01') })
    ).to.be.reverted;
  });

  // -- 4. completeIntent edges + failIntent refund --------------------------------

  it('should revert completeIntent on non-existent and already-settled intent, and refund on failIntent', async function () {
    await expect(
      circuit.connect(relayer).completeIntent(BOGUS, MOCK_OUTPUT, MOCK_MODEL, 500)
    ).to.be.reverted;

    await circuit.registerService(SVC_LLM, 'llama', ethers.parseEther('0.01'), 5000);
    const sid = await circuit.serviceIds(0);

    const tx1 = await circuit.connect(user).submitIntent(sid, MOCK_INPUT, { value: ethers.parseEther('1') });
    const ev1 = findEvent(await tx1.wait(), circuit, 'InferenceIntentSubmitted');
    const iid1 = ev1.args.intentId;

    await circuit.connect(relayer).completeIntent(iid1, MOCK_OUTPUT, MOCK_MODEL, 500);
    await circuit.connect(relayer).settleIntent(
      iid1, MOCK_PROOF, MOCK_PV,
      ethers.keccak256(ethers.toUtf8Bytes('branch-settle-1'))
    );

    await expect(
      circuit.connect(relayer).completeIntent(iid1, MOCK_OUTPUT, MOCK_MODEL, 100)
    ).to.be.reverted;

    const tx2 = await circuit.connect(user).submitIntent(sid, MOCK_INPUT, { value: ethers.parseEther('0.5') });
    const ev2 = findEvent(await tx2.wait(), circuit, 'InferenceIntentSubmitted');
    const iid2 = ev2.args.intentId;

    const balBefore = await ethers.provider.getBalance(user.address);
    await circuit.connect(relayer).failIntent(iid2, 'EdgeCloud timeout');
    const balAfter = await ethers.provider.getBalance(user.address);
    expect(balAfter).to.be.gt(balBefore);

    const failed = await circuit.getIntent(iid2);
    expect(failed.status).to.equal(4n);
  });

  // -- 5. settleIntent / failIntent non-existent + getEffectivePrice + submitIntent bogus service --

  it('should revert settleIntent/failIntent on non-existent intents and getEffectivePrice/submitIntent on non-existent service', async function () {
    const nul = ethers.keccak256(ethers.toUtf8Bytes('branch-noexist'));
    await expect(
      circuit.connect(relayer).settleIntent(BOGUS, MOCK_PROOF, MOCK_PV, nul)
    ).to.be.reverted;

    await expect(
      circuit.connect(relayer).failIntent(BOGUS, 'no such intent')
    ).to.be.reverted;

    await expect(circuit.getEffectivePrice(BOGUS, GPU_RTX))
      .to.be.reverted;

    await expect(
      circuit.connect(user).submitIntent(BOGUS, MOCK_INPUT, { value: ethers.parseEther('0.01') })
    ).to.be.reverted;
  });

  // -- 6. settleIntent with zkVerifier != address(0) + successful submitPresetIntent --

  it('should settle preset intent via zkVerifier path when verifier is a non-zero EOA', async function () {
    const CF = await ethers.getContractFactory('ThetaInferenceCircuit');
    const c = await CF.deploy(admin.address, await splitter.getAddress(), admin.address);
    await c.waitForDeployment();
    await c.grantRole(await c.RELAYER_ROLE(), relayer.address);

    await c.registerService(SVC_LLM, 'zk-model', ethers.parseEther('0.01'), 5000);
    const sid = await c.serviceIds(0);
    await c.registerPreset('ZkPreset', SVC_LLM, 'zk-model', GPU_H100, 'deep analysis');
    const pid = await c.presetIds(0);

    const h100Price = ethers.parseEther('0.05');
    const tx = await c.connect(user).submitPresetIntent(pid, GPU_H100, sid, MOCK_INPUT, { value: h100Price });
    const receipt = await tx.wait();

    const inferEv = findEvent(receipt, c, 'InferenceIntentSubmitted');
    expect(inferEv).to.not.be.null;
    const presetEv = findEvent(receipt, c, 'PresetIntentSubmitted');
    expect(presetEv).to.not.be.null;
    expect(presetEv.args.gpuTier).to.equal(BigInt(GPU_H100));

    const iid = inferEv.args.intentId;
    await c.connect(relayer).completeIntent(iid, MOCK_OUTPUT, MOCK_MODEL, 800);

    const nul = ethers.keccak256(ethers.toUtf8Bytes('zk-eoa-null'));
    await c.connect(relayer).settleIntent(iid, MOCK_PROOF, MOCK_PV, nul);

    const intent = await c.getIntent(iid);
    expect(intent.status).to.equal(5n);
    expect(intent.proofNullifier).to.equal(nul);
  });

  // -- 7. Fee forwarding: splitter=address(0) skip + MockRevenueSplitter fallback --

  it('should skip fee forwarding with zero splitter and use receive() fallback with MockRevenueSplitter', async function () {
    const CF = await ethers.getContractFactory('ThetaInferenceCircuit');

    const cNoSplit = await CF.deploy(admin.address, ethers.ZeroAddress, ethers.ZeroAddress);
    await cNoSplit.waitForDeployment();
    await cNoSplit.registerService(SVC_LLM, 'nosplit', ethers.parseEther('0.01'), 5000);
    const sid1 = await cNoSplit.serviceIds(0);

    const pay1 = ethers.parseEther('1');
    await cNoSplit.connect(user).submitIntent(sid1, MOCK_INPUT, { value: pay1 });

    expect(await cNoSplit.totalVolume()).to.equal(pay1);
    expect(await cNoSplit.totalFeesCollected()).to.be.gt(0n);
    const cAddr = await cNoSplit.getAddress();
    expect(await ethers.provider.getBalance(cAddr)).to.equal(pay1);

    const MF = await ethers.getContractFactory('MockRevenueSplitter');
    const mockSplit = await MF.deploy();
    await mockSplit.waitForDeployment();

    const cMock = await CF.deploy(admin.address, await mockSplit.getAddress(), ethers.ZeroAddress);
    await cMock.waitForDeployment();
    await cMock.registerService(SVC_LLM, 'mock-split', ethers.parseEther('0.01'), 5000);
    const sid2 = await cMock.serviceIds(0);

    const pay2 = ethers.parseEther('2');
    const expectedFee = (pay2 * 50n) / 10000n;
    await cMock.connect(user).submitIntent(sid2, MOCK_INPUT, { value: pay2 });

    const mockBal = await ethers.provider.getBalance(await mockSplit.getAddress());
    expect(mockBal).to.equal(expectedFee);
  });

  // -- 8. Paused state: submitIntent, submitPresetIntent, settleIntent rejected ---

  it('should reject submitIntent, submitPresetIntent, and settleIntent when paused', async function () {
    await circuit.registerService(SVC_LLM, 'pause-model', ethers.parseEther('0.01'), 5000);
    const sid = await circuit.serviceIds(0);
    await circuit.registerPreset('PP', SVC_LLM, 'llama', GPU_RTX, '');
    const pid = await circuit.presetIds(0);

    await circuit.pause();

    await expect(
      circuit.connect(user).submitIntent(sid, MOCK_INPUT, { value: ethers.parseEther('0.01') })
    ).to.be.reverted;

    await expect(
      circuit.connect(user).submitPresetIntent(pid, GPU_RTX, sid, MOCK_INPUT, { value: ethers.parseEther('0.01') })
    ).to.be.reverted;

    await circuit.unpause();
    const tx = await circuit.connect(user).submitIntent(sid, MOCK_INPUT, { value: ethers.parseEther('1') });
    const ev = findEvent(await tx.wait(), circuit, 'InferenceIntentSubmitted');
    const iid = ev.args.intentId;
    await circuit.connect(relayer).completeIntent(iid, MOCK_OUTPUT, MOCK_MODEL, 500);

    await circuit.pause();
    const nul = ethers.keccak256(ethers.toUtf8Bytes('paused-settle'));
    await expect(
      circuit.connect(relayer).settleIntent(iid, MOCK_PROOF, MOCK_PV, nul)
    ).to.be.reverted;

    await circuit.unpause();
  });
});
