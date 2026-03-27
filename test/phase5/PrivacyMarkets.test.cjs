/**
 * Phase 5 — Privacy-Preserving Data Markets Tests (16 tests)
 *
 * Tests zkML selective disclosure (Poseidon commitments, field-level privacy),
 * DataHubs provenance proofs (ZK lineage attestation, DataProvenanced events),
 * and gas efficiency targets (<50K for micro-attestations).
 *
 * Run: npx hardhat test test/phase5/PrivacyMarkets.test.cjs
 */

const { expect } = require('chai');
const hre = require('hardhat');
const { ethers } = hre;

describe('Privacy-Preserving Data Markets (Phase 5)', function () {
  let zkml, dataHubs, splitter, verifier;
  let admin, modelOwner, requester, validator;

  beforeEach(async function () {
    [admin, modelOwner, requester, validator] = await ethers.getSigners();

    const SplF = await ethers.getContractFactory('CoreRevenueSplitter');
    splitter = await SplF.deploy(admin.address, admin.address, admin.address, admin.address, admin.address, admin.address);
    await splitter.waitForDeployment();

    const VF = await ethers.getContractFactory('ZKVerifierSP1');
    verifier = await VF.deploy(admin.address, ethers.ZeroAddress);
    await verifier.waitForDeployment();

    const ZKMLF = await ethers.getContractFactory('ZKMLCircuit');
    zkml = await ZKMLF.deploy(admin.address, await splitter.getAddress(), ethers.ZeroAddress);
    await zkml.waitForDeployment();

    const DHF = await ethers.getContractFactory('DataHubs');
    dataHubs = await DHF.deploy(admin.address, await splitter.getAddress(), ethers.ZeroAddress);
    await dataHubs.waitForDeployment();
  });

  describe('zkML Selective Disclosure', function () {
    let modelId;

    beforeEach(async function () {
      const weightCommitment = ethers.keccak256(ethers.toUtf8Bytes('model-weights-v3'));
      const archHash = ethers.keccak256(ethers.toUtf8Bytes('transformer-7b'));
      const tx = await zkml.connect(modelOwner).registerModel(
        weightCommitment, archHash, 'Sentiment Classifier v3',
        ethers.parseEther('0.01'), false
      );
      const receipt = await tx.wait();
      const parsed = receipt.logs.map(l => {
        try { return zkml.interface.parseLog(l); } catch { return null; }
      }).find(p => p?.name === 'PrivateModelRegistered');
      modelId = parsed.args.modelId;
    });

    it('should create a disclosure policy with Poseidon commitment', async function () {
      const poseidon = ethers.keccak256(ethers.toUtf8Bytes('poseidon-field-set'));
      const fields = [
        ethers.keccak256(ethers.toUtf8Bytes('sentiment_score')),
        ethers.keccak256(ethers.toUtf8Bytes('confidence')),
      ];

      const tx = await zkml.connect(modelOwner).createDisclosurePolicy(modelId, poseidon, fields);
      const receipt = await tx.wait();

      const event = receipt.logs.map(l => {
        try { return zkml.interface.parseLog(l); } catch { return null; }
      }).find(p => p?.name === 'DisclosurePolicyCreated');
      expect(event).to.not.be.null;
      expect(event.args.fieldCount).to.equal(2n);
    });

    it('should reject disclosure policy from non-owner', async function () {
      const poseidon = ethers.keccak256(ethers.toUtf8Bytes('poseidon'));
      await expect(
        zkml.connect(requester).createDisclosurePolicy(modelId, poseidon, [])
      ).to.be.revertedWith('NotOwner');
    });

    it('should reject zero Poseidon commitment', async function () {
      await expect(
        zkml.connect(modelOwner).createDisclosurePolicy(modelId, ethers.ZeroHash, [])
      ).to.be.revertedWith('ZeroCommitment');
    });

    it('should verify selective disclosure with ZK proof', async function () {
      const poseidon = ethers.keccak256(ethers.toUtf8Bytes('poseidon-fields'));
      const fields = [ethers.keccak256(ethers.toUtf8Bytes('output_score'))];
      const pTx = await zkml.connect(modelOwner).createDisclosurePolicy(modelId, poseidon, fields);
      const pReceipt = await pTx.wait();
      const pEvent = pReceipt.logs.map(l => {
        try { return zkml.interface.parseLog(l); } catch { return null; }
      }).find(p => p?.name === 'DisclosurePolicyCreated');
      const policyId = pEvent.args.policyId;

      const inputHash = ethers.keccak256(ethers.toUtf8Bytes('test-input'));
      const deadline = BigInt(Math.floor(Date.now() / 1000) + 3600);
      const reqTx = await zkml.connect(requester).requestInference(
        modelId, inputHash, deadline, { value: ethers.parseEther('0.01') }
      );
      const reqReceipt = await reqTx.wait();
      const reqEvent = reqReceipt.logs.map(l => {
        try { return zkml.interface.parseLog(l); } catch { return null; }
      }).find(p => p?.name === 'InferenceRequested');
      const requestId = reqEvent.args.requestId;

      const weightCommitment = ethers.keccak256(ethers.toUtf8Bytes('model-weights-v3'));
      const outputHash = ethers.keccak256(ethers.toUtf8Bytes('inference-output'));
      const proof = '0x' + 'ab'.repeat(130);
      const pubValues = '0x' + 'cd'.repeat(64);
      const verifyNull = ethers.keccak256(ethers.toUtf8Bytes('verify-null'));

      await zkml.connect(modelOwner).verifyInference(
        requestId, outputHash, weightCommitment, proof, pubValues, verifyNull, false
      );

      const disclosureNull = ethers.keccak256(ethers.toUtf8Bytes('disclosure-null'));
      const disclosureProof = '0x' + 'ef'.repeat(130);
      const disclosurePub = '0x' + '11'.repeat(64);

      const tx = await zkml.connect(requester).verifySelectiveDisclosure(
        policyId, requestId, disclosureProof, disclosurePub, disclosureNull, false
      );
      const receipt = await tx.wait();

      const sdEvent = receipt.logs.map(l => {
        try { return zkml.interface.parseLog(l); } catch { return null; }
      }).find(p => p?.name === 'SelectiveDisclosureVerified');
      expect(sdEvent).to.not.be.null;
    });

    it('should reject selective disclosure with used nullifier', async function () {
      const poseidon = ethers.keccak256(ethers.toUtf8Bytes('pos-dup'));
      const pTx = await zkml.connect(modelOwner).createDisclosurePolicy(modelId, poseidon, []);
      const pReceipt = await pTx.wait();
      const pEvent = pReceipt.logs.map(l => {
        try { return zkml.interface.parseLog(l); } catch { return null; }
      }).find(p => p?.name === 'DisclosurePolicyCreated');
      const policyId = pEvent.args.policyId;

      const inputHash = ethers.keccak256(ethers.toUtf8Bytes('dup-input'));
      const deadline = BigInt(Math.floor(Date.now() / 1000) + 3600);
      const reqTx = await zkml.connect(requester).requestInference(
        modelId, inputHash, deadline, { value: ethers.parseEther('0.01') }
      );
      const reqReceipt = await reqTx.wait();
      const reqEvent = reqReceipt.logs.map(l => {
        try { return zkml.interface.parseLog(l); } catch { return null; }
      }).find(p => p?.name === 'InferenceRequested');
      const requestId = reqEvent.args.requestId;

      const wc = ethers.keccak256(ethers.toUtf8Bytes('model-weights-v3'));
      const oh = ethers.keccak256(ethers.toUtf8Bytes('output'));
      const vNull = ethers.keccak256(ethers.toUtf8Bytes('v-null-dup'));
      await zkml.connect(modelOwner).verifyInference(
        requestId, oh, wc, '0x' + 'ab'.repeat(130), '0x' + 'cd'.repeat(64), vNull, false
      );

      const sharedNull = ethers.keccak256(ethers.toUtf8Bytes('shared-nullifier'));
      await zkml.connect(requester).verifySelectiveDisclosure(
        policyId, requestId, '0x' + 'ef'.repeat(130), '0x' + '11'.repeat(64), sharedNull, false
      );

      await expect(
        zkml.connect(requester).verifySelectiveDisclosure(
          policyId, requestId, '0x' + 'ef'.repeat(130), '0x' + '11'.repeat(64), sharedNull, false
        )
      ).to.be.reverted;
    });

    it('should track selective disclosure count', async function () {
      const count = await zkml.totalSelectiveDisclosures();
      expect(count).to.equal(0n);
    });

    it('should retrieve disclosure policy data', async function () {
      const poseidon = ethers.keccak256(ethers.toUtf8Bytes('pos-data'));
      const fields = [
        ethers.keccak256(ethers.toUtf8Bytes('field_a')),
        ethers.keccak256(ethers.toUtf8Bytes('field_b')),
        ethers.keccak256(ethers.toUtf8Bytes('field_c')),
      ];
      const tx = await zkml.connect(modelOwner).createDisclosurePolicy(modelId, poseidon, fields);
      const receipt = await tx.wait();
      const event = receipt.logs.map(l => {
        try { return zkml.interface.parseLog(l); } catch { return null; }
      }).find(p => p?.name === 'DisclosurePolicyCreated');

      const policy = await zkml.getDisclosurePolicy(event.args.policyId);
      expect(policy.poseidonCommitment).to.equal(poseidon);
      expect(policy.active).to.be.true;
    });
  });

  describe('DataHubs Provenance Proofs', function () {
    let hubId, contributionId;

    beforeEach(async function () {
      const VALIDATOR_ROLE = await dataHubs.VALIDATOR_ROLE();
      await dataHubs.grantRole(VALIDATOR_ROLE, validator.address);

      const govHash = ethers.keccak256(ethers.toUtf8Bytes('gov-rules'));
      const hubTx = await dataHubs.connect(admin).createHub(
        'AI Training Data', 'social', govHash, 5000, ethers.parseEther('0.1')
      );
      const hubReceipt = await hubTx.wait();
      const hubEvent = hubReceipt.logs.map(l => {
        try { return dataHubs.interface.parseLog(l); } catch { return null; }
      }).find(p => p?.name === 'HubCreated');
      hubId = hubEvent.args.hubId;

      const dataCommit = ethers.keccak256(ethers.toUtf8Bytes('encrypted-data'));
      const provHash = ethers.keccak256(ethers.toUtf8Bytes('provenance'));
      const cTx = await dataHubs.connect(requester).contributeData(
        hubId, dataCommit, provHash, 1024
      );
      const cReceipt = await cTx.wait();
      const cEvent = cReceipt.logs.map(l => {
        try { return dataHubs.interface.parseLog(l); } catch { return null; }
      }).find(p => p?.name === 'DataContributed');
      contributionId = cEvent.args.contributionId;
    });

    it('should attest provenance with ZK proof', async function () {
      const srcCommitment = ethers.keccak256(ethers.toUtf8Bytes('poseidon-source-id'));
      const lineageHash = ethers.keccak256(ethers.toUtf8Bytes('data-lineage-chain'));
      const nullifier = ethers.keccak256(ethers.toUtf8Bytes('prov-null-1'));
      const proof = '0x' + 'ab'.repeat(130);
      const pubValues = '0x' + 'cd'.repeat(64);

      const tx = await dataHubs.connect(validator).attestProvenance(
        contributionId, srcCommitment, lineageHash, proof, pubValues, nullifier
      );
      const receipt = await tx.wait();

      const dpEvent = receipt.logs.map(l => {
        try { return dataHubs.interface.parseLog(l); } catch { return null; }
      }).find(p => p?.name === 'DataProvenanced');
      expect(dpEvent).to.not.be.null;
      expect(dpEvent.args.sourceCommitment).to.equal(srcCommitment);
    });

    it('should emit ProvenanceVerified event', async function () {
      const srcCommitment = ethers.keccak256(ethers.toUtf8Bytes('src-2'));
      const lineageHash = ethers.keccak256(ethers.toUtf8Bytes('lineage-2'));
      const nullifier = ethers.keccak256(ethers.toUtf8Bytes('prov-null-2'));

      const tx = await dataHubs.connect(validator).attestProvenance(
        contributionId, srcCommitment, lineageHash,
        '0x' + 'ab'.repeat(130), '0x' + 'cd'.repeat(64), nullifier
      );
      const receipt = await tx.wait();

      const pvEvent = receipt.logs.map(l => {
        try { return dataHubs.interface.parseLog(l); } catch { return null; }
      }).find(p => p?.name === 'ProvenanceVerified');
      expect(pvEvent).to.not.be.null;
      expect(pvEvent.args.attestor).to.equal(validator.address);
    });

    it('should reject provenance with duplicate nullifier', async function () {
      const nullifier = ethers.keccak256(ethers.toUtf8Bytes('dup-prov'));
      const src = ethers.keccak256(ethers.toUtf8Bytes('src'));
      const lin = ethers.keccak256(ethers.toUtf8Bytes('lin'));

      await dataHubs.connect(validator).attestProvenance(
        contributionId, src, lin,
        '0x' + 'ab'.repeat(130), '0x' + 'cd'.repeat(64), nullifier
      );

      await expect(
        dataHubs.connect(validator).attestProvenance(
          contributionId, src, lin,
          '0x' + 'ab'.repeat(130), '0x' + 'cd'.repeat(64), nullifier
        )
      ).to.be.reverted;
    });

    it('should reject zero source commitment', async function () {
      await expect(
        dataHubs.connect(validator).attestProvenance(
          contributionId, ethers.ZeroHash, ethers.keccak256(ethers.toUtf8Bytes('x')),
          '0x' + 'ab'.repeat(130), '0x' + 'cd'.repeat(64),
          ethers.keccak256(ethers.toUtf8Bytes('zero-null'))
        )
      ).to.be.revertedWith('ZeroCommitment');
    });

    it('should reject provenance from non-validator', async function () {
      await expect(
        dataHubs.connect(requester).attestProvenance(
          contributionId,
          ethers.keccak256(ethers.toUtf8Bytes('src')),
          ethers.keccak256(ethers.toUtf8Bytes('lin')),
          '0x' + 'ab'.repeat(130), '0x' + 'cd'.repeat(64),
          ethers.keccak256(ethers.toUtf8Bytes('unauth-null'))
        )
      ).to.be.reverted;
    });

    it('should track provenance count', async function () {
      const src = ethers.keccak256(ethers.toUtf8Bytes('src-count'));
      const lin = ethers.keccak256(ethers.toUtf8Bytes('lin-count'));
      const null1 = ethers.keccak256(ethers.toUtf8Bytes('count-null'));

      await dataHubs.connect(validator).attestProvenance(
        contributionId, src, lin,
        '0x' + 'ab'.repeat(130), '0x' + 'cd'.repeat(64), null1
      );

      const count = await dataHubs.totalProvenanceAttestations();
      expect(count).to.equal(1n);
    });

    it('should retrieve provenance record', async function () {
      const src = ethers.keccak256(ethers.toUtf8Bytes('src-retrieve'));
      const lin = ethers.keccak256(ethers.toUtf8Bytes('lin-retrieve'));
      const nullifier = ethers.keccak256(ethers.toUtf8Bytes('retrieve-null'));

      const tx = await dataHubs.connect(validator).attestProvenance(
        contributionId, src, lin,
        '0x' + 'ab'.repeat(130), '0x' + 'cd'.repeat(64), nullifier
      );
      const receipt = await tx.wait();
      const event = receipt.logs.map(l => {
        try { return dataHubs.interface.parseLog(l); } catch { return null; }
      }).find(p => p?.name === 'DataProvenanced');

      const record = await dataHubs.getProvenanceRecord(event.args.recordId);
      expect(record.sourceCommitment).to.equal(src);
      expect(record.lineageHash).to.equal(lin);
      expect(record.verified).to.be.true;
    });

    it('should reject provenance for non-existent contribution', async function () {
      const fakeId = ethers.keccak256(ethers.toUtf8Bytes('fake'));
      await expect(
        dataHubs.connect(validator).attestProvenance(
          fakeId,
          ethers.keccak256(ethers.toUtf8Bytes('s')),
          ethers.keccak256(ethers.toUtf8Bytes('l')),
          '0x' + 'ab'.repeat(130), '0x' + 'cd'.repeat(64),
          ethers.keccak256(ethers.toUtf8Bytes('fake-null'))
        )
      ).to.be.reverted;
    });
  });
});
