# ChitAnchor ABI (Base Sepolia v0)

The anchor surface is the Chit402 P0-7 hourly log. Key changes are a controller timelock. A third party cannot change a key. v0 emits `kind = 0` only. This file and `vectors/anchored-topic0.json` are the ABI spec for the anchor event. The owner deploys from `deploy/chit-simple/sepolia-pack/`. ChitAnchor is not a proxy.

Solidity `0.8.24`, via IR, optimizer 200 runs. No `delegatecall`, `selfdestruct`, owner, or payable path.

## Domain

`domain = SHA-256("chit402-checkpoint-v1" ‖ chainId as uint64 big-endian ‖ address(this))`

Computed once in the constructor and stored as an immutable. The anchor argument must equal it.

Illustrative check (not a deployment): contract `0x3333333333333333333333333333333333333333` on chain id 8453 hashes to `0x1ec6130d39d03ed3b8bce8139d615ffe17377a1cf2cab8f4b7bf98f45dda27b0`.

## Constructor

`constructor(address checkpoint, address controller, uint64 maxGrowth)`

Reverts `ZeroCheckpoint` if either address is zero. Reverts `SameCheckpoint` if they are equal. Reverts `ZeroGrowth` if `maxGrowth` is 0. Stores `maxGrowth` as the immutable `MAX_GROWTH`. The deploy default is `DEFAULT_MAX_GROWTH` = 1,000,000. Stores the checkpoint at version 1, stores the controller, and emits `CheckpointKeyRotated(1, address(0), checkpoint)`. Writes `heads[0]` once: hourStart 0, size 0, checkpointVersion 1, anchorBlock = the deploy block, anchorTime = the deploy timestamp, root = SHA-256("") (`0xe3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855`), stateRoot 0. `latestEpoch` starts at 0. The pending slot is empty (`kind = 0`). `frozen` starts false.

`ROTATION_DELAY` is `24 hours` (86400 seconds). `MAX_TREE_SIZE` is 2^53 − 1.

## anchor

```
anchor(bytes32 domain, uint64 epoch, uint64 hourStart, uint64 size, bytes32 root, bytes32 stateRoot, bytes32[] consistencyProof)
```

Checks, in order:

| Order | Check | Error |
|---|---|---|
| 1 | `msg.sender == checkpoint` | `NotCheckpoint()` |
| 2 | `frozen` is false | `AnchorFrozen()` |
| 3 | `domain` equals the immutable domain | `BadDomain()` |
| 4 | `epoch == latestEpoch + 1` | `BadEpoch()` |
| 5 | `hourStart % 3600 == 0` | `BadHour()` |
| 6 | `hourStart > heads[latestEpoch].hourStart` | `HourNotIncreasing()` |
| 7 | `hourStart + 3600 <= block.timestamp` (finished hour) | `HourNotFinished()` |
| 8 | `size > heads[latestEpoch].size` | `SizeNotIncreasing()` |
| 9 | `size <= MAX_TREE_SIZE` (2^53 − 1) | `SizeAboveCap()` |
| 10 | `size - heads[latestEpoch].size <= MAX_GROWTH` | `GrowthCap()` |
| 11 | RFC 9162 consistency of `(prior size, prior root)` to `(size, root)`, genesis when prior size is 0 | `BadConsistency()` |

Then it writes `heads[epoch]` once, with `anchorBlock = block.number`, `anchorTime = block.timestamp`, and `checkpointVersion` equal to the version stored at that call. It sets `latestEpoch` to `epoch` and emits Anchored with `kind = 0`. A later call does not rewrite an earlier head. `executePending` does not write `heads`. If the stored `checkpointVersion` is above the uint32 max, anchor reverts `BadVersion` and does not truncate.

`size` is still a uint64 on the wire. The contract refuses a size above 2^53 − 1, and it refuses a step larger than `MAX_GROWTH`. Skipped hours do not raise that step. One anchor that set the size to 2^64 − 1 would make every later anchor revert, and rotating the checkpoint key would not undo the head.

Genesis (stored size 0) accepts an empty proof once. The stored root starts as the empty-tree root. A later anchor has stored size > 0, so genesis cannot run again.

## Key changes

A third party cannot change a key. The checkpoint key cannot either. There is no direct function for either change. One pending slot holds `{kind, addr, version, eta}`. Kind 1 is a checkpoint rotation. Kind 2 is a controller change. Kind 0 means the slot is empty. A propose while the slot is filled reverts `ActionPending`. Cancel first.

`proposeRotation(address newAddr, uint64 version)` — only the controller.

| Order | Check | Error |
|---|---|---|
| 1 | `msg.sender == controller` | `NotController()` |
| 2 | pending `kind == 0` | `ActionPending()` |
| 3 | `newAddr != address(0)` | `ZeroCheckpoint()` |
| 4 | `newAddr != checkpoint` | `SameCheckpoint()` |
| 5 | `newAddr != controller` | `RotationToController()` |
| 6 | `version > checkpointVersion` | `BadVersion()` |
| 7 | `version <= uint32 max` | `BadVersion()` |

Stores kind 1 and `eta = block.timestamp + ROTATION_DELAY`. Emits `ActionProposed`.

`BadVersion` is the one error for a version that is not a strict increase and for a version that does not fit in uint32. There is no second overflow error. The proposal uses `BadVersion` for both, which is the same error `anchor` uses if a stored version is already above uint32 max. A value that does not fit is rejected before it is stored, so the head's `uint32 checkpointVersion` is never a truncation.

`proposeControllerChange(address newController)` — only the controller.

| Order | Check | Error |
|---|---|---|
| 1 | `msg.sender == controller` | `NotController()` |
| 2 | pending `kind == 0` | `ActionPending()` |
| 3 | `newController != address(0)` | `ZeroCheckpoint()` |
| 4 | `newController != controller` | `SameCheckpoint()` |
| 5 | `newController != checkpoint` | `ControllerIsCheckpoint()` |

Stores kind 2, version 0, and the same `eta`. Emits `ActionProposed`.

`executePending()` — only the current controller, and only when the slot is filled and `block.timestamp >= eta`. The slot is cleared before the key changes. Kind 1 stores the new checkpoint and its version and emits `CheckpointKeyRotated`. Kind 2 stores the new controller and emits `ControllerChanged`. A controller change does not change the checkpoint or `checkpointVersion`. A rotation does not change the controller. After a controller change the old controller cannot propose, execute, or cancel. The new controller's first proposal waits another full `ROTATION_DELAY`.

`cancelPending()` — only the current controller. Clears a filled slot at any time before execution and emits `ActionCancelled`. A later `executePending` reverts `NoPendingAction`. The next propose starts a new 24 hour delay.

While a rotation is waiting, the old checkpoint can still anchor. That anchor emits `Anchored` and `AnchoredDuringRotation`. `rotation()` is the public view of that wait: pending, the current key, the pending key, both versions, and eta. A controller change does not set `rotation().pending`. After execution only the new checkpoint can anchor. `checkpointVersion` changes when the rotation executes. Execution also stores `keyRetired(oldVersion) = (true, latestEpoch)`. An anchor that names the old version at a later epoch is not trusted. An anchor at that epoch was written before the rotation and stays trusted. `executePending` emits `CheckpointKeyRetired` and then `CheckpointKeyRotated`. It still does not write `heads`.

## Freeze

`freeze()` — the controller, with no delay. The checkpoint signer cannot call it. A stranger cannot. Authorization is `_mayFreeze`. That function refuses the checkpoint key. An attestor role, if one is added later, belongs in `_mayFreeze` and must not be the checkpoint key. There is no attestor in this deployment, and `_mayFreeze` does not unfreeze.

`freeze` sets `frozen`, stores `frozenEpoch = latestEpoch`, and emits `Frozen(epoch, size, hourStart, timestamp)`. A second freeze reverts `AlreadyFrozen`. Freeze does not use the pending slot, so it lands while a rotation is waiting. `anchor` then reverts `AnchorFrozen`.

`proposeUnfreeze()` — kind 3, controller only, and only while frozen. The pending slot must be empty (`ActionPending` otherwise). `eta` is `block.timestamp + ROTATION_DELAY`. There is no `unfreeze()`. `executePending` of kind 3 clears `frozen` and emits `Unfrozen(epoch, timestamp)`. Before eta, `executePending` reverts `TooEarly` and `anchor` still reverts.

## Events

Byte layout is pinned in `vectors/anchored-topic0.json`.

`Anchored(uint64 indexed epoch, uint64 indexed hourStart, uint64 size, bytes32 root, bytes32 stateRoot, uint8 kind)`

- topic0: `0xbc37f50aefd1f20e30781db115c88ea4bb3263e504eb6e61653fb9e4f1b7b75e`
- topic1: epoch, uint64 left-padded to 32 bytes
- topic2: hourStart, uint64 left-padded to 32 bytes
- data: `abi.encode(size, root, stateRoot, kind)` — four 32-byte words
- v0 `kind` is 0

`CheckpointKeyRotated(uint64 version, address oldAddr, address newAddr)`

- topic0: `0x95d3ad0e28a557ff091289f350472166359808c1308277737cd6cc7cacc4e8b3`
- no indexed fields
- data: `abi.encode(version, oldAddr, newAddr)`

`ActionProposed(uint8 kind, address addr, uint64 version, uint64 eta)`

- topic0: `0x7d2919dd4e57938bcd8df21204dee96d6b3d99bb3cee819d491b88183aeba4f3`
- no indexed fields
- data: `abi.encode(kind, addr, version, eta)`
- `eta` is the propose timestamp plus 86400

`ActionCancelled(uint8 kind)`

- topic0: `0x946129e76d2186c5b295b0fee9e243fa92ba1052ff225b1a53c9303061bf8ee2`
- no indexed fields
- data: `abi.encode(kind)`

`ControllerChanged(address oldController, address newController)`

- topic0: `0x6aef1fb5b23d0e109fc7f2b0601019e1edbacd177e31a441ec8548e8dd14f0f7`
- no indexed fields
- data: `abi.encode(oldController, newController)`

`CheckpointKeyRetired(uint64 version, address key, uint64 cutoffEpoch)`

- no indexed fields
- data: `abi.encode(version, key, cutoffEpoch)`
- `version` is the version that stopped. `cutoffEpoch` is `latestEpoch` at execution.

`AnchoredDuringRotation(uint64 indexed epoch, address currentKey, uint64 currentVersion, address pendingKey, uint64 pendingVersion, uint64 eta)`

- topic1: epoch
- data: `abi.encode(currentKey, currentVersion, pendingKey, pendingVersion, eta)`

`Frozen(uint64 epoch, uint64 size, uint64 hourStart, uint64 timestamp)`

- no indexed fields
- data: `abi.encode(epoch, size, hourStart, timestamp)`

`Unfrozen(uint64 epoch, uint64 timestamp)`

- no indexed fields
- data: `abi.encode(epoch, timestamp)`

## Head

```
Head { uint40 hourStart; uint64 size; uint32 checkpointVersion; uint64 anchorBlock; uint40 anchorTime; bytes32 root; bytes32 stateRoot }
```

`heads[e]` is write-once. An unwritten epoch reads as the zero head (`anchorBlock == 0`).

`MAX_ANCHOR_LAG` is the uint64 constant 5400. An anchor whose `anchorTime` is after `hourStart + 3600 + MAX_ANCHOR_LAG` is late. The contract still stores it. The verifier prints that lateness.

## Views

- `checkpoint() → address`
- `controller() → address`
- `checkpointVersion() → uint64`
- `latestEpoch() → uint64`
- `ROTATION_DELAY() → uint256`
- `domain() → bytes32`
- `MAX_ANCHOR_LAG() → uint64` (constant 5400)
- `latest() → (uint64 epoch, uint64 hourStart, uint64 size, bytes32 root, bytes32 stateRoot)` reads `heads[latestEpoch]`
- `headAt(uint64 e) → Head` (zero head when unwritten; never reverts)
- `headsFor(uint64 e) → (Head current, Head prior, uint64 latestEpoch)` prior is the zero head when `e == 0`
- `heads(uint64 e) → Head` the mapping getter
- `pendingAction() → (uint8 kind, address addr, uint64 version, uint64 eta)`
- `MAX_GROWTH() → uint64` (immutable, constructor argument)
- `DEFAULT_MAX_GROWTH() → uint64` (constant 1000000)
- `MAX_TREE_SIZE() → uint64` (constant 2^53 − 1)
- `frozen() → bool`
- `frozenEpoch() → uint64`
- `rotation() → (bool pending, address current, address next, uint64 currentVersion, uint64 nextVersion, uint64 eta)`
- `keyRetired(uint64 version) → (bool retired, uint64 cutoffEpoch)`

## Errors

`NotCheckpoint()`, `BadDomain()`, `BadEpoch()`, `BadHour()`, `HourNotIncreasing()`, `HourNotFinished()`, `SizeNotIncreasing()`, `BadConsistency()`, `ZeroCheckpoint()`, `SameCheckpoint()`, `BadVersion()`, `NotController()`, `ActionPending()`, `NoPendingAction()`, `TooEarly()`, `RotationToController()`, `ControllerIsCheckpoint()`, `SizeAboveCap()`, `GrowthCap()`, `AnchorFrozen()`, `AlreadyFrozen()`, `NotFrozen()`, `ZeroGrowth()`.

## Consistency

RFC 9162 §2.1.4.2, plus the v13 genesis rule: old size 0 takes an empty proof and the empty-tree old root. `m == n` takes an empty proof and equal roots. Node hash is `SHA-256(0x01 ‖ left ‖ right)`. The uint64 arithmetic is exact across the whole uint64 range. `max_tree_size` in `packages/cs2-core/vectors/rfc9162.json` is not read by this contract.
