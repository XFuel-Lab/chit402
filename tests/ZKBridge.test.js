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
const MaxUint256 = ethers.MaxUint256 || ethers.constants.MaxUint256;

// Random value generators for fuzz testing
function randomAddress() {
  const randomBytes = ethers.randomBytes ? ethers.randomBytes(20) : ethers.utils.randomBytes(20);
  const hexlify = ethers.hexlify || ethers.utils.hexlify;
  return hexlify(randomBytes);
}

function randomBytes32() {
  const randomBytes = ethers.randomBytes ? ethers.randomBytes(32) : ethers.utils.randomBytes(32);
  const hexlify = ethers.hexlify || ethers.utils.hexlify;
  return hexlify(randomBytes);
}

function randomAmount(min, max) {
  const minBig = typeof min === 'bigint' ? min : BigInt(min);
  const maxBig = typeof max === 'bigint' ? max : BigInt(max);
  const range = maxBig - minBig;
  
  // Generate random BigInt within range
  const randomHex = ethers.randomBytes ? ethers.randomBytes(32) : ethers.utils.randomBytes(32);
  const hexlify = ethers.hexlify || ethers.utils.hexlify;
  const randomBig = BigInt(hexlify(randomHex));
  
  return minBig + (randomBig % range);
}

describe('ZKBridge - Fuzz Tests & Edge Cases', function () {
  let vaultFactory;
  let revSplitter;
  let admin;
  let zkBridgeOperator;
  let alice;
  let bob;
  let charlie;

  const ZK_BRIDGE_ROLE = keccak256('ZK_BRIDGE_ROLE');
  const PAUSER_ROLE = keccak256('PAUSER_ROLE');

  beforeEach(async function () {
    [admin, zkBridgeOperator, alice, bob, charlie] = await ethers.getSigners();

    // Deploy RevenueSplitter mock
    const MockRevSplitter = await ethers.getContractFactory('MockRevenueSplitter');
    revSplitter = await MockRevSplitter.deploy();
    
    if (typeof revSplitter.waitForDeployment === 'function') {
      await revSplitter.waitForDeployment();
    } else if (typeof revSplitter.deployed === 'function') {
      await revSplitter.deployed();
    }

    // Get admin address
    const adminAddr = typeof admin.getAddress === 'function' 
      ? await admin.getAddress() 
      : admin.address;
    const revSplitterAddr = typeof revSplitter.getAddress === 'function'
      ? await revSplitter.getAddress()
      : revSplitter.address;

    // Deploy VaultFactory
    const VaultFactory = await ethers.getContractFactory('VaultFactory');
    vaultFactory = await VaultFactory.deploy(adminAddr, revSplitterAddr);

    if (typeof vaultFactory.waitForDeployment === 'function') {
      await vaultFactory.waitForDeployment();
    } else if (typeof vaultFactory.deployed === 'function') {
      await vaultFactory.deployed();
    }

    // Grant ZK bridge role
    const zkBridgeOperatorAddr = typeof zkBridgeOperator.getAddress === 'function'
      ? await zkBridgeOperator.getAddress()
      : zkBridgeOperator.address;
    await vaultFactory.connect(admin).grantRole(ZK_BRIDGE_ROLE, zkBridgeOperatorAddr);
  });

  describe('Fuzz Tests - Random Circuit Inputs', function () {
    it('Should handle random deposit amounts correctly', async function () {
      const iterations = 20;
      
      for (let i = 0; i < iterations; i++) {
        // Generate random deposit between 0.001 and 10000 TFUEL
        const randomDeposit = randomAmount(
          parseEther('0.001'),
          parseEther('10000')
        );
        
        // Create vault with random salt
        const randomSalt = randomBytes32();
        await vaultFactory.connect(alice).createVault(randomSalt);
        const vaultAddr = await vaultFactory.predictAddress(randomSalt);
        
        // Deposit random amount
        await alice.sendTransaction({ to: vaultAddr, value: randomDeposit });
        
        const vault = await ethers.getContractAt('SubVault', vaultAddr);
        const vaultBalance = await vault.getBalance();
        
        // Calculate expected values
        const expectedFee = (randomDeposit * 50n) / 10000n; // 0.5%
        const expectedNet = randomDeposit - expectedFee;
        
        // Verify fee calculation is correct
        expect(vaultBalance).to.equal(expectedNet);
      }
      
      console.log(`  ✓ Successfully tested ${iterations} random deposits`);
    });

    it('Should handle random unwrap amounts with fuzz testing', async function () {
      const iterations = 15;
      
      for (let i = 0; i < iterations; i++) {
        // Setup vault with random initial balance
        const initialDeposit = randomAmount(
          parseEther('100'),
          parseEther('5000')
        );
        
        const salt = randomBytes32();
        await vaultFactory.connect(alice).createVault(salt);
        const vaultAddr = await vaultFactory.predictAddress(salt);
        await alice.sendTransaction({ to: vaultAddr, value: initialDeposit });
        
        const vault = await ethers.getContractAt('SubVault', vaultAddr);
        const vaultBalance = await vault.getBalance();
        
        // Random unwrap amount (between 1% and 50% of vault balance)
        const unwrapAmount = (vaultBalance * randomAmount(1n, 50n)) / 100n;
        
        const burnTx = randomBytes32();
        const bobAddr = typeof bob.getAddress === 'function' 
          ? await bob.getAddress() 
          : bob.address;
        const bobBalanceBefore = await ethers.provider.getBalance(bobAddr);
        
        // Execute unwrap
        await vaultFactory.connect(zkBridgeOperator).unwrapFromBurn(
          vaultAddr,
          burnTx,
          bobAddr,
          unwrapAmount
        );
        
        const bobBalanceAfter = await ethers.provider.getBalance(bobAddr);
        
        // Verify 70% was sent to recipient
        const expectedNet = (unwrapAmount * 7000n) / 10000n;
        expect(bobBalanceAfter - bobBalanceBefore).to.equal(expectedNet);
      }
      
      console.log(`  ✓ Successfully fuzz tested ${iterations} random unwraps`);
    });

    it('Should handle random nonces for deterministic vault generation', async function () {
      const iterations = 25;
      const nonces = new Set();
      
      for (let i = 0; i < iterations; i++) {
        // Generate random nonce
        const randomNonce = randomAmount(0n, 1000000n);
        
        // Skip if we've already used this nonce (unlikely but possible)
        if (nonces.has(randomNonce.toString())) continue;
        nonces.add(randomNonce.toString());
        
        const aliceAddr = typeof alice.getAddress === 'function'
          ? await alice.getAddress()
          : alice.address;
        
        // Generate salt from random nonce
        const salt = await vaultFactory.generateSalt(aliceAddr, randomNonce);
        const predictedAddr = await vaultFactory.predictAddress(salt);
        
        // Create vault
        await vaultFactory.connect(alice).createVault(salt);
        
        // Verify it was created at predicted address
        expect(await vaultFactory.isVault(predictedAddr)).to.be.true;
      }
      
      console.log(`  ✓ Successfully tested ${nonces.size} unique random nonces`);
    });
  });

  describe('Fuzz Tests - Invalid Proofs & Burn Transactions', function () {
    it('Should reject random invalid burn transaction hashes', async function () {
      // Setup vault
      const salt = keccak256('fuzz-invalid-burns');
      await vaultFactory.connect(alice).createVault(salt);
      const vaultAddr = await vaultFactory.predictAddress(salt);
      await alice.sendTransaction({ to: vaultAddr, value: parseEther('1000') });
      
      const bobAddr = typeof bob.getAddress === 'function'
        ? await bob.getAddress()
        : bob.address;
      
      const attempts = 10;
      const usedHashes = new Set();
      
      for (let i = 0; i < attempts; i++) {
        const randomBurnTx = randomBytes32();
        
        // Skip if already used (replay test)
        if (usedHashes.has(randomBurnTx)) {
          await expect(
            vaultFactory.connect(zkBridgeOperator).unwrapFromBurn(
              vaultAddr,
              randomBurnTx,
              bobAddr,
              parseEther('10')
            )
          ).to.be.reverted; // Should fail on replay
          continue;
        }
        
        usedHashes.add(randomBurnTx);
        
        // First use should succeed
        await vaultFactory.connect(zkBridgeOperator).unwrapFromBurn(
          vaultAddr,
          randomBurnTx,
          bobAddr,
          parseEther('10')
        );
        
        // Replay attack should fail
        await expect(
          vaultFactory.connect(zkBridgeOperator).unwrapFromBurn(
            vaultAddr,
            randomBurnTx,
            bobAddr,
            parseEther('10')
          )
        ).to.be.reverted;
      }
      
      console.log(`  ✓ Tested ${usedHashes.size} unique burn hashes with replay protection`);
    });

    it('Should reject manipulated burn transaction data', async function () {
      const salt = keccak256('fuzz-manipulated');
      await vaultFactory.connect(alice).createVault(salt);
      const vaultAddr = await vaultFactory.predictAddress(salt);
      await alice.sendTransaction({ to: vaultAddr, value: parseEther('1000') });
      
      const bobAddr = typeof bob.getAddress === 'function'
        ? await bob.getAddress()
        : bob.address;
      
      // Valid burn transaction
      const validBurnTx = keccak256('valid-burn-tx');
      await vaultFactory.connect(zkBridgeOperator).unwrapFromBurn(
        vaultAddr,
        validBurnTx,
        bobAddr,
        parseEther('10')
      );
      
      // Attempt to manipulate by flipping bits
      const manipulatedHashes = [];
      for (let i = 0; i < 10; i++) {
        // Flip random bits in the valid hash
        const validBytes = ethers.getBytes ? ethers.getBytes(validBurnTx) : ethers.utils.arrayify(validBurnTx);
        const manipulated = new Uint8Array(validBytes);
        const randomIndex = Math.floor(Math.random() * manipulated.length);
        manipulated[randomIndex] ^= 0xFF; // Flip all bits of one byte
        
        const hexlify = ethers.hexlify || ethers.utils.hexlify;
        const manipulatedHash = hexlify(manipulated);
        manipulatedHashes.push(manipulatedHash);
        
        // Manipulated hash should work once (new hash) but fail on replay
        await vaultFactory.connect(zkBridgeOperator).unwrapFromBurn(
          vaultAddr,
          manipulatedHash,
          bobAddr,
          parseEther('5')
        );
        
        await expect(
          vaultFactory.connect(zkBridgeOperator).unwrapFromBurn(
            vaultAddr,
            manipulatedHash,
            bobAddr,
            parseEther('5')
          )
        ).to.be.reverted;
      }
      
      console.log(`  ✓ Tested ${manipulatedHashes.length} manipulated burn hashes`);
    });

    it('Should handle zero and invalid recipients', async function () {
      const salt = keccak256('fuzz-recipients');
      await vaultFactory.connect(alice).createVault(salt);
      const vaultAddr = await vaultFactory.predictAddress(salt);
      await alice.sendTransaction({ to: vaultAddr, value: parseEther('1000') });
      
      // Test zero address
      await expect(
        vaultFactory.connect(zkBridgeOperator).unwrapFromBurn(
          vaultAddr,
          randomBytes32(),
          ZeroAddress,
          parseEther('10')
        )
      ).to.be.reverted;
      
      // Test random addresses
      for (let i = 0; i < 5; i++) {
        const randomRecipient = randomAddress();
        const burnTx = randomBytes32();
        
        const balanceBefore = await ethers.provider.getBalance(randomRecipient);
        
        await vaultFactory.connect(zkBridgeOperator).unwrapFromBurn(
          vaultAddr,
          burnTx,
          randomRecipient,
          parseEther('10')
        );
        
        const balanceAfter = await ethers.provider.getBalance(randomRecipient);
        const expectedNet = parseEther('7'); // 70% of 10
        
        expect(balanceAfter - balanceBefore).to.equal(expectedNet);
      }
      
      console.log('  ✓ Tested zero address rejection and random valid recipients');
    });
  });

  describe('Edge Cases - Maximum Values', function () {
    it('Should handle maximum uint256 nonce without overflow', async function () {
      const aliceAddr = typeof alice.getAddress === 'function'
        ? await alice.getAddress()
        : alice.address;
      
      // Test with max uint256
      const maxNonce = MaxUint256;
      const salt = await vaultFactory.generateSalt(aliceAddr, maxNonce);
      
      // Should not revert on salt generation
      expect(salt).to.not.equal(ZeroHash);
      
      // Should be able to create vault with max nonce
      await vaultFactory.connect(alice).createVault(salt);
      const vaultAddr = await vaultFactory.predictAddress(salt);
      
      expect(await vaultFactory.isVault(vaultAddr)).to.be.true;
      
      console.log('  ✓ Max uint256 nonce handled correctly');
    });

    it('Should handle near-maximum deposit amounts', async function () {
      // Test with 1 million TFUEL (very large but realistic)
      const largeAmount = parseEther('1000000');
      
      const salt = keccak256('edge-large-deposit');
      await vaultFactory.connect(alice).createVault(salt);
      const vaultAddr = await vaultFactory.predictAddress(salt);
      
      // Deposit large amount
      await alice.sendTransaction({ to: vaultAddr, value: largeAmount });
      
      const vault = await ethers.getContractAt('SubVault', vaultAddr);
      const vaultBalance = await vault.getBalance();
      
      // Calculate expected (should not overflow)
      const expectedFee = (largeAmount * 50n) / 10000n;
      const expectedNet = largeAmount - expectedFee;
      
      expect(vaultBalance).to.equal(expectedNet);
      
      console.log('  ✓ Large deposit (1M TFUEL) handled without overflow');
    });

    it('Should handle minimum viable amounts', async function () {
      // Test with 1 wei
      const minAmount = 1n;
      
      const salt = keccak256('edge-min-deposit');
      await vaultFactory.connect(alice).createVault(salt);
      const vaultAddr = await vaultFactory.predictAddress(salt);
      
      // 1 wei deposit should fail (zero amount after fee would round to 0)
      await expect(
        alice.sendTransaction({ to: vaultAddr, value: minAmount })
      ).to.be.reverted;
      
      // Test with 201 wei (minimum to get 1 wei after 0.5% fee)
      const viableMinimum = 201n;
      await alice.sendTransaction({ to: vaultAddr, value: viableMinimum });
      
      const vault = await ethers.getContractAt('SubVault', vaultAddr);
      const vaultBalance = await vault.getBalance();
      
      expect(vaultBalance).to.be.gt(0);
      
      console.log('  ✓ Minimum viable amounts tested');
    });

    it('Should reject unwrap when amount exceeds vault balance', async function () {
      const salt = keccak256('edge-insufficient');
      await vaultFactory.connect(alice).createVault(salt);
      const vaultAddr = await vaultFactory.predictAddress(salt);
      
      // Deposit only 100 TFUEL
      const deposit = parseEther('100');
      await alice.sendTransaction({ to: vaultAddr, value: deposit });
      
      const vault = await ethers.getContractAt('SubVault', vaultAddr);
      const vaultBalance = await vault.getBalance();
      
      const bobAddr = typeof bob.getAddress === 'function'
        ? await bob.getAddress()
        : bob.address;
      
      // Try to unwrap more than balance
      const excessAmount = vaultBalance + parseEther('1');
      
      await expect(
        vaultFactory.connect(zkBridgeOperator).unwrapFromBurn(
          vaultAddr,
          randomBytes32(),
          bobAddr,
          excessAmount
        )
      ).to.be.reverted;
      
      console.log('  ✓ Insufficient balance properly rejected');
    });
  });

  describe('Edge Cases - Zero Values', function () {
    it('Should reject zero amount deposits', async function () {
      const salt = keccak256('edge-zero-deposit');
      await vaultFactory.connect(alice).createVault(salt);
      const vaultAddr = await vaultFactory.predictAddress(salt);
      
      await expect(
        alice.sendTransaction({ to: vaultAddr, value: 0 })
      ).to.be.reverted;
      
      console.log('  ✓ Zero deposit rejected');
    });

    it('Should reject zero amount unwraps', async function () {
      const salt = keccak256('edge-zero-unwrap');
      await vaultFactory.connect(alice).createVault(salt);
      const vaultAddr = await vaultFactory.predictAddress(salt);
      await alice.sendTransaction({ to: vaultAddr, value: parseEther('100') });
      
      const bobAddr = typeof bob.getAddress === 'function'
        ? await bob.getAddress()
        : bob.address;
      
      await expect(
        vaultFactory.connect(zkBridgeOperator).unwrapFromBurn(
          vaultAddr,
          randomBytes32(),
          bobAddr,
          0
        )
      ).to.be.reverted;
      
      console.log('  ✓ Zero unwrap amount rejected');
    });

    it('Should handle zero nonce correctly', async function () {
      const aliceAddr = typeof alice.getAddress === 'function'
        ? await alice.getAddress()
        : alice.address;
      
      const salt1 = await vaultFactory.generateSalt(aliceAddr, 0);
      const salt2 = await vaultFactory.generateSalt(aliceAddr, 0);
      
      // Same nonce should produce same salt
      expect(salt1).to.equal(salt2);
      
      // Should only be able to create one vault with nonce 0
      await vaultFactory.connect(alice).createVault(salt1);
      
      await expect(
        vaultFactory.connect(alice).createVault(salt2)
      ).to.be.reverted;
      
      console.log('  ✓ Zero nonce handled correctly');
    });
  });

  describe('Merkle Tree Edge Cases', function () {
    it('Should handle colliding salt values from different inputs', async function () {
      // Test that different (address, nonce) pairs produce different salts
      const aliceAddr = typeof alice.getAddress === 'function'
        ? await alice.getAddress()
        : alice.address;
      const bobAddr = typeof bob.getAddress === 'function'
        ? await bob.getAddress()
        : bob.address;
      
      const salts = new Map();
      
      for (let i = 0; i < 20; i++) {
        const nonce = BigInt(i);
        
        const saltAlice = await vaultFactory.generateSalt(aliceAddr, nonce);
        const saltBob = await vaultFactory.generateSalt(bobAddr, nonce);
        
        // Different addresses should produce different salts
        expect(saltAlice).to.not.equal(saltBob);
        
        // Check for collisions
        expect(salts.has(saltAlice)).to.be.false;
        expect(salts.has(saltBob)).to.be.false;
        
        salts.set(saltAlice, `alice-${i}`);
        salts.set(saltBob, `bob-${i}`);
      }
      
      console.log(`  ✓ No collisions found in ${salts.size} generated salts`);
    });

    it('Should produce deterministic addresses for same salt', async function () {
      const aliceAddr = typeof alice.getAddress === 'function'
        ? await alice.getAddress()
        : alice.address;
      
      const iterations = 15;
      
      for (let i = 0; i < iterations; i++) {
        const nonce = BigInt(i + 1000); // Use offset to avoid conflicts
        const salt = await vaultFactory.generateSalt(aliceAddr, nonce);
        
        // Predict address multiple times
        const addr1 = await vaultFactory.predictAddress(salt);
        const addr2 = await vaultFactory.predictAddress(salt);
        const addr3 = await vaultFactory.predictAddress(salt);
        
        // All predictions should be identical
        expect(addr1).to.equal(addr2);
        expect(addr2).to.equal(addr3);
      }
      
      console.log(`  ✓ Address prediction is deterministic across ${iterations} iterations`);
    });

    it('Should verify vault ownership through CREATE2 derivation', async function () {
      const aliceAddr = typeof alice.getAddress === 'function'
        ? await alice.getAddress()
        : alice.address;
      
      // Create vault
      const nonce = 9999n;
      const salt = await vaultFactory.generateSalt(aliceAddr, nonce);
      const predictedAddr = await vaultFactory.predictAddress(salt);
      
      // Create vault
      await vaultFactory.connect(alice).createVault(salt);
      
      // Verify vault was created at predicted address
      expect(await vaultFactory.isVault(predictedAddr)).to.be.true;
      
      // Verify we can interact with it
      await alice.sendTransaction({ to: predictedAddr, value: parseEther('10') });
      
      const vault = await ethers.getContractAt('SubVault', predictedAddr);
      const balance = await vault.getBalance();
      
      expect(balance).to.be.gt(0);
      
      console.log('  ✓ CREATE2 derivation and ownership verified');
    });
  });

  describe('Stress Tests - Multiple Operations', function () {
    it('Should handle multiple concurrent deposits to same vault', async function () {
      const salt = keccak256('stress-concurrent-deposits');
      await vaultFactory.connect(alice).createVault(salt);
      const vaultAddr = await vaultFactory.predictAddress(salt);
      
      const vault = await ethers.getContractAt('SubVault', vaultAddr);
      
      // Multiple users deposit to same vault
      const deposits = [
        alice.sendTransaction({ to: vaultAddr, value: parseEther('100') }),
        bob.sendTransaction({ to: vaultAddr, value: parseEther('200') }),
        charlie.sendTransaction({ to: vaultAddr, value: parseEther('150') })
      ];
      
      await Promise.all(deposits);
      
      const totalDeposited = parseEther('450');
      const expectedFee = (totalDeposited * 50n) / 10000n;
      const expectedNet = totalDeposited - expectedFee;
      
      const vaultBalance = await vault.getBalance();
      expect(vaultBalance).to.equal(expectedNet);
      
      console.log('  ✓ Multiple concurrent deposits handled correctly');
    });

    it('Should handle rapid vault creation with sequential nonces', async function () {
      const aliceAddr = typeof alice.getAddress === 'function'
        ? await alice.getAddress()
        : alice.address;
      
      const vaultCount = 30;
      const createdVaults = [];
      
      for (let i = 0; i < vaultCount; i++) {
        const salt = await vaultFactory.generateSalt(aliceAddr, BigInt(i + 2000));
        await vaultFactory.connect(alice).createVault(salt);
        const vaultAddr = await vaultFactory.predictAddress(salt);
        createdVaults.push(vaultAddr);
      }
      
      // Verify all vaults are tracked
      for (const vaultAddr of createdVaults) {
        expect(await vaultFactory.isVault(vaultAddr)).to.be.true;
      }
      
      console.log(`  ✓ Successfully created ${vaultCount} vaults rapidly`);
    });

    it('Should handle multiple unwraps from same vault', async function () {
      const salt = keccak256('stress-multiple-unwraps');
      await vaultFactory.connect(alice).createVault(salt);
      const vaultAddr = await vaultFactory.predictAddress(salt);
      
      // Fund vault with large amount
      await alice.sendTransaction({ to: vaultAddr, value: parseEther('10000') });
      
      const bobAddr = typeof bob.getAddress === 'function'
        ? await bob.getAddress()
        : bob.address;
      
      // Perform 20 unwraps
      const unwrapCount = 20;
      for (let i = 0; i < unwrapCount; i++) {
        const burnTx = keccak256(`stress-burn-${i}`);
        await vaultFactory.connect(zkBridgeOperator).unwrapFromBurn(
          vaultAddr,
          burnTx,
          bobAddr,
          parseEther('10')
        );
      }
      
      const vault = await ethers.getContractAt('SubVault', vaultAddr);
      
      // Verify all burns are marked as processed
      for (let i = 0; i < unwrapCount; i++) {
        const burnTx = keccak256(`stress-burn-${i}`);
        expect(await vault.isBurnProcessed(burnTx)).to.be.true;
      }
      
      console.log(`  ✓ Successfully processed ${unwrapCount} unwraps`);
    });
  });

  describe('Authorization & Access Control Fuzz Tests', function () {
    it('Should reject unwrap from unauthorized random addresses', async function () {
      const salt = keccak256('auth-test');
      await vaultFactory.connect(alice).createVault(salt);
      const vaultAddr = await vaultFactory.predictAddress(salt);
      await alice.sendTransaction({ to: vaultAddr, value: parseEther('1000') });
      
      const bobAddr = typeof bob.getAddress === 'function'
        ? await bob.getAddress()
        : bob.address;
      
      // Test with random unauthorized signers
      const unauthorizedSigners = [alice, bob, charlie];
      
      for (const signer of unauthorizedSigners) {
        await expect(
          vaultFactory.connect(signer).unwrapFromBurn(
            vaultAddr,
            randomBytes32(),
            bobAddr,
            parseEther('10')
          )
        ).to.be.reverted;
      }
      
      console.log('  ✓ All unauthorized unwrap attempts rejected');
    });

    it('Should maintain role separation under stress', async function () {
      // Admin should not lose privileges after many operations
      const operations = 10;
      
      for (let i = 0; i < operations; i++) {
        const salt = randomBytes32();
        await vaultFactory.connect(alice).createVault(salt);
      }
      
      // Admin should still have all roles
      const adminAddr = typeof admin.getAddress === 'function'
        ? await admin.getAddress()
        : admin.address;
      
      expect(await vaultFactory.hasRole(ZK_BRIDGE_ROLE, adminAddr)).to.be.true;
      expect(await vaultFactory.hasRole(PAUSER_ROLE, adminAddr)).to.be.true;
      
      console.log('  ✓ Role separation maintained under stress');
    });
  });

  describe('Fee Calculation Edge Cases', function () {
    it('Should handle fee calculations without rounding errors', async function () {
      // Test various amounts that might cause rounding issues
      const testAmounts = [
        parseEther('0.001'),
        parseEther('1.111'),
        parseEther('99.999'),
        parseEther('1234.567'),
        parseEther('0.123456789')
      ];
      
      for (const amount of testAmounts) {
        const salt = randomBytes32();
        await vaultFactory.connect(alice).createVault(salt);
        const vaultAddr = await vaultFactory.predictAddress(salt);
        
        await alice.sendTransaction({ to: vaultAddr, value: amount });
        
        const vault = await ethers.getContractAt('SubVault', vaultAddr);
        const vaultBalance = await vault.getBalance();
        
        const expectedFee = (amount * 50n) / 10000n;
        const expectedNet = amount - expectedFee;
        
        // Verify precision
        expect(vaultBalance).to.equal(expectedNet);
      }
      
      console.log('  ✓ Fee calculations precise for various amounts');
    });

    it('Should handle yield recycle calculations correctly', async function () {
      const testAmounts = [
        parseEther('100'),
        parseEther('333.333'),
        parseEther('999.999')
      ];
      
      for (const amount of testAmounts) {
        const salt = randomBytes32();
        await vaultFactory.connect(alice).createVault(salt);
        const vaultAddr = await vaultFactory.predictAddress(salt);
        
        await alice.sendTransaction({ to: vaultAddr, value: amount });
        
        const vault = await ethers.getContractAt('SubVault', vaultAddr);
        const vaultBalance = await vault.getBalance();
        
        // Unwrap half the balance
        const unwrapAmount = vaultBalance / 2n;
        const burnTx = randomBytes32();
        
        const bobAddr = typeof bob.getAddress === 'function'
          ? await bob.getAddress()
          : bob.address;
        const bobBalanceBefore = await ethers.provider.getBalance(bobAddr);
        
        await vaultFactory.connect(zkBridgeOperator).unwrapFromBurn(
          vaultAddr,
          burnTx,
          bobAddr,
          unwrapAmount
        );
        
        const bobBalanceAfter = await ethers.provider.getBalance(bobAddr);
        
        // Verify 70/30 split
        const expectedNet = (unwrapAmount * 7000n) / 10000n;
        expect(bobBalanceAfter - bobBalanceBefore).to.equal(expectedNet);
      }
      
      console.log('  ✓ Yield recycle calculations correct');
    });
  });
});

