// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Rfc9162} from "./Rfc9162.sol";

/// @title ChitAnchor
/// @notice Base Sepolia v0 hourly log anchor. The checkpoint address is the only
///         sender. A finished hour is one whose whole 3600 seconds are already
///         in the past. Kind 0 is the only kind this deployment emits.
contract ChitAnchor {
    uint8 internal constant KIND_HOURLY = 0;

    struct Head {
        uint64 epoch;
        uint64 hourStart;
        uint64 size;
        bytes32 root;
        bytes32 stateRoot;
    }

    address public checkpoint;
    uint64 public checkpointVersion;
    bytes32 public immutable domain;
    Head private _head;

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
        _head.root = Rfc9162.EMPTY_ROOT;
        domain = sha256(abi.encodePacked("chit402-checkpoint-v1", uint64(block.chainid), address(this)));
        emit CheckpointKeyRotated(1, address(0), checkpoint_);
    }

    function latest()
        external
        view
        returns (uint64 epoch, uint64 hourStart, uint64 size, bytes32 root, bytes32 stateRoot)
    {
        Head memory h = _head;
        return (h.epoch, h.hourStart, h.size, h.root, h.stateRoot);
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
        if (epoch_ != _head.epoch + 1) revert BadEpoch();
        if (hourStart_ % 3600 != 0) revert BadHour();
        if (hourStart_ <= _head.hourStart) revert HourNotIncreasing();
        // A clock hour may close only after it has ended.
        if (uint256(hourStart_) + 3600 > block.timestamp) revert HourNotFinished();
        if (size_ <= _head.size) revert SizeNotIncreasing();

        if (Rfc9162.verifyConsistency(_head.size, size_, _head.root, root_, consistencyProof) != Rfc9162.OK) {
            revert BadConsistency();
        }

        _head.epoch = epoch_;
        _head.hourStart = hourStart_;
        _head.size = size_;
        _head.root = root_;
        _head.stateRoot = stateRoot_;
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
