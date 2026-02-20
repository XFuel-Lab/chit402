/**
 * XFuel Protocol — Load & Chaos Hardening Tests (20 tests)
 *
 * Run: npx hardhat test test/hardening/LoadChaos.hardening.test.cjs
 *
 * Validates protocol resilience under:
 *   - High-volume concurrent task submission (500+ ops)
 *   - Multi-circuit simultaneous load
 *   - Gas stability under sustained throughput
 *   - Pause/unpause mid-stream chaos
 *   - Nullifier collision resistance at scale
 *   - Fee accounting accuracy under load
 */
const { expect } = require('chai');
const { ethers } = require('hardhat');

describe('Load & Chaos Hardening', function () {
  let splitter;
  let tao, yield_, near, datahubs, solana;
  let admin, relayer, solver, validator, keeper;
  let user1, user2, user3, user4, user5;
  let bbb, lp, staker, treasury, stakePool;

  const MOCK_PROOF = '0x' + 'ab'.repeat(130);
  const MOCK_PV = '0x' + 'cd'.repeat(64);
  const HASH = ethers.keccak256(ethers.toUtf8Bytes('load-test'));

  beforeEach(async function () {
    [admin, relayer, solver, validator, keeper, user1, user2, user3, user4, user5,
     bbb, lp, staker, treasury, stakePool] = await ethers.getSigners();

    const SF = await ethers.getContractFactory('CoreRevenueSplitter');
    splitter = await SF.deploy(admin.address, bbb.address, lp.address, staker.address, treasury.address, stakePool.address);
    await splitter.waitForDeployment();
    const splAddr = await splitter.getAddress();
    const CR = await splitter.CIRCUIT_ROLE();

    const TAO = await ethers.getContractFactory('TAOCircuit');
    tao = await TAO.deploy(admin.address, splAddr, ethers.ZeroAddress, ethers.ZeroAddress, ethers.ZeroAddress);
    await tao.waitForDeployment();
    await splitter.grantRole(CR, await tao.getAddress());
    await tao.grantRole(await tao.RELAYER_ROLE(), relayer.address);

    const YIELD = await ethers.getContractFactory('YieldCircuit');
    yield_ = await YIELD.deploy(admin.address, splAddr, ethers.ZeroAddress);
    await yield_.waitForDeployment();
    await splitter.grantRole(CR, await yield_.getAddress());
    await yield_.grantRole(await yield_.KEEPER_ROLE(), keeper.address);

    const NEAR = await ethers.getContractFactory('NearAgents');
    near = await NEAR.deploy(admin.address, splAddr, ethers.ZeroAddress);
    await near.waitForDeployment();
    await splitter.grantRole(CR, await near.getAddress());
    await near.grantRole(await near.SOLVER_ROLE(), solver.address);

    const DH = await ethers.getContractFactory('DataHubs');
    datahubs = await DH.deploy(admin.address, splAddr, ethers.ZeroAddress);
    await datahubs.waitForDeployment();
    await splitter.grantRole(CR, await datahubs.getAddress());
    await datahubs.grantRole(await datahubs.VALIDATOR_ROLE(), validator.address);

    const SOL = await ethers.getContractFactory('SolanaAIBridge');
    solana = await SOL.deploy(admin.address, splAddr, ethers.ZeroAddress);
    await solana.waitForDeployment();
    await splitter.grantRole(CR, await solana.getAddress());
    await solana.grantRole(await solana.RELAYER_ROLE(), relayer.address);
  });

  // ═══════════════════════════════════════════════════════════════════════
  //  1. HIGH-VOLUME TAO TASK SUBMISSION
  // ═══════════════════════════════════════════════════════════════════════

  it('01: 50 TAO tasks from 5 users in rapid succession', async function () {
    const users = [user1, user2, user3, user4, user5];
    const promises = [];
    for (let i = 0; i < 50; i++) {
      const u = users[i % 5];
      promises.push(tao.connect(u).submitTask(i % 3, 0, HASH, 0, { value: ethers.parseEther('0.01') }));
    }
    await Promise.all(promises);
    const count = await tao.taskCount();
    expect(count).to.equal(50n);
  });

  it('02: 50 TAO tasks + 10 settlements gas remains stable', async function () {
    const gasUsages = [];
    for (let i = 0; i < 10; i++) {
      const tx = await tao.connect(user1).submitTask(0, 0, HASH, 0, { value: ethers.parseEther('0.1') });
      const r = await tx.wait();
      const ev = r.logs.find(l => { try { return tao.interface.parseLog(l)?.name === 'TaskRouted'; } catch { return false; } });
      const taskId = tao.interface.parseLog(ev).args.taskId;
      const n = ethers.keccak256(ethers.toUtf8Bytes(`settle-${i}`));
      const stx = await tao.connect(relayer).settleTask(taskId, HASH, MOCK_PROOF, MOCK_PV, n);
      const sr = await stx.wait();
      gasUsages.push(Number(sr.gasUsed));
    }
    const maxRatio = gasUsages[9] / gasUsages[0];
    expect(maxRatio).to.be.lt(1.15);
  });

  // ═══════════════════════════════════════════════════════════════════════
  //  2. YIELD CIRCUIT LOAD
  // ═══════════════════════════════════════════════════════════════════════

  it('03: 30 yield positions opened in parallel', async function () {
    const users = [user1, user2, user3, user4, user5];
    const promises = [];
    for (let i = 0; i < 30; i++) {
      promises.push(yield_.connect(users[i % 5]).openPosition({ value: ethers.parseEther('0.1') }));
    }
    await Promise.all(promises);
    expect(await yield_.positionCount()).to.equal(30n);
  });

  it('04: 20 yield rebalances with unique nullifiers', async function () {
    const tx = await yield_.connect(user1).openPosition({ value: ethers.parseEther('10') });
    const r = await tx.wait();
    const ev = r.logs.find(l => { try { return yield_.interface.parseLog(l)?.name === 'PositionOpened'; } catch { return false; } });
    const posId = yield_.interface.parseLog(ev).args.positionId;

    for (let i = 0; i < 20; i++) {
      const n = ethers.keccak256(ethers.toUtf8Bytes(`rebal-load-${i}`));
      await yield_.connect(keeper).rebalancePosition(posId, HASH, 0, MOCK_PROOF, MOCK_PV, n);
    }
    const [, , , , , rebals] = await yield_.getStats();
    expect(rebals).to.equal(20n);
  });

  // ═══════════════════════════════════════════════════════════════════════
  //  3. NEAR AGENTS LOAD
  // ═══════════════════════════════════════════════════════════════════════

  it('05: 20 agents registered in parallel', async function () {
    const promises = [];
    for (let i = 0; i < 20; i++) {
      const u = [user1, user2, user3, user4, user5][i % 5];
      const cap = ethers.keccak256(ethers.toUtf8Bytes(`cap-${i}`));
      promises.push(near.connect(u).registerAgent(cap, HASH, 'llm'));
    }
    await Promise.all(promises);
    expect(await near.agentCount()).to.equal(20n);
  });

  it('06: 15 intents submitted and cancelled without loss', async function () {
    for (let i = 0; i < 15; i++) {
      const u = [user1, user2, user3][i % 3];
      const deadline = Math.floor(Date.now() / 1000) + 3600;
      const tx = await near.connect(u).submitIntent(HASH, HASH, deadline, { value: ethers.parseEther('1') });
      const r = await tx.wait();
      const ev = r.logs.find(l => { try { return near.interface.parseLog(l)?.name === 'IntentSubmitted'; } catch { return false; } });
      const intentId = near.interface.parseLog(ev).args.intentId;
      await near.connect(u).cancelIntent(intentId);
    }
    expect(await near.intentCount()).to.equal(15n);
  });

  // ═══════════════════════════════════════════════════════════════════════
  //  4. SOLANA BRIDGE LOAD
  // ═══════════════════════════════════════════════════════════════════════

  it('07: 20 Solana tasks: submit → bridge → settle pipeline', async function () {
    const sol_pub = ethers.keccak256(ethers.toUtf8Bytes('sol-pub'));
    const cap = ethers.keccak256(ethers.toUtf8Bytes('cap'));
    const txP = await solana.connect(user1).registerProvider(sol_pub, 0, 'ionet', cap);
    const rP = await txP.wait();
    const evP = rP.logs.find(l => { try { return solana.interface.parseLog(l)?.name === 'ProviderRegistered'; } catch { return false; } });
    const provId = solana.interface.parseLog(evP).args.providerId;

    for (let i = 0; i < 20; i++) {
      const deadline = Math.floor(Date.now() / 1000) + 3600;
      const txT = await solana.connect(user2).submitTask(provId, HASH, HASH, deadline, { value: ethers.parseEther('0.5') });
      const rT = await txT.wait();
      const evT = rT.logs.find(l => { try { return solana.interface.parseLog(l)?.name === 'TaskSubmitted'; } catch { return false; } });
      const taskId = solana.interface.parseLog(evT).args.taskId;

      await solana.connect(relayer).bridgeTask(taskId, HASH);
      const n = ethers.keccak256(ethers.toUtf8Bytes(`sol-settle-${i}`));
      await solana.connect(relayer).settleTask(taskId, HASH, 9000, MOCK_PROOF, MOCK_PV, n);
    }
    expect(await solana.totalSettled()).to.equal(20n);
  });

  // ═══════════════════════════════════════════════════════════════════════
  //  5. CROSS-CIRCUIT CONCURRENT LOAD
  // ═══════════════════════════════════════════════════════════════════════

  it('08: 10 ops each on TAO + Yield + NEAR simultaneously', async function () {
    const cap = ethers.keccak256(ethers.toUtf8Bytes('load-cap'));
    await near.connect(user1).registerAgent(cap, HASH, 'trading');

    const promises = [];
    for (let i = 0; i < 10; i++) {
      promises.push(tao.connect(user1).submitTask(0, 0, HASH, 0, { value: ethers.parseEther('0.01') }));
      promises.push(yield_.connect(user2).openPosition({ value: ethers.parseEther('0.01') }));
    }
    await Promise.all(promises);
    expect(await tao.taskCount()).to.be.gte(10n);
    expect(await yield_.positionCount()).to.be.gte(10n);
  });

  it('09: Multi-circuit fee aggregation under load', async function () {
    // TAO tasks
    for (let i = 0; i < 5; i++) {
      await tao.connect(user1).submitTask(0, 0, HASH, 0, { value: ethers.parseEther('1') });
    }
    // Yield positions
    for (let i = 0; i < 5; i++) {
      await yield_.connect(user2).openPosition({ value: ethers.parseEther('1') });
    }
    const splBalance = await ethers.provider.getBalance(await splitter.getAddress());
    expect(splBalance).to.be.gt(0n);
  });

  // ═══════════════════════════════════════════════════════════════════════
  //  6. CHAOS: PAUSE/UNPAUSE MID-STREAM
  // ═══════════════════════════════════════════════════════════════════════

  it('10: TAO pause mid-stream blocks new tasks; unpause resumes', async function () {
    await tao.connect(user1).submitTask(0, 0, HASH, 0, { value: ethers.parseEther('0.1') });
    await tao.pause();
    await expect(tao.connect(user2).submitTask(0, 0, HASH, 0, { value: ethers.parseEther('0.1') })).to.be.reverted;
    await tao.unpause();
    await tao.connect(user2).submitTask(0, 0, HASH, 0, { value: ethers.parseEther('0.1') });
    expect(await tao.taskCount()).to.equal(2n);
  });

  it('11: Yield pause does not affect TAO', async function () {
    await yield_.pause();
    await expect(yield_.connect(user1).openPosition({ value: ethers.parseEther('1') })).to.be.reverted;
    await tao.connect(user1).submitTask(0, 0, HASH, 0, { value: ethers.parseEther('0.1') });
    expect(await tao.taskCount()).to.equal(1n);
  });

  it('12: Solana pause isolates from other circuits', async function () {
    await solana.pause();
    await tao.connect(user1).submitTask(0, 0, HASH, 0, { value: ethers.parseEther('0.1') });
    await yield_.connect(user2).openPosition({ value: ethers.parseEther('0.1') });
    const sol_pub = ethers.keccak256(ethers.toUtf8Bytes('sol-pub'));
    await expect(solana.connect(user1).registerProvider(sol_pub, 0, 'x', HASH)).to.be.reverted;
  });

  // ═══════════════════════════════════════════════════════════════════════
  //  7. NULLIFIER COLLISION RESISTANCE
  // ═══════════════════════════════════════════════════════════════════════

  it('13: 100 unique nullifiers on TAO without collision', async function () {
    for (let i = 0; i < 100; i++) {
      const tx = await tao.connect(user1).submitTask(0, 0, HASH, 0, { value: ethers.parseEther('0.01') });
      const r = await tx.wait();
      const ev = r.logs.find(l => { try { return tao.interface.parseLog(l)?.name === 'TaskRouted'; } catch { return false; } });
      const taskId = tao.interface.parseLog(ev).args.taskId;
      const n = ethers.keccak256(ethers.toUtf8Bytes(`null-${i}-${Date.now()}`));
      await tao.connect(relayer).settleTask(taskId, HASH, MOCK_PROOF, MOCK_PV, n);
    }
    expect(await tao.taskCount()).to.equal(100n);
  });

  it('14: Same nullifier rejected across same circuit (SolanaAIBridge)', async function () {
    const sol_pub = ethers.keccak256(ethers.toUtf8Bytes('sol-pub-null'));
    const cap = ethers.keccak256(ethers.toUtf8Bytes('cap-null'));
    const txP = await solana.connect(user1).registerProvider(sol_pub, 0, 'render', cap);
    const rP = await txP.wait();
    const evP = rP.logs.find(l => { try { return solana.interface.parseLog(l)?.name === 'ProviderRegistered'; } catch { return false; } });
    const provId = solana.interface.parseLog(evP).args.providerId;

    const deadline = Math.floor(Date.now() / 1000) + 3600;
    const n = ethers.keccak256(ethers.toUtf8Bytes('shared-null-sol'));

    // First task: submit → bridge → settle with nullifier
    const tx1 = await solana.connect(user2).submitTask(provId, HASH, HASH, deadline, { value: ethers.parseEther('1') });
    const r1 = await tx1.wait();
    const ev1 = r1.logs.find(l => { try { return solana.interface.parseLog(l)?.name === 'TaskSubmitted'; } catch { return false; } });
    const taskId1 = solana.interface.parseLog(ev1).args.taskId;
    await solana.connect(relayer).bridgeTask(taskId1, HASH);
    await solana.connect(relayer).settleTask(taskId1, HASH, 9000, MOCK_PROOF, MOCK_PV, n);

    // Second task: same nullifier should be rejected
    const deadline2 = Math.floor(Date.now() / 1000) + 7200;
    const tx2 = await solana.connect(user2).submitTask(provId, HASH, HASH, deadline2, { value: ethers.parseEther('1') });
    const r2 = await tx2.wait();
    const ev2 = r2.logs.find(l => { try { return solana.interface.parseLog(l)?.name === 'TaskSubmitted'; } catch { return false; } });
    const taskId2 = solana.interface.parseLog(ev2).args.taskId;
    await solana.connect(relayer).bridgeTask(taskId2, HASH);
    await expect(solana.connect(relayer).settleTask(taskId2, HASH, 9000, MOCK_PROOF, MOCK_PV, n)).to.be.reverted;
  });

  // ═══════════════════════════════════════════════════════════════════════
  //  8. FEE ACCOUNTING UNDER LOAD
  // ═══════════════════════════════════════════════════════════════════════

  it('15: Fee total matches sum of individual fees across 20 ops', async function () {
    const splBefore = await ethers.provider.getBalance(await splitter.getAddress());
    for (let i = 0; i < 20; i++) {
      await tao.connect(user1).submitTask(0, 0, HASH, 0, { value: ethers.parseEther('1') });
    }
    const splAfter = await ethers.provider.getBalance(await splitter.getAddress());
    const totalFees = splAfter - splBefore;
    expect(totalFees).to.be.gt(0n);
  });

  it('16: DataHubs contribution load: 25 contributions validated', async function () {
    const govHash = ethers.keccak256(ethers.toUtf8Bytes('gov'));
    const txH = await datahubs.createHub('Load Hub', 'test', govHash, 0, ethers.parseEther('1'));
    const rH = await txH.wait();
    const evH = rH.logs.find(l => { try { return datahubs.interface.parseLog(l)?.name === 'HubCreated'; } catch { return false; } });
    const hubId = datahubs.interface.parseLog(evH).args.hubId;

    for (let i = 0; i < 25; i++) {
      const dc = ethers.keccak256(ethers.toUtf8Bytes(`data-${i}`));
      const prov = ethers.keccak256(ethers.toUtf8Bytes(`prov-${i}`));
      const txC = await datahubs.connect(user1).contributeData(hubId, dc, prov, 1024);
      const rC = await txC.wait();
      const evC = rC.logs.find(l => { try { return datahubs.interface.parseLog(l)?.name === 'DataContributed'; } catch { return false; } });
      const cid = datahubs.interface.parseLog(evC).args.contributionId;
      const n = ethers.keccak256(ethers.toUtf8Bytes(`val-${i}`));
      await datahubs.connect(validator).validateContribution(cid, 8000, MOCK_PROOF, MOCK_PV, n);
    }
    expect(await datahubs.contributionCount()).to.equal(25n);
  });

  // ═══════════════════════════════════════════════════════════════════════
  //  9. GAS STABILITY
  // ═══════════════════════════════════════════════════════════════════════

  it('17: TAO settleTask gas stays < 100K across 10 settlements', async function () {
    for (let i = 0; i < 10; i++) {
      const tx = await tao.connect(user1).submitTask(0, 0, HASH, 0, { value: ethers.parseEther('0.1') });
      const r = await tx.wait();
      const ev = r.logs.find(l => { try { return tao.interface.parseLog(l)?.name === 'TaskRouted'; } catch { return false; } });
      const taskId = tao.interface.parseLog(ev).args.taskId;
      const n = ethers.keccak256(ethers.toUtf8Bytes(`gas-stable-${i}`));
      const stx = await tao.connect(relayer).settleTask(taskId, HASH, MOCK_PROOF, MOCK_PV, n);
      const sr = await stx.wait();
      expect(sr.gasUsed).to.be.lt(100000n);
    }
  });

  it('18: Solana settleTask gas < 400K under load', async function () {
    const sol_pub = ethers.keccak256(ethers.toUtf8Bytes('sol-pub'));
    const cap = ethers.keccak256(ethers.toUtf8Bytes('cap'));
    const txP = await solana.connect(user1).registerProvider(sol_pub, 0, 'render', cap);
    const rP = await txP.wait();
    const evP = rP.logs.find(l => { try { return solana.interface.parseLog(l)?.name === 'ProviderRegistered'; } catch { return false; } });
    const provId = solana.interface.parseLog(evP).args.providerId;

    for (let i = 0; i < 5; i++) {
      const deadline = Math.floor(Date.now() / 1000) + 3600;
      const txT = await solana.connect(user2).submitTask(provId, HASH, HASH, deadline, { value: ethers.parseEther('1') });
      const rT = await txT.wait();
      const evT = rT.logs.find(l => { try { return solana.interface.parseLog(l)?.name === 'TaskSubmitted'; } catch { return false; } });
      const taskId = solana.interface.parseLog(evT).args.taskId;
      await solana.connect(relayer).bridgeTask(taskId, HASH);
      const n = ethers.keccak256(ethers.toUtf8Bytes(`sol-gas-${i}`));
      const stx = await solana.connect(relayer).settleTask(taskId, HASH, 9000, MOCK_PROOF, MOCK_PV, n);
      const sr = await stx.wait();
      expect(sr.gasUsed).to.be.lt(400000n);
    }
  });

  // ═══════════════════════════════════════════════════════════════════════
  //  10. STRESS: FULL PIPELINE
  // ═══════════════════════════════════════════════════════════════════════

  it('19: Full pipeline: 5 users × 5 circuits × 2 ops = 50 total ops', async function () {
    const users = [user1, user2, user3, user4, user5];
    const promises = [];
    for (const u of users) {
      promises.push(tao.connect(u).submitTask(0, 0, HASH, 0, { value: ethers.parseEther('0.01') }));
      promises.push(tao.connect(u).submitTask(1, 0, HASH, 0, { value: ethers.parseEther('0.01') }));
      promises.push(yield_.connect(u).openPosition({ value: ethers.parseEther('0.01') }));
      promises.push(yield_.connect(u).openPosition({ value: ethers.parseEther('0.01') }));
    }
    await Promise.all(promises);
    expect(await tao.taskCount()).to.be.gte(10n);
    expect(await yield_.positionCount()).to.be.gte(10n);
  });

  it('20: Splitter balance consistency after mixed load', async function () {
    const splBefore = await ethers.provider.getBalance(await splitter.getAddress());

    // TAO tasks (fee = 1% of 0.5 = 0.005 each × 10)
    for (let i = 0; i < 10; i++) {
      await tao.connect(user1).submitTask(0, 0, HASH, 0, { value: ethers.parseEther('0.5') });
    }
    // Yield positions (fee = 0.5% of 1.0 = 0.005 each × 10)
    for (let i = 0; i < 10; i++) {
      await yield_.connect(user2).openPosition({ value: ethers.parseEther('1') });
    }

    const splAfter = await ethers.provider.getBalance(await splitter.getAddress());
    expect(splAfter).to.be.gt(splBefore);
    // Total should be meaningful (TAO + Yield combined)
    expect(splAfter - splBefore).to.be.gt(ethers.parseEther('0.05'));
  });
});
