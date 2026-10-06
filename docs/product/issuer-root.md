# Issuer root on receipts (v11)

Off unless `ISSUER_ROOT_ENABLED=true`. With the flag unset, payment receipts stay payload v10, refusals stay `chit402.refusal.v1` at payload version 2, and `GET /.well-known/issuer-history.json` is unchanged. `GET /freeze/:universeId` and `GET /receipt/:id/legacy-proof` return 404.

The issuer private key is still the base64 PEM in `ISSUER_PRIVATE_KEY`. That is the same variable AWS Secrets Manager injects into the process environment. There is no second key loader. The Safe that writes `ChitIssuerRoot` is not this key.

Restart the process after changing these variables. The key check and the finalized-commit check run at startup, not on a later request.

## Config

| Variable | Meaning |
|---|---|
| `ISSUER_ROOT_ENABLED` | `true` turns on v11. Anything else is off. |
| `ISSUER_ROOT_CHAIN_ID` | CAIP-2. Default `eip155:84532` (Base Sepolia). `eip155:8453` only when this variable is set to that value. |
| `ISSUER_ROOT_REGISTRY` | Registry address. The gateway checksums it (EIP-55) before signing. |
| `ISSUER_ROOT_SEQ` | `rootSeq` of a commit that has already finalized. Integer ≥ 1. |
| `ISSUER_ROOT_HASH` | `rootHash` from that commit's `RootCommitted` log. 32 bytes. Stored lowercase with a `0x` prefix. |
| `ISSUER_ROOT_STARTUP_CHECK` | `strict` (default when the flag is on) or `skip`. |
| `ISSUER_ROOT_ALLOW_SKIP` | Must be `I_UNDERSTAND` or `skip` refuses to start. `skip` logs an error and does not read the chain. |
| `ISSUER_ROOT_RPC_URL` | First RPC for the strict startup check. Falls back to `BASE_RPC_URL`, then `SETTLEMENT_RPC_URL`. |
| `ISSUER_ROOT_RPC_URL_2` | Second RPC. Strict mode requires this and the first URL to be different hosts. |
| `ISSUER_ROOT_CUTOVER` | `pause` stops issuance until the v11 config is complete. `off` is the default. |
| `ISSUER_ROOT_FREEZE_FILE` | JSON file of freeze facts. Checked against `Frozen` at startup. |
| `ISSUER_ROOT_LEGACY_SET` | JSON artifact from the legacy Merkle builder. Required before v11 issuance. |

Signing never reads the chain. `strict` asks two RPCs for `eth_chainId`, `eth_getBlockByNumber("finalized")`, and `eth_getLogs` at that same block number. The finalized block number, the block hash, and the single `RootCommitted` log must agree, and `rootHash` must equal `ISSUER_ROOT_HASH`. A miss, a mismatch, a disagreement, or an unreachable RPC refuses to start. `skip` does not call the RPC, and only when `ISSUER_ROOT_ALLOW_SKIP=I_UNDERSTAND`. That path logs an error and does not sign v11 receipts, on Base Sepolia or on mainnet. It still refuses an unset `ISSUER_PRIVATE_KEY`. Topics and log decoding come from `services/gateway/abi/ChitIssuerRoot.json`, the contract artifact, not from a hand-written event signature.

If the flag is on and `ISSUER_PRIVATE_KEY` is unset, the process refuses to start. It does not generate an ephemeral key. With the flag off, an unset key still generates an ephemeral key for local runs.

## What v11 adds

The signed object, inside the JWS and the canonical preimage:

```json
{
  "v": 1,
  "chain_id": "eip155:84532",
  "registry": "0xREGISTRY",
  "root_seq": 1,
  "root_hash": "0xROOTHASH",
  "kid": "<rfc7638-thumbprint>"
}
```

`issuer_root.kid`, the JWS `kid`, and the thumbprint of `issuer_jwk` are the same value. The canonical allowlist includes `issuer_root`. Payment payload version is 11. Refusal schema is `chit402.refusal.v2` and its payload version is 3 (payload version 2 is already the history pin on `chit402.refusal.v1`). The issuer-history JWS payload carries the same object, which seals a new history version. Older history bytes stay fetchable.

The same v11 signature (and a v2 refusal) also carries `canonicalization` and `issuer_history_snapshot`. Flag-off payloads omit both. A stored JWS is not rewritten to add them.

### `canonicalization`

Inside the JWS, not only on the envelope or in `X-Chit-Hash-Alg` / `X-Chit-Canonicalization`:

| Field | Value |
|---|---|
| `hash_alg` | `sha-256` |
| `jcs` | `chit402-jcs-v1` |
| `string_escaping` | UTF-8, no trailing newline. Object keys sorted by UTF-16 code unit. Every code unit U+0000 through U+001F is `\u00xx` lowercase hex, including U+0008, U+0009, U+000A, U+000C, and U+000D. U+0022 is `\"`. U+005C is `\\`. Other UTF-16 code units are copied, so U+1F600 is the four UTF-8 bytes `f0 9f 98 80`. Solidus is not escaped. |

`jcs` is not `RFC8785`. RFC 8785, like `JSON.stringify`, writes U+0008 as `\b`, U+0009 as `\t`, U+000A as `\n`, U+000C as `\f`, and U+000D as `\r`. This canonicalizer writes those five as `\u0008`, `\u0009`, `\u000a`, `\u000c`, and `\u000d`. U+0001 is `\u0001` in both. A non-BMP character is the raw UTF-8 scalar in both. The canonicalizer is unchanged. Whether v11 switches to true RFC 8785 is Christopher's call.

Vector `{ "s": "<TAB><LF><U+0001><U+1F600>" }` is the 30 bytes `7b2273223a225c75303030395c75303030615c7530303031f09f9880227d`. RFC 8785 for the same value is the 22 bytes `7b2273223a225c745c6e5c7530303031f09f9880227d`.

SHA-256 of the canonicalizer's UTF-8 bytes, with no trailing newline, is `payload_hash`.

### `issuer_history_snapshot`

`chit402.issuer_history_embed.v1`. A minimal copy of the pinned history so a saved receipt can check the kid window without `GET /.well-known/issuer-history.json`.

| Field | Meaning |
|---|---|
| `schema` | `chit402.issuer_history_embed.v1` |
| `version` | Same as `issuer_history.version` |
| `seq` | Same as `issuer_history.seq` |
| `head_hash` | Last entry's `entry_hash` |
| `snapshot_hash` | Same as `issuer_history.hash`. SHA-256 of the JCS of the full well-known document, not of this object |
| `entries` | One object per history entry, in chain order |

Each entry has `kid`, `jwk` (`kty`, `crv`, `x`, `y`, `kid`, `alg`, `use`), `alg`, `not_before`, `not_after`, `status`, `revoked_at`, `reason`, `custody`, `prev_hash`, `entry_hash`.

Offline check, with no well-known fetch:

1. `snapshot_hash`, `version`, and `seq` equal the `issuer_history` pin.
2. `entry_hash` is SHA-256 of the JCS of the entry without `entry_hash`.
3. `prev_hash` chains, and the last `entry_hash` equals `head_hash`.
4. The entry whose `kid` is `issuer_root.kid` supplies `not_before`, `not_after`, `status`, and `revoked_at`.

One live key is 1052 bytes of JCS for `issuer_history_snapshot`. The full well-known document is larger because of the prose and the history JWS; those stay on `/.well-known/issuer-history.json`. `?hash=` still serves that document, and `snapshot_hash` is its hash.

A receipt that already has a JWS is not re-signed. While the issuer root is on, a later covering root is an unsigned `covering_head` sidecar (`chit402.covering_head.v1`, `signed: false`). The stored `issuer_signature.jws` bytes stay put across a key rotation and a tree-head update. Flag-off v10 may still reseal `tree_head_hash` inside that same claim set. v9 and older are never restamped.

## Cutover pause

Genesis needs every pre-v11 `payload_hash` in the freeze, and v11 needs that commit's `root_seq`. A receipt signed between the snapshot and v11 would be in neither set.

The pause is config, then a restart:

1. Set `ISSUER_ROOT_CUTOVER=pause`. Leave `ISSUER_ROOT_ENABLED` unset. Restart. New payment receipts, refusals, and foreign-ingest JWS signatures throw `issuer_root_cutover_pause`. Tree-head restamps are skipped. Receipts that already have a JWS still serve.
2. Run the read-only builder (below) against the book. It does not sign.
3. The genesis Safe commit freezes that root. Wait until the commit is finalized.
4. Set `ISSUER_ROOT_ENABLED=true`, `ISSUER_ROOT_REGISTRY`, `ISSUER_ROOT_HASH`, `ISSUER_ROOT_SEQ`, `ISSUER_ROOT_LEGACY_SET` to the artifact from step 2, `ISSUER_ROOT_RPC_URL`, `ISSUER_ROOT_RPC_URL_2`, and a stable `ISSUER_PRIVATE_KEY`. Restart. The strict startup check reads both RPCs at one finalized block. Issuance resumes as v11.

The pause stays in force until that full v11 config is set. `ISSUER_ROOT_SEQ` alone does not resume, and it does not issue another v10 receipt. Turning the flag on before `ISSUER_ROOT_LEGACY_SET` names a written snapshot also pauses issuance, even when `ISSUER_ROOT_CUTOVER` is `off`. The pause also stays until a strict startup check has seen the `Frozen` log for `legacy_receipts_pre_v11` and the artifact's recomputed Merkle root and leaf count equal that log's `universeHash` and `enumeratedCount`. A file that only claims those values, or a `skip` startup, does not lift the pause. That is the gap test: every hash from before the pause is in the legacy set, nothing is signed during the pause, and every hash after resume is v11 and outside the set.

## Legacy Merkle set

`node services/gateway/scripts/build-legacy-receipt-set.mjs --ledger <usage-settled.jsonl | directory> --out <artifact.json>`

The script reads stored `payload_hash` values. It does not rebuild a canonical object, re-sign, mint, or broadcast. `--broadcast`, `--send`, and `--deploy` exit 2. A pre-v11 receipt with no stored `payload_hash` exits 1 and writes nothing.

Tree, for the verify package:

| Rule | Value |
|---|---|
| Leaf | `SHA-256(0x00 \|\| payload_hash bytes)` |
| Node | `SHA-256(0x01 \|\| left \|\| right)` |
| Order | payload_hash bytes ascending. Equal hashes keep input order. Duplicates stay, so the leaf count is the receipt count. |
| Odd level | If a level has more than one node and an odd count, the last node is duplicated and hashed with itself. A single leaf is the root. |
| Empty set | `SHA-256(0x00)`, hex `6e340b9cffb37a989ca544e6bb780a2c78901d3fb33738768511a30617afa01d` |

The contract branch `cursor/chit-issuer-root-contract` was not on origin when this was written. Vectors: `services/gateway/test/fixtures/legacy-merkle-vectors.json`.

`GET /receipt/:id/legacy-proof` serves an inclusion proof from `ISSUER_ROOT_LEGACY_SET`. 404 when the flag is off or the id is not a leaf. `chit-` and `xfuel-` ids match.

The JSON uses these names. The verifier reads `universe_id` and `enumerated_count`.

| Field | Meaning |
|---|---|
| `schema` | `chit402.legacy_proof.v1` |
| `task_id` | Receipt id as stored in the artifact |
| `payload_hash` | 64 hex characters, no `0x` prefix |
| `index` | Leaf index after the ascending sort |
| `enumerated_count` | Receipt count in the frozen set. Not `leafCount`. |
| `root` | Merkle root, `0x` plus 32 bytes |
| `universe_id` | 64 hex characters, no `0x` prefix. Not `universeId`. |
| `leaf` | Leaf hash, 64 hex characters |
| `proof` | `{ hash, position }` steps. `position` is `left` or `right`. |
| `tree` | The four rule strings: `leaf`, `node`, `sort`, `odd` |

## Universe id for `legacy_receipts_pre_v11`

`universe_id = SHA-256(JCS({schema, book_id, window_id, predicate_hash}))`.

| Field | Value |
|---|---|
| `schema` | `chit402.universe.v1` |
| `book_id` | `chit402:global` |
| `window_id` | `legacy_receipts_pre_v11` |
| predicate `schema` | `chit402.universe_predicate.v1` |
| predicate `name` | `legacy_receipts_pre_v11` |
| predicate `subject` | `book receipt` |
| predicate `include` | book row with a stored issuer signature, payload_version below 11, and no issuer_root claim in the JWS payload |
| predicate `exclude` | rows with no issuer signature; payload_version 11 or greater; any issuer_root claim |
| predicate `leaf` | `stored payload_hash bytes` |
| predicate `re_sign` | `false` |

`predicate_hash` is SHA-256 of the JCS predicate: `a45aaf907ba425c1474bc96187b73b5b5e42f6696b6e8dbc34d3acb047fd37d1`.

JCS of the universe body:

```json
{"book_id":"chit402:global","predicate_hash":"a45aaf907ba425c1474bc96187b73b5b5e42f6696b6e8dbc34d3acb047fd37d1","schema":"chit402.universe.v1","window_id":"legacy_receipts_pre_v11"}
```

`universe_id`: `b623c1816e895dd967c4e51f0e066dafda546195a909e9b51283be4b5109caf4`.

## `universe_hash` is not one construction

On the legacy freeze, `universe_hash` is this Merkle root (`0x` plus 32 bytes).

On an export-coverage snapshot, a bid-board window, or any other universe, `universe_hash` is the hash that universe already signs (for export coverage, SHA-256 over the ordered row commitments). The freeze file stores the value the commit wrote. The gateway does not recompute it.

## Freeze document

`GET /freeze/:universeId` returns `chit402.freeze.v1`, signed by the issuer key. 404 when the flag is off or the id is unknown.

`ISSUER_ROOT_FREEZE_FILE` is a JSON object `{ "freezes": [ ... ] }` or a bare array. Each entry:

| Field | Rule |
|---|---|
| `universe_id` | 32-byte hex |
| `universe_hash` | `0x` plus 32 bytes |
| `enumerated_count` | integer ≥ 0 |
| `freeze_head.chain_id` | CAIP-2 string |
| `freeze_head.frozenBlock` | block number of the commit |
| `freeze_head.blockhash` | `0x` plus 32 bytes |
| `tx_hash` | Safe transaction hash, `0x` plus 32 bytes |

Startup, in strict mode, reads each `Frozen` log at the same finalized block on both RPCs. `universeHash`, `enumeratedCount`, and `frozenBlock` come from the log. `blockhash` is the hash of that log's block. The file's `freeze_head.chain_id` must equal `ISSUER_ROOT_CHAIN_ID`. A mismatch refuses to start. The route then signs only a file row that still matches those startup facts. It does not read the chain again. A `skip` startup does not sign a freeze document. A stranger still checks the document against the `Frozen` log field by field (decoded ABI values).
