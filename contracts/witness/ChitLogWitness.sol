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

    /// @notice A fresh witness pointer. `id` is keccak256 of the URL bytes.
    ///         A new URL is a new id. This event is not a rotation.
    event WitnessRegistered(bytes32 indexed id, address indexed key, address indexed operator);

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
    error EmptyKey();
    error EmptyUrl();
    error PossessionMissing();
    error PossessionRejected();

    /// @notice Domain for a witness proof of possession. The preimage also
    ///         binds `chainId` and `registry` (this contract), the same two
    ///         words ChitIssuerRoot binds into a root hash.
    bytes32 public constant REGISTER_DOMAIN = keccak256("chit.logWitness.register.v1");

    /// @notice Domain for a countersignature of a log head. Distinct from
    ///         REGISTER_DOMAIN, so a registration signature is not a countersignature.
    bytes32 public constant COUNTERSIGN_DOMAIN = keccak256("chit.logWitness.countersign.v1");

    /// @notice One registration. A null `key` is the zero address and is not stored.
    struct WitnessRecord {
        address key;
        address operator;
        string url;
    }

    mapping(bytes32 => WitnessRecord) private _witnesses;

    modifier onlyOwner() {
        if (msg.sender != owner) revert NotOwner(msg.sender);
        _;
    }

    modifier onlyAppender() {
        if (msg.sender != appender) revert NotAppender(msg.sender);
        _;
    }

    /// @param epoch_ Must be 1. Any other epoch reverts.
    /// @param size_  Must be 4. Any other size reverts.
    /// @param root_  Must be the epoch-1 final root `dd20e39a…`. Any other root reverts.
    ///         A deploy cannot open on the Oct 5 head. That head is only
    ///         `declareEpoch` from the Safe, after this constructor.
    constructor(address owner_, address appender_, uint256 epoch_, uint256 size_, bytes32 root_) {
        if (owner_ == address(0) || appender_ == address(0)) revert ZeroAddress();
        if (epoch_ != 1 || size_ != EPOCH1_FINAL_SIZE || root_ != EPOCH1_FINAL_ROOT) revert PinMismatch();
        owner = owner_;
        appender = appender_;
        _head = LogHead({epoch: 1, size: EPOCH1_FINAL_SIZE, root: EPOCH1_FINAL_ROOT});
        emit HeadInitialized(1, EPOCH1_FINAL_SIZE, EPOCH1_FINAL_ROOT);
    }

    /// @dev Test harnesses start from a later head. Production bytecode does
    ///      not call this. The constructor above is the only deploy path.
    function _setHead(uint256 epoch_, uint256 size_, bytes32 root_) internal {
        _head = LogHead({epoch: epoch_, size: size_, root: root_});
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

    /// @notice EIP-191 digest the `key` must sign: URL, key, chain id, and
    ///         this contract. A signature over another URL, key, chain, or
    ///         contract does not recover `key`.
    function registrationDigest(string calldata url, address key) public view returns (bytes32) {
        bytes32 inner = keccak256(abi.encode(REGISTER_DOMAIN, block.chainid, address(this), key, keccak256(bytes(url))));
        return keccak256(abi.encodePacked("\x19Ethereum Signed Message:\n32", inner));
    }

    /// @notice Store a new witness pointer. The signature must be by `key`
    ///         over this URL. No signature is refused. A different URL is a
    ///         different id and copies nothing from any earlier row.
    function register(string calldata url, address key, bytes calldata signature) external returns (bytes32 id) {
        if (bytes(url).length == 0) revert EmptyUrl();
        if (key == address(0)) revert EmptyKey();
        if (signature.length == 0) revert PossessionMissing();
        if (_recover(registrationDigest(url, key), signature) != key) revert PossessionRejected();
        id = keccak256(bytes(url));
        _witnesses[id] = WitnessRecord({key: key, operator: msg.sender, url: url});
        emit WitnessRegistered(id, key, msg.sender);
    }

    /// @notice Digest a witness signs over its own key, URL, directory row,
    ///         and the directory epoch, plus the log head. `chainId` and
    ///         `registry` are bound the same way as registration.
    function countersignDigest(
        bytes32 id,
        uint256 rowEpoch,
        address key,
        string calldata url,
        uint256 logSize,
        bytes32 logRoot
    ) public view returns (bytes32) {
        bytes32 inner = keccak256(
            abi.encode(
                COUNTERSIGN_DOMAIN,
                block.chainid,
                address(this),
                id,
                rowEpoch,
                key,
                keccak256(bytes(url)),
                logSize,
                logRoot
            )
        );
        return keccak256(abi.encodePacked("\x19Ethereum Signed Message:\n32", inner));
    }

    /// @notice True only when `signature` is by `key` over this URL, this row
    ///         id, and this epoch, and that row stores the same key and URL.
    function countersignatureMatches(
        bytes32 id,
        uint256 rowEpoch,
        address key,
        string calldata url,
        uint256 logSize,
        bytes32 logRoot,
        bytes calldata signature
    ) external view returns (bool) {
        if (key == address(0) || bytes(url).length == 0 || signature.length == 0) return false;
        if (id != keccak256(bytes(url))) return false;
        WitnessRecord storage row = _witnesses[id];
        if (row.key != key) return false;
        if (keccak256(bytes(row.url)) != keccak256(bytes(url))) return false;
        return _recover(countersignDigest(id, rowEpoch, key, url, logSize, logRoot), signature) == key;
    }

    function witnessRecord(bytes32 id) external view returns (address key, address operator, string memory url) {
        WitnessRecord storage row = _witnesses[id];
        return (row.key, row.operator, row.url);
    }

    /// @notice A null or empty key is not a witness a reader can pin.
    function discoverable(bytes32 id) public view returns (bool) {
        return _witnesses[id].key != address(0);
    }

    /// @notice True when this row can count as an independent custodian.
    ///         A null key, an operator that is us, or a URL only on our host
    ///         does not.
    function independent(bytes32 id) public view returns (bool) {
        WitnessRecord storage row = _witnesses[id];
        if (row.key == address(0)) return false;
        if (row.operator == owner || row.operator == appender) return false;
        if (copyOnOurHost(row.url)) return false;
        return true;
    }

    /// @notice How many of `ids` are independent. A null key adds nothing.
    ///         An our-host-only copy adds nothing. Duplicates are not folded.
    function quorum(bytes32[] calldata ids) external view returns (uint256 n) {
        for (uint256 i = 0; i < ids.length; i++) {
            if (independent(ids[i])) n += 1;
        }
    }

    /// @notice True when `url` is only a copy we can rewrite: `chit402.com`,
    ///         any subdomain, or a `/.well-known/` path with no other host.
    function copyOnOurHost(string memory url) public pure returns (bool) {
        bytes memory lower = _lower(bytes(url));
        if (lower.length == 0) return true;
        uint256 start = 0;
        bool sawScheme = false;
        for (uint256 i = 0; i + 2 < lower.length; i++) {
            if (lower[i] == 0x3a && lower[i + 1] == 0x2f && lower[i + 2] == 0x2f) {
                start = i + 3;
                sawScheme = true;
                break;
            }
        }
        if (!sawScheme && lower[0] == 0x2f) return _startsWith(lower, bytes("/.well-known/"));
        uint256 hostStart = start;
        uint256 path = lower.length;
        for (uint256 i = start; i < lower.length; i++) {
            if (lower[i] == 0x2f) {
                path = i;
                break;
            }
            if (lower[i] == 0x3f) {
                path = i;
                break;
            }
            if (lower[i] == 0x40) hostStart = i + 1;
        }
        uint256 hostEnd = path;
        for (uint256 i = hostStart; i < path; i++) {
            if (lower[i] == 0x3a) {
                hostEnd = i;
                break;
            }
        }
        if (hostEnd <= hostStart) return true;
        return _isOurHost(lower, hostStart, hostEnd);
    }

    function _isOurHost(bytes memory s, uint256 start, uint256 end) internal pure returns (bool) {
        bytes memory host = bytes("chit402.com");
        uint256 n = end - start;
        if (n == host.length && _eq(s, start, host)) return true;
        if (n > host.length + 1 && s[end - host.length - 1] == 0x2e && _eq(s, end - host.length, host)) return true;
        return false;
    }

    function _lower(bytes memory raw) internal pure returns (bytes memory lower) {
        lower = new bytes(raw.length);
        for (uint256 i = 0; i < raw.length; i++) {
            bytes1 c = raw[i];
            if (c >= 0x41 && c <= 0x5A) c = bytes1(uint8(c) + 32);
            lower[i] = c;
        }
    }

    function _startsWith(bytes memory s, bytes memory prefix) internal pure returns (bool) {
        if (s.length < prefix.length) return false;
        return _eq(s, 0, prefix);
    }

    function _eq(bytes memory s, uint256 start, bytes memory other) internal pure returns (bool) {
        if (start + other.length > s.length) return false;
        for (uint256 i = 0; i < other.length; i++) {
            if (s[start + i] != other[i]) return false;
        }
        return true;
    }

    function _recover(bytes32 digest, bytes calldata signature) internal pure returns (address) {
        if (signature.length != 65) return address(0);
        bytes32 r;
        bytes32 s;
        uint8 v;
        assembly {
            r := calldataload(signature.offset)
            s := calldataload(add(signature.offset, 32))
            v := byte(0, calldataload(add(signature.offset, 64)))
        }
        if (uint256(s) > 0x7FFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF5D576E7357A4501DDFE92F46681B20A0) return address(0);
        if (v < 27) v += 27;
        if (v != 27 && v != 28) return address(0);
        return ecrecover(digest, v, r, s);
    }
}
