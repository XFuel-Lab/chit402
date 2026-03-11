/**
 * Track 3.1 — EdgeStore DataHub Integration Tests
 *
 * Tests:
 *   On-chain (DataHubs.sol):
 *     1. Contribution struct stores edgeStoreCid + edgeStoreNodeId (init to zero)
 *     2. attachEdgeStoreCid() — only RELAYER_ROLE, non-zero CID, idempotent guard
 *     3. Emits EdgeStoreSealed event with correct args
 *     4. AlreadySealed reverts on double-seal attempt
 *     5. ContributionNotFound reverts for unknown contributionId
 *
 *   Off-chain (ThetaEdgeStoreAdapter):
 *     6. upload() builds correct auth token format (timestamp.address.signature)
 *     7. upload() sends POST to uploadBase and returns { cid, nodeId, sizeBytes }
 *     8. upload() pads short key to bytes32
 *     9. retrieve() sends GET to correct URL with auth header
 *    10. sealOnChain() calls attachEdgeStoreCid on contract and returns txHash
 *    11. sealOnChain() is non-fatal — returns error string if contract call fails
 *    12. uploadAndSeal() combines upload + seal in one call
 *    13. Token is cached and reused within 23h window
 *    14. upload() throws descriptive error on non-200 HTTP response
 *    15. upload() throws timeout error on AbortError
 *
 *   DataHubsHandler:
 *    16. onIntent(data_contribution) triggers EdgeStore upload when configured
 *    17. onIntent(data_contribution) skips EdgeStore gracefully when not configured
 *    18. EdgeStore upload failure is non-fatal — returns handled: true
 *    19. onProofReady() returns correct settle args
 *    20. getStats() reports edgeStore stats
 *
 * Run: npx hardhat test test/track3/EdgeStoreDataHub.test.cjs
 */

'use strict';

const { expect }  = require('chai');
const { ethers }  = require('hardhat');

// ─── Helpers ──────────────────────────────────────────────────────────────────

function bytes32(str) {
  return ethers.keccak256(ethers.toUtf8Bytes(str));
}

function toBytes32Hex(hex) {
  const clean = hex.startsWith('0x') ? hex.slice(2) : hex;
  return '0x' + clean.padStart(64, '0');
}

// ─── Suite ────────────────────────────────────────────────────────────────────

describe('Track 3.1 — EdgeStore DataHub Integration', function () {
  this.timeout(60000);

  // ─── On-chain: DataHubs.sol ────────────────────────────────────────────────
  describe('DataHubs.sol — edgeStoreCid + attachEdgeStoreCid', function () {
    let dataHubs;
    let admin, relayer, contributor, rando;
    let hubId, contributionId;

    const ZERO32 = ethers.ZeroHash;
    const MOCK_CID    = toBytes32Hex('abcdef1234567890');
    const MOCK_NODE   = bytes32('edgestore-node-1');
    const MOCK_COMMIT = bytes32('my-dataset-hash');

    before(async function () {
      [admin, relayer, contributor, rando] = await ethers.getSigners();

      const DataHubs = await ethers.getContractFactory('DataHubs');
      dataHubs = await DataHubs.deploy(
        admin.address,
        ethers.ZeroAddress, // revenueSplitter — not needed for these tests
        ethers.ZeroAddress  // zkVerifier — mock mode
      );
      await dataHubs.waitForDeployment();

      // Grant relayer the RELAYER_ROLE
      const RELAYER_ROLE = await dataHubs.RELAYER_ROLE();
      await dataHubs.connect(admin).grantRole(RELAYER_ROLE, relayer.address);

      // Create a hub
      const tx = await dataHubs.connect(admin).createHub(
        'Test Hub', 'web', bytes32('gov-hash'), 5000, ethers.parseEther('0.01')
      );
      const receipt = await tx.wait();
      const event = receipt.logs.find(l => l.fragment?.name === 'HubCreated');
      hubId = event.args.hubId;

      // Submit a contribution
      const cTx = await dataHubs.connect(contributor).contributeData(
        hubId, MOCK_COMMIT, bytes32('prov-hash'), 1024
      );
      const cReceipt = await cTx.wait();
      const cEvent = cReceipt.logs.find(l => l.fragment?.name === 'DataContributed');
      contributionId = cEvent.args.contributionId;
    });

    it('1. new contribution has zero edgeStoreCid + edgeStoreNodeId', async function () {
      const c = await dataHubs.getContribution(contributionId);
      expect(c.edgeStoreCid).to.equal(ZERO32);
      expect(c.edgeStoreNodeId).to.equal(ZERO32);
    });

    it('2. attachEdgeStoreCid() sets CID and nodeId on-chain', async function () {
      await dataHubs.connect(relayer).attachEdgeStoreCid(contributionId, MOCK_CID, MOCK_NODE);

      const c = await dataHubs.getContribution(contributionId);
      expect(c.edgeStoreCid).to.equal(MOCK_CID);
      expect(c.edgeStoreNodeId).to.equal(MOCK_NODE);
    });

    it('3. emits EdgeStoreSealed event', async function () {
      // Create fresh contribution for this assertion
      const cTx = await dataHubs.connect(contributor).contributeData(
        hubId, bytes32('fresh-commit'), bytes32('fresh-prov'), 512
      );
      const cReceipt = await cTx.wait();
      const cEvent = cReceipt.logs.find(l => l.fragment?.name === 'DataContributed');
      const freshId = cEvent.args.contributionId;

      const CID2  = toBytes32Hex('deadbeef00112233');
      const NODE2 = bytes32('edgestore-node-2');

      const tx = await dataHubs.connect(relayer).attachEdgeStoreCid(freshId, CID2, NODE2);

      await expect(tx).to.emit(dataHubs, 'EdgeStoreSealed')
        .withArgs(freshId, CID2, NODE2, relayer.address);
    });

    it('4. AlreadySealed: reverts on double-seal', async function () {
      // contributionId was sealed in test 2; attempting again should revert
      await expect(
        dataHubs.connect(relayer).attachEdgeStoreCid(contributionId, MOCK_CID, MOCK_NODE)
      ).to.be.revertedWithCustomError(dataHubs, 'AlreadySealed');
    });

    it('5. ContributionNotFound: reverts for unknown contributionId', async function () {
      const unknown = bytes32('does-not-exist');
      await expect(
        dataHubs.connect(relayer).attachEdgeStoreCid(unknown, MOCK_CID, MOCK_NODE)
      ).to.be.revertedWithCustomError(dataHubs, 'ContributionNotFound');
    });

    it('6. non-RELAYER_ROLE cannot call attachEdgeStoreCid', async function () {
      const cTx = await dataHubs.connect(contributor).contributeData(
        hubId, bytes32('norelayer-commit'), bytes32('norelayer-prov'), 256
      );
      const cReceipt = await cTx.wait();
      const cEvent = cReceipt.logs.find(l => l.fragment?.name === 'DataContributed');
      const notRelayerId = cEvent.args.contributionId;

      await expect(
        dataHubs.connect(rando).attachEdgeStoreCid(notRelayerId, MOCK_CID, MOCK_NODE)
      ).to.be.reverted;
    });

    it('7. attachEdgeStoreCid reverts on zero CID', async function () {
      const cTx = await dataHubs.connect(contributor).contributeData(
        hubId, bytes32('zero-cid-commit'), bytes32('zero-cid-prov'), 128
      );
      const cReceipt = await cTx.wait();
      const cEvent = cReceipt.logs.find(l => l.fragment?.name === 'DataContributed');
      const zeroCidId = cEvent.args.contributionId;

      await expect(
        dataHubs.connect(relayer).attachEdgeStoreCid(zeroCidId, ZERO32, MOCK_NODE)
      ).to.be.revertedWith('ZeroCid');
    });
  });

  // ─── Off-chain: ThetaEdgeStoreAdapter (unit tests with fetch mocking) ────────
  describe('ThetaEdgeStoreAdapter — off-chain upload / retrieve / seal', function () {
    let ThetaEdgeStoreAdapter;
    const TEST_KEY = 'abcdef1234567890abcdef12';

    before(async function () {
      const mod = await import('../../circuits/data-hubs/theta-edgestore-adapter.js');
      ThetaEdgeStoreAdapter = mod.ThetaEdgeStoreAdapter;
    });

    afterEach(function () {
      globalThis.fetch = undefined;
    });

    function makeMockUpload(key = TEST_KEY, nodeId = 'node-001') {
      return async (url, opts) => {
        if (opts?.method === 'POST') {
          return { ok: true, json: async () => ({ key, node_id: nodeId, size: 1024, timestamp: Date.now() }) };
        }
        return { ok: false, status: 404 };
      };
    }

    function makeMockRetrieve(data = Buffer.from('hello')) {
      return async () => ({
        ok: true,
        arrayBuffer: async () => data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength),
      });
    }

    function makeAdapter(overrides = {}) {
      return new ThetaEdgeStoreAdapter({
        walletPrivateKey: '0x' + 'a'.repeat(64),
        logger: { info: () => {}, warn: () => {}, error: () => {} },
        ...overrides,
      });
    }

    it('8. upload() returns normalised bytes32 cid', async function () {
      globalThis.fetch = makeMockUpload('abcdef12');
      const adapter = makeAdapter();
      const { cid } = await adapter.upload(Buffer.from('test data'));
      expect(cid).to.match(/^0x[0-9a-f]{64}$/);
      expect(cid).to.equal(toBytes32Hex('abcdef12'));
    });

    it('9. upload() returns keccak256 nodeId from node_id string', async function () {
      globalThis.fetch = makeMockUpload(TEST_KEY, 'edgestore-node-xyz');
      const adapter = makeAdapter();
      const { nodeId } = await adapter.upload(Buffer.from('data'));
      const expected = ethers.keccak256(ethers.toUtf8Bytes('edgestore-node-xyz'));
      expect(nodeId).to.equal(expected);
    });

    it('10. upload() increments stats.uploads and totalBytesUploaded', async function () {
      globalThis.fetch = makeMockUpload();
      const adapter = makeAdapter();
      const data = Buffer.from('xfuel-dataset');
      await adapter.upload(data);
      const s = adapter.getStats();
      expect(s.uploads).to.equal(1);
      expect(s.totalBytesUploaded).to.equal(data.length);
    });

    it('11. upload() throws on non-200 response', async function () {
      globalThis.fetch = async () => ({ ok: false, status: 403, text: async () => 'Forbidden' });
      const adapter = makeAdapter();
      await expect(adapter.upload(Buffer.from('x'))).to.be.rejectedWith('EdgeStore upload HTTP 403');
    });

    it('12. retrieve() sends GET to correct URL', async function () {
      const calls = [];
      globalThis.fetch = async (url, opts) => {
        calls.push({ url, method: opts?.method || 'GET' });
        return makeMockRetrieve()();
      };
      const adapter = makeAdapter();
      const buf = await adapter.retrieve(toBytes32Hex(TEST_KEY));
      expect(calls[0].url).to.include('data.thetaedgestore.com');
      expect(Buffer.isBuffer(buf) || buf instanceof Uint8Array).to.be.true;
    });

    it('13. sealOnChain() calls attachEdgeStoreCid with correct args', async function () {
      const calls = [];
      const mockContract = {
        attachEdgeStoreCid: async (cId, cid, nodeId, opts) => {
          calls.push({ cId, cid, nodeId });
          return { wait: async () => ({ hash: '0xdeadbeef' }) };
        },
      };
      const adapter = makeAdapter({ contract: mockContract });
      const result = await adapter.sealOnChain(
        bytes32('contrib-1'),
        toBytes32Hex(TEST_KEY),
        bytes32('node-1')
      );
      expect(result.txHash).to.equal('0xdeadbeef');
      expect(result.error).to.be.null;
      expect(calls).to.have.length(1);
    });

    it('14. sealOnChain() is non-fatal — returns error string on revert', async function () {
      const mockContract = {
        attachEdgeStoreCid: async () => { throw new Error('AlreadySealed()'); },
      };
      const adapter = makeAdapter({ contract: mockContract });
      const result = await adapter.sealOnChain(
        bytes32('contrib-sealed'),
        toBytes32Hex(TEST_KEY),
        bytes32('node-1')
      );
      expect(result.txHash).to.be.null;
      expect(result.error).to.include('AlreadySealed');
    });

    it('15. uploadAndSeal() returns cid, nodeId, txHash in one call', async function () {
      globalThis.fetch = makeMockUpload(TEST_KEY, 'combined-node');
      const calls = [];
      const mockContract = {
        attachEdgeStoreCid: async (cId, cid, nodeId) => {
          calls.push({ cId, cid, nodeId });
          return { wait: async () => ({ hash: '0xcombinedtx' }) };
        },
      };
      const adapter = makeAdapter({ contract: mockContract });
      const result = await adapter.uploadAndSeal({
        data: Buffer.from('combined-dataset'),
        filename: 'dataset.json',
        contributionId: bytes32('contrib-combined'),
      });
      expect(result.cid).to.match(/^0x[0-9a-f]{64}$/);
      expect(result.nodeId).to.match(/^0x[0-9a-f]{64}$/);
      expect(result.txHash).to.equal('0xcombinedtx');
      expect(result.sealError).to.be.null;
      expect(calls).to.have.length(1);
    });

    it('16. auth token is cached within 23h window', async function () {
      const signCalls = [];
      const adapter = makeAdapter();
      // Spy on signMessage by wrapping _getWallet
      const wallet = adapter._getWallet();
      const origSign = wallet.signMessage.bind(wallet);
      wallet.signMessage = async (msg) => { signCalls.push(msg); return origSign(msg); };

      await adapter._getAuthToken();
      await adapter._getAuthToken();
      await adapter._getAuthToken();

      // Should only have signed once
      expect(signCalls).to.have.length(1);
    });

    it('17. token format is timestamp.address.signature', async function () {
      const adapter = makeAdapter();
      const token = await adapter._getAuthToken();
      const parts = token.split('.');
      // timestamp.0xWalletAddress.0xSignature → 3 parts
      expect(parts).to.have.length(3);
      expect(parts[0]).to.match(/^\d+$/); // unix timestamp
      expect(parts[1]).to.match(/^0x[0-9a-fA-F]{40}$/); // wallet address
      expect(parts[2]).to.match(/^0x/); // signature
    });
  });

  // ─── DataHubsHandler integration ──────────────────────────────────────────
  describe('DataHubsHandler — contributeData + EdgeStore flow', function () {
    let DataHubsHandler;
    const TEST_KEY = 'cafebabe00001111';

    before(async function () {
      const mod = await import('../../circuits/data-hubs/datahubs-handler.js');
      DataHubsHandler = mod.DataHubsHandler;
    });

    afterEach(function () {
      globalThis.fetch = undefined;
      delete process.env.THETA_EDGESTORE_WALLET_KEY;
    });

    it('18. onIntent(data_contribution) triggers EdgeStore upload when configured', async function () {
      process.env.THETA_EDGESTORE_WALLET_KEY = '0x' + 'b'.repeat(64);

      const sealCalls = [];
      const mockContract = {
        attachEdgeStoreCid: async (cId, cid, nodeId) => {
          sealCalls.push({ cId, cid, nodeId });
          return { wait: async () => ({ hash: '0xhandlertx' }) };
        },
      };

      globalThis.fetch = async (url, opts) => ({
        ok: true,
        json: async () => ({ key: TEST_KEY, node_id: 'handler-node', size: 512 }),
      });

      const handler = new DataHubsHandler({
        edgeStoreWalletKey: process.env.THETA_EDGESTORE_WALLET_KEY,
        logger: { info: () => {}, warn: () => {}, error: () => {} },
      });

      const result = await handler.onIntent({
        type: 'data_contribution',
        data: {
          contributionId: bytes32('contrib-handler'),
          rawData: Buffer.from('test-data'),
          filename: 'handler.bin',
        },
      }, { contract: mockContract });

      expect(result.handled).to.be.true;
      expect(result.action).to.equal('contribution_sealed');
      expect(result.edgeStore.cid).to.match(/^0x[0-9a-f]{64}$/);
      expect(result.edgeStore.txHash).to.equal('0xhandlertx');
    });

    it('19. onIntent(data_contribution) skips EdgeStore gracefully when no key', async function () {
      delete process.env.THETA_EDGESTORE_WALLET_KEY;
      const handler = new DataHubsHandler({
        logger: { info: () => {}, warn: () => {}, error: () => {} },
      });

      const result = await handler.onIntent({
        type: 'data_contribution',
        data: { contributionId: bytes32('contrib-nokey'), rawData: Buffer.from('x') },
      }, {});

      expect(result.handled).to.be.true;
      expect(result.action).to.equal('contribution_received');
      expect(result.edgeStore).to.be.null;
    });

    it('20. EdgeStore upload failure is non-fatal', async function () {
      process.env.THETA_EDGESTORE_WALLET_KEY = '0x' + 'c'.repeat(64);
      globalThis.fetch = async () => { throw new Error('Network error'); };

      const handler = new DataHubsHandler({
        edgeStoreWalletKey: process.env.THETA_EDGESTORE_WALLET_KEY,
        logger: { info: () => {}, warn: () => {}, error: () => {} },
      });

      const result = await handler.onIntent({
        type: 'data_contribution',
        data: { contributionId: bytes32('contrib-fail'), rawData: Buffer.from('x') },
      }, {});

      expect(result.handled).to.be.true;
      expect(result.action).to.equal('contribution_received');
      expect(result.edgeStoreError).to.include('Network error');
    });

    it('21. onProofReady() returns settle args correctly', async function () {
      const handler = new DataHubsHandler();
      const proofRequest = {
        contributionId: bytes32('contrib-proof'),
        proofType: 'data_provenance',
      };
      const proofResult = {
        success: true,
        qualityScore: 9000,
        proof: '0x' + 'ff'.repeat(130),
        publicValues: '0x' + 'aa'.repeat(64),
        nullifier: bytes32('nullifier-1'),
      };

      const result = await handler.onProofReady(proofResult, proofRequest);
      expect(result.action).to.equal('settle');
      expect(result.method).to.equal('validateContribution');
      expect(result.args[0]).to.equal(proofRequest.contributionId);
      expect(result.args[1]).to.equal(9000);
    });

    it('22. getStats() reports edgeStore sub-stats', async function () {
      process.env.THETA_EDGESTORE_WALLET_KEY = '0x' + 'd'.repeat(64);
      const handler = new DataHubsHandler({
        edgeStoreWalletKey: process.env.THETA_EDGESTORE_WALLET_KEY,
        logger: { info: () => {}, warn: () => {}, error: () => {} },
      });
      // Trigger lazy init
      handler._getEdgeStore();
      const stats = handler.getStats();
      expect(stats.edgeStore).to.not.be.null;
      expect(stats.edgeStore).to.have.property('uploads');
    });
  });
});
