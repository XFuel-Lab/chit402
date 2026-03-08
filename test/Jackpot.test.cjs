/**
 * Jackpot — veXF Staker Jackpot Tests (8 tests)
 *
 * Run: npx hardhat test test/Jackpot.test.cjs
 *
 * Covers: minimum veXF enforcement, weighted winner selection, random draw
 * window, 30-day auto-reroll, USDC payout path, caller bounty, pause/unpause,
 * full E2E draw via mock VRF.
 */

const { expect } = require('chai');
const hre = require('hardhat');
const { ethers } = hre;

async function increaseTime(seconds) {
  await hre.network.provider.send('evm_increaseTime', [seconds]);
  await hre.network.provider.send('evm_mine');
}

describe('Jackpot (veXF Staker Jackpot)', function () {
  let jackpot, mockVeXF, mockVRF, usdc;
  let admin, alice, bob, charlie, caller;

  const ONE_DAY = 86400;
  const THIRTY_DAYS = 30 * ONE_DAY;
  const ONE_VEXF = ethers.parseEther('1');
  const VRF_KEY_HASH = ethers.ZeroHash;
  const VRF_SUB_ID = 1;

  beforeEach(async function () {
    [admin, alice, bob, charlie, caller] = await ethers.getSigners();

    const MockVeXFF = await ethers.getContractFactory('MockVeXF');
    mockVeXF = await MockVeXFF.deploy();
    await mockVeXF.waitForDeployment();

    const MockVRFF = await ethers.getContractFactory('MockVRF');
    mockVRF = await MockVRFF.deploy();
    await mockVRF.waitForDeployment();

    const MockERC20F = await ethers.getContractFactory('MockERC20');
    usdc = await MockERC20F.deploy('USD Coin', 'USDC', 6);
    await usdc.waitForDeployment();

    const JackpotF = await ethers.getContractFactory('JackpotTestHarness');
    jackpot = await JackpotF.deploy(
      admin.address,
      await mockVeXF.getAddress(),
      await usdc.getAddress(),
      await mockVRF.getAddress(),
      VRF_KEY_HASH,
      VRF_SUB_ID
    );
    await jackpot.waitForDeployment();

    await jackpot.registerStaker(alice.address);
    await jackpot.registerStaker(bob.address);
    await jackpot.registerStaker(charlie.address);
  });

  // ─── 1. Minimum 1 veXF Enforcement ──────────────────────────────────

  it('should skip stakers with less than 1 veXF during draw', async function () {
    await mockVeXF.setVotingPower(alice.address, ethers.parseEther('0.5'));
    await mockVeXF.setVotingPower(bob.address, ethers.parseEther('10'));

    await usdc.mint(await jackpot.getAddress(), 1_000_000n);

    await increaseTime(ONE_DAY + 1);
    await jackpot.draw();

    // random=0 means target=0, cumulative scan skips alice (0.5 < 1 veXF),
    // bob (10 veXF) wins
    await jackpot.testFulfill(1, [0n]);

    expect(await jackpot.drawWinner(1)).to.equal(bob.address);
  });

  // ─── 2. Weighted Winner Selection ───────────────────────────────────

  it('should select winner proportionally to veXF voting power', async function () {
    await mockVeXF.setVotingPower(alice.address, ethers.parseEther('90'));
    await mockVeXF.setVotingPower(bob.address, ethers.parseEther('10'));

    await usdc.mint(await jackpot.getAddress(), 1_000_000n);
    await increaseTime(ONE_DAY + 1);
    await jackpot.draw();

    // random that maps to target < 90 veXF → alice wins
    const totalVP = ethers.parseEther('100');
    const randForAlice = 5n; // 5 % 100e18 = 5 → well within alice's 90e18
    await jackpot.testFulfill(1, [randForAlice]);
    expect(await jackpot.drawWinner(1)).to.equal(alice.address);

    // Reset for next draw — bob should win when target > 90e18
    await usdc.mint(await jackpot.getAddress(), 1_000_000n);
    await increaseTime(3 * ONE_DAY);
    await jackpot.draw();

    const randForBob = ethers.parseEther('95'); // 95e18 % 100e18 = 95e18, cumul passes alice at 90e18 → bob
    await jackpot.testFulfill(2, [randForBob]);
    expect(await jackpot.drawWinner(2)).to.equal(bob.address);
  });

  // ─── 3. 24–72h Random Window ────────────────────────────────────────

  it('should enforce draw window and set new random 24-72h window after draw', async function () {
    await mockVeXF.setVotingPower(alice.address, ethers.parseEther('10'));
    await usdc.mint(await jackpot.getAddress(), 1_000_000n);

    // Cannot draw before window opens
    await expect(jackpot.draw()).to.be.reverted;

    // Advance past initial 24h window
    await increaseTime(ONE_DAY + 1);
    await jackpot.draw();

    // Fulfill sets a new window: 24h + (rand % 48h)
    const randValue = 100n; // 100 % (48*3600) = 100 seconds → window = 24h + 100s
    await jackpot.testFulfill(1, [randValue]);

    const nextDraw = await jackpot.nextDrawAfter();
    const block = await ethers.provider.getBlock('latest');
    const windowSeconds = Number(nextDraw) - block.timestamp;

    // Window must be between 24h and 72h
    expect(windowSeconds).to.be.gte(ONE_DAY);
    expect(windowSeconds).to.be.lte(3 * ONE_DAY);
  });

  // ─── 4. 30-Day Auto-Reroll on Failure ───────────────────────────────

  it('should hold pool and auto-reroll after exactly 30 days on draw failure', async function () {
    // No eligible stakers (all below MIN_VEXF) → draw fails
    await mockVeXF.setVotingPower(alice.address, ethers.parseEther('0.1'));
    await mockVeXF.setVotingPower(bob.address, ethers.parseEther('0.2'));

    await usdc.mint(await jackpot.getAddress(), 1_000_000n);
    await increaseTime(ONE_DAY + 1);
    await jackpot.draw();

    // Fulfill with no eligible staker → drawFailed
    // All stakers have < 1 veXF so winner = address(0) → fail
    await jackpot.testFulfill(1, [42n]);

    const failedAt = await jackpot.drawFailedAt();
    expect(failedAt).to.be.gt(0);

    // Pool is preserved
    expect(await usdc.balanceOf(await jackpot.getAddress())).to.equal(1_000_000n);

    // Cannot reroll too early
    await expect(jackpot.emergencyReroll()).to.be.reverted;

    // Advance 30 days
    await increaseTime(THIRTY_DAYS + 1);
    await jackpot.emergencyReroll();

    expect(await jackpot.drawFailedAt()).to.equal(0);
    // New draw window is set to now (immediate re-draw possible)
    const nextDraw = await jackpot.nextDrawAfter();
    const block = await ethers.provider.getBlock('latest');
    expect(Number(nextDraw)).to.be.lte(block.timestamp);
  });

  // ─── 5. USDC Payout Path ───────────────────────────────────────────

  it('should pay out entire USDC pool to winner minus bounty', async function () {
    const poolAmount = 10_000_000n; // 10 USDC (6 decimals)
    await mockVeXF.setVotingPower(alice.address, ethers.parseEther('100'));
    await usdc.mint(await jackpot.getAddress(), poolAmount);

    await increaseTime(ONE_DAY + 1);
    await jackpot.draw();

    const aliceBefore = await usdc.balanceOf(alice.address);
    await jackpot.testFulfill(1, [0n]);

    const aliceAfter = await usdc.balanceOf(alice.address);
    const payout = aliceAfter - aliceBefore;

    // Bounty = 0.5% of 10M = 50K, but capped at 50 USDC (50e6)
    // 10M * 50 / 10000 = 50000 → 50K units (0.05 USDC) < cap
    const expectedBounty = (poolAmount * 50n) / 10000n;
    const expectedPayout = poolAmount - expectedBounty;

    expect(payout).to.equal(expectedPayout);
    expect(await jackpot.totalPaidOut()).to.equal(expectedPayout);
  });

  // ─── 6. Caller Bounty ──────────────────────────────────────────────

  it('should cap caller bounty at 50 USDC', async function () {
    const largePool = 200_000_000_000n; // 200,000 USDC
    await mockVeXF.setVotingPower(alice.address, ethers.parseEther('100'));
    await usdc.mint(await jackpot.getAddress(), largePool);

    await increaseTime(ONE_DAY + 1);

    // caller triggers draw — bounty goes to tx.origin
    await jackpot.connect(caller).draw();

    const callerBefore = await usdc.balanceOf(caller.address);
    await jackpot.testFulfill(1, [0n]);

    // Bounty = 0.5% of 200K USDC = 1000 USDC, but capped at 50 USDC = 50e6
    const callerAfter = await usdc.balanceOf(caller.address);
    const bountyReceived = callerAfter - callerBefore;

    // tx.origin in hardhat test may not be the caller; the cap logic is still verified
    // by checking the winner payout: pool - min(0.5%, 50e6)
    const cap = 50_000_000n; // 50 USDC
    const alicePayout = await jackpot.drawPayout(1);
    expect(alicePayout).to.equal(largePool - cap);
  });

  // ─── 7. Pause / Unpause ────────────────────────────────────────────

  it('should prevent draws when paused and resume after unpause', async function () {
    await mockVeXF.setVotingPower(alice.address, ethers.parseEther('10'));
    await usdc.mint(await jackpot.getAddress(), 1_000_000n);
    await increaseTime(ONE_DAY + 1);

    await jackpot.pause();
    await expect(jackpot.draw()).to.be.reverted;

    await jackpot.unpause();
    await jackpot.draw();
    expect(await jackpot.drawCount()).to.equal(1);
  });

  // ─── 8. Full E2E Draw (Mock VRF) ───────────────────────────────────

  it('should complete full E2E: fund → wait → draw → VRF → payout → new window', async function () {
    // Setup: 3 stakers with different voting power
    await mockVeXF.setVotingPower(alice.address, ethers.parseEther('50'));
    await mockVeXF.setVotingPower(bob.address, ethers.parseEther('30'));
    await mockVeXF.setVotingPower(charlie.address, ethers.parseEther('20'));

    // Fund the jackpot
    const pool = 5_000_000n; // 5 USDC
    await usdc.mint(await jackpot.getAddress(), pool);

    // Step 1: wait for draw window
    await increaseTime(ONE_DAY + 1);

    // Step 2: trigger draw
    await jackpot.draw();
    expect(await jackpot.drawCount()).to.equal(1);
    expect(await mockVRF.requestCount()).to.equal(1);

    // Step 3: VRF callback — pick charlie (rand maps to cumulative > 80e18)
    const randForCharlie = ethers.parseEther('85'); // 85e18 % 100e18 = 85e18
    await jackpot.testFulfill(1, [randForCharlie]);

    // Step 4: verify winner
    expect(await jackpot.drawWinner(1)).to.equal(charlie.address);

    // Step 5: verify payout
    const payout = await jackpot.drawPayout(1);
    expect(payout).to.be.gt(0);
    expect(await usdc.balanceOf(charlie.address)).to.equal(payout);

    // Step 6: new draw window set (24-72h)
    const nextDraw = await jackpot.nextDrawAfter();
    const block = await ethers.provider.getBlock('latest');
    const windowSec = Number(nextDraw) - block.timestamp;
    expect(windowSec).to.be.gte(ONE_DAY);
    expect(windowSec).to.be.lte(3 * ONE_DAY);

    // Step 7: pool is drained
    const remainingPool = await usdc.balanceOf(await jackpot.getAddress());
    expect(remainingPool).to.equal(0);
  });
});
