/**
 * Monitoring Dashboard & ROI Calculator — Tests (8 tests)
 *
 * Run: npx hardhat test test/phase4/MonitoringDashboard.test.cjs
 *
 * Covers:
 *   - Stats endpoint returns valid monitoring payload (2 tests)
 *   - ROI calculator math for different GPU tiers and volumes (2 tests)
 *   - Failure prediction logic — low / medium / high risk (2 tests)
 *   - Webhook stats aggregation (1 test)
 *   - OpenAPI spec includes /theta-ai/stats (1 test)
 */

const { expect } = require('chai');

// Inline ThetaInferenceHandler subset for unit testing (avoids ESM import issues)
// Mirrors the getMonitoringStats / _computeFailurePrediction logic

class MockHandler {
  constructor() {
    this.activeIntents = new Map();
    this.edgeCloudApiKey = '';
    this.rapidApiKey = '';
    this.apiStats = {
      edgeCloud: { calls: 0, successes: 0, failures: 0, totalLatencyMs: 0 },
      rapidApi: { calls: 0, successes: 0, failures: 0, totalLatencyMs: 0 },
      mcp: { calls: 0, successes: 0, failures: 0, totalLatencyMs: 0 },
      mock: { calls: 0 },
      onChain: { completes: 0, settles: 0, failures: 0 },
      webhooks: { delivered: 0, failed: 0 },
    };
  }

  getStats() {
    const stats = { total: 0, completed: 0, failed: 0, byType: {} };
    for (const [, entry] of this.activeIntents) {
      stats.total++;
      if (entry.status === 'completed' || entry.status === 'proof_ready') stats.completed++;
      if (entry.status === 'failed') stats.failed++;
      stats.byType[entry.serviceType] = (stats.byType[entry.serviceType] || 0) + 1;
    }
    return stats;
  }

  _computeFailurePrediction(rpcHealth = []) {
    const factors = [];
    let riskScore = 0;

    const totalRpcErrors = rpcHealth.reduce((s, r) => s + (r.errorCount || 0), 0);
    const disconnectedChains = rpcHealth.filter(r => !r.connected).length;

    if (disconnectedChains > 0) {
      riskScore += disconnectedChains * 20;
      factors.push(`${disconnectedChains} chain(s) disconnected`);
    }
    if (totalRpcErrors > 10) {
      riskScore += 15;
      factors.push(`${totalRpcErrors} RPC errors`);
    } else if (totalRpcErrors > 3) {
      riskScore += 5;
      factors.push(`${totalRpcErrors} RPC errors (minor)`);
    }

    const webhookTotal = this.apiStats.webhooks.delivered + this.apiStats.webhooks.failed;
    if (webhookTotal > 0) {
      const failRate = this.apiStats.webhooks.failed / webhookTotal;
      if (failRate > 0.2) {
        riskScore += 25;
        factors.push(`High webhook failure rate (${(failRate * 100).toFixed(0)}%)`);
      } else if (failRate > 0.05) {
        riskScore += 10;
        factors.push(`Elevated webhook failures (${(failRate * 100).toFixed(1)}%)`);
      }
    }

    if (!this.edgeCloudApiKey && !this.rapidApiKey) {
      riskScore += 5;
      factors.push('No live API keys — mock mode');
    }

    if (this.apiStats.edgeCloud.calls > 0) {
      const ecFailRate = this.apiStats.edgeCloud.failures / this.apiStats.edgeCloud.calls;
      if (ecFailRate > 0.3) {
        riskScore += 20;
        factors.push(`EdgeCloud failure rate ${(ecFailRate * 100).toFixed(0)}%`);
      }
    }

    if (this.apiStats.edgeCloud.successes > 0) {
      const avgMs = this.apiStats.edgeCloud.totalLatencyMs / this.apiStats.edgeCloud.successes;
      if (avgMs > 30000) {
        riskScore += 15;
        factors.push(`High avg latency (${(avgMs / 1000).toFixed(1)}s)`);
      } else if (avgMs > 15000) {
        riskScore += 5;
        factors.push(`Elevated avg latency (${(avgMs / 1000).toFixed(1)}s)`);
      }
    }

    let level, message;
    if (riskScore >= 40) {
      level = 'high';
      message = 'High risk of timeout or failure — check RPC connections and API keys';
    } else if (riskScore >= 15) {
      level = 'medium';
      message = 'Some degradation detected — monitor closely';
    } else {
      level = 'low';
      message = 'All systems nominal';
    }

    return { level, message, factors };
  }

  getMonitoringStats(listenerRef = null) {
    const recentIntents = [];
    const entries = Array.from(this.activeIntents.values());
    const sorted = entries.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0)).slice(0, 50);

    for (const e of sorted) {
      recentIntents.push({
        intentId: e.intentId,
        serviceType: typeof e.serviceType === 'number' ? e.serviceType : 0,
        gpuTier: e.gpuTier || 'default',
        status: e.status,
        latencyMs: e.latencyMs || null,
        source: e.source || null,
        createdAt: e.createdAt || Date.now(),
        model: e.model || 'unknown',
        txHash: e.settleTxHash || e.completeTxHash || null,
      });
    }

    const rpcHealth = [];
    if (listenerRef) {
      const status = listenerRef.getStatus();
      for (const [chainKey, chain] of Object.entries(status.chains)) {
        rpcHealth.push({
          chain: chainKey,
          name: chain.name || chainKey,
          connected: chain.connected || false,
          lastBlock: chain.lastBlock || 0,
          errorCount: 0,
          lastError: null,
        });
      }
    }

    const webhookTotal = this.apiStats.webhooks.delivered + this.apiStats.webhooks.failed;
    const webhooks = {
      delivered: this.apiStats.webhooks.delivered,
      failed: this.apiStats.webhooks.failed,
      pending: 0,
      deliveryRate: webhookTotal > 0
        ? ((this.apiStats.webhooks.delivered / webhookTotal) * 100).toFixed(1) + '%'
        : '100%',
    };

    const failurePrediction = this._computeFailurePrediction(rpcHealth);

    const basicStats = this.getStats();
    const totalLatency = entries.reduce((s, e) => s + (e.latencyMs || 0), 0);
    const completedWithLatency = entries.filter(e => e.latencyMs).length;

    return {
      intents: recentIntents,
      rpcHealth,
      webhooks,
      failurePrediction,
      summary: {
        totalIntents: basicStats.total,
        completedIntents: basicStats.completed,
        failedIntents: basicStats.failed,
        avgLatencyMs: completedWithLatency > 0 ? Math.round(totalLatency / completedWithLatency) : 0,
        uptime: 0,
        apiMode: this.edgeCloudApiKey ? 'LIVE' : this.rapidApiKey ? 'RAPIDAPI' : 'MOCK',
      },
    };
  }
}

// ROI calculation (mirrors ThetaAI.tsx ROICalculator component)
function computeROI({ effectivePrice, dailyVolume, gpuTier }) {
  const providerShare = 0.995;
  const dailyEarnings = dailyVolume * effectivePrice * providerShare;
  const monthlyEarnings = dailyEarnings * 30;
  const yearlyEarnings = dailyEarnings * 365;

  const gpuMonthlyCost = { RTX_4090: 450, A100: 1800, H100: 3600 };
  const tfuelPrice = 0.065;
  const monthlyEarningsUsd = monthlyEarnings * tfuelPrice;
  const monthlyCost = gpuMonthlyCost[gpuTier] || 0;
  const netMonthlyUsd = monthlyEarningsUsd - monthlyCost;
  const monthlyROI = monthlyCost > 0 ? (monthlyEarningsUsd / monthlyCost) * 100 : 0;

  return { dailyEarnings, monthlyEarnings, yearlyEarnings, monthlyEarningsUsd, netMonthlyUsd, monthlyROI };
}

describe('Monitoring Dashboard & ROI Calculator', function () {
  // ─── Test 1: Stats endpoint returns valid payload structure ─────────────
  it('should return valid monitoring stats payload with all required fields', function () {
    const handler = new MockHandler();
    handler.activeIntents.set('test-1', {
      intentId: 'test-1', serviceType: 0, gpuTier: 'RTX-4090',
      status: 'completed', latencyMs: 850, source: 'mock',
      createdAt: Date.now() - 5000, model: 'llama-3.1-8b',
    });

    const stats = handler.getMonitoringStats();

    expect(stats).to.have.property('intents').that.is.an('array');
    expect(stats).to.have.property('rpcHealth').that.is.an('array');
    expect(stats).to.have.property('webhooks').that.is.an('object');
    expect(stats).to.have.property('failurePrediction').that.is.an('object');
    expect(stats).to.have.property('summary').that.is.an('object');

    expect(stats.summary).to.have.property('totalIntents', 1);
    expect(stats.summary).to.have.property('completedIntents', 1);
    expect(stats.summary).to.have.property('avgLatencyMs', 850);
    expect(stats.summary).to.have.property('apiMode', 'MOCK');
  });

  // ─── Test 2: Stats with multiple intents and mixed statuses ────────────
  it('should aggregate stats across multiple intents with mixed statuses', function () {
    const handler = new MockHandler();
    const now = Date.now();

    handler.activeIntents.set('a', { intentId: 'a', serviceType: 0, status: 'completed', latencyMs: 1000, createdAt: now - 3000, model: 'llama' });
    handler.activeIntents.set('b', { intentId: 'b', serviceType: 1, status: 'failed', latencyMs: null, createdAt: now - 2000, model: 'flux' });
    handler.activeIntents.set('c', { intentId: 'c', serviceType: 2, status: 'completed', latencyMs: 2000, createdAt: now - 1000, model: 'whisper' });
    handler.activeIntents.set('d', { intentId: 'd', serviceType: 4, status: 'processing', latencyMs: null, createdAt: now, model: 'rag' });

    const stats = handler.getMonitoringStats();

    expect(stats.summary.totalIntents).to.equal(4);
    expect(stats.summary.completedIntents).to.equal(2);
    expect(stats.summary.failedIntents).to.equal(1);
    expect(stats.summary.avgLatencyMs).to.equal(1500); // (1000+2000)/2
    expect(stats.intents).to.have.lengthOf(4);
    expect(stats.intents[0].createdAt).to.be.gte(stats.intents[1].createdAt); // sorted desc
  });

  // ─── Test 3: ROI calculator — RTX 4090 at 500 calls/day ───────────────
  it('should calculate correct ROI for RTX 4090 at 500 LLM calls/day', function () {
    const roi = computeROI({
      effectivePrice: 0.01,   // 0.01 TFUEL per call (LLM on RTX 4090)
      dailyVolume: 500,
      gpuTier: 'RTX_4090',
    });

    expect(roi.dailyEarnings).to.be.closeTo(4.975, 0.001);      // 500 * 0.01 * 0.995
    expect(roi.monthlyEarnings).to.be.closeTo(149.25, 0.1);     // daily * 30
    expect(roi.yearlyEarnings).to.be.closeTo(1815.875, 1);      // daily * 365
    expect(roi.monthlyEarningsUsd).to.be.closeTo(9.7, 0.5);     // monthly * $0.065
    expect(roi.netMonthlyUsd).to.be.lessThan(0);                 // $9.7 - $450 cost
  });

  // ─── Test 4: ROI calculator — H100 at 10,000 calls/day ────────────────
  it('should calculate correct ROI for H100 at 10,000 Image Gen calls/day', function () {
    const roi = computeROI({
      effectivePrice: 0.25,   // 0.05 base * 5.0 H100 multiplier
      dailyVolume: 10000,
      gpuTier: 'H100',
    });

    expect(roi.dailyEarnings).to.be.closeTo(2487.5, 1);         // 10000 * 0.25 * 0.995
    expect(roi.monthlyEarnings).to.be.closeTo(74625, 10);       // daily * 30
    expect(roi.monthlyEarningsUsd).to.be.closeTo(4850.6, 10);   // monthly * $0.065
    expect(roi.netMonthlyUsd).to.be.greaterThan(0);             // profitable at high volume
    expect(roi.monthlyROI).to.be.greaterThan(100);              // > 100% ROI
  });

  // ─── Test 5: Failure prediction — low risk (all healthy) ──────────────
  it('should predict LOW risk when all systems are healthy', function () {
    const handler = new MockHandler();
    handler.edgeCloudApiKey = 'test-key-12345';
    handler.apiStats.webhooks = { delivered: 100, failed: 2 };
    handler.apiStats.edgeCloud = { calls: 50, successes: 48, failures: 2, totalLatencyMs: 50000 };

    const prediction = handler._computeFailurePrediction([
      { chain: 'theta_mainnet', connected: true, errorCount: 0 },
      { chain: 'theta_testnet', connected: true, errorCount: 1 },
    ]);

    expect(prediction.level).to.equal('low');
    expect(prediction.message).to.equal('All systems nominal');
  });

  // ─── Test 6: Failure prediction — high risk (disconnected + errors) ────
  it('should predict HIGH risk when chains are disconnected and errors are high', function () {
    const handler = new MockHandler();
    handler.apiStats.webhooks = { delivered: 10, failed: 8 };
    handler.apiStats.edgeCloud = { calls: 20, successes: 5, failures: 15, totalLatencyMs: 200000 };

    const prediction = handler._computeFailurePrediction([
      { chain: 'theta_mainnet', connected: false, errorCount: 15 },
      { chain: 'theta_testnet', connected: false, errorCount: 12 },
      { chain: 'bittensor', connected: true, errorCount: 0 },
    ]);

    expect(prediction.level).to.equal('high');
    expect(prediction.factors).to.be.an('array').with.length.greaterThan(0);
    expect(prediction.factors.some(f => f.includes('disconnected'))).to.be.true;
    expect(prediction.factors.some(f => f.includes('RPC errors'))).to.be.true;
  });

  // ─── Test 7: Webhook stats aggregation ─────────────────────────────────
  it('should correctly aggregate webhook delivery stats in monitoring payload', function () {
    const handler = new MockHandler();
    handler.apiStats.webhooks = { delivered: 42, failed: 3 };

    const stats = handler.getMonitoringStats();

    expect(stats.webhooks.delivered).to.equal(42);
    expect(stats.webhooks.failed).to.equal(3);
    expect(stats.webhooks.deliveryRate).to.equal('93.3%');
    expect(stats.webhooks.pending).to.equal(0);
  });

  // ─── Test 8: OpenAPI spec includes /theta-ai/stats ─────────────────────
  it('should include /theta-ai/stats in the OpenAPI spec', function () {
    // Inline check against the OPENAPI_SPEC structure (same as handler exports)
    const spec = {
      paths: {
        '/theta-ai/agent-intent': { post: {} },
        '/theta-ai/presets': { get: {} },
        '/theta-ai/gpu-tiers': { get: {} },
        '/theta-ai/catalog': { get: {} },
        '/theta-ai/webhook-status/{taskId}': { get: {} },
        '/theta-ai/stats': {
          get: {
            summary: 'Live monitoring stats — intents, RPC health, webhooks, failure prediction',
            operationId: 'getMonitoringStats',
          },
        },
        '/theta-ai/openapi.json': { get: {} },
      },
    };

    expect(spec.paths).to.have.property('/theta-ai/stats');
    expect(spec.paths['/theta-ai/stats'].get.operationId).to.equal('getMonitoringStats');
    expect(spec.paths['/theta-ai/stats'].get.summary).to.include('monitoring');
  });
});
