const { expect } = require('chai');
const { ethers } = require('hardhat');

describe('ZK Bridge Integration - Full Flow (v6)', function () {
  let vaultFactory;
  let revSplitter;
  let admin, zkBridgeOperator, alice, bob;

  beforeEach(async function () {
    [admin, zkBridgeOperator, alice, bob] = await ethers.getSigners();

    // Deploy RevenueSplitter mock
    const MockRevSplitter = await ethers.getContractFactory('MockRevenueSplitter');
    revSplitter = await MockRevSplitter.deploy();
    await revSplitter.waitForDeployment();

    // Deploy VaultFactory
    const VaultFactory = await ethers.getContractFactory('VaultFactory');
    vaultFactory = await VaultFactory.deploy(admin.address, await revSplitter.getAddress());
    await vaultFactory.waitForDeployment();

    // Grant ZK bridge role
    const ZK_BRIDGE_ROLE = ethers.id('ZK_BRIDGE_ROLE');
    await vaultFactory.connect(admin).grantRole(ZK_BRIDGE_ROLE, zkBridgeOperator.address);
  });

  it('Should execute full wrap->unwrap cycle', async function () {
    // Step 1: Create vault
    const salt = await vaultFactory.generateSalt(alice.address, 0);
    await vaultFactory.connect(alice).createVault(salt);
    const vaultAddr = await vaultFactory.predictAddress(salt);
    
    console.log('  ✓ Alice vault created at:', vaultAddr);
    
    // Step 2: Deposit 1000 TFUEL
    const depositAmount = ethers.parseEther('1000');
    await alice.sendTransaction({ to: vaultAddr, value: depositAmount });
    
    const vault = await ethers.getContractAt('SubVault', vaultAddr);
    const vaultBalance = await vault.getBalance();
    
    // Verify 0.5% fee deducted
    const expectedFee = depositAmount * 50n / 10000n;
    const expectedNet = depositAmount - expectedFee;
    expect(vaultBalance).to.equal(expectedNet);
    
    console.log('  ✓ Alice deposited 1000 TFUEL');
    console.log('    - Fee:', ethers.formatEther(expectedFee), 'TFUEL');
    console.log('    - Net in vault:', ethers.formatEther(expectedNet), 'TFUEL');
    
    // Step 3: Burn on Persistence & unwrap
    const burnAmount = ethers.parseEther('500');
    const burnTxHash = ethers.id('persistence-burn-alice-500');
    
    console.log('  ✓ Alice burns 500 ibcTFUEL on Persistence');
    
    const bobBalanceBefore = await ethers.provider.getBalance(bob.address);
    
    await vaultFactory.connect(zkBridgeOperator).unwrapFromBurn(
      vaultAddr,
      burnTxHash,
      bob.address,
      burnAmount
    );
    
    const bobBalanceAfter = await ethers.provider.getBalance(bob.address);
    expect(bobBalanceAfter - bobBalanceBefore).to.equal(burnAmount);

    console.log('  ✓ ZK bridge unlocked TFUEL');
    console.log('    - Sent to Bob:', ethers.formatEther(burnAmount), 'TFUEL (100%)');
    
    // Verify burn processed
    expect(await vault.isBurnProcessed(burnTxHash)).to.be.true;
    
    console.log('  ✓ Complete cycle successful!');
  });

  it('Should prevent replay attacks', async function () {
    const salt = await vaultFactory.generateSalt(alice.address, 0);
    await vaultFactory.connect(alice).createVault(salt);
    const vaultAddr = await vaultFactory.predictAddress(salt);
    
    await alice.sendTransaction({ to: vaultAddr, value: ethers.parseEther('1000') });
    
    const burnTxHash = ethers.id('replay-test-burn');
    const amount = ethers.parseEther('100');
    
    // First unwrap succeeds
    await vaultFactory.connect(zkBridgeOperator).unwrapFromBurn(
      vaultAddr,
      burnTxHash,
      alice.address,
      amount
    );
    
    // Second unwrap fails
    await expect(
      vaultFactory.connect(zkBridgeOperator).unwrapFromBurn(
        vaultAddr,
        burnTxHash,
        alice.address,
        amount
      )
    ).to.be.reverted;
    
    console.log('  ✓ Replay attack prevented');
  });

  it('Should send full unwrap amount to recipient', async function () {
    const salt = await vaultFactory.generateSalt(alice.address, 0);
    await vaultFactory.connect(alice).createVault(salt);
    const vaultAddr = await vaultFactory.predictAddress(salt);

    const depositAmount = ethers.parseEther('1000');
    await alice.sendTransaction({ to: vaultAddr, value: depositAmount });

    const fee = depositAmount * 50n / 10000n;
    const netDeposit = depositAmount - fee;

    console.log('  Deposit Phase:');
    console.log('    - Gross:', ethers.formatEther(depositAmount), 'TFUEL');
    console.log('    - Fee (0.5%):', ethers.formatEther(fee), 'TFUEL');
    console.log('    - Net in vault:', ethers.formatEther(netDeposit), 'TFUEL');

    const unwrapAmount = ethers.parseEther('500');
    const burnTx = ethers.id('burn-yield-test');

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
    console.log('    - Sent to Bob:', ethers.formatEther(unwrapAmount), 'TFUEL (100%)');
  });

  it('Should enforce access control', async function () {
    const salt = await vaultFactory.generateSalt(alice.address, 0);
    await vaultFactory.connect(alice).createVault(salt);
    const vaultAddr = await vaultFactory.predictAddress(salt);
    
    await alice.sendTransaction({ to: vaultAddr, value: ethers.parseEther('1000') });
    
    const burnTx = ethers.id('unauthorized-burn');
    
    // Non-ZK-bridge user cannot trigger unwrap
    await expect(
      vaultFactory.connect(alice).unwrapFromBurn(
        vaultAddr,
        burnTx,
        alice.address,
        ethers.parseEther('100')
      )
    ).to.be.reverted;
    
    console.log('  ✓ Access control enforced');
  });
});

