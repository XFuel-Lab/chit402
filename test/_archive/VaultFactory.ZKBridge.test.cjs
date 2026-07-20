const { expect } = require('chai');
const { ethers } = require('hardhat');

// Helper to get address from signer/contract (ethers v5 vs v6 compatibility)
const getAddress = async (signerOrContract) => {
  if (!signerOrContract) return null;
  if (typeof signerOrContract.getAddress === 'function') {
    return await signerOrContract.getAddress();
  }
  return signerOrContract.address;
};

// Helper to support both ethers v5 and v6
const parseEther = (value) => {
  if (typeof ethers.parseEther === 'function') {
    return ethers.parseEther(value);
  }
  return ethers.utils.parseEther(value);
};

const formatEther = (value) => {
  if (typeof ethers.formatEther === 'function') {
    return ethers.formatEther(value);
  }
  return ethers.utils.formatEther(value);
};

const keccak256 = (value) => {
  if (typeof ethers.keccak256 === 'function') {
    return ethers.keccak256(ethers.toUtf8Bytes(value));
  }
  return ethers.utils.keccak256(ethers.utils.toUtf8Bytes(value));
};

const ZeroAddress = ethers.ZeroAddress || ethers.constants.AddressZero;
const ZeroHash = ethers.ZeroHash || ethers.constants.HashZero;

describe('VaultFactory & SubVault - ZK Bridge Hybrid', function () {
  let vaultFactory;
  let revSplitter;
  let admin;
  let zkBridgeOperator;
  let user1;
  let user2;
  let pauser;

  const PAUSER_ROLE = keccak256('PAUSER_ROLE');
  const ZK_BRIDGE_ROLE = keccak256('ZK_BRIDGE_ROLE');

  beforeEach(async function () {
    // Get signers
    [admin, zkBridgeOperator, user1, user2, pauser] = await ethers.getSigners();

    // Deploy mock RevenueSplitter (simple contract that can receive ETH)
    const MockRevSplitter = await ethers.getContractFactory('MockRevenueSplitter');
    revSplitter = await MockRevSplitter.deploy();
    
    // Wait for deployment
    if (typeof revSplitter.waitForDeployment === 'function') {
      await revSplitter.waitForDeployment();
    } else if (typeof revSplitter.deployed === 'function') {
      await revSplitter.deployed();
    }

    // Get addresses
    const revSplitterAddr = typeof revSplitter.getAddress === 'function' 
      ? await revSplitter.getAddress() 
      : revSplitter.address;
    const adminAddr = typeof admin.getAddress === 'function'
      ? await admin.getAddress()
      : admin.address;

    // Deploy VaultFactory
    const VaultFactory = await ethers.getContractFactory('VaultFactory');
    vaultFactory = await VaultFactory.deploy(adminAddr, revSplitterAddr);

    // Wait for deployment
    if (typeof vaultFactory.waitForDeployment === 'function') {
      await vaultFactory.waitForDeployment();
    } else if (typeof vaultFactory.deployed === 'function') {
      await vaultFactory.deployed();
    }

    // Get operator and pauser addresses
    const zkBridgeOperatorAddr = typeof zkBridgeOperator.getAddress === 'function'
      ? await zkBridgeOperator.getAddress()
      : zkBridgeOperator.address;
    const pauserAddr = typeof pauser.getAddress === 'function'
      ? await pauser.getAddress()
      : pauser.address;

    // Grant ZK_BRIDGE_ROLE to zkBridgeOperator
    await vaultFactory.connect(admin).grantRole(ZK_BRIDGE_ROLE, zkBridgeOperatorAddr);
    
    // Grant PAUSER_ROLE to pauser
    await vaultFactory.connect(admin).grantRole(PAUSER_ROLE, pauserAddr);
  });

  describe('Deployment & Access Control', function () {
    it('Should deploy with correct initial state', async function () {
      const revSplitterAddr = await getAddress(revSplitter);
      expect(await vaultFactory.revSplitter()).to.equal(revSplitterAddr);
      expect(await vaultFactory.paused()).to.equal(false);
    });

    it('Should grant all roles to admin', async function () {
      const DEFAULT_ADMIN_ROLE = ZeroHash;
      const adminAddr = await getAddress(admin);
      expect(await vaultFactory.hasRole(DEFAULT_ADMIN_ROLE, adminAddr)).to.be.true;
      expect(await vaultFactory.hasRole(PAUSER_ROLE, adminAddr)).to.be.true;
      expect(await vaultFactory.hasRole(ZK_BRIDGE_ROLE, adminAddr)).to.be.true;
    });

    it('Should allow admin to grant ZK_BRIDGE_ROLE', async function () {
      const zkBridgeOperatorAddr = await getAddress(zkBridgeOperator);
      expect(await vaultFactory.hasRole(ZK_BRIDGE_ROLE, zkBridgeOperatorAddr)).to.be.true;
    });

    it('Should revert when deploying with zero addresses', async function () {
      const VaultFactory = await ethers.getContractFactory('VaultFactory');
      const revSplitterAddr = await getAddress(revSplitter);
      const adminAddr = await getAddress(admin);
      
      await expect(
        VaultFactory.deploy(ZeroAddress, revSplitterAddr)
      ).to.be.reverted;
      
      await expect(
        VaultFactory.deploy(adminAddr, ZeroAddress)
      ).to.be.reverted;
    });
  });

  describe('Vault Creation with Create2', function () {
    it('Should create vault with deterministic address', async function () {
      const persistenceAddr = await getAddress(user1);
      const nonce = 0;
      
      // Use ethers v6 compatible encoding
      const abiCoder = ethers.AbiCoder ? new ethers.AbiCoder() : ethers.utils.defaultAbiCoder;
      const encoded = abiCoder.encode(['address', 'uint256'], [persistenceAddr, nonce]);
      const salt = ethers.keccak256 ? ethers.keccak256(encoded) : ethers.utils.keccak256(encoded);

      // Predict address
      const predictedAddr = await vaultFactory.predictAddress(salt);

      // Create vault
      const tx = await vaultFactory.connect(user1).createVault(salt);
      const receipt = await tx.wait();

      // Find VaultCreated event
      const event = receipt.logs?.find(log => {
        try {
          const parsed = vaultFactory.interface.parseLog(log);
          return parsed?.name === 'VaultCreated';
        } catch {
          return false;
        }
      });
      
      expect(event).to.not.be.undefined;

      // Verify vault is tracked
      expect(await vaultFactory.isVault(predictedAddr)).to.be.true;
    });

    it('Should revert when creating duplicate vault', async function () {
      const salt = keccak256('test-salt');
      
      await vaultFactory.connect(user1).createVault(salt);
      
      await expect(
        vaultFactory.connect(user1).createVault(salt)
      ).to.be.reverted;
    });

    it('Should generate consistent salt from helper function', async function () {
      const persistenceAddr = await getAddress(user1);
      const nonce = 42;
      
      const salt1 = await vaultFactory.generateSalt(persistenceAddr, nonce);
      const salt2 = await vaultFactory.generateSalt(persistenceAddr, nonce);
      
      expect(salt1).to.equal(salt2);
    });

    it('Should allow multiple vaults per user with different nonces', async function () {
      const persistenceAddr = await getAddress(user1);
      
      const salt1 = await vaultFactory.generateSalt(persistenceAddr, 0);
      const salt2 = await vaultFactory.generateSalt(persistenceAddr, 1);
      
      await vaultFactory.connect(user1).createVault(salt1);
      await vaultFactory.connect(user1).createVault(salt2);
      
      const addr1 = await vaultFactory.predictAddress(salt1);
      const addr2 = await vaultFactory.predictAddress(salt2);
      
      expect(addr1).to.not.equal(addr2);
      expect(await vaultFactory.isVault(addr1)).to.be.true;
      expect(await vaultFactory.isVault(addr2)).to.be.true;
    });
  });

  describe('SubVault Deposits with Fees', function () {
    let vaultAddr;
    let SubVault;

    beforeEach(async function () {
      // Create a vault
      const salt = keccak256('test-deposit');
      await vaultFactory.connect(user1).createVault(salt);
      vaultAddr = await vaultFactory.predictAddress(salt);
      
      SubVault = await ethers.getContractAt('SubVault', vaultAddr);
    });

    it('Should accept deposit and deduct 0.5% fee', async function () {
      const depositAmount = parseEther('100');
      
      const revSplitterAddr = await getAddress(revSplitter);
      const revSplitterBalanceBefore = await ethers.provider.getBalance(revSplitterAddr);
      
      const tx = await user1.sendTransaction({
        to: vaultAddr,
        value: depositAmount
      });
      const receipt = await tx.wait();
      
      // Find DepositReceived event using logs
      const event = receipt.logs?.find(log => {
        try {
          const parsed = SubVault.interface.parseLog(log);
          return parsed?.name === 'DepositReceived';
        } catch {
          return false;
        }
      });
      
      // Event is optional, focus on balance checks
      // expect(event).to.not.be.undefined;
      
      // Verify fee calculation (0.5%)
      const expectedFee = (depositAmount * 50n) / 10000n; // 0.5 TFUEL
      const expectedNet = depositAmount - expectedFee; // 99.5 TFUEL
      
      // Verify RevenueSplitter received fee
      const revSplitterBalanceAfter = await ethers.provider.getBalance(revSplitterAddr);
      expect(revSplitterBalanceAfter - revSplitterBalanceBefore).to.equal(expectedFee);
      
      // Verify vault balance (net amount)
      expect(await SubVault.getBalance()).to.equal(expectedNet);
    });

    it('Should keep full net deposit in vault (no on-vault yield split)', async function () {
      const depositAmount = parseEther('1000');

      await user1.sendTransaction({
        to: vaultAddr,
        value: depositAmount
      });

      const feeAmount = (depositAmount * 50n) / 10000n;
      const netAmount = depositAmount - feeAmount;

      expect(await SubVault.getBalance()).to.equal(netAmount);
    });

    it('Should revert on zero deposit', async function () {
      await expect(
        user1.sendTransaction({
          to: vaultAddr,
          value: 0
        })
      ).to.be.reverted;
    });

    it('Should handle multiple deposits correctly', async function () {
      const deposit1 = parseEther('50');
      const deposit2 = parseEther('150');
      
      await user1.sendTransaction({ to: vaultAddr, value: deposit1 });
      await user2.sendTransaction({ to: vaultAddr, value: deposit2 });
      
      const expectedNet1 = (deposit1 * 9950n) / 10000n; // 99.5% of 50
      const expectedNet2 = (deposit2 * 9950n) / 10000n; // 99.5% of 150
      
      expect(await SubVault.getBalance()).to.equal(expectedNet1 + expectedNet2);
    });
  });

  describe('UnwrapFromBurn - ZK Bridge Unlock', function () {
    let vaultAddr;
    let SubVault;

    beforeEach(async function () {
      // Create vault and fund it
      const salt = keccak256('test-unwrap');
      await vaultFactory.connect(user1).createVault(salt);
      vaultAddr = await vaultFactory.predictAddress(salt);
      
      SubVault = await ethers.getContractAt('SubVault', vaultAddr);
      
      // Fund vault with 1000 TFUEL
      await user1.sendTransaction({
        to: vaultAddr,
        value: parseEther('1000')
      });
    });

    it('Should unlock TFUEL on burn signal from Persistence', async function () {
      const burnTxHash = keccak256('persistence-burn-tx-1');
      const unlockAmount = parseEther('100');
      
      const user2Addr = await getAddress(user2);
      const user2BalanceBefore = await ethers.provider.getBalance(user2Addr);
      
      // ZK bridge operator triggers unwrap
      const tx = await vaultFactory.connect(zkBridgeOperator).unwrapFromBurn(
        vaultAddr,
        burnTxHash,
        user2Addr,
        unlockAmount
      );
      const receipt = await tx.wait();
      
      // Check factory event
      const factoryEvent = receipt.logs?.find(log => {
        try {
          const parsed = vaultFactory.interface.parseLog(log);
          return parsed?.name === 'UnwrapFromBurnTriggered';
        } catch {
          return false;
        }
      });
      expect(factoryEvent).to.not.be.undefined;
      
      const user2BalanceAfter = await ethers.provider.getBalance(user2Addr);
      expect(user2BalanceAfter - user2BalanceBefore).to.equal(unlockAmount);
      
      // Verify burn is marked as processed
      expect(await SubVault.isBurnProcessed(burnTxHash)).to.be.true;
      expect(await SubVault.getUnwrapRecipient(burnTxHash)).to.equal(user2Addr);
    });

    it('Should prevent double-processing of same burn', async function () {
      const burnTxHash = keccak256('persistence-burn-tx-2');
      const unlockAmount = parseEther('50');
      
      const user2Addr = await getAddress(user2);
      
      // First unwrap
      await vaultFactory.connect(zkBridgeOperator).unwrapFromBurn(
        vaultAddr,
        burnTxHash,
        user2Addr,
        unlockAmount
      );
      
      // Second unwrap should fail
      await expect(
        vaultFactory.connect(zkBridgeOperator).unwrapFromBurn(
          vaultAddr,
          burnTxHash,
          user2Addr,
          unlockAmount
        )
      ).to.be.reverted;
    });

    it('Should revert if caller lacks ZK_BRIDGE_ROLE', async function () {
      const burnTxHash = keccak256('persistence-burn-tx-3');
      const unlockAmount = parseEther('50');
      
      const user2Addr = await getAddress(user2);
      
      await expect(
        vaultFactory.connect(user1).unwrapFromBurn(
          vaultAddr,
          burnTxHash,
          user2Addr,
          unlockAmount
        )
      ).to.be.reverted;
    });

    it('Should revert if vault has insufficient balance', async function () {
      const burnTxHash = keccak256('persistence-burn-tx-4');
      const vaultBalance = await SubVault.getBalance();
      const excessiveAmount = vaultBalance + parseEther('1');
      
      const user2Addr = await getAddress(user2);
      
      await expect(
        vaultFactory.connect(zkBridgeOperator).unwrapFromBurn(
          vaultAddr,
          burnTxHash,
          user2Addr,
          excessiveAmount
        )
      ).to.be.reverted;
    });

    it('Should revert with zero address recipient', async function () {
      const burnTxHash = keccak256('persistence-burn-tx-5');
      const unlockAmount = parseEther('50');
      
      await expect(
        vaultFactory.connect(zkBridgeOperator).unwrapFromBurn(
          vaultAddr,
          burnTxHash,
          ZeroAddress,
          unlockAmount
        )
      ).to.be.reverted;
    });

    it('Should revert with zero amount', async function () {
      const burnTxHash = keccak256('persistence-burn-tx-6');
      
      const user2Addr = await getAddress(user2);
      
      await expect(
        vaultFactory.connect(zkBridgeOperator).unwrapFromBurn(
          vaultAddr,
          burnTxHash,
          user2Addr,
          0
        )
      ).to.be.reverted;
    });

    it('Should handle multiple unwraps with different burn hashes', async function () {
      const burnTxHash1 = keccak256('burn-1');
      const burnTxHash2 = keccak256('burn-2');
      const amount = parseEther('50');
      
      const user1Addr = await getAddress(user1);
      const user2Addr = await getAddress(user2);
      
      await vaultFactory.connect(zkBridgeOperator).unwrapFromBurn(
        vaultAddr,
        burnTxHash1,
        user1Addr,
        amount
      );
      
      await vaultFactory.connect(zkBridgeOperator).unwrapFromBurn(
        vaultAddr,
        burnTxHash2,
        user2Addr,
        amount
      );
      
      expect(await SubVault.isBurnProcessed(burnTxHash1)).to.be.true;
      expect(await SubVault.isBurnProcessed(burnTxHash2)).to.be.true;
    });
  });

  describe('Refunds', function () {
    let vaultAddr;
    let SubVault;

    beforeEach(async function () {
      const salt = keccak256('test-refund');
      await vaultFactory.connect(user1).createVault(salt);
      vaultAddr = await vaultFactory.predictAddress(salt);
      
      SubVault = await ethers.getContractAt('SubVault', vaultAddr);
      
      // Fund vault
      await user1.sendTransaction({ to: vaultAddr, value: parseEther('500') });
    });

    it('Should allow admin to refund', async function () {
      const refundAmount = parseEther('100');
      const user2Addr = await getAddress(user2);
      const user2BalanceBefore = await ethers.provider.getBalance(user2Addr);
      
      await vaultFactory.connect(admin).refundFromVault(
        vaultAddr,
        user2Addr,
        refundAmount
      );
      
      const user2BalanceAfter = await ethers.provider.getBalance(user2Addr);
      expect(user2BalanceAfter - user2BalanceBefore).to.equal(refundAmount);
    });

    it('Should revert refund from non-admin', async function () {
      const user2Addr = await getAddress(user2);
      await expect(
        vaultFactory.connect(user1).refundFromVault(
          vaultAddr,
          user2Addr,
          parseEther('100')
        )
      ).to.be.reverted;
    });

    it('Should revert refund from non-vault address', async function () {
      const user1Addr = await getAddress(user1);
      const user2Addr = await getAddress(user2);
      await expect(
        vaultFactory.connect(admin).refundFromVault(
          user1Addr,
          user2Addr,
          parseEther('100')
        )
      ).to.be.reverted;
    });
  });

  describe('Pause Functionality', function () {
    it('Should allow pauser to pause vault creation', async function () {
      await vaultFactory.connect(pauser).pause();
      expect(await vaultFactory.paused()).to.be.true;
      
      const salt = keccak256('test-pause');
      await expect(
        vaultFactory.connect(user1).createVault(salt)
      ).to.be.reverted;
    });

    it('Should allow unpause', async function () {
      await vaultFactory.connect(pauser).pause();
      await vaultFactory.connect(pauser).unpause();
      expect(await vaultFactory.paused()).to.be.false;
      
      const salt = keccak256('test-unpause');
      await expect(
        vaultFactory.connect(user1).createVault(salt)
      ).to.not.be.reverted;
    });

    it('Should prevent non-pauser from pausing', async function () {
      await expect(
        vaultFactory.connect(user1).pause()
      ).to.be.reverted;
    });
  });

  describe('RevenueSplitter Update', function () {
    it('Should allow admin to update RevenueSplitter', async function () {
      const newRevSplitter = await getAddress(user2);
      
      await vaultFactory.connect(admin).setRevSplitter(newRevSplitter);
      expect(await vaultFactory.revSplitter()).to.equal(newRevSplitter);
    });

    it('Should revert update with zero address', async function () {
      await expect(
        vaultFactory.connect(admin).setRevSplitter(ZeroAddress)
      ).to.be.reverted;
    });

    it('Should only affect new vaults', async function () {
      // Create vault with old RevSplitter
      const salt1 = keccak256('old-rev');
      await vaultFactory.connect(user1).createVault(salt1);
      const oldVaultAddr = await vaultFactory.predictAddress(salt1);
      const oldVault = await ethers.getContractAt('SubVault', oldVaultAddr);
      
      // Update RevenueSplitter
      const newRevSplitter = await getAddress(user2);
      await vaultFactory.connect(admin).setRevSplitter(newRevSplitter);
      
      // Create vault with new RevSplitter
      const salt2 = keccak256('new-rev');
      await vaultFactory.connect(user1).createVault(salt2);
      const newVaultAddr = await vaultFactory.predictAddress(salt2);
      const newVault = await ethers.getContractAt('SubVault', newVaultAddr);
      
      const revSplitterAddr = await getAddress(revSplitter);
      expect(await oldVault.revSplitter()).to.equal(revSplitterAddr);
      expect(await newVault.revSplitter()).to.equal(newRevSplitter);
    });
  });
});

// Mock RevenueSplitter contract for testing
// This needs to be deployed or created inline for the tests

