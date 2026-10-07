# Issuer root

Names in this file are the ones the gateway (`#483`) and the verifier (`#484`) should copy. The contract is `ChitIssuerRoot`. The ABI is `contracts/issuer-root/abi/ChitIssuerRoot.json`. Hash preimages live in `contracts/registry/ChitIssuerDigests.sol`.

The registry is immutable. The controller is a Safe. Guardians are a different set of keys. They do not sign receipts.

## Pinned history

Every `rootHash` binds the issuer-history pin so a verifier can check a commit-pinned copy of `issuer-history` against the registry.

| Field | Meaning |
|---|---|
| `historyVersion` | `uint64`. Monotonic. The constructor stores 0. |
| `historySnapshot` | `bytes32`. SHA-256 of the pinned issuer-history document. The constructor stores `bytes32(0)`. Equal version requires an equal snapshot. |

A controller `commit` puts both fields in `CommitStatic` (below). Guardian `recover` and `rotateGuardians` copy the stored pin into the new `rootHash` and do not change it.

## Guardian set

The guardian set is seated in the constructor, in the same genesis preimage as `key_1` (the genesis kid). It is an M-of-N quorum of addresses. It is not a second Safe.

Why the contract checks the signatures itself: a second Safe would make rotation an owner change on that Safe, with no ordered event in this registry and no `rootHash` update. The offline model is the same one Safe uses. Guardians sign a digest offline. Anyone can relay the signatures. The contract checks M distinct guardians, sorted ascending, and refuses a duplicate or an outsider. The guardian keys are never the receipt key.

| Field | Meaning |
|---|---|
| `guardianSeq` | `uint64`. The constructor seats sequence 1. `rotateGuardians` adds 1. |
| `guardianThreshold` | `uint64`. M. `1 <= M <=` guardian count `<= 8`. |
| `guardians` | `address[]`. Strictly ascending. No zero address. |
| `guardianSetHash` | `keccak256(abi.encode(guardians, guardianThreshold))`. |
| `isGuardian` | `mapping(address => bool)`. |
| `witnessSalt` | `bytes32`. Chosen before deploy and signed in the witness proof of possession. Not a private key. |

`guardianSet()` returns `(guardianSeq, guardianThreshold, guardians, guardianSetHash)`.

### Witness PoP

Each guardian proves possession of the key that sits at that address.

Constructor digest, signed before the registry exists (`witnessPopDigest`):

```text
keccak256(abi.encode(
  WITNESS_POP_DOMAIN, // keccak256("chit.issuerRoot.witnessPop.v1")
  PopStatic,          // chainId, witnessSalt, controller, genesisKid, genesisNotBefore, activatedAt, guardianThreshold
  guardians))
```

Rotation digest, signed after the registry exists (`seatedPopDigest`):

```text
keccak256(abi.encode(
  WITNESS_POP_DOMAIN,
  chainId,
  registry,
  nextGuardianSeq,
  guardianThreshold,
  guardians))
```

One signature per guardian, same order as `guardians`. Raw ECDSA, `r || s || v` (v is 27 or 28), the same shape as a Safe owner signature. The deploy script takes the addresses and these signatures. It never takes a guardian private key.

### Guardian-set rotation

`rotateGuardians(newGuardians, newThreshold, quorumSignatures, witnessPops)`.

The current quorum signs `rotateAuthDigest`. The new guardians each include a seated witness PoP. The event is ordered by `guardianSeq` and the new set is inside `rootHash`.

| Event | Fields |
|---|---|
| `GuardianSetCommitted` | `guardianSeq` (indexed), `guardianThreshold`, `guardianSetHash`, `guardians`, `blockNumber` |

Auth digest:

```text
keccak256(abi.encode(
  GUARDIAN_AUTH_DOMAIN, // keccak256("chit.issuerRoot.guardianAuth.v1")
  RotateAuth,           // chainId, registry, guardianSeq, nextGuardianSeq, newThreshold
  newGuardians))
```

Root preimage (`guardianRootHash`), and `rootSeq` increments:

```text
keccak256(abi.encode(
  GUARDIAN_ROOT_DOMAIN, // keccak256("chit.issuerRoot.guardianRoot.v1")
  GuardianStatic,       // prevRootHash, rootSeq, chainId, registry, blockNumber, historyVersion, historySnapshot, guardianSeq, guardianThreshold
  guardians))
```

`RootCommitted` is emitted in the same transaction.

A controller signer cannot also be a guardian. The constructor and `rotateGuardians` staticcall `controller.isOwner(guardian)` and revert `GuardianIsControllerSigner` when it returns true. The controller must be a Safe (or another contract with that function). The deploy script also reads `getOwners()` and refuses the overlap before broadcast.

## Recovery

`recover(kid, invalidatePrior, signatures)` is the only compromise retirement. `reasonCode` on that act is always 1 (`compromise`). The controller's `commit` reverts `CompromiseRequiresGuardians` if an op uses reason 1. Guardians cannot call `commit`, so they cannot add, promote, or rotate a signing key.

The caller of `recover` is a relayer. Authority is the quorum signatures, not `msg.sender`.

Auth digest (`recoverAuthDigest`). Chain id and registry are inside it, so the same signatures fail on another chain or another registry.

```text
keccak256(abi.encode(
  RECOVER_AUTH_DOMAIN, // keccak256("chit.issuerRoot.recoverAuth.v1")
  chainId,
  registry,
  guardianSeq,
  kid,
  invalidatePrior))
```

| Event | Fields |
|---|---|
| `KeyRecovered` | `kid` (indexed), `retiredAt`, `retirementBlock`, `invalidatePrior`, `reasonCode`, `guardianSeq` (indexed), `rootSeq` (indexed) |

`retiredAt` is the retirement block's timestamp. `retirementBlock` is `block.number`. The key becomes `status` 4 (`revoked`). `wasActive` is left as it was.

Receipts are judged with `keyValidAt(kid, iat)`:

- `invalidatePrior == false`. `revokedAt` is `retiredAt` (or the validity start if that is later). An `iat` strictly before `retiredAt` stays valid when the key was active in that window. An `iat` at or after `retiredAt` is invalid. That is "after the retirement block": the block's timestamp is the cut, and a receipt timestamped on that block or later does not pass.
- `invalidatePrior == true`. `revokedAt` is the validity start (`max(notBefore, activatedAt)`). The open window is empty, so earlier receipts do not stay valid. This is the explicit compromise cut. It is not the default.

A standby that was never promoted is revoked at `notBefore`, so it cannot be promoted later.

Root preimage (`recoverRootHash`), and `rootSeq` increments. The stored history pin is copied in and not changed.

```text
keccak256(abi.encode(
  RECOVER_ROOT_DOMAIN, // keccak256("chit.issuerRoot.recoverRoot.v1")
  RecoverStatic))      // prevRootHash, rootSeq, chainId, registry, blockNumber, historyVersion, historySnapshot, guardianSeq, kid, retiredAt, retirementBlock, invalidatePrior
```

## Genesis and commit preimages

Genesis (`rootSeq` stays 0), including the guardian set and the zero history pin:

```text
keccak256(abi.encode(
  GENESIS_DOMAIN, // keccak256("chit.issuerRoot.genesis.v1")
  GenesisStatic,  // chainId, registry, controller, genesisKid, genesisNotBefore, activatedAt, blockNumber, witnessSalt, guardianSeq, guardianThreshold, historyVersion, historySnapshot
  guardians))
```

`activatedAt` for the genesis kid is `genesisNotBefore`. `guardianSeq` is 1. `historyVersion` and `historySnapshot` are zero.

Controller `commit` (`COMMIT_DOMAIN = keccak256("chit.issuerRoot.commit.v1")`):

```text
opsHash    = keccak256(abi.encode(ops))
freezeHash = keccak256(abi.encode(freezeArgs))
keccak256(abi.encode(
  COMMIT_DOMAIN,
  CommitStatic)) // prevRootHash, rootSeq, chainId, registry, blockNumber, historyVersion, historySnapshot, guardianSeq, guardianSetHash, opsHash, freezeHash
```

`blockNumber` is still `frozenBlock` for every freeze in that commit.

## Rotation versus recovery

| Act | Who | What it may do |
|---|---|---|
| `commit` / `supersede` | Controller Safe, with the 24h standby delay on `ADD_STANDBY` | Add, promote, schedule `RETIRE` (`notAfter`), revoke for superseded / lost / other. Not compromise. |
| `recover` | Guardian quorum | Compromise-retire one signing key. Not add or rotate a signing key. |
| `rotateGuardians` | Current guardian quorum | Replace the guardian set only. |
