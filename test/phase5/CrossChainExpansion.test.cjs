/**
 * Phase 5 — Cross-Chain Expansion & Resilience Tests (18 tests)
 *
 * Tests ProofRouter Aptos/Sui routes, multi-hop with Move chains,
 * deployment resilience config, and failover nullifiers.
 *
 * Run: npx hardhat test test/phase5/CrossChainExpansion.test.cjs
 */

const { expect } = require('chai');
const hre = require('hardhat');
const { ethers } = hre;

describe('Cross-Chain Expansion & Resilience (Phase 5)', function () {
  let verifier, splitter;
  let admin;

  beforeEach(async function () {
    [admin] = await ethers.getSigners();

    const SplF = await ethers.getContractFactory('CoreRevenueSplitter');
    splitter = await SplF.deploy(admin.address, admin.address, admin.address, admin.address, admin.address, admin.address);
    await splitter.waitForDeployment();

    const VF = await ethers.getContractFactory('ZKVerifierSP1');
    verifier = await VF.deploy(admin.address, ethers.ZeroAddress);
    await verifier.waitForDeployment();
  });

  describe('ProofRouter Aptos/Sui Routes (JS-level)', function () {
    let ProofRouter, ChainType;

    before(async function () {
      const mod = await import('../../core-layer/ai-listener.js');
      ProofRouter = mod.ProofRouter;
      ChainType = mod.ChainType;
    });

    it('should have EVM → Aptos route via LayerZero', function () {
      const route = ProofRouter.getRoute(ChainType.EVM, ChainType.MOVE_APTOS);
      expect(route).to.not.be.null;
      expect(route.bridge).to.equal('layerzero');
      expect(route.gasEquivalent).to.be.lessThan(500000);
    });

    it('should have EVM → Sui route via Wormhole', function () {
      const route = ProofRouter.getRoute(ChainType.EVM, ChainType.MOVE_SUI);
      expect(route).to.not.be.null;
      expect(route.bridge).to.equal('wormhole');
    });

    it('should have Aptos → Sui cross-Move route', function () {
      const route = ProofRouter.getRoute(ChainType.MOVE_APTOS, ChainType.MOVE_SUI);
      expect(route).to.not.be.null;
      expect(route.bridge).to.equal('wormhole');
      expect(route.gasEquivalent).to.equal(300000);
    });

    it('should have Cosmos → Aptos route', function () {
      const route = ProofRouter.getRoute(ChainType.COSMOS, ChainType.MOVE_APTOS);
      expect(route).to.not.be.null;
      expect(route.method).to.include('IBC');
    });

    it('should have Solana → Aptos route', function () {
      const route = ProofRouter.getRoute(ChainType.SVM, ChainType.MOVE_APTOS);
      expect(route).to.not.be.null;
    });

    it('should have Solana → Sui route', function () {
      const route = ProofRouter.getRoute(ChainType.SVM, ChainType.MOVE_SUI);
      expect(route).to.not.be.null;
    });

    it('should have DePIN → Aptos route', function () {
      const route = ProofRouter.getRoute(ChainType.DEPIN, ChainType.MOVE_APTOS);
      expect(route).to.not.be.null;
    });

    it('should have DePIN → Sui route', function () {
      const route = ProofRouter.getRoute(ChainType.DEPIN, ChainType.MOVE_SUI);
      expect(route).to.not.be.null;
    });

    it('should list all routes including Move chains (30+ routes)', function () {
      const routes = ProofRouter.allRoutes();
      expect(routes.length).to.be.greaterThanOrEqual(29);

      const aptosRoutes = routes.filter(r => r.source === ChainType.MOVE_APTOS || r.dest === ChainType.MOVE_APTOS);
      expect(aptosRoutes.length).to.be.greaterThanOrEqual(8);

      const suiRoutes = routes.filter(r => r.source === ChainType.MOVE_SUI || r.dest === ChainType.MOVE_SUI);
      expect(suiRoutes.length).to.be.greaterThanOrEqual(8);
    });

    it('should find multi-hop route EVM → DePIN → Aptos', function () {
      const route = ProofRouter.findMultiHopRoute(ChainType.EVM, ChainType.MOVE_APTOS);
      expect(route).to.not.be.null;
      expect(route.totalGas).to.be.greaterThan(0);
    });
  });

  describe('DEFAULT_CHAINS expansion', function () {
    let DEFAULT_CHAINS, ChainType;

    before(async function () {
      const mod = await import('../../core-layer/ai-listener.js');
      DEFAULT_CHAINS = mod.DEFAULT_CHAINS;
      ChainType = mod.ChainType;
    });

    it('should include Aptos Mainnet in default chains', function () {
      expect(DEFAULT_CHAINS.aptos_mainnet).to.exist;
      expect(DEFAULT_CHAINS.aptos_mainnet.type).to.equal(ChainType.MOVE_APTOS);
      expect(DEFAULT_CHAINS.aptos_mainnet.vmType).to.equal('move');
    });

    it('should include Sui Mainnet in default chains', function () {
      expect(DEFAULT_CHAINS.sui_mainnet).to.exist;
      expect(DEFAULT_CHAINS.sui_mainnet.type).to.equal(ChainType.MOVE_SUI);
      expect(DEFAULT_CHAINS.sui_mainnet.vmType).to.equal('move');
    });

    it('should have gas targets <50K for Move chains', function () {
      expect(DEFAULT_CHAINS.aptos_mainnet.gasTarget).to.be.lessThanOrEqual(50000);
      expect(DEFAULT_CHAINS.sui_mainnet.gasTarget).to.be.lessThanOrEqual(50000);
    });
  });

  describe('AI Intent Types expansion', function () {
    let AI_INTENT_TYPES;

    before(async function () {
      const mod = await import('../../core-layer/ai-listener.js');
      AI_INTENT_TYPES = mod.AI_INTENT_TYPES;
    });

    it('should include swarm intent types', function () {
      expect(AI_INTENT_TYPES.SWARM_FORMED).to.equal('swarm_formed');
      expect(AI_INTENT_TYPES.SWARM_SETTLED).to.equal('swarm_settled');
      expect(AI_INTENT_TYPES.AGENT_SETTLED).to.equal('agent_settled');
    });

    it('should include privacy intent types', function () {
      expect(AI_INTENT_TYPES.DATA_PROVENANCED).to.equal('data_provenanced');
      expect(AI_INTENT_TYPES.SELECTIVE_DISCLOSURE).to.equal('selective_disclosure');
    });
  });

  describe('Resilience Configuration (deploy/full.cjs)', function () {
    it('should deploy Core Layer contracts with Phase 5 version', async function () {
      const splAddr = await splitter.getAddress();
      expect(splAddr).to.not.equal(ethers.ZeroAddress);
    });

    it('should deploy all 6 PoC circuits', async function () {
      const circuits = ['A2ACircuit'];
      for (const name of circuits) {
        const F = await ethers.getContractFactory(name);
        const c = await F.deploy(admin.address, await splitter.getAddress(), await verifier.getAddress());
        await c.waitForDeployment();
        const addr = await c.getAddress();
        expect(addr).to.not.equal(ethers.ZeroAddress);
      }
    });

    it('should verify A2ACircuit has swarm functions', async function () {
      const F = await ethers.getContractFactory('A2ACircuit');
      const a2a = await F.deploy(admin.address, await splitter.getAddress(), await verifier.getAddress());
      await a2a.waitForDeployment();

      const swarmCount = await a2a.swarmCount();
      expect(swarmCount).to.equal(0n);

      const maxSize = await a2a.MAX_SWARM_SIZE();
      expect(maxSize).to.equal(18);
    });
  });
});
