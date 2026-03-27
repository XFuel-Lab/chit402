/**
 * AngelRound — Hardhat tests (pre-TGE treasury pull, no refunds, separate TGE from BelieverRound).
 *
 * Run: npx hardhat test believer/test/AngelRound.test.cjs
 */
const { expect } = require('chai');
const hre = require('hardhat');
const { ethers } = hre;

async function increaseTime(seconds) {
  await hre.network.provider.send('evm_increaseTime', [seconds]);
  await hre.network.provider.send('evm_mine');
}

describe('AngelRound', function () {
  let round, mockToken;
  let admin, angel1, angel2, treasury;

  const HARD_CAP = ethers.parseEther('1000000');
  const MAX_PER_WALLET = 0n;
  const MIN = ethers.parseEther('100');
  const PRICE_NUM = 35n;
  const PRICE_DEN = 1n;
  const PHASE = 1;

  const CLIFF = 90 * 24 * 60 * 60;
  const VESTING = 270 * 24 * 60 * 60;

  beforeEach(async function () {
    [admin, angel1, angel2, treasury] = await ethers.getSigners();

    const TokenF = await ethers.getContractFactory('MockERC20');
    mockToken = await TokenF.deploy('XFuel Token', 'XF', 18);
    await mockToken.waitForDeployment();
    await mockToken.mint(admin.address, ethers.parseEther('100000000'));

    const RF = await ethers.getContractFactory('AngelRound');
    round = await RF.deploy(admin.address, HARD_CAP, MAX_PER_WALLET, MIN, PRICE_NUM, PRICE_DEN, PHASE);
    await round.waitForDeployment();
  });

  describe('Commitment', function () {
    it('accepts commit at minimum', async function () {
      await round.connect(angel1).commit({ value: MIN });
      const c = await round.getCommitment(angel1.address);
      expect(c.amount).to.equal(MIN);
      expect(await round.totalCommitted()).to.equal(MIN);
      expect(await round.totalAngels()).to.equal(1n);
      expect(await round.totalXFReserved()).to.equal((MIN * PRICE_NUM) / PRICE_DEN);
    });

    it('rejects below minimum', async function () {
      await expect(round.connect(angel1).commit({ value: ethers.parseEther('50') })).to.be.revertedWithCustomError(
        round,
        'BelowMinimum'
      );
    });
  });

  describe('Treasury withdraw (pre-TGE)', function () {
    it('admin can withdraw TFUEL to treasury before TGE', async function () {
      const amt = ethers.parseEther('500');
      await round.connect(angel1).commit({ value: amt });

      const before = await ethers.provider.getBalance(treasury.address);
      await round.connect(admin).withdrawToTreasury(treasury.address, ethers.parseEther('200'), 'audit');
      const after = await ethers.provider.getBalance(treasury.address);

      expect(after - before).to.equal(ethers.parseEther('200'));
      expect(await round.totalTreasuryWithdrawn()).to.equal(ethers.parseEther('200'));
      expect(await ethers.provider.getBalance(await round.getAddress())).to.equal(ethers.parseEther('300'));
    });

    it('rejects treasury withdraw after TGE', async function () {
      const commit = ethers.parseEther('200');
      await round.connect(angel1).commit({ value: commit });
      await round.connect(admin).closeRound();

      const xfNeeded = (commit * PRICE_NUM) / PRICE_DEN;
      await mockToken.connect(admin).approve(await round.getAddress(), xfNeeded);
      await round.connect(admin).triggerTGE(await mockToken.getAddress());

      await expect(
        round.connect(admin).withdrawToTreasury(treasury.address, ethers.parseEther('1'), 'too late')
      ).to.be.revertedWithCustomError(round, 'TreasuryWithdrawAfterTGE');
    });
  });

  describe('TGE & vesting', function () {
    const A1 = ethers.parseEther('400');
    const A2 = ethers.parseEther('600');
    const XF1 = (A1 * PRICE_NUM) / PRICE_DEN;
    const XF2 = (A2 * PRICE_NUM) / PRICE_DEN;
    const TOTAL_XF = XF1 + XF2;

    beforeEach(async function () {
      await round.connect(angel1).commit({ value: A1 });
      await round.connect(angel2).commit({ value: A2 });
      await round.connect(admin).closeRound();
      await mockToken.connect(admin).approve(await round.getAddress(), TOTAL_XF);
    });

    it('triggerTGE sets status and pulls XF', async function () {
      await round.connect(admin).triggerTGE(await mockToken.getAddress());
      expect(await round.status()).to.equal(2);
      expect(await round.totalTokensAllocated()).to.equal(TOTAL_XF);
      expect(await mockToken.balanceOf(await round.getAddress())).to.equal(TOTAL_XF);
    });

    it('claimable is zero during cliff', async function () {
      await round.connect(admin).triggerTGE(await mockToken.getAddress());
      expect(await round.claimable(angel1.address)).to.equal(0n);
    });

    it('full claim after cliff + vesting', async function () {
      await round.connect(admin).triggerTGE(await mockToken.getAddress());
      await increaseTime(CLIFF + VESTING + 1);

      expect(await round.claimable(angel1.address)).to.equal(XF1);
      await round.connect(angel1).claim();
      expect(await mockToken.balanceOf(angel1.address)).to.equal(XF1);
    });
  });

  describe('Post-TGE TFUEL sweep', function () {
    it('withdrawFunds sends remaining native balance to treasury', async function () {
      const commit = ethers.parseEther('300');
      await round.connect(angel1).commit({ value: commit });
      await round.connect(admin).closeRound();

      const xf = (commit * PRICE_NUM) / PRICE_DEN;
      await mockToken.connect(admin).approve(await round.getAddress(), xf);
      await round.connect(admin).triggerTGE(await mockToken.getAddress());

      const before = await ethers.provider.getBalance(treasury.address);
      await round.connect(admin).withdrawFunds(treasury.address);
      const after = await ethers.provider.getBalance(treasury.address);
      expect(after - before).to.equal(commit);
    });
  });
});
