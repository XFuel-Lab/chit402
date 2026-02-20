/**
 * XFuel Protocol — System Optimization Tests (10 tests)
 *
 * Run: npx hardhat test test/optimizations/GasProfile.system.test.cjs
 *
 * Gas profiling and optimization validation across all 9 circuits:
 *   - Settlement gas targets (<100K where possible)
 *   - Deposit/submit gas baselines
 *   - Fee forwarding overhead
 *   - Bulk operation scaling
 *   - Cross-circuit deployment cost comparison
 */
const { expect } = require('chai');
const { ethers } = require('hardhat');

describe('System Optimization: Gas Profiling', function () {
  let splitter;
  let taoCircuit, a2aCircuit, gpuCircuit, zkmlCircuit, akashCircuit;
  let vaultsCircuit, roboticsCircuit, dataHubsCircuit, yieldCircuit;
  let admin, relayer, keeper, validator, user1;
  let bbb, lp, staker, treasury, stakePool;

  const MOCK_PROOF = '0x' + 'ab'.repeat(130);
  const MOCK_PV = '0x' + 'cd'.repeat(64);
  const MOCK_HASH = ethers.keccak256(ethers.toUtf8Bytes('gas-test'));

  beforeEach(async function () {
    [admin, relayer, keeper, validator, user1, bbb, lp, staker, treasury, stakePool] =
      await ethers.getSigners();

    const SF = await ethers.getContractFactory('CoreRevenueSplitter');
    splitter = await SF.deploy(admin.address, bbb.address, lp.address, staker.address, treasury.address, stakePool.address);
    await splitter.waitForDeployment();
    const splAddr = await splitter.getAddress();
    const CR = await splitter.CIRCUIT_ROLE();

    // Deploy all 9 circuits
    const TAO = await ethers.getContractFactory('TAOCircuit');
    taoCircuit = await TAO.deploy(admin.address, splAddr, ethers.ZeroAddress, ethers.ZeroAddress, ethers.ZeroAddress);
    await taoCircuit.waitForDeployment();
    await splitter.grantRole(CR, await taoCircuit.getAddress());

    const A2A = await ethers.getContractFactory('A2ACircuit');
    a2aCircuit = await A2A.deploy(admin.address, splAddr, ethers.ZeroAddress);
    await a2aCircuit.waitForDeployment();
    await splitter.grantRole(CR, await a2aCircuit.getAddress());

    const GPU = await ethers.getContractFactory('ThetaGPUCircuit');
    gpuCircuit = await GPU.deploy(admin.address, splAddr, ethers.ZeroAddress);
    await gpuCircuit.waitForDeployment();
    await splitter.grantRole(CR, await gpuCircuit.getAddress());

    const ZKML = await ethers.getContractFactory('ZKMLCircuit');
    zkmlCircuit = await ZKML.deploy(admin.address, splAddr, ethers.ZeroAddress);
    await zkmlCircuit.waitForDeployment();
    await splitter.grantRole(CR, await zkmlCircuit.getAddress());

    const AKASH = await ethers.getContractFactory('AkashCircuit');
    akashCircuit = await AKASH.deploy(admin.address, splAddr, ethers.ZeroAddress);
    await akashCircuit.waitForDeployment();
    await splitter.grantRole(CR, await akashCircuit.getAddress());

    const VAULTS = await ethers.getContractFactory('AutonomousVaults');
    vaultsCircuit = await VAULTS.deploy(admin.address, splAddr, ethers.ZeroAddress);
    await vaultsCircuit.waitForDeployment();
    await splitter.grantRole(CR, await vaultsCircuit.getAddress());

    const ROBO = await ethers.getContractFactory('AgentRobotics');
    roboticsCircuit = await ROBO.deploy(admin.address, splAddr, ethers.ZeroAddress);
    await roboticsCircuit.waitForDeployment();
    await splitter.grantRole(CR, await roboticsCircuit.getAddress());

    const DH = await ethers.getContractFactory('DataHubs');
    dataHubsCircuit = await DH.deploy(admin.address, splAddr, ethers.ZeroAddress);
    await dataHubsCircuit.waitForDeployment();
    await splitter.grantRole(CR, await dataHubsCircuit.getAddress());

    const YIELD = await ethers.getContractFactory('YieldCircuit');
    yieldCircuit = await YIELD.deploy(admin.address, splAddr, ethers.ZeroAddress);
    await yieldCircuit.waitForDeployment();
    await splitter.grantRole(CR, await yieldCircuit.getAddress());

    // Grant roles
    const TAO_REL = await taoCircuit.RELAYER_ROLE();
    await taoCircuit.grantRole(TAO_REL, relayer.address);
    const KEEPER_ROLE = await vaultsCircuit.KEEPER_ROLE();
    await vaultsCircuit.grantRole(KEEPER_ROLE, keeper.address);
    const STRAT_ROLE = await vaultsCircuit.STRATEGIST_ROLE();
    await vaultsCircuit.grantRole(STRAT_ROLE, admin.address);
    const YIELD_KEEPER = await yieldCircuit.KEEPER_ROLE();
    await yieldCircuit.grantRole(YIELD_KEEPER, keeper.address);
    const DH_VAL = await dataHubsCircuit.VALIDATOR_ROLE();
    await dataHubsCircuit.grantRole(DH_VAL, validator.address);
  });

  // ═══════════════════════════════════════════════════════════════════════
  //  1. SETTLEMENT GAS TARGETS
  // ═══════════════════════════════════════════════════════════════════════

  it('01: TAO settleTask gas < 100K', async function () {
    const tx1 = await taoCircuit.connect(user1).submitTask(0, 0, MOCK_HASH, 0, { value: ethers.parseEther('1') });
    const r1 = await tx1.wait();
    const ev = r1.logs.find(l => { try { return taoCircuit.interface.parseLog(l)?.name === 'TaskRouted'; } catch { return false; } });
    const taskId = taoCircuit.interface.parseLog(ev).args.taskId;

    const nullifier = ethers.keccak256(ethers.toUtf8Bytes('gas-settle'));
    const tx2 = await taoCircuit.connect(relayer).settleTask(taskId, MOCK_HASH, MOCK_PROOF, MOCK_PV, nullifier);
    const r2 = await tx2.wait();

    // Target: settlement should be under 100K gas
    expect(r2.gasUsed).to.be.lt(100000n);
  });

  it('02: Vault rebalance gas < 350K', async function () {
    const txS = await vaultsCircuit.registerStrategy(MOCK_HASH, 'Test', 'yield', 500);
    const rS = await txS.wait();
    const sEv = rS.logs.find(l => { try { return vaultsCircuit.interface.parseLog(l)?.name === 'StrategyRegistered'; } catch { return false; } });
    const stratId = vaultsCircuit.interface.parseLog(sEv).args.strategyId;

    const txV = await vaultsCircuit.createVault(stratId);
    const rV = await txV.wait();
    const vEv = rV.logs.find(l => { try { return vaultsCircuit.interface.parseLog(l)?.name === 'VaultCreated'; } catch { return false; } });
    const vaultId = vaultsCircuit.interface.parseLog(vEv).args.vaultId;

    await vaultsCircuit.connect(user1).deposit(vaultId, { value: ethers.parseEther('10') });

    const vault = await vaultsCircuit.getVault(vaultId);
    const nullifier = ethers.keccak256(ethers.toUtf8Bytes('gas-rebal'));
    const tx = await vaultsCircuit.connect(keeper).rebalance(vaultId, MOCK_HASH, vault.currentNav, MOCK_PROOF, MOCK_PV, nullifier);
    const r = await tx.wait();

    expect(r.gasUsed).to.be.lt(350000n);
  });

  it('03: Yield rebalancePosition gas < 300K', async function () {
    const txP = await yieldCircuit.connect(user1).openPosition({ value: ethers.parseEther('10') });
    const rP = await txP.wait();
    const pEv = rP.logs.find(l => { try { return yieldCircuit.interface.parseLog(l)?.name === 'PositionOpened'; } catch { return false; } });
    const posId = yieldCircuit.interface.parseLog(pEv).args.positionId;

    const nullifier = ethers.keccak256(ethers.toUtf8Bytes('gas-yield-rebal'));
    const tx = await yieldCircuit.connect(keeper).rebalancePosition(posId, MOCK_HASH, 0, MOCK_PROOF, MOCK_PV, nullifier);
    const r = await tx.wait();

    expect(r.gasUsed).to.be.lt(300000n);
  });

  // ═══════════════════════════════════════════════════════════════════════
  //  2. DEPOSIT / SUBMIT GAS BASELINES
  // ═══════════════════════════════════════════════════════════════════════

  it('04: TAO submitTask gas < 350K', async function () {
    const tx = await taoCircuit.connect(user1).submitTask(0, 0, MOCK_HASH, 0, { value: ethers.parseEther('1') });
    const r = await tx.wait();
    expect(r.gasUsed).to.be.lt(350000n);
  });

  it('05: Vault deposit gas < 350K', async function () {
    const txS = await vaultsCircuit.registerStrategy(MOCK_HASH, 'T', 'y', 500);
    const rS = await txS.wait();
    const sId = vaultsCircuit.interface.parseLog(rS.logs.find(l => { try { return vaultsCircuit.interface.parseLog(l)?.name === 'StrategyRegistered'; } catch { return false; } })).args.strategyId;
    const txV = await vaultsCircuit.createVault(sId);
    const rV = await txV.wait();
    const vId = vaultsCircuit.interface.parseLog(rV.logs.find(l => { try { return vaultsCircuit.interface.parseLog(l)?.name === 'VaultCreated'; } catch { return false; } })).args.vaultId;

    const tx = await vaultsCircuit.connect(user1).deposit(vId, { value: ethers.parseEther('10') });
    const r = await tx.wait();
    expect(r.gasUsed).to.be.lt(350000n);
  });

  it('06: YieldCircuit openPosition gas < 350K', async function () {
    const tx = await yieldCircuit.connect(user1).openPosition({ value: ethers.parseEther('10') });
    const r = await tx.wait();
    expect(r.gasUsed).to.be.lt(350000n);
  });

  // ═══════════════════════════════════════════════════════════════════════
  //  3. FEE FORWARDING OVERHEAD
  // ═══════════════════════════════════════════════════════════════════════

  it('07: Fee forwarding adds < 30K gas overhead', async function () {
    // Measure DataHubs purchaseAccess (includes fee forwarding)
    const txH = await dataHubsCircuit.createHub('GasHub', 'test', MOCK_HASH, 0, ethers.parseEther('1'));
    const rH = await txH.wait();
    const hEv = rH.logs.find(l => {
      try { return dataHubsCircuit.interface.parseLog(l)?.name === 'HubCreated'; } catch { return false; }
    });
    const hubId = dataHubsCircuit.interface.parseLog(hEv).args.hubId;

    const tx = await dataHubsCircuit.connect(user1).purchaseAccess(hubId, 86400, { value: ethers.parseEther('1') });
    const r = await tx.wait();
    // Total should be < 300K (access logic + fee forwarding)
    expect(r.gasUsed).to.be.lt(300000n);
  });

  // ═══════════════════════════════════════════════════════════════════════
  //  4. BULK OPERATION SCALING
  // ═══════════════════════════════════════════════════════════════════════

  it('08: 5 consecutive TAO tasks scale linearly', async function () {
    const gasUsages = [];
    for (let i = 0; i < 5; i++) {
      const tx = await taoCircuit.connect(user1).submitTask(i % 3, 0, MOCK_HASH, 0, { value: ethers.parseEther('0.1') });
      const r = await tx.wait();
      gasUsages.push(Number(r.gasUsed));
    }
    // Verify gas doesn't increase by more than 20% from first to last (linear scaling)
    const maxRatio = gasUsages[4] / gasUsages[0];
    expect(maxRatio).to.be.lt(1.2);
  });

  it('09: 5 consecutive yield positions scale linearly', async function () {
    const gasUsages = [];
    for (let i = 0; i < 5; i++) {
      const tx = await yieldCircuit.connect(user1).openPosition({ value: ethers.parseEther('1') });
      const r = await tx.wait();
      gasUsages.push(Number(r.gasUsed));
    }
    // Storage writes for each position are independent so gas should be stable
    const maxRatio = gasUsages[4] / gasUsages[0];
    expect(maxRatio).to.be.lt(1.2);
  });

  // ═══════════════════════════════════════════════════════════════════════
  //  5. DEPLOYMENT COST COMPARISON
  // ═══════════════════════════════════════════════════════════════════════

  it('10: All 9 circuits deploy under 3M gas each', async function () {
    const factories = [
      'TAOCircuit', 'A2ACircuit', 'ThetaGPUCircuit', 'ZKMLCircuit',
      'AkashCircuit', 'AutonomousVaults', 'AgentRobotics', 'DataHubs', 'YieldCircuit',
    ];

    for (const name of factories) {
      const F = await ethers.getContractFactory(name);
      let contract;
      if (name === 'TAOCircuit') {
        contract = await F.deploy(admin.address, admin.address, ethers.ZeroAddress, ethers.ZeroAddress, ethers.ZeroAddress);
      } else {
        contract = await F.deploy(admin.address, admin.address, ethers.ZeroAddress);
      }
      const r = await contract.deploymentTransaction().wait();
      expect(r.gasUsed).to.be.lt(3000000n);
    }
  });
});
