/**
 * BelieverRound — Hardhat Tests
 *
 * Phase 1 params: 2,000,000 TFUEL hard cap, 5 XF/TFUEL base, 100 TFUEL min, optional lock tiers.
 *
 * Run: npx hardhat test believer/test/BelieverRound.test.cjs
 */
const { expect } = require('chai');
const hre = require('hardhat');
const { ethers } = hre;

async function increaseTime(seconds) {
  await hre.network.provider.send('evm_increaseTime', [seconds]);
  await hre.network.provider.send('evm_mine');
}

describe('BelieverRound', function () {
  let round, mockToken;
  let admin, believer1, believer2, believer3, treasury;

  const HARD_CAP = ethers.parseEther('2000000');
  const MAX_PER_WALLET = 0n;
  const PRICE_NUM = 5n;
  const PRICE_DEN = 1n;
  const PHASE = 1;
  const MIN = ethers.parseEther('100');
  const XF_CAP = ethers.parseEther('150000000');

  const CLIFF = 90 * 24 * 60 * 60;
  const VESTING = 270 * 24 * 60 * 60;
  const DAY = 24 * 60 * 60;

  beforeEach(async function () {
    [admin, believer1, believer2, believer3, treasury] = await ethers.getSigners();

    const TokenF = await ethers.getContractFactory('MockERC20');
    mockToken = await TokenF.deploy('XFuel Token', 'XF', 18);
    await mockToken.waitForDeployment();
    await mockToken.mint(admin.address, ethers.parseEther('100000000'));

    const RF = await ethers.getContractFactory('BelieverRound');
    round = await RF.deploy(admin.address, HARD_CAP, MAX_PER_WALLET, PRICE_NUM, PRICE_DEN, PHASE, XF_CAP, MIN);
    await round.waitForDeployment();
  });

  describe('Commitment Phase', function () {
    it('should accept commitment at minimum (100 TFUEL) with commit()', async function () {
      await round.connect(believer1).commit({ value: MIN });
      const c = await round.getCommitment(believer1.address);
      expect(c.amount).to.equal(MIN);
      expect(c.lockTier).to.equal(0);
      expect(await round.totalCommitted()).to.equal(MIN);
      expect(await round.totalBelievers()).to.equal(1n);
    });

    it('should accept commitWithLock tier 3 and reserve bonus XF', async function () {
      await round.connect(believer1).commitWithLock(3, { value: MIN });
      const reserved = await round.totalXFReserved();
      const base = (MIN * PRICE_NUM) / PRICE_DEN;
      const expected = (base * 13500n) / 10000n;
      expect(reserved).to.equal(expected);
    });

    it('should reject second commit with different lock tier', async function () {
      await round.connect(believer1).commitWithLock(1, { value: ethers.parseEther('200') });
      await expect(
        round.connect(believer1).commitWithLock(2, { value: ethers.parseEther('100') })
      ).to.be.revertedWithCustomError(round, 'LockTierMismatch');
    });

    it('should reject invalid lock tier', async function () {
      await expect(
        round.connect(believer1).commitWithLock(4, { value: MIN })
      ).to.be.revertedWithCustomError(round, 'BadLockTier');
    });

    it('should revert when XF allocation cap would be exceeded', async function () {
      const RF = await ethers.getContractFactory('BelieverRound');
      const tinyCap = ethers.parseEther('400');
      const r = await RF.deploy(admin.address, HARD_CAP, MAX_PER_WALLET, PRICE_NUM, PRICE_DEN, PHASE, tinyCap, MIN);
      await r.waitForDeployment();
      // 100 TFUEL × 5 XF/TFUEL = 500 XF > 400 XF cap
      await expect(r.connect(believer1).commit({ value: MIN })).to.be.revertedWithCustomError(r, 'ExceedsXFAllocationCap');
    });

    it('should allow admin setTokenPrice while Open', async function () {
      await round.connect(admin).setTokenPrice(30n, 1n);
      expect(await round.tokenPriceNumerator()).to.equal(30n);
      expect(await round.tokenPriceDenominator()).to.equal(1n);
    });

    it('should reject commitment below 100 TFUEL minimum', async function () {
      await expect(round.connect(believer1).commit({ value: ethers.parseEther('50') })).to.be.reverted;
    });
  });

  describe('TGE & Vesting', function () {
    const B1_TFUEL = ethers.parseEther('500');
    const B2_TFUEL = ethers.parseEther('1000');
    const B1_XF = ethers.parseEther('2500');
    const B2_XF = ethers.parseEther('5000');
    const TOTAL_XF = ethers.parseEther('7500');

    beforeEach(async function () {
      await round.connect(believer1).commit({ value: B1_TFUEL });
      await round.connect(believer2).commit({ value: B2_TFUEL });
      await round.closeRound();
      await mockToken.approve(await round.getAddress(), TOTAL_XF);
    });

    it('should trigger TGE and set totalTokensAllocated from totalXFReserved', async function () {
      await round.triggerTGE(await mockToken.getAddress());
      expect(await round.status()).to.equal(2);
      expect(await round.totalTokensAllocated()).to.equal(TOTAL_XF);
      expect(await round.totalXFReserved()).to.equal(TOTAL_XF);
    });

    it('should return 0 claimable during cliff', async function () {
      await round.triggerTGE(await mockToken.getAddress());
      expect(await round.claimable(believer1.address)).to.equal(0n);
    });

    it('should vest linearly after cliff (half vesting period ~50% tokens)', async function () {
      await round.triggerTGE(await mockToken.getAddress());
      await increaseTime(CLIFF + VESTING / 2);

      const claimable1 = await round.claimable(believer1.address);
      expect(claimable1).to.be.closeTo(ethers.parseEther('1250'), ethers.parseEther('100'));
    });

    it('should allow full claim after vesting for tier 0', async function () {
      await round.triggerTGE(await mockToken.getAddress());
      await increaseTime(CLIFF + VESTING + 1);

      expect(await round.claimable(believer1.address)).to.equal(B1_XF);
      await round.connect(believer1).claim();
      expect(await mockToken.balanceOf(believer1.address)).to.equal(B1_XF);
    });

    it('should block claim for tier 1 until 365 days after TGE even if vested', async function () {
      const RF = await ethers.getContractFactory('BelieverRound');
      const r = await RF.deploy(admin.address, HARD_CAP, MAX_PER_WALLET, PRICE_NUM, PRICE_DEN, PHASE, XF_CAP, MIN);
      await r.waitForDeployment();

      await r.connect(believer3).commitWithLock(1, { value: ethers.parseEther('100') });
      await r.closeRound();

      const xfB3 = (ethers.parseEther('100') * PRICE_NUM * 10800n) / (PRICE_DEN * 10000n);
      await mockToken.approve(await r.getAddress(), xfB3);
      await r.triggerTGE(await mockToken.getAddress());

      await increaseTime(CLIFF + VESTING + 2 * DAY);

      await expect(r.connect(believer3).claim()).to.be.revertedWithCustomError(r, 'LockPeriodActive');

      await increaseTime(5 * DAY);

      await r.connect(believer3).claim();
      expect(await mockToken.balanceOf(believer3.address)).to.equal(xfB3);
    });
  });

  describe('Refund Safety', function () {
    it('should allow full refund after deadline if no TGE and adjust totals', async function () {
      await round.connect(believer1).commitWithLock(2, { value: ethers.parseEther('500') });
      const reservedBefore = await round.totalXFReserved();
      expect(reservedBefore).to.be.gt(0n);

      await increaseTime(180 * DAY + 1);
      await round.connect(believer1).requestRefund();

      expect(await round.totalCommitted()).to.equal(0n);
      expect(await round.totalXFReserved()).to.equal(0n);
    });

    it('should reject refund before 180-day deadline', async function () {
      await round.connect(believer1).commit({ value: MIN });
      await expect(round.connect(believer1).requestRefund()).to.be.reverted;
    });
  });

  describe('Admin', function () {
    it('should allow admin to withdraw TFUEL after TGE', async function () {
      const commitment = ethers.parseEther('200');
      await round.connect(believer1).commit({ value: commitment });
      await round.closeRound();

      const tokensNeeded = ethers.parseEther('1000');
      await mockToken.approve(await round.getAddress(), tokensNeeded);
      await round.triggerTGE(await mockToken.getAddress());

      const before = await ethers.provider.getBalance(treasury.address);
      await round.withdrawFunds(treasury.address);
      const after = await ethers.provider.getBalance(treasury.address);
      expect(after - before).to.equal(commitment);
    });
  });
});
