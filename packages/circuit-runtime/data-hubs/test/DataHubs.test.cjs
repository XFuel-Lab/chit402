/**
 * Data Ownership Hubs Circuit — Hardhat Tests (15 tests)
 *
 * Run: npx hardhat test circuits/data-hubs/test/DataHubs.test.cjs
 */
const { expect } = require('chai');
const { ethers } = require('hardhat');

describe('DataHubs', function () {
  let circuit, splitter;
  let admin, validator, contributor1, contributor2, consumer;
  let bbb, lp, staker, treasury, stakePool;

  const MOCK_PROOF = '0x' + 'ab'.repeat(130);
  const MOCK_PV = '0x' + 'cd'.repeat(64);
  const DATA_COMMIT = ethers.keccak256(ethers.toUtf8Bytes('encrypted-dataset-v1'));
  const PROV_HASH = ethers.keccak256(ethers.toUtf8Bytes('source:twitter,ts:2026'));
  const GOV_HASH = ethers.keccak256(ethers.toUtf8Bytes('majority-vote-gov'));

  let hubId;

  beforeEach(async function () {
    [admin, validator, contributor1, contributor2, consumer, bbb, lp, staker, treasury, stakePool] =
      await ethers.getSigners();

    const SF = await ethers.getContractFactory('CoreRevenueSplitter');
    splitter = await SF.deploy(admin.address, bbb.address, lp.address, staker.address, treasury.address, stakePool.address);
    await splitter.waitForDeployment();

    const CF = await ethers.getContractFactory('DataHubs');
    circuit = await CF.deploy(admin.address, await splitter.getAddress(), ethers.ZeroAddress);
    await circuit.waitForDeployment();

    const VALIDATOR_ROLE = await circuit.VALIDATOR_ROLE();
    await circuit.grantRole(VALIDATOR_ROLE, validator.address);
    const CIRCUIT_ROLE = await splitter.CIRCUIT_ROLE();
    await splitter.grantRole(CIRCUIT_ROLE, await circuit.getAddress());

    // Create a default hub
    const tx = await circuit.createHub('Social Data Hub', 'social', GOV_HASH, 5000, ethers.parseEther('1'));
    const r = await tx.wait();
    const ev = r.logs.find(l => { try { return circuit.interface.parseLog(l)?.name === 'HubCreated'; } catch { return false; } });
    hubId = circuit.interface.parseLog(ev).args.hubId;
  });

  // ═══ HUB MANAGEMENT ═══
  describe('Hub Management', function () {
    it('should create a data hub', async function () {
      const h = await circuit.getHub(hubId);
      expect(h.name).to.equal('Social Data Hub');
      expect(h.category).to.equal('social');
      expect(h.active).to.be.true;
    });

    it('should create multiple hubs of different categories', async function () {
      await circuit.createHub('Financial Hub', 'financial', GOV_HASH, 7000, ethers.parseEther('5'));
      expect(await circuit.hubCount()).to.equal(2n);
    });

    it('should update hub price and status', async function () {
      await circuit.updateHub(hubId, ethers.parseEther('2'), false);
      const h = await circuit.getHub(hubId);
      expect(h.accessPrice).to.equal(ethers.parseEther('2'));
      expect(h.active).to.be.false;
    });
  });

  // ═══ DATA CONTRIBUTION ═══
  describe('Data Contribution', function () {
    it('should accept data contribution', async function () {
      const tx = await circuit.connect(contributor1).contributeData(hubId, DATA_COMMIT, PROV_HASH, 1024000);
      const r = await tx.wait();
      const ev = r.logs.find(l => { try { return circuit.interface.parseLog(l)?.name === 'DataContributed'; } catch { return false; } });
      expect(ev).to.not.be.undefined;
      expect(await circuit.contributionCount()).to.equal(1n);
    });

    it('should reject contribution to inactive hub', async function () {
      await circuit.updateHub(hubId, ethers.parseEther('1'), false);
      await expect(circuit.connect(contributor1).contributeData(hubId, DATA_COMMIT, PROV_HASH, 100)).to.be.reverted;
    });

    it('should reject zero commitment', async function () {
      await expect(circuit.connect(contributor1).contributeData(hubId, ethers.ZeroHash, PROV_HASH, 100)).to.be.revertedWith('ZeroCommitment');
    });
  });

  // ═══ ZK VALIDATION ═══
  describe('ZK Validation', function () {
    let contribId;

    beforeEach(async function () {
      const tx = await circuit.connect(contributor1).contributeData(hubId, DATA_COMMIT, PROV_HASH, 1024000);
      const r = await tx.wait();
      const ev = r.logs.find(l => { try { return circuit.interface.parseLog(l)?.name === 'DataContributed'; } catch { return false; } });
      contribId = circuit.interface.parseLog(ev).args.contributionId;
    });

    it('should validate contribution with passing quality', async function () {
      const null1 = ethers.keccak256(ethers.toUtf8Bytes('val-null-1'));
      await circuit.connect(validator).validateContribution(contribId, 8000, MOCK_PROOF, MOCK_PV, null1);
      const c = await circuit.getContribution(contribId);
      expect(c.status).to.equal(1); // Validated
      expect(c.qualityScore).to.equal(8000n);
    });

    it('should reject contribution below minimum quality', async function () {
      const null1 = ethers.keccak256(ethers.toUtf8Bytes('val-low-q'));
      await circuit.connect(validator).validateContribution(contribId, 2000, MOCK_PROOF, MOCK_PV, null1);
      const c = await circuit.getContribution(contribId);
      expect(c.status).to.equal(2); // Rejected
    });

    it('should reject duplicate nullifier', async function () {
      const null1 = ethers.keccak256(ethers.toUtf8Bytes('val-dup'));
      await circuit.connect(validator).validateContribution(contribId, 8000, MOCK_PROOF, MOCK_PV, null1);

      const tx2 = await circuit.connect(contributor2).contributeData(hubId, ethers.keccak256(ethers.toUtf8Bytes('data2')), PROV_HASH, 500);
      const r2 = await tx2.wait();
      const ev2 = r2.logs.find(l => { try { return circuit.interface.parseLog(l)?.name === 'DataContributed'; } catch { return false; } });
      const cid2 = circuit.interface.parseLog(ev2).args.contributionId;

      await expect(circuit.connect(validator).validateContribution(cid2, 9000, MOCK_PROOF, MOCK_PV, null1)).to.be.reverted;
    });

    it('should assign quality-weighted shares', async function () {
      const null1 = ethers.keccak256(ethers.toUtf8Bytes('share-null'));
      await circuit.connect(validator).validateContribution(contribId, 8000, MOCK_PROOF, MOCK_PV, null1);
      const shares = await circuit.getContributorShares(hubId, contributor1.address);
      expect(shares).to.equal(8000n);
    });
  });

  // ═══ ACCESS & REWARDS ═══
  describe('Access & Rewards', function () {
    let contribId;

    beforeEach(async function () {
      const tx = await circuit.connect(contributor1).contributeData(hubId, DATA_COMMIT, PROV_HASH, 1024000);
      const r = await tx.wait();
      const ev = r.logs.find(l => { try { return circuit.interface.parseLog(l)?.name === 'DataContributed'; } catch { return false; } });
      contribId = circuit.interface.parseLog(ev).args.contributionId;
      const null1 = ethers.keccak256(ethers.toUtf8Bytes('access-val'));
      await circuit.connect(validator).validateContribution(contribId, 8000, MOCK_PROOF, MOCK_PV, null1);
    });

    it('should grant access with fee deduction', async function () {
      const payment = ethers.parseEther('10');
      const expectedFee = ethers.parseEther('0.05'); // 0.5%

      const splitterBefore = await ethers.provider.getBalance(await splitter.getAddress());
      await circuit.connect(consumer).purchaseAccess(hubId, 86400, { value: payment });
      const splitterAfter = await ethers.provider.getBalance(await splitter.getAddress());

      expect(splitterAfter - splitterBefore).to.equal(expectedFee);
      expect(await circuit.grantCount()).to.equal(1n);
    });

    it('should reject insufficient payment', async function () {
      await expect(circuit.connect(consumer).purchaseAccess(hubId, 86400, { value: ethers.parseEther('0.1') })).to.be.reverted;
    });

    it('should allow contributor to claim rewards', async function () {
      await circuit.connect(consumer).purchaseAccess(hubId, 86400, { value: ethers.parseEther('10') });

      const c1Before = await ethers.provider.getBalance(contributor1.address);
      await circuit.connect(contributor1).claimRewards(hubId);
      const c1After = await ethers.provider.getBalance(contributor1.address);
      expect(c1After).to.be.gt(c1Before);
    });
  });

  // ═══ EDGE CASES ═══
  describe('Edge Cases', function () {
    it('should prevent operations when paused', async function () {
      await circuit.pause();
      await expect(circuit.createHub('Fail', 'x', GOV_HASH, 0, 1)).to.be.reverted;
    });

    it('should track global stats', async function () {
      const [h, c, g, v, f, p] = await circuit.getStats();
      expect(h).to.equal(1n);
      expect(c).to.equal(0n);
    });
  });
});
