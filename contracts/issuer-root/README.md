# ChitIssuerRoot ABI

Canonical artifact: [`abi/ChitIssuerRoot.json`](abi/ChitIssuerRoot.json).

Load the contract with `artifact.abi`. The rest of the file is the `keys()` layout and the `rootHash` preimage, which are not recoverable from the ABI alone. Solidity source is `contracts/registry/ChitIssuerRoot.sol`. Compiler: solc 0.8.24, optimizer 200 runs, via-IR off.

## `keys(bytes32)`

Returns six words, in this order:

| Word | Name | Type | Meaning |
|---|---|---|---|
| 0 | `status` | `uint8` | 0 none, 1 standby, 2 active, 3 retired, 4 revoked |
| 1 | `wasActive` | `bool` | Set on genesis and on `PROMOTE`. Stays set after revoke. |
| 2 | `notBefore` | `uint64` | Earliest time the key was allowed to exist. |
| 3 | `notAfter` | `uint64` | 0 means the retirement window is open. |
| 4 | `revokedAt` | `uint64` | 0 means not revoked. A receipt at `t` fails when `t >= revokedAt`. |
| 5 | `activatedAt` | `uint64` | 0 until `PROMOTE`. Genesis sets this to `notBefore`. |

Validity starts at `max(notBefore, activatedAt)`. A standby promoted late is not valid back to `notBefore`. A revoked key still passes for `activatedAt <= t < revokedAt` when `wasActive` is true, and `notAfter` is 0 or `t <= notAfter`. A standby revoked before promotion never passes.

The record is two storage slots. The first holds status through `revokedAt` (26 bytes). `activatedAt` is the low 64 bits of the next slot. `ADD_STANDBY` writes only the first slot. The second slot is written at genesis and at `PROMOTE` (one extra cold `SSTORE`).

## Events a verifier replays

`GenesisSeeded(controller, kid, notBefore, activatedAt, blockNumber, rootHash)` and `KeyActivated(kid, activatedAt, 0)` are emitted by the constructor. `rootSeq` stays 0. `rootHash` is the genesis preimage below, not `bytes32(0)`.

Each later `commit` emits the key and freeze events, then:

`RootCommitted(rootSeq, rootHash, historyVersion, historySnapshot, blockNumber)`

`KeyActivated` for a promote is `KeyActivated(kid, activatedAt, rootSeq)` with `activatedAt = block.timestamp` of that transaction.

`Frozen` carries `frozenBlock`, which equals `RootCommitted.blockNumber` for that commit.

`Superseded(address)` does not change `rootSeq` or `rootHash`. The address is not indexed; that shape is fixed.

## `rootHash`

```text
GENESIS_DOMAIN = keccak256("chit.issuerRoot.genesis.v1")
COMMIT_DOMAIN  = keccak256("chit.issuerRoot.commit.v1")

genesis = keccak256(abi.encode(
    GENESIS_DOMAIN, chainId, registry, controller,
    genesisKid, genesisNotBefore, activatedAt, uint64(block.number)))

commit = keccak256(abi.encode(
    COMMIT_DOMAIN, prevRootHash, rootSeq, chainId, registry,
    uint64(block.number), ops, freezeArgs, histVersion, histSnapshot))
```

`ops` is `(uint8 kind, bytes32 kid, uint64 timestamp, uint8 reasonCode)[]`.
`freezeArgs` is `(bytes32 universeId, bytes32 universeHash, uint64 enumeratedCount)[]`.

`uint64(block.number)` is `frozenBlock` for every freeze in the commit. Replaying the same calldata in another block changes `rootHash`. The block hash of that block is not stored: `blockhash(block.number)` is zero inside the transaction. Verifiers read it from the sealed block of the `Frozen` or `RootCommitted` log.

`scripts/issuer-root.mjs` (`hashGenesis`, `hashCommitment`) is the off-chain reference.
