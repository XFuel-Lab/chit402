# ChitIssuerRoot

Immutable issuer-key and freeze registry. The controller is a Safe 2-of-3 address stored once in the constructor. There is no proxy, upgrade, `selfdestruct`, `receive`, `fallback`, or token interface. Migration is a new registry plus one `Superseded(next)` from this one. `supersede` does not change `rootSeq` or `rootHash`.

The contract is chain-agnostic: `rootHash` binds `block.chainid` and `address(this)`. `script/DeployChitIssuerRoot.s.sol` refuses to broadcast unless `block.chainid == 84532` (Base Sepolia). There is no mainnet RPC in `foundry.toml`. A later mainnet deploy is a separate act and is not this script.

`SEPOLIA_THROWAWAY_PK` and `SEPOLIA_SAFE_OWNER_PK_*` are throwaway Base Sepolia keys. They have no mainnet use, they are not committed, and they are not the gateway `ISSUER_PRIVATE_KEY`.

## Op encoding

`commit(Op[] ops, FreezeArg[] freezeArgs, uint64 histVersion, bytes32 histSnapshot)`

```solidity
struct Op {
    uint8 kind;       // 1 ADD_STANDBY, 2 PROMOTE, 3 RETIRE, 4 REVOKE
    bytes32 kid;      // RFC 7638 thumbprint, raw 32 bytes
    uint64 timestamp; // notBefore, notAfter, or revokedAt; 0 for PROMOTE
    uint8 reasonCode; // 0 except on REVOKE
}
struct FreezeArg {
    bytes32 universeId;
    bytes32 universeHash;
    uint64 enumeratedCount;
}
```

| kind | name | timestamp | reasonCode |
|---|---|---|---|
| 1 | ADD_STANDBY | notBefore, at least `block.timestamp + 24 hours` | 0 |
| 2 | PROMOTE | 0 | 0 |
| 3 | RETIRE | notAfter, at or after the validity start (past or future) | 0 |
| 4 | REVOKE | revokedAt, at or after the validity start, never 0 | 2, 3, or 255. Reason 1 is guardian `recover` only |

reasonCode: **1 compromise (guardian `recover` only), 2 superseded, 3 lost, 255 other**. Any other code reverts. The validity start is `max(notBefore, activatedAt)`. Guardian names and preimages: [docs/product/issuer-root.md](../../docs/product/issuer-root.md).

```text
GENESIS_DOMAIN = keccak256("chit.issuerRoot.genesis.v1")
COMMIT_DOMAIN  = keccak256("chit.issuerRoot.commit.v1")

genesis = keccak256(abi.encode(
    GENESIS_DOMAIN, chainId, registry, controller,
    genesisKid, notBefore, activatedAt, uint64(block.number)))

commit = keccak256(abi.encode(
    COMMIT_DOMAIN, prevRootHash, rootSeq, chainId, registry,
    uint64(block.number), ops, freezeArgs, histVersion, histSnapshot))
```

The constructor stores the genesis hash at `rootSeq` 0 and emits `KeyActivated` plus `GenesisSeeded`. The first commit chains from that hash. `uint64(block.number)` is `frozenBlock` for every freeze in the commit, so a reorg into another block changes `rootHash`. An empty commit reverts. Canonical ABI: `contracts/issuer-root/abi/ChitIssuerRoot.json`. `scripts/issuer-root.mjs` recomputes both hashes.

## Key validity

`KeyState` is two slots. The first holds `status`, `wasActive`, `notBefore`, `notAfter`, and `revokedAt` (26 bytes). `activatedAt` is a `uint64` and does not fit, so it occupies the low 64 bits of the next slot. `ADD_STANDBY` writes only the first slot. Genesis and `PROMOTE` write the second (one extra cold `SSTORE`, about 20,000 gas).

`activatedAt` is `notBefore` for the genesis key and `block.timestamp` at `PROMOTE` otherwise. `keyValidAt` starts at `max(notBefore, activatedAt)`, so a late promotion is not valid back to `notBefore`. A revoked key that was ever active still passes for `t < revokedAt` inside that window. Revoke of a promoted key cannot backdate earlier than `activatedAt`. A standby revoked before promotion never passes.

`revokedAt` may be `<= block.timestamp`. A future `revokedAt` is accepted only for a standby that was never promoted.

## Legacy freeze Merkle

The contract stores `universeHash`. It does not build the tree. The hash is the legacy receipt set, not the daily RFC 6962 receipt tree in `services/gateway/src/receipt-merkle.js` (that tree promotes a trailing odd node and is append-only).

Rules, the same as `services/gateway/src/legacy-receipt-merkle.js` and the verifier:

1. Sort `payload_hash` bytes ascending. Equal hashes keep input order. Duplicates stay, so `enumeratedCount` is the receipt count.
2. Leaf = `SHA-256(0x00 || payload_hash bytes)`. The payload hash is the raw 32 bytes, not the hex text.
3. While more than one node remains: if the count is odd, duplicate the last node, then parent = `SHA-256(0x01 || left || right)`.
4. One leaf is the root. The empty root is `SHA-256(0x00)`, which is `0x6e340b9cffb37a989ca544e6bb780a2c78901d3fb33738768511a30617afa01d`.

The `0x00` / `0x01` domain separation stops a node from being substituted for a leaf.

The legacy universe id is `sha256` of the JCS object `{schema:"chit402.universe.v1", book_id:"chit402:global", window_id:"legacy_receipts_pre_v11", predicate_hash}`. The predicate hash is itself `sha256` of the JCS predicate document. The id is:

```text
b623c1816e895dd967c4e51f0e066dafda546195a909e9b51283be4b5109caf4
```

`test/fixtures/legacy-merkle-vectors.json` is a byte copy of `services/gateway/test/fixtures/legacy-merkle-vectors.json` on `cursor/gateway-v11-issuer-root-5306`. `node --test scripts/issuer-root.test.mjs` checks every root, proof, and that universe id.

## Deploy

```bash
forge script script/DeployChitIssuerRoot.s.sol \
  --rpc-url https://sepolia.base.org \
  --broadcast \
  --slow
```

Required env: `SEPOLIA_THROWAWAY_PK`, `SEPOLIA_SAFE_OWNER_PK_1`, `SEPOLIA_SAFE_OWNER_PK_2`, `CHIT_ISSUER_ROOT_CONTROLLER`, `CHIT_GENESIS_KID`, `CHIT_GENESIS_NOT_BEFORE`, `CHIT_STANDBY_KID`, `CHIT_HIST_SNAPSHOT`, `CHIT_LEGACY_UNIVERSE_ID`, `CHIT_LEGACY_UNIVERSE_HASH`, `CHIT_LEGACY_ENUMERATED_COUNT`. Optional `CHIT_HIST_VERSION` (default 1) and `CHIT_STANDBY_CUSHION` (seconds past the 24h minimum, default 3600). Guardians, addresses and witness signatures only: `CHIT_GUARDIAN_COUNT`, `CHIT_GUARDIAN_THRESHOLD`, `CHIT_WITNESS_SALT`, `CHIT_GUARDIAN_1` .. `CHIT_GUARDIAN_N`, `CHIT_GUARDIAN_POP_1` .. `CHIT_GUARDIAN_POP_N`. The script reads Safe `getOwners()` and refuses a guardian who is also a controller signer. Field names: [docs/product/issuer-root.md](../../docs/product/issuer-root.md).

The sample standby `notBefore` is the latest block timestamp plus 24 hours plus that cushion. A preflight `eth_call` of the genesis commit runs at that latest timestamp and is rolled back before `startBroadcast`. If it reverts, the script stops and forge does not send the transaction. The Sepolia dry run omitted the cushion (`notBefore = simulated timestamp + 24h`); the mined block was about a minute later and the commit reverted `ActivationTooSoon`.

### `_issuer.chit402.com` TXT for the Sepolia registry

Copy this as the single TXT record at `_issuer.chit402.com` for the dry-run registry. It is the genesis commit (seq 1). The verifier accepts it while seq 1 is at or behind the chain head and this root matches that commit. The active kid at seq 1 is the genesis key.

```text
v=chit-issuer1; chain=eip155:84532; reg=0xeC17A9070cE6aD1356c5c142B74b0b393dBe7973; seq=1; root=0x01e9aa809ddfe08f50f9bd2a453468ce20a9c86f586cfee62fed0e0e7baaee0d; kid=bX9D-3TQbKfQi06XoHGaLh6YnO6I_uQsLAxoGbzBiH0
```

The public genesis kid `IvFpmC-vPhkY_v0vidsrWVT9uzlE5XWKZgAEOeJTq1Q` is `0x22f169982faf3e1918fefd2f89db2b5954fdbb3944e5758a66000439e253ab54`. Its `not_before` `2026-09-04T08:52:05Z` is unix `1788511925`. Pass the legacy universe id above. The sample commit registers the standby, sets history, and freezes that universe. It does not mint or re-sign receipts.

## Tests

```bash
forge test
forge test --gas-report
forge snapshot
node --test scripts/issuer-root.test.mjs
```

Functional Safe tests deploy Safe v1.4.1 from `lib/safe-smart-account` (singleton + proxy factory, threshold 2, three owners derived in the test). Fork gas uses the canonical SafeL2 `0x29fcB43b46531BcA003ddC8FCB67FFE91900C762` and factory `0x4e1DCf7AD4e460CfD30791CCC4F9c8a4f820ec67` already on Base Sepolia. No broadcast.

## Measured gas

Fork-measured on an Anvil fork of `https://sepolia.base.org` (chain id 84532). No transaction was broadcast to the public network. Receipt `gasUsed` from the fork:

| Operation | Spec §7 estimate | Fork-measured `gasUsed` |
|---|---|---|
| Deploy `ChitIssuerRoot` | ~1.0–1.5M | 1,617,123 |
| Commit with one key op through Safe v1.4.1 SafeL2 | ~100–150k | 154,262 |
| Commit with one key op plus one freeze through that Safe | ~150–220k | 210,013 |

The Safe is the canonical SafeL2 `0x29fcB43b46531BcA003ddC8FCB67FFE91900C762` and factory `0x4e1DCf7AD4e460CfD30791CCC4F9c8a4f820ec67`. These are receipt `gasUsed` values after `activatedAt` and the genesis `rootHash` landed. Deploy is higher than the earlier 1,410,063 because the constructor writes a second key slot and a nonzero genesis hash, and the creation code is larger. The one-op commit is lower than the earlier 170,961 because `rootHash` is already nonzero. `forge test --match-test test_forkMeasuredGas` checks the same path on a local fork and does not broadcast.

Guardian calls, `gasleft` delta on `anvil --chain-id 84532` (not a broadcast). `recover` 124,246. `rotateGuardians` 195,053. Runtime code size of the registry in that test was 13,236 bytes.

Human broadcast, only with a throwaway Sepolia key, after the env vars in the deploy section are set:

```bash
forge script script/DeployChitIssuerRoot.s.sol \
  --rpc-url https://sepolia.base.org \
  --broadcast \
  --slow
```
