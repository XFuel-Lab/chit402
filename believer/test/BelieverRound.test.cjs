/**
 * BelieverRound — Hardhat Tests (15 tests)
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
  let admin, operator, believer1, believer2, believer3, treasury;

  const HARD_CAP = ethers.parseEther('100');
  const MAX_PER_WALLET = ethers.parseEther('5');
  const PRICE_NUM = 10000n; // 10,000 XF per 1 ETH
  const PRICE_DEN = 1n;

  const CLIFF = 90 * 24 * 60 * 60;   // 90 days
  const VESTING = 365 * 24 * 60 * 60; // 365 days

  beforeEach(async function () {
    [admin, operator, believer1, believer2, believer3, treasury] = await ethers.getSigners();

    // Deploy mock ERC20 token (existing MockERC20: name, symbol, decimals + mint)
    const TokenF = await ethers.getContractFactory('MockERC20');
    mockToken = await TokenF.deploy('XFuel Token', 'XF', 18);
    await mockToken.waitForDeployment();
    await mockToken.mint(admin.address, ethers.parseEther('10000000'));

    // Deploy BelieverRound
    const RF = await ethers.getContractFactory('BelieverRound');
    round = await RF.deploy(admin.address, HARD_CAP, MAX_PER_WALLET, PRICE_NUM, PRICE_DEN);
    await round.waitForDeployment();
  });

  // ═══ COMMITMENT PHASE ═══
  describe('Commitment Phase', function () {
    it('should accept commitment within limits', async function () {
      await round.connect(believer1).commit({ value: ethers.parseEther('1') });
      const c = await round.getCommitment(believer1.address);
      expect(c.amount).to.equal(ethers.parseEther('1'));
      expect(await round.totalCommitted()).to.equal(ethers.parseEther('1'));
      expect(await round.totalBelievers()).to.equal(1n);
    });

    it('should accept multiple commitments from same wallet', async function () {
      await round.connect(believer1).commit({ value: ethers.parseEther('2') });
      await round.connect(believer1).commit({ value: ethers.parseEther('1') });
      const c = await round.getCommitment(believer1.address);
      expect(c.amount).to.equal(ethers.parseEther('3'));
      expect(await round.totalBelievers()).to.equal(1n); // Still 1 believer
    });

    it('should reject commitment below minimum', async function () {
      await expect(round.connect(believer1).commit({ value: ethers.parseEther('0.001') })).to.be.reverted;
    });

    it('should reject commitment exceeding wallet cap', async function () {
      await round.connect(believer1).commit({ value: ethers.parseEther('4') });
      await expect(round.connect(believer1).commit({ value: ethers.parseEther('2') })).to.be.reverted;
    });

    it('should reject commitment exceeding hard cap', async function () {
      // Deploy a small-cap round to test hard cap easily
      const SmallF = await ethers.getContractFactory('BelieverRound');
      const smallRound = await SmallF.deploy(
        admin.address,
        ethers.parseEther('2'), // 2 ETH hard cap
        ethers.parseEther('2'), // 2 ETH per wallet
        PRICE_NUM,
        PRICE_DEN
      );
      await smallRound.waitForDeployment();

      await smallRound.connect(believer1).commit({ value: ethers.parseEther('1.5') });
      // This should exceed the 2 ETH hard cap
      await expect(smallRound.connect(believer2).commit({ value: ethers.parseEther('1') })).to.be.reverted;
    });

    it('should track multiple believers', async function () {
      await round.connect(believer1).commit({ value: ethers.parseEther('1') });
      await round.connect(believer2).commit({ value: ethers.parseEther('2') });
      await round.connect(believer3).commit({ value: ethers.parseEther('0.5') });
      expect(await round.totalBelievers()).to.equal(3n);
      expect(await round.totalCommitted()).to.equal(ethers.parseEther('3.5'));
    });
  });

  // ═══ ROUND MANAGEMENT ═══
  describe('Round Management', function () {
    it('should close round', async function () {
      await round.connect(believer1).commit({ value: ethers.parseEther('1') });
      await round.closeRound();
      expect(await round.status()).to.equal(1); // Closed
    });

    it('should reject commitment after close', async function () {
      await round.closeRound();
      await expect(round.connect(believer1).commit({ value: ethers.parseEther('1') })).to.be.reverted;
    });
  });

  // ═══ TGE & VESTING ═══
  describe('TGE & Vesting', function () {
    let roundAddr;

    beforeEach(async function () {
      await round.connect(believer1).commit({ value: ethers.parseEther('1') });
      await round.connect(believer2).commit({ value: ethers.parseEther('2') });
      await round.closeRound();
      roundAddr = await round.getAddress();

      // Approve tokens for TGE
      const totalTokens = ethers.parseEther('30000'); // 3 ETH * 10000
      await mockToken.approve(roundAddr, totalTokens);
    });

    it('should trigger TGE and allocate tokens', async function () {
      await round.triggerTGE(await mockToken.getAddress());
      expect(await round.status()).to.equal(2); // TGETriggered
      expect(await round.totalTokensAllocated()).to.equal(ethers.parseEther('30000'));
    });

    it('should return 0 claimable during cliff', async function () {
      await round.triggerTGE(await mockToken.getAddress());
      expect(await round.claimable(believer1.address)).to.equal(0n);
    });

    it('should vest linearly after cliff', async function () {
      await round.triggerTGE(await mockToken.getAddress());

      // Advance past cliff + half vesting
      await increaseTime(CLIFF + VESTING / 2);

      const c1 = await round.claimable(believer1.address);
      // believer1 committed 1 ETH → 10,000 XF; half of that ≈ 5,000
      expect(c1).to.be.closeTo(ethers.parseEther('5000'), ethers.parseEther('50'));
    });

    it('should allow full claim after total vesting', async function () {
      await round.triggerTGE(await mockToken.getAddress());

      // Advance past cliff + full vesting
      await increaseTime(CLIFF + VESTING + 1);

      const c1 = await round.claimable(believer1.address);
      expect(c1).to.equal(ethers.parseEther('10000'));

      await round.connect(believer1).claim();
      expect(await mockToken.balanceOf(believer1.address)).to.equal(ethers.parseEther('10000'));
    });

    it('should handle partial claims correctly', async function () {
      await round.triggerTGE(await mockToken.getAddress());

      // Advance past cliff + quarter vesting
      await increaseTime(CLIFF + VESTING / 4);
      await round.connect(believer2).claim();
      const bal1 = await mockToken.balanceOf(believer2.address);
      expect(bal1).to.be.gt(0n);

      // Advance to full vesting
      await increaseTime(VESTING);
      await round.connect(believer2).claim();
      const balFinal = await mockToken.balanceOf(believer2.address);
      // believer2 committed 2 ETH → 20,000 XF total
      expect(balFinal).to.equal(ethers.parseEther('20000'));
    });
  });

  // ═══ REFUND SAFETY ═══
  describe('Refund Safety', function () {
    it('should refund after deadline if no TGE', async function () {
      await round.connect(believer1).commit({ value: ethers.parseEther('2') });
      const before = await ethers.provider.getBalance(believer1.address);

      // Advance past refund deadline
      await increaseTime(180 * 24 * 60 * 60 + 1);
      await round.connect(believer1).requestRefund();

      const after = await ethers.provider.getBalance(believer1.address);
      expect(after).to.be.gt(before);
    });

    it('should reject refund before deadline', async function () {
      await round.connect(believer1).commit({ value: ethers.parseEther('1') });
      await expect(round.connect(believer1).requestRefund()).to.be.reverted;
    });
  });

  // ═══ ADMIN ═══
  describe('Admin', function () {
    it('should withdraw funds after TGE', async function () {
      await round.connect(believer1).commit({ value: ethers.parseEther('5') });
      await round.closeRound();

      const totalTokens = ethers.parseEther('50000');
      await mockToken.approve(await round.getAddress(), totalTokens);
      await round.triggerTGE(await mockToken.getAddress());

      const before = await ethers.provider.getBalance(treasury.address);
      await round.withdrawFunds(treasury.address);
      const after = await ethers.provider.getBalance(treasury.address);
      expect(after - before).to.equal(ethers.parseEther('5'));
    });
  });
});
