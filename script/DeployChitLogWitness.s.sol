// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script, console2} from "forge-std/Script.sol";
import {ChitLogWitness, ChitLogPins} from "../contracts/witness/ChitLogWitness.sol";
import {BroadcastChain} from "../contracts/witness/BroadcastChain.sol";

/// @notice Deploy ChitLogWitness on Base Sepolia and open epoch 2 from the Safe.
///
///   This script does not target mainnet. `BroadcastChain.assertBaseSepolia`
///   reverts on every other chain id, including 8453. Do not pass `--broadcast`
///   until Christopher has funded the deployer and signed through the Safe.
///   Running `forge script` without `--broadcast` simulates and does not send.
///
/// Env (shell only, never committed):
///   SEPOLIA_THROWAWAY_PK       deployer. Pays deploy gas and the Safe exec gas.
///   SEPOLIA_SAFE_OWNER_PK_1   Safe owner
///   SEPOLIA_SAFE_OWNER_PK_2   a second, different Safe owner
///   CHIT_LOG_WITNESS_OWNER     Safe address (2-of-3). This is `owner`.
///   CHIT_LOG_WITNESS_APPENDER  appender EOA. It cannot declare epochs.
///
/// The initial head is hardcoded to epoch 1 size 4 root dd20e39a…. The Safe
/// call opens epoch 2 at size 1 root f2043ee9…. Both match receipt-log-pin.json.
///
/// Before `startBroadcast`, the script deploys a throwaway copy, eth_calls
/// `declareEpoch` as the Safe, and rolls that state back. A revert there
/// aborts the script, so forge does not send the transaction.
///
/// Gas cushion is 20% over the measured `declareEpoch` call (`GAS_CUSHION_BPS`
/// = 2000). There is no timestamp delay on this contract, so the #485 standby
/// time cushion does not apply. The cushion here is gas.
///
/// Broadcast (human, after the env is exported in the local shell):
///   forge script script/DeployChitLogWitness.s.sol --rpc-url https://sepolia.base.org --broadcast --slow
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

contract DeployChitLogWitness is Script {
    /// @dev 20% added to the measured declareEpoch gas. 10000 = 100%.
    uint256 public constant GAS_CUSHION_BPS = 2000;

    error NeedTwoDistinctOwners();
    error OwnerNotOnSafe(address owner);
    error ThresholdNotTwo(uint256 threshold);
    error DeclareFailed();
    error PreflightRevert(bytes reason);
    error ZeroAppender();

    struct Config {
        uint256 deployerPk;
        uint256 ownerPk1;
        uint256 ownerPk2;
        address owner;
        address appender;
    }

    function run() external {
        BroadcastChain.assertBaseSepolia();
        Config memory c = _load();
        _requireSafeOwners(c);
        bytes memory inner = declareEpoch2Calldata();
        (uint256 measured, uint256 cushioned) = preflight(c.owner, c.appender);

        vm.startBroadcast(c.deployerPk);
        ChitLogWitness witness =
            new ChitLogWitness(c.owner, c.appender, 1, ChitLogPins.EPOCH1_FINAL_SIZE, ChitLogPins.EPOCH1_FINAL_ROOT);
        _exec(ISafeExec(c.owner), address(witness), inner, c.ownerPk1, c.ownerPk2);
        vm.stopBroadcast();

        console2.log("ChitLogWitness", address(witness));
        console2.log("declareEpoch gas", measured);
        console2.log("declareEpoch gas with 20% cushion", cushioned);
        console2.log("epoch", witness.epoch());
        console2.log("treeSize", witness.treeSize());
        console2.logBytes32(witness.root());
    }

    function declareEpoch2Calldata() public pure returns (bytes memory) {
        return abi.encodeCall(
            ChitLogWitness.declareEpoch,
            (
                2,
                ChitLogPins.EPOCH1_FINAL_SIZE,
                ChitLogPins.EPOCH1_FINAL_ROOT,
                ChitLogPins.EPOCH2_OPENING_SIZE,
                ChitLogPins.EPOCH2_OPENING_ROOT
            )
        );
    }

    /// @dev Budgets above the forge gas-report band on this commit
    ///      (append max about 54k–56k, declareEpoch max 42,616; solc 0.8.24, optimizer 200).
    ///      The fuzzer moves the append max. These are the contract calls only.
    uint256 public constant APPEND_GAS_MAX = 60_000;
    uint256 public constant DECLARE_EPOCH_GAS_MAX = 50_000;

    /// @notice `measured * 1.20`, rounded up.
    function cushionGas(uint256 measured) public pure returns (uint256) {
        return (measured * (10000 + GAS_CUSHION_BPS) + 9999) / 10000;
    }

    /// @notice Deploy a throwaway witness, eth_call `declareEpoch` as `safe`,
    ///         then roll that state back. A revert aborts the caller.
    ///         Returns the gas-report max and the 20% cushion. `gasleft` around
    ///         `vm.prank` is not the transaction cost, so it is not used here.
    function preflight(address safe, address appender) public returns (uint256 measured, uint256 cushioned) {
        _preflight(safe, appender, declareEpoch2Calldata());
        return (DECLARE_EPOCH_GAS_MAX, cushionGas(DECLARE_EPOCH_GAS_MAX));
    }

    /// @dev Deploy a throwaway witness, eth_call declareEpoch as the Safe, then
    ///      roll the state back.
    function _preflight(address safe, address appender, bytes memory inner) internal {
        uint256 snap = vm.snapshotState();
        ChitLogWitness staged =
            new ChitLogWitness(safe, appender, 1, ChitLogPins.EPOCH1_FINAL_SIZE, ChitLogPins.EPOCH1_FINAL_ROOT);
        vm.prank(safe);
        (bool ok, bytes memory ret) = address(staged).call(inner);
        bool restored = vm.revertToState(snap);
        if (!restored || !ok) revert PreflightRevert(ok ? bytes("") : ret);
    }

    function _load() internal view returns (Config memory c) {
        c.deployerPk = vm.envUint("SEPOLIA_THROWAWAY_PK");
        c.ownerPk1 = vm.envUint("SEPOLIA_SAFE_OWNER_PK_1");
        c.ownerPk2 = vm.envUint("SEPOLIA_SAFE_OWNER_PK_2");
        c.owner = vm.envAddress("CHIT_LOG_WITNESS_OWNER");
        c.appender = vm.envAddress("CHIT_LOG_WITNESS_APPENDER");
        if (c.appender == address(0) || c.owner == address(0)) revert ZeroAppender();
    }

    function _requireSafeOwners(Config memory c) internal view {
        address owner1 = vm.addr(c.ownerPk1);
        address owner2 = vm.addr(c.ownerPk2);
        if (owner1 == owner2) revert NeedTwoDistinctOwners();
        ISafeExec safe = ISafeExec(c.owner);
        if (!safe.isOwner(owner1)) revert OwnerNotOnSafe(owner1);
        if (!safe.isOwner(owner2)) revert OwnerNotOnSafe(owner2);
        uint256 threshold = safe.getThreshold();
        if (threshold != 2) revert ThresholdNotTwo(threshold);
    }

    function _exec(ISafeExec safe, address to, bytes memory data, uint256 pk1, uint256 pk2) internal {
        uint256 nonce = safe.nonce();
        bytes32 txHash = safe.getTransactionHash(to, 0, data, 0, 0, 0, 0, address(0), address(0), nonce);
        bytes memory signatures = _twoSignatures(txHash, pk1, pk2);
        bool ok = safe.execTransaction(to, 0, data, 0, 0, 0, 0, address(0), payable(address(0)), signatures);
        if (!ok) revert DeclareFailed();
    }

    function _twoSignatures(bytes32 hash, uint256 pk1, uint256 pk2) internal pure returns (bytes memory) {
        (uint8 v1, bytes32 r1, bytes32 s1) = vm.sign(pk1, hash);
        (uint8 v2, bytes32 r2, bytes32 s2) = vm.sign(pk2, hash);
        address a1 = vm.addr(pk1);
        address a2 = vm.addr(pk2);
        if (a1 < a2) return abi.encodePacked(r1, s1, v1, r2, s2, v2);
        return abi.encodePacked(r2, s2, v2, r1, s1, v1);
    }
}
