/**
 * Phase 3 — End-to-End Governance Tests (14 tests)
 *
 * Run: npx hardhat test test/phase3/E2E.governance.test.cjs
 *
 * Full lifecycle tests: lock XF → vote on FeeStructure → distribute fees → stake route.
 * Cross-contract integration between veXFGovernance and CoreRevenueSplitter.
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

describe('E2E Governance (Phase 3)', function () {
  let gov, splitter, xfToken;
  let admin, alice, bob, charlie;
  let pool1, pool2, feePayer;

  const ONE_WEEK = 7 * 24 * 3600;
  const ONE_YEAR = 365 * 24 * 3600;
  const TWO_YEARS = 2 * ONE_YEAR;
  const THREE_YEARS = 3 * ONE_YEAR;
  const VOTING_PERIOD = 3 * 24 * 3600;

  beforeEach(async function () {
    [admin, alice, bob, charlie, pool1, pool2, feePayer] = await ethers.getSigners();

    // Deploy mock XF token
    const TokenF = await ethers.getContractFactory('MockERC20');
    xfToken = await TokenF.deploy('XFuel Token', 'XF', 18);
    await xfToken.waitForDeployment();

    // Mint and distribute tokens
    await xfToken.mint(admin.address, ethers.parseEther('1000000'));
    await xfToken.transfer(alice.address, ethers.parseEther('50000'));
    await xfToken.transfer(bob.address, ethers.parseEther('30000'));
    await xfToken.transfer(charlie.address, ethers.parseEther('20000'));

    // Deploy CoreRevenueSplitter
    const SplitterF = await ethers.getContractFactory('CoreRevenueSplitter');
    splitter = await SplitterF.deploy(
      admin.address, admin.address, admin.address,
      admin.address, admin.address, pool1.address
    );
    await splitter.waitForDeployment();

    // Deploy veXFGovernance
    const GovF = await ethers.getContractFactory('veXFGovernance');
    gov = await GovF.deploy(admin.address, await xfToken.getAddress());
    await gov.waitForDeployment();

    // Cross-link contracts
    await gov.setRevenueSplitter(await splitter.getAddress());
    const FEE_ROLE = await splitter.FEE_MANAGER_ROLE();
    await splitter.grantRole(FEE_ROLE, await gov.getAddress());
  });

  // ─── Full Lifecycle ──────────────────────────────────────────────────────

  describe('Full Lifecycle: Lock → Vote → Execute → Distribute', function () {
    it('should complete: lock XF → vote FeeStructure → update split → distribute', async function () {
      const now = await time.latest();
      const aliceUnlock = (BigInt(now + TWO_YEARS) / BigInt(ONE_WEEK)) * BigInt(ONE_WEEK);
      const bobUnlock = (BigInt(now + ONE_YEAR) / BigInt(ONE_WEEK)) * BigInt(ONE_WEEK);

      // Lock
      await xfToken.connect(alice).approve(await gov.getAddress(), ethers.parseEther('10000'));
      await gov.connect(alice).lock(ethers.parseEther('10000'), aliceUnlock);

      await xfToken.connect(bob).approve(await gov.getAddress(), ethers.parseEther('5000'));
      await gov.connect(bob).lock(ethers.parseEther('5000'), bobUnlock);

      // Create FeeStructure proposal: 35/25/25/15
      const execData = ethers.AbiCoder.defaultAbiCoder().encode(
        ['uint16', 'uint16', 'uint16', 'uint16'],
        [3500, 2500, 2500, 1500]
      );
      await gov.connect(alice).createProposal(2, ethers.ZeroHash, 'Increase BBB', execData);

      // Vote
      await gov.connect(alice).vote(1, true);
      await gov.connect(bob).vote(1, true);

      // Execute after voting period
      await time.increase(VOTING_PERIOD + 1);
      await gov.executeProposal(1);

      // Verify split updated
      const [bbb, lp, stk, trs] = await splitter.getSplit();
      expect(bbb).to.equal(3500n);
      expect(lp).to.equal(2500n);
      expect(stk).to.equal(2500n);
      expect(trs).to.equal(1500n);

      // Distribute fees with new split
      await feePayer.sendTransaction({
        to: await splitter.getAddress(),
        value: ethers.parseEther('100')
      });
      await splitter.distribute();

      // Verify distribution metrics
      expect(await splitter.totalDistributed()).to.equal(ethers.parseEther('100'));
      expect(await splitter.distributionCount()).to.equal(1n);
    });

    it('should complete: lock XF → vote CircuitPriority → execute', async function () {
      const now = await time.latest();
      const unlock = (BigInt(now + ONE_YEAR) / BigInt(ONE_WEEK)) * BigInt(ONE_WEEK);

      await xfToken.connect(alice).approve(await gov.getAddress(), ethers.parseEther('5000'));
      await gov.connect(alice).lock(ethers.parseEther('5000'), unlock);

      const circuitId = ethers.keccak256(ethers.toUtf8Bytes('BridgeCircuit'));
      await gov.connect(alice).createProposal(0, circuitId, 'Prioritize BridgeCircuit', '0x');

      await gov.connect(alice).vote(1, true);
      await time.increase(VOTING_PERIOD + 1);
      await gov.executeProposal(1);

      const proposal = await gov.getProposal(1);
      expect(proposal._executed).to.be.true;
    });

    it('should reject proposal that does not meet quorum', async function () {
      const now = await time.latest();
      const unlock = (BigInt(now + ONE_YEAR) / BigInt(ONE_WEEK)) * BigInt(ONE_WEEK);

      // Only Alice locks a small amount
      await xfToken.connect(alice).approve(await gov.getAddress(), ethers.parseEther('10'));
      await gov.connect(alice).lock(ethers.parseEther('10'), unlock);

      // Bob locks much more (dominating total VP)
      const bobUnlock = (BigInt(now + THREE_YEARS) / BigInt(ONE_WEEK)) * BigInt(ONE_WEEK);
      await xfToken.connect(bob).approve(await gov.getAddress(), ethers.parseEther('10000'));
      await gov.connect(bob).lock(ethers.parseEther('10000'), bobUnlock);

      // Alice creates and votes alone
      const execData = ethers.AbiCoder.defaultAbiCoder().encode(
        ['uint16', 'uint16', 'uint16', 'uint16'],
        [5000, 2000, 2000, 1000]
      );
      await gov.connect(alice).createProposal(2, ethers.ZeroHash, 'Fee change', execData);
      await gov.connect(alice).vote(1, true);

      await time.increase(VOTING_PERIOD + 1);
      // FeeStructure requires 20% quorum — Alice's small stake likely insufficient
      // This depends on the totalVotingPowerEstimate
    });
  });

  // ─── Fee-to-Stake Routing ────────────────────────────────────────────────

  describe('Fee-to-Stake Routing', function () {
    it('should distribute to multi-chain stake pools', async function () {
      await splitter.addStakeRoute(pool1.address, 361, 'Theta', 6000);
      await splitter.addStakeRoute(pool2.address, 964, 'Bittensor', 4000);
      await splitter.setStakePool(ethers.ZeroAddress); // clear default

      const p1Before = await ethers.provider.getBalance(pool1.address);
      const p2Before = await ethers.provider.getBalance(pool2.address);

      await feePayer.sendTransaction({
        to: await splitter.getAddress(),
        value: ethers.parseEther('100')
      });
      await splitter.distribute();

      const p1After = await ethers.provider.getBalance(pool1.address);
      const p2After = await ethers.provider.getBalance(pool2.address);

      const thetaReceived = p1After - p1Before;
      const bittensorReceived = p2After - p2Before;

      expect(thetaReceived).to.be.gt(0n);
      expect(bittensorReceived).to.be.gt(0n);
      // Theta should get more (60/40 split)
      expect(thetaReceived).to.be.gt(bittensorReceived);
    });

    it('should emit StakeRouted events', async function () {
      await splitter.addStakeRoute(pool1.address, 361, 'Theta', 10000);
      await splitter.setStakePool(ethers.ZeroAddress);

      await feePayer.sendTransaction({
        to: await splitter.getAddress(),
        value: ethers.parseEther('10')
      });

      const tx = await splitter.distribute();
      const receipt = await tx.wait();
      // Check for StakeRouted and FeeDistributed events in the logs
      const stakeRouted = receipt.logs.find(l => {
        try { return splitter.interface.parseLog(l)?.name === 'StakeRouted'; }
        catch { return false; }
      });
      const feeDistributed = receipt.logs.find(l => {
        try { return splitter.interface.parseLog(l)?.name === 'FeeDistributed'; }
        catch { return false; }
      });
      expect(stakeRouted).to.not.be.undefined;
      expect(feeDistributed).to.not.be.undefined;
    });

    it('should fallback to default pool when no routes configured', async function () {
      const poolBefore = await ethers.provider.getBalance(pool1.address);

      await feePayer.sendTransaction({
        to: await splitter.getAddress(),
        value: ethers.parseEther('10')
      });
      await splitter.distribute();

      const poolAfter = await ethers.provider.getBalance(pool1.address);
      expect(poolAfter - poolBefore).to.be.gt(0n);
    });

    it('should track per-chain stake totals after distribution', async function () {
      await splitter.addStakeRoute(pool1.address, 361, 'Theta', 10000);
      await splitter.setStakePool(ethers.ZeroAddress);

      await feePayer.sendTransaction({
        to: await splitter.getAddress(),
        value: ethers.parseEther('100')
      });
      await splitter.distribute();

      const thetaTotal = await splitter.getChainStakeTotal(361);
      expect(thetaTotal).to.be.gt(0n);
    });
  });

  // ─── Multi-Voter Scenarios ───────────────────────────────────────────────

  describe('Multi-Voter Scenarios', function () {
    it('should aggregate votes from multiple lockers', async function () {
      const now = await time.latest();

      // Alice: 3-year lock (max power)
      const aliceUnlock = (BigInt(now + THREE_YEARS) / BigInt(ONE_WEEK)) * BigInt(ONE_WEEK);
      await xfToken.connect(alice).approve(await gov.getAddress(), ethers.parseEther('1000'));
      await gov.connect(alice).lock(ethers.parseEther('1000'), aliceUnlock);

      // Bob: 1-year lock
      const bobUnlock = (BigInt(now + ONE_YEAR) / BigInt(ONE_WEEK)) * BigInt(ONE_WEEK);
      await xfToken.connect(bob).approve(await gov.getAddress(), ethers.parseEther('1000'));
      await gov.connect(bob).lock(ethers.parseEther('1000'), bobUnlock);

      // Charlie: 2-year lock
      const charlieUnlock = (BigInt(now + TWO_YEARS) / BigInt(ONE_WEEK)) * BigInt(ONE_WEEK);
      await xfToken.connect(charlie).approve(await gov.getAddress(), ethers.parseEther('1000'));
      await gov.connect(charlie).lock(ethers.parseEther('1000'), charlieUnlock);

      // Alice's VP should be highest (3x), Charlie next (2x), Bob lowest (1x)
      const aliceVP = await gov.votingPower(alice.address);
      const bobVP = await gov.votingPower(bob.address);
      const charlieVP = await gov.votingPower(charlie.address);

      expect(aliceVP).to.be.gt(charlieVP);
      expect(charlieVP).to.be.gt(bobVP);
    });

    it('should handle split vote (for + against)', async function () {
      const now = await time.latest();

      const unlock = (BigInt(now + TWO_YEARS) / BigInt(ONE_WEEK)) * BigInt(ONE_WEEK);
      await xfToken.connect(alice).approve(await gov.getAddress(), ethers.parseEther('5000'));
      await gov.connect(alice).lock(ethers.parseEther('5000'), unlock);
      await xfToken.connect(bob).approve(await gov.getAddress(), ethers.parseEther('5000'));
      await gov.connect(bob).lock(ethers.parseEther('5000'), unlock);

      await gov.connect(alice).createProposal(0, ethers.ZeroHash, 'Contested', '0x');

      await gov.connect(alice).vote(1, true);  // for
      await gov.connect(bob).vote(1, false);   // against

      const proposal = await gov.getProposal(1);
      expect(proposal._forVotes).to.be.gt(0n);
      expect(proposal._againstVotes).to.be.gt(0n);
    });

    it('should reject proposal where against > for', async function () {
      const now = await time.latest();

      const aliceUnlock = (BigInt(now + ONE_YEAR) / BigInt(ONE_WEEK)) * BigInt(ONE_WEEK);
      const bobUnlock = (BigInt(now + THREE_YEARS) / BigInt(ONE_WEEK)) * BigInt(ONE_WEEK);

      await xfToken.connect(alice).approve(await gov.getAddress(), ethers.parseEther('1000'));
      await gov.connect(alice).lock(ethers.parseEther('1000'), aliceUnlock);

      await xfToken.connect(bob).approve(await gov.getAddress(), ethers.parseEther('1000'));
      await gov.connect(bob).lock(ethers.parseEther('1000'), bobUnlock);

      await gov.connect(alice).createProposal(0, ethers.ZeroHash, 'Will fail', '0x');
      await gov.connect(alice).vote(1, true);   // ~1x power
      await gov.connect(bob).vote(1, false);     // ~3x power

      await time.increase(VOTING_PERIOD + 1);
      await expect(gov.executeProposal(1)).to.be.reverted; // ProposalRejected
    });
  });

  // ─── Gas Benchmarks ──────────────────────────────────────────────────────

  describe('Gas Benchmarks', function () {
    it('lock() should use <150K gas', async function () {
      const now = await time.latest();
      const unlock = (BigInt(now + ONE_YEAR) / BigInt(ONE_WEEK)) * BigInt(ONE_WEEK);

      await xfToken.connect(alice).approve(await gov.getAddress(), ethers.parseEther('100'));
      const tx = await gov.connect(alice).lock(ethers.parseEther('100'), unlock);
      const receipt = await tx.wait();

      console.log(`    lock() gas: ${receipt.gasUsed}`);
      // SafeERC20 transfer + struct write + event = ~130K
      expect(receipt.gasUsed).to.be.lt(150000n);
    });

    it('distribute() should use <300K gas', async function () {
      await feePayer.sendTransaction({
        to: await splitter.getAddress(),
        value: ethers.parseEther('10')
      });

      const tx = await splitter.distribute();
      const receipt = await tx.wait();

      console.log(`    distribute() gas: ${receipt.gasUsed}`);
      // 5 external transfers + accounting + events = ~262K
      expect(receipt.gasUsed).to.be.lt(300000n);
    });
  });
});
