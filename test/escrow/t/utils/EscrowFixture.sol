// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {TestBase} from "./Test.sol";
import {MockUSDC} from "./MockUSDC.sol";
import {TreeLib} from "./TreeLib.sol";
import {EquivocationEscrowV0 as E} from "escrow/EquivocationEscrowV0.sol";
import {Jwk7638} from "escrow/Jwk7638.sol";

/// @dev Shared setup: a throwaway P-256 key (never the issuer key), a mock
///      6-decimal token, a pinned quarantine list, a 1,000 USDC bond and an
///      activated escrow on chainId 84532.
abstract contract EscrowFixture is TestBase {
    uint256 internal constant N = 0xffffffff00000000ffffffffffffffffbce6faada7179e84f3b9cac2fc632551;
    uint256 internal constant T0 = 1_800_000_000;
    bytes32 internal constant LOG_SALT = 0x7a92860b2db8dfee1901affef1a3352ab94a3b3bfcc410aef7238ef170435211;
    bytes32 internal constant USDC_BASE_ID = 0xe388d402aba230f5d279b790e1c6cb48e608d50c648f65eb394dfa8a44b5ddb5;
    uint64 internal constant ONE = 1_000_000;

    address internal owner = address(0xA11CE);
    address internal alice = address(0xA1);
    address internal bob = address(0xB0B);
    address internal carol = address(0xCA201);

    uint256 internal pk;
    bytes32 internal pubX;
    bytes32 internal pubY;
    bytes32 internal kid;

    MockUSDC internal usdc;
    E internal esc;

    // Quarantined head (Oct 9 shape, synthetic): epoch 2, size 11, a bad root.
    bytes32 internal qRoot;

    function setUp() public virtual {
        vm.chainId(84532);
        vm.warp(T0);
        pk = uint256(keccak256("chit402.escrow.test.throwaway-key")) % (N - 1) + 1;
        (uint256 x, uint256 y) = vm.publicKeyP256(pk);
        pubX = bytes32(x);
        pubY = bytes32(y);
        kid = Jwk7638.thumbprintP256(pubX, pubY);
        usdc = new MockUSDC();
        esc = deploy(address(usdc));
        qRoot = keccak256("quarantined-root");
        pinDefaultList(esc);
        fundAndActivate(esc, 1000 * ONE);
    }

    // ---------------- deploy helpers ----------------

    function liveHead() internal view returns (E.TreeHead memory) {
        return E.TreeHead({epoch: 2, treeSize: 39, root: keccak256("live"), publishedAt: uint64(T0 - 1 days), kid: kid});
    }

    function deploy(address token) internal returns (E) {
        E.TreeHead memory h = liveHead();
        return new E(owner, token, kid, pubX, pubY, LOG_SALT, h, signHead(h));
    }

    function pinDefaultList(E e) internal {
        E.HeadRef[] memory entries = new E.HeadRef[](1);
        entries[0] = E.HeadRef({epoch: 2, treeSize: 11, root: qRoot});
        E.HeadRef[] memory hw = new E.HeadRef[](1);
        hw[0] = E.HeadRef({epoch: 2, treeSize: 39, root: keccak256("live")});
        vm.prank(owner);
        e.pinQuarantineList(keccak256("list-v1"), entries, hw);
    }

    function fundAndActivate(E e, uint256 amount) internal {
        usdc.mint(owner, amount);
        vm.startPrank(owner);
        usdc.approve(address(e), amount);
        e.fund(amount);
        e.activate();
        vm.stopPrank();
    }

    // ---------------- signing helpers ----------------

    function domainSep(string memory name, string memory version, uint256 chainId, bytes32 salt)
        internal
        pure
        returns (bytes32)
    {
        return keccak256(
            abi.encode(
                keccak256("EIP712Domain(string name,string version,uint256 chainId,bytes32 salt)"),
                keccak256(bytes(name)),
                keccak256(bytes(version)),
                chainId,
                salt
            )
        );
    }

    function headStruct(E.TreeHead memory h) internal pure returns (bytes32) {
        return keccak256(
            abi.encode(
                keccak256("TreeHead(uint32 epoch,uint64 tree_size,bytes32 root,uint64 published_at,bytes32 kid)"),
                h.epoch,
                h.treeSize,
                h.root,
                h.publishedAt,
                h.kid
            )
        );
    }

    function bindingStruct(E.ReceiptBinding memory b) internal pure returns (bytes32) {
        return keccak256(
            abi.encode(
                keccak256(
                    "ReceiptBinding(bytes32 leaf_hash,bytes32 payer_commitment,uint64 amount_atomic,bytes32 asset_id,bytes32 kid)"
                ),
                b.leafHash,
                b.payerCommitment,
                b.amountAtomic,
                b.assetId,
                b.kid
            )
        );
    }

    function headDigest(E.TreeHead memory h, bytes32 dom) internal pure returns (bytes32) {
        return sha256(abi.encodePacked(hex"1901", dom, headStruct(h)));
    }

    function signWith(uint256 key, bytes32 e) internal pure returns (E.Sig memory s) {
        (bytes32 r, bytes32 sv) = vm.signP256(key, e);
        // Normalize to low-S so tests choose high-S explicitly.
        if (uint256(sv) > N / 2) sv = bytes32(N - uint256(sv));
        s = E.Sig({r: r, s: sv});
    }

    function signHead(E.TreeHead memory h) internal view returns (E.Sig memory) {
        return signWith(pk, headDigest(h, domainSep("Chit402TreeHead", "1", 84532, LOG_SALT)));
    }

    function signBinding(E.ReceiptBinding memory b) internal view returns (E.Sig memory) {
        bytes32 dom = domainSep("Chit402ReceiptBinding", "1", 84532, LOG_SALT);
        return signWith(pk, sha256(abi.encodePacked(hex"1901", dom, bindingStruct(b))));
    }

    function highS(E.Sig memory s) internal pure returns (E.Sig memory) {
        return E.Sig({r: s.r, s: bytes32(N - uint256(s.s))});
    }

    function head(uint32 epoch, uint64 size, bytes32 root) internal view returns (E.TreeHead memory) {
        return E.TreeHead({epoch: epoch, treeSize: size, root: root, publishedAt: uint64(T0), kid: kid});
    }

    // ---------------- evidence helpers ----------------

    struct PairA {
        E.TreeHead h1;
        E.Sig s1;
        E.TreeHead h2;
        E.Sig s2;
    }

    function pairA(uint32 epoch, uint64 size, bytes32 r1, bytes32 r2) internal view returns (PairA memory p) {
        p.h1 = head(epoch, size, r1);
        p.s1 = signHead(p.h1);
        p.h2 = head(epoch, size, r2);
        p.s2 = signHead(p.h2);
    }

    /// @dev Fork at `forkAt`: honest tree of `n` leaves, and a forked tree that
    ///      replaces leaf `forkAt` onward. Returns B evidence at index `forkAt`.
    function forkB(uint32 epoch, uint256 n, uint256 forkAt, uint256 seed) internal view returns (E.EvidenceB memory ev) {
        bytes32[] memory honest = TreeLib.leaves(n, seed);
        bytes32[] memory forked = TreeLib.leaves(n, seed);
        for (uint256 i = forkAt; i < n; i++) forked[i] = TreeLib.leaf(abi.encodePacked("forked-", seed, "-", i));
        ev.h1 = head(epoch, uint64(n), TreeLib.root(honest));
        ev.s1 = signHead(ev.h1);
        ev.h2 = head(epoch, uint64(n), TreeLib.root(forked));
        ev.s2 = signHead(ev.h2);
        ev.index = uint64(forkAt);
        ev.l1 = honest[forkAt];
        ev.l2 = forked[forkAt];
        ev.p1 = TreeLib.proof(honest, forkAt);
        ev.p2 = TreeLib.proof(forked, forkAt);
    }

    function commitA(address who, address payTo, PairA memory p, bytes32 salt) internal returns (bytes32 c) {
        c = esc.commitHash(who, payTo, 1, esc.evidenceHashA(p.h1, p.s1, p.h2, p.s2), salt);
        vm.prank(who);
        esc.commit(c);
    }

    function revealA(address who, address payTo, PairA memory p, bytes32 salt) internal {
        vm.prank(who);
        esc.revealA(p.h1, p.s1, p.h2, p.s2, payTo, salt);
    }

    function commitB(address who, address payTo, E.EvidenceB memory ev, bytes32 salt) internal returns (bytes32 c) {
        c = esc.commitHash(who, payTo, 2, esc.evidenceHashB(ev), salt);
        vm.prank(who);
        esc.commit(c);
    }

    function revealB(address who, address payTo, E.EvidenceB memory ev, bytes32 salt) internal {
        vm.prank(who);
        esc.revealB(ev, payTo, salt);
    }

    function passDelay() internal {
        vm.warp(block.timestamp + esc.MIN_DELAY());
    }

    /// @dev commit, wait MIN_DELAY, reveal. Returns the evidence key.
    function submitA(address who, address payTo, PairA memory p) internal returns (bytes32) {
        bytes32 salt = keccak256(abi.encode(who, p.h1.root, p.h2.root, block.timestamp));
        commitA(who, payTo, p, salt);
        passDelay();
        revealA(who, payTo, p, salt);
        (bytes32 lo, bytes32 hi) = p.h1.root < p.h2.root ? (p.h1.root, p.h2.root) : (p.h2.root, p.h1.root);
        return esc.keyA(p.h1.epoch, p.h1.treeSize, lo, hi);
    }

    function submitB(address who, address payTo, E.EvidenceB memory ev) internal returns (bytes32) {
        bytes32 salt = keccak256(abi.encode(who, ev.l1, ev.l2, block.timestamp));
        commitB(who, payTo, ev, salt);
        passDelay();
        revealB(who, payTo, ev, salt);
        (bytes32 lo, bytes32 hi) = ev.l1 < ev.l2 ? (ev.l1, ev.l2) : (ev.l2, ev.l1);
        return esc.keyB(ev.h1.epoch, ev.index, lo, hi);
    }

    // ---------------- binding helpers ----------------

    function commitment(address payer, bytes32 salt) internal pure returns (bytes32) {
        return keccak256(abi.encode(keccak256("chit402.payer-commitment.v1"), payer, salt));
    }

    function binding(bytes32 leafHash, address payer, bytes32 salt, uint64 amount)
        internal
        view
        returns (E.ReceiptBinding memory b)
    {
        b = E.ReceiptBinding({
            leafHash: leafHash,
            payerCommitment: commitment(payer, salt),
            amountAtomic: amount,
            assetId: USDC_BASE_ID,
            kid: kid
        });
    }
}
