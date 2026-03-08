/**
 * Security Audit Tests — CertiK Phase 1 Readiness
 *
 * Covers three critical audit areas:
 *   1. Reentrancy Protection (nonReentrant guards on all ETH-sending functions)
 *   2. Access Control (role enforcement, revocation, pause state)
 *   3. Boundary Conditions (dust, overflow, min/max constraints)
 *
 * Run: npx hardhat test test/security/AuditSecurity.test.cjs
 */

const { expect } = require('chai');
const { ethers } = require('hardhat');

describe('Security Audit Tests', function () {
  this.timeout(60000);

  // ═════════════════════════════════════════════════════════════════════════
  //  SECTION 1: REENTRANCY ATTACK TESTS
  // ═════════════════════════════════════════════════════════════════════════

  describe('Reentrancy Protection', function () {
    let admin, bbb, lp, staker, treasury, pool, user, payee, extra;

    beforeEach(async function () {
      [admin, bbb, lp, staker, treasury, pool, user, payee, extra] =
        await ethers.getSigners();
    });

    async function deploySplitterAndAttacker() {
      const SplitterF = await ethers.getContractFactory('CoreRevenueSplitter');
      const splitter = await SplitterF.deploy(
        admin.address, bbb.address, lp.address,
        staker.address, treasury.address, pool.address
      );
      await splitter.waitForDeployment();

      const AttackerF = await ethers.getContractFactory('ReentrancyAttacker');
      const attacker = await AttackerF.deploy(await splitter.getAddress());
      await attacker.waitForDeployment();

      return { splitter, attacker };
    }

    it('distribute() blocks reentrancy via receive() callback', async function () {
      const { splitter, attacker } = await deploySplitterAndAttacker();
      const attackerAddr = await attacker.getAddress();
      const splitterAddr = await splitter.getAddress();

      await splitter.setBBBWallet(attackerAddr);

      await user.sendTransaction({ to: splitterAddr, value: ethers.parseEther('10') });

      await attacker.attackDistribute(3);

      expect(await splitter.distributionCount()).to.equal(1n);
      expect(await attacker.attackCount()).to.be.gte(1n);
      expect(await ethers.provider.getBalance(splitterAddr)).to.equal(0n);
    });

    it('claimEscrow() blocks reentrancy', async function () {
      const { splitter, attacker } = await deploySplitterAndAttacker();
      const attackerAddr = await attacker.getAddress();
      const amount = ethers.parseEther('1');
      const taskId = ethers.keccak256(ethers.toUtf8Bytes('reentrancy-claim'));

      await splitter.connect(user).createEscrow(
        attackerAddr, amount, taskId, 86400, { value: amount }
      );
      const escrowId = await splitter.escrowCount();

      await attacker.attackClaimEscrow(escrowId, amount, 3);

      const escrow = await splitter.getEscrow(escrowId);
      expect(escrow.claimed).to.be.true;
      expect(await attacker.attackCount()).to.be.gte(1n);
    });

    it('refundEscrow() blocks reentrancy', async function () {
      const { splitter, attacker } = await deploySplitterAndAttacker();
      const amount = ethers.parseEther('1');
      const taskId = ethers.keccak256(ethers.toUtf8Bytes('reentrancy-refund'));

      await attacker.connect(user).createEscrowOnTarget(
        payee.address, amount, taskId, 86400, { value: amount }
      );
      const escrowId = await splitter.escrowCount();

      await ethers.provider.send('evm_increaseTime', [86401]);
      await ethers.provider.send('evm_mine');

      await attacker.attackRefund(escrowId, 3);

      const escrow = await splitter.getEscrow(escrowId);
      expect(escrow.refunded).to.be.true;
      expect(await attacker.attackCount()).to.be.gte(1n);
    });

    it('executeDeferredClaim() blocks reentrancy', async function () {
      const { splitter, attacker } = await deploySplitterAndAttacker();
      const attackerAddr = await attacker.getAddress();
      const amount = ethers.parseEther('1');
      const nullifier = ethers.keccak256(ethers.toUtf8Bytes('reentrancy-deferred'));

      await splitter.connect(admin).createDeferredClaim(
        attackerAddr, nullifier, 3600, { value: amount }
      );
      const claimId = await splitter.deferredClaimCount();

      await ethers.provider.send('evm_increaseTime', [3601]);
      await ethers.provider.send('evm_mine');

      await attacker.attackExecuteDeferredClaim(claimId, 3);

      const claim = await splitter.getDeferredClaim(claimId);
      expect(claim.claimed).to.be.true;
      expect(await attacker.attackCount()).to.be.gte(1n);
    });

    it('veXFGovernance unlock() prevents double-withdrawal', async function () {
      const MockERC20F = await ethers.getContractFactory('MockERC20');
      const xfToken = await MockERC20F.deploy('XFuel', 'XF', 18);
      await xfToken.waitForDeployment();

      const GovernanceF = await ethers.getContractFactory('veXFGovernance');
      const governance = await GovernanceF.deploy(admin.address, await xfToken.getAddress());
      await governance.waitForDeployment();

      const lockAmount = ethers.parseEther('100');
      await xfToken.mint(user.address, lockAmount);
      await xfToken.connect(user).approve(await governance.getAddress(), lockAmount);

      const block = await ethers.provider.getBlock('latest');
      const WEEK = 7 * 24 * 3600;
      const unlockTime = Math.floor((block.timestamp + 27 * WEEK) / WEEK) * WEEK;

      await governance.connect(user).lock(lockAmount, unlockTime);

      await ethers.provider.send('evm_increaseTime', [28 * WEEK]);
      await ethers.provider.send('evm_mine');

      await governance.connect(user).unlock();
      expect(await xfToken.balanceOf(user.address)).to.equal(lockAmount);

      await expect(governance.connect(user).unlock()).to.be.reverted;
    });
  });

  // ═════════════════════════════════════════════════════════════════════════
  //  SECTION 2: ACCESS CONTROL TESTS
  // ═════════════════════════════════════════════════════════════════════════

  describe('Access Control', function () {
    let splitter, governance, xfToken;
    let admin, bbb, lp, staker, treasury, pool, user, payee, extra;

    beforeEach(async function () {
      [admin, bbb, lp, staker, treasury, pool, user, payee, extra] =
        await ethers.getSigners();

      const SplitterF = await ethers.getContractFactory('CoreRevenueSplitter');
      splitter = await SplitterF.deploy(
        admin.address, bbb.address, lp.address,
        staker.address, treasury.address, pool.address
      );
      await splitter.waitForDeployment();

      const MockERC20F = await ethers.getContractFactory('MockERC20');
      xfToken = await MockERC20F.deploy('XFuel', 'XF', 18);
      await xfToken.waitForDeployment();

      const GovernanceF = await ethers.getContractFactory('veXFGovernance');
      governance = await GovernanceF.deploy(admin.address, await xfToken.getAddress());
      await governance.waitForDeployment();
    });

    it('non-FEE_MANAGER cannot call setSplit', async function () {
      await expect(splitter.connect(user).setSplit(3000, 3000, 2500, 1500))
        .to.be.reverted;
    });

    it('non-FEE_MANAGER cannot call setFeeToStake', async function () {
      await expect(splitter.connect(user).setFeeToStake(2000))
        .to.be.reverted;
    });

    it('non-admin cannot update recipient wallets', async function () {
      await expect(splitter.connect(user).setBBBWallet(user.address))
        .to.be.reverted;
      await expect(splitter.connect(user).setLPWallet(user.address))
        .to.be.reverted;
      await expect(splitter.connect(user).setStakerVault(user.address))
        .to.be.reverted;
      await expect(splitter.connect(user).setTreasuryWallet(user.address))
        .to.be.reverted;
    });

    it('non-admin cannot pause or unpause', async function () {
      await expect(splitter.connect(user).pause())
        .to.be.reverted;
      await expect(splitter.connect(user).unpause())
        .to.be.reverted;
    });

    it('role revocation correctly removes access', async function () {
      const FEE_MANAGER_ROLE = await splitter.FEE_MANAGER_ROLE();

      await splitter.grantRole(FEE_MANAGER_ROLE, user.address);
      await splitter.connect(user).setSplit(3500, 2500, 2500, 1500);

      await splitter.revokeRole(FEE_MANAGER_ROLE, user.address);

      await expect(splitter.connect(user).setSplit(3000, 3000, 2500, 1500))
        .to.be.reverted;
    });

    it('DEFAULT_ADMIN can grant admin role to another account', async function () {
      const DEFAULT_ADMIN_ROLE = await splitter.DEFAULT_ADMIN_ROLE();

      await splitter.grantRole(DEFAULT_ADMIN_ROLE, extra.address);
      await splitter.connect(extra).pause();
      expect(await splitter.paused()).to.be.true;
      await splitter.connect(extra).unpause();
      expect(await splitter.paused()).to.be.false;
    });

    it('non-CIRCUIT_ROLE cannot createDeferredClaim', async function () {
      const nullifier = ethers.keccak256(ethers.toUtf8Bytes('acl-test'));
      await expect(
        splitter.connect(user).createDeferredClaim(
          user.address, nullifier, 3600, { value: ethers.parseEther('1') }
        )
      ).to.be.reverted;
    });

    it('non-EXECUTOR cannot executeProposal on veXFGovernance', async function () {
      await expect(governance.connect(user).executeProposal(1))
        .to.be.reverted;
    });

    it('paused state blocks depositFee and distribute', async function () {
      const splitterAddr = await splitter.getAddress();
      const circuitId = ethers.keccak256(ethers.toUtf8Bytes('pause-test'));

      await user.sendTransaction({ to: splitterAddr, value: ethers.parseEther('1') });

      await splitter.pause();

      await expect(
        splitter.connect(user).depositFee(circuitId, { value: ethers.parseEther('1') })
      ).to.be.reverted;

      await expect(splitter.distribute()).to.be.reverted;
    });
  });

  // ═════════════════════════════════════════════════════════════════════════
  //  SECTION 3: BOUNDARY CONDITION TESTS
  // ═════════════════════════════════════════════════════════════════════════

  describe('Boundary Conditions', function () {
    let splitter, governance, xfToken;
    let admin, bbb, lp, staker, treasury, pool, user, payee, extra;

    beforeEach(async function () {
      [admin, bbb, lp, staker, treasury, pool, user, payee, extra] =
        await ethers.getSigners();

      const SplitterF = await ethers.getContractFactory('CoreRevenueSplitter');
      splitter = await SplitterF.deploy(
        admin.address, bbb.address, lp.address,
        staker.address, treasury.address, pool.address
      );
      await splitter.waitForDeployment();

      const MockERC20F = await ethers.getContractFactory('MockERC20');
      xfToken = await MockERC20F.deploy('XFuel', 'XF', 18);
      await xfToken.waitForDeployment();

      const GovernanceF = await ethers.getContractFactory('veXFGovernance');
      governance = await GovernanceF.deploy(admin.address, await xfToken.getAddress());
      await governance.waitForDeployment();
    });

    it('distribution with 1 wei leaves no dust', async function () {
      const splitterAddr = await splitter.getAddress();
      await user.sendTransaction({ to: splitterAddr, value: 1n });

      const treasuryBefore = await ethers.provider.getBalance(treasury.address);
      await splitter.distribute();

      expect(await ethers.provider.getBalance(splitterAddr)).to.equal(0n);
      const treasuryAfter = await ethers.provider.getBalance(treasury.address);
      expect(treasuryAfter - treasuryBefore).to.equal(1n);
    });

    it('distribution with very large amount (1000 ETH) splits correctly', async function () {
      const splitterAddr = await splitter.getAddress();
      const amount = ethers.parseEther('1000');
      await user.sendTransaction({ to: splitterAddr, value: amount });

      const bbbBefore = await ethers.provider.getBalance(bbb.address);
      const lpBefore = await ethers.provider.getBalance(lp.address);
      const stakerBefore = await ethers.provider.getBalance(staker.address);

      await splitter.distribute();

      const bbbAfter = await ethers.provider.getBalance(bbb.address);
      const lpAfter = await ethers.provider.getBalance(lp.address);
      const stakerAfter = await ethers.provider.getBalance(staker.address);

      expect(bbbAfter - bbbBefore).to.equal(ethers.parseEther('300'));
      expect(lpAfter - lpBefore).to.equal(ethers.parseEther('300'));
      expect(stakerAfter - stakerBefore).to.equal(ethers.parseEther('250'));
      expect(await ethers.provider.getBalance(splitterAddr)).to.equal(0n);
    });

    it('setSplit rejects sums not equal to 10000', async function () {
      await expect(splitter.setSplit(3000, 3000, 3000, 3000)).to.be.reverted;
      await expect(splitter.setSplit(2500, 2500, 2500, 2499)).to.be.reverted;
      await expect(splitter.setSplit(2500, 2500, 2500, 2501)).to.be.reverted;
    });

    it('setFeeToStake rejects below MIN (1500) and above MAX (2500)', async function () {
      await expect(splitter.setFeeToStake(1499)).to.be.reverted;
      await expect(splitter.setFeeToStake(2501)).to.be.reverted;

      await splitter.setFeeToStake(1500);
      expect(await splitter.feeToStakeBps()).to.equal(1500n);
      await splitter.setFeeToStake(2500);
      expect(await splitter.feeToStakeBps()).to.equal(2500n);
    });

    it('lock duration at MIN_LOCK (26 weeks) succeeds', async function () {
      const lockAmount = ethers.parseEther('100');
      await xfToken.mint(user.address, lockAmount);
      await xfToken.connect(user).approve(await governance.getAddress(), lockAmount);

      const block = await ethers.provider.getBlock('latest');
      const WEEK = 7 * 24 * 3600;
      const unlockTime = Math.floor((block.timestamp + 27 * WEEK) / WEEK) * WEEK;

      await governance.connect(user).lock(lockAmount, unlockTime);

      const lock = await governance.getLock(user.address);
      expect(lock.amount).to.equal(lockAmount);
    });

    it('lock duration below MIN_LOCK reverts', async function () {
      const lockAmount = ethers.parseEther('100');
      await xfToken.mint(user.address, lockAmount);
      await xfToken.connect(user).approve(await governance.getAddress(), lockAmount);

      const block = await ethers.provider.getBlock('latest');
      const WEEK = 7 * 24 * 3600;
      const unlockTime = Math.floor((block.timestamp + 25 * WEEK) / WEEK) * WEEK;

      await expect(governance.connect(user).lock(lockAmount, unlockTime))
        .to.be.reverted;
    });

    it('lock duration at MAX_LOCK (3 years) succeeds', async function () {
      const lockAmount = ethers.parseEther('100');
      await xfToken.mint(user.address, lockAmount);
      await xfToken.connect(user).approve(await governance.getAddress(), lockAmount);

      const block = await ethers.provider.getBlock('latest');
      const WEEK = 7 * 24 * 3600;
      const MAX_LOCK_SECONDS = 3 * 365 * 24 * 3600;
      const unlockTime = Math.floor((block.timestamp + MAX_LOCK_SECONDS) / WEEK) * WEEK;

      await governance.connect(user).lock(lockAmount, unlockTime);

      const lock = await governance.getLock(user.address);
      expect(lock.amount).to.equal(lockAmount);
    });

    it('lock duration above MAX_LOCK reverts', async function () {
      const lockAmount = ethers.parseEther('100');
      await xfToken.mint(user.address, lockAmount);
      await xfToken.connect(user).approve(await governance.getAddress(), lockAmount);

      const block = await ethers.provider.getBlock('latest');
      const WEEK = 7 * 24 * 3600;
      const MAX_LOCK_SECONDS = 3 * 365 * 24 * 3600;
      const unlockTime = Math.ceil((block.timestamp + MAX_LOCK_SECONDS + 2 * WEEK) / WEEK) * WEEK;

      await expect(governance.connect(user).lock(lockAmount, unlockTime))
        .to.be.reverted;
    });

    it('odd distribution amounts leave no stuck dust', async function () {
      const splitterAddr = await splitter.getAddress();

      await user.sendTransaction({ to: splitterAddr, value: 33n });
      await splitter.distribute();
      expect(await ethers.provider.getBalance(splitterAddr)).to.equal(0n);

      await user.sendTransaction({ to: splitterAddr, value: 7n });
      await splitter.distribute();
      expect(await ethers.provider.getBalance(splitterAddr)).to.equal(0n);

      await user.sendTransaction({ to: splitterAddr, value: 3n });
      await splitter.distribute();
      expect(await ethers.provider.getBalance(splitterAddr)).to.equal(0n);
    });

    it('zero-address constructor params revert', async function () {
      const F = await ethers.getContractFactory('CoreRevenueSplitter');
      const a = admin.address;
      const b = bbb.address;
      const l = lp.address;
      const s = staker.address;
      const t = treasury.address;
      const p = pool.address;
      const z = ethers.ZeroAddress;

      await expect(F.deploy(z, b, l, s, t, p)).to.be.revertedWith('ZeroAdmin');
      await expect(F.deploy(a, z, l, s, t, p)).to.be.revertedWith('ZeroBBB');
      await expect(F.deploy(a, b, z, s, t, p)).to.be.revertedWith('ZeroLP');
      await expect(F.deploy(a, b, l, z, t, p)).to.be.revertedWith('ZeroStaker');
      await expect(F.deploy(a, b, l, s, z, p)).to.be.revertedWith('ZeroTreasury');
    });

    it('escrow with max duration (30 days) succeeds', async function () {
      const taskId = ethers.keccak256(ethers.toUtf8Bytes('max-duration'));
      const amount = ethers.parseEther('1');
      const THIRTY_DAYS = 30 * 24 * 3600;

      await splitter.connect(user).createEscrow(
        payee.address, amount, taskId, THIRTY_DAYS, { value: amount }
      );

      expect(await splitter.escrowCount()).to.equal(1n);
      const escrow = await splitter.getEscrow(1);
      expect(escrow.payer).to.equal(user.address);
      expect(escrow.payee).to.equal(payee.address);
    });

    it('escrow with duration >30 days reverts', async function () {
      const taskId = ethers.keccak256(ethers.toUtf8Bytes('over-duration'));
      const amount = ethers.parseEther('1');
      const OVER_THIRTY_DAYS = 30 * 24 * 3600 + 1;

      await expect(
        splitter.connect(user).createEscrow(
          payee.address, amount, taskId, OVER_THIRTY_DAYS, { value: amount }
        )
      ).to.be.revertedWith('InvalidDuration');
    });
  });
});
