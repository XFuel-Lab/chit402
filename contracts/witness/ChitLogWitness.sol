// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Rfc6962} from "./Rfc6962.sol";

/// @title ChitLogWitness
/// @author XFuel Protocol — Chit402
/// @custom:security-contact security@xfuel.app
/// @notice A head is current only after this contract accepts an RFC 6962
///         consistency proof from the head it already stores. A reset is an
///         epoch, and only the owner (a Safe) can declare one. The appender
///         can append and cannot declare an epoch or change either role.
///
///         There is no proxy, no upgrade, no `selfdestruct`, and no `receive`
///         or `fallback`. ETH sent here reverts.
///
/// @dev The Sepolia deploy script starts at epoch 1 size 4 root
///      `dd20e39a…` and the Safe then opens epoch 2 at size 1 root `f2043ee9…`.
///      `declareEpoch` to epoch 2 reverts unless both of those pins match.
///      Later epochs are whatever the Safe signs, and they must name the
///      stored head. An append that shrinks, or whose proof does not rebuild
///      both roots, reverts.
/// @notice Pinned heads from receipt-log-pin.json. Internal constants are
///         inlined into every contract that uses them, including the deploy script.
library ChitLogPins {
    uint256 internal constant EPOCH1_FINAL_SIZE = 4;
    bytes32 internal constant EPOCH1_FINAL_ROOT =
        0xdd20e39a39a225b7b3441bb7f61532c06562288b74ae5dc4dda015c48312f973;
    uint256 internal constant EPOCH2_OPENING_SIZE = 1;
    bytes32 internal constant EPOCH2_OPENING_ROOT =
        0xf2043ee96b6e9f678b76bb3c512b5d911293dbb2a3bf198c98252c83802f3286;
}

contract ChitLogWitness {
    uint256 public constant EPOCH1_FINAL_SIZE = ChitLogPins.EPOCH1_FINAL_SIZE;
    bytes32 public constant EPOCH1_FINAL_ROOT = ChitLogPins.EPOCH1_FINAL_ROOT;
    uint256 public constant EPOCH2_OPENING_SIZE = ChitLogPins.EPOCH2_OPENING_SIZE;
    bytes32 public constant EPOCH2_OPENING_ROOT = ChitLogPins.EPOCH2_OPENING_ROOT;

    struct LogHead {
        uint256 epoch;
        uint256 size;
        bytes32 root;
    }

    LogHead private _head;

    /// @notice Safe. Signer changes are Safe owner changes, not upgrades.
    address public owner;

    /// @notice May call `append`. Cannot call `declareEpoch` or change roles.
    address public appender;

    event HeadInitialized(uint256 indexed epoch, uint256 size, bytes32 root);
    event HeadAppended(
        uint256 indexed epoch, uint256 oldSize, bytes32 oldRoot, uint256 newSize, bytes32 newRoot
    );
    event EpochDeclared(
        uint256 indexed epoch, uint256 finalPrevSize, bytes32 finalPrevRoot, uint256 newSize, bytes32 newRoot
    );
    event AppenderSet(address indexed previous, address indexed next);
    event OwnerTransferred(address indexed previous, address indexed next);

    error NotOwner(address caller);
    error NotAppender(address caller);
    error ZeroAddress();
    error ZeroRoot();
    error SizeZero();
    error SizeNotExtended(uint256 current, uint256 next);
    error ProofRejected();
    error EpochNotAdvanced(uint256 current, uint256 next);
    error PrevHeadMismatch(uint256 size, bytes32 root);
    error PinMismatch();

    modifier onlyOwner() {
        if (msg.sender != owner) revert NotOwner(msg.sender);
        _;
    }

    modifier onlyAppender() {
        if (msg.sender != appender) revert NotAppender(msg.sender);
        _;
    }

    /// @param epoch_ Starting epoch. The deploy script passes 1.
    /// @param size_  Starting tree size. Epoch 1 on the deploy path is 4.
    /// @param root_  Starting root. Epoch 1 on the deploy path is `dd20e39a…`.
    constructor(address owner_, address appender_, uint256 epoch_, uint256 size_, bytes32 root_) {
        if (owner_ == address(0) || appender_ == address(0)) revert ZeroAddress();
        if (epoch_ == 0 || size_ == 0) revert SizeZero();
        if (root_ == bytes32(0)) revert ZeroRoot();
        owner = owner_;
        appender = appender_;
        _head = LogHead({epoch: epoch_, size: size_, root: root_});
        emit HeadInitialized(epoch_, size_, root_);
    }

    function head() external view returns (uint256 currentEpoch, uint256 currentSize, bytes32 currentRoot) {
        return (_head.epoch, _head.size, _head.root);
    }

    function epoch() external view returns (uint256) {
        return _head.epoch;
    }

    function treeSize() external view returns (uint256) {
        return _head.size;
    }

    function root() external view returns (bytes32) {
        return _head.root;
    }

    /// @notice True when `append` would accept this proof. Does not store it.
    function accepts(uint256 newSize, bytes32 newRoot, bytes32[] calldata proof) external view returns (bool) {
        if (newSize <= _head.size || newRoot == bytes32(0)) return false;
        return Rfc6962.verify(_head.size, newSize, _head.root, newRoot, proof);
    }

    /// @notice Extend the stored head. Reverts on shrink, on a same-size root
    ///         change, and on a proof that does not rebuild both roots.
    function append(uint256 newSize, bytes32 newRoot, bytes32[] calldata proof) external onlyAppender {
        if (newSize <= _head.size) revert SizeNotExtended(_head.size, newSize);
        if (newRoot == bytes32(0)) revert ZeroRoot();
        if (!Rfc6962.verify(_head.size, newSize, _head.root, newRoot, proof)) revert ProofRejected();
        uint256 oldSize = _head.size;
        bytes32 oldRoot = _head.root;
        _head.size = newSize;
        _head.root = newRoot;
        emit HeadAppended(_head.epoch, oldSize, oldRoot, newSize, newRoot);
    }

    /// @notice Open the next epoch. `finalPrevSize` and `finalPrevRoot` must
    ///         be the stored head. Epoch 2 is accepted only at the pinned
    ///         opening (`f2043ee9…`, size 1) from the pinned epoch 1 final.
    ///         A later epoch may shrink. That is the reset, and it is loud.
    function declareEpoch(
        uint256 newEpoch,
        uint256 finalPrevSize,
        bytes32 finalPrevRoot,
        uint256 newSize,
        bytes32 newRoot
    ) external onlyOwner {
        if (newEpoch != _head.epoch + 1) revert EpochNotAdvanced(_head.epoch, newEpoch);
        if (finalPrevSize != _head.size || finalPrevRoot != _head.root) {
            revert PrevHeadMismatch(_head.size, _head.root);
        }
        if (newSize == 0) revert SizeZero();
        if (newRoot == bytes32(0)) revert ZeroRoot();
        if (newEpoch == 2) {
            if (
                finalPrevSize != EPOCH1_FINAL_SIZE || finalPrevRoot != EPOCH1_FINAL_ROOT
                    || newSize != EPOCH2_OPENING_SIZE || newRoot != EPOCH2_OPENING_ROOT
            ) revert PinMismatch();
        }
        _head.epoch = newEpoch;
        _head.size = newSize;
        _head.root = newRoot;
        emit EpochDeclared(newEpoch, finalPrevSize, finalPrevRoot, newSize, newRoot);
    }

    function setAppender(address next) external onlyOwner {
        if (next == address(0)) revert ZeroAddress();
        emit AppenderSet(appender, next);
        appender = next;
    }

    function transferOwner(address next) external onlyOwner {
        if (next == address(0)) revert ZeroAddress();
        emit OwnerTransferred(owner, next);
        owner = next;
    }
}
