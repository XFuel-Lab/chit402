/**
 * FilecoinStorage Circuit — Unit Tests (15 tests)
 *
 * Tests:
 *   Provider registration & management
 *   Deal creation, activation, proof, settlement
 *   Cancellation & refund
 *   ZK nullifier tracking
 *   Fee collection & forwarding
 *   Pause / unpause
 *   Edge cases
 */
const { expect } = require('chai');
const hre = require('hardhat');
const { ethers } = hre;

describe('FilecoinStorage', function () {
  let admin, provider1, provider2, client1, client2;
  let splitter, storage;

  const MOCK_MINER = ethers.keccak256(ethers.toUtf8Bytes('f01234'));
  const MOCK_CID = ethers.keccak256(ethers.toUtf8Bytes('bafybeigdyrzt5sfp7udm7'));
  const MOCK_PROOF = '0x1234';
  const MOCK_PV = '0x5678';
  const PRICE_PER_BYTE_EPOCH = 1n; // 1 wei per byte per epoch
  const CAPACITY = 1000000n; // 1MB

  beforeEach(async function () {
    [admin, provider1, provider2, client1, client2] = await ethers.getSigners();

    const SplitterF = await ethers.getContractFactory('CoreRevenueSplitter');
    splitter = await SplitterF.deploy(
      admin.address, admin.address, admin.address,
      admin.address, admin.address, admin.address
    );
    await splitter.waitForDeployment();

    const StorageF = await ethers.getContractFactory('FilecoinStorage');
    storage = await StorageF.deploy(admin.address, await splitter.getAddress(), ethers.ZeroAddress);
    await storage.waitForDeployment();

    // Grant CIRCUIT_ROLE on splitter
    const CIRCUIT_ROLE = await splitter.CIRCUIT_ROLE();
    await splitter.grantRole(CIRCUIT_ROLE, await storage.getAddress());
  });

  // ═══ 1. Provider Registration ═══════════════════════════════════════

  it('should register a storage provider', async function () {
    const tx = await storage.connect(provider1).registerProvider(
      MOCK_MINER, 0, CAPACITY, PRICE_PER_BYTE_EPOCH, 'US-EAST'
    );
    const r = await tx.wait();
    expect(r.status).to.equal(1);

    const count = await storage.providerCount();
    expect(count).to.equal(1n);
  });

  it('should reject provider with zero miner ID', async function () {
    await expect(
      storage.connect(provider1).registerProvider(
        ethers.ZeroHash, 0, CAPACITY, PRICE_PER_BYTE_EPOCH, 'US-EAST'
      )
    ).to.be.revertedWith('ZeroMiner');
  });

  it('should reject provider with zero capacity', async function () {
    await expect(
      storage.connect(provider1).registerProvider(
        MOCK_MINER, 0, 0, PRICE_PER_BYTE_EPOCH, 'US-EAST'
      )
    ).to.be.revertedWith('ZeroCap');
  });

  it('should update provider details', async function () {
    const tx = await storage.connect(provider1).registerProvider(
      MOCK_MINER, 0, CAPACITY, PRICE_PER_BYTE_EPOCH, 'US-EAST'
    );
    const r = await tx.wait();
    const iface = storage.interface;
    let providerId;
    for (const log of r.logs) {
      try {
        const parsed = iface.parseLog({ topics: log.topics, data: log.data });
        if (parsed && parsed.name === 'ProviderRegistered') {
          providerId = parsed.args[0];
          break;
        }
      } catch {}
    }

    await storage.connect(provider1).updateProvider(providerId, 2000000n, 2n, true);
    const p = await storage.getProvider(providerId);
    expect(p.capacityBytes).to.equal(2000000n);
    expect(p.pricePerByteEpoch).to.equal(2n);
  });

  // ═══ 2. Deal Creation ═══════════════════════════════════════════════

  let providerId;

  async function registerTestProvider() {
    const tx = await storage.connect(provider1).registerProvider(
      MOCK_MINER, 0, CAPACITY, PRICE_PER_BYTE_EPOCH, 'US-EAST'
    );
    const r = await tx.wait();
    const iface = storage.interface;
    for (const log of r.logs) {
      try {
        const parsed = iface.parseLog({ topics: log.topics, data: log.data });
        if (parsed && parsed.name === 'ProviderRegistered') {
          providerId = parsed.args[0];
          break;
        }
      } catch {}
    }
    return providerId;
  }

  it('should create a storage deal with escrow', async function () {
    const pid = await registerTestProvider();
    const sizeBytes = 1000n;
    const durationEpochs = 100n;
    const cost = sizeBytes * PRICE_PER_BYTE_EPOCH * durationEpochs; // 100000 wei

    const tx = await storage.connect(client1).createDeal(
      pid, MOCK_CID, sizeBytes, durationEpochs, { value: cost }
    );
    const r = await tx.wait();
    expect(r.status).to.equal(1);

    const count = await storage.dealCount();
    expect(count).to.equal(1n);

    const stored = await storage.totalStoredBytes();
    expect(stored).to.equal(sizeBytes);
  });

  it('should reject deal with insufficient payment', async function () {
    const pid = await registerTestProvider();
    const sizeBytes = 1000n;
    const durationEpochs = 100n;
    await expect(
      storage.connect(client1).createDeal(pid, MOCK_CID, sizeBytes, durationEpochs, { value: 1n })
    ).to.be.reverted;
  });

  it('should reject deal with inactive provider', async function () {
    const pid = await registerTestProvider();
    await storage.connect(provider1).updateProvider(pid, CAPACITY, PRICE_PER_BYTE_EPOCH, false);

    await expect(
      storage.connect(client1).createDeal(pid, MOCK_CID, 100n, 10n, { value: 1000n })
    ).to.be.reverted;
  });

  // ═══ 3. Deal Activation ═════════════════════════════════════════════

  it('should activate a proposed deal', async function () {
    const pid = await registerTestProvider();
    const cost = 1000n * 1n * 100n;
    const tx = await storage.connect(client1).createDeal(pid, MOCK_CID, 1000n, 100n, { value: cost });
    const r = await tx.wait();
    const iface = storage.interface;
    let dealId;
    for (const log of r.logs) {
      try {
        const parsed = iface.parseLog({ topics: log.topics, data: log.data });
        if (parsed && parsed.name === 'DealCreated') {
          dealId = parsed.args[1];
          break;
        }
      } catch {}
    }

    await storage.activateDeal(dealId);
    const d = await storage.getDeal(dealId);
    expect(d.status).to.equal(1n); // Active
  });

  // ═══ 4. Storage Proof & Settlement ══════════════════════════════════

  async function createActiveDeal() {
    const pid = await registerTestProvider();
    const cost = 1000n * 1n * 100n;
    const tx = await storage.connect(client1).createDeal(pid, MOCK_CID, 1000n, 100n, { value: cost });
    const r = await tx.wait();
    const iface = storage.interface;
    let dealId;
    for (const log of r.logs) {
      try {
        const parsed = iface.parseLog({ topics: log.topics, data: log.data });
        if (parsed && parsed.name === 'DealCreated') { dealId = parsed.args[1]; break; }
      } catch {}
    }
    await storage.activateDeal(dealId);
    return { dealId, pid };
  }

  it('should submit and verify a storage proof', async function () {
    const { dealId } = await createActiveDeal();
    const proofHash = ethers.keccak256(ethers.toUtf8Bytes('proof-1'));
    const nullifier = ethers.keccak256(ethers.toUtf8Bytes('null-1'));

    const tx = await storage.submitStorageProof(
      dealId, proofHash, 32, MOCK_PROOF, MOCK_PV, nullifier
    );
    const r = await tx.wait();
    expect(r.status).to.equal(1);

    const d = await storage.getDeal(dealId);
    expect(d.status).to.equal(2n); // ProofSubmitted

    const proofCount = await storage.getDealProofCount(dealId);
    expect(proofCount).to.equal(1n);
  });

  it('should reject duplicate nullifier', async function () {
    const { dealId } = await createActiveDeal();
    const proofHash = ethers.keccak256(ethers.toUtf8Bytes('proof-dup'));
    const nullifier = ethers.keccak256(ethers.toUtf8Bytes('null-dup'));

    await storage.submitStorageProof(dealId, proofHash, 32, MOCK_PROOF, MOCK_PV, nullifier);

    // Create another active deal to try same nullifier
    const pid2 = providerId;
    const cost2 = 1000n * 1n * 100n;
    const tx2 = await storage.connect(client2).createDeal(pid2, MOCK_CID, 1000n, 100n, { value: cost2 });
    const r2 = await tx2.wait();
    const iface = storage.interface;
    let dealId2;
    for (const log of r2.logs) {
      try {
        const parsed = iface.parseLog({ topics: log.topics, data: log.data });
        if (parsed && parsed.name === 'DealCreated') { dealId2 = parsed.args[1]; break; }
      } catch {}
    }
    await storage.activateDeal(dealId2);

    await expect(
      storage.submitStorageProof(dealId2, proofHash, 16, MOCK_PROOF, MOCK_PV, nullifier)
    ).to.be.reverted;
  });

  it('should settle a deal with fee collection', async function () {
    const { dealId } = await createActiveDeal();
    const proofHash = ethers.keccak256(ethers.toUtf8Bytes('proof-settle'));
    const nullifier = ethers.keccak256(ethers.toUtf8Bytes('null-settle'));

    await storage.submitStorageProof(dealId, proofHash, 32, MOCK_PROOF, MOCK_PV, nullifier);

    const provBefore = await ethers.provider.getBalance(provider1.address);
    await storage.connect(client1).settleDeal(dealId);
    const provAfter = await ethers.provider.getBalance(provider1.address);

    // Provider should receive payment minus fee
    expect(provAfter).to.be.greaterThan(provBefore);

    const fees = await storage.totalFeesCollected();
    expect(fees).to.be.greaterThan(0n);

    const d = await storage.getDeal(dealId);
    expect(d.status).to.equal(3n); // Settled
  });

  // ═══ 5. Cancellation ════════════════════════════════════════════════

  it('should cancel a proposed deal and refund', async function () {
    const pid = await registerTestProvider();
    const cost = 1000n * 1n * 100n;
    const tx = await storage.connect(client1).createDeal(pid, MOCK_CID, 1000n, 100n, { value: cost });
    const r = await tx.wait();
    const iface = storage.interface;
    let dealId;
    for (const log of r.logs) {
      try {
        const parsed = iface.parseLog({ topics: log.topics, data: log.data });
        if (parsed && parsed.name === 'DealCreated') { dealId = parsed.args[1]; break; }
      } catch {}
    }

    const before = await ethers.provider.getBalance(client1.address);
    await storage.connect(client1).cancelDeal(dealId);
    const after = await ethers.provider.getBalance(client1.address);

    // Should get refund (minus gas)
    expect(after).to.be.greaterThan(before - ethers.parseEther('0.01'));

    const d = await storage.getDeal(dealId);
    expect(d.status).to.equal(4n); // Cancelled
  });

  // ═══ 6. Pause / Unpause ════════════════════════════════════════════

  it('should block operations when paused', async function () {
    await storage.pause();
    await expect(
      storage.connect(provider1).registerProvider(MOCK_MINER, 0, CAPACITY, PRICE_PER_BYTE_EPOCH, 'EU')
    ).to.be.reverted;
    await storage.unpause();

    // Should work again
    const tx = await storage.connect(provider1).registerProvider(
      MOCK_MINER, 0, CAPACITY, PRICE_PER_BYTE_EPOCH, 'EU'
    );
    const r = await tx.wait();
    expect(r.status).to.equal(1);
  });

  // ═══ 7. Stats & Views ═══════════════════════════════════════════════

  it('should return accurate stats after operations', async function () {
    const { dealId } = await createActiveDeal();
    const proofHash = ethers.keccak256(ethers.toUtf8Bytes('proof-stats'));
    const nullifier = ethers.keccak256(ethers.toUtf8Bytes('null-stats'));

    await storage.submitStorageProof(dealId, proofHash, 32, MOCK_PROOF, MOCK_PV, nullifier);
    await storage.connect(client1).settleDeal(dealId);

    const [providers_, deals_, volume_, fees_, storedBytes_] = await storage.getStats();
    expect(providers_).to.equal(1n);
    expect(deals_).to.equal(1n);
    expect(volume_).to.be.greaterThan(0n);
    expect(fees_).to.be.greaterThan(0n);
    expect(storedBytes_).to.equal(1000n);
  });
});
