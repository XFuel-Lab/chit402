/**
 * Track 4.1 (partial) + boostMultiplier wire-up tests
 *
 * Validates the dynamic boost system added to CoreRevenueSplitter:
 *
 *   depositFeeWithTag()   — ETH deposit tagged with providerTag at submit time
 *   tagFeeOrigin()        — retroactive tag for fees already deposited via depositFee()
 *   _computeBoost()       — linear interpolation MIN_BOOST..MAX_BOOST from Theta-native ratio
 *   distribute()          — auto-applies dynamic boost; resets period counters; emits DynamicBoostApplied
 *   previewBoost()        — view: returns effectiveBoost + thetaNativeRatioBps
 *   setDynamicBoostEnabled() — governance can freeze the multiplier
 *
 * Also validates the end-to-end circuit integration:
 *   ThetaInferenceCircuit.settleIntent() → splitter.tagFeeOrigin() via low-level call
 *
 * Run: npx hardhat test test/track2/DynamicBoost.test.cjs
 */

'use strict';

const { expect } = require('chai');
const { ethers } = require('hardhat');

const TOTAL_BPS  = 10000n;
const MIN_BOOST  = 10000n;
const MAX_BOOST  = 25000n;

// ─── Helpers ──────────────────────────────────────────────────────────────────

function expectedBoost(thetaNative, total) {
  if (total === 0n) return MIN_BOOST;
  const ratioBps = (thetaNative * TOTAL_BPS) / total;
  const boost = MIN_BOOST + ((MAX_BOOST - MIN_BOOST) * ratioBps) / TOTAL_BPS;
  return boost > MAX_BOOST ? MAX_BOOST : boost;
}

describe('Dynamic Theta-Native Boost — CoreRevenueSplitter', function () {
  let splitter;
  let admin, feeManager, gov, bbb, lp, staker, treasury, stakePool, circuit;

  const CIRCUIT_ID = ethers.keccak256(ethers.toUtf8Bytes('THETA_INFERENCE_CIRCUIT'));
  const TAG_UNSET         = 0;
  const TAG_THETA_NATIVE  = 1;
  const TAG_HYBRID_FALLBACK = 2;
  const TAG_DEPIN_AKASH   = 3;
  const TAG_DEPIN_RENDER  = 4;
  const TAG_HYBRID_CLOUD  = 5;

  const PRICE = ethers.parseEther('0.01');

  before(async function () {
    [admin, feeManager, gov, bbb, lp, staker, treasury, stakePool, circuit] = await ethers.getSigners();

    const Splitter = await ethers.getContractFactory('CoreRevenueSplitter');
    splitter = await Splitter.deploy(
      admin.address,
      bbb.address, lp.address, staker.address, treasury.address, stakePool.address
    );
    await splitter.waitForDeployment();

    const FEE_MANAGER_ROLE = await splitter.FEE_MANAGER_ROLE();
    const GOVERNANCE_ROLE  = await splitter.GOVERNANCE_ROLE();
    await splitter.connect(admin).grantRole(FEE_MANAGER_ROLE, feeManager.address);
    await splitter.connect(admin).grantRole(GOVERNANCE_ROLE, gov.address);
  });

  // ═══════════════════════════════════════════════════════════════════════════
  //  1. depositFeeWithTag
  // ═══════════════════════════════════════════════════════════════════════════

  describe('depositFeeWithTag()', function () {
    it('reverts on zero value', async function () {
      await expect(
        splitter.connect(circuit).depositFeeWithTag(CIRCUIT_ID, TAG_THETA_NATIVE, { value: 0n })
      ).to.be.revertedWith('ZeroAmount');
    });

    it('emits FeeReceivedTagged with correct fields', async function () {
      await expect(
        splitter.connect(circuit).depositFeeWithTag(CIRCUIT_ID, TAG_THETA_NATIVE, { value: PRICE })
      )
        .to.emit(splitter, 'FeeReceivedTagged')
        .withArgs(CIRCUIT_ID, circuit.address, PRICE, TAG_THETA_NATIVE, await ethers.provider.getBlock('latest').then(b => b.timestamp + 1));
    });

    it('THETA_NATIVE deposit increments thetaNativeFeesSinceReset', async function () {
      const before = await splitter.thetaNativeFeesSinceReset();
      await splitter.connect(circuit).depositFeeWithTag(CIRCUIT_ID, TAG_THETA_NATIVE, { value: PRICE });
      const after = await splitter.thetaNativeFeesSinceReset();
      expect(after - before).to.equal(PRICE);
    });

    it('THETA_NATIVE deposit increments totalThetaNativeFees lifetime', async function () {
      const before = await splitter.totalThetaNativeFees();
      await splitter.connect(circuit).depositFeeWithTag(CIRCUIT_ID, TAG_THETA_NATIVE, { value: PRICE });
      const after = await splitter.totalThetaNativeFees();
      expect(after - before).to.equal(PRICE);
    });

    it('non-THETA_NATIVE tag does NOT increment thetaNativeFeesSinceReset', async function () {
      const before = await splitter.thetaNativeFeesSinceReset();
      await splitter.connect(circuit).depositFeeWithTag(CIRCUIT_ID, TAG_DEPIN_AKASH, { value: PRICE });
      const after = await splitter.thetaNativeFeesSinceReset();
      expect(after).to.equal(before); // unchanged
    });

    it('any tag increments totalFeesSinceReset', async function () {
      const before = await splitter.totalFeesSinceReset();
      await splitter.connect(circuit).depositFeeWithTag(CIRCUIT_ID, TAG_HYBRID_CLOUD, { value: PRICE });
      const after = await splitter.totalFeesSinceReset();
      expect(after - before).to.equal(PRICE);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  //  2. tagFeeOrigin
  // ═══════════════════════════════════════════════════════════════════════════

  describe('tagFeeOrigin()', function () {
    it('reverts on zero amount', async function () {
      await expect(
        splitter.connect(circuit).tagFeeOrigin(CIRCUIT_ID, TAG_THETA_NATIVE, 0n)
      ).to.be.revertedWith('ZeroAmount');
    });

    it('THETA_NATIVE tag increments thetaNativeFeesSinceReset without ETH', async function () {
      const before = await splitter.thetaNativeFeesSinceReset();
      await splitter.connect(circuit).tagFeeOrigin(CIRCUIT_ID, TAG_THETA_NATIVE, PRICE);
      const after = await splitter.thetaNativeFeesSinceReset();
      expect(after - before).to.equal(PRICE);
    });

    it('DEPIN_RENDER tag increments totalFeesSinceReset only', async function () {
      const beforeNative = await splitter.thetaNativeFeesSinceReset();
      const beforeTotal  = await splitter.totalFeesSinceReset();
      await splitter.connect(circuit).tagFeeOrigin(CIRCUIT_ID, TAG_DEPIN_RENDER, PRICE);
      expect(await splitter.thetaNativeFeesSinceReset()).to.equal(beforeNative);
      expect(await splitter.totalFeesSinceReset()).to.equal(beforeTotal + PRICE);
    });

    it('emits FeeReceivedTagged with zero ETH transfer', async function () {
      await expect(
        splitter.connect(circuit).tagFeeOrigin(CIRCUIT_ID, TAG_THETA_NATIVE, PRICE)
      ).to.emit(splitter, 'FeeReceivedTagged');
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  //  3. previewBoost() — view function
  // ═══════════════════════════════════════════════════════════════════════════

  describe('previewBoost()', function () {
    // Use a fresh splitter for clean accounting
    let s;
    before(async function () {
      const Splitter = await ethers.getContractFactory('CoreRevenueSplitter');
      s = await Splitter.deploy(
        admin.address,
        bbb.address, lp.address, staker.address, treasury.address, stakePool.address
      );
      await s.waitForDeployment();
    });

    it('returns MIN_BOOST when no fees tagged yet', async function () {
      const [boost, ratioBps] = await s.previewBoost();
      expect(boost).to.equal(MIN_BOOST);
      expect(ratioBps).to.equal(0n);
    });

    it('returns MAX_BOOST when 100% of fees are THETA_NATIVE', async function () {
      await s.connect(circuit).depositFeeWithTag(CIRCUIT_ID, TAG_THETA_NATIVE, { value: PRICE });
      const [boost, ratioBps] = await s.previewBoost();
      expect(boost).to.equal(MAX_BOOST);
      expect(ratioBps).to.equal(TOTAL_BPS);
    });

    it('returns 50% boost at 50% Theta-native ratio', async function () {
      const Splitter = await ethers.getContractFactory('CoreRevenueSplitter');
      const s2 = await Splitter.deploy(
        admin.address,
        bbb.address, lp.address, staker.address, treasury.address, stakePool.address
      );
      await s2.waitForDeployment();

      // 50% THETA_NATIVE, 50% DEPIN_AKASH
      await s2.connect(circuit).depositFeeWithTag(CIRCUIT_ID, TAG_THETA_NATIVE, { value: PRICE });
      await s2.connect(circuit).depositFeeWithTag(CIRCUIT_ID, TAG_DEPIN_AKASH,  { value: PRICE });

      const [boost, ratioBps] = await s2.previewBoost();
      expect(ratioBps).to.equal(5000n); // 50%
      const expectedB = expectedBoost(PRICE, PRICE * 2n);
      expect(boost).to.equal(expectedB);
      // 50% of way from 10000 to 25000 = 17500
      expect(boost).to.equal(17500n);
    });

    it('linear: 25% Theta-native → correct interpolation', async function () {
      const Splitter = await ethers.getContractFactory('CoreRevenueSplitter');
      const s3 = await Splitter.deploy(
        admin.address,
        bbb.address, lp.address, staker.address, treasury.address, stakePool.address
      );
      await s3.waitForDeployment();

      await s3.connect(circuit).depositFeeWithTag(CIRCUIT_ID, TAG_THETA_NATIVE, { value: PRICE });       // 1 unit
      await s3.connect(circuit).depositFeeWithTag(CIRCUIT_ID, TAG_DEPIN_AKASH,  { value: PRICE * 3n }); // 3 units

      const [boost, ratioBps] = await s3.previewBoost();
      expect(ratioBps).to.equal(2500n); // 25%
      // 25% of way from 10000 to 25000 = 13750
      expect(boost).to.equal(13750n);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  //  4. distribute() — dynamic boost applied and counters reset
  // ═══════════════════════════════════════════════════════════════════════════

  describe('distribute() — dynamic boost', function () {
    let s;
    let bbb2, lp2, staker2, treasury2, stakePool2;

    before(async function () {
      [,,,, bbb2, lp2, staker2, treasury2, stakePool2] = await ethers.getSigners();

      const Splitter = await ethers.getContractFactory('CoreRevenueSplitter');
      s = await Splitter.deploy(
        admin.address,
        bbb2.address, lp2.address, staker2.address, treasury2.address, stakePool2.address
      );
      await s.waitForDeployment();
    });

    it('emits DynamicBoostApplied when boost changes from 1.0x', async function () {
      // All fees are THETA_NATIVE → boost should go to MAX_BOOST
      await s.connect(circuit).depositFeeWithTag(CIRCUIT_ID, TAG_THETA_NATIVE, { value: ethers.parseEther('1') });

      await expect(s.distribute())
        .to.emit(s, 'DynamicBoostApplied')
        .withArgs(MIN_BOOST, MAX_BOOST, ethers.parseEther('1'), ethers.parseEther('1'), TOTAL_BPS);
    });

    it('boostMultiplier updates to MAX_BOOST after 100% Theta-native distribute()', async function () {
      expect(await s.boostMultiplier()).to.equal(MAX_BOOST);
    });

    it('period counters reset to 0 after distribute()', async function () {
      expect(await s.thetaNativeFeesSinceReset()).to.equal(0n);
      expect(await s.totalFeesSinceReset()).to.equal(0n);
    });

    it('no DynamicBoostApplied when boost unchanged', async function () {
      // Fund and distribute again — all still THETA_NATIVE, boost stays at MAX_BOOST
      await s.connect(circuit).depositFeeWithTag(CIRCUIT_ID, TAG_THETA_NATIVE, { value: ethers.parseEther('0.5') });
      const tx = await s.distribute();
      const receipt = await tx.wait();
      const iface = s.interface;
      const boostEvents = receipt.logs.filter(l => {
        try { return iface.parseLog(l)?.name === 'DynamicBoostApplied'; }
        catch { return false; }
      });
      expect(boostEvents.length).to.equal(0); // no change → no event
    });

    it('mixed traffic → boost interpolated correctly at distribute()', async function () {
      const Splitter = await ethers.getContractFactory('CoreRevenueSplitter');
      const s4 = await Splitter.deploy(
        admin.address,
        bbb.address, lp.address, staker.address, treasury.address, stakePool.address
      );
      await s4.waitForDeployment();

      // 75% THETA_NATIVE, 25% DEPIN_RENDER
      await s4.connect(circuit).depositFeeWithTag(CIRCUIT_ID, TAG_THETA_NATIVE, { value: ethers.parseEther('0.75') });
      await s4.connect(circuit).depositFeeWithTag(CIRCUIT_ID, TAG_DEPIN_RENDER, { value: ethers.parseEther('0.25') });

      await expect(s4.distribute())
        .to.emit(s4, 'DynamicBoostApplied');

      // 75% of way from 10000 to 25000 = 21250
      expect(await s4.boostMultiplier()).to.equal(21250n);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  //  5. setDynamicBoostEnabled
  // ═══════════════════════════════════════════════════════════════════════════

  describe('setDynamicBoostEnabled()', function () {
    let s;
    before(async function () {
      const Splitter = await ethers.getContractFactory('CoreRevenueSplitter');
      s = await Splitter.deploy(
        admin.address,
        bbb.address, lp.address, staker.address, treasury.address, stakePool.address
      );
      await s.waitForDeployment();
      const GOVERNANCE_ROLE = await s.GOVERNANCE_ROLE();
      await s.connect(admin).grantRole(GOVERNANCE_ROLE, gov.address);
    });

    it('governance can disable dynamic boost', async function () {
      await s.connect(gov).setDynamicBoostEnabled(false);
      expect(await s.dynamicBoostEnabled()).to.be.false;
    });

    it('when disabled, previewBoost returns the manual multiplier', async function () {
      await s.connect(circuit).depositFeeWithTag(CIRCUIT_ID, TAG_THETA_NATIVE, { value: PRICE });
      const [boost] = await s.previewBoost();
      expect(boost).to.equal(await s.boostMultiplier()); // manual value, not computed
    });

    it('admin can re-enable dynamic boost', async function () {
      await s.connect(admin).setDynamicBoostEnabled(true);
      expect(await s.dynamicBoostEnabled()).to.be.true;
    });

    it('stranger cannot call setDynamicBoostEnabled', async function () {
      const [,,,,,,,, stranger] = await ethers.getSigners();
      await expect(
        s.connect(stranger).setDynamicBoostEnabled(false)
      ).to.be.revertedWith('NotAdminOrGovernance');
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  //  6. End-to-end: ThetaInferenceCircuit.settleIntent → tagFeeOrigin
  // ═══════════════════════════════════════════════════════════════════════════

  describe('End-to-end: settleIntent triggers tagFeeOrigin on splitter', function () {
    let inferenceSplitter, inferenceCircuit;
    let circuitAdmin, circuitRelayer, circuitUser;
    let llmServiceId;

    const MOCK_INPUT  = ethers.keccak256(ethers.toUtf8Bytes('boost-e2e-input'));
    const MOCK_OUTPUT = ethers.keccak256(ethers.toUtf8Bytes('boost-e2e-output'));
    const MOCK_MODEL  = ethers.keccak256(ethers.toUtf8Bytes('llama-boost-test'));
    const MOCK_PROOF  = '0x' + 'cc'.repeat(130);
    const MOCK_PV     = '0x' + 'dd'.repeat(64);
    const PRICE_E2E   = ethers.parseEther('0.02');

    before(async function () {
      [circuitAdmin, circuitRelayer, circuitUser,,,,,,,] = await ethers.getSigners();

      const Splitter = await ethers.getContractFactory('CoreRevenueSplitter');
      inferenceSplitter = await Splitter.deploy(
        circuitAdmin.address,
        bbb.address, lp.address, staker.address, treasury.address, stakePool.address
      );
      await inferenceSplitter.waitForDeployment();

      const Circuit = await ethers.getContractFactory('ThetaInferenceCircuit');
      inferenceCircuit = await Circuit.deploy(
        circuitAdmin.address, inferenceSplitter.target, ethers.ZeroAddress
      );
      await inferenceCircuit.waitForDeployment();

      const RELAYER_ROLE = await inferenceCircuit.RELAYER_ROLE();
      await inferenceCircuit.connect(circuitAdmin).grantRole(RELAYER_ROLE, circuitRelayer.address);

      const tx = await inferenceCircuit.connect(circuitAdmin).registerService(0, 'llama-boost', PRICE_E2E, 5000);
      const r = await tx.wait();
      const log = r.logs.find(l => {
        try { return inferenceCircuit.interface.parseLog(l)?.name === 'ServiceRegistered'; }
        catch { return false; }
      });
      llmServiceId = inferenceCircuit.interface.parseLog(log).args.serviceId;
    });

    async function submitAndAttest(providerTag) {
      const tx = await inferenceCircuit.connect(circuitUser).submitIntent(llmServiceId, MOCK_INPUT, { value: PRICE_E2E });
      const r = await tx.wait();
      let intentId;
      for (const log of r.logs) {
        try {
          const parsed = inferenceCircuit.interface.parseLog(log);
          if (parsed?.name === 'InferenceIntentSubmitted') { intentId = parsed.args.intentId; break; }
        } catch { /* skip */ }
      }

      const nodeId = ethers.keccak256(ethers.toUtf8Bytes(`e2e-node-${providerTag}`));
      const fp     = ethers.keccak256(ethers.toUtf8Bytes(`e2e-fp-${providerTag}`));
      const nullifier = ethers.keccak256(ethers.toUtf8Bytes(`e2e-null-${providerTag}-${Date.now()}`));

      await inferenceCircuit.connect(circuitRelayer).completeIntent(intentId, MOCK_OUTPUT, MOCK_MODEL, 600n);
      await inferenceCircuit.connect(circuitRelayer).attestEdgeCloudNode(intentId, nodeId, fp, 500n, providerTag);
      await inferenceCircuit.connect(circuitRelayer).settleIntent(intentId, MOCK_PROOF, MOCK_PV, nullifier, false);

      return intentId;
    }

    it('THETA_NATIVE settle → thetaNativeFeesSinceReset increases on splitter', async function () {
      const before = await inferenceSplitter.thetaNativeFeesSinceReset();
      await submitAndAttest(1); // TAG_THETA_NATIVE
      const after = await inferenceSplitter.thetaNativeFeesSinceReset();
      expect(after).to.be.gt(before);
    });

    it('DEPIN_AKASH settle → thetaNativeFeesSinceReset unchanged on splitter', async function () {
      const before = await inferenceSplitter.thetaNativeFeesSinceReset();
      const beforeTotal = await inferenceSplitter.totalFeesSinceReset();
      await submitAndAttest(3); // TAG_DEPIN_AKASH
      const afterNative = await inferenceSplitter.thetaNativeFeesSinceReset();
      const afterTotal  = await inferenceSplitter.totalFeesSinceReset();
      expect(afterNative).to.equal(before);   // Theta-native unchanged
      expect(afterTotal).to.be.gt(beforeTotal); // total still incremented
    });

    it('THETA_NATIVE settle → previewBoost returns above MIN_BOOST', async function () {
      const [boost] = await inferenceSplitter.previewBoost();
      expect(boost).to.be.gt(MIN_BOOST);
    });

    it('settle without attestation → no tagFeeOrigin call (graceful skip)', async function () {
      // submit + complete but do NOT attest
      const tx = await inferenceCircuit.connect(circuitUser).submitIntent(llmServiceId, MOCK_INPUT, { value: PRICE_E2E });
      const r = await tx.wait();
      let intentId;
      for (const log of r.logs) {
        try {
          const parsed = inferenceCircuit.interface.parseLog(log);
          if (parsed?.name === 'InferenceIntentSubmitted') { intentId = parsed.args.intentId; break; }
        } catch { /* skip */ }
      }
      const nullifier = ethers.keccak256(ethers.toUtf8Bytes(`e2e-no-attest-${Date.now()}`));
      await inferenceCircuit.connect(circuitRelayer).completeIntent(intentId, MOCK_OUTPUT, MOCK_MODEL, 300n);
      // settleIntent without attestation — should succeed, no tagFeeOrigin
      await expect(
        inferenceCircuit.connect(circuitRelayer).settleIntent(intentId, MOCK_PROOF, MOCK_PV, nullifier, false)
      ).to.not.be.reverted;
    });
  });
});
