/**
 * EnergyGrid Circuit — Unit Tests (15 tests)
 *
 * Tests:
 *   Node registration & management
 *   ZK-verified energy attestation
 *   P2P trading lifecycle (create, buy, settle, cancel)
 *   Carbon credit issuance
 *   Nullifier tracking
 *   Fee collection
 *   Pause / unpause
 *   Stats accuracy
 */
const { expect } = require('chai');
const hre = require('hardhat');
const { ethers } = hre;

describe('EnergyGrid', function () {
  let admin, nodeOwner1, nodeOwner2, buyer1, buyer2;
  let splitter, grid;

  const MOCK_LOCATION = ethers.keccak256(ethers.toUtf8Bytes('37.7749,-122.4194,zone-a'));
  const MOCK_METER = ethers.keccak256(ethers.toUtf8Bytes('meter-reading-001'));
  const MOCK_PROOF = '0x1234';
  const MOCK_PV = '0x5678';
  const CAPACITY = 10000n; // 10kW peak

  beforeEach(async function () {
    [admin, nodeOwner1, nodeOwner2, buyer1, buyer2] = await ethers.getSigners();

    const SplitterF = await ethers.getContractFactory('CoreRevenueSplitter');
    splitter = await SplitterF.deploy(
      admin.address, admin.address, admin.address,
      admin.address, admin.address, admin.address
    );
    await splitter.waitForDeployment();

    const GridF = await ethers.getContractFactory('EnergyGrid');
    grid = await GridF.deploy(admin.address, await splitter.getAddress(), ethers.ZeroAddress);
    await grid.waitForDeployment();

    const CIRCUIT_ROLE = await splitter.CIRCUIT_ROLE();
    await splitter.grantRole(CIRCUIT_ROLE, await grid.getAddress());
  });

  // Helper: register a node and return its ID
  async function registerNode(owner, nodeType, capacity) {
    const tx = await grid.connect(owner).registerNode(
      nodeType || 0, MOCK_LOCATION, capacity || CAPACITY
    );
    const r = await tx.wait();
    const iface = grid.interface;
    for (const log of r.logs) {
      try {
        const parsed = iface.parseLog({ topics: log.topics, data: log.data });
        if (parsed && parsed.name === 'NodeRegistered') return parsed.args[0];
      } catch {}
    }
    return null;
  }

  // ═══ 1. Node Registration ═══════════════════════════════════════════

  it('should register a solar node', async function () {
    const nodeId = await registerNode(nodeOwner1, 0);
    expect(nodeId).to.not.be.null;
    const count = await grid.nodeCount();
    expect(count).to.equal(1n);

    const n = await grid.getNode(nodeId);
    expect(n.owner).to.equal(nodeOwner1.address);
    expect(n.capacityWatts).to.equal(CAPACITY);
    expect(n.active).to.be.true;
  });

  it('should register different node types', async function () {
    await registerNode(nodeOwner1, 0); // Solar
    await registerNode(nodeOwner1, 1); // Battery
    await registerNode(nodeOwner2, 3); // Wind
    expect(await grid.nodeCount()).to.equal(3n);
  });

  it('should reject node with zero location', async function () {
    await expect(
      grid.connect(nodeOwner1).registerNode(0, ethers.ZeroHash, CAPACITY)
    ).to.be.revertedWith('ZeroLocation');
  });

  it('should reject node with zero capacity', async function () {
    await expect(
      grid.connect(nodeOwner1).registerNode(0, MOCK_LOCATION, 0)
    ).to.be.revertedWith('ZeroCap');
  });

  it('should update node details', async function () {
    const nodeId = await registerNode(nodeOwner1, 0);
    await grid.connect(nodeOwner1).updateNode(nodeId, 20000n, true);
    const n = await grid.getNode(nodeId);
    expect(n.capacityWatts).to.equal(20000n);
  });

  // ═══ 2. Energy Attestation ══════════════════════════════════════════

  it('should attest energy production with ZK proof', async function () {
    const nodeId = await registerNode(nodeOwner1, 0);
    const nullifier = ethers.keccak256(ethers.toUtf8Bytes('null-attest-1'));
    const now = Math.floor(Date.now() / 1000);

    const tx = await grid.attestEnergy(
      nodeId, 5000n, now - 3600, now, MOCK_METER, MOCK_PROOF, MOCK_PV, nullifier
    );
    const r = await tx.wait();
    expect(r.status).to.equal(1);
    expect(await grid.attestationCount()).to.equal(1n);

    const n = await grid.getNode(nodeId);
    expect(n.totalKwhAttested).to.equal(5000n);
  });

  it('should issue carbon credits for large attestations', async function () {
    const nodeId = await registerNode(nodeOwner1, 0);
    const nullifier = ethers.keccak256(ethers.toUtf8Bytes('null-carbon-1'));
    const now = Math.floor(Date.now() / 1000);

    await grid.attestEnergy(
      nodeId, 2500n, now - 3600, now, MOCK_METER, MOCK_PROOF, MOCK_PV, nullifier
    );

    const credits = await grid.carbonBalance(nodeOwner1.address);
    expect(credits).to.equal(2n); // 2500 / 1000 = 2 credits
    expect(await grid.totalCarbonCredits()).to.equal(2n);
  });

  it('should reject duplicate attestation nullifier', async function () {
    const nodeId = await registerNode(nodeOwner1, 0);
    const nullifier = ethers.keccak256(ethers.toUtf8Bytes('null-dup'));
    const now = Math.floor(Date.now() / 1000);

    await grid.attestEnergy(
      nodeId, 1000n, now - 3600, now, MOCK_METER, MOCK_PROOF, MOCK_PV, nullifier
    );

    await expect(
      grid.attestEnergy(
        nodeId, 1000n, now - 7200, now - 3600, MOCK_METER, MOCK_PROOF, MOCK_PV, nullifier
      )
    ).to.be.reverted;
  });

  it('should reject attestation for inactive node', async function () {
    const nodeId = await registerNode(nodeOwner1, 0);
    await grid.connect(nodeOwner1).updateNode(nodeId, CAPACITY, false);

    const nullifier = ethers.keccak256(ethers.toUtf8Bytes('null-inactive'));
    const now = Math.floor(Date.now() / 1000);

    await expect(
      grid.attestEnergy(
        nodeId, 1000n, now - 3600, now, MOCK_METER, MOCK_PROOF, MOCK_PV, nullifier
      )
    ).to.be.reverted;
  });

  // ═══ 3. P2P Energy Trading ══════════════════════════════════════════

  it('should create and settle a P2P energy trade', async function () {
    const nodeId = await registerNode(nodeOwner1, 0);
    const pricePerKwh = ethers.parseEther('0.001'); // 0.001 ETH per kWh
    const kwhAmount = 100n;

    // Create trade
    const createTx = await grid.connect(nodeOwner1).createTrade(nodeId, kwhAmount, pricePerKwh);
    const createR = await createTx.wait();
    const iface = grid.interface;
    let tradeId;
    for (const log of createR.logs) {
      try {
        const parsed = iface.parseLog({ topics: log.topics, data: log.data });
        if (parsed && parsed.name === 'TradeCreated') { tradeId = parsed.args[1]; break; }
      } catch {}
    }
    expect(tradeId).to.not.be.undefined;

    // Buy trade
    const totalCost = kwhAmount * pricePerKwh;
    const sellerBefore = await ethers.provider.getBalance(nodeOwner1.address);
    await grid.connect(buyer1).buyTrade(tradeId, { value: totalCost });
    const sellerAfter = await ethers.provider.getBalance(nodeOwner1.address);

    expect(sellerAfter).to.be.greaterThan(sellerBefore);

    const t = await grid.getTrade(tradeId);
    expect(t.status).to.equal(2n); // Settled
    expect(t.buyer).to.equal(buyer1.address);

    const fees = await grid.totalFeesCollected();
    expect(fees).to.be.greaterThan(0n);
  });

  it('should reject buying with insufficient payment', async function () {
    const nodeId = await registerNode(nodeOwner1, 0);
    const createTx = await grid.connect(nodeOwner1).createTrade(nodeId, 100n, ethers.parseEther('0.001'));
    const createR = await createTx.wait();
    const iface = grid.interface;
    let tradeId;
    for (const log of createR.logs) {
      try {
        const parsed = iface.parseLog({ topics: log.topics, data: log.data });
        if (parsed && parsed.name === 'TradeCreated') { tradeId = parsed.args[1]; break; }
      } catch {}
    }

    await expect(
      grid.connect(buyer1).buyTrade(tradeId, { value: 1n })
    ).to.be.reverted;
  });

  it('should cancel an open trade', async function () {
    const nodeId = await registerNode(nodeOwner1, 0);
    const createTx = await grid.connect(nodeOwner1).createTrade(nodeId, 50n, ethers.parseEther('0.002'));
    const createR = await createTx.wait();
    const iface = grid.interface;
    let tradeId;
    for (const log of createR.logs) {
      try {
        const parsed = iface.parseLog({ topics: log.topics, data: log.data });
        if (parsed && parsed.name === 'TradeCreated') { tradeId = parsed.args[1]; break; }
      } catch {}
    }

    await grid.connect(nodeOwner1).cancelTrade(tradeId);
    const t = await grid.getTrade(tradeId);
    expect(t.status).to.equal(3n); // Cancelled
  });

  // ═══ 4. Pause / Unpause ════════════════════════════════════════════

  it('should block operations when paused', async function () {
    await grid.pause();
    await expect(
      grid.connect(nodeOwner1).registerNode(0, MOCK_LOCATION, CAPACITY)
    ).to.be.reverted;

    await grid.unpause();
    const nodeId = await registerNode(nodeOwner1, 0);
    expect(nodeId).to.not.be.null;
  });

  // ═══ 5. Stats & Views ═══════════════════════════════════════════════

  it('should return accurate stats after operations', async function () {
    const nodeId = await registerNode(nodeOwner1, 0);

    // Attest energy
    const nullifier = ethers.keccak256(ethers.toUtf8Bytes('null-stats'));
    const now = Math.floor(Date.now() / 1000);
    await grid.attestEnergy(
      nodeId, 3000n, now - 3600, now, MOCK_METER, MOCK_PROOF, MOCK_PV, nullifier
    );

    // Create and settle a trade
    const createTx = await grid.connect(nodeOwner1).createTrade(nodeId, 50n, ethers.parseEther('0.001'));
    const createR = await createTx.wait();
    const iface = grid.interface;
    let tradeId;
    for (const log of createR.logs) {
      try {
        const parsed = iface.parseLog({ topics: log.topics, data: log.data });
        if (parsed && parsed.name === 'TradeCreated') { tradeId = parsed.args[1]; break; }
      } catch {}
    }
    await grid.connect(buyer1).buyTrade(tradeId, { value: 50n * ethers.parseEther('0.001') });

    const [nodes_, attestations_, trades_, kwhTraded_, volume_, fees_, carbon_] = await grid.getStats();
    expect(nodes_).to.equal(1n);
    expect(attestations_).to.equal(1n);
    expect(trades_).to.equal(1n);
    expect(kwhTraded_).to.equal(50n);
    expect(volume_).to.be.greaterThan(0n);
    expect(fees_).to.be.greaterThan(0n);
    expect(carbon_).to.equal(3n); // 3000 / 1000 = 3
  });
});
