/**
 * CoreRevenueSplitter — GET Mechanics Tests (6 tests)
 *
 * Run: npx hardhat test test/core/CoreRevenueSplitter.test.cjs
 *
 * Covers: GET sub-split ratios, boost multipliers, grant submission,
 * grant voting, grant expiry/auto-burn, distribution with boost.
 */

const { expect } = require('chai');
const { ethers } = require('hardhat');

describe('CoreRevenueSplitter — GET Mechanics', function () {
  let splitter, splitterAddr;
  let admin, bbb, getW, staker, treasury, pool, user, recipient, voter;

  beforeEach(async function () {
    [admin, bbb, getW, staker, treasury, pool, user, recipient, voter] =
      await ethers.getSigners();

    const SplitterF = await ethers.getContractFactory('CoreRevenueSplitter');
    splitter = await SplitterF.deploy(
      admin.address, bbb.address, getW.address,
      staker.address, treasury.address, pool.address
    );
    await splitter.waitForDeployment();
    splitterAddr = await splitter.getAddress();
  });

  // ─── 1. Sub-split ratios ──────────────────────────────────────────────────

  describe('Sub-split ratios', function () {
    it('should default to 50/30/20 and allow admin to update', async function () {
      const [inc, lpB, gr] = await splitter.getSubSplit();
      expect(inc).to.equal(5000);
      expect(lpB).to.equal(3000);
      expect(gr).to.equal(2000);

      await splitter.connect(admin).setSubSplits(6000, 2500, 1500);

      const [inc2, lpB2, gr2] = await splitter.getSubSplit();
      expect(inc2).to.equal(6000);
      expect(lpB2).to.equal(2500);
      expect(gr2).to.equal(1500);
    });

    it('should revert if sub-split BPS do not sum to 10000', async function () {
      await expect(
        splitter.connect(admin).setSubSplits(5000, 3000, 3000)
      ).to.be.reverted;
    });
  });

  // ─── 2. Boost multipliers ────────────────────────────────────────────────

  describe('Boost multipliers', function () {
    it('should update boost and reject out-of-range values', async function () {
      expect(await splitter.boostMultiplier()).to.equal(10000);

      await splitter.connect(admin).volumeTriggeredBoost(25000);
      expect(await splitter.boostMultiplier()).to.equal(25000);

      await expect(
        splitter.connect(admin).volumeTriggeredBoost(9999)
      ).to.be.reverted;

      await expect(
        splitter.connect(admin).volumeTriggeredBoost(25001)
      ).to.be.reverted;
    });

    it('should apply boost multiplier in distribute()', async function () {
      await splitter.connect(admin).volumeTriggeredBoost(20000); // 2.0x

      const amount = ethers.parseEther('10');
      await user.sendTransaction({ to: splitterAddr, value: amount });
      await splitter.distribute();

      // GET = 30% of 10 = 3 ETH
      // Incentives raw = 50% of 3 = 1.5 ETH, boosted = 1.5 * 2.0 = 3.0 ETH (capped at getAmount)
      const stats = await splitter.totalIncentivesDistributed();
      expect(stats).to.be.gt(0);

      const totalGet = await splitter.totalGET();
      expect(totalGet).to.equal(ethers.parseEther('3'));
    });
  });

  // ─── 3. Grant submission ─────────────────────────────────────────────────

  describe('Grant submission', function () {
    it('should submit a grant proposal and allow voting', async function () {
      // First distribute to build grant pool
      await user.sendTransaction({ to: splitterAddr, value: ethers.parseEther('100') });
      await splitter.distribute();

      const poolBal = await splitter.grantPoolBalance();
      expect(poolBal).to.be.gt(0);

      const proposalId = ethers.keccak256(ethers.toUtf8Bytes('grant-001'));
      const grantAmount = poolBal / 100n; // well under 5% cap

      const tx = await splitter.connect(user).agentGrantProposal(
        proposalId, grantAmount, recipient.address
      );
      await tx.wait();

      const proposal = await splitter.getGrantProposal(1);
      expect(proposal.recipient).to.equal(recipient.address);
      expect(proposal.amount).to.equal(grantAmount);
      expect(proposal.submitter).to.equal(user.address);
      expect(proposal.executed).to.equal(false);
    });
  });

  // ─── 4. Grant voting and execution ───────────────────────────────────────

  describe('Grant vote and execution', function () {
    it('should execute grant after positive vote', async function () {
      await user.sendTransaction({ to: splitterAddr, value: ethers.parseEther('100') });
      await splitter.distribute();

      const poolBal = await splitter.grantPoolBalance();
      const proposalId = ethers.keccak256(ethers.toUtf8Bytes('grant-exec'));
      const grantAmount = poolBal / 100n;

      await splitter.connect(user).agentGrantProposal(
        proposalId, grantAmount, recipient.address
      );

      // Admin has GOVERNANCE_ROLE
      await splitter.connect(admin).voteGrant(1, true);

      const recipientBefore = await ethers.provider.getBalance(recipient.address);
      await splitter.connect(user).claimGrant(1);
      const recipientAfter = await ethers.provider.getBalance(recipient.address);

      expect(recipientAfter - recipientBefore).to.equal(grantAmount);

      const proposal = await splitter.getGrantProposal(1);
      expect(proposal.executed).to.equal(true);
    });
  });

  // ─── 5. Grant auto-burn on expiry ────────────────────────────────────────

  describe('Grant expiry and auto-burn', function () {
    it('should auto-burn (cancel) a grant after 6 months', async function () {
      await user.sendTransaction({ to: splitterAddr, value: ethers.parseEther('100') });
      await splitter.distribute();

      const poolBal = await splitter.grantPoolBalance();
      const proposalId = ethers.keccak256(ethers.toUtf8Bytes('grant-burn'));
      const grantAmount = poolBal / 100n;

      await splitter.connect(user).agentGrantProposal(
        proposalId, grantAmount, recipient.address
      );

      // Fast forward 181 days (past GRANT_EXPIRY = 180 days)
      await ethers.provider.send('evm_increaseTime', [181 * 24 * 3600]);
      await ethers.provider.send('evm_mine', []);

      const tx = await splitter.connect(user).claimGrant(1);
      const receipt = await tx.wait();

      // Verify GrantBurned event was emitted
      const burnEvent = receipt.logs.find(
        log => log.fragment && log.fragment.name === 'GrantBurned'
      );
      expect(burnEvent).to.not.be.undefined;

      const proposal = await splitter.getGrantProposal(1);
      expect(proposal.cancelled).to.equal(true);
      expect(proposal.executed).to.equal(false);
    });
  });

  // ─── 6. Distribution with GET rename ────────────────────────────────────

  describe('Distribution with GET rename', function () {
    it('should distribute to getWallet and track totalGET', async function () {
      const amount = ethers.parseEther('10');
      await user.sendTransaction({ to: splitterAddr, value: amount });

      const getBefore = await ethers.provider.getBalance(getW.address);
      await splitter.distribute();
      const getAfter = await ethers.provider.getBalance(getW.address);

      // GET total accounting = 30% of 10 = 3 ETH
      expect(await splitter.totalGET()).to.equal(ethers.parseEther('3'));

      // GET wallet receives incentives + LP boost portions (grants stay in contract)
      const getReceived = getAfter - getBefore;
      expect(getReceived).to.be.gt(0);
      expect(getReceived).to.be.lte(ethers.parseEther('3'));

      // Grant pool should hold the grants portion in-contract
      const grantPool = await splitter.grantPoolBalance();
      expect(grantPool).to.be.gt(0);

      // Verify sub-split tracking sums to total GET
      const totalInc = await splitter.totalIncentivesDistributed();
      const totalLPBoost = await splitter.totalLPBoostDistributed();
      const totalGrants = await splitter.totalGrantsDistributed();
      expect(totalInc + totalLPBoost + totalGrants).to.equal(ethers.parseEther('3'));
    });
  });
});
