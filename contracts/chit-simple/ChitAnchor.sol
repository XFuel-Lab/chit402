// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Rfc9162} from "./Rfc9162.sol";

/// @title ChitAnchor
/// @notice Chit402 hourly log anchor. The checkpoint address is the only
///         sender that can anchor. A third party cannot. A finished hour is one
///         whose whole 3600 seconds are already in the past. Kind 0 is the only
///         kind this deployment emits. Every epoch head is written once. A later
///         anchor does not rewrite it. Both kinds of key change go through the
///         controller and wait ROTATION_DELAY. Freeze does not wait.
contract ChitAnchor {
    uint8 internal constant KIND_HOURLY = 0;

    /// @notice An anchor later than hour end plus this many seconds is late.
    ///         The verifier prints that. The anchor still stores.
    uint64 public constant MAX_ANCHOR_LAG = 5400;

    uint256 public constant ROTATION_DELAY = 24 hours;

    /// @notice Largest tree size an anchor may store. 2^53 − 1 is the last
    ///         integer a verifier holds as a safe integer. One step to the
    ///         uint64 ceiling would make every later anchor revert.
    uint64 public constant MAX_TREE_SIZE = (uint64(1) << 53) - 1;

    /// @notice Deploy default for MAX_GROWTH. Live tiers are 128 lines in an
    ///         hour and are moving toward 256. One million is about four
    ///         thousand 256-line hours, so a real hour and a catch-up both
    ///         fit. A stolen checkpoint still cannot set the size to the top
    ///         of the uint64 range in one call.
    uint64 public constant DEFAULT_MAX_GROWTH = 1_000_000;

    /// @notice Most new leaves one anchor may append. Set once in the
    ///         constructor. Skipped hours do not raise it.
    uint64 public immutable MAX_GROWTH;

    struct Head {
        uint40 hourStart;
        uint64 size;
        uint32 checkpointVersion;
        uint64 anchorBlock;
        uint40 anchorTime;
        bytes32 root;
        bytes32 stateRoot;
    }

    struct Pending {
        uint8 kind;
        address addr;
        uint64 version;
        uint64 eta;
    }

    address public checkpoint;
    /// @notice Set by the controller with no delay. While true, anchor reverts.
    bool public frozen;
    /// @notice latestEpoch at the latest freeze. Meaningful while frozen is true.
    uint64 public frozenEpoch;
    uint64 public checkpointVersion;
    uint64 public latestEpoch;
    bytes32 public immutable domain;
    mapping(uint64 => Head) public heads;
    address public controller;
    Pending public pendingAction;

    struct KeyCutoff {
        bool set;
        uint64 epoch;
    }

    /// @dev Epoch at which a checkpoint version was rotated out. Anchors that
    ///      name that version at a later epoch are not trusted.
    mapping(uint64 => KeyCutoff) internal cutoffOf;

    struct Rotation {
        bool pending;
        address current;
        address next;
        uint64 currentVersion;
        uint64 nextVersion;
        uint64 eta;
    }

    error NotCheckpoint();
    error BadDomain();
    error BadEpoch();
    error BadHour();
    error HourNotIncreasing();
    error HourNotFinished();
    error SizeNotIncreasing();
    error BadConsistency();
    error ZeroCheckpoint();
    error SameCheckpoint();
    error BadVersion();
    error NotController();
    error ActionPending();
    error NoPendingAction();
    error TooEarly();
    error RotationToController();
    error ControllerIsCheckpoint();
    error SizeAboveCap();
    error GrowthCap();
    error AnchorFrozen();
    error AlreadyFrozen();
    error NotFrozen();
    error ZeroGrowth();
    error GrowthBound();
    error FrozenAction();

    event Anchored(
        uint64 indexed epoch,
        uint64 indexed hourStart,
        uint64 size,
        bytes32 root,
        bytes32 stateRoot,
        uint8 kind
    );

    event CheckpointKeyRotated(uint64 version, address oldAddr, address newAddr);
    /// @notice version is the checkpoint version that stopped at cutoffEpoch.
    ///         Anchors from that version after cutoffEpoch are not trusted.
    event CheckpointKeyRetired(uint64 version, address key, uint64 cutoffEpoch);
    /// @notice The current checkpoint anchored while a rotation was still waiting.
    event AnchoredDuringRotation(
        uint64 indexed epoch,
        address currentKey,
        uint64 currentVersion,
        address pendingKey,
        uint64 pendingVersion,
        uint64 eta
    );
    event ActionProposed(uint8 kind, address addr, uint64 version, uint64 eta);
    event ActionCancelled(uint8 kind);
    event ControllerChanged(address oldController, address newController);
    event Frozen(uint64 epoch, uint64 size, uint64 hourStart, uint64 timestamp);
    event Unfrozen(uint64 epoch, uint64 timestamp);

    constructor(address checkpoint_, address controller_, uint64 maxGrowth_) {
        if (checkpoint_ == address(0)) revert ZeroCheckpoint();
        if (controller_ == address(0)) revert ZeroCheckpoint();
        if (controller_ == checkpoint_) revert SameCheckpoint();
        if (maxGrowth_ == 0) revert ZeroGrowth();
        // A step of MAX_TREE_SIZE or more can still land on the ceiling in one
        // anchor (from size 0, or from a small head). The ceiling then rejects
        // every later increase.
        if (maxGrowth_ >= MAX_TREE_SIZE) revert GrowthBound();
        checkpoint = checkpoint_;
        controller = controller_;
        MAX_GROWTH = maxGrowth_;
        checkpointVersion = 1;
        heads[0] = Head({
            hourStart: 0,
            size: 0,
            checkpointVersion: 1,
            anchorBlock: uint64(block.number),
            anchorTime: uint40(block.timestamp),
            root: Rfc9162.EMPTY_ROOT,
            stateRoot: bytes32(0)
        });
        domain = sha256(abi.encodePacked("chit402-checkpoint-v1", uint64(block.chainid), address(this)));
        emit CheckpointKeyRotated(1, address(0), checkpoint_);
    }

    function latest()
        external
        view
        returns (uint64 epoch, uint64 hourStart, uint64 size, bytes32 root, bytes32 stateRoot)
    {
        Head memory h = heads[latestEpoch];
        return (latestEpoch, h.hourStart, h.size, h.root, h.stateRoot);
    }

    /// @notice The head at epoch e. An unwritten epoch is the zero head
    ///         (anchorBlock == 0). This never reverts.
    function headAt(uint64 e) external view returns (Head memory) {
        return heads[e];
    }

    /// @notice Head e, the previous head (zero when e == 0), and latestEpoch.
    function headsFor(uint64 e) external view returns (Head memory current, Head memory prior, uint64 tip) {
        current = heads[e];
        if (e > 0) prior = heads[e - 1];
        tip = latestEpoch;
    }

    function anchor(
        bytes32 domain_,
        uint64 epoch_,
        uint64 hourStart_,
        uint64 size_,
        bytes32 root_,
        bytes32 stateRoot_,
        bytes32[] calldata consistencyProof
    ) external {
        if (msg.sender != checkpoint) revert NotCheckpoint();
        if (frozen) revert AnchorFrozen();
        if (domain_ != domain) revert BadDomain();
        Head storage prev = heads[latestEpoch];
        if (epoch_ != latestEpoch + 1) revert BadEpoch();
        if (hourStart_ % 3600 != 0) revert BadHour();
        if (hourStart_ <= prev.hourStart) revert HourNotIncreasing();
        // A clock hour may close only after it has ended.
        if (uint256(hourStart_) + 3600 > block.timestamp) revert HourNotFinished();
        if (size_ <= prev.size) revert SizeNotIncreasing();
        if (size_ > MAX_TREE_SIZE) revert SizeAboveCap();
        uint64 growth;
        unchecked {
            growth = size_ - prev.size;
        }
        if (growth > MAX_GROWTH) revert GrowthCap();

        if (Rfc9162.verifyConsistency(prev.size, size_, prev.root, root_, consistencyProof) != Rfc9162.OK) {
            revert BadConsistency();
        }

        // A head stores the version in uint32. A larger value must revert here,
        // not truncate, so a later read cannot return a different version.
        // The rotation proposal cap lands with the controller timelock.
        if (checkpointVersion > type(uint32).max) revert BadVersion();
        Head memory next;
        next.hourStart = uint40(hourStart_);
        next.size = size_;
        next.checkpointVersion = uint32(checkpointVersion);
        next.anchorBlock = uint64(block.number);
        next.anchorTime = uint40(block.timestamp);
        next.root = root_;
        next.stateRoot = stateRoot_;
        heads[epoch_] = next;
        latestEpoch = epoch_;
        emit Anchored(epoch_, hourStart_, size_, root_, stateRoot_, KIND_HOURLY);
        if (pendingAction.kind == 1) {
            emit AnchoredDuringRotation(
                epoch_, checkpoint, checkpointVersion, pendingAction.addr, pendingAction.version, pendingAction.eta
            );
        }
    }

    /// @notice Whether a checkpoint rotation is waiting, and the keys it names.
    ///         kind 2 (a controller change) is not a rotation: pending is false.
    function rotation() external view returns (Rotation memory) {
        bool pending = pendingAction.kind == 1;
        return Rotation({
            pending: pending,
            current: checkpoint,
            next: pending ? pendingAction.addr : address(0),
            currentVersion: checkpointVersion,
            nextVersion: pending ? pendingAction.version : 0,
            eta: pending ? pendingAction.eta : 0
        });
    }

    /// @notice Cutoff for a checkpoint version that has been rotated out.
    ///         retired is false until that version stops. Anchors that name it
    ///         after cutoffEpoch are not trusted. An anchor at cutoffEpoch was
    ///         written before the rotation and stays trusted.
    function keyRetired(uint64 version) external view returns (bool retired, uint64 cutoffEpoch) {
        KeyCutoff memory row = cutoffOf[version];
        return (row.set, row.epoch);
    }

    /// @dev The only freeze authorization check. The controller (the 2-of-3
    ///      Safe) freezes with no delay. The checkpoint signer is refused
    ///      here, including if a later change names it somewhere else. An
    ///      attestor role, if one is added, belongs in this function and must
    ///      not be the checkpoint key. This function does not unfreeze.
    function _mayFreeze(address caller) internal view returns (bool) {
        if (caller == checkpoint) return false;
        return caller == controller;
    }

    /// @notice Halt anchor now. No timelock. The controller calls this. The
    ///         checkpoint signer cannot. A later unfreeze waits ROTATION_DELAY.
    function freeze() external {
        if (!_mayFreeze(msg.sender)) revert NotController();
        if (frozen) revert AlreadyFrozen();
        Head memory h = heads[latestEpoch];
        frozen = true;
        frozenEpoch = latestEpoch;
        emit Frozen(latestEpoch, h.size, uint64(h.hourStart), uint64(block.timestamp));
    }

    /// @notice Kind 3. Starts the same 24 hour wait as a key change. Only the
    ///         controller. There is no direct unfreeze.
    function proposeUnfreeze() external {
        if (msg.sender != controller) revert NotController();
        if (pendingAction.kind != 0) revert ActionPending();
        if (!frozen) revert NotFrozen();
        uint64 eta = uint64(block.timestamp + ROTATION_DELAY);
        pendingAction = Pending({kind: 3, addr: address(0), version: 0, eta: eta});
        emit ActionProposed(3, address(0), 0, eta);
    }

    /// @notice Kind 1. The version must be strictly above checkpointVersion
    ///         and must fit the uint32 stored on a head. Both failures revert
    ///         BadVersion.
    function proposeRotation(address newAddr, uint64 version) external {
        if (msg.sender != controller) revert NotController();
        if (pendingAction.kind != 0) revert ActionPending();
        if (newAddr == address(0)) revert ZeroCheckpoint();
        if (newAddr == checkpoint) revert SameCheckpoint();
        if (newAddr == controller) revert RotationToController();
        if (version <= checkpointVersion) revert BadVersion();
        if (version > type(uint32).max) revert BadVersion();
        uint64 eta = uint64(block.timestamp + ROTATION_DELAY);
        pendingAction = Pending({kind: 1, addr: newAddr, version: version, eta: eta});
        emit ActionProposed(1, newAddr, version, eta);
    }

    /// @notice Kind 2. Rejects zero, the current controller, and the checkpoint.
    function proposeControllerChange(address newController) external {
        if (msg.sender != controller) revert NotController();
        if (pendingAction.kind != 0) revert ActionPending();
        if (newController == address(0)) revert ZeroCheckpoint();
        if (newController == controller) revert SameCheckpoint();
        if (newController == checkpoint) revert ControllerIsCheckpoint();
        uint64 eta = uint64(block.timestamp + ROTATION_DELAY);
        pendingAction = Pending({kind: 2, addr: newController, version: 0, eta: eta});
        emit ActionProposed(2, newController, 0, eta);
    }

    /// @notice Applies the one pending action once eta has arrived. The slot
    ///         is cleared before the checkpoint or the controller changes.
    ///         This function does not write heads.
    function executePending() external {
        if (msg.sender != controller) revert NotController();
        uint8 kind = pendingAction.kind;
        address pendingAddr = pendingAction.addr;
        uint64 version = pendingAction.version;
        uint64 eta = pendingAction.eta;
        if (kind == 0) revert NoPendingAction();
        if (block.timestamp < eta) revert TooEarly();
        // A freeze halts key changes. Kind 1 and kind 2 stay in the slot until
        // the controller cancels them. Kind 3 is the unfreeze and must run,
        // or the halt cannot be lifted.
        if (frozen && kind != 3) revert FrozenAction();
        delete pendingAction;
        if (kind == 1) {
            address old = checkpoint;
            address newAddr = pendingAddr;
            uint64 retiredVersion = checkpointVersion;
            uint64 cutoff = latestEpoch;
            cutoffOf[retiredVersion] = KeyCutoff({set: true, epoch: cutoff});
            checkpoint = newAddr;
            checkpointVersion = version;
            emit CheckpointKeyRetired(retiredVersion, old, cutoff);
            emit CheckpointKeyRotated(version, old, newAddr);
        } else if (kind == 2) {
            address oldController = controller;
            controller = pendingAddr;
            emit ControllerChanged(oldController, pendingAddr);
        } else if (kind == 3) {
            frozen = false;
            emit Unfrozen(latestEpoch, uint64(block.timestamp));
        }
    }

    /// @notice Drops the pending action. A later proposal starts a new delay.
    function cancelPending() external {
        if (msg.sender != controller) revert NotController();
        uint8 kind = pendingAction.kind;
        if (kind == 0) revert NoPendingAction();
        delete pendingAction;
        emit ActionCancelled(kind);
    }
}
