/**
 * Autonomous AI Vaults Circuit — Hardhat Tests (15 tests)
 *
 * Run: npx hardhat test circuits/autonomous-vaults/test/AutonomousVaults.test.cjs
 *
 * Covers:
 *   - Strategy registration (3 tests)
 *   - Vault creation & management (2 tests)
 *   - Deposit / withdraw (4 tests)
 *   - ZK-verified rebalance + performance fees (4 tests)
 *   - Edge cases & stress (2 tests)
 */

const { expect } = require('chai');
const { ethers } = require('hardhat');

describe('AutonomousVaults', function () {
  let circuit, splitter;
  let admin, keeper, strategist, user1, user2;
  let bbb, lp, staker, treasury, stakePool;

  const CIRCUIT_ID = ethers.keccak256(ethers.toUtf8Bytes('AUTONOMOUS_VAULTS_CIRCUIT'));
  const MOCK_PROOF = '0x' + 'ab'.repeat(130);
  const MOCK_PUBLIC_VALUES = '0x' + 'cd'.repeat(64);
  const LOGIC_COMMITMENT = ethers.keccak256(ethers.toUtf8Bytes('yield-farm-strategy-v1'));
  const ALLOC_HASH = ethers.keccak256(ethers.toUtf8Bytes('alloc-60-eth-40-usdc'));

  beforeEach(async function () {
    [admin, keeper, strategist, user1, user2, bbb, lp, staker, treasury, stakePool] =
      await ethers.getSigners();

    const SplitterFactory = await ethers.getContractFactory('CoreRevenueSplitter');
    splitter = await SplitterFactory.deploy(
      admin.address, bbb.address, lp.address,
      staker.address, treasury.address, stakePool.address
    );
    await splitter.waitForDeployment();

    const CircuitFactory = await ethers.getContractFactory('AutonomousVaults');
    circuit = await CircuitFactory.deploy(
      admin.address,
      await splitter.getAddress(),
      ethers.ZeroAddress
    );
    await circuit.waitForDeployment();

    const KEEPER_ROLE = await circuit.KEEPER_ROLE();
    await circuit.grantRole(KEEPER_ROLE, keeper.address);

    const STRATEGIST_ROLE = await circuit.STRATEGIST_ROLE();
    await circuit.grantRole(STRATEGIST_ROLE, strategist.address);

    const CIRCUIT_ROLE = await splitter.CIRCUIT_ROLE();
    await splitter.grantRole(CIRCUIT_ROLE, await circuit.getAddress());
  });

  // ═══════════════════════════════════════════════════════════════════════════
  //  STRATEGY REGISTRATION
  // ═══════════════════════════════════════════════════════════════════════════

  describe('Strategy Registration', function () {
    it('should register a private strategy', async function () {
      const tx = await circuit.connect(strategist).registerStrategy(
        LOGIC_COMMITMENT, 'Yield farm ETH/USDC', 'yield', 1000
      );
      const receipt = await tx.wait();

      expect(await circuit.strategyCount()).to.equal(1n);
      const event = receipt.logs.find(l => {
        try { return circuit.interface.parseLog(l)?.name === 'StrategyRegistered'; }
        catch { return false; }
      });
      expect(event).to.not.be.undefined;
    });

    it('should reject zero commitment', async function () {
      await expect(
        circuit.connect(strategist).registerStrategy(
          ethers.ZeroHash, 'Bad', 'yield', 1000
        )
      ).to.be.revertedWith('ZeroCommitment');
    });

    it('should reject performance fee above 20%', async function () {
      await expect(
        circuit.connect(strategist).registerStrategy(
          LOGIC_COMMITMENT, 'Greedy', 'yield', 2500
        )
      ).to.be.reverted;
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  //  VAULT MANAGEMENT
  // ═══════════════════════════════════════════════════════════════════════════

  describe('Vault Creation', function () {
    let strategyId;

    beforeEach(async function () {
      const tx = await circuit.connect(strategist).registerStrategy(
        LOGIC_COMMITMENT, 'Yield v1', 'yield', 1000
      );
      const receipt = await tx.wait();
      const event = receipt.logs.find(l => {
        try { return circuit.interface.parseLog(l)?.name === 'StrategyRegistered'; }
        catch { return false; }
      });
      strategyId = circuit.interface.parseLog(event).args.strategyId;
    });

    it('should create a vault for a registered strategy', async function () {
      const tx = await circuit.connect(strategist).createVault(strategyId);
      const receipt = await tx.wait();

      expect(await circuit.vaultCount()).to.equal(1n);
      const event = receipt.logs.find(l => {
        try { return circuit.interface.parseLog(l)?.name === 'VaultCreated'; }
        catch { return false; }
      });
      expect(event).to.not.be.undefined;
    });

    it('should pause and resume a vault', async function () {
      const tx = await circuit.connect(strategist).createVault(strategyId);
      const receipt = await tx.wait();
      const event = receipt.logs.find(l => {
        try { return circuit.interface.parseLog(l)?.name === 'VaultCreated'; }
        catch { return false; }
      });
      const vaultId = circuit.interface.parseLog(event).args.vaultId;

      await circuit.connect(strategist).pauseVault(vaultId);
      let vault = await circuit.getVault(vaultId);
      expect(vault.status).to.equal(1); // Paused

      await circuit.connect(strategist).resumeVault(vaultId);
      vault = await circuit.getVault(vaultId);
      expect(vault.status).to.equal(0); // Active
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  //  DEPOSIT / WITHDRAW
  // ═══════════════════════════════════════════════════════════════════════════

  describe('Deposit & Withdraw', function () {
    let strategyId, vaultId;

    beforeEach(async function () {
      const txS = await circuit.connect(strategist).registerStrategy(
        LOGIC_COMMITMENT, 'Yield v1', 'yield', 1000
      );
      const receiptS = await txS.wait();
      const sEvent = receiptS.logs.find(l => {
        try { return circuit.interface.parseLog(l)?.name === 'StrategyRegistered'; }
        catch { return false; }
      });
      strategyId = circuit.interface.parseLog(sEvent).args.strategyId;

      const txV = await circuit.connect(strategist).createVault(strategyId);
      const receiptV = await txV.wait();
      const vEvent = receiptV.logs.find(l => {
        try { return circuit.interface.parseLog(l)?.name === 'VaultCreated'; }
        catch { return false; }
      });
      vaultId = circuit.interface.parseLog(vEvent).args.vaultId;
    });

    it('should deposit and receive shares', async function () {
      await circuit.connect(user1).deposit(vaultId, { value: ethers.parseEther('10.0') });

      const pos = await circuit.getPosition(vaultId, user1.address);
      expect(pos.shares).to.be.gt(0n);

      const vault = await circuit.getVault(vaultId);
      expect(vault.totalShares).to.be.gt(0n);
    });

    it('should deduct 0.5% protocol fee on deposit', async function () {
      const deposit = ethers.parseEther('100.0');
      const expectedFee = ethers.parseEther('0.5');

      const splitterBefore = await ethers.provider.getBalance(await splitter.getAddress());
      await circuit.connect(user1).deposit(vaultId, { value: deposit });
      const splitterAfter = await ethers.provider.getBalance(await splitter.getAddress());

      expect(splitterAfter - splitterBefore).to.equal(expectedFee);
    });

    it('should allow proportional withdrawal', async function () {
      await circuit.connect(user1).deposit(vaultId, { value: ethers.parseEther('10.0') });
      const pos = await circuit.getPosition(vaultId, user1.address);

      const u1Before = await ethers.provider.getBalance(user1.address);
      await circuit.connect(user1).withdraw(vaultId, pos.shares);
      const u1After = await ethers.provider.getBalance(user1.address);

      expect(u1After).to.be.gt(u1Before);
    });

    it('should reject withdrawal exceeding shares', async function () {
      await circuit.connect(user1).deposit(vaultId, { value: ethers.parseEther('1.0') });

      await expect(
        circuit.connect(user1).withdraw(vaultId, ethers.parseEther('999'))
      ).to.be.reverted;
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  //  ZK-VERIFIED REBALANCE
  // ═══════════════════════════════════════════════════════════════════════════

  describe('Rebalance', function () {
    let strategyId, vaultId;

    beforeEach(async function () {
      const txS = await circuit.connect(strategist).registerStrategy(
        LOGIC_COMMITMENT, 'Yield v1', 'yield', 1000
      );
      const receiptS = await txS.wait();
      strategyId = circuit.interface.parseLog(
        receiptS.logs.find(l => {
          try { return circuit.interface.parseLog(l)?.name === 'StrategyRegistered'; }
          catch { return false; }
        })
      ).args.strategyId;

      const txV = await circuit.connect(strategist).createVault(strategyId);
      const receiptV = await txV.wait();
      vaultId = circuit.interface.parseLog(
        receiptV.logs.find(l => {
          try { return circuit.interface.parseLog(l)?.name === 'VaultCreated'; }
          catch { return false; }
        })
      ).args.vaultId;

      // Deposit to establish NAV
      await circuit.connect(user1).deposit(vaultId, { value: ethers.parseEther('100.0') });
    });

    it('should rebalance with ZK proof', async function () {
      const nullifier = ethers.keccak256(ethers.toUtf8Bytes('rebal-null-1'));
      const vaultBefore = await circuit.getVault(vaultId);
      const navBefore = vaultBefore.currentNav;

      // Nav increases by 10%
      const newNav = navBefore + (navBefore / 10n);

      await circuit.connect(keeper).rebalance(
        vaultId, ALLOC_HASH, newNav,
        MOCK_PROOF, MOCK_PUBLIC_VALUES, nullifier
      );

      const vaultAfter = await circuit.getVault(vaultId);
      expect(vaultAfter.rebalanceCount).to.equal(1n);
      expect(vaultAfter.lastRebalanceAt).to.be.gt(0n);
    });

    it('should charge performance fee on profits above high water mark', async function () {
      // First rebalance sets high water mark
      const nullifier1 = ethers.keccak256(ethers.toUtf8Bytes('rebal-null-hwm'));
      const vault = await circuit.getVault(vaultId);
      const nav1 = vault.currentNav + ethers.parseEther('10');

      await circuit.connect(keeper).rebalance(
        vaultId, ALLOC_HASH, nav1, MOCK_PROOF, MOCK_PUBLIC_VALUES, nullifier1
      );

      // Second rebalance with more profit — should charge perf fee
      const nullifier2 = ethers.keccak256(ethers.toUtf8Bytes('rebal-null-perf'));
      const nav2 = nav1 + ethers.parseEther('50');

      const strategistBefore = await ethers.provider.getBalance(strategist.address);
      await circuit.connect(keeper).rebalance(
        vaultId, ALLOC_HASH, nav2, MOCK_PROOF, MOCK_PUBLIC_VALUES, nullifier2
      );
      const strategistAfter = await ethers.provider.getBalance(strategist.address);

      // Strategist should receive 10% of the profit above HWM
      expect(strategistAfter).to.be.gt(strategistBefore);
    });

    it('should reject duplicate nullifier', async function () {
      const nullifier = ethers.keccak256(ethers.toUtf8Bytes('rebal-dup'));
      const vault = await circuit.getVault(vaultId);

      await circuit.connect(keeper).rebalance(
        vaultId, ALLOC_HASH, vault.currentNav, MOCK_PROOF, MOCK_PUBLIC_VALUES, nullifier
      );

      await expect(
        circuit.connect(keeper).rebalance(
          vaultId, ALLOC_HASH, vault.currentNav, MOCK_PROOF, MOCK_PUBLIC_VALUES, nullifier
        )
      ).to.be.reverted;
    });

    it('should reject rebalance on paused vault', async function () {
      await circuit.connect(strategist).pauseVault(vaultId);

      const nullifier = ethers.keccak256(ethers.toUtf8Bytes('rebal-paused'));
      const vault = await circuit.getVault(vaultId);

      await expect(
        circuit.connect(keeper).rebalance(
          vaultId, ALLOC_HASH, vault.currentNav, MOCK_PROOF, MOCK_PUBLIC_VALUES, nullifier
        )
      ).to.be.reverted;
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  //  EDGE CASES
  // ═══════════════════════════════════════════════════════════════════════════

  describe('Edge Cases', function () {
    it('should prevent deposit when circuit is paused', async function () {
      await circuit.pause();
      await expect(
        circuit.connect(user1).deposit(
          ethers.keccak256(ethers.toUtf8Bytes('fake')),
          { value: ethers.parseEther('1') }
        )
      ).to.be.reverted;
    });

    it('should track global stats', async function () {
      const [strats, vaults, dep, wth, pFees, perfFees, rebals] = await circuit.getStats();
      expect(strats).to.equal(0n);
      expect(vaults).to.equal(0n);
    });
  });
});
