// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ChitIssuerDigests} from "./ChitIssuerDigests.sol";

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
///        slot 7  uint64 guardianSeq
///        slot 8  uint64 guardianThreshold
///        slot 9  address[] guardians
///        slot 10 mapping(address => bool) isGuardian
///        witnessSalt is immutable (no slot)
///
///      `KeyState` is two slots. A sixth `uint64 activatedAt` does not fit in the
///      first 26 bytes. Slot layout, low bits first:
///        base+0 [0, 8)     status
///        base+0 [8, 16)    wasActive (0 or 1)
///        base+0 [16, 80)   notBefore
///        base+0 [80, 144)  notAfter
///        base+0 [144, 208) revokedAt
///        base+1 [0, 64)    activatedAt
///      `ADD_STANDBY` writes only the first slot. The second slot is written
///      when the key is activated (genesis constructor, or `PROMOTE`).
///
///      Op encoding (each field is a 32-byte ABI word inside the commit hash):
///        kind 1 ADD_STANDBY  timestamp = notBefore, reasonCode = 0
///        kind 2 PROMOTE      timestamp = 0,         reasonCode = 0
///        kind 3 RETIRE       timestamp = notAfter,  reasonCode = 0
///        kind 4 REVOKE       timestamp = revokedAt, reasonCode in {1, 2, 3, 255}
///
///      reasonCode: 1 compromise (guardian `recover` only), 2 superseded,
///      3 lost, 255 other. A controller `commit` that uses reason 1 reverts.
///
///
///      `historyVersion` and `historySnapshot` are in every root preimage,
///      including genesis (both zero until the first commit). Guardian
///      recovery and guardian-set rotation use their own domains and bump
///      `rootSeq`. Field names and preimages: `docs/product/issuer-root.md`.
///      `block.number` is `frozenBlock` for every freeze in that commit. A reorg
///      into a different block changes `rootHash`. The block hash is the hash of
///      the `Frozen` / `RootCommitted` log's block after the block is sealed;
///      `blockhash(block.number)` is zero inside the transaction, so it is not
///      stored. Canonical ABI: `contracts/issuer-root/abi/ChitIssuerRoot.json`.
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

    /// @dev Two slots. See the contract-level storage note. `activatedAt` is 0
    ///      until PROMOTE. Genesis sets it to `genesisNotBefore`.
    struct KeyState {
        uint8 status;
        bool wasActive;
        uint64 notBefore;
        uint64 notAfter;
        uint64 revokedAt;
        uint64 activatedAt;
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
    /// @notice Salt the guardians signed in the witness proof of possession.
    ///         Chosen before deploy. It is not a private key.
    bytes32 public immutable witnessSalt;

    uint64 public constant ACTIVATION_DELAY = 24 hours;

    /// @dev Domain separators so a genesis preimage cannot collide with a commit.
    bytes32 public constant GENESIS_DOMAIN = ChitIssuerDigests.GENESIS_DOMAIN;
    bytes32 public constant COMMIT_DOMAIN = ChitIssuerDigests.COMMIT_DOMAIN;
    uint256 internal constant MAX_GUARDIANS = 8;

    uint64 public rootSeq;
    bytes32 public rootHash;
    uint64 public historyVersion;
    bytes32 public historySnapshot;
    mapping(bytes32 => KeyState) public keys;
    mapping(bytes32 => Freeze) public freezes;
    address public supersededBy;
    /// @notice Ordered guardian-set sequence. The constructor seats sequence 1.
    uint64 public guardianSeq;
    uint64 public guardianThreshold;
    address[] internal _guardians;
    mapping(address => bool) public isGuardian;

    event RootCommitted(
        uint64 indexed rootSeq, bytes32 rootHash, uint64 historyVersion, bytes32 historySnapshot, uint64 blockNumber
    );
    event GenesisSeeded(
        address indexed controller,
        bytes32 indexed kid,
        uint64 notBefore,
        uint64 activatedAt,
        uint64 blockNumber,
        bytes32 rootHash
    );
    event KeyStandby(bytes32 indexed kid, uint64 notBefore, uint64 indexed rootSeq);
    event KeyActivated(bytes32 indexed kid, uint64 activatedAt, uint64 indexed rootSeq);
    event KeyRetired(bytes32 indexed kid, uint64 notAfter, uint64 indexed rootSeq);
    event KeyRevoked(bytes32 indexed kid, uint64 revokedAt, uint8 reasonCode, uint64 indexed rootSeq);
    event Frozen(bytes32 indexed universeId, bytes32 universeHash, uint64 enumeratedCount, uint64 frozenBlock, uint64 indexed rootSeq);
    event Superseded(address next);
    /// @notice Guardian set seated at `guardianSeq`. `guardians` is strictly
    ///         ascending. `guardianSetHash` is keccak256(abi.encode(guardians, guardianThreshold)).
    event GuardianSetCommitted(
        uint64 indexed guardianSeq,
        uint64 guardianThreshold,
        bytes32 guardianSetHash,
        address[] guardians,
        uint64 blockNumber
    );
    /// @notice Compromise retirement by the guardian quorum. `reasonCode` is
    ///         always 1. `retiredAt` is the block timestamp. Receipts with
    ///         `iat >= retiredAt` are invalid. Earlier receipts stay valid
    ///         unless `invalidatePrior` is true, in which case `revokedAt` is
    ///         the key's validity start and the open window is empty.
    event KeyRecovered(
        bytes32 indexed kid,
        uint64 retiredAt,
        uint64 retirementBlock,
        bool invalidatePrior,
        uint8 reasonCode,
        uint64 indexed guardianSeq,
        uint64 indexed rootSeq
    );

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
    error RevokedAtBeforeStart(uint64 revokedAt, uint64 earliest);
    error RevokedAtZero();
    error RevokedAtInFuture(uint64 revokedAt);
    error BadReason(uint8 reasonCode);
    error AlreadyFrozen(bytes32 universeId);
    error ZeroUniverseId();
    error BlockNumberUnusable(uint256 blockNumber);
    error SeqOverflow();
    error CompromiseRequiresGuardians();
    error BadThreshold(uint64 threshold, uint256 guardians);
    error GuardianUnsorted(address guardian);
    error TooManyGuardians(uint256 count);
    error ZeroGuardian();
    error GuardianIsController(address guardian);
    error GuardianIsControllerSigner(address guardian);
    error ControllerOwnerCheckFailed(address guardian);
    error WitnessPopInvalid(address guardian);
    error QuorumNotMet(uint256 got, uint64 need);
    error NotGuardian(address signer);
    error DuplicateOrUnsortedSigner(address signer);
    error BadSignature();
    error GuardianSeqOverflow();

    modifier onlyController() {
        if (msg.sender != controller) revert NotController(msg.sender);
        _;
    }

    /// @notice Seeds `genesisKid` as active with `activatedAt = genesisNotBefore`.
    ///         `rootSeq` stays 0. `rootHash` is the genesis commitment, not zero.
    ///         Emits `KeyActivated(kid, activatedAt, 0)` and `GenesisSeeded`.
    ///         The first `commit` is seq 1 and emits `RootCommitted` together
    ///         with any `Frozen` logs. Its preimage chains from this genesis hash.
    /// @param guardians_ Strictly ascending guardian addresses. M-of-N recovery
    ///        quorum. Not Safe owner keys. Each entry has a witness proof of
    ///        possession in `witnessPops`, same order.
    /// @param guardianThreshold_ M. 1 <= M <= guardians_.length <= 8.
    constructor(
        address controller_,
        bytes32 genesisKid,
        uint64 genesisNotBefore,
        address[] memory guardians_,
        uint64 guardianThreshold_,
        bytes32 witnessSalt_,
        bytes[] memory witnessPops
    ) {
        if (controller_ == address(0)) revert ZeroController();
        if (genesisKid == bytes32(0)) revert ZeroKid();
        if (block.number > type(uint64).max) revert BlockNumberUnusable(block.number);
        controller = controller_;
        witnessSalt = witnessSalt_;
        uint64 activatedAt = genesisNotBefore;
        uint64 blockNumber = uint64(block.number);
        _seatGuardians(guardians_, guardianThreshold_, 1);
        _checkWitnessPops(
            controller_, genesisKid, genesisNotBefore, activatedAt, guardianThreshold_, guardians_, witnessPops
        );
        keys[genesisKid] = KeyState({
            status: STATUS_ACTIVE,
            wasActive: true,
            notBefore: genesisNotBefore,
            notAfter: 0,
            revokedAt: 0,
            activatedAt: activatedAt
        });
        bytes32 seeded = _writeGenesisHash(genesisKid, genesisNotBefore, activatedAt, blockNumber);
        emit KeyActivated(genesisKid, activatedAt, 0);
        emit GenesisSeeded(controller_, genesisKid, genesisNotBefore, activatedAt, blockNumber, seeded);
        emit GuardianSetCommitted(1, guardianThreshold, _guardianSetHash(), _guardians, blockNumber);
    }

    function _writeGenesisHash(bytes32 genesisKid, uint64 genesisNotBefore, uint64 activatedAt, uint64 blockNumber)
        internal
        returns (bytes32 seeded)
    {
        ChitIssuerDigests.GenesisStatic memory p;
        p.chainId = block.chainid;
        p.registry = address(this);
        p.controller = controller;
        p.genesisKid = genesisKid;
        p.genesisNotBefore = genesisNotBefore;
        p.activatedAt = activatedAt;
        p.blockNumber = blockNumber;
        p.witnessSalt = witnessSalt;
        p.guardianSeq = guardianSeq;
        p.guardianThreshold = guardianThreshold;
        p.historyVersion = 0;
        p.historySnapshot = bytes32(0);
        seeded = ChitIssuerDigests.genesisRootHash(p, _guardians);
        rootHash = seeded;
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
        if (block.number > type(uint64).max) revert BlockNumberUnusable(block.number);
        uint64 blockNumber = uint64(block.number);
        ChitIssuerDigests.CommitStatic memory preimage;
        preimage.prevRootHash = _hash();
        preimage.seq = seq;
        preimage.chainId = block.chainid;
        preimage.registry = address(this);
        preimage.blockNumber = blockNumber;
        preimage.historyVersion = histVersion;
        preimage.historySnapshot = histSnapshot;
        preimage.guardianSeq = guardianSeq;
        preimage.guardianSetHash = _guardianSetHash();
        bytes32 nextHash = _packedCommit(preimage, ops, freezeArgs);
        _setRoot(seq, nextHash);
        emit RootCommitted(seq, nextHash, histVersion, histSnapshot, blockNumber);
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
    /// @dev The window starts at `max(notBefore, activatedAt)`. A standby that is
    ///      promoted late is not valid back to `notBefore`. Active or retired:
    ///      start `<= t`, `notAfter` is 0 or `t <= notAfter`, and `revokedAt` is
    ///      0 or `t < revokedAt`. Revoked: the same window, and only if the key
    ///      was ever active (`wasActive`). A standby revoked before promotion
    ///      never validates. `status` is the stored status, not a historical one.
    function keyValidAt(bytes32 kid, uint64 t) external view returns (bool ok, uint8 status) {
        KeyState storage k = keys[kid];
        status = k.status;
        if (t < _validFrom(k)) return (false, status);

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

    /// @notice Reference preimage for a `commit`. `seq` is the post-increment sequence.
    ///         `blockNumber` is `uint64(block.number)` of that commit, which is
    ///         `frozenBlock` for every freeze in it.
    function commitmentHash(
        ChitIssuerDigests.CommitStatic memory preimage,
        Op[] calldata ops,
        FreezeArg[] calldata freezeArgs
    ) public pure returns (bytes32) {
        return _packedCommit(preimage, ops, freezeArgs);
    }

    function _packedCommit(
        ChitIssuerDigests.CommitStatic memory preimage,
        Op[] calldata ops,
        FreezeArg[] calldata freezeArgs
    ) internal pure returns (bytes32) {
        preimage.opsHash = keccak256(abi.encode(ops));
        preimage.freezeHash = keccak256(abi.encode(freezeArgs));
        return keccak256(abi.encode(COMMIT_DOMAIN, preimage));
    }

    /// @notice Reference preimage for the constructor `rootHash`.
    ///         `historyVersion` and `historySnapshot` are zero at genesis.
    function guardianSetHash() external view returns (bytes32) {
        return _guardianSetHash();
    }

    function guardianSet() external view returns (uint64 seq, uint64 threshold, address[] memory set, bytes32 setHash) {
        seq = guardianSeq;
        threshold = guardianThreshold;
        set = _guardians;
        setHash = _guardianSetHash();
    }

    function guardians(uint256 index) external view returns (address) {
        return _guardians[index];
    }

    function guardianCount() external view returns (uint256) {
        return _guardians.length;
    }

    function _validFrom(KeyState storage k) internal view returns (uint64) {
        return k.activatedAt > k.notBefore ? k.activatedAt : k.notBefore;
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
        if (block.timestamp > type(uint64).max) revert BlockNumberUnusable(block.timestamp);
        uint64 activatedAt = uint64(block.timestamp);
        k.status = STATUS_ACTIVE;
        k.wasActive = true;
        k.activatedAt = activatedAt;
        emit KeyActivated(op.kid, activatedAt, seq);
    }

    function _retire(Op calldata op, uint64 seq) internal {
        if (op.reasonCode != 0) revert NonZeroReason(op.reasonCode);
        KeyState storage k = keys[op.kid];
        if (k.status != STATUS_ACTIVE) revert BadStatus(op.kid, k.status);
        // Backdated and future notAfter are both allowed. The window cannot
        // end before the key became valid.
        uint64 start = _validFrom(k);
        if (op.timestamp < start) revert NotAfterBeforeStart(op.timestamp, start);
        k.status = STATUS_RETIRED;
        k.notAfter = op.timestamp;
        emit KeyRetired(op.kid, op.timestamp, seq);
    }

    function _revoke(Op calldata op, uint64 seq) internal {
        if (op.reasonCode == REASON_COMPROMISE) revert CompromiseRequiresGuardians();
        if (!_validReason(op.reasonCode)) revert BadReason(op.reasonCode);
        if (op.timestamp == 0) revert RevokedAtZero();
        KeyState storage k = keys[op.kid];
        if (k.status == STATUS_NONE) revert KeyMissing(op.kid);
        if (k.status == STATUS_REVOKED) revert AlreadyRevoked(op.kid);
        // Promoted keys backdate only to activatedAt (the validity start).
        // An unpromoted standby still uses notBefore, which is that start.
        uint64 earliest = _validFrom(k);
        if (op.timestamp < earliest) revert RevokedAtBeforeStart(op.timestamp, earliest);
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

    /// @notice Compromise retirement. The guardian quorum signs; the caller is
    ///         a relayer and is not the controller. Does not add or promote a key.
    /// @param invalidatePrior When false, receipts with `iat < block.timestamp`
    ///        stay valid and receipts at or after this block's timestamp do not.
    ///        When true, `revokedAt` is the validity start, so no `iat` remains valid.
    function recover(bytes32 kid, bool invalidatePrior, bytes[] calldata signatures) external {
        if (_superseded() != address(0)) revert RegistrySuperseded(_superseded());
        bytes32 digest = ChitIssuerDigests.recoverAuthDigest(block.chainid, address(this), guardianSeq, kid, invalidatePrior);
        _verifyQuorum(digest, signatures);
        KeyState storage k = keys[kid];
        if (k.status == STATUS_NONE) revert KeyMissing(kid);
        if (k.status == STATUS_REVOKED) revert AlreadyRevoked(kid);
        if (block.number == 0 || block.number > type(uint64).max) revert BlockNumberUnusable(block.number);
        if (block.timestamp > type(uint64).max) revert BlockNumberUnusable(block.timestamp);
        uint64 retiredAt = uint64(block.timestamp);
        uint64 retirementBlock = uint64(block.number);
        uint64 revokedAt;
        if (k.status == STATUS_STANDBY && !k.wasActive) {
            // Never promoted. Cut it off at notBefore so it cannot be promoted.
            revokedAt = k.notBefore == 0 ? 1 : k.notBefore;
        } else if (invalidatePrior) {
            uint64 start = _validFrom(k);
            revokedAt = start == 0 ? 1 : start;
        } else {
            revokedAt = retiredAt;
            uint64 start = _validFrom(k);
            if (revokedAt < start) revokedAt = start;
        }
        k.status = STATUS_REVOKED;
        k.revokedAt = revokedAt;
        _finishRecover(kid, retiredAt, retirementBlock, invalidatePrior);
    }

    function _finishRecover(bytes32 kid, uint64 retiredAt, uint64 retirementBlock, bool invalidatePrior) internal {
        (uint64 histVersion, bytes32 histSnapshot) = _storedHistory();
        uint64 seq = _nextSeq();
        ChitIssuerDigests.RecoverStatic memory preimage;
        preimage.prevRootHash = _hash();
        preimage.seq = seq;
        preimage.chainId = block.chainid;
        preimage.registry = address(this);
        preimage.blockNumber = retirementBlock;
        preimage.historyVersion = histVersion;
        preimage.historySnapshot = histSnapshot;
        preimage.guardianSeq = guardianSeq;
        preimage.kid = kid;
        preimage.retiredAt = retiredAt;
        preimage.retirementBlock = retirementBlock;
        preimage.invalidatePrior = invalidatePrior;
        bytes32 nextHash = ChitIssuerDigests.recoverRootHash(preimage);
        _setRoot(seq, nextHash);
        emit KeyRecovered(kid, retiredAt, retirementBlock, invalidatePrior, REASON_COMPROMISE, guardianSeq, seq);
        emit RootCommitted(seq, nextHash, histVersion, histSnapshot, retirementBlock);
    }

    /// @notice Replace the guardian set. Signed by the current quorum. Each new
    ///         guardian includes a witness proof of possession. Bumps
    ///         `guardianSeq` and `rootSeq`.
    function rotateGuardians(
        address[] calldata newSet,
        uint64 newThreshold,
        bytes[] calldata quorumSignatures,
        bytes[] calldata witnessPops
    ) external {
        if (_superseded() != address(0)) revert RegistrySuperseded(_superseded());
        if (guardianSeq == type(uint64).max) revert GuardianSeqOverflow();
        uint64 nextSeq = guardianSeq + 1;
        ChitIssuerDigests.RotateAuth memory authPreimage;
        authPreimage.chainId = block.chainid;
        authPreimage.registry = address(this);
        authPreimage.guardianSeq = guardianSeq;
        authPreimage.nextGuardianSeq = nextSeq;
        authPreimage.newThreshold = newThreshold;
        bytes32 auth = ChitIssuerDigests.rotateAuthDigest(authPreimage, newSet);
        _verifyQuorum(auth, quorumSignatures);
        _checkRotationPops(nextSeq, newThreshold, newSet, witnessPops);
        _clearGuardians();
        _seatGuardians(newSet, newThreshold, nextSeq);
        _finishGuardianRoot();
    }

    function _finishGuardianRoot() internal {
        if (block.number == 0 || block.number > type(uint64).max) revert BlockNumberUnusable(block.number);
        uint64 blockNumber = uint64(block.number);
        (uint64 histVersion, bytes32 histSnapshot) = _storedHistory();
        uint64 seq = _nextSeq();
        ChitIssuerDigests.GuardianStatic memory preimage;
        preimage.prevRootHash = _hash();
        preimage.seq = seq;
        preimage.chainId = block.chainid;
        preimage.registry = address(this);
        preimage.blockNumber = blockNumber;
        preimage.historyVersion = histVersion;
        preimage.historySnapshot = histSnapshot;
        preimage.guardianSeq = guardianSeq;
        preimage.guardianThreshold = guardianThreshold;
        bytes32 nextHash = ChitIssuerDigests.guardianRootHash(preimage, _guardians);
        _setRoot(seq, nextHash);
        emit GuardianSetCommitted(guardianSeq, guardianThreshold, _guardianSetHash(), _guardians, blockNumber);
        emit RootCommitted(seq, nextHash, histVersion, histSnapshot, blockNumber);
    }

    function _validReason(uint8 reasonCode) internal pure returns (bool) {
        return reasonCode == REASON_COMPROMISE || reasonCode == REASON_SUPERSEDED || reasonCode == REASON_LOST
            || reasonCode == REASON_OTHER;
    }

    function _guardianSetHash() internal view returns (bytes32) {
        return ChitIssuerDigests.guardianSetHash(_guardians, guardianThreshold);
    }

    function _seatGuardians(address[] memory set, uint64 threshold, uint64 seq) internal {
        if (set.length == 0 || set.length > MAX_GUARDIANS) revert TooManyGuardians(set.length);
        if (threshold == 0 || uint256(threshold) > set.length) revert BadThreshold(threshold, set.length);
        address prev = address(0);
        for (uint256 i = 0; i < set.length; i++) {
            address guardian = set[i];
            if (guardian == address(0)) revert ZeroGuardian();
            if (guardian <= prev) revert GuardianUnsorted(guardian);
            if (guardian == controller) revert GuardianIsController(guardian);
            _assertNotControllerSigner(guardian);
            prev = guardian;
            isGuardian[guardian] = true;
            _guardians.push(guardian);
        }
        guardianThreshold = threshold;
        guardianSeq = seq;
    }

    function _clearGuardians() internal {
        uint256 n = _guardians.length;
        for (uint256 i = 0; i < n; i++) {
            isGuardian[_guardians[i]] = false;
        }
        delete _guardians;
    }

    function _assertNotControllerSigner(address guardian) internal view {
        (bool ok, bytes memory ret) = controller.staticcall(abi.encodeWithSignature("isOwner(address)", guardian));
        if (!ok || ret.length < 32) revert ControllerOwnerCheckFailed(guardian);
        if (abi.decode(ret, (bool))) revert GuardianIsControllerSigner(guardian);
    }

    function _checkWitnessPops(
        address controller_,
        bytes32 genesisKid,
        uint64 genesisNotBefore,
        uint64 activatedAt,
        uint64 threshold,
        address[] memory set,
        bytes[] memory witnessPops
    ) internal view {
        if (witnessPops.length != set.length) revert WitnessPopInvalid(address(0));
        ChitIssuerDigests.PopStatic memory pop;
        pop.chainId = block.chainid;
        pop.witnessSalt = witnessSalt;
        pop.controller = controller_;
        pop.genesisKid = genesisKid;
        pop.genesisNotBefore = genesisNotBefore;
        pop.activatedAt = activatedAt;
        pop.guardianThreshold = threshold;
        bytes32 digest = ChitIssuerDigests.witnessPopDigest(pop, set);
        for (uint256 i = 0; i < set.length; i++) {
            if (_recoverSigner(digest, witnessPops[i]) != set[i]) revert WitnessPopInvalid(set[i]);
        }
    }

    function _checkRotationPops(uint64 nextSeq, uint64 threshold, address[] calldata set, bytes[] calldata witnessPops)
        internal
        view
    {
        if (witnessPops.length != set.length) revert WitnessPopInvalid(address(0));
        bytes32 digest = ChitIssuerDigests.seatedPopDigest(block.chainid, address(this), nextSeq, threshold, set);
        for (uint256 i = 0; i < set.length; i++) {
            if (_recoverSigner(digest, witnessPops[i]) != set[i]) revert WitnessPopInvalid(set[i]);
        }
    }

    function _verifyQuorum(bytes32 digest, bytes[] calldata signatures) internal view {
        if (signatures.length < guardianThreshold) revert QuorumNotMet(signatures.length, guardianThreshold);
        address prev = address(0);
        for (uint256 i = 0; i < signatures.length; i++) {
            address signer = _recoverSigner(digest, signatures[i]);
            if (signer <= prev) revert DuplicateOrUnsortedSigner(signer);
            if (!isGuardian[signer]) revert NotGuardian(signer);
            prev = signer;
        }
    }

    function _recoverSigner(bytes32 digest, bytes memory sig) internal pure returns (address) {
        if (sig.length != 65) revert BadSignature();
        bytes32 r;
        bytes32 s;
        uint8 v;
        assembly {
            r := mload(add(sig, 32))
            s := mload(add(sig, 64))
            v := byte(0, mload(add(sig, 96)))
        }
        if (v < 27) v += 27;
        if (v != 27 && v != 28) revert BadSignature();
        address signer = ecrecover(digest, v, r, s);
        if (signer == address(0)) revert BadSignature();
        return signer;
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
