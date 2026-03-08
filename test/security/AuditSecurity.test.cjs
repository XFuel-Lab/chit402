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
      // GET sub-split retains grants (6% of balance) in the contract
      const remaining = await ethers.provider.getBalance(splitterAddr);
      expect(remaining).to.be.lte(ethers.parseEther('0.7'));
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
      await expect(splitter.connect(user).setGETWallet(user.address))
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
      // GET wallet receives 80% of GET allocation (20% grants retained in contract)
      expect(lpAfter - lpBefore).to.equal(ethers.parseEther('240'));
      expect(stakerAfter - stakerBefore).to.equal(ethers.parseEther('250'));
      // Grants retention: 20% of GET (30%) = 6% of 1000 = 60 ETH stays in contract
      const retained = await ethers.provider.getBalance(splitterAddr);
      expect(retained).to.equal(ethers.parseEther('60'));
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

    it('odd distribution amounts leave only grants retention', async function () {
      const splitterAddr = await splitter.getAddress();

      await user.sendTransaction({ to: splitterAddr, value: 33n });
      await splitter.distribute();
      // GET sub-split retains grants in contract; remaining <= 7% of input + rounding
      expect(await ethers.provider.getBalance(splitterAddr)).to.be.lte(5n);

      await user.sendTransaction({ to: splitterAddr, value: 7n });
      await splitter.distribute();
      expect(await ethers.provider.getBalance(splitterAddr)).to.be.lte(5n);

      await user.sendTransaction({ to: splitterAddr, value: 3n });
      await splitter.distribute();
      expect(await ethers.provider.getBalance(splitterAddr)).to.be.lte(5n);
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
      await expect(F.deploy(a, b, z, s, t, p)).to.be.revertedWith('ZeroGET');
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

  // ═════════════════════════════════════════════════════════════════════════
  //  SECTION 4: A2A CIRCUIT SECURITY (Sybil / Slashing / Timeout / Reputation)
  // ═════════════════════════════════════════════════════════════════════════

  describe('A2A Security', function () {
    let a2a, stakeToken;
    let admin, relayer, agentA, agentB, agentC, coordinator, outsider, extra9;

    const STAKE = ethers.parseEther('100');

    beforeEach(async function () {
      [admin, relayer, agentA, agentB, agentC, coordinator, outsider, extra9] =
        await ethers.getSigners();

      const MockERC20F = await ethers.getContractFactory('MockERC20');
      stakeToken = await MockERC20F.deploy('XFuel', 'XF', 0);
      await stakeToken.waitForDeployment();

      const SplitterF = await ethers.getContractFactory('CoreRevenueSplitter');
      const splitter = await SplitterF.deploy(
        admin.address, admin.address, admin.address,
        admin.address, admin.address, admin.address
      );
      await splitter.waitForDeployment();

      const A2AF = await ethers.getContractFactory('A2ACircuit');
      a2a = await A2AF.deploy(
        admin.address,
        await splitter.getAddress(),
        ethers.ZeroAddress,
        await stakeToken.getAddress()
      );
      await a2a.waitForDeployment();

      const RELAYER_ROLE = await a2a.RELAYER_ROLE();
      await a2a.grantRole(RELAYER_ROLE, relayer.address);

      for (const signer of [agentA, agentB, agentC, coordinator]) {
        await stakeToken.mint(signer.address, ethers.parseEther('500'));
        await stakeToken.connect(signer).approve(await a2a.getAddress(), ethers.MaxUint256);
      }
    });

    // ── 4.1  Sybil: registration without stake reverts ──────────────────
    it('registerAgent reverts when caller has no token balance', async function () {
      await expect(
        a2a.connect(outsider).registerAgent(
          ethers.keccak256(ethers.toUtf8Bytes('sybil')),
          'https://sybil.test',
          []
        )
      ).to.be.reverted;
    });

    // ── 4.2  Sybil: duplicate registration reverts ──────────────────────
    it('duplicate registerAgent reverts even with sufficient stake', async function () {
      await stakeToken.mint(agentA.address, STAKE);
      const id = ethers.keccak256(ethers.toUtf8Bytes('dup'));
      await a2a.connect(agentA).registerAgent(id, 'https://a.test', []);

      await expect(
        a2a.connect(agentA).registerAgent(id, 'https://a.test', [])
      ).to.be.reverted;
    });

    // ── 4.3  Sybil: successful registration deducts stake ───────────────
    it('registerAgent transfers minStake to contract', async function () {
      const a2aAddr = await a2a.getAddress();
      const before = await stakeToken.balanceOf(a2aAddr);

      await a2a.connect(agentA).registerAgent(
        ethers.keccak256(ethers.toUtf8Bytes('staked')),
        'https://agent-a.test',
        []
      );

      const after = await stakeToken.balanceOf(a2aAddr);
      expect(after - before).to.equal(STAKE);
      expect(await a2a.agentStakes(agentA.address)).to.equal(STAKE);
    });

    // ── 4.4  Slash: zero slash amount reverts ───────────────────────────
    it('slashAgent with zero amount reverts', async function () {
      await a2a.connect(agentA).registerAgent(
        ethers.keccak256(ethers.toUtf8Bytes('s4')), 'https://a.test', []
      );

      await expect(
        a2a.connect(admin).slashAgent(agentA.address, 0)
      ).to.be.reverted;
    });

    // ── 4.5  Slash: amount exceeding stake reverts ──────────────────────
    it('slashAgent with amount > stake reverts', async function () {
      await a2a.connect(agentA).registerAgent(
        ethers.keccak256(ethers.toUtf8Bytes('s5')), 'https://a.test', []
      );

      await expect(
        a2a.connect(admin).slashAgent(agentA.address, STAKE + 1n)
      ).to.be.reverted;
    });

    // ── 4.6  Slash: non-admin caller reverts ────────────────────────────
    it('slashAgent from non-admin reverts', async function () {
      await a2a.connect(agentA).registerAgent(
        ethers.keccak256(ethers.toUtf8Bytes('s6')), 'https://a.test', []
      );

      await expect(
        a2a.connect(outsider).slashAgent(agentA.address, STAKE)
      ).to.be.reverted;
    });

    // ── 4.7  Slash: valid slash transfers tokens to revenueSplitter ─────
    it('slashAgent sends tokens to revenueSplitter', async function () {
      await a2a.connect(agentA).registerAgent(
        ethers.keccak256(ethers.toUtf8Bytes('s7')), 'https://a.test', []
      );

      const splitterAddr = await a2a.revenueSplitter();
      const before = await stakeToken.balanceOf(splitterAddr);

      await a2a.connect(admin).slashAgent(agentA.address, STAKE);

      const after = await stakeToken.balanceOf(splitterAddr);
      expect(after - before).to.equal(STAKE);
      expect(await a2a.agentStakes(agentA.address)).to.equal(0n);
    });

    // ── 4.8  Swarm timeout: force-dissolve before timeout reverts ───────
    it('forceDissolveSwarm before timeout reverts', async function () {
      await a2a.connect(coordinator).registerAgent(
        ethers.keccak256(ethers.toUtf8Bytes('t8')), 'https://c.test', []
      );
      const objHash = ethers.keccak256(ethers.toUtf8Bytes('swarm-obj'));
      const tx = await a2a.connect(coordinator).formSwarm(objHash, 5, { value: ethers.parseEther('1') });
      const receipt = await tx.wait();
      const event = receipt.logs.find(l => {
        try { return a2a.interface.parseLog(l)?.name === 'SwarmFormed'; } catch { return false; }
      });
      const swarmId = a2a.interface.parseLog(event).args.swarmId;

      await expect(
        a2a.connect(coordinator).forceDissolveSwarm(swarmId)
      ).to.be.reverted;
    });

    // ── 4.9  Swarm timeout: force-dissolve after timeout succeeds ───────
    it('forceDissolveSwarm after timeout releases escrow', async function () {
      await a2a.connect(coordinator).registerAgent(
        ethers.keccak256(ethers.toUtf8Bytes('t9')), 'https://c.test', []
      );
      const objHash = ethers.keccak256(ethers.toUtf8Bytes('swarm-obj2'));
      const escrow = ethers.parseEther('2');
      const tx = await a2a.connect(coordinator).formSwarm(objHash, 5, { value: escrow });
      const receipt = await tx.wait();
      const event = receipt.logs.find(l => {
        try { return a2a.interface.parseLog(l)?.name === 'SwarmFormed'; } catch { return false; }
      });
      const swarmId = a2a.interface.parseLog(event).args.swarmId;

      await ethers.provider.send('evm_increaseTime', [7 * 24 * 3600 + 1]);
      await ethers.provider.send('evm_mine');

      const balBefore = await ethers.provider.getBalance(coordinator.address);
      await a2a.connect(coordinator).forceDissolveSwarm(swarmId);
      const balAfter = await ethers.provider.getBalance(coordinator.address);

      expect(balAfter).to.be.gt(balBefore);

      const swarm = await a2a.getSwarm(swarmId);
      expect(swarm.phase).to.equal(3n); // Dissolved
    });

    // ── 4.10 Swarm timeout: non-member cannot force-dissolve ────────────
    it('forceDissolveSwarm from non-member reverts', async function () {
      await a2a.connect(coordinator).registerAgent(
        ethers.keccak256(ethers.toUtf8Bytes('t10')), 'https://c.test', []
      );
      const objHash = ethers.keccak256(ethers.toUtf8Bytes('swarm-nm'));
      const tx = await a2a.connect(coordinator).formSwarm(objHash, 5, { value: ethers.parseEther('1') });
      const receipt = await tx.wait();
      const event = receipt.logs.find(l => {
        try { return a2a.interface.parseLog(l)?.name === 'SwarmFormed'; } catch { return false; }
      });
      const swarmId = a2a.interface.parseLog(event).args.swarmId;

      await ethers.provider.send('evm_increaseTime', [7 * 24 * 3600 + 1]);
      await ethers.provider.send('evm_mine');

      await expect(
        a2a.connect(outsider).forceDissolveSwarm(swarmId)
      ).to.be.reverted;
    });

    // ── 4.11 Reputation: clamped at MAX_REPUTATION (10 000) ─────────────
    it('updateReputation clamps at MAX_REPUTATION', async function () {
      await a2a.connect(agentA).registerAgent(
        ethers.keccak256(ethers.toUtf8Bytes('rep')), 'https://a.test', []
      );

      await a2a.connect(admin).updateReputation(agentA.address, 15000);
      const agent = await a2a.getAgent(agentA.address);
      expect(agent.reputation).to.equal(10000n);
    });

    // ── 4.12 Reputation: priorityRouting threshold ──────────────────────
    it('priorityRouting returns true at >= 5000, false below', async function () {
      await a2a.connect(agentA).registerAgent(
        ethers.keccak256(ethers.toUtf8Bytes('pri')), 'https://a.test', []
      );

      expect(await a2a.priorityRouting(agentA.address)).to.be.false;

      await a2a.connect(admin).updateReputation(agentA.address, 4999);
      expect(await a2a.priorityRouting(agentA.address)).to.be.false;

      await a2a.connect(admin).updateReputation(agentA.address, 5000);
      expect(await a2a.priorityRouting(agentA.address)).to.be.true;

      await a2a.connect(admin).updateReputation(agentA.address, 10000);
      expect(await a2a.priorityRouting(agentA.address)).to.be.true;
    });
  });
});
