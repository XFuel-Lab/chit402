// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script, console2} from "forge-std/Script.sol";
import {ChitIssuerRoot} from "../contracts/registry/ChitIssuerRoot.sol";
import {BroadcastChain} from "../contracts/registry/BroadcastChain.sol";

/// @notice Deploys ChitIssuerRoot and sends the sample genesis commit through a Safe.
///
/// HARD RULE: this script reverts unless `block.chainid == 84532` (Base Sepolia).
/// It refuses Base mainnet (8453) and every other chain. There is no mainnet RPC
/// in `foundry.toml`. Do not add one.
///
/// `SEPOLIA_THROWAWAY_PK` is a throwaway deployer key funded only on Base Sepolia.
/// It has no mainnet use. `SEPOLIA_SAFE_OWNER_PK_1` and `SEPOLIA_SAFE_OWNER_PK_2`
/// are two throwaway Safe owner keys. None of these keys are committed, and none
/// of them may be the gateway `ISSUER_PRIVATE_KEY`.
///
/// Required env (names only; values stay in the local shell):
///   SEPOLIA_THROWAWAY_PK
///   SEPOLIA_SAFE_OWNER_PK_1
///   SEPOLIA_SAFE_OWNER_PK_2
///   CHIT_ISSUER_ROOT_CONTROLLER   Safe address
///   CHIT_GENESIS_KID              bytes32 RFC 7638 thumbprint
///   CHIT_GENESIS_NOT_BEFORE       unix seconds
///   CHIT_STANDBY_KID              bytes32
///   CHIT_HIST_SNAPSHOT            bytes32
///   CHIT_LEGACY_UNIVERSE_ID       bytes32
///   CHIT_LEGACY_UNIVERSE_HASH     bytes32 Merkle root
///   CHIT_LEGACY_ENUMERATED_COUNT
/// Optional: CHIT_HIST_VERSION (default 1)
///           CHIT_STANDBY_CUSHION (seconds past the 24h minimum; default 3600)
/// Guardian addresses and witness proofs of possession, never private keys:
///   CHIT_GUARDIAN_COUNT, CHIT_GUARDIAN_THRESHOLD, CHIT_WITNESS_SALT
///   CHIT_GUARDIAN_1 .. CHIT_GUARDIAN_N
///   CHIT_GUARDIAN_POP_1 .. CHIT_GUARDIAN_POP_N (0x hex signatures)
///
/// The sample standby `notBefore` is `latestTimestamp + 24 hours + cushion`.
/// The dry run used `simulatedTimestamp + 24 hours` and the mined block was
/// about a minute later, so `commit` reverted `ActivationTooSoon` on chain.
/// Before `startBroadcast`, the script eth_calls that commit at the latest
/// block's timestamp and rolls the state back. A revert there aborts the
/// script, so forge does not send the transaction.
///
/// Broadcast (human, after the env is exported in the local shell):
///   forge script script/DeployChitIssuerRoot.s.sol --rpc-url https://sepolia.base.org --broadcast --slow
interface ISafeOwners {
    function getOwners() external view returns (address[] memory);
}

interface ISafeExec {
    function execTransaction(
        address to,
        uint256 value,
        bytes calldata data,
        uint8 operation,
        uint256 safeTxGas,
        uint256 baseGas,
        uint256 gasPrice,
        address gasToken,
        address payable refundReceiver,
        bytes memory signatures
    ) external payable returns (bool success);

    function getTransactionHash(
        address to,
        uint256 value,
        bytes calldata data,
        uint8 operation,
        uint256 safeTxGas,
        uint256 baseGas,
        uint256 gasPrice,
        address gasToken,
        address refundReceiver,
        uint256 _nonce
    ) external view returns (bytes32);

    function nonce() external view returns (uint256);
    function isOwner(address owner) external view returns (bool);
    function getThreshold() external view returns (uint256);
}

contract DeployChitIssuerRoot is Script {
    /// @dev Seconds added on top of `ACTIVATION_DELAY`. One hour covers the
    ///      dry-run gap (simulated timestamp, then a mined block ~56s later).
    uint256 public constant DEFAULT_STANDBY_CUSHION = 1 hours;

    error NeedTwoDistinctOwners();
    error OwnerNotOnSafe(address owner);
    error ThresholdNotTwo(uint256 threshold);
    error GenesisCommitFailed();
    error SameKid();
    error CushionOverflow();
    /// @dev `reason` is the revert data from the preflight eth_call.
    error PreflightRevert(bytes reason);

    struct Genesis {
        uint256 deployerPk;
        uint256 ownerPk1;
        uint256 ownerPk2;
        address controller;
        bytes32 genesisKid;
        uint64 genesisNotBefore;
        bytes32 standbyKid;
        bytes32 histSnapshot;
        bytes32 legacyId;
        bytes32 legacyHash;
        uint64 enumerated;
        uint64 histVersion;
        address[] guardians;
        bytes[] pops;
        uint64 guardianThreshold;
        bytes32 witnessSalt;
    }

    function run() external {
        // Before any key is read and before any broadcast.
        BroadcastChain.assertBaseSepolia();
        Genesis memory g = _load();
        _requireSafeOwners(g);

        uint256 latest = latestBlockTimestamp();
        uint64 notBefore = standbyNotBefore(latest, standbyCushion());
        bytes memory inner = _genesisCalldata(g, notBefore);
        _preflightAtLatest(g, inner, latest);

        vm.startBroadcast(g.deployerPk);
        ChitIssuerRoot root = new ChitIssuerRoot(
            g.controller, g.genesisKid, g.genesisNotBefore, g.guardians, g.guardianThreshold, g.witnessSalt, g.pops
        );
        _exec(ISafeExec(g.controller), address(root), inner, g.ownerPk1, g.ownerPk2);
        vm.stopBroadcast();
        console2.log("ChitIssuerRoot", address(root));
        console2.log("standby notBefore", notBefore);
        console2.log("rootSeq", root.rootSeq());
        console2.logBytes32(root.rootHash());
    }

    /// @notice `timestamp + 24 hours + cushion`, checked to fit in `uint64`.
    function standbyNotBefore(uint256 timestamp, uint256 cushion) public pure returns (uint64) {
        // Same 24h minimum as `ChitIssuerRoot.ACTIVATION_DELAY`. A public
        // constant on that contract is not visible as `ChitIssuerRoot.ACTIVATION_DELAY`.
        uint256 sum = timestamp + 24 hours + cushion;
        if (sum > type(uint64).max) revert CushionOverflow();
        return uint64(sum);
    }

    /// @notice `CHIT_STANDBY_CUSHION` in seconds, or one hour when unset.
    function standbyCushion() public view returns (uint256) {
        return vm.envOr("CHIT_STANDBY_CUSHION", DEFAULT_STANDBY_CUSHION);
    }

    /// @dev Latest head from the script RPC. Unit tests have no fork, so a failed
    ///      `eth_getBlockByNumber` falls back to `block.timestamp`.
    function latestBlockTimestamp() public returns (uint256) {
        try this.readLatestBlockTimestamp() returns (uint256 ts) {
            if (ts == 0) return block.timestamp;
            return ts;
        } catch {
            return block.timestamp;
        }
    }

    function readLatestBlockTimestamp() external returns (uint256) {
        bytes memory raw = vm.rpc("eth_getBlockByNumber", "[\"latest\", false]");
        return vm.parseJsonUint(string(raw), ".timestamp");
    }

    /// @notice eth_call the genesis commit as `controller` at the current block
    ///         timestamp, then roll that state back. Set the timestamp to the
    ///         latest head before calling. A revert means do not broadcast.
    function preflightGenesis(address controller, address registry, bytes memory data) public {
        _preflightCall(controller, registry, data);
    }

    function _preflightCall(address controller, address registry, bytes memory data) internal {
        uint256 snap = vm.snapshotState();
        vm.prank(controller);
        (bool ok, bytes memory ret) = registry.call(data);
        bool restored = vm.revertToState(snap);
        if (!restored || !ok) revert PreflightRevert(ok ? bytes("") : ret);
    }

    function _load() internal view returns (Genesis memory g) {
        g.deployerPk = vm.envUint("SEPOLIA_THROWAWAY_PK");
        g.ownerPk1 = vm.envUint("SEPOLIA_SAFE_OWNER_PK_1");
        g.ownerPk2 = vm.envUint("SEPOLIA_SAFE_OWNER_PK_2");
        g.controller = vm.envAddress("CHIT_ISSUER_ROOT_CONTROLLER");
        g.genesisKid = vm.envBytes32("CHIT_GENESIS_KID");
        g.genesisNotBefore = _u64("CHIT_GENESIS_NOT_BEFORE");
        g.standbyKid = vm.envBytes32("CHIT_STANDBY_KID");
        g.histSnapshot = vm.envBytes32("CHIT_HIST_SNAPSHOT");
        g.legacyId = vm.envBytes32("CHIT_LEGACY_UNIVERSE_ID");
        g.legacyHash = vm.envBytes32("CHIT_LEGACY_UNIVERSE_HASH");
        g.enumerated = _u64("CHIT_LEGACY_ENUMERATED_COUNT");
        g.histVersion = uint64(vm.envOr("CHIT_HIST_VERSION", uint256(1)));
        g.guardianThreshold = uint64(vm.envUint("CHIT_GUARDIAN_THRESHOLD"));
        g.witnessSalt = vm.envBytes32("CHIT_WITNESS_SALT");
        (g.guardians, g.pops) = _loadGuardians();
        if (g.standbyKid == g.genesisKid) revert SameKid();
        _assertGuardiansNotSigners(g);
    }

    function _loadGuardians() internal view returns (address[] memory set, bytes[] memory pops) {
        uint256 n = vm.envUint("CHIT_GUARDIAN_COUNT");
        if (n == 0 || n > 5) revert("CHIT_GUARDIAN_COUNT must be 1..5");
        set = new address[](n);
        pops = new bytes[](n);
        for (uint256 i = 0; i < n; i++) {
            string memory id = vm.toString(i + 1);
            set[i] = vm.envAddress(string.concat("CHIT_GUARDIAN_", id));
            pops[i] = vm.parseBytes(vm.envString(string.concat("CHIT_GUARDIAN_POP_", id)));
        }
    }

    /// @dev Deploy-time refusal of a controller signer also sitting as a guardian.
    ///      The constructor repeats this with `isOwner`.
    function _assertGuardiansNotSigners(Genesis memory g) internal view {
        address[] memory owners = ISafeOwners(g.controller).getOwners();
        for (uint256 i = 0; i < g.guardians.length; i++) {
            if (g.guardians[i] == g.controller) revert("guardian is the controller");
            for (uint256 j = 0; j < owners.length; j++) {
                if (g.guardians[i] == owners[j]) revert("guardian is a controller signer");
            }
        }
    }

    function _requireSafeOwners(Genesis memory g) internal view {
        address owner1 = vm.addr(g.ownerPk1);
        address owner2 = vm.addr(g.ownerPk2);
        if (owner1 == owner2) revert NeedTwoDistinctOwners();
        ISafeExec safe = ISafeExec(g.controller);
        if (!safe.isOwner(owner1)) revert OwnerNotOnSafe(owner1);
        if (!safe.isOwner(owner2)) revert OwnerNotOnSafe(owner2);
        uint256 threshold = safe.getThreshold();
        if (threshold != 2) revert ThresholdNotTwo(threshold);
    }

    /// @dev Deploy a throwaway copy at `latest`, eth_call the commit, then roll
    ///      back. The broadcast section below is reached only if that call succeeds.
    function _preflightAtLatest(Genesis memory g, bytes memory inner, uint256 latest) internal {
        uint256 snap = vm.snapshotState();
        vm.warp(latest);
        ChitIssuerRoot staged = new ChitIssuerRoot(
            g.controller, g.genesisKid, g.genesisNotBefore, g.guardians, g.guardianThreshold, g.witnessSalt, g.pops
        );
        _preflightCall(g.controller, address(staged), inner);
        if (!vm.revertToState(snap)) revert PreflightRevert("");
    }

    function _genesisCalldata(Genesis memory g, uint64 notBefore) internal pure returns (bytes memory) {
        return genesisCommitData(
            g.standbyKid, g.legacyId, g.legacyHash, g.enumerated, g.histVersion, g.histSnapshot, notBefore
        );
    }

    function genesisCommitData(
        bytes32 standbyKid,
        bytes32 legacyId,
        bytes32 legacyHash,
        uint64 enumerated,
        uint64 histVersion,
        bytes32 histSnapshot,
        uint64 notBefore
    ) public pure returns (bytes memory) {
        ChitIssuerRoot.Op[] memory ops = new ChitIssuerRoot.Op[](1);
        ops[0] = ChitIssuerRoot.Op({
            kind: 1, // OP_ADD_STANDBY
            kid: standbyKid,
            timestamp: notBefore,
            reasonCode: 0
        });
        ChitIssuerRoot.FreezeArg[] memory freezeArgs = new ChitIssuerRoot.FreezeArg[](1);
        freezeArgs[0] = ChitIssuerRoot.FreezeArg({
            universeId: legacyId,
            universeHash: legacyHash,
            enumeratedCount: enumerated
        });
        return abi.encodeCall(ChitIssuerRoot.commit, (ops, freezeArgs, histVersion, histSnapshot));
    }

    function _exec(ISafeExec safe, address to, bytes memory data, uint256 pk1, uint256 pk2) internal {
        uint256 nonce = safe.nonce();
        bytes32 txHash = safe.getTransactionHash(to, 0, data, 0, 0, 0, 0, address(0), address(0), nonce);
        bytes memory signatures = _twoSignatures(txHash, pk1, pk2);
        bool ok = safe.execTransaction(to, 0, data, 0, 0, 0, 0, address(0), payable(address(0)), signatures);
        if (!ok) revert GenesisCommitFailed();
    }

    function _twoSignatures(bytes32 hash, uint256 pk1, uint256 pk2) internal pure returns (bytes memory) {
        (uint8 v1, bytes32 r1, bytes32 s1) = vm.sign(pk1, hash);
        (uint8 v2, bytes32 r2, bytes32 s2) = vm.sign(pk2, hash);
        address a1 = vm.addr(pk1);
        address a2 = vm.addr(pk2);
        if (a1 < a2) return abi.encodePacked(r1, s1, v1, r2, s2, v2);
        return abi.encodePacked(r2, s2, v2, r1, s1, v1);
    }

    function _u64(string memory name) internal view returns (uint64) {
        uint256 value = vm.envUint(name);
        if (value > type(uint64).max) revert("env does not fit uint64");
        return uint64(value);
    }
}
