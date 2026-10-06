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
///
/// Broadcast (human, after the env is exported in the local shell):
///   forge script script/DeployChitIssuerRoot.s.sol --rpc-url https://sepolia.base.org --broadcast --slow
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
    error NeedTwoDistinctOwners();
    error OwnerNotOnSafe(address owner);
    error ThresholdNotTwo(uint256 threshold);
    error GenesisCommitFailed();
    error SameKid();

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
    }

    function run() external {
        // Before any key is read and before any broadcast.
        BroadcastChain.assertBaseSepolia();
        Genesis memory g = _load();
        _requireSafeOwners(g);
        vm.startBroadcast(g.deployerPk);
        ChitIssuerRoot root = new ChitIssuerRoot(g.controller, g.genesisKid, g.genesisNotBefore);
        _genesisCommit(ISafeExec(g.controller), root, g);
        vm.stopBroadcast();
        console2.log("ChitIssuerRoot", address(root));
        console2.log("rootSeq", root.rootSeq());
        console2.logBytes32(root.rootHash());
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
        if (g.standbyKid == g.genesisKid) revert SameKid();
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

    function _genesisCommit(ISafeExec safe, ChitIssuerRoot root, Genesis memory g) internal {
        bytes memory data = _genesisCalldata(g);
        _exec(safe, address(root), data, g.ownerPk1, g.ownerPk2);
    }

    function _genesisCalldata(Genesis memory g) internal view returns (bytes memory) {
        ChitIssuerRoot.Op[] memory ops = new ChitIssuerRoot.Op[](1);
        ops[0] = ChitIssuerRoot.Op({
            kind: 1, // OP_ADD_STANDBY
            kid: g.standbyKid,
            timestamp: uint64(block.timestamp + 24 hours),
            reasonCode: 0
        });
        ChitIssuerRoot.FreezeArg[] memory freezeArgs = new ChitIssuerRoot.FreezeArg[](1);
        freezeArgs[0] = ChitIssuerRoot.FreezeArg({
            universeId: g.legacyId,
            universeHash: g.legacyHash,
            enumeratedCount: g.enumerated
        });
        return abi.encodeCall(ChitIssuerRoot.commit, (ops, freezeArgs, g.histVersion, g.histSnapshot));
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
