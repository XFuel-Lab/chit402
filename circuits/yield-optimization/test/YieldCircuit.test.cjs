/**
 * Yield Optimization Circuit — Hardhat Tests (15 tests)
 *
 * Run: npx hardhat test circuits/yield-optimization/test/YieldCircuit.test.cjs
 */
const { expect } = require('chai');
const { ethers } = require('hardhat');

describe('YieldCircuit', function () {
  let circuit, splitter;
  let admin, keeper, user1, user2;
  let bbb, lp, staker, treasury, stakePool;

  const MOCK_PROOF = '0x' + 'ab'.repeat(130);
  const MOCK_PV = '0x' + 'cd'.repeat(64);
  const ALLOC_HASH = ethers.keccak256(ethers.toUtf8Bytes('alloc-osmo-60-aave-40'));
  const CONFIG_HASH = ethers.keccak256(ethers.toUtf8Bytes('osmo-usdc-usdt-cl'));

  let poolId;

  beforeEach(async function () {
    [admin, keeper, user1, user2, bbb, lp, staker, treasury, stakePool] = await ethers.getSigners();

    const SF = await ethers.getContractFactory('CoreRevenueSplitter');
    splitter = await SF.deploy(admin.address, bbb.address, lp.address, staker.address, treasury.address, stakePool.address);
    await splitter.waitForDeployment();

    const CF = await ethers.getContractFactory('YieldCircuit');
    circuit = await CF.deploy(admin.address, await splitter.getAddress(), ethers.ZeroAddress);
    await circuit.waitForDeployment();

    const KEEPER_ROLE = await circuit.KEEPER_ROLE();
    await circuit.grantRole(KEEPER_ROLE, keeper.address);
    const CIRCUIT_ROLE = await splitter.CIRCUIT_ROLE();
    await splitter.grantRole(CIRCUIT_ROLE, await circuit.getAddress());

    // Register a default pool
    const tx = await circuit.registerPool('osmosis', 'osmosis-1', CONFIG_HASH, 3000);
    const r = await tx.wait();
    const ev = r.logs.find(l => { try { return circuit.interface.parseLog(l)?.name === 'PoolRegistered'; } catch { return false; } });
    poolId = circuit.interface.parseLog(ev).args.poolId;
  });

  // ═══ POOL REGISTRY ═══
  describe('Pool Registry', function () {
    it('should register a yield pool', async function () {
      const p = await circuit.getPool(poolId);
      expect(p.protocol).to.equal('osmosis');
      expect(p.chain).to.equal('osmosis-1');
      expect(p.currentApy).to.equal(3000n);
    });

    it('should register multiple pools', async function () {
      await circuit.registerPool('aave', 'ethereum', CONFIG_HASH, 500);
      await circuit.registerPool('curve', 'arbitrum', CONFIG_HASH, 1200);
      expect(await circuit.poolCount()).to.equal(3n);
    });

    it('should update pool APY and status', async function () {
      await circuit.updatePool(poolId, 4500, false);
      const p = await circuit.getPool(poolId);
      expect(p.currentApy).to.equal(4500n);
      expect(p.active).to.be.false;
    });
  });

  // ═══ POSITIONS ═══
  describe('Position Management', function () {
    it('should open a position with fee deduction', async function () {
      const deposit = ethers.parseEther('100');
      const expectedFee = ethers.parseEther('0.5');

      const splBefore = await ethers.provider.getBalance(await splitter.getAddress());
      const tx = await circuit.connect(user1).openPosition({ value: deposit });
      const splAfter = await ethers.provider.getBalance(await splitter.getAddress());

      expect(splAfter - splBefore).to.equal(expectedFee);
      const r = await tx.wait();
      const ev = r.logs.find(l => { try { return circuit.interface.parseLog(l)?.name === 'PositionOpened'; } catch { return false; } });
      expect(ev).to.not.be.undefined;
    });

    it('should reject zero deposit', async function () {
      await expect(circuit.connect(user1).openPosition({ value: 0 })).to.be.revertedWith('ZeroDeposit');
    });

    it('should close position and return funds', async function () {
      const tx = await circuit.connect(user1).openPosition({ value: ethers.parseEther('10') });
      const r = await tx.wait();
      const ev = r.logs.find(l => { try { return circuit.interface.parseLog(l)?.name === 'PositionOpened'; } catch { return false; } });
      const posId = circuit.interface.parseLog(ev).args.positionId;

      const u1Before = await ethers.provider.getBalance(user1.address);
      await circuit.connect(user1).closePosition(posId);
      const u1After = await ethers.provider.getBalance(user1.address);
      expect(u1After).to.be.gt(u1Before);
    });
  });

  // ═══ ZK REBALANCE ═══
  describe('ZK Rebalance', function () {
    let posId;

    beforeEach(async function () {
      const tx = await circuit.connect(user1).openPosition({ value: ethers.parseEther('50') });
      const r = await tx.wait();
      const ev = r.logs.find(l => { try { return circuit.interface.parseLog(l)?.name === 'PositionOpened'; } catch { return false; } });
      posId = circuit.interface.parseLog(ev).args.positionId;
    });

    it('should rebalance with ZK proof and accrue yield', async function () {
      const nullifier = ethers.keccak256(ethers.toUtf8Bytes('rebal-1'));
      const yieldCaptured = ethers.parseEther('2.5');

      // Send yield to contract so it can be paid out later
      await admin.sendTransaction({ to: await circuit.getAddress(), value: yieldCaptured });

      await circuit.connect(keeper).rebalancePosition(posId, ALLOC_HASH, yieldCaptured, MOCK_PROOF, MOCK_PV, nullifier);

      const pos = await circuit.getPosition(posId);
      expect(pos.pendingYield).to.equal(yieldCaptured);
    });

    it('should reject duplicate nullifier', async function () {
      const nullifier = ethers.keccak256(ethers.toUtf8Bytes('rebal-dup'));
      await circuit.connect(keeper).rebalancePosition(posId, ALLOC_HASH, 0, MOCK_PROOF, MOCK_PV, nullifier);
      await expect(circuit.connect(keeper).rebalancePosition(posId, ALLOC_HASH, 0, MOCK_PROOF, MOCK_PV, nullifier)).to.be.reverted;
    });

    it('should track rebalance count', async function () {
      for (let i = 0; i < 3; i++) {
        const n = ethers.keccak256(ethers.toUtf8Bytes(`rebal-count-${i}`));
        await circuit.connect(keeper).rebalancePosition(posId, ALLOC_HASH, 0, MOCK_PROOF, MOCK_PV, n);
      }
      const [, , , , , rebals] = await circuit.getStats();
      expect(rebals).to.equal(3n);
    });
  });

  // ═══ YIELD HARVEST ═══
  describe('Yield Harvest', function () {
    let posId;

    beforeEach(async function () {
      const tx = await circuit.connect(user1).openPosition({ value: ethers.parseEther('50') });
      const r = await tx.wait();
      const ev = r.logs.find(l => { try { return circuit.interface.parseLog(l)?.name === 'PositionOpened'; } catch { return false; } });
      posId = circuit.interface.parseLog(ev).args.positionId;

      // Rebalance to generate yield
      const yieldAmt = ethers.parseEther('5');
      await admin.sendTransaction({ to: await circuit.getAddress(), value: yieldAmt });
      const nullifier = ethers.keccak256(ethers.toUtf8Bytes('harvest-setup'));
      await circuit.connect(keeper).rebalancePosition(posId, ALLOC_HASH, yieldAmt, MOCK_PROOF, MOCK_PV, nullifier);
    });

    it('should harvest yield with 1% fee', async function () {
      const u1Before = await ethers.provider.getBalance(user1.address);
      await circuit.connect(user1).harvestYield(posId);
      const u1After = await ethers.provider.getBalance(user1.address);
      expect(u1After).to.be.gt(u1Before);

      const pos = await circuit.getPosition(posId);
      expect(pos.pendingYield).to.equal(0n);
      expect(pos.harvestedTotal).to.be.gt(0n);
    });

    it('should reject harvest with no pending yield', async function () {
      await circuit.connect(user1).harvestYield(posId);
      await expect(circuit.connect(user1).harvestYield(posId)).to.be.reverted;
    });
  });

  // ═══ MULTI-POSITION ═══
  describe('Multi-Position', function () {
    it('should handle two users with independent positions', async function () {
      const tx1 = await circuit.connect(user1).openPosition({ value: ethers.parseEther('10') });
      const tx2 = await circuit.connect(user2).openPosition({ value: ethers.parseEther('20') });
      const r1 = await tx1.wait();
      const r2 = await tx2.wait();
      const ev1 = r1.logs.find(l => { try { return circuit.interface.parseLog(l)?.name === 'PositionOpened'; } catch { return false; } });
      const ev2 = r2.logs.find(l => { try { return circuit.interface.parseLog(l)?.name === 'PositionOpened'; } catch { return false; } });
      const pos1 = circuit.interface.parseLog(ev1).args.positionId;
      const pos2 = circuit.interface.parseLog(ev2).args.positionId;

      const p1 = await circuit.getPosition(pos1);
      const p2 = await circuit.getPosition(pos2);
      expect(p1.owner).to.equal(user1.address);
      expect(p2.owner).to.equal(user2.address);
      expect(p2.deposited).to.be.gt(p1.deposited);
    });

    it('should not allow non-owner to close', async function () {
      const tx = await circuit.connect(user1).openPosition({ value: ethers.parseEther('5') });
      const r = await tx.wait();
      const ev = r.logs.find(l => { try { return circuit.interface.parseLog(l)?.name === 'PositionOpened'; } catch { return false; } });
      const posId = circuit.interface.parseLog(ev).args.positionId;
      await expect(circuit.connect(user2).closePosition(posId)).to.be.revertedWith('NotOwner');
    });
  });

  // ═══ EDGE CASES ═══
  describe('Edge Cases', function () {
    it('should prevent operations when paused', async function () {
      await circuit.pause();
      await expect(circuit.connect(user1).openPosition({ value: ethers.parseEther('1') })).to.be.reverted;
    });

    it('should track global stats', async function () {
      const [pools, pos, dep, harv, fees, rebals] = await circuit.getStats();
      expect(pools).to.equal(1n);
      expect(pos).to.equal(0n);
    });
  });
});
