// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Rfc9162} from "./Rfc9162.sol";

/// @title ChitAnchor
/// @notice Chit402 hourly log anchor. The checkpoint address is the only
///         sender that can anchor. A third party cannot. A finished hour is one
///         whose whole 3600 seconds are already in the past. Kind 0 is the only
///         kind this deployment emits. Every epoch head is written once. A later
///         anchor does not rewrite it. Both kinds of key change go through the
///         controller and wait ROTATION_DELAY.
contract ChitAnchor {
    uint8 internal constant KIND_HOURLY = 0;

    /// @notice An anchor later than hour end plus this many seconds is late.
    ///         The verifier prints that. The anchor still stores.
    uint64 public constant MAX_ANCHOR_LAG = 5400;

    uint256 public constant ROTATION_DELAY = 24 hours;

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
    uint64 public checkpointVersion;
    uint64 public latestEpoch;
    bytes32 public immutable domain;
    mapping(uint64 => Head) public heads;
    address public controller;
    Pending public pendingAction;

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

    event Anchored(
        uint64 indexed epoch,
        uint64 indexed hourStart,
        uint64 size,
        bytes32 root,
        bytes32 stateRoot,
        uint8 kind
    );

    event CheckpointKeyRotated(uint64 version, address oldAddr, address newAddr);
    event ActionProposed(uint8 kind, address addr, uint64 version, uint64 eta);
    event ActionCancelled(uint8 kind);
    event ControllerChanged(address oldController, address newController);

    constructor(address checkpoint_, address controller_) {
        if (checkpoint_ == address(0)) revert ZeroCheckpoint();
        if (controller_ == address(0)) revert ZeroCheckpoint();
        if (controller_ == checkpoint_) revert SameCheckpoint();
        checkpoint = checkpoint_;
        controller = controller_;
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
        if (domain_ != domain) revert BadDomain();
        Head storage prev = heads[latestEpoch];
        if (epoch_ != latestEpoch + 1) revert BadEpoch();
        if (hourStart_ % 3600 != 0) revert BadHour();
        if (hourStart_ <= prev.hourStart) revert HourNotIncreasing();
        // A clock hour may close only after it has ended.
        if (uint256(hourStart_) + 3600 > block.timestamp) revert HourNotFinished();
        if (size_ <= prev.size) revert SizeNotIncreasing();

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
        delete pendingAction;
        if (kind == 1) {
            address old = checkpoint;
            address newAddr = pendingAddr;
            checkpoint = newAddr;
            checkpointVersion = version;
            emit CheckpointKeyRotated(version, old, newAddr);
        } else if (kind == 2) {
            address oldController = controller;
            controller = pendingAddr;
            emit ControllerChanged(oldController, pendingAddr);
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
