// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @notice Shared status, op, and reason codes. Internal constants so tests and
///         scripts can use them without an instance. The contract re-exports
///         the same values as public constants.
library ChitIssuerCodes {
    uint8 internal constant STATUS_NONE = 0;
    uint8 internal constant STATUS_STANDBY = 1;
    uint8 internal constant STATUS_ACTIVE = 2;
    uint8 internal constant STATUS_RETIRED = 3;
    uint8 internal constant STATUS_REVOKED = 4;

    uint8 internal constant OP_ADD_STANDBY = 1;
    uint8 internal constant OP_PROMOTE = 2;
    uint8 internal constant OP_RETIRE = 3;
    uint8 internal constant OP_REVOKE = 4;

    uint8 internal constant REASON_COMPROMISE = 1;
    uint8 internal constant REASON_SUPERSEDED = 2;
    uint8 internal constant REASON_LOST = 3;
    uint8 internal constant REASON_OTHER = 255;
}

/// @title ChitIssuerRoot
/// @author XFuel Protocol — Chit402
/// @custom:security-contact security@xfuel.app
/// @notice Immutable issuer-key and freeze registry. One controller (a Safe
///         2-of-3) appends key operations and write-once universe freezes.
///         There is no proxy, no upgrade, no `selfdestruct`, no `receive` or
///         `fallback`, and no token interface. Migration is a new registry
///         plus one `supersede` on this one.
///
/// @dev Storage layout (immutables and constants take no slots):
///        slot 0  uint64  rootSeq
///        slot 1  bytes32 rootHash
///        slot 2  uint64  historyVersion
///        slot 3  bytes32 historySnapshot
///        slot 4  mapping(bytes32 => KeyState) keys
///        slot 5  mapping(bytes32 => Freeze) freezes
///        slot 6  address supersededBy
///
///      `KeyState` is one slot, low bits first:
///        [0, 8)     status
///        [8, 16)    wasActive (0 or 1)
///        [16, 80)   notBefore
///        [80, 144)  notAfter
///        [144, 208) revokedAt
///
///      Op encoding (each field is a 32-byte ABI word inside the commit hash):
///        kind 1 ADD_STANDBY  timestamp = notBefore, reasonCode = 0
///        kind 2 PROMOTE      timestamp = 0,         reasonCode = 0
///        kind 3 RETIRE       timestamp = notAfter,  reasonCode = 0
///        kind 4 REVOKE       timestamp = revokedAt, reasonCode in {1, 2, 3, 255}
///
///      reasonCode: 1 compromise, 2 superseded, 3 lost, 255 other.
///
///      Commitment:
///        rootHash = keccak256(abi.encode(
///            prevRootHash, rootSeq, block.chainid, address(this),
///            ops, freezes, histVersion, histSnapshot))
///        `rootSeq` in the preimage is the sequence assigned by this commit.
///        `ops` and `freezes` are the calldata arguments, not storage structs.
///
///      The legacy-freeze Merkle root is NOT computed here. Callers pass
///      `universeHash`. Rules, matching the gateway and verifier:
///        leaf = SHA-256(0x00 || payload_hash bytes)
///        node = SHA-256(0x01 || left || right)
///        sort payload_hash bytes ascending, then hash
///        duplicate the last node when a level has more than one node and an odd count
///        empty root = SHA-256(0x00)
///      The legacy universe id is
///      `0xb623c1816e895dd967c4e51f0e066dafda546195a909e9b51283be4b5109caf4`.
///      Reference code: `scripts/issuer-root.mjs`. Vectors:
///      `services/gateway/test/fixtures/legacy-merkle-vectors.json`
///      on `cursor/gateway-v11-issuer-root-5306` (copied under `test/fixtures/`).
contract ChitIssuerRoot {
    // ─── Status, op kinds, revoke reasons (see ChitIssuerCodes) ────────────
    uint8 public constant STATUS_NONE = ChitIssuerCodes.STATUS_NONE;
    uint8 public constant STATUS_STANDBY = ChitIssuerCodes.STATUS_STANDBY;
    uint8 public constant STATUS_ACTIVE = ChitIssuerCodes.STATUS_ACTIVE;
    uint8 public constant STATUS_RETIRED = ChitIssuerCodes.STATUS_RETIRED;
    uint8 public constant STATUS_REVOKED = ChitIssuerCodes.STATUS_REVOKED;

    uint8 public constant OP_ADD_STANDBY = ChitIssuerCodes.OP_ADD_STANDBY;
    uint8 public constant OP_PROMOTE = ChitIssuerCodes.OP_PROMOTE;
    uint8 public constant OP_RETIRE = ChitIssuerCodes.OP_RETIRE;
    uint8 public constant OP_REVOKE = ChitIssuerCodes.OP_REVOKE;

    uint8 public constant REASON_COMPROMISE = ChitIssuerCodes.REASON_COMPROMISE;
    uint8 public constant REASON_SUPERSEDED = ChitIssuerCodes.REASON_SUPERSEDED;
    uint8 public constant REASON_LOST = ChitIssuerCodes.REASON_LOST;
    uint8 public constant REASON_OTHER = ChitIssuerCodes.REASON_OTHER;

    struct KeyState {
        uint8 status;
        bool wasActive;
        uint64 notBefore;
        uint64 notAfter;
        uint64 revokedAt;
    }

    struct Freeze {
        bytes32 universeHash;
        uint64 enumeratedCount;
        uint64 frozenBlock;
        uint64 rootSeq;
    }

    /// @dev One key operation. `timestamp` is notBefore, notAfter, or revokedAt.
    ///      PROMOTE requires timestamp 0. `reasonCode` is 0 except on REVOKE.
    struct Op {
        uint8 kind;
        bytes32 kid;
        uint64 timestamp;
        uint8 reasonCode;
    }

    /// @dev Write-once freeze. `frozenBlock` and `rootSeq` are filled by `commit`.
    struct FreezeArg {
        bytes32 universeId;
        bytes32 universeHash;
        uint64 enumeratedCount;
    }

    /// @notice Safe 2-of-3. Signer changes are Safe owner changes, not upgrades.
    address public immutable controller;

    uint64 public constant ACTIVATION_DELAY = 24 hours;

    uint64 public rootSeq;
    bytes32 public rootHash;
    uint64 public historyVersion;
    bytes32 public historySnapshot;
    mapping(bytes32 => KeyState) public keys;
    mapping(bytes32 => Freeze) public freezes;
    address public supersededBy;

    event RootCommitted(uint64 indexed rootSeq, bytes32 rootHash, uint64 historyVersion, bytes32 historySnapshot);
    event KeyStandby(bytes32 indexed kid, uint64 notBefore, uint64 indexed rootSeq);
    event KeyActivated(bytes32 indexed kid, uint64 indexed rootSeq);
    event KeyRetired(bytes32 indexed kid, uint64 notAfter, uint64 indexed rootSeq);
    event KeyRevoked(bytes32 indexed kid, uint64 revokedAt, uint8 reasonCode, uint64 indexed rootSeq);
    event Frozen(bytes32 indexed universeId, bytes32 universeHash, uint64 enumeratedCount, uint64 frozenBlock, uint64 indexed rootSeq);
    event Superseded(address next);

    error NotController(address caller);
    error RegistrySuperseded(address supersededBy);
    error EmptyCommit();
    error HistoryVersionRegressed(uint64 provided, uint64 current);
    error HistorySnapshotMismatch(bytes32 provided, bytes32 current);
    error ZeroController();
    error ZeroKid();
    error ZeroNextRegistry();
    error SupersedeSelf();
    error AlreadySuperseded(address current);
    error UnknownOp(uint8 kind);
    error NonZeroReason(uint8 reasonCode);
    error NonZeroTimestamp();
    error KeyAlreadyExists(bytes32 kid);
    error ActivationTooSoon(uint64 notBefore, uint256 earliest);
    error KeyMissing(bytes32 kid);
    error BadStatus(bytes32 kid, uint8 status);
    error NotYetActive(bytes32 kid, uint64 notBefore);
    error NotAfterBeforeStart(uint64 notAfter, uint64 notBefore);
    error AlreadyRevoked(bytes32 kid);
    error RevokedAtBeforeStart(uint64 revokedAt, uint64 notBefore);
    error RevokedAtZero();
    error RevokedAtInFuture(uint64 revokedAt);
    error BadReason(uint8 reasonCode);
    error AlreadyFrozen(bytes32 universeId);
    error ZeroUniverseId();
    error BlockNumberUnusable(uint256 blockNumber);
    error SeqOverflow();

    modifier onlyController() {
        if (msg.sender != controller) revert NotController(msg.sender);
        _;
    }

    /// @notice Seeds `genesisKid` as active. Emits `KeyActivated(genesisKid, 0)`.
    ///         `rootSeq` stays 0 and `rootHash` stays bytes32(0) until the first
    ///         commit. The genesis commit (standby + legacy freeze) is that
    ///         first `commit`, which emits `RootCommitted` at seq 1 together
    ///         with `Frozen`.
    constructor(address controller_, bytes32 genesisKid, uint64 genesisNotBefore) {
        if (controller_ == address(0)) revert ZeroController();
        if (genesisKid == bytes32(0)) revert ZeroKid();
        controller = controller_;
        keys[genesisKid] = KeyState({
            status: STATUS_ACTIVE,
            wasActive: true,
            notBefore: genesisNotBefore,
            notAfter: 0,
            revokedAt: 0
        });
        emit KeyActivated(genesisKid, 0);
    }

    /// @notice Append key ops and write-once freezes. Reverts after `supersede`.
    ///         An empty commit (no ops and no freezes) reverts, including a
    ///         history-only update. `histVersion` must be >= the stored version.
    ///         When it is equal, `histSnapshot` must be equal too.
    /// @dev Event order: one key or freeze event per argument, then `RootCommitted`.
    ///      Every event in the transaction carries the new `rootSeq`.
    function commit(Op[] calldata ops, FreezeArg[] calldata freezeArgs, uint64 histVersion, bytes32 histSnapshot)
        external
        onlyController
    {
        if (_superseded() != address(0)) revert RegistrySuperseded(_superseded());
        if (ops.length == 0 && freezeArgs.length == 0) revert EmptyCommit();
        _checkHistory(histVersion, histSnapshot);

        uint64 seq = _nextSeq();
        for (uint256 i = 0; i < ops.length; i++) {
            _applyOp(ops[i], seq);
        }
        for (uint256 i = 0; i < freezeArgs.length; i++) {
            _applyFreeze(freezeArgs[i], seq);
        }
        _setHistory(histVersion, histSnapshot);
        _commitRoot(ops, freezeArgs, seq, histVersion, histSnapshot);
    }

    function _checkHistory(uint64 histVersion, bytes32 histSnapshot) internal view {
        (uint64 storedVersion, bytes32 storedSnapshot) = _storedHistory();
        if (histVersion < storedVersion) revert HistoryVersionRegressed(histVersion, storedVersion);
        if (histVersion == storedVersion && histSnapshot != storedSnapshot) {
            revert HistorySnapshotMismatch(histSnapshot, storedSnapshot);
        }
    }

    function _nextSeq() internal view returns (uint64 seq) {
        uint64 prevSeq = _seq();
        if (prevSeq == type(uint64).max) revert SeqOverflow();
        seq = prevSeq + 1;
    }

    function _commitRoot(
        Op[] calldata ops,
        FreezeArg[] calldata freezeArgs,
        uint64 seq,
        uint64 histVersion,
        bytes32 histSnapshot
    ) internal {
        bytes32 nextHash = keccak256(
            abi.encode(_hash(), seq, block.chainid, address(this), ops, freezeArgs, histVersion, histSnapshot)
        );
        _setRoot(seq, nextHash);
        emit RootCommitted(seq, nextHash, histVersion, histSnapshot);
    }

    /// @notice Final migration pointer. Does not change `rootSeq` or `rootHash`.
    ///         Emits only `Superseded`. A second call reverts. `commit` reverts
    ///         once this is set.
    function supersede(address next) external onlyController {
        address current = _superseded();
        if (current != address(0)) revert AlreadySuperseded(current);
        if (next == address(0)) revert ZeroNextRegistry();
        if (next == address(this)) revert SupersedeSelf();
        _setSuperseded(next);
        emit Superseded(next);
    }

    /// @notice Whether `kid` was acceptable for a receipt with `iat == t`.
    /// @dev Active or retired: `notBefore <= t`, `notAfter` is 0 or `t <= notAfter`,
    ///      and `revokedAt` is 0 or `t < revokedAt`.
    ///      Revoked: the same window, and only if the key was ever active
    ///      (`wasActive`) and `t < revokedAt`. A standby revoked before promotion
    ///      never validates. `status` is the stored status, not a historical one.
    function keyValidAt(bytes32 kid, uint64 t) external view returns (bool ok, uint8 status) {
        KeyState storage k = keys[kid];
        status = k.status;
        if (t < k.notBefore) return (false, status);

        if (k.status == STATUS_ACTIVE || k.status == STATUS_RETIRED) {
            if (k.notAfter != 0 && t > k.notAfter) return (false, status);
            if (k.revokedAt != 0 && t >= k.revokedAt) return (false, status);
            return (true, status);
        }

        if (k.status == STATUS_REVOKED && k.wasActive) {
            if (k.revokedAt == 0 || t >= k.revokedAt) return (false, status);
            if (k.notAfter != 0 && t > k.notAfter) return (false, status);
            return (true, status);
        }

        return (false, status);
    }

    /// @notice Reference preimage for `rootHash`. `seq` is the post-increment sequence.
    function commitmentHash(
        bytes32 prevRootHash,
        uint64 seq,
        uint256 chainId,
        address registry,
        Op[] calldata ops,
        FreezeArg[] calldata freezeArgs,
        uint64 histVersion,
        bytes32 histSnapshot
    ) public pure returns (bytes32) {
        return keccak256(abi.encode(prevRootHash, seq, chainId, registry, ops, freezeArgs, histVersion, histSnapshot));
    }

    // ─── Ops ───────────────────────────────────────────────────────────────

    function _applyOp(Op calldata op, uint64 seq) internal {
        if (op.kind == OP_ADD_STANDBY) {
            _addStandby(op, seq);
            return;
        }
        if (op.kind == OP_PROMOTE) {
            _promote(op, seq);
            return;
        }
        if (op.kind == OP_RETIRE) {
            _retire(op, seq);
            return;
        }
        if (op.kind == OP_REVOKE) {
            _revoke(op, seq);
            return;
        }
        revert UnknownOp(op.kind);
    }

    function _addStandby(Op calldata op, uint64 seq) internal {
        if (op.reasonCode != 0) revert NonZeroReason(op.reasonCode);
        if (op.kid == bytes32(0)) revert ZeroKid();
        KeyState storage k = keys[op.kid];
        if (k.status != STATUS_NONE) revert KeyAlreadyExists(op.kid);
        uint256 earliest = block.timestamp + ACTIVATION_DELAY;
        if (uint256(op.timestamp) < earliest) revert ActivationTooSoon(op.timestamp, earliest);
        k.status = STATUS_STANDBY;
        k.wasActive = false;
        k.notBefore = op.timestamp;
        k.notAfter = 0;
        k.revokedAt = 0;
        emit KeyStandby(op.kid, op.timestamp, seq);
    }

    function _promote(Op calldata op, uint64 seq) internal {
        if (op.reasonCode != 0) revert NonZeroReason(op.reasonCode);
        if (op.timestamp != 0) revert NonZeroTimestamp();
        KeyState storage k = keys[op.kid];
        if (k.status != STATUS_STANDBY) revert BadStatus(op.kid, k.status);
        if (block.timestamp < uint256(k.notBefore)) revert NotYetActive(op.kid, k.notBefore);
        k.status = STATUS_ACTIVE;
        k.wasActive = true;
        emit KeyActivated(op.kid, seq);
    }

    function _retire(Op calldata op, uint64 seq) internal {
        if (op.reasonCode != 0) revert NonZeroReason(op.reasonCode);
        KeyState storage k = keys[op.kid];
        if (k.status != STATUS_ACTIVE) revert BadStatus(op.kid, k.status);
        // Backdated and future notAfter are both allowed. notAfter >= notBefore.
        if (op.timestamp < k.notBefore) revert NotAfterBeforeStart(op.timestamp, k.notBefore);
        k.status = STATUS_RETIRED;
        k.notAfter = op.timestamp;
        emit KeyRetired(op.kid, op.timestamp, seq);
    }

    function _revoke(Op calldata op, uint64 seq) internal {
        if (!_validReason(op.reasonCode)) revert BadReason(op.reasonCode);
        if (op.timestamp == 0) revert RevokedAtZero();
        KeyState storage k = keys[op.kid];
        if (k.status == STATUS_NONE) revert KeyMissing(op.kid);
        if (k.status == STATUS_REVOKED) revert AlreadyRevoked(op.kid);
        if (op.timestamp < k.notBefore) revert RevokedAtBeforeStart(op.timestamp, k.notBefore);
        // revokedAt may be <= block.timestamp for any promoted key.
        // A future revokedAt is only legal for a standby that was never promoted.
        if (uint256(op.timestamp) > block.timestamp) {
            if (k.status != STATUS_STANDBY || k.wasActive) revert RevokedAtInFuture(op.timestamp);
        }
        k.status = STATUS_REVOKED;
        k.revokedAt = op.timestamp;
        emit KeyRevoked(op.kid, op.timestamp, op.reasonCode, seq);
    }

    function _applyFreeze(FreezeArg calldata freezeArg, uint64 seq) internal {
        if (freezeArg.universeId == bytes32(0)) revert ZeroUniverseId();
        if (block.number == 0 || block.number > type(uint64).max) revert BlockNumberUnusable(block.number);
        Freeze storage existing = freezes[freezeArg.universeId];
        // rootSeq of a real freeze is always >= 1, so 0 means unset.
        if (existing.rootSeq != 0) revert AlreadyFrozen(freezeArg.universeId);
        uint64 frozenBlock = uint64(block.number);
        existing.universeHash = freezeArg.universeHash;
        existing.enumeratedCount = freezeArg.enumeratedCount;
        existing.frozenBlock = frozenBlock;
        existing.rootSeq = seq;
        emit Frozen(freezeArg.universeId, freezeArg.universeHash, freezeArg.enumeratedCount, frozenBlock, seq);
    }

    function _validReason(uint8 reasonCode) internal pure returns (bool) {
        return reasonCode == REASON_COMPROMISE || reasonCode == REASON_SUPERSEDED || reasonCode == REASON_LOST
            || reasonCode == REASON_OTHER;
    }

    // ─── Storage accessors ─────────────────────────────────────────────────
    // `commit` takes `histVersion` and `histSnapshot`, which do not match the
    // storage names. These accessors keep the hash preimage and the stored
    // history obviously tied to the same values.

    function _storedHistory() internal view returns (uint64 version, bytes32 snapshot) {
        version = historyVersion;
        snapshot = historySnapshot;
    }

    function _setHistory(uint64 version, bytes32 snapshot) internal {
        historyVersion = version;
        historySnapshot = snapshot;
    }

    function _seq() internal view returns (uint64) {
        return rootSeq;
    }

    function _hash() internal view returns (bytes32) {
        return rootHash;
    }

    function _setRoot(uint64 seq, bytes32 nextHash) internal {
        rootSeq = seq;
        rootHash = nextHash;
    }

    function _superseded() internal view returns (address) {
        return supersededBy;
    }

    function _setSuperseded(address next) internal {
        supersededBy = next;
    }
}
