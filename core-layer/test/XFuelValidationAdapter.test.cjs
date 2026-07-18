/**
 * Core Layer — XFuelValidationAdapter Hardhat Tests (Verified Inference Phase 3 — ERC-8004)
 *
 * Run: npx hardhat test core-layer/test/XFuelValidationAdapter.test.cjs
 *
 * Covers: verdict submission → registry.validationResponse, provenance mapping, double-answer
 * guard, score range, access control (SUBMITTER_ROLE), registry set, pause.
 *
 * Note: .to.be.reverted is used instead of .revertedWithCustomError — hardhat-chai-matchers@1.x
 * is not compatible with ethers v6 for custom-error matching.
 */

const { expect } = require('chai');
const { ethers } = require('hardhat');

describe('XFuelValidationAdapter', function () {
  let adapter, registry;
  let admin, submitter, stranger;

  const REQ = ethers.keccak256(ethers.toUtf8Bytes('request-1'));
  const AGENT_ID = 42n;
  const RESPONSE_URI = 'https://api.xfuel.app/receipt/task-1';
  const RESPONSE_HASH = ethers.keccak256(ethers.toUtf8Bytes('evidence'));
  const TAG = 'xfuel:settlement';
  const TASK_HASH = ethers.keccak256(ethers.toUtf8Bytes('task-1'));

  beforeEach(async function () {
    [admin, submitter, stranger] = await ethers.getSigners();
    const Registry = await ethers.getContractFactory('MockERC8004ValidationRegistry');
    registry = await Registry.deploy();
    const Adapter = await ethers.getContractFactory('XFuelValidationAdapter');
    adapter = await Adapter.deploy(admin.address, await registry.getAddress());
    await adapter.grantRole(await adapter.SUBMITTER_ROLE(), submitter.address);
  });

  async function submit(signer = submitter, over = {}) {
    return adapter.connect(signer).submitValidation(
      over.requestHash ?? REQ,
      over.agentId ?? AGENT_ID,
      over.response ?? 100,
      over.responseURI ?? RESPONSE_URI,
      over.responseHash ?? RESPONSE_HASH,
      over.tag ?? TAG,
      over.taskIdHash ?? TASK_HASH,
    );
  }

  it('submits a verdict into the ERC-8004 registry (adapter is the validator)', async function () {
    await submit();
    const rec = await registry.getValidationStatus(REQ);
    expect(rec.validatorAddress).to.equal(await adapter.getAddress());
    expect(rec.response).to.equal(100);
    expect(rec.responseHash).to.equal(RESPONSE_HASH);
    expect(rec.tag).to.equal(TAG);
  });

  it('records provenance (requestHash → taskIdHash) and marks answered', async function () {
    await submit();
    const p = await adapter.provenanceOf(REQ);
    expect(p.taskIdHash).to.equal(TASK_HASH);
    expect(p.isAnswered).to.equal(true);
    expect(await adapter.validationsSubmitted()).to.equal(1n);
  });

  it('emits XFuelValidationSubmitted with the verdict', async function () {
    await expect(submit())
      .to.emit(adapter, 'XFuelValidationSubmitted')
      .withArgs(REQ, TASK_HASH, AGENT_ID, 100, TAG);
  });

  it('rejects a second answer for the same request', async function () {
    await submit();
    await expect(submit()).to.be.reverted; // AlreadyAnswered
  });

  it('rejects a score above 100', async function () {
    await expect(submit(submitter, { response: 101 })).to.be.reverted; // ResponseOutOfRange
  });

  it('rejects a zero requestHash', async function () {
    await expect(submit(submitter, { requestHash: ethers.ZeroHash })).to.be.reverted; // ZeroRequestHash
  });

  it('enforces SUBMITTER_ROLE', async function () {
    await expect(submit(stranger)).to.be.reverted; // AccessControl
  });

  it('supports failing verdicts (score 0) — e.g. binding mismatch', async function () {
    await submit(submitter, { response: 0, tag: 'xfuel:binding-mismatch' });
    const rec = await registry.getValidationStatus(REQ);
    expect(rec.response).to.equal(0);
    expect(rec.tag).to.equal('xfuel:binding-mismatch');
  });

  it('setRegistry updates the target (OPERATOR_ROLE) and blocks strangers', async function () {
    const Registry = await ethers.getContractFactory('MockERC8004ValidationRegistry');
    const registry2 = await Registry.deploy();
    await expect(adapter.connect(stranger).setRegistry(await registry2.getAddress())).to.be.reverted;
    await adapter.setRegistry(await registry2.getAddress());
    expect(await adapter.registry()).to.equal(await registry2.getAddress());
  });

  it('pause blocks submission until unpaused', async function () {
    await adapter.pause();
    await expect(submit()).to.be.reverted;
    await adapter.unpause();
    await submit();
    expect(await adapter.validationsSubmitted()).to.equal(1n);
  });
});
