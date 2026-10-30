# ChitAnchor ABI (Sepolia v0)

Frozen for P0-7. The Anchored event is DS-139. v0 emits `kind = 0` only. This file and `vectors/anchored-topic0.json` are the ABI spec. The owner deploys from `deploy/chit-simple/sepolia-pack/`. Nothing here is a proxy.

Solidity `0.8.24`, via IR, optimizer 200 runs. No `delegatecall`, `selfdestruct`, owner, or payable path.

## Domain

`domain = SHA-256("chit402-checkpoint-v1" ‖ chainId as uint64 big-endian ‖ address(this))`

Computed once in the constructor and stored as an immutable. The anchor argument must equal it.

Illustrative check (not a deployment): contract `0x3333333333333333333333333333333333333333` on chain id 8453 hashes to `0x1ec6130d39d03ed3b8bce8139d615ffe17377a1cf2cab8f4b7bf98f45dda27b0`.

## Constructor

`constructor(address checkpoint)`

Reverts if `checkpoint` is the zero address. Stores that address at version 1 and emits `CheckpointKeyRotated(1, address(0), checkpoint)`. Initial head: epoch 0, hourStart 0, size 0, root = SHA-256("") (`0xe3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855`), stateRoot 0.

## anchor

```
anchor(bytes32 domain, uint64 epoch, uint64 hourStart, uint64 size, bytes32 root, bytes32 stateRoot, bytes32[] consistencyProof)
```

Checks, in order:

| Order | Check | Error |
|---|---|---|
| 1 | `msg.sender == checkpoint` | `NotCheckpoint()` |
| 2 | `domain` equals the immutable domain | `BadDomain()` |
| 3 | `epoch == stored epoch + 1` | `BadEpoch()` |
| 4 | `hourStart % 3600 == 0` | `BadHour()` |
| 5 | `hourStart > stored hourStart` | `HourNotIncreasing()` |
| 6 | `hourStart + 3600 <= block.timestamp` (finished hour, DS-140) | `HourNotFinished()` |
| 7 | `size > stored size` | `SizeNotIncreasing()` |
| 8 | RFC 9162 consistency of `(stored size, stored root)` to `(size, root)`, genesis when stored size is 0 | `BadConsistency()` |

Then it stores the new head and emits Anchored with `kind = 0`.

`size` is the uint64 wire field. The off-chain 2^53−1 cap is not a contract rule.

Genesis (stored size 0) accepts an empty proof once. The stored root starts as the empty-tree root. A later anchor has stored size > 0, so genesis cannot run again.

## rotateCheckpointKey

```
rotateCheckpointKey(address newAddr, uint64 version)
```

v0 authorization is the current checkpoint address (the 2-of-3 controller signatures are the later full surface). Checks:

| Check | Error |
|---|---|
| `msg.sender == checkpoint` | `NotCheckpoint()` |
| `newAddr != address(0)` | `ZeroCheckpoint()` |
| `newAddr != checkpoint` | `SameCheckpoint()` |
| `version > stored version` | `BadVersion()` |

Emits `CheckpointKeyRotated(version, oldAddr, newAddr)`. A later anchor from the old address reverts `NotCheckpoint()`.

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

## Views

- `checkpoint() → address`
- `checkpointVersion() → uint64`
- `domain() → bytes32`
- `latest() → (uint64 epoch, uint64 hourStart, uint64 size, bytes32 root, bytes32 stateRoot)`

## Errors

`NotCheckpoint()`, `BadDomain()`, `BadEpoch()`, `BadHour()`, `HourNotIncreasing()`, `HourNotFinished()`, `SizeNotIncreasing()`, `BadConsistency()`, `ZeroCheckpoint()`, `SameCheckpoint()`, `BadVersion()`.

## Consistency

RFC 9162 §2.1.4.2, plus the v13 genesis rule: old size 0 takes an empty proof and the empty-tree old root. `m == n` takes an empty proof and equal roots. Node hash is `SHA-256(0x01 ‖ left ‖ right)`. The uint64 arithmetic is exact across the whole uint64 range. `max_tree_size` in `packages/cs2-core/vectors/rfc9162.json` is not read by this contract.
