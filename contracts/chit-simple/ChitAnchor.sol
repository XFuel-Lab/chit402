// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Rfc9162} from "./Rfc9162.sol";

/// @title ChitAnchor
/// @notice Base Sepolia v0 hourly log anchor. The checkpoint address is the only
///         sender. A finished hour is one whose whole 3600 seconds are already
///         in the past. Kind 0 is the only kind this deployment emits.
///         Every epoch head is written once. A later anchor does not rewrite it.
contract ChitAnchor {
    uint8 internal constant KIND_HOURLY = 0;

    /// @notice An anchor later than hour end plus this many seconds is late.
    ///         The verifier prints that. The anchor still stores.
    uint64 public constant MAX_ANCHOR_LAG = 5400;

    struct Head {
        uint40 hourStart;
        uint64 size;
        uint32 checkpointVersion;
        uint64 anchorBlock;
        uint40 anchorTime;
        bytes32 root;
        bytes32 stateRoot;
    }

    address public checkpoint;
    uint64 public checkpointVersion;
    uint64 public latestEpoch;
    bytes32 public immutable domain;
    mapping(uint64 => Head) public heads;

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

    event Anchored(
        uint64 indexed epoch,
        uint64 indexed hourStart,
        uint64 size,
        bytes32 root,
        bytes32 stateRoot,
        uint8 kind
    );

    event CheckpointKeyRotated(uint64 version, address oldAddr, address newAddr);

    constructor(address checkpoint_) {
        if (checkpoint_ == address(0)) revert ZeroCheckpoint();
        checkpoint = checkpoint_;
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
        Head memory prev = heads[latestEpoch];
        if (epoch_ != latestEpoch + 1) revert BadEpoch();
        if (hourStart_ % 3600 != 0) revert BadHour();
        if (hourStart_ <= prev.hourStart) revert HourNotIncreasing();
        // A clock hour may close only after it has ended.
        if (uint256(hourStart_) + 3600 > block.timestamp) revert HourNotFinished();
        if (size_ <= prev.size) revert SizeNotIncreasing();

        if (Rfc9162.verifyConsistency(prev.size, size_, prev.root, root_, consistencyProof) != Rfc9162.OK) {
            revert BadConsistency();
        }

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

    function rotateCheckpointKey(address newAddr, uint64 version) external {
        if (msg.sender != checkpoint) revert NotCheckpoint();
        if (newAddr == address(0)) revert ZeroCheckpoint();
        if (newAddr == checkpoint) revert SameCheckpoint();
        if (version <= checkpointVersion) revert BadVersion();
        address old = checkpoint;
        checkpoint = newAddr;
        checkpointVersion = version;
        emit CheckpointKeyRotated(version, old, newAddr);
    }
}
