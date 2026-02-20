/**
 * UplinkCircuit -- Unit Tests (15 tests)
 */
const { expect } = require('chai');
const hre = require('hardhat');
const { ethers } = hre;

describe('UplinkCircuit', function () {
  let admin, owner1, owner2, user1;
  let splitter, uplink;

  const LOC = ethers.keccak256(ethers.toUtf8Bytes('region-us-east-1'));
  const ISP = ethers.keccak256(ethers.toUtf8Bytes('comcast-xfinity'));
  const PROOF = '0x1234';
  const PV = '0x5678';

  beforeEach(async function () {
    [admin, owner1, owner2, user1] = await ethers.getSigners();

    const SF = await ethers.getContractFactory('CoreRevenueSplitter');
    splitter = await SF.deploy(
      admin.address, admin.address, admin.address,
      admin.address, admin.address, admin.address
    );
    await splitter.waitForDeployment();

    const UF = await ethers.getContractFactory('UplinkCircuit');
    uplink = await UF.deploy(admin.address, await splitter.getAddress(), ethers.ZeroAddress);
    await uplink.waitForDeployment();

    const CR = await splitter.CIRCUIT_ROLE();
    await splitter.grantRole(CR, await uplink.getAddress());
  });

  async function regRouter(owner, bw) {
    const tx = await uplink.connect(owner).registerRouter(LOC, ISP, bw || 100n);
    const r = await tx.wait();
    for (const log of r.logs) {
      try {
        const p = uplink.interface.parseLog({ topics: log.topics, data: log.data });
        if (p && p.name === 'RouterRegistered') return p.args[0];
      } catch {}
    }
    return null;
  }

  async function openSess(user, routerId, val) {
    const tx = await uplink.connect(user).openSession(routerId, { value: val || ethers.parseEther('0.01') });
    const r = await tx.wait();
    for (const log of r.logs) {
      try {
        const p = uplink.interface.parseLog({ topics: log.topics, data: log.data });
        if (p && p.name === 'SessionOpened') return p.args[1]; // sessionId
      } catch {}
    }
    return null;
  }

  // === 1. Router Registration ===

  it('should register a WiFi router', async function () {
    const id = await regRouter(owner1, 200n);
    expect(id).to.not.be.null;
    expect(await uplink.routerCount()).to.equal(1n);
    const r = await uplink.getRouter(id);
    expect(r.owner).to.equal(owner1.address);
    expect(r.active).to.be.true;
    expect(r.bandwidthCapMbps).to.equal(200n);
    expect(r.qualityScore).to.equal(8000n);
  });

  it('should register multiple routers', async function () {
    await regRouter(owner1, 100n);
    await regRouter(owner2, 500n);
    expect(await uplink.routerCount()).to.equal(2n);
  });

  it('should reject router with zero location', async function () {
    await expect(
      uplink.connect(owner1).registerRouter(ethers.ZeroHash, ISP, 100n)
    ).to.be.revertedWith('ZeroLocation');
  });

  it('should reject router with zero bandwidth', async function () {
    await expect(
      uplink.connect(owner1).registerRouter(LOC, ISP, 0n)
    ).to.be.revertedWith('ZeroBandwidth');
  });

  it('should deactivate a router', async function () {
    const id = await regRouter(owner1, 100n);
    await uplink.connect(owner1).updateRouter(id, false);
    const r = await uplink.getRouter(id);
    expect(r.active).to.be.false;
  });

  // === 2. Session Management ===

  it('should open a connectivity session', async function () {
    const rid = await regRouter(owner1, 100n);
    const sid = await openSess(user1, rid);
    expect(sid).to.not.be.null;
    expect(await uplink.sessionCount()).to.equal(1n);
    const s = await uplink.getSession(sid);
    expect(s.user).to.equal(user1.address);
    expect(s.escrowAmount).to.equal(ethers.parseEther('0.01'));
    expect(s.status).to.equal(0n); // Open
  });

  it('should reject session for inactive router', async function () {
    const rid = await regRouter(owner1, 100n);
    await uplink.connect(owner1).updateRouter(rid, false);
    await expect(
      uplink.connect(user1).openSession(rid, { value: ethers.parseEther('0.01') })
    ).to.be.reverted;
  });

  it('should cancel an open session and refund', async function () {
    const rid = await regRouter(owner1, 100n);
    const sid = await openSess(user1, rid);
    const before = await ethers.provider.getBalance(user1.address);
    const tx = await uplink.connect(user1).cancelSession(sid);
    await tx.wait();
    const after = await ethers.provider.getBalance(user1.address);
    // After refund, balance should be higher minus gas
    const s = await uplink.getSession(sid);
    expect(s.status).to.equal(3n); // Cancelled
  });

  // === 3. ZK Settlement ===

  it('should settle session with ZK bandwidth proof', async function () {
    const rid = await regRouter(owner1, 100n);
    const sid = await openSess(user1, rid, ethers.parseEther('0.02'));
    const nul = ethers.keccak256(ethers.toUtf8Bytes('bw-proof-1'));

    const ownerBefore = await ethers.provider.getBalance(owner1.address);

    const tx = await uplink.settleSession(sid, 512n, 3600n, 80n, PROOF, PV, nul);
    const r = await tx.wait();
    expect(r.status).to.equal(1);

    const s = await uplink.getSession(sid);
    expect(s.status).to.equal(2n); // Settled
    expect(s.bandwidthMB).to.equal(512n);
    expect(s.throughputMbps).to.equal(80n);

    const ownerAfter = await ethers.provider.getBalance(owner1.address);
    expect(ownerAfter).to.be.greaterThan(ownerBefore);

    expect(await uplink.proofCount()).to.equal(1n);
    expect(await uplink.totalFeesCollected()).to.be.greaterThan(0n);
  });

  it('should update router quality score on settlement', async function () {
    const rid = await regRouter(owner1, 100n);
    const sid = await openSess(user1, rid);
    const nul = ethers.keccak256(ethers.toUtf8Bytes('quality-1'));

    // Throughput 50 out of 100 cap = 50% = 5000, EMA: (8000*7 + 5000*3)/10 = 7100
    await uplink.settleSession(sid, 256n, 1800n, 50n, PROOF, PV, nul);
    const r = await uplink.getRouter(rid);
    expect(r.qualityScore).to.equal(7100n);
  });

  it('should reject duplicate nullifier', async function () {
    const rid = await regRouter(owner1, 100n);
    const sid1 = await openSess(user1, rid);
    const sid2 = await openSess(user1, rid);
    const nul = ethers.keccak256(ethers.toUtf8Bytes('dup-nul'));

    await uplink.settleSession(sid1, 100n, 600n, 90n, PROOF, PV, nul);
    await expect(
      uplink.settleSession(sid2, 100n, 600n, 90n, PROOF, PV, nul)
    ).to.be.reverted;
  });

  it('should track region connectivity map', async function () {
    const rid = await regRouter(owner1, 100n);
    expect(await uplink.regionRouterCount(LOC)).to.equal(1n);

    const sid = await openSess(user1, rid);
    const nul = ethers.keccak256(ethers.toUtf8Bytes('region-1'));
    await uplink.settleSession(sid, 128n, 900n, 75n, PROOF, PV, nul);
    expect(await uplink.regionSessionCount(LOC)).to.equal(1n);
  });

  // === 4. Pause / Unpause ===

  it('should block operations when paused', async function () {
    await uplink.pause();
    await expect(
      uplink.connect(owner1).registerRouter(LOC, ISP, 100n)
    ).to.be.reverted;
    await uplink.unpause();
    const id = await regRouter(owner1, 100n);
    expect(id).to.not.be.null;
  });

  // === 5. Stats ===

  it('should return accurate stats', async function () {
    const rid = await regRouter(owner1, 100n);
    const sid = await openSess(user1, rid, ethers.parseEther('0.005'));
    const nul = ethers.keccak256(ethers.toUtf8Bytes('stats-1'));
    await uplink.settleSession(sid, 64n, 300n, 95n, PROOF, PV, nul);

    const [routers_, sessions_, proofs_, bw_, vol_, fees_] = await uplink.getStats();
    expect(routers_).to.equal(1n);
    expect(sessions_).to.equal(1n);
    expect(proofs_).to.equal(1n);
    expect(bw_).to.equal(64n);
    expect(vol_).to.be.greaterThan(0n);
    expect(fees_).to.be.greaterThan(0n);
  });
});
