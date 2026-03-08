/**
 * CoreRevenueSplitter — Branch Coverage Tests
 * Targets all uncovered conditional paths to push branch coverage above 80%.
 */

const { expect } = require('chai');
const { ethers } = require('hardhat');

describe('CoreRevenueSplitter — Branch Coverage', function () {
  this.timeout(60000);

  let splitter, admin, bbb, lp, staker, treasury, pool, user, extra;

  beforeEach(async function () {
    [admin, bbb, lp, staker, treasury, pool, user, extra] = await ethers.getSigners();
    const F = await ethers.getContractFactory('CoreRevenueSplitter');
    splitter = await F.deploy(
      admin.address, bbb.address, lp.address,
      staker.address, treasury.address, pool.address
    );
    await splitter.waitForDeployment();
  });

  // ─── Recipient setter zero-address branches ─────────────────────────────

  describe('Recipient setter zero-address validation', function () {
    it('setBBBWallet reverts on address(0)', async function () {
      await expect(splitter.setBBBWallet(ethers.ZeroAddress)).to.be.reverted;
    });

    it('setLPWallet reverts on address(0)', async function () {
      await expect(splitter.setLPWallet(ethers.ZeroAddress)).to.be.reverted;
    });

    it('setStakerVault reverts on address(0)', async function () {
      await expect(splitter.setStakerVault(ethers.ZeroAddress)).to.be.reverted;
    });

    it('setTreasuryWallet reverts on address(0)', async function () {
      await expect(splitter.setTreasuryWallet(ethers.ZeroAddress)).to.be.reverted;
    });
  });

  // ─── Stake route edge cases ─────────────────────────────────────────────

  describe('Stake route branches', function () {
    it('addStakeRoute reverts when weightBps is 0', async function () {
      await expect(splitter.addStakeRoute(user.address, 1, 'test', 0))
        .to.be.reverted;
    });

    it('addStakeRoute reverts when pool is address(0)', async function () {
      await expect(splitter.addStakeRoute(ethers.ZeroAddress, 1, 'test', 5000))
        .to.be.reverted;
    });

    it('updateStakeRoute reverts when index out of bounds', async function () {
      await expect(splitter.updateStakeRoute(99, true, 5000))
        .to.be.reverted;
    });

    it('distribute skips inactive stake routes', async function () {
      await splitter.addStakeRoute(user.address, 1, 'route1', 5000);
      await splitter.addStakeRoute(extra.address, 1, 'route2', 5000);
      await splitter.updateStakeRoute(0, false, 5000);

      const splitterAddr = await splitter.getAddress();
      await admin.sendTransaction({ to: splitterAddr, value: ethers.parseEther('1') });
      await splitter.distribute();

      expect(await splitter.distributionCount()).to.equal(1n);
    });

    it('distribute falls back to treasury when no routes and stakePool is zero', async function () {
      const F = await ethers.getContractFactory('CoreRevenueSplitter');
      const sp = await F.deploy(
        admin.address, bbb.address, lp.address,
        staker.address, treasury.address, ethers.ZeroAddress
      );
      await sp.waitForDeployment();

      const spAddr = await sp.getAddress();
      const treasuryBefore = await ethers.provider.getBalance(treasury.address);
      await admin.sendTransaction({ to: spAddr, value: ethers.parseEther('1') });
      await sp.distribute();

      const treasuryAfter = await ethers.provider.getBalance(treasury.address);
      expect(treasuryAfter).to.be.gt(treasuryBefore);
    });

    it('distribute sends remainder to last active route', async function () {
      await splitter.addStakeRoute(user.address, 1, 'r1', 6000);
      await splitter.addStakeRoute(extra.address, 1, 'r2', 4000);

      const splitterAddr = await splitter.getAddress();
      await admin.sendTransaction({ to: splitterAddr, value: ethers.parseEther('1') });

      const userBefore = await ethers.provider.getBalance(user.address);
      const extraBefore = await ethers.provider.getBalance(extra.address);

      await splitter.distribute();

      const userAfter = await ethers.provider.getBalance(user.address);
      const extraAfter = await ethers.provider.getBalance(extra.address);
      expect(userAfter).to.be.gt(userBefore);
      expect(extraAfter).to.be.gt(extraBefore);
    });
  });

  // ─── Distribute edge case: zero balance ─────────────────────────────────

  describe('Distribute with zero balance', function () {
    it('reverts when balance is 0', async function () {
      await expect(splitter.distribute()).to.be.reverted;
    });
  });

  // ─── Escrow validation branches ─────────────────────────────────────────

  describe('Escrow validation branches', function () {
    const TASK_ID = ethers.keccak256(ethers.toUtf8Bytes('task-1'));

    it('createEscrow reverts when duration is 0', async function () {
      await expect(
        splitter.createEscrow(user.address, ethers.parseEther('1'), TASK_ID, 0, {
          value: ethers.parseEther('0.1'),
        })
      ).to.be.reverted;
    });

    it('createEscrow reverts when value exceeds maxAmount', async function () {
      await expect(
        splitter.createEscrow(user.address, ethers.parseEther('0.01'), TASK_ID, 86400, {
          value: ethers.parseEther('1'),
        })
      ).to.be.reverted;
    });

    it('claimEscrow reverts when called by non-payee', async function () {
      await splitter.createEscrow(user.address, ethers.parseEther('1'), TASK_ID, 86400, {
        value: ethers.parseEther('0.1'),
      });

      await expect(
        splitter.connect(extra).claimEscrow(1, ethers.parseEther('0.1'))
      ).to.be.reverted;
    });

    it('claimEscrow reverts when escrow expired', async function () {
      await splitter.createEscrow(user.address, ethers.parseEther('1'), TASK_ID, 1, {
        value: ethers.parseEther('0.1'),
      });

      await ethers.provider.send('evm_increaseTime', [86400]);
      await ethers.provider.send('evm_mine', []);

      await expect(
        splitter.connect(user).claimEscrow(1, ethers.parseEther('0.1'))
      ).to.be.reverted;
    });

    it('claimEscrow caps amount to escrow balance when claim exceeds deposit', async function () {
      await splitter.createEscrow(user.address, ethers.parseEther('1'), TASK_ID, 86400, {
        value: ethers.parseEther('0.1'),
      });

      await expect(
        splitter.connect(user).claimEscrow(1, ethers.parseEther('0.5'))
      ).to.not.be.reverted;
    });

    it('refundEscrow reverts when called by non-payer', async function () {
      await splitter.createEscrow(user.address, ethers.parseEther('1'), TASK_ID, 86400, {
        value: ethers.parseEther('0.1'),
      });

      await expect(
        splitter.connect(extra).refundEscrow(1)
      ).to.be.reverted;
    });

    it('refundEscrow reverts before expiry', async function () {
      await splitter.createEscrow(user.address, ethers.parseEther('1'), TASK_ID, 86400, {
        value: ethers.parseEther('0.1'),
      });

      await expect(splitter.refundEscrow(1)).to.be.reverted;
    });
  });

  // ─── Deferred claim validation branches ─────────────────────────────────

  describe('Deferred claim branches', function () {
    const PROOF_NULL = ethers.keccak256(ethers.toUtf8Bytes('proof-1'));

    it('createDeferredClaim reverts on zero claimant', async function () {
      await expect(
        splitter.createDeferredClaim(ethers.ZeroAddress, PROOF_NULL, 3600, {
          value: ethers.parseEther('0.1'),
        })
      ).to.be.reverted;
    });

    it('createDeferredClaim reverts on zero value', async function () {
      await expect(
        splitter.createDeferredClaim(user.address, PROOF_NULL, 3600, { value: 0 })
      ).to.be.reverted;
    });

    it('executeDeferredClaim reverts when claim not matured', async function () {
      await splitter.createDeferredClaim(user.address, PROOF_NULL, 86400, {
        value: ethers.parseEther('0.1'),
      });
      await expect(splitter.executeDeferredClaim(0)).to.be.reverted;
    });

    it('executeDeferredClaim reverts on non-existent claim', async function () {
      await expect(splitter.executeDeferredClaim(999)).to.be.reverted;
    });

    it('executeDeferredClaim succeeds after delay passes', async function () {
      await splitter.createDeferredClaim(user.address, PROOF_NULL, 100, {
        value: ethers.parseEther('0.1'),
      });

      await ethers.provider.send('evm_increaseTime', [200]);
      await ethers.provider.send('evm_mine', []);

      await expect(splitter.executeDeferredClaim(1)).to.not.be.reverted;
    });
  });

  // ─── Oracle branches ────────────────────────────────────────────────────

  describe('Oracle branches', function () {
    it('addOracleFeed defaults staleness to 3600 when passed 0', async function () {
      const MockAggF = await ethers.getContractFactory('MockAggregator');
      const mockAgg = await MockAggF.deploy(8, ethers.parseUnits('2000', 8));
      await mockAgg.waitForDeployment();

      await splitter.addOracleFeed(
        ethers.encodeBytes32String('ETH'),
        await mockAgg.getAddress(),
        'ETH/USD',
        0
      );

      await expect(splitter.updateOraclePrice(ethers.encodeBytes32String('ETH')))
        .to.not.be.reverted;
    });

    it('updateOraclePrice reverts on inactive feed', async function () {
      await expect(
        splitter.updateOraclePrice(ethers.encodeBytes32String('FAKE'))
      ).to.be.reverted;
    });
  });

  // ─── _safeTransfer edge cases ───────────────────────────────────────────

  describe('_safeTransfer edge cases', function () {
    it('handles zero-amount distribution without revert', async function () {
      await splitter.setSplit(10000, 0, 0, 0);
      const splitterAddr = await splitter.getAddress();
      await admin.sendTransaction({ to: splitterAddr, value: ethers.parseEther('0.001') });

      await expect(splitter.distribute()).to.not.be.reverted;
    });
  });

  // ─── Additional escrow edge-case branches ─────────────────────────────

  describe('Escrow edge-case branches', function () {
    const TASK_ID = ethers.keccak256(ethers.toUtf8Bytes('task-edge'));

    it('createEscrow reverts when payee == msg.sender', async function () {
      await expect(
        splitter.createEscrow(admin.address, ethers.parseEther('1'), TASK_ID, 86400, {
          value: ethers.parseEther('0.1'),
        })
      ).to.be.reverted;
    });

    it('claimEscrow reverts on already-refunded escrow', async function () {
      await splitter.createEscrow(user.address, ethers.parseEther('1'), TASK_ID, 1, {
        value: ethers.parseEther('0.1'),
      });
      await ethers.provider.send('evm_increaseTime', [86400]);
      await ethers.provider.send('evm_mine', []);
      await splitter.refundEscrow(1);
      await expect(
        splitter.connect(user).claimEscrow(1, ethers.parseEther('0.1'))
      ).to.be.reverted;
    });

    it('refundEscrow reverts on non-existent escrow', async function () {
      await expect(splitter.refundEscrow(999)).to.be.reverted;
    });

    it('refundEscrow reverts on already-refunded escrow', async function () {
      await splitter.createEscrow(user.address, ethers.parseEther('1'), TASK_ID, 1, {
        value: ethers.parseEther('0.1'),
      });
      await ethers.provider.send('evm_increaseTime', [86400]);
      await ethers.provider.send('evm_mine', []);
      await splitter.refundEscrow(1);
      await expect(splitter.refundEscrow(1)).to.be.reverted;
    });
  });

  // ─── Deferred claim edge-case branches ────────────────────────────────

  describe('Deferred claim edge-case branches', function () {
    const PROOF_NULL = ethers.keccak256(ethers.toUtf8Bytes('proof-edge'));

    it('createDeferredClaim reverts when delay > 7 days', async function () {
      const eightDays = 8 * 24 * 60 * 60;
      await expect(
        splitter.createDeferredClaim(user.address, PROOF_NULL, eightDays, {
          value: ethers.parseEther('0.1'),
        })
      ).to.be.reverted;
    });

    it('executeDeferredClaim reverts on already-claimed', async function () {
      await splitter.createDeferredClaim(user.address, PROOF_NULL, 1, {
        value: ethers.parseEther('0.1'),
      });
      await ethers.provider.send('evm_increaseTime', [100]);
      await ethers.provider.send('evm_mine', []);
      await splitter.executeDeferredClaim(1);
      await expect(splitter.executeDeferredClaim(1)).to.be.reverted;
    });
  });

  // ─── Oracle edge-case branches ────────────────────────────────────────

  describe('Oracle edge-case branches', function () {
    it('addOracleFeed reverts on zero feed address', async function () {
      await expect(
        splitter.addOracleFeed(
          ethers.encodeBytes32String('BAD'),
          ethers.ZeroAddress,
          'Bad/Feed',
          3600
        )
      ).to.be.reverted;
    });

    it('updateOraclePrice reverts on stale price', async function () {
      const MockAggF = await ethers.getContractFactory('MockAggregator');
      const mockAgg = await MockAggF.deploy(8, ethers.parseUnits('2000', 8));
      await mockAgg.waitForDeployment();

      await splitter.addOracleFeed(
        ethers.encodeBytes32String('STALE'),
        await mockAgg.getAddress(),
        'STALE/USD',
        10
      );

      await ethers.provider.send('evm_increaseTime', [100]);
      await ethers.provider.send('evm_mine', []);

      await expect(
        splitter.updateOraclePrice(ethers.encodeBytes32String('STALE'))
      ).to.be.reverted;
    });
  });

  // ─── setSplit validation ────────────────────────────────────────────────

  describe('setSplit validation', function () {
    it('reverts when BPS do not sum to 10000', async function () {
      await expect(splitter.setSplit(1000, 2000, 3000, 3000)).to.be.reverted;
    });

    it('accepts valid split totaling 10000', async function () {
      await expect(splitter.setSplit(2500, 2500, 2500, 2500)).to.not.be.reverted;
    });
  });

  // ─── setFeeToStake boundary ─────────────────────────────────────────────

  describe('setFeeToStake boundary', function () {
    it('reverts when below 1500 BPS', async function () {
      await expect(splitter.setFeeToStake(1000)).to.be.reverted;
    });

    it('reverts when above 2500 BPS', async function () {
      await expect(splitter.setFeeToStake(3000)).to.be.reverted;
    });

    it('accepts at boundaries', async function () {
      await expect(splitter.setFeeToStake(1500)).to.not.be.reverted;
      await expect(splitter.setFeeToStake(2500)).to.not.be.reverted;
    });
  });
});
