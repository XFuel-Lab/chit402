/**
 * MappingSensor Circuit -- Unit Tests (15 tests)
 */
const { expect } = require('chai');
const hre = require('hardhat');
const { ethers } = hre;

describe('MappingSensor', function () {
  let admin, devOwner1, devOwner2, buyer1;
  let splitter, sensor;

  const LOC = ethers.keccak256(ethers.toUtf8Bytes('37.7749,-122.4194,sf'));
  const FW = ethers.keccak256(ethers.toUtf8Bytes('hivemapper-bee-v2.1'));
  const DATA = ethers.keccak256(ethers.toUtf8Bytes('dashcam-frame-001'));
  const PROOF = '0x1234';
  const PV = '0x5678';

  beforeEach(async function () {
    [admin, devOwner1, devOwner2, buyer1] = await ethers.getSigners();

    const SF = await ethers.getContractFactory('CoreRevenueSplitter');
    splitter = await SF.deploy(
      admin.address, admin.address, admin.address,
      admin.address, admin.address, admin.address
    );
    await splitter.waitForDeployment();

    const MF = await ethers.getContractFactory('MappingSensor');
    sensor = await MF.deploy(admin.address, await splitter.getAddress(), ethers.ZeroAddress);
    await sensor.waitForDeployment();

    const CR = await splitter.CIRCUIT_ROLE();
    await splitter.grantRole(CR, await sensor.getAddress());
  });

  async function regDevice(owner, typ) {
    const tx = await sensor.connect(owner).registerDevice(typ || 0, LOC, FW);
    const r = await tx.wait();
    for (const log of r.logs) {
      try {
        const p = sensor.interface.parseLog({ topics: log.topics, data: log.data });
        if (p && p.name === 'DeviceRegistered') return p.args[0];
      } catch {}
    }
    return null;
  }

  async function subData(deviceId, seed) {
    const nul = ethers.keccak256(ethers.toUtf8Bytes(seed || 'n-' + Date.now()));
    const tx = await sensor.submitData(deviceId, DATA, LOC, 1024n, 8000n, PROOF, PV, nul);
    const r = await tx.wait();
    for (const log of r.logs) {
      try {
        const p = sensor.interface.parseLog({ topics: log.topics, data: log.data });
        if (p && p.name === 'DataSubmitted') return p.args[2];
      } catch {}
    }
    return null;
  }

  // 1. Device Registration

  it('should register a dashcam device', async function () {
    const id = await regDevice(devOwner1, 0);
    expect(id).to.not.be.null;
    expect(await sensor.deviceCount()).to.equal(1n);
    const d = await sensor.getDevice(id);
    expect(d.owner).to.equal(devOwner1.address);
    expect(d.active).to.be.true;
    expect(d.qualityScore).to.equal(5000n);
  });

  it('should register different device types', async function () {
    await regDevice(devOwner1, 0);
    await regDevice(devOwner1, 1);
    await regDevice(devOwner2, 4);
    expect(await sensor.deviceCount()).to.equal(3n);
  });

  it('should reject device with zero location', async function () {
    await expect(
      sensor.connect(devOwner1).registerDevice(0, ethers.ZeroHash, FW)
    ).to.be.revertedWith('ZeroLocation');
  });

  it('should reject device with zero firmware', async function () {
    await expect(
      sensor.connect(devOwner1).registerDevice(0, LOC, ethers.ZeroHash)
    ).to.be.revertedWith('ZeroFirmware');
  });

  it('should deactivate a device', async function () {
    const id = await regDevice(devOwner1, 0);
    await sensor.connect(devOwner1).updateDevice(id, false);
    const d = await sensor.getDevice(id);
    expect(d.active).to.be.false;
  });

  // 2. Data Submission

  it('should submit ZK-verified geospatial data', async function () {
    const id = await regDevice(devOwner1, 0);
    const nul = ethers.keccak256(ethers.toUtf8Bytes('submit-1'));
    const tx = await sensor.submitData(id, DATA, LOC, 2048n, 7500n, PROOF, PV, nul);
    const r = await tx.wait();
    expect(r.status).to.equal(1);
    expect(await sensor.submissionCount()).to.equal(1n);
  });

  it('should update quality score with EMA', async function () {
    const id = await regDevice(devOwner1, 0);
    const nul = ethers.keccak256(ethers.toUtf8Bytes('quality-1'));
    await sensor.submitData(id, DATA, LOC, 1024n, 10000n, PROOF, PV, nul);
    const d = await sensor.getDevice(id);
    expect(d.qualityScore).to.equal(5500n); // (5000*9+10000)/10
  });

  it('should reject duplicate nullifier', async function () {
    const id = await regDevice(devOwner1, 0);
    const nul = ethers.keccak256(ethers.toUtf8Bytes('dup-nul'));
    await sensor.submitData(id, DATA, LOC, 1024n, 8000n, PROOF, PV, nul);
    await expect(
      sensor.submitData(id, DATA, LOC, 1024n, 8000n, PROOF, PV, nul)
    ).to.be.reverted;
  });

  it('should reject submission for inactive device', async function () {
    const id = await regDevice(devOwner1, 0);
    await sensor.connect(devOwner1).updateDevice(id, false);
    const nul = ethers.keccak256(ethers.toUtf8Bytes('inactive'));
    await expect(
      sensor.submitData(id, DATA, LOC, 1024n, 8000n, PROOF, PV, nul)
    ).to.be.reverted;
  });

  it('should track region coverage', async function () {
    const id = await regDevice(devOwner1, 0);
    await subData(id, 'cov-1');
    await subData(id, 'cov-2');
    expect(await sensor.regionCoverage(LOC)).to.equal(2n);
  });

  // 3. Data Marketplace

  it('should list and purchase data', async function () {
    const id = await regDevice(devOwner1, 0);
    const subId = await subData(id, 'list-1');
    expect(subId).to.not.be.null;

    const price = ethers.parseEther('0.01');
    const ltx = await sensor.connect(devOwner1).listData(subId, price);
    const lr = await ltx.wait();
    let listId;
    for (const log of lr.logs) {
      try {
        const p = sensor.interface.parseLog({ topics: log.topics, data: log.data });
        if (p && p.name === 'DataListed') { listId = p.args[1]; break; }
      } catch {}
    }
    expect(listId).to.not.be.undefined;

    const bef = await ethers.provider.getBalance(devOwner1.address);
    await sensor.connect(buyer1).purchaseData(listId, { value: price });
    const aft = await ethers.provider.getBalance(devOwner1.address);
    expect(aft).to.be.greaterThan(bef);

    const l = await sensor.getListing(listId);
    expect(l.status).to.equal(1n);
    expect(l.buyer).to.equal(buyer1.address);
    expect(await sensor.totalFeesCollected()).to.be.greaterThan(0n);
  });

  it('should reject purchase with insufficient payment', async function () {
    const id = await regDevice(devOwner1, 0);
    const subId = await subData(id, 'insuf-1');
    const ltx = await sensor.connect(devOwner1).listData(subId, ethers.parseEther('0.01'));
    const lr = await ltx.wait();
    let listId;
    for (const log of lr.logs) {
      try {
        const p = sensor.interface.parseLog({ topics: log.topics, data: log.data });
        if (p && p.name === 'DataListed') { listId = p.args[1]; break; }
      } catch {}
    }
    await expect(sensor.connect(buyer1).purchaseData(listId, { value: 1n })).to.be.reverted;
  });

  it('should cancel a listing', async function () {
    const id = await regDevice(devOwner1, 0);
    const subId = await subData(id, 'cancel-1');
    const ltx = await sensor.connect(devOwner1).listData(subId, ethers.parseEther('0.005'));
    const lr = await ltx.wait();
    let listId;
    for (const log of lr.logs) {
      try {
        const p = sensor.interface.parseLog({ topics: log.topics, data: log.data });
        if (p && p.name === 'DataListed') { listId = p.args[1]; break; }
      } catch {}
    }
    await sensor.connect(devOwner1).cancelListing(listId);
    const l = await sensor.getListing(listId);
    expect(l.status).to.equal(3n);
  });

  // 4. Pause

  it('should block operations when paused', async function () {
    await sensor.pause();
    await expect(sensor.connect(devOwner1).registerDevice(0, LOC, FW)).to.be.reverted;
    await sensor.unpause();
    const id = await regDevice(devOwner1, 0);
    expect(id).to.not.be.null;
  });

  // 5. Stats

  it('should return accurate stats', async function () {
    const id = await regDevice(devOwner1, 0);
    const subId = await subData(id, 'stats-1');
    const ltx = await sensor.connect(devOwner1).listData(subId, ethers.parseEther('0.002'));
    const lr = await ltx.wait();
    let listId;
    for (const log of lr.logs) {
      try {
        const p = sensor.interface.parseLog({ topics: log.topics, data: log.data });
        if (p && p.name === 'DataListed') { listId = p.args[1]; break; }
      } catch {}
    }
    await sensor.connect(buyer1).purchaseData(listId, { value: ethers.parseEther('0.002') });

    const [devs, subs, lsts, sold, vol, fees] = await sensor.getStats();
    expect(devs).to.equal(1n);
    expect(subs).to.equal(1n);
    expect(lsts).to.equal(1n);
    expect(sold).to.equal(1n);
    expect(vol).to.be.greaterThan(0n);
    expect(fees).to.be.greaterThan(0n);
  });
});
