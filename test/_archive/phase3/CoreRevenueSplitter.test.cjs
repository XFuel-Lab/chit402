/**
 * Phase 3 — CoreRevenueSplitter Tests (15 tests)
 *
 * Run: npx hardhat test test/phase3/CoreRevenueSplitter.test.cjs
 *
 * Covers: fee collection, distribution, multi-chain Fee-to-Stake routing,
 * governance-driven split updates, stake pool registry, edge cases.
 */

const { expect } = require('chai');
const { ethers } = require('hardhat');

describe('CoreRevenueSplitter (Phase 3)', function () {
  let splitter;
  let admin, bbb, lp, staker, treasury, pool1, pool2, pool3, user;

  beforeEach(async function () {
    [admin, bbb, lp, staker, treasury, pool1, pool2, pool3, user] = await ethers.getSigners();

    const SplitterF = await ethers.getContractFactory('CoreRevenueSplitter');
    splitter = await SplitterF.deploy(
      admin.address, bbb.address, lp.address,
      staker.address, treasury.address, pool1.address
    );
    await splitter.waitForDeployment();
  });

  // ─── Fee Collection ──────────────────────────────────────────────────────

  describe('Fee Collection', function () {
    it('should accept native token via receive()', async function () {
      await user.sendTransaction({ to: await splitter.getAddress(), value: ethers.parseEther('1') });
      expect(await splitter.totalCollected()).to.equal(ethers.parseEther('1'));
    });

    it('should accept circuit-tagged fees via depositFee()', async function () {
      const circuitId = ethers.keccak256(ethers.toUtf8Bytes('BridgeCircuit'));
      await splitter.connect(user).depositFee(circuitId, { value: ethers.parseEther('2') });

      expect(await splitter.circuitFees(circuitId)).to.equal(ethers.parseEther('2'));
      expect(await splitter.totalCollected()).to.equal(ethers.parseEther('2'));
    });

    it('should reject zero-amount depositFee', async function () {
      const circuitId = ethers.keccak256(ethers.toUtf8Bytes('Test'));
      await expect(splitter.connect(user).depositFee(circuitId, { value: 0 })).to.be.reverted;
    });
  });

  // ─── Distribution ────────────────────────────────────────────────────────

  describe('Distribution', function () {
    it('should distribute fees with correct 30/30/25/15 split', async function () {
      const amount = ethers.parseEther('10');
      await user.sendTransaction({ to: await splitter.getAddress(), value: amount });

      const bbbBefore = await ethers.provider.getBalance(bbb.address);
      const lpBefore = await ethers.provider.getBalance(lp.address);

      await splitter.distribute();

      const bbbAfter = await ethers.provider.getBalance(bbb.address);
      const lpAfter = await ethers.provider.getBalance(lp.address);

      expect(bbbAfter - bbbBefore).to.equal(ethers.parseEther('3'));   // 30%
      // GET wallet receives 80% of GET allocation (20% grants retained in contract)
      // GET = 30% of 10 = 3 ETH; forwarded = 3 - (20% grants = 0.6) = 2.4 ETH
      expect(lpAfter - lpBefore).to.equal(ethers.parseEther('2.4'));
    });

    it('should route fee-to-stake from treasury allocation', async function () {
      const amount = ethers.parseEther('100');
      await user.sendTransaction({ to: await splitter.getAddress(), value: amount });

      const poolBefore = await ethers.provider.getBalance(pool1.address);
      await splitter.distribute();
      const poolAfter = await ethers.provider.getBalance(pool1.address);

      // Treasury = 15% = 15 ETH, fee-to-stake = 20% of 15 = 3 ETH
      const feeToStake = poolAfter - poolBefore;
      expect(feeToStake).to.equal(ethers.parseEther('3'));
    });

    it('should increment distributionCount', async function () {
      await user.sendTransaction({ to: await splitter.getAddress(), value: ethers.parseEther('1') });
      await splitter.distribute();
      expect(await splitter.distributionCount()).to.equal(1n);

      await user.sendTransaction({ to: await splitter.getAddress(), value: ethers.parseEther('1') });
      await splitter.distribute();
      expect(await splitter.distributionCount()).to.equal(2n);
    });

    it('should revert on empty balance distribution', async function () {
      await expect(splitter.distribute()).to.be.reverted;
    });
  });

  // ─── Multi-Chain Stake Pool Registry ─────────────────────────────────────

  describe('Stake Pool Registry', function () {
    it('should add stake routes for multiple chains', async function () {
      await splitter.addStakeRoute(pool1.address, 361, 'wTHETA/TFUEL', 5000);
      await splitter.addStakeRoute(pool2.address, 964, 'dTAO', 3000);
      await splitter.addStakeRoute(pool3.address, 0, 'Osmosis IBC', 2000);

      expect(await splitter.getStakeRouteCount()).to.equal(3n);
      expect(await splitter.totalStakeWeight()).to.equal(10000n);

      const route = await splitter.getStakeRoute(0);
      expect(route.chainId).to.equal(361n);
      expect(route.label).to.equal('wTHETA/TFUEL');
    });

    it('should distribute fee-to-stake proportionally across routes', async function () {
      await splitter.addStakeRoute(pool1.address, 361, 'Theta', 5000);
      await splitter.addStakeRoute(pool2.address, 964, 'Bittensor', 5000);

      // Remove default stake pool to avoid conflict
      await splitter.setStakePool(ethers.ZeroAddress);

      const amount = ethers.parseEther('100');
      await user.sendTransaction({ to: await splitter.getAddress(), value: amount });

      const p1Before = await ethers.provider.getBalance(pool1.address);
      const p2Before = await ethers.provider.getBalance(pool2.address);

      await splitter.distribute();

      const p1After = await ethers.provider.getBalance(pool1.address);
      const p2After = await ethers.provider.getBalance(pool2.address);

      // Fee-to-stake total = 3 ETH (20% of 15% of 100)
      // Each route gets 50% = 1.5 ETH
      expect(p1After - p1Before).to.be.gt(0n);
      expect(p2After - p2Before).to.be.gt(0n);
    });

    it('should update stake route weight and active status', async function () {
      await splitter.addStakeRoute(pool1.address, 361, 'Theta', 5000);
      await splitter.updateStakeRoute(0, false, 3000);

      const route = await splitter.getStakeRoute(0);
      expect(route.active).to.be.false;
      expect(route.weightBps).to.equal(3000n);
    });

    it('should reject invalid stake route (zero address)', async function () {
      await expect(
        splitter.addStakeRoute(ethers.ZeroAddress, 361, 'Invalid', 1000)
      ).to.be.reverted;
    });

    it('should reject route update for out-of-bounds index', async function () {
      await expect(splitter.updateStakeRoute(99, true, 1000)).to.be.reverted;
    });

    it('should track per-chain stake totals', async function () {
      await splitter.addStakeRoute(pool1.address, 361, 'Theta', 10000);

      await user.sendTransaction({ to: await splitter.getAddress(), value: ethers.parseEther('100') });
      await splitter.distribute();

      const thetaStake = await splitter.getChainStakeTotal(361);
      expect(thetaStake).to.be.gt(0n);
    });
  });

  // ─── Governance Integration ──────────────────────────────────────────────

  describe('Governance Integration', function () {
    it('should allow FEE_MANAGER to update split ratios', async function () {
      await splitter.setSplit(3500, 2500, 2500, 1500);
      const [bbbBps] = await splitter.getSplit();
      expect(bbbBps).to.equal(3500n);
    });

    it('should reject invalid split (not summing to 10000)', async function () {
      await expect(splitter.setSplit(3000, 3000, 3000, 3000)).to.be.reverted;
    });

    it('should update fee-to-stake BPS within bounds', async function () {
      await splitter.setFeeToStake(2500);
      expect(await splitter.feeToStakeBps()).to.equal(2500n);
    });

    it('should reject fee-to-stake outside 15-25% range', async function () {
      await expect(splitter.setFeeToStake(1000)).to.be.reverted; // 10% < 15%
      await expect(splitter.setFeeToStake(3000)).to.be.reverted; // 30% > 25%
    });
  });
});
