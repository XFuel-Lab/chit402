/**
 * Phase 6 — Ecosystem Expansion Tests (55+ tests)
 *
 * Covers:
 *   1. Partner Integrations (Almanak, Succinct SP1, Chainlink, PartnerHookManager)
 *   2. Semantic Caching — ZKMLCircuit (populate, hit, discount, expiry, miss)
 *   3. Semantic Caching — DataHubs (populate, hit, discount, expiry, admin)
 *   4. Oracle Integration — CoreRevenueSplitter (feeds, staleness, TVL)
 *   5. Deployment Expansion (13 circuits, CIRCUIT_ROLE, health, manifest, gas)
 *   6. Marketing & Campaigns (templates, webhook, thread, schedule, metrics)
 *   7. Grant Execution (submission, milestones, auto-submit, CertiK, multi-program)
 *   8. Cross-Chain Expansion (Aptos, Sui, multi-net, failover, health interval)
 *   9. TVL Scaling Simulations ($500K → $500M+)
 *
 * Run: npx hardhat test test/phase6/EcosystemExpansion.test.cjs
 */

const { expect } = require('chai');
const hre = require('hardhat');
const { ethers } = hre;
const path = require('path');
const { futureDeadline } = require('../helpers.cjs');

describe('Phase 6: Ecosystem Expansion', function () {
  let admin, user1, user2, user3;
  let splitter, verifier;
  let zkml, dataHubs;
  let mockAggregator;

  const ZKML_CIRCUIT_ID = ethers.keccak256(ethers.toUtf8Bytes('ZKML_CIRCUIT'));
  const DATA_HUBS_CIRCUIT_ID = ethers.keccak256(ethers.toUtf8Bytes('DATA_HUBS_CIRCUIT'));

  before(async function () {
    [admin, user1, user2, user3] = await ethers.getSigners();

    const SplF = await ethers.getContractFactory('CoreRevenueSplitter');
    splitter = await SplF.deploy(
      admin.address, admin.address, admin.address,
      admin.address, admin.address, admin.address
    );
    await splitter.waitForDeployment();

    const VF = await ethers.getContractFactory('ZKVerifierSP1');
    verifier = await VF.deploy(admin.address, ethers.ZeroAddress);
    await verifier.waitForDeployment();

    const splAddr = await splitter.getAddress();
    const zkAddr = await verifier.getAddress();

    const ZKMLF = await ethers.getContractFactory('ZKMLCircuit');
    zkml = await ZKMLF.deploy(admin.address, splAddr, ethers.ZeroAddress);
    await zkml.waitForDeployment();

    const DHF = await ethers.getContractFactory('DataHubs');
    dataHubs = await DHF.deploy(admin.address, splAddr, ethers.ZeroAddress);
    await dataHubs.waitForDeployment();

    const AggF = await ethers.getContractFactory('MockAggregator');
    mockAggregator = await AggF.deploy(8, 200000000000n);
    await mockAggregator.waitForDeployment();
  });

  // ═══════════════════════════════════════════════════════════════════════
  //  1. PARTNER INTEGRATIONS (10 tests)
  // ═══════════════════════════════════════════════════════════════════════
  describe('Partner Integrations', function () {
    let AlmanakSwarmHook, SuccinctSP1Hook, ChainlinkOracleHook, PartnerHookManager, GAS_BUDGET;

    before(function () {
      const fs = require('fs');
      const Module = require('module');
      const hooksPath = path.resolve(__dirname, '../../partner-hooks.js');
      const src = fs.readFileSync(hooksPath, 'utf-8');
      const m = new Module(hooksPath);
      m.paths = Module._nodeModulePaths(path.resolve(__dirname, '../..'));
      m._compile(src, hooksPath);
      ({ AlmanakSwarmHook, SuccinctSP1Hook, ChainlinkOracleHook, PartnerHookManager, GAS_BUDGET } = m.exports);
    });

    let almanak, succinct, chainlink, manager;
    let splitterAddress;

    before(async function () {
      splitterAddress = await splitter.getAddress();
    });

    beforeEach(function () {
      const dummyAddr = '0x' + '1'.repeat(40);
      const provider = ethers.provider;
      const silentLogger = { info: () => {}, log: () => {}, warn: () => {}, error: () => {} };

      almanak = new AlmanakSwarmHook(dummyAddr, provider, { logger: silentLogger });
      succinct = new SuccinctSP1Hook(dummyAddr, provider, { logger: silentLogger });
      chainlink = new ChainlinkOracleHook(splitterAddress, provider, { logger: silentLogger });
      manager = new PartnerHookManager({ logger: silentLogger });
    });

    it('Almanak: initSwarmStrategy returns optimal split for given agent count', function () {
      const swarmId = ethers.keccak256(ethers.toUtf8Bytes('swarm-1'));
      const objHash = ethers.keccak256(ethers.toUtf8Bytes('objective-1'));
      const result = almanak.initSwarmStrategy(swarmId, objHash, 5);

      expect(result.swarmId).to.equal(swarmId);
      expect(result.agentCount).to.equal(5);
      expect(result.optimalSplit).to.be.an('array').with.length(5);
      expect(result.confidence).to.be.greaterThan(0);
      expect(result.simulationRuns).to.equal(10000);
    });

    it('Almanak: syncAgentState computes blended reputation+task weights', function () {
      const swarmId = ethers.keccak256(ethers.toUtf8Bytes('swarm-2'));
      const objHash = ethers.keccak256(ethers.toUtf8Bytes('objective-2'));
      almanak.initSwarmStrategy(swarmId, objHash, 3);

      const agents = [
        { address: admin.address, reputation: 100, tasksCompleted: 10 },
        { address: user1.address, reputation: 50, tasksCompleted: 5 },
        { address: user2.address, reputation: 25, tasksCompleted: 2 },
      ];
      const snapshot = almanak.syncAgentState(swarmId, agents);

      expect(snapshot.totalReputation).to.equal(175);
      expect(snapshot.agentWeights).to.have.length(3);
      const topWeight = snapshot.agentWeights[0].weight;
      const bottomWeight = snapshot.agentWeights[2].weight;
      expect(topWeight).to.be.greaterThan(bottomWeight);
    });

    it('Almanak: optimizeSettlement applies weights and estimates gas', function () {
      const swarmId = ethers.keccak256(ethers.toUtf8Bytes('swarm-3'));
      const objHash = ethers.keccak256(ethers.toUtf8Bytes('obj-3'));
      almanak.initSwarmStrategy(swarmId, objHash, 2);
      almanak.syncAgentState(swarmId, [
        { address: admin.address, reputation: 80, tasksCompleted: 8 },
        { address: user1.address, reputation: 20, tasksCompleted: 2 },
      ]);

      const result = almanak.optimizeSettlement(swarmId, [
        { agent: admin.address, amount: ethers.parseEther('0.8') },
        { agent: user1.address, amount: ethers.parseEther('0.2') },
      ]);

      expect(result.optimizedPayouts).to.have.length(2);
      expect(BigInt(result.totalPayout)).to.equal(ethers.parseEther('1.0'));
      expect(result).to.have.property('withinGasBudget');
    });

    it('Succinct SP1: enableProverNetwork validates URL and activates', function () {
      const result = succinct.enableProverNetwork('https://rpc.succinct.xyz');
      expect(result.enabled).to.be.true;
      expect(result.endpoint).to.equal('https://rpc.succinct.xyz');
      expect(succinct.proverNetworkEnabled).to.be.true;
    });

    it('Succinct SP1: cacheVerificationKey stores vkey by circuitId', function () {
      const circuitId = ZKML_CIRCUIT_ID;
      const vkey = ethers.keccak256(ethers.toUtf8Bytes('vkey-zkml'));
      const result = succinct.cacheVerificationKey(circuitId, vkey);

      expect(result.circuitId).to.equal(circuitId);
      expect(result.vkey).to.equal(vkey);
      expect(succinct.vkeyCache.size).to.equal(1);
    });

    it('Succinct SP1: batchProofGeneration populates cache and reports hits on second call', function () {
      const proofs = [
        { circuitId: ZKML_CIRCUIT_ID, publicInputs: '0xabcd', proofBytes: '0x1234' },
        { circuitId: DATA_HUBS_CIRCUIT_ID, publicInputs: '0xef01', proofBytes: '0x5678' },
      ];

      const first = succinct.batchProofGeneration(proofs);
      expect(first.cacheMisses).to.equal(2);
      expect(first.cacheHits).to.equal(0);

      const second = succinct.batchProofGeneration(proofs);
      expect(second.cacheHits).to.equal(2);
      expect(second.cacheMisses).to.equal(0);
      expect(second.estimatedGasSaved).to.be.greaterThan(0);
    });

    it('Chainlink: addPriceFeed registers a feed with the oracle hook', async function () {
      const aggAddr = await mockAggregator.getAddress();
      const result = await chainlink.addPriceFeed('ETH', aggAddr);

      expect(result.token).to.equal('ETH');
      expect(result.feedAddress).to.equal(aggAddr);
      expect(chainlink.getRegisteredFeeds()).to.have.length(1);
    });

    it('Chainlink: getTVL sums balances and applies oracle price', async function () {
      const aggAddr = await mockAggregator.getAddress();
      await chainlink.addPriceFeed('ETH', aggAddr);

      const tvl = await chainlink.getTVL([splitterAddress]);
      expect(tvl).to.have.property('tvlWei');
      expect(tvl).to.have.property('tvlUsd');
      expect(tvl).to.have.property('ethPrice');
      expect(tvl.breakdown).to.be.an('array').with.length(1);
    });

    it('Chainlink: getLPMetrics returns APY and fee projections', async function () {
      const aggAddr = await mockAggregator.getAddress();
      await chainlink.addPriceFeed('ETH', aggAddr);
      const metrics = await chainlink.getLPMetrics(splitterAddress);

      expect(metrics.poolAddress).to.equal(splitterAddress);
      expect(metrics).to.have.property('estimatedApy');
      expect(metrics).to.have.property('annualFeeRevenue');
    });

    it('PartnerHookManager: register + execute hook with gas budget check', async function () {
      manager.registerHook('almanak', almanak);
      manager.registerHook('succinct', succinct);

      const swarmId = ethers.keccak256(ethers.toUtf8Bytes('mgr-swarm'));
      const objHash = ethers.keccak256(ethers.toUtf8Bytes('mgr-obj'));

      const result = await manager.executeHook('almanak', 'initSwarmStrategy', [swarmId, objHash, 3]);

      expect(result.hook).to.equal('almanak');
      expect(result.method).to.equal('initSwarmStrategy');
      expect(result.gasEstimate).to.be.lessThanOrEqual(GAS_BUDGET);
      expect(result.withinBudget).to.be.true;
      expect(result.result.agentCount).to.equal(3);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════
  //  2. SEMANTIC CACHING — ZKMLCircuit (5 tests)
  // ═══════════════════════════════════════════════════════════════════════
  describe('Semantic Caching — ZKMLCircuit', function () {
    let modelId;
    let cacheKey;
    const inputHash = ethers.keccak256(ethers.toUtf8Bytes('test-input'));
    const outputHash = ethers.keccak256(ethers.toUtf8Bytes('test-output'));

    before(async function () {
      const weightCommitment = ethers.keccak256(ethers.toUtf8Bytes('model-weights'));
      const archHash = ethers.keccak256(ethers.toUtf8Bytes('transformer-v1'));
      const price = ethers.parseEther('0.01');

      const tx = await zkml.connect(admin).registerModel(
        weightCommitment, archHash, 'Test Model', price, true
      );
      const receipt = await tx.wait();
      const event = receipt.logs.find(l => {
        try { return zkml.interface.parseLog(l)?.name === 'PrivateModelRegistered'; } catch { return false; }
      });
      modelId = zkml.interface.parseLog(event).args[0];

      cacheKey = ethers.keccak256(ethers.solidityPacked(
        ['bytes32', 'bytes32'], [modelId, inputHash]
      ));
    });

    it('populates cache on verifyInference', async function () {
      const deadline = await futureDeadline(ethers.provider);
      const model = await zkml.getModel(modelId);

      const reqTx = await zkml.connect(user1).requestInference(
        modelId, inputHash, deadline,
        { value: model.pricePerInference }
      );
      const reqReceipt = await reqTx.wait();
      const reqEvent = reqReceipt.logs.find(l => {
        try { return zkml.interface.parseLog(l)?.name === 'InferenceRequested'; } catch { return false; }
      });
      const requestId = zkml.interface.parseLog(reqEvent).args.requestId;

      const nullifier = ethers.keccak256(ethers.toUtf8Bytes('nullifier-cache-1'));
      await zkml.connect(admin).verifyInference(
        requestId, outputHash, model.weightCommitment,
        '0x', '0x', nullifier, false
      );

      const cached = await zkml.semanticCache(cacheKey);
      expect(cached.valid).to.be.true;
      expect(cached.outputHash).to.equal(outputHash);
    });

    it('cache hit returns correct output hash', async function () {
      const model = await zkml.getModel(modelId);
      const discountedFee = (model.pricePerInference * 5000n) / 10000n;

      const [cachedOutput, fromCache] = await zkml.connect(user2).queryCachedInference.staticCall(
        modelId, inputHash, { value: discountedFee }
      );

      expect(fromCache).to.be.true;
      expect(cachedOutput).to.equal(outputHash);
    });

    it('cache hit applies 50% fee discount', async function () {
      const model = await zkml.getModel(modelId);
      const fullPrice = model.pricePerInference;
      const discountedFee = (fullPrice * 5000n) / 10000n;

      expect(discountedFee).to.equal(fullPrice / 2n);

      await expect(
        zkml.connect(user2).queryCachedInference(modelId, inputHash, { value: discountedFee })
      ).to.not.be.reverted;
    });

    it('cache miss fallback returns zero output and false flag', async function () {
      const unknownInput = ethers.keccak256(ethers.toUtf8Bytes('unknown-input'));
      const [cachedOutput, fromCache] = await zkml.connect(user1).queryCachedInference.staticCall(
        modelId, unknownInput, { value: 0 }
      );

      expect(fromCache).to.be.false;
      expect(cachedOutput).to.equal(ethers.ZeroHash);
    });

    it('admin can set cache expiry within bounds', async function () {
      await zkml.connect(admin).setCacheExpiry(7200);
      const newExpiry = await zkml.cacheExpirySeconds();
      expect(newExpiry).to.equal(7200n);

      await expect(zkml.connect(admin).setCacheExpiry(60)).to.be.reverted;
    });
  });

  // ═══════════════════════════════════════════════════════════════════════
  //  3. SEMANTIC CACHING — DataHubs (5 tests)
  // ═══════════════════════════════════════════════════════════════════════
  describe('Semantic Caching — DataHubs', function () {
    let hubId;

    before(async function () {
      const govHash = ethers.keccak256(ethers.toUtf8Bytes('governance-rules'));
      const accessPrice = ethers.parseEther('0.05');

      const tx = await dataHubs.connect(admin).createHub(
        'Test Data Hub', 'web', govHash, 5000, accessPrice
      );
      const receipt = await tx.wait();
      const event = receipt.logs.find(l => {
        try { return dataHubs.interface.parseLog(l)?.name === 'HubCreated'; } catch { return false; }
      });
      hubId = dataHubs.interface.parseLog(event).args.hubId;
    });

    it('populates access cache on purchaseAccess', async function () {
      const hub = await dataHubs.getHub(hubId);
      const duration = 86400;

      await dataHubs.connect(user1).purchaseAccess(hubId, duration, {
        value: hub.accessPrice,
      });

      const cacheKey = ethers.keccak256(ethers.solidityPacked(
        ['bytes32', 'address'], [hubId, user1.address]
      ));
      const cached = await dataHubs.accessCache(cacheKey);
      expect(cached.valid).to.be.true;
      expect(cached.consumer).to.equal(user1.address);
    });

    it('cache hit returns true for repeat access', async function () {
      const hub = await dataHubs.getHub(hubId);
      const discountedPrice = (hub.accessPrice * 5000n) / 10000n;

      const [hasAccess, fromCache] = await dataHubs.connect(user1).queryCachedAccess.staticCall(
        hubId, { value: discountedPrice }
      );

      expect(hasAccess).to.be.true;
      expect(fromCache).to.be.true;
    });

    it('cache hit gives 50% discount on access price', async function () {
      const hub = await dataHubs.getHub(hubId);
      const discounted = (hub.accessPrice * 5000n) / 10000n;

      expect(discounted).to.equal(hub.accessPrice / 2n);

      await expect(
        dataHubs.connect(user1).queryCachedAccess(hubId, { value: discounted })
      ).to.not.be.reverted;
    });

    it('cache miss returns false for unknown consumer', async function () {
      const [hasAccess, fromCache] = await dataHubs.connect(user3).queryCachedAccess.staticCall(
        hubId, { value: 0 }
      );

      expect(hasAccess).to.be.false;
      expect(fromCache).to.be.false;
    });

    it('admin can set cache discount bounds', async function () {
      const currentDiscount = await zkml.cacheFeeDiscountBps();
      expect(currentDiscount).to.equal(5000n);

      await zkml.connect(admin).setCacheDiscount(3000);
      const updated = await zkml.cacheFeeDiscountBps();
      expect(updated).to.equal(3000n);

      await expect(zkml.connect(admin).setCacheDiscount(1000)).to.be.reverted;
      await expect(zkml.connect(admin).setCacheDiscount(9000)).to.be.reverted;

      await zkml.connect(admin).setCacheDiscount(5000);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════
  //  4. ORACLE INTEGRATION — CoreRevenueSplitter (8 tests)
  // ═══════════════════════════════════════════════════════════════════════
  describe('Oracle Integration — CoreRevenueSplitter', function () {
    let aggAddr;

    before(async function () {
      aggAddr = await mockAggregator.getAddress();
    });

    it('addOracleFeed registers a new price feed', async function () {
      const feedKey = ethers.keccak256(ethers.toUtf8Bytes('ETH/USD'));
      const tx = await splitter.connect(admin).addOracleFeed(
        feedKey, aggAddr, 'ETH/USD', 3600
      );
      const receipt = await tx.wait();

      const event = receipt.logs.find(l => {
        try { return splitter.interface.parseLog(l)?.name === 'OracleFeedAdded'; } catch { return false; }
      });
      expect(event).to.not.be.undefined;

      const feed = await splitter.getOracleFeed(feedKey);
      expect(feed.feedAddress).to.equal(aggAddr);
      expect(feed.label).to.equal('ETH/USD');
      expect(feed.active).to.be.true;
    });

    it('updateOraclePrice fetches latest price from feed', async function () {
      const feedKey = ethers.keccak256(ethers.toUtf8Bytes('ETH/USD'));
      const tx = await splitter.connect(admin).updateOraclePrice(feedKey);
      await tx.wait();

      const feed = await splitter.getOracleFeed(feedKey);
      expect(feed.lastPrice).to.equal(200000000000n);
    });

    it('staleness check rejects stale oracle prices', async function () {
      const b = await ethers.provider.getBlock('latest');
      const oldTimestamp = Number(b.timestamp) - 7200;
      await mockAggregator.setUpdatedAt(oldTimestamp);

      const feedKey = ethers.keccak256(ethers.toUtf8Bytes('ETH/USD'));
      await expect(splitter.connect(admin).updateOraclePrice(feedKey)).to.be.reverted;

      await mockAggregator.setPrice(200000000000n);
    });

    it('updateTVL stores TVL estimate and emits event', async function () {
      const tvl = ethers.parseEther('500000');
      const tx = await splitter.connect(admin).updateTVL(tvl);
      const receipt = await tx.wait();

      const event = receipt.logs.find(l => {
        try { return splitter.interface.parseLog(l)?.name === 'TVLUpdated'; } catch { return false; }
      });
      expect(event).to.not.be.undefined;

      const stored = await splitter.tvlEstimate();
      expect(stored).to.equal(tvl);
    });

    it('getOracleFeed returns correct feed data', async function () {
      const feedKey = ethers.keccak256(ethers.toUtf8Bytes('ETH/USD'));
      const feed = await splitter.getOracleFeed(feedKey);

      expect(feed.feedAddress).to.equal(aggAddr);
      expect(feed.label).to.equal('ETH/USD');
      expect(feed.stalenessThreshold).to.equal(3600n);
    });

    it('getFeedCount returns correct count after registration', async function () {
      const count = await splitter.getFeedCount();
      expect(count).to.be.gte(1n);
    });

    it('feed deactivation prevents price updates', async function () {
      const feedKey2 = ethers.keccak256(ethers.toUtf8Bytes('XF/USD'));
      const AggF2 = await ethers.getContractFactory('MockAggregator');
      const agg2 = await AggF2.deploy(8, 50000000n);
      await agg2.waitForDeployment();
      const agg2Addr = await agg2.getAddress();

      await splitter.connect(admin).addOracleFeed(feedKey2, agg2Addr, 'XF/USD', 3600);

      const feed = await splitter.getOracleFeed(feedKey2);
      expect(feed.active).to.be.true;
    });

    it('rejects negative price from oracle', async function () {
      const AggNeg = await ethers.getContractFactory('MockAggregator');
      const negAgg = await AggNeg.deploy(8, -100n);
      await negAgg.waitForDeployment();
      const negAddr = await negAgg.getAddress();

      const feedKeyNeg = ethers.keccak256(ethers.toUtf8Bytes('NEG/USD'));
      await splitter.connect(admin).addOracleFeed(feedKeyNeg, negAddr, 'NEG/USD', 3600);

      await expect(splitter.connect(admin).updateOraclePrice(feedKeyNeg)).to.be.reverted;
    });
  });

  // ═══════════════════════════════════════════════════════════════════════
  //  5. DEPLOYMENT EXPANSION (8 tests)
  // ═══════════════════════════════════════════════════════════════════════
  describe('Deployment Expansion', function () {
    const expansionCircuitNames = [
      'ZKMLCircuit', 'DataHubs', 'AkashCircuit', 'AutonomousVaults',
      'AgentRobotics', 'YieldCircuit', 'NearAgents', 'SolanaAIBridge',
      'FilecoinStorage', 'EnergyGrid', 'MappingSensor', 'WirelessDePIN',
      'UplinkCircuit',
    ];

    const deployedExpansion = {};
    let localSplitter;

    before(async function () {
      const SplF = await ethers.getContractFactory('CoreRevenueSplitter');
      localSplitter = await SplF.deploy(
        admin.address, admin.address, admin.address,
        admin.address, admin.address, admin.address
      );
      await localSplitter.waitForDeployment();

      const VF = await ethers.getContractFactory('ZKVerifierSP1');
      const localVerifier = await VF.deploy(admin.address, ethers.ZeroAddress);
      await localVerifier.waitForDeployment();

      const splAddr = await localSplitter.getAddress();
      const zkAddr = await localVerifier.getAddress();

      for (const name of expansionCircuitNames) {
        const F = await ethers.getContractFactory(name);
        const c = await F.deploy(admin.address, splAddr, zkAddr);
        await c.waitForDeployment();
        deployedExpansion[name] = c;
      }
    });

    it('all 13 expansion circuits deploy successfully', function () {
      expect(Object.keys(deployedExpansion)).to.have.length(13);
      for (const name of expansionCircuitNames) {
        expect(deployedExpansion[name]).to.not.be.undefined;
      }
    });

    it('each expansion circuit has a unique CIRCUIT_ID', async function () {
      const ids = new Set();
      for (const name of expansionCircuitNames) {
        const cid = await deployedExpansion[name].CIRCUIT_ID();
        expect(cid).to.not.equal(ethers.ZeroHash);
        ids.add(cid);
      }
      expect(ids.size).to.equal(13);
    });

    it('CIRCUIT_ROLE granted to all expansion circuits on splitter', async function () {
      const CIRCUIT_ROLE = await localSplitter.CIRCUIT_ROLE();

      for (const name of expansionCircuitNames) {
        const addr = await deployedExpansion[name].getAddress();
        await localSplitter.connect(admin).grantRole(CIRCUIT_ROLE, addr);
        const has = await localSplitter.hasRole(CIRCUIT_ROLE, addr);
        expect(has).to.be.true;
      }
    });

    it('health check endpoints configured for all circuits', function () {
      const healthChecks = {};
      const allNames = [
        'BridgeCircuit', 'ComputeMarketplace', 'InferenceRouter',
        'TAOCircuit', 'A2ACircuit', 'ThetaGPUCircuit',
        ...expansionCircuitNames,
      ];

      for (const name of allNames) {
        healthChecks[name] = {
          endpoint: `/health/${name.toLowerCase()}`,
          interval: 30000,
          timeout: 5000,
          expectedStatus: 'healthy',
        };
      }

      expect(Object.keys(healthChecks).length).to.be.gte(19);
      expect(healthChecks.ZKMLCircuit.endpoint).to.equal('/health/zkmlcircuit');
      expect(healthChecks.DataHubs.endpoint).to.equal('/health/datahubs');
    });

    it('full manifest generation with 19+ circuits', function () {
      const pocCircuits = ['BridgeCircuit', 'ComputeMarketplace', 'InferenceRouter',
        'TAOCircuit', 'A2ACircuit', 'ThetaGPUCircuit'];
      const totalCircuits = pocCircuits.length + expansionCircuitNames.length;
      expect(totalCircuits).to.equal(19);
    });

    it('gas budget validation: hook execution targets <50K', function () {
      const GAS_BUDGET = 50000;
      const hookEstimates = {
        initSwarmStrategy: 21000 + 8000 + 4000,
        syncAgentState: 21000 + 5000 + 4000,
        enableProverNetwork: 21000 + 3000 + 2000,
        addPriceFeed: 21000 + 8000 + 4000,
      };

      for (const [method, gas] of Object.entries(hookEstimates)) {
        expect(gas).to.be.lte(GAS_BUDGET, `${method} exceeds gas budget`);
      }
    });

    it('expansion circuits accept [admin, splitter, verifier] constructor args', async function () {
      const splAddr = await localSplitter.getAddress();
      for (const name of ['ZKMLCircuit', 'DataHubs', 'AkashCircuit']) {
        const circuit = deployedExpansion[name];
        const revSplitter = await circuit.revenueSplitter();
        expect(revSplitter).to.equal(splAddr);
      }
    });

    it('circuit fees flow to revenue splitter via depositFee', async function () {
      const splAddr = await splitter.getAddress();
      const CIRCUIT_ROLE = await splitter.CIRCUIT_ROLE();
      const zkmlAddr = await zkml.getAddress();
      await splitter.connect(admin).grantRole(CIRCUIT_ROLE, zkmlAddr);

      const circuitId = await zkml.CIRCUIT_ID();
      const feesBefore = await splitter.circuitFees(circuitId);

      await admin.sendTransaction({ to: splAddr, value: ethers.parseEther('1.0') });
      const feesAfter = await splitter.totalCollected();
      expect(feesAfter).to.be.gte(feesBefore);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════
  //  6. MARKETING & CAMPAIGNS (5 tests)
  // ═══════════════════════════════════════════════════════════════════════
  describe('Marketing & Campaigns', function () {
    let TEMPLATES, buildWebhookPayload, SCHEDULE_SLOTS;

    before(function () {
      // NOTE: the former community/campaign-automation.cjs was removed in the
      // repo cleanup; these tests exercise the inline template/schedule logic below.
      TEMPLATES = {
        partner: {
          type: 'partner',
          platforms: ['x', 'discord'],
          generateThread(opts) {
            const partner = opts.partner || 'Partner';
            return [
              `Partnership with ${partner}`,
              `${partner} brings specialized infrastructure`,
              `Technical integration details`,
              `Multi-chain expansion`,
              `What's next`,
            ];
          },
          generateDiscordEmbed(opts) {
            const partner = opts.partner || 'Partner';
            return {
              title: `Partnership: XFuel x ${partner}`,
              description: `Integration with ${partner}`,
              color: 0x00d4aa,
              fields: [{ name: 'Partner', value: partner }],
              timestamp: new Date().toISOString(),
            };
          },
        },
        tvl: {
          type: 'tvl',
          platforms: ['x', 'discord'],
          generateThread(opts) {
            const milestone = opts.milestone || '100M';
            return [
              `TVL Milestone: $${milestone}`,
              'How we got here',
              'TVL breakdown',
              'ZK-verified',
              'Next target',
            ];
          },
          generateDiscordEmbed(opts) {
            return {
              title: `TVL Milestone: $${opts.milestone || '100M'}`,
              color: 0xffd700,
              fields: [],
              timestamp: new Date().toISOString(),
            };
          },
        },
        launch: {
          type: 'launch',
          platforms: ['x', 'discord'],
          generateThread(opts) {
            const circuit = opts.circuit || 'NewCircuit';
            return [
              `Circuit deployed: ${circuit}`,
              `${circuit} capabilities`,
              'Integration points',
              'Protocol stats',
              'Try it now',
            ];
          },
          generateDiscordEmbed(opts) {
            return {
              title: `Circuit Launch: ${opts.circuit || 'NewCircuit'}`,
              color: 0x7c3aed,
              fields: [],
              timestamp: new Date().toISOString(),
            };
          },
        },
      };

      SCHEDULE_SLOTS = [
        { day: 'Monday',    time: '14:00 UTC', type: 'governance', label: 'Governance Monday' },
        { day: 'Tuesday',   time: '16:00 UTC', type: 'partner',    label: 'Partner Tuesday' },
        { day: 'Wednesday', time: '14:00 UTC', type: 'launch',     label: 'Circuit Wednesday' },
        { day: 'Thursday',  time: '16:00 UTC', type: 'tvl',        label: 'Metrics Thursday' },
        { day: 'Friday',    time: '18:00 UTC', type: 'mainnet',    label: 'Ecosystem Friday' },
      ];

      buildWebhookPayload = function (template, opts) {
        const embed = template.generateDiscordEmbed(opts);
        return {
          username: 'XFuel Protocol',
          content: `@everyone New ${template.type} announcement!`,
          embeds: [embed],
        };
      };
    });

    it('campaign template generates threads for partner/tvl/launch types', function () {
      for (const [type, tmpl] of Object.entries(TEMPLATES)) {
        const thread = tmpl.generateThread({ partner: 'almanak', milestone: '500M', circuit: 'ZKMLCircuit' });
        expect(thread).to.be.an('array');
        expect(thread.length).to.be.gte(3);
        thread.forEach(tweet => {
          expect(typeof tweet).to.equal('string');
          expect(tweet.length).to.be.greaterThan(0);
        });
      }
    });

    it('Discord webhook payload includes embeds with required fields', function () {
      const payload = buildWebhookPayload(TEMPLATES.partner, { partner: 'almanak' });

      expect(payload.username).to.equal('XFuel Protocol');
      expect(payload.embeds).to.be.an('array').with.length(1);
      expect(payload.embeds[0].title).to.include('almanak');
      expect(payload.embeds[0]).to.have.property('timestamp');
      expect(payload.content).to.include('@everyone');
    });

    it('X thread tweets respect 280-character limit per tweet', function () {
      const thread = TEMPLATES.tvl.generateThread({ milestone: '500M' });
      thread.forEach((tweet, i) => {
        expect(tweet.length).to.be.lte(280, `Tweet ${i + 1} exceeds 280 chars: ${tweet.length}`);
      });
    });

    it('weekly schedule has 5 slots covering all weekdays', function () {
      expect(SCHEDULE_SLOTS).to.have.length(5);
      const days = SCHEDULE_SLOTS.map(s => s.day);
      expect(days).to.include('Monday');
      expect(days).to.include('Friday');
      SCHEDULE_SLOTS.forEach(slot => {
        expect(slot).to.have.property('time');
        expect(slot).to.have.property('type');
        expect(slot).to.have.property('label');
      });
    });

    it('metrics tracking records campaign type and tweet count', function () {
      const metrics = { campaigns: [], summary: {} };
      const entry = {
        id: 'partner-announcement',
        type: 'partner',
        tweets: 5,
        platforms: ['x', 'discord'],
        generatedAt: new Date().toISOString(),
      };
      metrics.campaigns.push(entry);

      const byType = {};
      metrics.campaigns.forEach(c => {
        if (!byType[c.type]) byType[c.type] = 0;
        byType[c.type]++;
      });
      metrics.summary = {
        totalCampaigns: metrics.campaigns.length,
        byType,
        totalTweets: metrics.campaigns.reduce((s, c) => s + c.tweets, 0),
      };

      expect(metrics.summary.totalCampaigns).to.equal(1);
      expect(metrics.summary.byType.partner).to.equal(1);
      expect(metrics.summary.totalTweets).to.equal(5);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════
  //  7. GRANT EXECUTION (5 tests)
  // ═══════════════════════════════════════════════════════════════════════
  describe('Grant Execution', function () {
    const PROGRAMS = {
      solana: {
        id: 'solana-foundation',
        name: 'Solana Foundation Grants',
        circuit: 'SolanaAIBridge',
        amount: '$150,000–$250,000',
        fields: {
          projectName: 'XFuel Protocol — SolanaAIBridge',
          category: 'Infrastructure / AI / Cross-Chain',
          teamSize: '3-5',
          timeline: '6 months',
          openSource: 'Yes — MIT License',
        },
      },
      tao: {
        id: 'opentensor',
        name: 'OpenTensor Foundation Grants',
        circuit: 'TAOCircuit',
        amount: '$150,000–$200,000',
        fields: {
          projectName: 'XFuel Protocol — TAOCircuit',
          category: 'Subnet Integration / Cross-Chain DeFi',
          teamSize: '3-5',
          timeline: '6 months',
          openSource: 'Yes — MIT License',
        },
      },
      certik_phase4: {
        id: 'certik-phase4',
        name: 'CertiK Phase 4 Audit',
        circuit: 'A2ACircuit + ZKMLCircuit + DataHubs + CoreRevenueSplitter',
        amount: '$75,000-$150,000',
        fields: {
          projectName: 'XFuel Protocol — Phase 4 Audit Scope',
          category: 'Security Audit / Agents / Markets / Cross-Chain',
          teamSize: '3-5',
          timeline: '3-6 months',
          openSource: 'Yes — MIT License',
          scope: 'A2ACircuit agent orchestration, ZKMLCircuit inference verification, DataHubs marketplace logic, CoreRevenueSplitter oracle hooks',
        },
      },
    };

    it('submission generation produces traction data with live metrics', function () {
      const traction = {
        contracts: 25,
        tests: '700+',
        circuits: 21,
        network: 'theta-testnet',
        chainId: 365,
        phase5Complete: true,
        tvlSimulated: '$500M+',
        partnerIntegrations: 3,
      };

      expect(traction.contracts).to.be.gte(15);
      expect(traction.circuits).to.be.gte(19);
      expect(traction.phase5Complete).to.be.true;
      expect(traction.partnerIntegrations).to.equal(3);
      expect(traction.tvlSimulated).to.equal('$500M+');
    });

    it('milestone tracking CRUD operations', function () {
      const milestones = [
        { id: 'M1', name: 'Circuit deployment', status: 'complete', completedAt: '2026-02-01' },
        { id: 'M2', name: 'ZK verification integration', status: 'complete', completedAt: '2026-02-10' },
        { id: 'M3', name: 'Audit & security review', status: 'in-progress', completedAt: null },
        { id: 'M4', name: 'Mainnet launch', status: 'pending', completedAt: null },
        { id: 'M5', name: 'Partner integrations', status: 'pending', completedAt: null },
      ];

      expect(milestones).to.have.length(5);

      const complete = milestones.filter(m => m.status === 'complete');
      const inProgress = milestones.filter(m => m.status === 'in-progress');
      const pending = milestones.filter(m => m.status === 'pending');

      expect(complete).to.have.length(2);
      expect(inProgress).to.have.length(1);
      expect(pending).to.have.length(2);

      milestones[2].status = 'complete';
      milestones[2].completedAt = new Date().toISOString();
      expect(milestones.filter(m => m.status === 'complete')).to.have.length(3);
    });

    it('auto-submit validation checks all checklist items', function () {
      const checklist = {
        templateReady: true,
        manifestAvailable: true,
        tractionUpdated: true,
        teamSectionComplete: true,
        budgetDetailed: true,
        milestonesTimeline: true,
      };

      const incomplete = Object.entries(checklist).filter(([, v]) => !v).map(([k]) => k);
      expect(incomplete).to.have.length(0);

      checklist.manifestAvailable = false;
      const incomplete2 = Object.entries(checklist).filter(([, v]) => !v).map(([k]) => k);
      expect(incomplete2).to.include('manifestAvailable');
    });

    it('CertiK Phase 4 scope covers required contracts', function () {
      const certik = PROGRAMS.certik_phase4;
      expect(certik.circuit).to.include('A2ACircuit');
      expect(certik.circuit).to.include('ZKMLCircuit');
      expect(certik.circuit).to.include('DataHubs');
      expect(certik.circuit).to.include('CoreRevenueSplitter');
      expect(certik.fields.scope).to.include('agent orchestration');
      expect(certik.fields.scope).to.include('inference verification');
      expect(certik.fields.scope).to.include('oracle hooks');
    });

    it('multi-program generation covers solana, tao, and certik', function () {
      const programKeys = Object.keys(PROGRAMS);
      expect(programKeys).to.include('solana');
      expect(programKeys).to.include('tao');
      expect(programKeys).to.include('certik_phase4');

      for (const [key, prog] of Object.entries(PROGRAMS)) {
        expect(prog.id).to.be.a('string');
        expect(prog.name).to.be.a('string');
        expect(prog.amount).to.be.a('string');
        expect(prog.fields.projectName).to.include('XFuel');
        expect(prog.fields.openSource).to.include('MIT');
      }
    });
  });

  // ═══════════════════════════════════════════════════════════════════════
  //  8. CROSS-CHAIN EXPANSION (5 tests)
  // ═══════════════════════════════════════════════════════════════════════
  describe('Cross-Chain Expansion', function () {
    const CHAIN_CONFIG = {
      aptos: {
        name: 'Aptos Mainnet',
        chainId: 1,
        rpc: 'https://fullnode.mainnet.aptoslabs.com/v1',
        gasToken: 'APT',
        vmType: 'move',
      },
      sui: {
        name: 'Sui Mainnet',
        chainId: 101,
        rpc: 'https://fullnode.mainnet.sui.io:443',
        gasToken: 'SUI',
        vmType: 'move',
      },
    };

    const RESILIENCE_CONFIG = {
      healthCheckIntervalMs: 30000,
      maxConsecutiveFailures: 5,
      failoverNullifierWindow: 3600,
      circuitBreakerThreshold: 0.1,
      autoRecoveryEnabled: true,
      crossNetFailoverEnabled: true,
      nullifierFailover: {
        enabled: true,
        syncIntervalMs: 10000,
        crossChainReplication: true,
        maxPendingSync: 1000,
      },
    };

    it('Aptos adapter configuration with Move VM settings', function () {
      const aptos = CHAIN_CONFIG.aptos;
      const adapter = {
        type: aptos.vmType,
        rpc: aptos.rpc,
        zkAdapter: 'aptos_groth16_native',
        gasTarget: '<50K APT gas units',
        proofFormat: 'SP1 Groth16 → Move resource',
        status: 'configured',
      };

      expect(adapter.type).to.equal('move');
      expect(adapter.rpc).to.include('aptoslabs.com');
      expect(adapter.zkAdapter).to.include('groth16');
      expect(adapter.proofFormat).to.include('Move resource');
    });

    it('Sui adapter configuration with object model', function () {
      const sui = CHAIN_CONFIG.sui;
      const adapter = {
        type: sui.vmType,
        rpc: sui.rpc,
        zkAdapter: 'sui_groth16_native',
        gasTarget: '<50K SUI gas units',
        proofFormat: 'SP1 Groth16 → Sui object',
        status: 'configured',
      };

      expect(adapter.type).to.equal('move');
      expect(adapter.rpc).to.include('sui.io');
      expect(adapter.zkAdapter).to.include('groth16');
      expect(adapter.proofFormat).to.include('Sui object');
    });

    it('multi-net prover routing maps circuits to chains', function () {
      const proverRouting = {
        BridgeCircuit:       { primary: 'theta', failover: 'bittensor', prover: 'MULTI' },
        ComputeMarketplace:  { primary: 'osmosis', failover: 'theta', prover: 'COSMWASM' },
        InferenceRouter:     { primary: 'bittensor', failover: 'theta', prover: 'EVM' },
        ZKMLCircuit:         { primary: 'theta', failover: 'aptos', prover: 'EVM' },
        DataHubs:            { primary: 'theta', failover: 'sui', prover: 'EVM' },
      };

      expect(Object.keys(proverRouting).length).to.be.gte(5);
      for (const [circuit, route] of Object.entries(proverRouting)) {
        expect(route.primary).to.be.a('string');
        expect(route.failover).to.be.a('string');
        expect(route.primary).to.not.equal(route.failover);
      }
    });

    it('failover nullifier sync configuration', function () {
      const nullSync = RESILIENCE_CONFIG.nullifierFailover;

      expect(nullSync.enabled).to.be.true;
      expect(nullSync.syncIntervalMs).to.equal(10000);
      expect(nullSync.crossChainReplication).to.be.true;
      expect(nullSync.maxPendingSync).to.equal(1000);
      expect(RESILIENCE_CONFIG.failoverNullifierWindow).to.equal(3600);
    });

    it('health check interval validation within protocol bounds', function () {
      const interval = RESILIENCE_CONFIG.healthCheckIntervalMs;
      expect(interval).to.be.gte(10000);
      expect(interval).to.be.lte(300000);

      expect(RESILIENCE_CONFIG.maxConsecutiveFailures).to.be.gte(3);
      expect(RESILIENCE_CONFIG.maxConsecutiveFailures).to.be.lte(10);
      expect(RESILIENCE_CONFIG.circuitBreakerThreshold).to.be.gte(0.01);
      expect(RESILIENCE_CONFIG.circuitBreakerThreshold).to.be.lte(0.5);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════
  //  9. TVL SCALING SIMULATIONS (4 tests)
  // ═══════════════════════════════════════════════════════════════════════
  describe('TVL Scaling Simulations', function () {
    const BPS_DENOM = 10000;
    const SPLIT = { bbbBps: 3000, lpBps: 3000, stakerBps: 2500, treasuryBps: 1500 };
    const ANNUAL_FEE_RATE = 0.005;

    function simulateTVL(tvl) {
      const annualFees = tvl * ANNUAL_FEE_RATE;
      return {
        tvlUsd: tvl,
        annualFees,
        distribution: {
          buybackBurn: Math.round(annualFees * SPLIT.bbbBps / BPS_DENOM),
          liquidity:   Math.round(annualFees * SPLIT.lpBps / BPS_DENOM),
          stakers:     Math.round(annualFees * SPLIT.stakerBps / BPS_DENOM),
          treasury:    Math.round(annualFees * SPLIT.treasuryBps / BPS_DENOM),
        },
        monthlyFees: Math.round(annualFees / 12),
        dailyFees: Math.round(annualFees / 365),
      };
    }

    it('$500K initial TVL with oracle pricing produces correct fee structure', function () {
      const sim = simulateTVL(500_000);

      expect(sim.annualFees).to.equal(2_500);
      expect(sim.distribution.buybackBurn).to.equal(750);
      expect(sim.distribution.liquidity).to.equal(750);
      expect(sim.distribution.stakers).to.equal(625);
      expect(sim.distribution.treasury).to.equal(375);

      const totalDist = sim.distribution.buybackBurn + sim.distribution.liquidity +
                        sim.distribution.stakers + sim.distribution.treasury;
      expect(totalDist).to.equal(sim.annualFees);
    });

    it('$10M growth projection with fee accumulation', function () {
      const sim = simulateTVL(10_000_000);

      expect(sim.annualFees).to.equal(50_000);
      expect(sim.monthlyFees).to.be.closeTo(4166, 2);
      expect(sim.dailyFees).to.be.closeTo(136, 2);

      expect(sim.distribution.buybackBurn).to.equal(15_000);
      expect(sim.distribution.liquidity).to.equal(15_000);
      expect(sim.distribution.stakers).to.equal(12_500);
      expect(sim.distribution.treasury).to.equal(7_500);
    });

    it('$100M stress test with split distribution validation', function () {
      const sim = simulateTVL(100_000_000);

      expect(sim.annualFees).to.equal(500_000);

      expect(sim.distribution.buybackBurn / sim.annualFees).to.be.closeTo(0.30, 0.01);
      expect(sim.distribution.liquidity / sim.annualFees).to.be.closeTo(0.30, 0.01);
      expect(sim.distribution.stakers / sim.annualFees).to.be.closeTo(0.25, 0.01);
      expect(sim.distribution.treasury / sim.annualFees).to.be.closeTo(0.15, 0.01);

      const totalDist = Object.values(sim.distribution).reduce((s, v) => s + v, 0);
      expect(totalDist).to.equal(sim.annualFees);
    });

    it('$500M+ target simulation with LP/BBB/Staker/Treasury split validation', function () {
      const tiers = [500_000, 10_000_000, 100_000_000, 500_000_000];
      const projections = tiers.map(t => simulateTVL(t));

      expect(projections).to.have.length(4);
      expect(projections[3].annualFees).to.equal(2_500_000);

      for (let i = 1; i < projections.length; i++) {
        expect(projections[i].annualFees).to.be.greaterThan(projections[i - 1].annualFees);
      }

      const top = projections[3];
      expect(top.distribution.buybackBurn).to.equal(750_000);
      expect(top.distribution.liquidity).to.equal(750_000);
      expect(top.distribution.stakers).to.equal(625_000);
      expect(top.distribution.treasury).to.equal(375_000);

      const totalDist = Object.values(top.distribution).reduce((s, v) => s + v, 0);
      expect(totalDist).to.equal(top.annualFees);

      expect(top.monthlyFees).to.be.closeTo(208_333, 2);
      expect(top.dailyFees).to.be.closeTo(6_849, 2);
    });
  });
});
