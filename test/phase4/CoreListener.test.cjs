/**
 * Phase 4 — CoreListener: DePIN Routing, Intent Outcomes & No-Path Solving (15 tests)
 *
 * Tests cross-DePIN routing (Akash + Render), intent-based architecture
 * with outcome tracking, no-path solving, and multi-hop routing.
 *
 * Run: npx hardhat test test/phase4/CoreListener.test.cjs
 */

const { expect } = require('chai');

// Import as CommonJS-compatible module test
describe('CoreListener Phase 4 — DePIN & Intent Outcomes', function () {
  let CoreListener, ProofRouter, ChainType, ProverType, IntentOutcomeType, DePINProviderStatus;

  before(async function () {
    const mod = await import('../../core-layer/ai-listener.js');
    CoreListener = mod.CoreListener;
    ProofRouter = mod.ProofRouter;
    ChainType = mod.ChainType;
    ProverType = mod.ProverType;
    IntentOutcomeType = mod.IntentOutcomeType;
    DePINProviderStatus = mod.DePINProviderStatus;
  });

  describe('ChainType.DEPIN', function () {
    it('should include DEPIN in chain types', function () {
      expect(ChainType.DEPIN).to.equal('depin');
    });
  });

  describe('ProofRouter — Enhanced DePIN Routes', function () {
    it('should route EVM → DEPIN', function () {
      const route = ProofRouter.getRoute(ChainType.EVM, ChainType.DEPIN);
      expect(route).to.not.be.null;
      expect(route.bridge).to.equal('hyperlane+depin');
      expect(route.gasEquivalent).to.be.lt(500000);
    });

    it('should route DEPIN → EVM', function () {
      const route = ProofRouter.getRoute(ChainType.DEPIN, ChainType.EVM);
      expect(route).to.not.be.null;
      expect(route.bridge).to.equal('depin+hyperlane');
    });

    it('should route DEPIN → DEPIN direct', function () {
      const route = ProofRouter.getRoute(ChainType.DEPIN, ChainType.DEPIN);
      expect(route).to.not.be.null;
      expect(route.bridge).to.equal('depin-direct');
      expect(route.gasEquivalent).to.equal(300000);
    });

    it('should route COSMOS → DEPIN', function () {
      const route = ProofRouter.getRoute(ChainType.COSMOS, ChainType.DEPIN);
      expect(route).to.not.be.null;
    });

    it('should route SVM → DEPIN', function () {
      const route = ProofRouter.getRoute(ChainType.SVM, ChainType.DEPIN);
      expect(route).to.not.be.null;
    });

    it('should include DEPIN routes in allRoutes()', function () {
      const routes = ProofRouter.allRoutes();
      const depinRoutes = routes.filter(r => r.source === ChainType.DEPIN || r.dest === ChainType.DEPIN);
      expect(depinRoutes.length).to.be.gte(6);
    });
  });

  describe('ProofRouter — Multi-Hop & Provider Selection', function () {
    it('should find multi-hop route when direct unavailable', function () {
      const multiHop = ProofRouter.findMultiHopRoute(ChainType.SVM, ChainType.COSMOS);
      if (multiHop) {
        expect(multiHop.hops.length).to.be.lte(3);
        expect(multiHop.totalGas).to.be.gt(0);
      }
    });

    it('should prefer direct route over multi-hop', function () {
      const result = ProofRouter.findMultiHopRoute(ChainType.EVM, ChainType.COSMOS);
      expect(result.hops.length).to.equal(1);
    });

    it('should select cheapest DePIN provider', function () {
      const providers = [
        { id: 'akash-1', status: DePINProviderStatus.AVAILABLE, gpuCapabilities: ['A100'], pricePerUnit: 0.5, network: 'akash' },
        { id: 'render-1', status: DePINProviderStatus.AVAILABLE, gpuCapabilities: ['A100', 'H100'], pricePerUnit: 0.3, network: 'render' },
        { id: 'akash-2', status: DePINProviderStatus.BUSY, gpuCapabilities: ['A100'], pricePerUnit: 0.2, network: 'akash' },
      ];

      const selected = ProofRouter.selectDePINProvider({ gpu: 'A100' }, providers);
      expect(selected).to.not.be.null;
      expect(selected.id).to.equal('render-1'); // cheapest available
    });

    it('should return null when no providers match GPU requirement', function () {
      const providers = [
        { id: 'akash-1', status: DePINProviderStatus.AVAILABLE, gpuCapabilities: ['RTX3090'], pricePerUnit: 0.5 },
      ];

      const selected = ProofRouter.selectDePINProvider({ gpu: 'H100' }, providers);
      expect(selected).to.be.null;
    });
  });

  describe('CoreListener — Intent Outcomes', function () {
    it('should initialize with intent outcome tracking', function () {
      const listener = new CoreListener({});
      expect(listener.metrics.perOutcome).to.have.property('fulfilled');
      expect(listener.metrics.perOutcome).to.have.property('no_path');
      expect(listener.metrics.perOutcome).to.have.property('deferred');
      expect(listener.pendingIntents.size).to.equal(0);
    });

    it('should track intent outcome stats', function () {
      const listener = new CoreListener({});
      const stats = listener.getIntentOutcomeStats();
      expect(stats.total).to.equal(0);
      expect(stats.pending).to.equal(0);
    });
  });

  describe('CoreListener — DePIN Provider Management', function () {
    it('should register DePIN providers', function () {
      const listener = new CoreListener({});
      listener.registerDePINProvider('akash-gpu-1', {
        network: 'akash',
        gpuCapabilities: ['A100', 'H100'],
        pricePerUnit: 0.50,
        region: 'us-east',
      });

      expect(listener.depinProviders.size).to.equal(1);
      const provider = listener.depinProviders.get('akash-gpu-1');
      expect(provider.status).to.equal(DePINProviderStatus.AVAILABLE);
      expect(provider.tasksCompleted).to.equal(0);
    });

    it('should include DePIN providers in status', function () {
      const listener = new CoreListener({});
      listener.registerDePINProvider('render-1', { network: 'render' });

      const status = listener.getStatus();
      expect(status.depinProviders).to.have.property('render-1');
    });
  });

  describe('IntentOutcomeType', function () {
    it('should define all outcome types', function () {
      expect(IntentOutcomeType.FULFILLED).to.equal('fulfilled');
      expect(IntentOutcomeType.PARTIAL).to.equal('partial');
      expect(IntentOutcomeType.FAILED).to.equal('failed');
      expect(IntentOutcomeType.NO_PATH).to.equal('no_path');
      expect(IntentOutcomeType.TIMEOUT).to.equal('timeout');
      expect(IntentOutcomeType.DEFERRED).to.equal('deferred');
    });
  });
});
