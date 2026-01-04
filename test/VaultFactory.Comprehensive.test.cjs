const { expect } = require('chai');
const { ethers } = require('hardhat');
const hre = require('hardhat');

/**
 * @title Comprehensive VaultFactory & SubVault Test Suite
 * @notice Tests for ZK Bridge Hybrid: Create2 deploys, 0.5% fees, pause/refunds,
 *         UnwrapFromBurn (admin/ZK-triggered), yield loop integration (30% recycle)
 * @author @XFuelLab
 */
describe('VaultFactory & SubVault - Comprehensive ZK Bridge Tests', function () {
  let factory;
  let revSplitter;
  let admin;
  let zkBridgeOperator;
  let pauser;
  let user1;
  let user2;
  let user3;

  // Role hashes
  let DEFAULT_ADMIN_ROLE;
  let PAUSER_ROLE;
  let ZK_BRIDGE_ROLE;

  // Helper functions for cross-version compatibility
  const getAddress = async (signer) => {
    return typeof signer.getAddress === 'function' ? await signer.getAddress() : signer.address;
  };

  const parseEther = (value) => {
    return typeof ethers.parseEther === 'function' 
      ? ethers.parseEther(value) 
      : ethers.utils.parseEther(value);
  };

  const formatEther = (value) => {
    return typeof ethers.formatEther === 'function'
      ? ethers.formatEther(value)
      : ethers.utils.formatEther(value);
  };

  const ZeroAddress = ethers.ZeroAddress || ethers.constants.AddressZero;

  beforeEach(async function () {
    // Reset network for clean state
    await hre.network.provider.request({
      method: 'hardhat_reset',
      params: []
    });

    // Get signers
    [admin, zkBridgeOperator, pauser, user1, user2, user3] = await ethers.getSigners();

    // Deploy MockRevenueSplitter
    const MockRevSplitter = await ethers.getContractFactory('MockRevenueSplitter');
    revSplitter = await MockRevSplitter.deploy();
    await (revSplitter.waitForDeployment?.() || revSplitter.deployed?.());

    // Deploy VaultFactory
    const VaultFactory = await ethers.getContractFactory('VaultFactory');
    factory = await VaultFactory.deploy(await getAddress(admin), await getAddress(revSplitter));
    await (factory.waitForDeployment?.() || factory.deployed?.());

    // Get role hashes
    DEFAULT_ADMIN_ROLE = await factory.DEFAULT_ADMIN_ROLE();
    PAUSER_ROLE = await factory.PAUSER_ROLE();
    ZK_BRIDGE_ROLE = await factory.ZK_BRIDGE_ROLE();

    // Grant roles
    await factory.connect(admin).grantRole(PAUSER_ROLE, await getAddress(pauser));
    await factory.connect(admin).grantRole(ZK_BRIDGE_ROLE, await getAddress(zkBridgeOperator));
  });

  describe('1. Deployment & Initial State', function () {
    it('Should deploy with correct configuration', async function () {
      expect(await factory.revSplitter()).to.equal(await getAddress(revSplitter));
      expect(await factory.paused()).to.be.false;
    });

    it('Should grant all roles to admin on deployment', async function () {
      expect(await factory.hasRole(DEFAULT_ADMIN_ROLE, await getAddress(admin))).to.be.true;
      expect(await factory.hasRole(PAUSER_ROLE, await getAddress(admin))).to.be.true;
      expect(await factory.hasRole(ZK_BRIDGE_ROLE, await getAddress(admin))).to.be.true;
    });

    it('Should revert deployment with zero address admin', async function () {
      const VaultFactory = await ethers.getContractFactory('VaultFactory');
      await expect(
        VaultFactory.deploy(ZeroAddress, await getAddress(revSplitter))
      ).to.be.reverted;
    });

    it('Should revert deployment with zero address RevSplitter', async function () {
      const VaultFactory = await ethers.getContractFactory('VaultFactory');
      await expect(
        VaultFactory.deploy(await getAddress(admin), ZeroAddress)
      ).to.be.reverted;
    });
  });

  describe('2. Create2 Deterministic Vault Deployment', function () {
    it('Should create vault with deterministic address using Create2', async function () {
      const persistenceAddr = await getAddress(user1);
      const nonce = 0;

      // Generate salt
      const salt = await factory.generateSalt(persistenceAddr, nonce);
      
      // Predict address
      const predictedAddr = await factory.predictAddress(salt);

      // Create vault
      const tx = await factory.connect(user1).createVault(salt);
      const receipt = await tx.wait();

      // Find VaultCreated event
      const event = receipt.logs?.find(log => {
        try {
          const parsed = factory.interface.parseLog(log);
          return parsed?.name === 'VaultCreated';
        } catch {
          return false;
        }
      });

      expect(event).to.not.be.undefined;
      
      const parsedEvent = factory.interface.parseLog(event);
      expect(parsedEvent.args.vaultAddr).to.equal(predictedAddr);
      expect(parsedEvent.args.salt).to.equal(salt);
      expect(parsedEvent.args.creator).to.equal(await getAddress(user1));

      // Verify vault is tracked
      expect(await factory.isVault(predictedAddr)).to.be.true;
    });

    it('Should generate consistent salt from same inputs', async function () {
      const persistenceAddr = await getAddress(user1);
      const nonce = 42;

      const salt1 = await factory.generateSalt(persistenceAddr, nonce);
      const salt2 = await factory.generateSalt(persistenceAddr, nonce);

      expect(salt1).to.equal(salt2);
    });

    it('Should generate different salts for different nonces', async function () {
      const persistenceAddr = await getAddress(user1);

      const salt1 = await factory.generateSalt(persistenceAddr, 0);
      const salt2 = await factory.generateSalt(persistenceAddr, 1);

      expect(salt1).to.not.equal(salt2);
    });

    it('Should generate different salts for different addresses', async function () {
      const nonce = 0;

      const salt1 = await factory.generateSalt(await getAddress(user1), nonce);
      const salt2 = await factory.generateSalt(await getAddress(user2), nonce);

      expect(salt1).to.not.equal(salt2);
    });

    it('Should predict correct address before deployment', async function () {
      const salt = await factory.generateSalt(await getAddress(user1), 0);
      const predictedAddr = await factory.predictAddress(salt);

      await factory.connect(user1).createVault(salt);

      const actualAddr = await factory.predictAddress(salt);
      expect(actualAddr).to.equal(predictedAddr);
    });

    it('Should revert when creating duplicate vault', async function () {
      const salt = await factory.generateSalt(await getAddress(user1), 0);
      
      await factory.connect(user1).createVault(salt);
      
      await expect(
        factory.connect(user1).createVault(salt)
      ).to.be.reverted;
    });

    it('Should allow multiple vaults per user with different nonces', async function () {
      const vaults = [];
      
      for (let i = 0; i < 5; i++) {
        const salt = await factory.generateSalt(await getAddress(user1), i);
        await factory.connect(user1).createVault(salt);
        const vaultAddr = await factory.predictAddress(salt);
        vaults.push(vaultAddr);
      }

      // Verify all addresses are unique
      const uniqueVaults = [...new Set(vaults)];
      expect(uniqueVaults.length).to.equal(5);

      // Verify all are tracked
      for (const vault of vaults) {
        expect(await factory.isVault(vault)).to.be.true;
      }
    });
  });

  describe('3. SubVault Deposits with 0.5% Fee', function () {
    let vaultAddr;
    let SubVault;

    beforeEach(async function () {
      const salt = await factory.generateSalt(await getAddress(user1), 0);
      await factory.connect(user1).createVault(salt);
      vaultAddr = await factory.predictAddress(salt);
      
      const SubVaultFactory = await ethers.getContractFactory('SubVault');
      SubVault = SubVaultFactory.attach(vaultAddr);
    });

    it('Should accept deposit and deduct 0.5% fee', async function () {
      const depositAmount = parseEther('100');
      
      const revSplitterBalanceBefore = await ethers.provider.getBalance(await getAddress(revSplitter));
      
      const tx = await user1.sendTransaction({
        to: vaultAddr,
        value: depositAmount
      });
      await tx.wait();

      // Calculate expected amounts
      const expectedFee = (depositAmount * 50n) / 10000n; // 0.5%
      const expectedNet = depositAmount - expectedFee;

      // Verify RevenueSplitter received fee
      const revSplitterBalanceAfter = await ethers.provider.getBalance(await getAddress(revSplitter));
      expect(revSplitterBalanceAfter - revSplitterBalanceBefore).to.equal(expectedFee);

      // Verify vault balance
      expect(await SubVault.getBalance()).to.equal(expectedNet);
    });

    it('Should emit DepositReceived event with correct amounts', async function () {
      const depositAmount = parseEther('1000');

      const tx = await user1.sendTransaction({
        to: vaultAddr,
        value: depositAmount
      });
      const receipt = await tx.wait();

      const event = receipt.logs?.find(log => {
        try {
          const parsed = SubVault.interface.parseLog(log);
          return parsed?.name === 'DepositReceived';
        } catch {
          return false;
        }
      });

      expect(event).to.not.be.undefined;

      const parsedEvent = SubVault.interface.parseLog(event);
      const feeAmount = (depositAmount * 50n) / 10000n;
      const netAmount = depositAmount - feeAmount;
      const yieldRecycleAmount = (netAmount * 3000n) / 10000n;

      expect(parsedEvent.args.vault).to.equal(vaultAddr);
      expect(parsedEvent.args.sender).to.equal(await getAddress(user1));
      expect(parsedEvent.args.grossAmount).to.equal(depositAmount);
      expect(parsedEvent.args.feeAmount).to.equal(feeAmount);
      expect(parsedEvent.args.netAmount).to.equal(netAmount);
      expect(parsedEvent.args.yieldRecycleAmount).to.equal(yieldRecycleAmount);
    });

    it('Should handle multiple deposits correctly', async function () {
      const deposit1 = parseEther('50');
      const deposit2 = parseEther('150');

      await user1.sendTransaction({ to: vaultAddr, value: deposit1 });
      await user2.sendTransaction({ to: vaultAddr, value: deposit2 });

      const fee1 = (deposit1 * 50n) / 10000n;
      const fee2 = (deposit2 * 50n) / 10000n;
      const expectedVaultBalance = (deposit1 - fee1) + (deposit2 - fee2);

      expect(await SubVault.getBalance()).to.equal(expectedVaultBalance);
    });

    it('Should revert on zero deposit', async function () {
      await expect(
        user1.sendTransaction({ to: vaultAddr, value: 0 })
      ).to.be.revertedWith('SubVault: zero deposit');
    });

    it('Should calculate fee correctly for various amounts', async function () {
      const testAmounts = [
        parseEther('1'),
        parseEther('10.5'),
        parseEther('999.999'),
        parseEther('0.001'),
      ];

      for (let i = 0; i < testAmounts.length; i++) {
        const salt = await factory.generateSalt(await getAddress(user1), i + 1);
        await factory.connect(user1).createVault(salt);
        const testVaultAddr = await factory.predictAddress(salt);

        const depositAmount = testAmounts[i];
        const expectedFee = (depositAmount * 50n) / 10000n;
        const expectedNet = depositAmount - expectedFee;

        await user1.sendTransaction({ to: testVaultAddr, value: depositAmount });

        const SubVaultFactory = await ethers.getContractFactory('SubVault');
        const testVault = SubVaultFactory.attach(testVaultAddr);
        expect(await testVault.getBalance()).to.equal(expectedNet);
      }
    });

    it('Should handle dust amounts where fee rounds to zero', async function () {
      const dustAmount = 50n; // Very small amount
      const expectedFee = (dustAmount * 50n) / 10000n; // Should be 0
      const expectedNet = dustAmount - expectedFee;

      await user1.sendTransaction({ to: vaultAddr, value: dustAmount });

      expect(await SubVault.getBalance()).to.equal(expectedNet);
    });

    it('Should handle large deposits', async function () {
      const largeAmount = parseEther('1000'); // Reduced to avoid balance issues
      const expectedFee = (largeAmount * 50n) / 10000n;
      const expectedNet = largeAmount - expectedFee;

      await user1.sendTransaction({ to: vaultAddr, value: largeAmount });

      expect(await SubVault.getBalance()).to.equal(expectedNet);
    });
  });

  describe('4. Yield Loop Integration (30% Recycle)', function () {
    let vaultAddr;
    let SubVault;

    beforeEach(async function () {
      const salt = await factory.generateSalt(await getAddress(user1), 0);
      await factory.connect(user1).createVault(salt);
      vaultAddr = await factory.predictAddress(salt);
      
      const SubVaultFactory = await ethers.getContractFactory('SubVault');
      SubVault = SubVaultFactory.attach(vaultAddr);
    });

    it('Should track 30% yield recycle amount on deposit', async function () {
      const depositAmount = parseEther('1000');

      const tx = await user1.sendTransaction({
        to: vaultAddr,
        value: depositAmount
      });
      const receipt = await tx.wait();

      const event = receipt.logs?.find(log => {
        try {
          const parsed = SubVault.interface.parseLog(log);
          return parsed?.name === 'DepositReceived';
        } catch {
          return false;
        }
      });

      const parsedEvent = SubVault.interface.parseLog(event);
      const feeAmount = (depositAmount * 50n) / 10000n;
      const netAmount = depositAmount - feeAmount;
      const expectedYieldRecycle = (netAmount * 3000n) / 10000n; // 30%

      expect(parsedEvent.args.yieldRecycleAmount).to.equal(expectedYieldRecycle);

      // Verify full net amount stays in vault (yield recycle stays in vault for now)
      expect(await SubVault.getBalance()).to.equal(netAmount);
    });

    it('Should keep yield recycle funds in vault', async function () {
      const depositAmount = parseEther('1000');
      await user1.sendTransaction({ to: vaultAddr, value: depositAmount });

      const feeAmount = (depositAmount * 50n) / 10000n;
      const netAmount = depositAmount - feeAmount;

      // Full net amount should be in vault (yield recycle portion not yet moved)
      expect(await SubVault.getBalance()).to.equal(netAmount);
    });

    it('Should verify YIELD_RECYCLE_BPS constant is 3000 (30%)', async function () {
      const yieldRecycleBps = await SubVault.YIELD_RECYCLE_BPS();
      expect(yieldRecycleBps).to.equal(3000n);
    });

    it('Should calculate correct yield recycle for multiple deposits', async function () {
      const deposit1 = parseEther('500');
      const deposit2 = parseEther('300');

      await user1.sendTransaction({ to: vaultAddr, value: deposit1 });
      await user2.sendTransaction({ to: vaultAddr, value: deposit2 });

      const fee1 = (deposit1 * 50n) / 10000n;
      const fee2 = (deposit2 * 50n) / 10000n;
      const net1 = deposit1 - fee1;
      const net2 = deposit2 - fee2;
      const totalNet = net1 + net2;

      expect(await SubVault.getBalance()).to.equal(totalNet);
    });
  });

  describe('5. UnwrapFromBurn - ZK Bridge Unlock', function () {
    let vaultAddr;
    let SubVault;

    beforeEach(async function () {
      // Create and fund vault
      const salt = await factory.generateSalt(await getAddress(user1), 0);
      await factory.connect(user1).createVault(salt);
      vaultAddr = await factory.predictAddress(salt);
      
      const SubVaultFactory = await ethers.getContractFactory('SubVault');
      SubVault = SubVaultFactory.attach(vaultAddr);

      // Fund vault with 1000 TFUEL
      await user1.sendTransaction({
        to: vaultAddr,
        value: parseEther('1000')
      });
    });

    it('Should unlock TFUEL on burn signal from Persistence', async function () {
      const burnTxHash = ethers.keccak256
        ? ethers.keccak256(ethers.toUtf8Bytes('persistence-burn-tx-1'))
        : ethers.utils.keccak256(ethers.utils.toUtf8Bytes('persistence-burn-tx-1'));
      const unlockAmount = parseEther('100');

      const user2BalanceBefore = await ethers.provider.getBalance(await getAddress(user2));

      // ZK bridge operator triggers unwrap
      const tx = await factory.connect(zkBridgeOperator).unwrapFromBurn(
        vaultAddr,
        burnTxHash,
        await getAddress(user2),
        unlockAmount
      );
      await tx.wait();

      // Verify user2 received 70% (30% recycled to yield)
      const expectedNetAmount = (unlockAmount * 7000n) / 10000n; // 70 TFUEL
      const user2BalanceAfter = await ethers.provider.getBalance(await getAddress(user2));
      expect(user2BalanceAfter - user2BalanceBefore).to.equal(expectedNetAmount);

      // Verify burn is marked as processed
      expect(await SubVault.isBurnProcessed(burnTxHash)).to.be.true;
      expect(await SubVault.getUnwrapRecipient(burnTxHash)).to.equal(await getAddress(user2));
    });

    it('Should emit UnwrapFromBurnTriggered event from factory', async function () {
      const burnTxHash = ethers.keccak256
        ? ethers.keccak256(ethers.toUtf8Bytes('burn-event-test'))
        : ethers.utils.keccak256(ethers.utils.toUtf8Bytes('burn-event-test'));
      const unlockAmount = parseEther('100');

      const tx = await factory.connect(zkBridgeOperator).unwrapFromBurn(
        vaultAddr,
        burnTxHash,
        await getAddress(user2),
        unlockAmount
      );
      const receipt = await tx.wait();

      const event = receipt.logs?.find(log => {
        try {
          const parsed = factory.interface.parseLog(log);
          return parsed?.name === 'UnwrapFromBurnTriggered';
        } catch {
          return false;
        }
      });

      expect(event).to.not.be.undefined;

      const parsedEvent = factory.interface.parseLog(event);
      expect(parsedEvent.args.vault).to.equal(vaultAddr);
      expect(parsedEvent.args.burnTxHash).to.equal(burnTxHash);
      expect(parsedEvent.args.recipient).to.equal(await getAddress(user2));
      expect(parsedEvent.args.amount).to.equal(unlockAmount);
    });

    it('Should emit UnwrapFromBurn event from SubVault', async function () {
      const burnTxHash = ethers.keccak256
        ? ethers.keccak256(ethers.toUtf8Bytes('burn-vault-event'))
        : ethers.utils.keccak256(ethers.utils.toUtf8Bytes('burn-vault-event'));
      const unlockAmount = parseEther('100');

      const tx = await factory.connect(zkBridgeOperator).unwrapFromBurn(
        vaultAddr,
        burnTxHash,
        await getAddress(user2),
        unlockAmount
      );
      const receipt = await tx.wait();

      const event = receipt.logs?.find(log => {
        try {
          const parsed = SubVault.interface.parseLog(log);
          return parsed?.name === 'UnwrapFromBurn';
        } catch {
          return false;
        }
      });

      expect(event).to.not.be.undefined;

      const parsedEvent = SubVault.interface.parseLog(event);
      const expectedNet = (unlockAmount * 7000n) / 10000n;
      const expectedYieldRecycle = unlockAmount - expectedNet;

      expect(parsedEvent.args.burnTxHash).to.equal(burnTxHash);
      expect(parsedEvent.args.recipient).to.equal(await getAddress(user2));
      expect(parsedEvent.args.amount).to.equal(unlockAmount);
      expect(parsedEvent.args.netAmount).to.equal(expectedNet);
      expect(parsedEvent.args.yieldRecycleAmount).to.equal(expectedYieldRecycle);
    });

    it('Should prevent double-processing of same burn', async function () {
      const burnTxHash = ethers.keccak256
        ? ethers.keccak256(ethers.toUtf8Bytes('double-burn'))
        : ethers.utils.keccak256(ethers.utils.toUtf8Bytes('double-burn'));
      const unlockAmount = parseEther('50');

      // First unwrap
      await factory.connect(zkBridgeOperator).unwrapFromBurn(
        vaultAddr,
        burnTxHash,
        await getAddress(user2),
        unlockAmount
      );

      // Second unwrap should fail
      await expect(
        factory.connect(zkBridgeOperator).unwrapFromBurn(
          vaultAddr,
          burnTxHash,
          await getAddress(user2),
          unlockAmount
        )
      ).to.be.reverted;
    });

    it('Should revert if caller lacks ZK_BRIDGE_ROLE', async function () {
      const burnTxHash = ethers.keccak256
        ? ethers.keccak256(ethers.toUtf8Bytes('unauthorized-burn'))
        : ethers.utils.keccak256(ethers.utils.toUtf8Bytes('unauthorized-burn'));
      const unlockAmount = parseEther('50');

      await expect(
        factory.connect(user1).unwrapFromBurn(
          vaultAddr,
          burnTxHash,
          await getAddress(user2),
          unlockAmount
        )
      ).to.be.reverted;
    });

    it('Should revert if vault has insufficient balance', async function () {
      const burnTxHash = ethers.keccak256
        ? ethers.keccak256(ethers.toUtf8Bytes('insufficient-balance'))
        : ethers.utils.keccak256(ethers.utils.toUtf8Bytes('insufficient-balance'));
      const vaultBalance = await SubVault.getBalance();
      const excessiveAmount = vaultBalance + parseEther('1');

      await expect(
        factory.connect(zkBridgeOperator).unwrapFromBurn(
          vaultAddr,
          burnTxHash,
          await getAddress(user2),
          excessiveAmount
        )
      ).to.be.reverted;
    });

    it('Should revert with zero address recipient', async function () {
      const burnTxHash = ethers.keccak256
        ? ethers.keccak256(ethers.toUtf8Bytes('zero-address-burn'))
        : ethers.utils.keccak256(ethers.utils.toUtf8Bytes('zero-address-burn'));
      const unlockAmount = parseEther('50');

      await expect(
        factory.connect(zkBridgeOperator).unwrapFromBurn(
          vaultAddr,
          burnTxHash,
          ZeroAddress,
          unlockAmount
        )
      ).to.be.reverted;
    });

    it('Should revert with zero amount', async function () {
      const burnTxHash = ethers.keccak256
        ? ethers.keccak256(ethers.toUtf8Bytes('zero-amount-burn'))
        : ethers.utils.keccak256(ethers.utils.toUtf8Bytes('zero-amount-burn'));

      await expect(
        factory.connect(zkBridgeOperator).unwrapFromBurn(
          vaultAddr,
          burnTxHash,
          await getAddress(user2),
          0
        )
      ).to.be.reverted;
    });

    it('Should handle multiple unwraps with different burn hashes', async function () {
      const burnTxHash1 = ethers.keccak256
        ? ethers.keccak256(ethers.toUtf8Bytes('multi-burn-1'))
        : ethers.utils.keccak256(ethers.utils.toUtf8Bytes('multi-burn-1'));
      const burnTxHash2 = ethers.keccak256
        ? ethers.keccak256(ethers.toUtf8Bytes('multi-burn-2'))
        : ethers.utils.keccak256(ethers.utils.toUtf8Bytes('multi-burn-2'));
      const amount = parseEther('50');

      await factory.connect(zkBridgeOperator).unwrapFromBurn(
        vaultAddr,
        burnTxHash1,
        await getAddress(user1),
        amount
      );

      await factory.connect(zkBridgeOperator).unwrapFromBurn(
        vaultAddr,
        burnTxHash2,
        await getAddress(user2),
        amount
      );

      expect(await SubVault.isBurnProcessed(burnTxHash1)).to.be.true;
      expect(await SubVault.isBurnProcessed(burnTxHash2)).to.be.true;
      expect(await SubVault.getUnwrapRecipient(burnTxHash1)).to.equal(await getAddress(user1));
      expect(await SubVault.getUnwrapRecipient(burnTxHash2)).to.equal(await getAddress(user2));
    });

    it('Should correctly calculate 30% yield recycle on unwrap', async function () {
      const burnTxHash = ethers.keccak256
        ? ethers.keccak256(ethers.toUtf8Bytes('yield-recycle-test'))
        : ethers.utils.keccak256(ethers.utils.toUtf8Bytes('yield-recycle-test'));
      
      // Get actual vault balance (after deposit fees)
      const vaultBalanceBefore = await SubVault.getBalance();
      
      // Use a smaller unlock amount that we know is available
      const unlockAmount = parseEther('500');

      await factory.connect(zkBridgeOperator).unwrapFromBurn(
        vaultAddr,
        burnTxHash,
        await getAddress(user2),
        unlockAmount
      );

      const expectedYieldRecycle = (unlockAmount * 3000n) / 10000n; // 150 TFUEL
      const expectedSent = (unlockAmount * 7000n) / 10000n; // 350 TFUEL

      const vaultBalanceAfter = await SubVault.getBalance();
      
      // Vault should have lost 350 TFUEL (sent to user), 150 TFUEL stays for yield
      expect(vaultBalanceBefore - vaultBalanceAfter).to.equal(expectedSent);
    });

    it('Should revert unwrap from non-vault address', async function () {
      const burnTxHash = ethers.keccak256
        ? ethers.keccak256(ethers.toUtf8Bytes('non-vault-burn'))
        : ethers.utils.keccak256(ethers.utils.toUtf8Bytes('non-vault-burn'));

      await expect(
        factory.connect(zkBridgeOperator).unwrapFromBurn(
          await getAddress(user3),
          burnTxHash,
          await getAddress(user2),
          parseEther('100')
        )
      ).to.be.reverted;
    });
  });

  describe('6. Refund Functionality', function () {
    let vaultAddr;
    let SubVault;

    beforeEach(async function () {
      const salt = await factory.generateSalt(await getAddress(user1), 0);
      await factory.connect(user1).createVault(salt);
      vaultAddr = await factory.predictAddress(salt);
      
      const SubVaultFactory = await ethers.getContractFactory('SubVault');
      SubVault = SubVaultFactory.attach(vaultAddr);

      // Fund vault
      await user1.sendTransaction({ to: vaultAddr, value: parseEther('500') });
    });

    it('Should allow admin to refund from vault', async function () {
      const refundAmount = parseEther('100');
      const user2BalanceBefore = await ethers.provider.getBalance(await getAddress(user2));

      await factory.connect(admin).refundFromVault(
        vaultAddr,
        await getAddress(user2),
        refundAmount
      );

      const user2BalanceAfter = await ethers.provider.getBalance(await getAddress(user2));
      expect(user2BalanceAfter - user2BalanceBefore).to.equal(refundAmount);
    });

    it('Should emit RefundInitiated event', async function () {
      const refundAmount = parseEther('100');

      const tx = await factory.connect(admin).refundFromVault(
        vaultAddr,
        await getAddress(user2),
        refundAmount
      );
      const receipt = await tx.wait();

      const event = receipt.logs?.find(log => {
        try {
          const parsed = factory.interface.parseLog(log);
          return parsed?.name === 'RefundInitiated';
        } catch {
          return false;
        }
      });

      expect(event).to.not.be.undefined;
    });

    it('Should revert refund from non-admin', async function () {
      await expect(
        factory.connect(user1).refundFromVault(
          vaultAddr,
          await getAddress(user2),
          parseEther('100')
        )
      ).to.be.reverted;
    });

    it('Should revert refund from non-vault address', async function () {
      await expect(
        factory.connect(admin).refundFromVault(
          await getAddress(user1),
          await getAddress(user2),
          parseEther('100')
        )
      ).to.be.reverted;
    });

    it('Should revert refund with insufficient vault balance', async function () {
      const vaultBalance = await SubVault.getBalance();
      const excessiveAmount = vaultBalance + parseEther('1');

      await expect(
        factory.connect(admin).refundFromVault(
          vaultAddr,
          await getAddress(user2),
          excessiveAmount
        )
      ).to.be.reverted;
    });

    it('Should revert refund with zero address recipient', async function () {
      await expect(
        factory.connect(admin).refundFromVault(
          vaultAddr,
          ZeroAddress,
          parseEther('100')
        )
      ).to.be.reverted;
    });

    it('Should revert refund with zero amount', async function () {
      await expect(
        factory.connect(admin).refundFromVault(
          vaultAddr,
          await getAddress(user2),
          0
        )
      ).to.be.reverted;
    });
  });

  describe('7. Pause/Unpause Functionality', function () {
    it('Should allow pauser to pause vault creation', async function () {
      await factory.connect(pauser).pause();
      expect(await factory.paused()).to.be.true;

      const salt = await factory.generateSalt(await getAddress(user1), 0);
      await expect(
        factory.connect(user1).createVault(salt)
      ).to.be.reverted;
    });

    it('Should allow pauser to unpause', async function () {
      await factory.connect(pauser).pause();
      await factory.connect(pauser).unpause();
      expect(await factory.paused()).to.be.false;

      const salt = await factory.generateSalt(await getAddress(user1), 0);
      await expect(
        factory.connect(user1).createVault(salt)
      ).to.not.be.reverted;
    });

    it('Should revert pause from non-pauser', async function () {
      await expect(
        factory.connect(user1).pause()
      ).to.be.reverted;
    });

    it('Should revert unpause from non-pauser', async function () {
      await factory.connect(pauser).pause();
      
      await expect(
        factory.connect(user1).unpause()
      ).to.be.reverted;
    });

    it('Should not affect existing vaults when paused', async function () {
      // Create vault before pause
      const salt = await factory.generateSalt(await getAddress(user1), 0);
      await factory.connect(user1).createVault(salt);
      const vaultAddr = await factory.predictAddress(salt);

      // Pause factory
      await factory.connect(pauser).pause();

      // Deposits to existing vault should still work
      await expect(
        user1.sendTransaction({ to: vaultAddr, value: parseEther('100') })
      ).to.not.be.reverted;
    });
  });

  describe('8. Access Control', function () {
    it('Should allow admin to grant roles', async function () {
      await factory.connect(admin).grantRole(ZK_BRIDGE_ROLE, await getAddress(user1));
      expect(await factory.hasRole(ZK_BRIDGE_ROLE, await getAddress(user1))).to.be.true;
    });

    it('Should allow admin to revoke roles', async function () {
      await factory.connect(admin).grantRole(ZK_BRIDGE_ROLE, await getAddress(user1));
      await factory.connect(admin).revokeRole(ZK_BRIDGE_ROLE, await getAddress(user1));
      expect(await factory.hasRole(ZK_BRIDGE_ROLE, await getAddress(user1))).to.be.false;
    });

    it('Should revert role grant from non-admin', async function () {
      await expect(
        factory.connect(user1).grantRole(ZK_BRIDGE_ROLE, await getAddress(user2))
      ).to.be.reverted;
    });

    it('Should allow admin to update RevSplitter', async function () {
      const newRevSplitter = await getAddress(user2);
      await factory.connect(admin).setRevSplitter(newRevSplitter);
      expect(await factory.revSplitter()).to.equal(newRevSplitter);
    });

    it('Should revert RevSplitter update from non-admin', async function () {
      await expect(
        factory.connect(user1).setRevSplitter(await getAddress(user2))
      ).to.be.reverted;
    });

    it('Should revert RevSplitter update with zero address', async function () {
      await expect(
        factory.connect(admin).setRevSplitter(ZeroAddress)
      ).to.be.reverted;
    });
  });

  describe('9. Integration & Complex Scenarios', function () {
    it('Should handle complete workflow: create → deposit → unwrap', async function () {
      // 1. Create vault
      const salt = await factory.generateSalt(await getAddress(user1), 0);
      await factory.connect(user1).createVault(salt);
      const vaultAddr = await factory.predictAddress(salt);

      // 2. Deposit
      const depositAmount = parseEther('1000');
      await user1.sendTransaction({ to: vaultAddr, value: depositAmount });

      // 3. Unwrap
      const burnTxHash = ethers.keccak256
        ? ethers.keccak256(ethers.toUtf8Bytes('workflow-burn'))
        : ethers.utils.keccak256(ethers.utils.toUtf8Bytes('workflow-burn'));
      const unlockAmount = parseEther('500');

      const user2BalanceBefore = await ethers.provider.getBalance(await getAddress(user2));

      await factory.connect(zkBridgeOperator).unwrapFromBurn(
        vaultAddr,
        burnTxHash,
        await getAddress(user2),
        unlockAmount
      );

      const expectedNet = (unlockAmount * 7000n) / 10000n;
      const user2BalanceAfter = await ethers.provider.getBalance(await getAddress(user2));
      expect(user2BalanceAfter - user2BalanceBefore).to.equal(expectedNet);
    });

    it('Should handle multiple deposits and multiple unwraps', async function () {
      const salt = await factory.generateSalt(await getAddress(user1), 0);
      await factory.connect(user1).createVault(salt);
      const vaultAddr = await factory.predictAddress(salt);

      // Multiple deposits
      await user1.sendTransaction({ to: vaultAddr, value: parseEther('500') });
      await user2.sendTransaction({ to: vaultAddr, value: parseEther('300') });
      await user3.sendTransaction({ to: vaultAddr, value: parseEther('200') });

      // Multiple unwraps
      const burns = ['burn1', 'burn2', 'burn3'];
      for (let i = 0; i < burns.length; i++) {
        const burnTxHash = ethers.keccak256
          ? ethers.keccak256(ethers.toUtf8Bytes(burns[i]))
          : ethers.utils.keccak256(ethers.utils.toUtf8Bytes(burns[i]));
        
        await factory.connect(zkBridgeOperator).unwrapFromBurn(
          vaultAddr,
          burnTxHash,
          await getAddress(user2),
          parseEther('50')
        );

        const SubVaultFactory = await ethers.getContractFactory('SubVault');
        const SubVault = SubVaultFactory.attach(vaultAddr);
        expect(await SubVault.isBurnProcessed(burnTxHash)).to.be.true;
      }
    });

    it('Should handle RevSplitter change affecting only new vaults', async function () {
      // Create vault with original RevSplitter
      const salt1 = await factory.generateSalt(await getAddress(user1), 0);
      await factory.connect(user1).createVault(salt1);
      const vault1Addr = await factory.predictAddress(salt1);

      const SubVaultFactory = await ethers.getContractFactory('SubVault');
      const vault1 = SubVaultFactory.attach(vault1Addr);
      const originalRevSplitter = await vault1.revSplitter();

      // Update RevSplitter
      const MockRevSplitter = await ethers.getContractFactory('MockRevenueSplitter');
      const newRevSplitter = await MockRevSplitter.deploy();
      await (newRevSplitter.waitForDeployment?.() || newRevSplitter.deployed?.());
      
      await factory.connect(admin).setRevSplitter(await getAddress(newRevSplitter));

      // Create new vault
      const salt2 = await factory.generateSalt(await getAddress(user1), 1);
      await factory.connect(user1).createVault(salt2);
      const vault2Addr = await factory.predictAddress(salt2);
      const vault2 = SubVaultFactory.attach(vault2Addr);

      // Verify old vault uses original RevSplitter
      expect(await vault1.revSplitter()).to.equal(originalRevSplitter);
      
      // Verify new vault uses new RevSplitter
      expect(await vault2.revSplitter()).to.equal(await getAddress(newRevSplitter));
    });

    it('Should handle concurrent operations from multiple users', async function () {
      // Create multiple vaults concurrently
      const promises = [];
      for (let i = 0; i < 3; i++) {
        const salt = await factory.generateSalt(await getAddress(user1), i);
        promises.push(factory.connect(user1).createVault(salt));
      }
      await Promise.all(promises);

      // Verify all vaults were created
      for (let i = 0; i < 3; i++) {
        const salt = await factory.generateSalt(await getAddress(user1), i);
        const vaultAddr = await factory.predictAddress(salt);
        expect(await factory.isVault(vaultAddr)).to.be.true;
      }
    });
  });

  describe('10. SubVault Direct Access Control', function () {
    let vaultAddr;
    let SubVault;

    beforeEach(async function () {
      const salt = await factory.generateSalt(await getAddress(user1), 0);
      await factory.connect(user1).createVault(salt);
      vaultAddr = await factory.predictAddress(salt);
      
      const SubVaultFactory = await ethers.getContractFactory('SubVault');
      SubVault = SubVaultFactory.attach(vaultAddr);

      await user1.sendTransaction({ to: vaultAddr, value: parseEther('500') });
    });

    it('Should revert direct refund call from non-factory', async function () {
      await expect(
        SubVault.connect(user1).refund(await getAddress(user2), parseEther('100'))
      ).to.be.reverted;
    });

    it('Should revert direct unwrapFromBurn call from non-factory', async function () {
      const burnTxHash = ethers.keccak256
        ? ethers.keccak256(ethers.toUtf8Bytes('direct-call-burn'))
        : ethers.utils.keccak256(ethers.utils.toUtf8Bytes('direct-call-burn'));

      await expect(
        SubVault.connect(user1).unwrapFromBurn(
          burnTxHash,
          await getAddress(user2),
          parseEther('100')
        )
      ).to.be.reverted;
    });

    it('Should verify factory address is immutable', async function () {
      expect(await SubVault.factory()).to.equal(await getAddress(factory));
    });

    it('Should verify revSplitter address is immutable', async function () {
      expect(await SubVault.revSplitter()).to.equal(await getAddress(revSplitter));
    });
  });

  describe('11. View Functions', function () {
    it('Should return correct isVaultDeployed status', async function () {
      const salt = await factory.generateSalt(await getAddress(user1), 0);
      const predictedAddr = await factory.predictAddress(salt);

      expect(await factory.isVaultDeployed(predictedAddr)).to.be.false;

      await factory.connect(user1).createVault(salt);

      expect(await factory.isVaultDeployed(predictedAddr)).to.be.true;
    });

    it('Should return correct getRevSplitter', async function () {
      expect(await factory.getRevSplitter()).to.equal(await getAddress(revSplitter));
    });

    it('Should return correct vault balance', async function () {
      const salt = await factory.generateSalt(await getAddress(user1), 0);
      await factory.connect(user1).createVault(salt);
      const vaultAddr = await factory.predictAddress(salt);

      const SubVaultFactory = await ethers.getContractFactory('SubVault');
      const SubVault = SubVaultFactory.attach(vaultAddr);

      expect(await SubVault.getBalance()).to.equal(0);

      const depositAmount = parseEther('100');
      await user1.sendTransaction({ to: vaultAddr, value: depositAmount });

      const expectedNet = depositAmount - (depositAmount * 50n) / 10000n;
      expect(await SubVault.getBalance()).to.equal(expectedNet);
    });

    it('Should return correct burn processed status', async function () {
      const salt = await factory.generateSalt(await getAddress(user1), 0);
      await factory.connect(user1).createVault(salt);
      const vaultAddr = await factory.predictAddress(salt);

      const SubVaultFactory = await ethers.getContractFactory('SubVault');
      const SubVault = SubVaultFactory.attach(vaultAddr);

      await user1.sendTransaction({ to: vaultAddr, value: parseEther('500') });

      const burnTxHash = ethers.keccak256
        ? ethers.keccak256(ethers.toUtf8Bytes('view-burn'))
        : ethers.utils.keccak256(ethers.utils.toUtf8Bytes('view-burn'));

      expect(await SubVault.isBurnProcessed(burnTxHash)).to.be.false;

      await factory.connect(zkBridgeOperator).unwrapFromBurn(
        vaultAddr,
        burnTxHash,
        await getAddress(user2),
        parseEther('100')
      );

      expect(await SubVault.isBurnProcessed(burnTxHash)).to.be.true;
    });

    it('Should return correct unwrap recipient', async function () {
      const salt = await factory.generateSalt(await getAddress(user1), 0);
      await factory.connect(user1).createVault(salt);
      const vaultAddr = await factory.predictAddress(salt);

      const SubVaultFactory = await ethers.getContractFactory('SubVault');
      const SubVault = SubVaultFactory.attach(vaultAddr);

      await user1.sendTransaction({ to: vaultAddr, value: parseEther('500') });

      const burnTxHash = ethers.keccak256
        ? ethers.keccak256(ethers.toUtf8Bytes('recipient-burn'))
        : ethers.utils.keccak256(ethers.utils.toUtf8Bytes('recipient-burn'));

      expect(await SubVault.getUnwrapRecipient(burnTxHash)).to.equal(ZeroAddress);

      await factory.connect(zkBridgeOperator).unwrapFromBurn(
        vaultAddr,
        burnTxHash,
        await getAddress(user2),
        parseEther('100')
      );

      expect(await SubVault.getUnwrapRecipient(burnTxHash)).to.equal(await getAddress(user2));
    });
  });
});

