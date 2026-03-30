const { expect } = require('chai');
const { ethers } = require('hardhat');

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

describe('ZK Bridge Integration - Full Flow', function () {
  let vaultFactory;
  let revSplitter;
  let admin;
  let zkBridgeOperator;
  let alice;
  let bob;

  const ZK_BRIDGE_ROLE = keccak256('ZK_BRIDGE_ROLE');

  beforeEach(async function () {
    [admin, zkBridgeOperator, alice, bob] = await ethers.getSigners();

    // Deploy RevenueSplitter mock
    const MockRevSplitter = await ethers.getContractFactory('MockRevenueSplitter');
    revSplitter = await MockRevSplitter.deploy();

    if (typeof revSplitter.waitForDeployment === 'function') {
      await revSplitter.waitForDeployment();
    } else if (typeof revSplitter.deployed === 'function') {
      await revSplitter.deployed();
    }

    const rsAddr = typeof revSplitter.getAddress === 'function'
      ? await revSplitter.getAddress()
      : revSplitter.address;

    // Deploy VaultFactory
    const VaultFactory = await ethers.getContractFactory('VaultFactory');
    vaultFactory = await VaultFactory.deploy(admin.address, rsAddr);

    if (typeof vaultFactory.waitForDeployment === 'function') {
      await vaultFactory.waitForDeployment();
    } else if (typeof vaultFactory.deployed === 'function') {
      await vaultFactory.deployed();
    }

    // Grant ZK bridge role
    await vaultFactory.connect(admin).grantRole(ZK_BRIDGE_ROLE, zkBridgeOperator.address);
  });

  describe('Complete Wrap -> Unwrap Cycle', function () {
    it('Should execute full cycle: deposit TFUEL -> mint ibcTFUEL -> burn ibcTFUEL -> unwrap TFUEL', async function () {
      // Step 1: Alice creates her deterministic vault
      const alicePersistenceAddr = '0x' + '42'.repeat(20); // Mock Persistence address
      const nonce = 0;
      const salt = await vaultFactory.generateSalt(alicePersistenceAddr, nonce);
      
      await vaultFactory.connect(alice).createVault(salt);
      const vaultAddr = await vaultFactory.predictAddress(salt);
      
      console.log('  ✓ Alice vault created at:', vaultAddr);
      
      // Step 2: Alice deposits 1000 TFUEL to vault
      const depositAmount = parseEther('1000');
      await alice.sendTransaction({ to: vaultAddr, value: depositAmount });
      
      const vault = await ethers.getContractAt('SubVault', vaultAddr);
      const vaultBalance = await vault.getBalance();
      
      // Verify fee deduction (0.5%)
      const expectedFee = (depositAmount * 50n) / 10000n;
      const expectedNet = depositAmount - expectedFee;
      expect(vaultBalance).to.equal(expectedNet);
      
      console.log('  ✓ Alice deposited 1000 TFUEL');
      console.log('    - Fee sent to RevSplitter:', formatEther(expectedFee), 'TFUEL');
      console.log('    - Net in vault:', formatEther(expectedNet), 'TFUEL');
      
      // Verify RevenueSplitter received fee
      const revSplitterBalance = await revSplitter.getBalance();
      expect(revSplitterBalance).to.equal(expectedFee);
      
      // Step 3: Bridge mints ibcTFUEL on Persistence (simulated off-chain)
      // In production, bridge relayer would:
      // - Detect DepositReceived event
      // - Mint equivalent ibcTFUEL to Alice's Persistence address
      console.log('  ✓ Bridge would mint ~995 ibcTFUEL on Persistence for Alice');
      
      // Step 4: Alice uses ibcTFUEL on Persistence chain (simulated)
      // She later decides to unwrap back to Theta
      console.log('  ✓ Alice uses ibcTFUEL on Persistence ecosystem');
      
      // Step 5: Alice burns 500 ibcTFUEL on Persistence to unwrap
      const burnAmount = parseEther('500');
      const burnTxHash = keccak256('persistence-burn-alice-500');
      
      console.log('  ✓ Alice burns 500 ibcTFUEL on Persistence');
      console.log('    - Burn tx hash:', burnTxHash);
      
      // Step 6: ZK bridge operator verifies burn and triggers unwrap
      const bobBalanceBefore = await ethers.provider.getBalance(bob.address);
      
      await vaultFactory.connect(zkBridgeOperator).unwrapFromBurn(
        vaultAddr,
        burnTxHash,
        bob.address, // Alice wants to send to Bob
        burnAmount
      );
      
      const bobBalanceAfter = await ethers.provider.getBalance(bob.address);
      expect(bobBalanceAfter - bobBalanceBefore).to.equal(burnAmount);

      console.log('  ✓ ZK bridge unlocked TFUEL');
      console.log('    - Sent to Bob:', formatEther(burnAmount), 'TFUEL (100%)');
      
      // Verify burn is marked as processed
      expect(await vault.isBurnProcessed(burnTxHash)).to.be.true;
      
      // Step 7: Verify final vault balance
      const finalVaultBalance = await vault.getBalance();
      const expectedFinalBalance = expectedNet - burnAmount;
      expect(finalVaultBalance).to.equal(expectedFinalBalance);
      
      console.log('  ✓ Final vault balance:', formatEther(finalVaultBalance), 'TFUEL');
      console.log('  ✓ Complete cycle successful!');
    });

    it('Should handle multiple users with separate vaults', async function () {
      // Alice and Bob each get their own deterministic vaults
      const aliceSalt = await vaultFactory.generateSalt(alice.address, 0);
      const bobSalt = await vaultFactory.generateSalt(bob.address, 0);
      
      await vaultFactory.connect(alice).createVault(aliceSalt);
      await vaultFactory.connect(bob).createVault(bobSalt);
      
      const aliceVaultAddr = await vaultFactory.predictAddress(aliceSalt);
      const bobVaultAddr = await vaultFactory.predictAddress(bobSalt);
      
      expect(aliceVaultAddr).to.not.equal(bobVaultAddr);
      
      // Both deposit
      await alice.sendTransaction({ to: aliceVaultAddr, value: parseEther('500') });
      await bob.sendTransaction({ to: bobVaultAddr, value: parseEther('750') });
      
      const aliceVault = await ethers.getContractAt('SubVault', aliceVaultAddr);
      const bobVault = await ethers.getContractAt('SubVault', bobVaultAddr);
      
      // Verify independent balances
      expect(await aliceVault.getBalance()).to.be.gt(parseEther('497'));
      expect(await bobVault.getBalance()).to.be.gt(parseEther('746'));
      
      // Alice unwraps from her vault
      const aliceBurnTx = keccak256('alice-burn-1');
      await vaultFactory.connect(zkBridgeOperator).unwrapFromBurn(
        aliceVaultAddr,
        aliceBurnTx,
        alice.address,
        parseEther('100')
      );
      
      // Bob unwraps from his vault
      const bobBurnTx = keccak256('bob-burn-1');
      await vaultFactory.connect(zkBridgeOperator).unwrapFromBurn(
        bobVaultAddr,
        bobBurnTx,
        bob.address,
        parseEther('200')
      );
      
      // Verify both vaults processed their respective burns
      expect(await aliceVault.isBurnProcessed(aliceBurnTx)).to.be.true;
      expect(await bobVault.isBurnProcessed(bobBurnTx)).to.be.true;
      
      console.log('  ✓ Multiple users successfully used independent vaults');
    });

    it('Should send full unwrap to recipient after deposit fee', async function () {
      const salt = await vaultFactory.generateSalt(alice.address, 0);
      await vaultFactory.connect(alice).createVault(salt);
      const vaultAddr = await vaultFactory.predictAddress(salt);

      const depositAmount = parseEther('1000');
      await alice.sendTransaction({ to: vaultAddr, value: depositAmount });

      const fee = (depositAmount * 50n) / 10000n;
      const netDeposit = depositAmount - fee;

      console.log('  Deposit Phase:');
      console.log('    - Gross:', formatEther(depositAmount), 'TFUEL');
      console.log('    - Fee (0.5%):', formatEther(fee), 'TFUEL');
      console.log('    - Net in vault:', formatEther(netDeposit), 'TFUEL');

      const unwrapAmount = parseEther('500');
      const burnTx = keccak256('burn-full-unwrap-test');

      const bobBalanceBefore = await ethers.provider.getBalance(bob.address);
      await vaultFactory.connect(zkBridgeOperator).unwrapFromBurn(
        vaultAddr,
        burnTx,
        bob.address,
        unwrapAmount
      );
      const bobBalanceAfter = await ethers.provider.getBalance(bob.address);

      expect(bobBalanceAfter - bobBalanceBefore).to.equal(unwrapAmount);

      console.log('  Unwrap Phase:');
      console.log('    - Sent to Bob:', formatEther(unwrapAmount), 'TFUEL (100%)');
    });
  });

  describe('Edge Cases & Security', function () {
    it('Should prevent unauthorized unwrap attempts', async function () {
      const salt = await vaultFactory.generateSalt(alice.address, 0);
      await vaultFactory.connect(alice).createVault(salt);
      const vaultAddr = await vaultFactory.predictAddress(salt);
      
      await alice.sendTransaction({ to: vaultAddr, value: parseEther('1000') });
      
      const burnTx = keccak256('unauthorized-burn');
      
      // Alice tries to unwrap directly (should fail - no ZK_BRIDGE_ROLE)
      await expect(
        vaultFactory.connect(alice).unwrapFromBurn(
          vaultAddr,
          burnTx,
          alice.address,
          parseEther('100')
        )
      ).to.be.reverted;
      
      // Bob tries to unwrap from Alice's vault (should fail)
      await expect(
        vaultFactory.connect(bob).unwrapFromBurn(
          vaultAddr,
          burnTx,
          bob.address,
          parseEther('100')
        )
      ).to.be.reverted;
    });

    it('Should prevent replay attacks on burn transactions', async function () {
      const salt = await vaultFactory.generateSalt(alice.address, 0);
      await vaultFactory.connect(alice).createVault(salt);
      const vaultAddr = await vaultFactory.predictAddress(salt);
      
      await alice.sendTransaction({ to: vaultAddr, value: parseEther('1000') });
      
      const burnTx = keccak256('replay-test');
      const amount = parseEther('100');
      
      // First unwrap succeeds
      await vaultFactory.connect(zkBridgeOperator).unwrapFromBurn(
        vaultAddr,
        burnTx,
        alice.address,
        amount
      );
      
      // Second unwrap with same burnTx should fail
      await expect(
        vaultFactory.connect(zkBridgeOperator).unwrapFromBurn(
          vaultAddr,
          burnTx,
          alice.address,
          amount
        )
      ).to.be.reverted;
      
      console.log('  ✓ Replay attack prevented');
    });

    it('Should handle vault with insufficient funds gracefully', async function () {
      const salt = await vaultFactory.generateSalt(alice.address, 0);
      await vaultFactory.connect(alice).createVault(salt);
      const vaultAddr = await vaultFactory.predictAddress(salt);
      
      // Only deposit 100 TFUEL
      await alice.sendTransaction({ to: vaultAddr, value: parseEther('100') });
      
      const vault = await ethers.getContractAt('SubVault', vaultAddr);
      const vaultBalance = await vault.getBalance();
      
      // Try to unwrap more than vault has
      const burnTx = keccak256('insufficient-funds');
      const excessAmount = vaultBalance + parseEther('1');
      
      await expect(
        vaultFactory.connect(zkBridgeOperator).unwrapFromBurn(
          vaultAddr,
          burnTx,
          alice.address,
          excessAmount
        )
      ).to.be.reverted;
      
      console.log('  ✓ Insufficient funds check working');
    });
  });

  describe('Gas Optimization Checks', function () {
    it('Should have reasonable gas costs for vault creation', async function () {
      const salt = await vaultFactory.generateSalt(alice.address, 0);
      const tx = await vaultFactory.connect(alice).createVault(salt);
      const receipt = await tx.wait();
      
      console.log('  Gas used for vault creation:', receipt.gasUsed.toString());
      // Typical Create2 deployment should be under 500k gas
      expect(BigInt(receipt.gasUsed.toString())).to.be.lt(500000n);
    });

    it('Should have reasonable gas costs for deposits', async function () {
      const salt = await vaultFactory.generateSalt(alice.address, 0);
      await vaultFactory.connect(alice).createVault(salt);
      const vaultAddr = await vaultFactory.predictAddress(salt);
      
      const tx = await alice.sendTransaction({ to: vaultAddr, value: parseEther('100') });
      const receipt = await tx.wait();
      
      console.log('  Gas used for deposit:', receipt.gasUsed.toString());
      // Should be under 100k gas
      expect(receipt.gasUsed).to.be.lt(100000);
    });

    it('Should have reasonable gas costs for unwrap', async function () {
      const salt = await vaultFactory.generateSalt(alice.address, 0);
      await vaultFactory.connect(alice).createVault(salt);
      const vaultAddr = await vaultFactory.predictAddress(salt);
      
      await alice.sendTransaction({ to: vaultAddr, value: parseEther('1000') });
      
      const burnTx = keccak256('gas-test');
      const tx = await vaultFactory.connect(zkBridgeOperator).unwrapFromBurn(
        vaultAddr,
        burnTx,
        alice.address,
        parseEther('100')
      );
      const receipt = await tx.wait();
      
      console.log('  Gas used for unwrap:', receipt.gasUsed.toString());
      // Should be under 150k gas
      expect(BigInt(receipt.gasUsed.toString())).to.be.lt(150000n);
    });
  });
});

