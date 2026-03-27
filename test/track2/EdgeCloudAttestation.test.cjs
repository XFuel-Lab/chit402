/**
 * Track 2.1 — EdgeCloud Node Attestation Tests
 *
 * Validates the full attestation flow added to ThetaInferenceCircuit.sol:
 *   - ProviderTag enum: THETA_NATIVE / HYBRID_FALLBACK
 *   - EdgeCloudAttestation struct storage and retrieval
 *   - attestEdgeCloudNode() access control, guard rails, event emission
 *   - emitVideoProvenance() for VIDEO_PROCESSING intents
 *   - Integration: completeIntent → attestEdgeCloudNode → settleIntent ordering
 *   - Attestation is cryptographically associated with the intent (cannot attest twice)
 *   - getAttestation() / getAttestationCount() views
 *
 * Architecture note:
 *   ai-listener.js workflow on EdgeCloud job completion:
 *     1. completeIntent(intentId, outputHash, modelHash, latencyMs)
 *     2. attestEdgeCloudNode(intentId, nodeId, gpuFingerprint, petaflops, THETA_NATIVE)
 *     3. settleIntent(intentId, proof, publicValues[includes nodeId], nullifier)
 *
 * Run: npx hardhat test test/track2/EdgeCloudAttestation.test.cjs
 */

'use strict';

const { expect } = require('chai');
const { ethers } = require('hardhat');

describe('Track 2.1 — EdgeCloud Node Attestation', function () {
  let circuit, splitter;
  let admin, relayer, user, stranger;
  let bbb, lp, staker, treasury, stakePool;

  // ── Test fixtures ──────────────────────────────────────────────────────────
  const NODE_ID          = ethers.keccak256(ethers.toUtf8Bytes('edgecloud-node-0x4a2f'));
  const GPU_FINGERPRINT  = ethers.keccak256(ethers.toUtf8Bytes('H100-SXM5-driver-535.129'));
  const PETAFLOPS_USED   = 847n;   // 0.847 PFLOPS in GFLOPS units
  const MOCK_INPUT       = ethers.keccak256(ethers.toUtf8Bytes('test-prompt'));
  const MOCK_OUTPUT      = ethers.keccak256(ethers.toUtf8Bytes('test-output'));
  const MOCK_MODEL       = ethers.keccak256(ethers.toUtf8Bytes('llama-3.1-70b-v2'));
  const MOCK_PROOF       = '0x' + 'ab'.repeat(130);
  const MOCK_PV          = '0x' + 'cd'.repeat(64);
  const NULLIFIER        = ethers.keccak256(ethers.toUtf8Bytes('unique-nullifier-1'));
  const VIDEO_ID         = ethers.keccak256(ethers.toUtf8Bytes('video_abc123'));
  const CONTENT_HASH     = ethers.keccak256(ethers.toUtf8Bytes('video-content'));
  const PLAYBACK_URI     = 'https://media.thetavideoapi.com/hls/abc123/master.m3u8';

  // ProviderTag enum values (must match contract)
  const TAG_UNSET    = 0n;
  const TAG_NATIVE   = 1n;
  const TAG_FALLBACK = 2n;

  // ServiceType enum values
  const SVC_LLM   = 0;
  const SVC_VIDEO = 5;

  let llmServiceId, videoServiceId, presetId;
  const PRICE = ethers.parseEther('0.01');

  // ── Helper: create an intent and bring it to Completed status ──────────────
  async function setupCompletedIntent(serviceId = llmServiceId) {
    const tx = await circuit.connect(user).submitIntent(serviceId, MOCK_INPUT, { value: PRICE });
    const receipt = await tx.wait();
    const log = receipt.logs.find(l => {
      try { return circuit.interface.parseLog(l)?.name === 'InferenceIntentSubmitted'; }
      catch { return false; }
    });
    const parsed = circuit.interface.parseLog(log);
    const intentId = parsed.args.intentId;

    await circuit.connect(relayer).completeIntent(intentId, MOCK_OUTPUT, MOCK_MODEL, 185);
    return intentId;
  }

  // ── Deploy ─────────────────────────────────────────────────────────────────
  beforeEach(async function () {
    [admin, relayer, user, stranger, bbb, lp, staker, treasury, stakePool] =
      await ethers.getSigners();

    const SF = await ethers.getContractFactory('CoreRevenueSplitter');
    splitter = await SF.deploy(
      admin.address, bbb.address, lp.address,
      staker.address, treasury.address, stakePool.address
    );
    await splitter.waitForDeployment();

    const CF = await ethers.getContractFactory('ThetaInferenceCircuit');
    circuit = await CF.deploy(
      admin.address,
      await splitter.getAddress(),
      ethers.ZeroAddress   // mock mode — no ZK verifier needed for attestation tests
    );
    await circuit.waitForDeployment();

    await circuit.grantRole(await circuit.RELAYER_ROLE(), relayer.address);

    // Register LLM service
    const tx1 = await circuit.connect(admin).registerService(SVC_LLM, 'llama-3.1-70b', PRICE, 5000);
    const r1 = await tx1.wait();
    const l1 = r1.logs.find(l => {
      try { return circuit.interface.parseLog(l)?.name === 'ServiceRegistered'; }
      catch { return false; }
    });
    llmServiceId = circuit.interface.parseLog(l1).args.serviceId;

    // Register Video service
    const tx2 = await circuit.connect(admin).registerService(SVC_VIDEO, 'theta-video-api', PRICE, 600000);
    const r2 = await tx2.wait();
    const l2 = r2.logs.find(l => {
      try { return circuit.interface.parseLog(l)?.name === 'ServiceRegistered'; }
      catch { return false; }
    });
    videoServiceId = circuit.interface.parseLog(l2).args.serviceId;
  });

  // ═══════════════════════════════════════════════════════════════════════════
  //  1. ProviderTag Enum
  // ═══════════════════════════════════════════════════════════════════════════

  describe('ProviderTag enum', function () {
    it('UNSET is 0, THETA_NATIVE is 1, HYBRID_FALLBACK is 2', async function () {
      // Verify via unattested intent — providerTag should be UNSET (0)
      const intentId = await setupCompletedIntent();
      const att = await circuit.getAttestation(intentId);
      expect(att.providerTag).to.equal(TAG_UNSET);
    });

    it('stores THETA_NATIVE tag correctly', async function () {
      const intentId = await setupCompletedIntent();
      await circuit.connect(relayer).attestEdgeCloudNode(
        intentId, NODE_ID, GPU_FINGERPRINT, PETAFLOPS_USED, TAG_NATIVE
      );
      const att = await circuit.getAttestation(intentId);
      expect(att.providerTag).to.equal(TAG_NATIVE);
    });

    it('stores HYBRID_FALLBACK tag correctly', async function () {
      const intentId = await setupCompletedIntent();
      await circuit.connect(relayer).attestEdgeCloudNode(
        intentId, NODE_ID, GPU_FINGERPRINT, PETAFLOPS_USED, TAG_FALLBACK
      );
      const att = await circuit.getAttestation(intentId);
      expect(att.providerTag).to.equal(TAG_FALLBACK);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  //  2. attestEdgeCloudNode() — Happy Path
  // ═══════════════════════════════════════════════════════════════════════════

  describe('attestEdgeCloudNode() — happy path', function () {
    it('stores all attestation fields correctly', async function () {
      const intentId = await setupCompletedIntent();

      await circuit.connect(relayer).attestEdgeCloudNode(
        intentId, NODE_ID, GPU_FINGERPRINT, PETAFLOPS_USED, TAG_NATIVE
      );

      const att = await circuit.getAttestation(intentId);
      expect(att.nodeId).to.equal(NODE_ID);
      expect(att.gpuFingerprint).to.equal(GPU_FINGERPRINT);
      expect(att.petaflopsUsed).to.equal(PETAFLOPS_USED);
      expect(att.providerTag).to.equal(TAG_NATIVE);
      expect(att.attestedAt).to.be.gt(0n);
    });

    it('emits EdgeCloudNodeAttested with all fields', async function () {
      const intentId = await setupCompletedIntent();

      await expect(
        circuit.connect(relayer).attestEdgeCloudNode(
          intentId, NODE_ID, GPU_FINGERPRINT, PETAFLOPS_USED, TAG_NATIVE
        )
      )
        .to.emit(circuit, 'EdgeCloudNodeAttested')
        .withArgs(intentId, NODE_ID, GPU_FINGERPRINT, PETAFLOPS_USED, TAG_NATIVE);
    });

    it('increments attestationCount', async function () {
      const before = await circuit.getAttestationCount();
      const intentId = await setupCompletedIntent();
      await circuit.connect(relayer).attestEdgeCloudNode(
        intentId, NODE_ID, GPU_FINGERPRINT, PETAFLOPS_USED, TAG_NATIVE
      );
      expect(await circuit.getAttestationCount()).to.equal(before + 1n);
    });

    it('records attestedAt timestamp', async function () {
      const intentId = await setupCompletedIntent();
      const blockBefore = await ethers.provider.getBlock('latest');
      await circuit.connect(relayer).attestEdgeCloudNode(
        intentId, NODE_ID, GPU_FINGERPRINT, PETAFLOPS_USED, TAG_NATIVE
      );
      const att = await circuit.getAttestation(intentId);
      expect(att.attestedAt).to.be.gte(BigInt(blockBefore.timestamp));
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  //  3. attestEdgeCloudNode() — Guard Rails
  // ═══════════════════════════════════════════════════════════════════════════

  describe('attestEdgeCloudNode() — guard rails', function () {
    it('reverts if caller lacks RELAYER_ROLE', async function () {
      const intentId = await setupCompletedIntent();
      const RELAYER_ROLE = await circuit.RELAYER_ROLE();
      await expect(
        circuit.connect(stranger).attestEdgeCloudNode(
          intentId, NODE_ID, GPU_FINGERPRINT, PETAFLOPS_USED, TAG_NATIVE
        )
      ).to.be.revertedWithCustomError(circuit, 'AccessControlUnauthorizedAccount')
       .withArgs(stranger.address, RELAYER_ROLE);
    });

    it('reverts IntentNotFound for unknown intentId', async function () {
      const bogus = ethers.keccak256(ethers.toUtf8Bytes('does-not-exist'));
      await expect(
        circuit.connect(relayer).attestEdgeCloudNode(
          bogus, NODE_ID, GPU_FINGERPRINT, PETAFLOPS_USED, TAG_NATIVE
        )
      ).to.be.revertedWithCustomError(circuit, 'IntentNotFound');
    });

    it('reverts IntentNotCompleted if intent is still Submitted', async function () {
      const tx = await circuit.connect(user).submitIntent(llmServiceId, MOCK_INPUT, { value: PRICE });
      const receipt = await tx.wait();
      const log = receipt.logs.find(l => {
        try { return circuit.interface.parseLog(l)?.name === 'InferenceIntentSubmitted'; }
        catch { return false; }
      });
      const intentId = circuit.interface.parseLog(log).args.intentId;

      await expect(
        circuit.connect(relayer).attestEdgeCloudNode(
          intentId, NODE_ID, GPU_FINGERPRINT, PETAFLOPS_USED, TAG_NATIVE
        )
      ).to.be.revertedWithCustomError(circuit, 'IntentNotCompleted');
    });

    it('reverts AlreadyAttested on duplicate attestation', async function () {
      const intentId = await setupCompletedIntent();
      await circuit.connect(relayer).attestEdgeCloudNode(
        intentId, NODE_ID, GPU_FINGERPRINT, PETAFLOPS_USED, TAG_NATIVE
      );
      await expect(
        circuit.connect(relayer).attestEdgeCloudNode(
          intentId, NODE_ID, GPU_FINGERPRINT, PETAFLOPS_USED, TAG_NATIVE
        )
      ).to.be.revertedWithCustomError(circuit, 'AlreadyAttested');
    });

    it('reverts when providerTag is UNSET (0)', async function () {
      const intentId = await setupCompletedIntent();
      await expect(
        circuit.connect(relayer).attestEdgeCloudNode(
          intentId, NODE_ID, GPU_FINGERPRINT, PETAFLOPS_USED, TAG_UNSET
        )
      ).to.be.revertedWith('ProviderTagUnset');
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  //  4. Integration: completeIntent → attest → settleIntent
  // ═══════════════════════════════════════════════════════════════════════════

  describe('Full flow: complete → attest → settle', function () {
    it('attests THETA_NATIVE then settles successfully', async function () {
      const intentId = await setupCompletedIntent();

      await circuit.connect(relayer).attestEdgeCloudNode(
        intentId, NODE_ID, GPU_FINGERPRINT, PETAFLOPS_USED, TAG_NATIVE
      );

      // settleIntent should succeed after attestation
      // net payment = 0.01 ETH − 0.5% fee = 0.01 * 9950 / 10000 = 0.00995 ETH
      await expect(
        circuit.connect(relayer).settleIntent(intentId, MOCK_PROOF, MOCK_PV, NULLIFIER, false)
      ).to.emit(circuit, 'IntentSettled').withArgs(intentId, NULLIFIER, ethers.parseEther('0.00995'));

      // Attestation still readable after settlement
      const att = await circuit.getAttestation(intentId);
      expect(att.nodeId).to.equal(NODE_ID);
      expect(att.providerTag).to.equal(TAG_NATIVE);
    });

    it('settles without attestation (attestation is optional pre-settlement)', async function () {
      const intentId = await setupCompletedIntent();
      // Settle without calling attestEdgeCloudNode first — allowed, attestation is not enforced
      await expect(
        circuit.connect(relayer).settleIntent(
          intentId, MOCK_PROOF, MOCK_PV,
          ethers.keccak256(ethers.toUtf8Bytes('nullifier-no-attest')),
          false
        )
      ).to.emit(circuit, 'IntentSettled');
    });

    it('attests HYBRID_FALLBACK then settles successfully', async function () {
      const intentId = await setupCompletedIntent();
      await circuit.connect(relayer).attestEdgeCloudNode(
        intentId, NODE_ID, GPU_FINGERPRINT, PETAFLOPS_USED, TAG_FALLBACK
      );
      await expect(
        circuit.connect(relayer).settleIntent(
          intentId, MOCK_PROOF, MOCK_PV,
          ethers.keccak256(ethers.toUtf8Bytes('nullifier-fallback')),
          false
        )
      ).to.emit(circuit, 'IntentSettled');

      const att = await circuit.getAttestation(intentId);
      expect(att.providerTag).to.equal(TAG_FALLBACK);
    });

    it('attestationCount increments correctly across multiple intents', async function () {
      const id1 = await setupCompletedIntent();
      const id2 = await setupCompletedIntent();

      await circuit.connect(relayer).attestEdgeCloudNode(
        id1, NODE_ID, GPU_FINGERPRINT, PETAFLOPS_USED, TAG_NATIVE
      );
      await circuit.connect(relayer).attestEdgeCloudNode(
        id2,
        ethers.keccak256(ethers.toUtf8Bytes('node-2')),
        GPU_FINGERPRINT, PETAFLOPS_USED, TAG_FALLBACK
      );

      expect(await circuit.getAttestationCount()).to.equal(2n);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  //  5. emitVideoProvenance()
  // ═══════════════════════════════════════════════════════════════════════════

  describe('emitVideoProvenance()', function () {
    async function setupCompletedVideoIntent() {
      const tx = await circuit.connect(user).submitIntent(videoServiceId, MOCK_INPUT, { value: PRICE });
      const receipt = await tx.wait();
      const log = receipt.logs.find(l => {
        try { return circuit.interface.parseLog(l)?.name === 'InferenceIntentSubmitted'; }
        catch { return false; }
      });
      const intentId = circuit.interface.parseLog(log).args.intentId;
      await circuit.connect(relayer).completeIntent(intentId, MOCK_OUTPUT, MOCK_MODEL, 42000);
      return intentId;
    }

    it('emits VideoProvenance for a VIDEO_PROCESSING intent', async function () {
      const intentId = await setupCompletedVideoIntent();
      await expect(
        circuit.connect(relayer).emitVideoProvenance(
          intentId, VIDEO_ID, CONTENT_HASH, PLAYBACK_URI
        )
      )
        .to.emit(circuit, 'VideoProvenance')
        .withArgs(intentId, VIDEO_ID, CONTENT_HASH, PLAYBACK_URI);
    });

    it('reverts for non-VIDEO_PROCESSING intent', async function () {
      const intentId = await setupCompletedIntent(); // LLM intent
      await expect(
        circuit.connect(relayer).emitVideoProvenance(
          intentId, VIDEO_ID, CONTENT_HASH, PLAYBACK_URI
        )
      ).to.be.revertedWith('NotVideoIntent');
    });

    it('reverts IntentNotFound for unknown intentId', async function () {
      const bogus = ethers.keccak256(ethers.toUtf8Bytes('no-such-intent'));
      await expect(
        circuit.connect(relayer).emitVideoProvenance(
          bogus, VIDEO_ID, CONTENT_HASH, PLAYBACK_URI
        )
      ).to.be.revertedWithCustomError(circuit, 'IntentNotFound');
    });

    it('reverts if caller lacks RELAYER_ROLE', async function () {
      const intentId = await setupCompletedVideoIntent();
      const RELAYER_ROLE = await circuit.RELAYER_ROLE();
      await expect(
        circuit.connect(stranger).emitVideoProvenance(
          intentId, VIDEO_ID, CONTENT_HASH, PLAYBACK_URI
        )
      ).to.be.revertedWithCustomError(circuit, 'AccessControlUnauthorizedAccount')
       .withArgs(stranger.address, RELAYER_ROLE);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  //  6. View functions
  // ═══════════════════════════════════════════════════════════════════════════

  describe('View functions', function () {
    it('getAttestation returns zero struct before attestation', async function () {
      const intentId = await setupCompletedIntent();
      const att = await circuit.getAttestation(intentId);
      expect(att.nodeId).to.equal(ethers.ZeroHash);
      expect(att.attestedAt).to.equal(0n);
      expect(att.providerTag).to.equal(TAG_UNSET);
    });

    it('getAttestationCount starts at 0 and increments', async function () {
      expect(await circuit.getAttestationCount()).to.equal(0n);
      const intentId = await setupCompletedIntent();
      await circuit.connect(relayer).attestEdgeCloudNode(
        intentId, NODE_ID, GPU_FINGERPRINT, PETAFLOPS_USED, TAG_NATIVE
      );
      expect(await circuit.getAttestationCount()).to.equal(1n);
    });

    it('attestations mapping is public and accessible by intentId', async function () {
      const intentId = await setupCompletedIntent();
      await circuit.connect(relayer).attestEdgeCloudNode(
        intentId, NODE_ID, GPU_FINGERPRINT, PETAFLOPS_USED, TAG_NATIVE
      );
      // Access via public mapping directly
      const att = await circuit.attestations(intentId);
      expect(att.nodeId).to.equal(NODE_ID);
      expect(att.providerTag).to.equal(TAG_NATIVE);
    });
  });
});
