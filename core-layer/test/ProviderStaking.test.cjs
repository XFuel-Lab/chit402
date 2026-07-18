/**
 * Core Layer — ProviderStaking Hardhat Tests (Verified Inference Phase 4 — T3b economics)
 *
 * Run: npx hardhat test core-layer/test/ProviderStaking.test.cjs
 *
 * Covers: stake/unstake cooldown/withdraw, slashing (active + unbonding), ProviderSlashed +
 * reputation, freeze, active-provider status, access control, pause.
 *
 * Note: .to.be.reverted is used instead of .revertedWithCustomError — hardhat-chai-matchers@1.x
 * is not compatible with ethers v6 for custom-error matching.
 */

const { expect } = require('chai');
const { ethers } = require('hardhat');

describe('ProviderStaking', function () {
  let token, staking;
  let admin, provider, slasher, treasury, stranger;

  const MIN_STAKE = 1000n;
  const UNBONDING = 7 * 24 * 60 * 60; // 7 days
  const TASK_HASH = ethers.keccak256(ethers.toUtf8Bytes('task-1'));

  async function increaseTime(seconds) {
    await ethers.provider.send('evm_increaseTime', [seconds]);
    await ethers.provider.send('evm_mine', []);
  }

  beforeEach(async function () {
    [admin, provider, slasher, treasury, stranger] = await ethers.getSigners();
    const Token = await ethers.getContractFactory('MockERC20');
    token = await Token.deploy('USD Coin', 'USDC', 0);
    await token.mint(provider.address, 1_000_000n);

    const Staking = await ethers.getContractFactory('ProviderStaking');
    staking = await Staking.deploy(admin.address, await token.getAddress(), treasury.address, MIN_STAKE, UNBONDING);
    await staking.grantRole(await staking.SLASHER_ROLE(), slasher.address);

    await token.connect(provider).approve(await staking.getAddress(), 1_000_000n);
  });

  it('stakes and tracks active + total', async function () {
    await expect(staking.connect(provider).stake(5000n))
      .to.emit(staking, 'Staked')
      .withArgs(provider.address, 5000n, 5000n);
    expect(await staking.stakeOf(provider.address)).to.equal(5000n);
    expect(await staking.totalActiveStake()).to.equal(5000n);
    expect(await staking.isActiveProvider(provider.address)).to.equal(true);
  });

  it('rejects zero stake and unapproved transfer', async function () {
    await expect(staking.connect(provider).stake(0)).to.be.reverted;
    await expect(staking.connect(stranger).stake(1000n)).to.be.reverted; // no balance/approval
  });

  it('isActiveProvider is false below minStake', async function () {
    await staking.connect(provider).stake(500n);
    expect(await staking.isActiveProvider(provider.address)).to.equal(false);
  });

  it('requestUnstake moves to pending and enforces cooldown on withdraw', async function () {
    await staking.connect(provider).stake(5000n);
    await expect(staking.connect(provider).requestUnstake(2000n)).to.emit(staking, 'UnstakeRequested');
    expect(await staking.stakeOf(provider.address)).to.equal(3000n);
    const [amt] = await staking.pendingOf(provider.address);
    expect(amt).to.equal(2000n);

    await expect(staking.connect(provider).withdraw()).to.be.reverted; // still unbonding
    await increaseTime(UNBONDING + 1);
    const before = await token.balanceOf(provider.address);
    await expect(staking.connect(provider).withdraw()).to.emit(staking, 'Withdrawn');
    expect(await token.balanceOf(provider.address)).to.equal(before + 2000n);
  });

  it('cannot unstake more than active', async function () {
    await staking.connect(provider).stake(1000n);
    await expect(staking.connect(provider).requestUnstake(2000n)).to.be.reverted;
  });

  it('slashes from active stake → treasury and bumps reputation', async function () {
    await staking.connect(provider).stake(5000n);
    const tBefore = await token.balanceOf(treasury.address);
    await expect(staking.connect(slasher).slash(provider.address, 1500n, TASK_HASH, 'spotcheck-mismatch'))
      .to.emit(staking, 'ProviderSlashed')
      .withArgs(provider.address, 1500n, TASK_HASH, 'spotcheck-mismatch');
    expect(await staking.stakeOf(provider.address)).to.equal(3500n);
    expect(await staking.slashCount(provider.address)).to.equal(1n);
    expect(await token.balanceOf(treasury.address)).to.equal(tBefore + 1500n);
  });

  it('slash dips into the unbonding bucket when active is insufficient', async function () {
    await staking.connect(provider).stake(5000n);
    await staking.connect(provider).requestUnstake(4000n); // active 1000, pending 4000
    await staking.connect(slasher).slash(provider.address, 2500n, TASK_HASH, 'dispute');
    expect(await staking.stakeOf(provider.address)).to.equal(0n);
    const [amt] = await staking.pendingOf(provider.address);
    expect(amt).to.equal(2500n); // 4000 - (2500 - 1000)
  });

  it('slash reverts when amount exceeds total stake', async function () {
    await staking.connect(provider).stake(1000n);
    await expect(staking.connect(slasher).slash(provider.address, 2000n, TASK_HASH, 'x')).to.be.reverted;
  });

  it('only SLASHER_ROLE can slash / freeze', async function () {
    await staking.connect(provider).stake(2000n);
    await expect(staking.connect(stranger).slash(provider.address, 100n, TASK_HASH, 'x')).to.be.reverted;
    await expect(staking.connect(stranger).setFrozen(provider.address, true)).to.be.reverted;
  });

  it('frozen provider cannot unstake or withdraw', async function () {
    await staking.connect(provider).stake(5000n);
    await staking.connect(slasher).setFrozen(provider.address, true);
    await expect(staking.connect(provider).requestUnstake(1000n)).to.be.reverted;
    await staking.connect(slasher).setFrozen(provider.address, false);
    await staking.connect(provider).requestUnstake(1000n);
    await increaseTime(UNBONDING + 1);
    await staking.connect(slasher).setFrozen(provider.address, true);
    await expect(staking.connect(provider).withdraw()).to.be.reverted;
  });

  it('setParams is OPERATOR-gated and updates config', async function () {
    await expect(staking.connect(stranger).setParams(2000n, 100, treasury.address)).to.be.reverted;
    await expect(staking.setParams(2000n, 100, treasury.address)).to.emit(staking, 'ParamsUpdated');
    expect(await staking.minStake()).to.equal(2000n);
  });

  it('pause blocks staking until unpaused', async function () {
    await staking.pause();
    await expect(staking.connect(provider).stake(1000n)).to.be.reverted;
    await staking.unpause();
    await staking.connect(provider).stake(1000n);
    expect(await staking.stakeOf(provider.address)).to.equal(1000n);
  });
});
