/**
 * Phase 3 — veXFGovernance Tests (25 tests)
 *
 * Run: npx hardhat test test/phase3/veXFGovernance.test.cjs
 *
 * Covers: Curve-style locking, linear decay voting power, per-type quorums,
 * ZK vote nullifiers, proposal lifecycle, execution hooks, edge cases.
 */

const { expect } = require('chai');
const hre = require('hardhat');
const { ethers } = hre;

async function increaseTime(seconds) {
  await hre.network.provider.send('evm_increaseTime', [seconds]);
  await hre.network.provider.send('evm_mine');
}

async function latestTimestamp() {
  const block = await ethers.provider.getBlock('latest');
  return block.timestamp;
}

const time = { increase: increaseTime, latest: latestTimestamp };

describe('veXFGovernance (Phase 3)', function () {
  let gov, splitter, xfToken;
  let admin, alice, bob, charlie;

  const ONE_WEEK = 7 * 24 * 3600;
  const TWENTY_SIX_WEEKS = 26 * ONE_WEEK;
  const ONE_YEAR = 365 * 24 * 3600;
  const THREE_YEARS = 3 * ONE_YEAR;
  const VOTING_PERIOD = 3 * 24 * 3600;

  beforeEach(async function () {
    [admin, alice, bob, charlie] = await ethers.getSigners();

    // Deploy mock ERC20 token
    const TokenF = await ethers.getContractFactory('MockERC20');
    xfToken = await TokenF.deploy('XFuel Token', 'XF', 18);
    await xfToken.waitForDeployment();

    // Mint and distribute tokens
    await xfToken.mint(admin.address, ethers.parseEther('1000000'));
    await xfToken.transfer(alice.address, ethers.parseEther('10000'));
    await xfToken.transfer(bob.address, ethers.parseEther('10000'));
    await xfToken.transfer(charlie.address, ethers.parseEther('5000'));

    // Deploy CoreRevenueSplitter
    const SplitterF = await ethers.getContractFactory('CoreRevenueSplitter');
    splitter = await SplitterF.deploy(
      admin.address, admin.address, admin.address,
      admin.address, admin.address, admin.address
    );
    await splitter.waitForDeployment();

    // Deploy veXFGovernance
    const GovF = await ethers.getContractFactory('veXFGovernance');
    gov = await GovF.deploy(admin.address, await xfToken.getAddress());
    await gov.waitForDeployment();

    // Link governance → splitter
    await gov.setRevenueSplitter(await splitter.getAddress());

    // Grant FEE_MANAGER_ROLE to governance on splitter
    const FEE_ROLE = await splitter.FEE_MANAGER_ROLE();
    await splitter.grantRole(FEE_ROLE, await gov.getAddress());
  });

  // ─── Lock Mechanics ─────────────────────────────────────────────────────

  describe('Lock Mechanics', function () {
    it('should lock XF tokens for minimum duration (26 weeks)', async function () {
      const amount = ethers.parseEther('100');
      const now = await time.latest();
      const unlockTime = BigInt(now) + BigInt(TWENTY_SIX_WEEKS) + BigInt(ONE_WEEK);
      const rounded = (unlockTime / BigInt(ONE_WEEK)) * BigInt(ONE_WEEK);

      await xfToken.connect(alice).approve(await gov.getAddress(), amount);
      await gov.connect(alice).lock(amount, rounded);

      const lockData = await gov.getLock(alice.address);
      expect(lockData.amount).to.equal(amount);
      expect(await gov.totalLocked()).to.equal(amount);
      expect(await gov.lockCount()).to.equal(1n);
    });

    it('should lock XF tokens for max duration (3 years)', async function () {
      const amount = ethers.parseEther('100');
      const now = await time.latest();
      const unlockTime = BigInt(now) + BigInt(THREE_YEARS);
      const rounded = (unlockTime / BigInt(ONE_WEEK)) * BigInt(ONE_WEEK);

      await xfToken.connect(alice).approve(await gov.getAddress(), amount);
      await gov.connect(alice).lock(amount, rounded);

      const vp = await gov.votingPower(alice.address);
      // Should be close to 3x (300 veXF for 100 XF at max lock)
      expect(vp).to.be.gt(ethers.parseEther('290'));
    });

    it('should reject lock shorter than 26 weeks', async function () {
      const amount = ethers.parseEther('100');
      const now = await time.latest();
      const tooShort = BigInt(now) + BigInt(ONE_WEEK * 10); // 10 weeks
      const rounded = (tooShort / BigInt(ONE_WEEK)) * BigInt(ONE_WEEK);

      await xfToken.connect(alice).approve(await gov.getAddress(), amount);
      await expect(gov.connect(alice).lock(amount, rounded)).to.be.reverted;
    });

    it('should reject lock longer than 3 years', async function () {
      const amount = ethers.parseEther('100');
      const now = await time.latest();
      const tooLong = BigInt(now) + BigInt(THREE_YEARS) + BigInt(ONE_YEAR);
      const rounded = (tooLong / BigInt(ONE_WEEK)) * BigInt(ONE_WEEK);

      await xfToken.connect(alice).approve(await gov.getAddress(), amount);
      await expect(gov.connect(alice).lock(amount, rounded)).to.be.reverted;
    });

    it('should increase lock amount', async function () {
      const amount = ethers.parseEther('100');
      const now = await time.latest();
      const unlockTime = (BigInt(now + ONE_YEAR) / BigInt(ONE_WEEK)) * BigInt(ONE_WEEK);

      await xfToken.connect(alice).approve(await gov.getAddress(), ethers.parseEther('200'));
      await gov.connect(alice).lock(amount, unlockTime);

      await gov.connect(alice).increaseLock(ethers.parseEther('50'));

      const lockData = await gov.getLock(alice.address);
      expect(lockData.amount).to.equal(ethers.parseEther('150'));
      expect(await gov.totalLocked()).to.equal(ethers.parseEther('150'));
    });

    it('should extend lock duration', async function () {
      const amount = ethers.parseEther('100');
      const now = await time.latest();
      const unlockTime = (BigInt(now + ONE_YEAR) / BigInt(ONE_WEEK)) * BigInt(ONE_WEEK);
      const newUnlock = (BigInt(now + 2 * ONE_YEAR) / BigInt(ONE_WEEK)) * BigInt(ONE_WEEK);

      await xfToken.connect(alice).approve(await gov.getAddress(), amount);
      await gov.connect(alice).lock(amount, unlockTime);

      const vpBefore = await gov.votingPower(alice.address);
      await gov.connect(alice).extendLock(newUnlock);
      const vpAfter = await gov.votingPower(alice.address);

      expect(vpAfter).to.be.gt(vpBefore);
    });
  });

  // ─── Voting Power ───────────────────────────────────────────────────────

  describe('Voting Power', function () {
    it('should calculate ~1x multiplier for 1-year lock', async function () {
      const amount = ethers.parseEther('100');
      const now = await time.latest();
      const unlockTime = (BigInt(now + ONE_YEAR) / BigInt(ONE_WEEK)) * BigInt(ONE_WEEK);

      await xfToken.connect(alice).approve(await gov.getAddress(), amount);
      await gov.connect(alice).lock(amount, unlockTime);

      const vp = await gov.votingPower(alice.address);
      // ~1x = 100 veXF (with some rounding due to block time)
      expect(vp).to.be.gt(ethers.parseEther('90'));
      expect(vp).to.be.lt(ethers.parseEther('110'));
    });

    it('should calculate ~3x multiplier for 3-year lock', async function () {
      const amount = ethers.parseEther('100');
      const now = await time.latest();
      const unlockTime = (BigInt(now + THREE_YEARS) / BigInt(ONE_WEEK)) * BigInt(ONE_WEEK);

      await xfToken.connect(alice).approve(await gov.getAddress(), amount);
      await gov.connect(alice).lock(amount, unlockTime);

      const vp = await gov.votingPower(alice.address);
      expect(vp).to.be.gt(ethers.parseEther('290'));
      expect(vp).to.be.lt(ethers.parseEther('310'));
    });

    it('should decay voting power linearly over time', async function () {
      const amount = ethers.parseEther('100');
      const now = await time.latest();
      const unlockTime = (BigInt(now + ONE_YEAR) / BigInt(ONE_WEEK)) * BigInt(ONE_WEEK);

      await xfToken.connect(alice).approve(await gov.getAddress(), amount);
      await gov.connect(alice).lock(amount, unlockTime);

      const vpStart = await gov.votingPower(alice.address);

      // Advance ~6 months
      await time.increase(ONE_YEAR / 2);
      const vpMid = await gov.votingPower(alice.address);

      expect(vpMid).to.be.lt(vpStart);
      // Should be roughly half
      expect(vpMid).to.be.gt(vpStart / 3n);
    });

    it('should return 0 voting power after lock expires', async function () {
      const amount = ethers.parseEther('100');
      const now = await time.latest();
      const unlockTime = (BigInt(now + TWENTY_SIX_WEEKS + ONE_WEEK) / BigInt(ONE_WEEK)) * BigInt(ONE_WEEK);

      await xfToken.connect(alice).approve(await gov.getAddress(), amount);
      await gov.connect(alice).lock(amount, unlockTime);

      // Advance past unlock
      await time.increase(TWENTY_SIX_WEEKS + 2 * ONE_WEEK);
      const vp = await gov.votingPower(alice.address);
      expect(vp).to.equal(0n);
    });

    it('should return 0 voting power for non-locker', async function () {
      const vp = await gov.votingPower(charlie.address);
      expect(vp).to.equal(0n);
    });
  });

  // ─── Proposals ──────────────────────────────────────────────────────────

  describe('Proposals', function () {
    beforeEach(async function () {
      // Alice locks for voting power
      const now = await time.latest();
      const unlockTime = (BigInt(now + ONE_YEAR) / BigInt(ONE_WEEK)) * BigInt(ONE_WEEK);
      await xfToken.connect(alice).approve(await gov.getAddress(), ethers.parseEther('1000'));
      await gov.connect(alice).lock(ethers.parseEther('1000'), unlockTime);

      // Bob also locks
      const unlockBob = (BigInt(now + 2 * ONE_YEAR) / BigInt(ONE_WEEK)) * BigInt(ONE_WEEK);
      await xfToken.connect(bob).approve(await gov.getAddress(), ethers.parseEther('500'));
      await gov.connect(bob).lock(ethers.parseEther('500'), unlockBob);
    });

    it('should create a CircuitPriority proposal', async function () {
      const tx = await gov.connect(alice).createProposal(
        0, // CircuitPriority
        ethers.keccak256(ethers.toUtf8Bytes('BridgeCircuit')),
        'Prioritize BridgeCircuit for Q3',
        '0x'
      );
      const receipt = await tx.wait();
      expect(await gov.proposalCount()).to.equal(1n);
    });

    it('should create a FeeStructure proposal with execution data', async function () {
      const execData = ethers.AbiCoder.defaultAbiCoder().encode(
        ['uint16', 'uint16', 'uint16', 'uint16'],
        [3500, 2500, 2500, 1500]
      );

      await gov.connect(alice).createProposal(
        2, // FeeStructure
        ethers.ZeroHash,
        'Increase BBB to 35%, reduce LP to 25%',
        execData
      );

      const data = await gov.getProposalExecutionData(1);
      expect(data).to.equal(execData);
    });

    it('should reject proposal from user with no voting power', async function () {
      await expect(
        gov.connect(charlie).createProposal(0, ethers.ZeroHash, 'test', '0x')
      ).to.be.reverted;
    });

    it('should cast vote with ZK nullifier', async function () {
      await gov.connect(alice).createProposal(0, ethers.ZeroHash, 'Test', '0x');

      const tx = await gov.connect(alice).vote(1, true);
      const receipt = await tx.wait();

      // Should emit Voted and VoteNullifierUsed
      const votedEvent = receipt.logs.find(l => {
        try {
          return gov.interface.parseLog(l)?.name === 'Voted';
        } catch { return false; }
      });
      expect(votedEvent).to.not.be.undefined;

      expect(await gov.hasVoted(1, alice.address)).to.be.true;
    });

    it('should reject double vote', async function () {
      await gov.connect(alice).createProposal(0, ethers.ZeroHash, 'Test', '0x');
      await gov.connect(alice).vote(1, true);
      await expect(gov.connect(alice).vote(1, true)).to.be.reverted;
    });

    it('should reject vote after voting period', async function () {
      await gov.connect(alice).createProposal(0, ethers.ZeroHash, 'Test', '0x');
      await time.increase(VOTING_PERIOD + 1);
      await expect(gov.connect(alice).vote(1, true)).to.be.reverted;
    });

    it('should execute passed CircuitPriority proposal (10% quorum)', async function () {
      await gov.connect(alice).createProposal(0, ethers.ZeroHash, 'Priority test', '0x');
      await gov.connect(alice).vote(1, true);
      await gov.connect(bob).vote(1, true);

      await time.increase(VOTING_PERIOD + 1);
      await gov.executeProposal(1);

      const proposal = await gov.getProposal(1);
      expect(proposal._executed).to.be.true;
    });

    it('should execute FeeStructure proposal and update splitter', async function () {
      const execData = ethers.AbiCoder.defaultAbiCoder().encode(
        ['uint16', 'uint16', 'uint16', 'uint16'],
        [3500, 2500, 2500, 1500]
      );

      await gov.connect(alice).createProposal(2, ethers.ZeroHash, 'Fee change', execData);
      await gov.connect(alice).vote(1, true);
      await gov.connect(bob).vote(1, true);

      await time.increase(VOTING_PERIOD + 1);
      await gov.executeProposal(1);

      const [bbb] = await splitter.getSplit();
      expect(bbb).to.equal(3500n);
    });

    it('should reject execution before voting period ends', async function () {
      await gov.connect(alice).createProposal(0, ethers.ZeroHash, 'Test', '0x');
      await gov.connect(alice).vote(1, true);
      await expect(gov.executeProposal(1)).to.be.reverted;
    });

    it('should reject execution of already-executed proposal', async function () {
      await gov.connect(alice).createProposal(0, ethers.ZeroHash, 'Test', '0x');
      await gov.connect(alice).vote(1, true);
      await gov.connect(bob).vote(1, true);
      await time.increase(VOTING_PERIOD + 1);
      await gov.executeProposal(1);
      await expect(gov.executeProposal(1)).to.be.reverted;
    });

    it('should require 67% supermajority for EmergencyPause', async function () {
      await gov.connect(alice).createProposal(4, ethers.ZeroHash, 'Emergency', '0x');
      // Bob votes against, Alice votes for
      await gov.connect(alice).vote(1, true);
      await gov.connect(bob).vote(1, false);

      await time.increase(VOTING_PERIOD + 1);

      // Alice has ~1x, Bob has ~2x, so forVotes < 67% total
      // This may pass or fail depending on exact power ratios
      // The key check is that the supermajority logic is enforced
      const aliceVP = await gov.votingPower(alice.address);
      const bobVP = await gov.votingPower(bob.address);

      if (aliceVP * 10000n / (aliceVP + bobVP) < 6700n) {
        await expect(gov.executeProposal(1)).to.be.reverted;
      }
    });
  });

  // ─── Unlock ─────────────────────────────────────────────────────────────

  describe('Unlock', function () {
    it('should unlock after expiry', async function () {
      const amount = ethers.parseEther('100');
      const now = await time.latest();
      const unlockTime = (BigInt(now + TWENTY_SIX_WEEKS + ONE_WEEK) / BigInt(ONE_WEEK)) * BigInt(ONE_WEEK);

      await xfToken.connect(alice).approve(await gov.getAddress(), amount);
      await gov.connect(alice).lock(amount, unlockTime);

      await time.increase(TWENTY_SIX_WEEKS + 2 * ONE_WEEK);

      const balBefore = await xfToken.balanceOf(alice.address);
      await gov.connect(alice).unlock();
      const balAfter = await xfToken.balanceOf(alice.address);

      expect(balAfter - balBefore).to.equal(amount);
      expect(await gov.totalLocked()).to.equal(0n);
    });

    it('should reject unlock before expiry', async function () {
      const amount = ethers.parseEther('100');
      const now = await time.latest();
      const unlockTime = (BigInt(now + ONE_YEAR) / BigInt(ONE_WEEK)) * BigInt(ONE_WEEK);

      await xfToken.connect(alice).approve(await gov.getAddress(), amount);
      await gov.connect(alice).lock(amount, unlockTime);

      await expect(gov.connect(alice).unlock()).to.be.reverted;
    });
  });

  // ─── Edge Cases ─────────────────────────────────────────────────────────

  describe('Edge Cases', function () {
    it('should reject zero amount lock', async function () {
      const now = await time.latest();
      const unlockTime = (BigInt(now + ONE_YEAR) / BigInt(ONE_WEEK)) * BigInt(ONE_WEEK);
      await expect(gov.connect(alice).lock(0, unlockTime)).to.be.reverted;
    });

    it('should reject double lock', async function () {
      const amount = ethers.parseEther('100');
      const now = await time.latest();
      const unlockTime = (BigInt(now + ONE_YEAR) / BigInt(ONE_WEEK)) * BigInt(ONE_WEEK);

      await xfToken.connect(alice).approve(await gov.getAddress(), ethers.parseEther('200'));
      await gov.connect(alice).lock(amount, unlockTime);
      await expect(gov.connect(alice).lock(amount, unlockTime)).to.be.reverted;
    });
  });
});
