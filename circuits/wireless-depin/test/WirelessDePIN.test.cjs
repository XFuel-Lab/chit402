/**
 * WirelessDePIN Circuit -- Unit Tests (15 tests)
 */
const { expect } = require('chai');
const hre = require('hardhat');
const { ethers } = hre;

describe('WirelessDePIN', function () {
  let admin, owner1, owner2, payer1;
  let splitter, wireless;

  const HEX = ethers.keccak256(ethers.toUtf8Bytes('882681a339fffff'));
  const ANTENNA = ethers.keccak256(ethers.toUtf8Bytes('RAK-5.8dBi-omnidirectional'));
  const CHAL_HEX = ethers.keccak256(ethers.toUtf8Bytes('882681a33bfffff'));
  const PROOF = '0x1234';
  const PV = '0x5678';

  beforeEach(async function () {
    [admin, owner1, owner2, payer1] = await ethers.getSigners();

    const SF = await ethers.getContractFactory('CoreRevenueSplitter');
    splitter = await SF.deploy(
      admin.address, admin.address, admin.address,
      admin.address, admin.address, admin.address
    );
    await splitter.waitForDeployment();

    const WF = await ethers.getContractFactory('WirelessDePIN');
    wireless = await WF.deploy(admin.address, await splitter.getAddress(), ethers.ZeroAddress);
    await wireless.waitForDeployment();

    const CR = await splitter.CIRCUIT_ROLE();
    await splitter.grantRole(CR, await wireless.getAddress());
  });

  async function regHotspot(owner, typ) {
    const tx = await wireless.connect(owner).registerHotspot(typ || 0, HEX, ANTENNA);
    const r = await tx.wait();
    for (const log of r.logs) {
      try {
        const p = wireless.interface.parseLog({ topics: log.topics, data: log.data });
        if (p && p.name === 'HotspotRegistered') return p.args[0];
      } catch {}
    }
    return null;
  }

  // === 1. Hotspot Registration ===

  it('should register a LoRaWAN hotspot', async function () {
    const id = await regHotspot(owner1, 0);
    expect(id).to.not.be.null;
    expect(await wireless.hotspotCount()).to.equal(1n);
    const h = await wireless.getHotspot(id);
    expect(h.owner).to.equal(owner1.address);
    expect(h.active).to.be.true;
    expect(h.rewardScale).to.equal(10000n);
  });

  it('should register different hotspot types', async function () {
    await regHotspot(owner1, 0); // LoRaWAN
    await regHotspot(owner1, 1); // 5G
    await regHotspot(owner2, 2); // WiFi
    expect(await wireless.hotspotCount()).to.equal(3n);
  });

  it('should reject hotspot with zero hex', async function () {
    await expect(
      wireless.connect(owner1).registerHotspot(0, ethers.ZeroHash, ANTENNA)
    ).to.be.revertedWith('ZeroHex');
  });

  it('should reject hotspot with zero antenna', async function () {
    await expect(
      wireless.connect(owner1).registerHotspot(0, HEX, ethers.ZeroHash)
    ).to.be.revertedWith('ZeroAntenna');
  });

  it('should update hotspot settings', async function () {
    const id = await regHotspot(owner1, 0);
    await wireless.connect(owner1).updateHotspot(id, true, 7500n);
    const h = await wireless.getHotspot(id);
    expect(h.rewardScale).to.equal(7500n);
  });

  it('should deactivate a hotspot', async function () {
    const id = await regHotspot(owner1, 0);
    await wireless.connect(owner1).updateHotspot(id, false, 10000n);
    const h = await wireless.getHotspot(id);
    expect(h.active).to.be.false;
  });

  // === 2. Coverage Proofs ===

  it('should submit ZK-verified coverage proof', async function () {
    const id = await regHotspot(owner1, 0);
    const nul = ethers.keccak256(ethers.toUtf8Bytes('cov-1'));
    const tx = await wireless.submitCoverageProof(
      id, CHAL_HEX, -800, 75, 3n, PROOF, PV, nul
    );
    const r = await tx.wait();
    expect(r.status).to.equal(1);
    expect(await wireless.coverageProofCount()).to.equal(1n);
    const h = await wireless.getHotspot(id);
    expect(h.totalCoverageProofs).to.equal(1n);
  });

  it('should update hex coverage map', async function () {
    const id = await regHotspot(owner1, 0);
    const nul1 = ethers.keccak256(ethers.toUtf8Bytes('hex-1'));
    const nul2 = ethers.keccak256(ethers.toUtf8Bytes('hex-2'));
    await wireless.submitCoverageProof(id, CHAL_HEX, -700, 80, 2n, PROOF, PV, nul1);
    await wireless.submitCoverageProof(id, CHAL_HEX, -750, 70, 1n, PROOF, PV, nul2);
    expect(await wireless.hexCoverage(HEX)).to.equal(2n);
  });

  it('should reject duplicate nullifier', async function () {
    const id = await regHotspot(owner1, 0);
    const nul = ethers.keccak256(ethers.toUtf8Bytes('dup-nul'));
    await wireless.submitCoverageProof(id, CHAL_HEX, -800, 75, 1n, PROOF, PV, nul);
    await expect(
      wireless.submitCoverageProof(id, CHAL_HEX, -800, 75, 1n, PROOF, PV, nul)
    ).to.be.reverted;
  });

  it('should reject coverage for inactive hotspot', async function () {
    const id = await regHotspot(owner1, 0);
    await wireless.connect(owner1).updateHotspot(id, false, 10000n);
    const nul = ethers.keccak256(ethers.toUtf8Bytes('inactive'));
    await expect(
      wireless.submitCoverageProof(id, CHAL_HEX, -800, 75, 1n, PROOF, PV, nul)
    ).to.be.reverted;
  });

  // === 3. Data Transfer Settlement ===

  it('should settle data transfer with fees', async function () {
    const id = await regHotspot(owner1, 0);
    const payment = ethers.parseEther('0.01');

    const ownerBefore = await ethers.provider.getBalance(owner1.address);
    const tx = await wireless.connect(payer1).settleDataTransfer(id, 1048576n, 100n, { value: payment });
    const r = await tx.wait();
    expect(r.status).to.equal(1);
    const ownerAfter = await ethers.provider.getBalance(owner1.address);

    expect(ownerAfter).to.be.greaterThan(ownerBefore);
    expect(await wireless.transferCount()).to.equal(1n);
    expect(await wireless.totalFeesCollected()).to.be.greaterThan(0n);

    const h = await wireless.getHotspot(id);
    expect(h.totalDataCredits).to.equal(100n);
    expect(h.totalEarned).to.be.greaterThan(0n);
  });

  it('should reject data transfer with zero payment', async function () {
    const id = await regHotspot(owner1, 0);
    await expect(
      wireless.connect(payer1).settleDataTransfer(id, 1024n, 1n, { value: 0n })
    ).to.be.revertedWith('ZeroPayment');
  });

  // === 4. Pause / Unpause ===

  it('should block operations when paused', async function () {
    await wireless.pause();
    await expect(
      wireless.connect(owner1).registerHotspot(0, HEX, ANTENNA)
    ).to.be.reverted;
    await wireless.unpause();
    const id = await regHotspot(owner1, 0);
    expect(id).to.not.be.null;
  });

  // === 5. Stats ===

  it('should return accurate stats', async function () {
    const id = await regHotspot(owner1, 0);

    const nul = ethers.keccak256(ethers.toUtf8Bytes('stats-cov'));
    await wireless.submitCoverageProof(id, CHAL_HEX, -700, 80, 2n, PROOF, PV, nul);

    await wireless.connect(payer1).settleDataTransfer(
      id, 2048n, 5n, { value: ethers.parseEther('0.005') }
    );

    const [hs, proofs, xfers, dataB, credits, vol, fees] = await wireless.getStats();
    expect(hs).to.equal(1n);
    expect(proofs).to.equal(1n);
    expect(xfers).to.equal(1n);
    expect(dataB).to.equal(2048n);
    expect(credits).to.equal(5n);
    expect(vol).to.be.greaterThan(0n);
    expect(fees).to.be.greaterThan(0n);
  });
});
