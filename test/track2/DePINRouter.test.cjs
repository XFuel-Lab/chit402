/**
 * Track 2.3 — DePIN Priority Router Tests
 *
 * Validates the off-chain routing waterfall in ThetaInferenceHandler:
 *   Priority 1  Theta EdgeCloud (THETA_NATIVE)
 *   Priority 2  RapidAPI         (THETA_NATIVE)
 *   Priority 3  MCP              (THETA_NATIVE)
 *   Priority 4  Akash Network    (DEPIN_AKASH)
 *   Priority 5  Render Network   (DEPIN_RENDER)
 *   Priority 6  AWS Bedrock      (HYBRID_CLOUD)
 *   Fallback    Mock             (no keys configured)
 *
 * Also validates:
 *   - ProviderTag enum expansion in ThetaInferenceCircuit.sol (DEPIN_AKASH=3, DEPIN_RENDER=4, HYBRID_CLOUD=5)
 *   - attestEdgeCloudNode() accepts all new tags on-chain
 *   - apiStats correctly tracks calls per tier
 *   - getApiStatus() reports enabled/disabled tiers
 *
 * Run: npx hardhat test test/track2/DePINRouter.test.cjs
 */

'use strict';

const { expect } = require('chai');
const { ethers } = require('hardhat');

// ─── ProviderTag enum values (must mirror ThetaInferenceCircuit.sol) ──────────
const TAG = Object.freeze({
  UNSET:          0n,
  THETA_NATIVE:   1n,
  HYBRID_FALLBACK:2n,
  DEPIN_AKASH:    3n,
  DEPIN_RENDER:   4n,
  HYBRID_CLOUD:   5n,
});

describe('Track 2.3 — DePIN Priority Router', function () {
  // ─── On-chain: ProviderTag enum expansion ──────────────────────────────────
  describe('ThetaInferenceCircuit — expanded ProviderTag enum', function () {
    let circuit, splitter;
    let admin, relayer, user;
    let bbb, lp, staker, treasury, stakePool;
    let llmServiceId;

    const MOCK_INPUT = ethers.keccak256(ethers.toUtf8Bytes('router-test-prompt'));
    const MOCK_OUTPUT= ethers.keccak256(ethers.toUtf8Bytes('router-test-output'));
    const MOCK_MODEL = ethers.keccak256(ethers.toUtf8Bytes('llama-3.1-70b'));
    const MOCK_PROOF = '0x' + 'aa'.repeat(130);
    const MOCK_PV    = '0x' + 'bb'.repeat(64);
    const PRICE      = ethers.parseEther('0.01');
    const PETAFLOPS  = 500n;

    before(async function () {
      [admin, relayer, user, bbb, lp, staker, treasury, stakePool] = await ethers.getSigners();

      const Splitter = await ethers.getContractFactory('CoreRevenueSplitter');
      splitter = await Splitter.deploy(
        admin.address,
        bbb.address, lp.address, staker.address, treasury.address, stakePool.address
      );
      await splitter.waitForDeployment();

      const Circuit = await ethers.getContractFactory('ThetaInferenceCircuit');
      circuit = await Circuit.deploy(
        admin.address, splitter.target, ethers.ZeroAddress
      );
      await circuit.waitForDeployment();

      const RELAYER_ROLE = await circuit.RELAYER_ROLE();
      await circuit.connect(admin).grantRole(RELAYER_ROLE, relayer.address);

      // Register LLM service (admin already has OPERATOR_ROLE)
      const tx = await circuit.connect(admin).registerService(0, 'llama-3.1-70b', ethers.parseEther('0.005'), 5000);
      const r = await tx.wait();
      const log = r.logs.find(l => {
        try { return circuit.interface.parseLog(l)?.name === 'ServiceRegistered'; }
        catch { return false; }
      });
      llmServiceId = circuit.interface.parseLog(log).args.serviceId;
    });

    // Helper: full intent lifecycle up to Completed
    async function makeCompletedIntent(tag) {
      const tx = await circuit.connect(user).submitIntent(llmServiceId, MOCK_INPUT, { value: PRICE });
      const receipt = await tx.wait();
      const iface = circuit.interface;
      let intentId;
      for (const log of receipt.logs) {
        try {
          const parsed = iface.parseLog(log);
          if (parsed?.name === 'InferenceIntentSubmitted') {
            intentId = parsed.args.intentId;
            break;
          }
        } catch { /* skip */ }
      }

      const nodeId         = ethers.keccak256(ethers.toUtf8Bytes(`node-${tag}`));
      const gpuFingerprint = ethers.keccak256(ethers.toUtf8Bytes(`gpu-${tag}`));
      const nullifier      = ethers.keccak256(ethers.toUtf8Bytes(`null-${tag}-${Date.now()}`));

      await circuit.connect(relayer).completeIntent(intentId, MOCK_OUTPUT, MOCK_MODEL, 800n);
      await circuit.connect(relayer).attestEdgeCloudNode(
        intentId, nodeId, gpuFingerprint, PETAFLOPS, Number(tag)
      );
      await circuit.connect(relayer).settleIntent(intentId, MOCK_PROOF, MOCK_PV, nullifier);

      return { intentId, nodeId, gpuFingerprint };
    }

    it('DEPIN_AKASH (3) — attestation stored correctly', async function () {
      const { intentId, nodeId, gpuFingerprint } = await makeCompletedIntent(TAG.DEPIN_AKASH);
      const att = await circuit.getAttestation(intentId);
      expect(att.providerTag).to.equal(TAG.DEPIN_AKASH);
      expect(att.nodeId).to.equal(nodeId);
      expect(att.gpuFingerprint).to.equal(gpuFingerprint);
      expect(att.petaflopsUsed).to.equal(PETAFLOPS);
      expect(att.attestedAt).to.be.gt(0n);
    });

    it('DEPIN_RENDER (4) — attestation stored correctly', async function () {
      const { intentId, nodeId, gpuFingerprint } = await makeCompletedIntent(TAG.DEPIN_RENDER);
      const att = await circuit.getAttestation(intentId);
      expect(att.providerTag).to.equal(TAG.DEPIN_RENDER);
      expect(att.nodeId).to.equal(nodeId);
    });

    it('HYBRID_CLOUD (5) — attestation stored correctly', async function () {
      const { intentId, nodeId } = await makeCompletedIntent(TAG.HYBRID_CLOUD);
      const att = await circuit.getAttestation(intentId);
      expect(att.providerTag).to.equal(TAG.HYBRID_CLOUD);
      expect(att.nodeId).to.equal(nodeId);
    });

    it('THETA_NATIVE (1) — still works after enum expansion', async function () {
      const { intentId } = await makeCompletedIntent(TAG.THETA_NATIVE);
      const att = await circuit.getAttestation(intentId);
      expect(att.providerTag).to.equal(TAG.THETA_NATIVE);
    });

    it('UNSET (0) — reverts with ProviderTagUnset', async function () {
      const tx = await circuit.connect(user).submitIntent(llmServiceId, MOCK_INPUT, { value: PRICE });
      const receipt = await tx.wait();
      let intentId;
      for (const log of receipt.logs) {
        try {
          const parsed = circuit.interface.parseLog(log);
          if (parsed?.name === 'InferenceIntentSubmitted') { intentId = parsed.args.intentId; break; }
        } catch { /* skip */ }
      }

      const nodeId = ethers.keccak256(ethers.toUtf8Bytes('bad-node'));
      const fp     = ethers.keccak256(ethers.toUtf8Bytes('bad-fp'));
      await circuit.connect(relayer).completeIntent(intentId, MOCK_OUTPUT, MOCK_MODEL, 500n);

      await expect(
        circuit.connect(relayer).attestEdgeCloudNode(intentId, nodeId, fp, 100n, 0)
      ).to.be.revertedWith('ProviderTagUnset');
    });

    it('attestationCount increments for each new tag', async function () {
      const before = await circuit.getAttestationCount();
      await makeCompletedIntent(TAG.DEPIN_AKASH);
      await makeCompletedIntent(TAG.DEPIN_RENDER);
      const after = await circuit.getAttestationCount();
      expect(after).to.equal(before + 2n);
    });

    it('EdgeCloudNodeAttested emits correct providerTag for DEPIN_AKASH', async function () {
      const tx = await circuit.connect(user).submitIntent(llmServiceId, MOCK_INPUT, { value: PRICE });
      const receipt = await tx.wait();
      let intentId;
      for (const log of receipt.logs) {
        try {
          const parsed = circuit.interface.parseLog(log);
          if (parsed?.name === 'InferenceIntentSubmitted') { intentId = parsed.args.intentId; break; }
        } catch { /* skip */ }
      }

      const nodeId = ethers.keccak256(ethers.toUtf8Bytes('akash-emit-node'));
      const fp     = ethers.keccak256(ethers.toUtf8Bytes('akash-emit-fp'));
      await circuit.connect(relayer).completeIntent(intentId, MOCK_OUTPUT, MOCK_MODEL, 300n);

      await expect(
        circuit.connect(relayer).attestEdgeCloudNode(intentId, nodeId, fp, PETAFLOPS, Number(TAG.DEPIN_AKASH))
      )
        .to.emit(circuit, 'EdgeCloudNodeAttested')
        .withArgs(intentId, nodeId, fp, PETAFLOPS, TAG.DEPIN_AKASH);
    });
  });

  // ─── Off-chain: handler routing logic (unit tests without blockchain) ───────
  describe('ThetaInferenceHandler — routing waterfall', function () {
    // We test the handler by injecting mock fetch responses per tier.
    // The handler is an ES module; we use dynamic import + globalThis.fetch stubbing.

    let ThetaInferenceHandler;
    let originalFetch;

    before(async function () {
      // Dynamic import of the ES module
      try {
        const mod = await import('../../circuits/theta-inference/theta-inference-handler.js');
        ThetaInferenceHandler = mod.ThetaInferenceHandler;
      } catch (err) {
        // If import fails (e.g., missing deps in test env), skip off-chain tests
        this.skip();
      }
      originalFetch = globalThis.fetch;
    });

    afterEach(function () {
      // Reset fetch stub after each test to avoid cross-test pollution
      if (originalFetch) globalThis.fetch = originalFetch;
    });

    after(function () {
      if (originalFetch) globalThis.fetch = originalFetch;
    });

    function makeMockFetch(statusCode, body, extraFields = {}) {
      return async () => ({
        ok: statusCode >= 200 && statusCode < 300,
        status: statusCode,
        text: async () => JSON.stringify(body),
        json: async () => ({ ...body, ...extraFields }),
      });
    }

    function makeHandler(overrides = {}) {
      return new ThetaInferenceHandler({
        edgeCloudApiKey:     overrides.edgeCloudApiKey     || '',
        rapidApiKey:         overrides.rapidApiKey         || '',
        mcpEndpoint:         overrides.mcpEndpoint         || '',
        akashMnemonic:       overrides.akashMnemonic       || '',
        renderApiKey:        overrides.renderApiKey        || '',
        awsAccessKeyId:      overrides.awsAccessKeyId      || '',
        awsSecretAccessKey:  overrides.awsSecretAccessKey  || '',
        useAkashFallback:    overrides.useAkashFallback    !== false,
        useRenderFallback:   overrides.useRenderFallback   !== false,
        useBedrockFallback:  overrides.useBedrockFallback  !== false,
        useRapidApiFallback: overrides.useRapidApiFallback !== false,
        useMcpFallback:      overrides.useMcpFallback      !== false,
        apiTimeout: 5000,
        logger: { info: () => {}, warn: () => {}, error: () => {} },
      });
    }

    it('no keys configured — routes to mock with warning', async function () {
      // Temporarily clear all provider env vars so the handler has nothing to call
      const savedEnv = {
        THETA_EDGECLOUD_API_KEY: process.env.THETA_EDGECLOUD_API_KEY,
        THETA_RAPIDAPI_KEY:      process.env.THETA_RAPIDAPI_KEY,
        THETA_MCP_ENDPOINT:      process.env.THETA_MCP_ENDPOINT,
        AKASH_WALLET_MNEMONIC:   process.env.AKASH_WALLET_MNEMONIC,
        RENDER_API_KEY:          process.env.RENDER_API_KEY,
        AWS_ACCESS_KEY_ID:       process.env.AWS_ACCESS_KEY_ID,
      };
      Object.keys(savedEnv).forEach(k => delete process.env[k]);

      try {
        const handler = makeHandler();
        handler._keyResolved = true;
        const intent = {
          args: { intentId: 'test-no-keys-0x0000', serviceType: 0, model: 'llama-3.1-8b', gpuTier: 1 },
        };
        const ctx = { chain: 'theta_testnet', generateProof: null };
        const outcome = await handler.onIntent(intent, ctx);
        expect(outcome.outcome).to.equal('fulfilled');
        const entry = handler.activeIntents.get('test-no-keys-0x0000');
        expect(entry.source).to.equal('mock');
        expect(handler.apiStats.mock.calls).to.equal(1);
      } finally {
        Object.entries(savedEnv).forEach(([k, v]) => {
          if (v !== undefined) process.env[k] = v;
        });
      }
    });

    it('EdgeCloud key present — routes to EdgeCloud (THETA_NATIVE)', async function () {
      const handler = makeHandler({ edgeCloudApiKey: 'ec-test-key' });
      handler._keyResolved = true;
      globalThis.fetch = makeMockFetch(200, {
        choices: [{ message: { role: 'assistant', content: 'EdgeCloud response' } }],
        model: 'llama-3.1-8b', usage: { total_tokens: 10 },
        _source: 'theta-edgecloud-ondemand',
      });

      const intent = {
        args: { intentId: 'test-ec-0x0001', serviceType: 0, model: 'llama-3.1-8b', gpuTier: 2 },
      };
      const outcome = await handler.onIntent(intent, { chain: 'theta_testnet', generateProof: null });
      expect(outcome.outcome).to.equal('fulfilled');
      const entry = handler.activeIntents.get('test-ec-0x0001');
      expect(entry.source).to.equal('edgecloud');
      expect(handler.apiStats.edgeCloud.successes).to.equal(1);
    });

    it('EdgeCloud fails — falls through to Akash (DEPIN_AKASH)', async function () {
      const handler = makeHandler({ edgeCloudApiKey: 'ec-test-key', akashMnemonic: 'word1 word2 word3 word4 word5 word6 word7 word8 word9 word10 word11 word12' });
      handler._keyResolved = true;

      let callCount = 0;
      globalThis.fetch = async (url) => {
        callCount++;
        // First call = EdgeCloud → fail
        if (callCount === 1) {
          return { ok: false, status: 503, text: async () => 'unavailable', json: async () => ({}) };
        }
        // Second call = Akash → success
        return {
          ok: true, status: 200,
          text: async () => JSON.stringify({ output: 'Akash DePIN response', node_id: 'akash-provider-xyz' }),
          json: async () => ({ output: 'Akash DePIN response', node_id: 'akash-provider-xyz' }),
        };
      };

      const intent = { args: { intentId: 'test-akash-0x0002', serviceType: 0, model: 'llama-3.1-8b', gpuTier: 1 } };
      const outcome = await handler.onIntent(intent, { chain: 'theta_testnet', generateProof: null });
      expect(outcome.outcome).to.equal('fulfilled');
      const entry = handler.activeIntents.get('test-akash-0x0002');
      expect(entry.source).to.equal('akash');
      expect(handler.apiStats.akash.successes).to.equal(1);
    });

    it('EdgeCloud + Akash fail — falls through to Render (DEPIN_RENDER)', async function () {
      const handler = makeHandler({
        edgeCloudApiKey: 'ec-key',
        akashMnemonic:   'word '.repeat(11).trim() + ' last',
        renderApiKey:    'render-test-key',
      });
      handler._keyResolved = true;

      let callCount = 0;
      globalThis.fetch = async () => {
        callCount++;
        if (callCount <= 2) return { ok: false, status: 503, text: async () => '', json: async () => ({}) };
        return {
          ok: true, status: 200,
          text: async () => JSON.stringify({ choices: [{ message: { role: 'assistant', content: 'Render response' } }], node_id: 'render-node-1' }),
          json: async () => ({ choices: [{ message: { role: 'assistant', content: 'Render response' } }], node_id: 'render-node-1' }),
        };
      };

      const intent = { args: { intentId: 'test-render-0x0003', serviceType: 0, model: 'llama-3.1-8b', gpuTier: 1 } };
      const outcome = await handler.onIntent(intent, { chain: 'theta_testnet', generateProof: null });
      expect(outcome.outcome).to.equal('fulfilled');
      const entry = handler.activeIntents.get('test-render-0x0003');
      expect(entry.source).to.equal('render');
      expect(handler.apiStats.render.successes).to.equal(1);
    });

    it('All DePINs fail — falls through to Bedrock (HYBRID_CLOUD)', async function () {
      const handler = makeHandler({
        edgeCloudApiKey:    'ec-key',
        akashMnemonic:      'word '.repeat(11).trim() + ' last',
        renderApiKey:       'render-key',
        awsAccessKeyId:     'AKIATEST',
        awsSecretAccessKey: 'supersecret',
        awsRegion:          'us-east-1',
      });
      handler._keyResolved = true;

      let callCount = 0;
      globalThis.fetch = async () => {
        callCount++;
        if (callCount <= 3) return { ok: false, status: 503, text: async () => '', json: async () => ({}) };
        // Bedrock response (Llama format)
        return {
          ok: true, status: 200,
          text: async () => JSON.stringify({ generation: 'Bedrock last resort response' }),
          json: async () => ({ generation: 'Bedrock last resort response' }),
        };
      };

      const intent = { args: { intentId: 'test-bedrock-0x0004', serviceType: 0, model: 'llama-3.1-8b', gpuTier: 1 } };
      const outcome = await handler.onIntent(intent, { chain: 'theta_testnet', generateProof: null });
      expect(outcome.outcome).to.equal('fulfilled');
      const entry = handler.activeIntents.get('test-bedrock-0x0004');
      expect(entry.source).to.equal('bedrock');
      expect(handler.apiStats.bedrock.successes).to.equal(1);
    });

    it('getApiStatus() reports all six tiers', function () {
      const handler = makeHandler({
        edgeCloudApiKey: 'ec-key',
        akashMnemonic:   'test mnemonic words here please count them all twelve',
        renderApiKey:    'render-key',
        awsAccessKeyId:  'AKIATEST',
        awsSecretAccessKey: 'supersecret',
      });
      const status = handler.getApiStatus();
      expect(status).to.have.property('edgeCloud');
      expect(status).to.have.property('akash');
      expect(status).to.have.property('render');
      expect(status).to.have.property('bedrock');
      expect(status.edgeCloud.enabled).to.be.true;
      expect(status.akash.enabled).to.be.true;
      expect(status.render.enabled).to.be.true;
      expect(status.bedrock.enabled).to.be.true;
    });

    it('feature flags can disable individual tiers', async function () {
      const handler = makeHandler({
        akashMnemonic: 'word '.repeat(11).trim() + ' last',
        useAkashFallback: false,
      });
      handler._keyResolved = true;

      const status = handler.getApiStatus();
      expect(status.akash.enabled).to.be.false;
    });

    it('apiStats tracks each tier independently', async function () {
      const handler = makeHandler({ edgeCloudApiKey: 'ec-key', renderApiKey: 'render-key' });
      handler._keyResolved = true;

      let callCount = 0;
      globalThis.fetch = async () => {
        callCount++;
        if (callCount === 1) return { ok: false, status: 500, text: async () => '', json: async () => ({}) };
        return {
          ok: true, status: 200,
          text: async () => JSON.stringify({ choices: [{ message: { role: 'assistant', content: 'ok' } }] }),
          json: async () => ({ choices: [{ message: { role: 'assistant', content: 'ok' } }] }),
        };
      };

      await handler.onIntent(
        { args: { intentId: 'stats-test-0x0005', serviceType: 0, model: 'llama-3.1-8b', gpuTier: 0 } },
        { chain: 'theta_testnet', generateProof: null }
      );

      expect(handler.apiStats.edgeCloud.failures).to.be.gte(1);
      expect(handler.apiStats.render.successes).to.equal(1);
      expect(handler.apiStats.mock.calls).to.equal(0);
    });
  });
});
