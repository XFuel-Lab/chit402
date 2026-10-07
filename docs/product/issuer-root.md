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
| `ISSUER_HISTORY_MIRROR_REPO` | Third-party repo that holds a commit-pinned copy of the issuer-history document. `owner/name` or `https://github.com/owner/name`. Unset means no mirror. |
| `ISSUER_HISTORY_MIRROR_COMMIT` | 40-hex commit of that copy. Required when any mirror variable is set. |
| `ISSUER_HISTORY_MIRROR_SHA256` | Lowercase hex SHA-256 of the committed file. It must equal the chit402-jcs-v1 hash of the current well-known document. |
| `ISSUER_HISTORY_MIRROR_PATH` | Path inside the repo. Default `issuer-history.json`. |
| `ISSUER_GUARDIAN_SET_FILE` | JSON file of public guardian keys and a threshold. No private key. Unset means history entries omit `guardian_set_hash`. |

Signing never reads the chain. `strict` asks two RPCs for `eth_chainId`, `eth_getBlockByNumber("finalized")`, and `eth_getLogs` at that same block number. The finalized block number, the block hash, and the single `RootCommitted` log must agree, and `rootHash` must equal `ISSUER_ROOT_HASH`. The same two RPCs must agree on every `KeyRetired` log up to that block. A miss, a mismatch, a disagreement, or an unreachable RPC refuses to start. `skip` does not call the RPC, and only when `ISSUER_ROOT_ALLOW_SKIP=I_UNDERSTAND`. That path logs an error and does not sign v11 receipts, on Base Sepolia or on mainnet. It still refuses an unset `ISSUER_PRIVATE_KEY`. It also does not learn retirements, because it did not read the registry. Topics and log decoding come from `services/gateway/abi/ChitIssuerRoot.json`, the contract artifact, not from a hand-written event signature.

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
| `jcs` | `RFC8785` |

There is no `string_escaping` field. `RFC8785` means [RFC 8785](https://www.rfc-editor.org/rfc/rfc8785): ECMAScript `JSON.stringify` string escaping and number serialization, and object keys sorted by UTF-16 code unit. U+0008, U+0009, U+000A, U+000C, and U+000D are `\b`, `\t`, `\n`, `\f`, and `\r`. The other C0 controls are lowercase `\u00xx`. U+0022 is `\"`. U+005C is `\\`. Other UTF-16 code units are copied, so U+1F600 is the four UTF-8 bytes `f0 9f 98 80`. Solidus is not escaped. Lone surrogates and non-finite numbers are rejected.

Vector `{ "s": "<TAB><LF><U+0001><U+1F600>" }` under this canonicalizer is the 22 bytes `7b2273223a225c745c6e5c7530303031f09f9880227d`.

SHA-256 of those UTF-8 bytes, with no trailing newline, is `payload_hash` for a v11 receipt and a v2 refusal.

### `request_digest`

A v2 refusal (`chit402.refusal.v2`, payload version 3) signs `request_digest`. A v11 receipt signs it when the gateway still has the client request. Flag-off payloads omit it.

`request_digest` is lowercase hex SHA-256 of the RFC 8785 bytes of this object. Every key is present. A missing idempotency key or client nonce is null. The body bytes are not in the object. `body_sha256` is SHA-256 of those bytes.

| Field | Meaning |
|---|---|
| `body_sha256` | Lowercase hex SHA-256 of the raw request body |
| `idempotency_key` | Client `Idempotency-Key` or `X-Idempotency-Key`, or null |
| `method` | Uppercase HTTP method |
| `nonce` | Client nonce (`X-XFuel-Nonce` or body `nonce`), or null |
| `path` | Request path, starting with `/` |

`intent_id` is a separate signed field. If the request carried one, the refusal must include it. A missing `intent_id` fails closed with `intent_id_required`.

The same idempotency key with a different `request_digest` fails closed with `idempotency_conflict`. The cached refusal or receipt is not returned.

The unsigned preimage is `request_preimage` on the document and `preimages.fields.request_digest.preimage_utf8`. A stranger recomputes SHA-256 of that exact text.

Vector:

```
{"body_sha256":"93dda1aa54d9bb86b7c2cdfaad61fd78e5b81656484a8941eee498adc9a54e54","idempotency_key":"idem-1","method":"POST","nonce":null,"path":"/v1/chat/completions"}
```

`request_digest` is `a9a7ca02eb504b94c7efb7a3a5832c0fc847e37cf6930ca48db3c0b6e04498f6`. The body whose SHA-256 is `body_sha256` is `{"model":"xfuel/auto","messages":[{"role":"user","content":"hello"}]}`.

A refusal v2 without `request_digest`, or without the preimage, is `REQUEST_UNBOUND` and does not pass. `@xfuel/verify` in this branch reports that status. PR #484 must keep the same check: do not treat a v2 refusal that lacks `request_digest` as a pass. Recompute with `verifyRequestDigest(digest, preimageUtf8)`, which hashes the supplied text and does not rebuild it.

### `policy`

Inside a v11 payment receipt. Flag-off v10 omits it. Refusal v2 does not carry it. A stored receipt is not re-signed to add it.

| Field | Type | Meaning |
|---|---|---|
| `policy_id` | string | Stable id. Dev default `chit402.receipt-policy`. |
| `policy_version` | string | Version of these terms. Dev default `1`. |
| `dispute_window_seconds` | integer | Dispute window the receipt was issued under. Dev default `86400`. |
| `retention_days` | integer | S3 Object Lock compliance retention, in days. Dev default `365`. |
| `retention_mode` | string | `compliance`. Any other mode fails closed. |
| `max_cumulative_spend` | string or null | Policy spend cap in atomic USDC, or null when the policy sets none. A session grant stays on `session.max_cumulative_spend`. |
| `policy_hash` | string | Lowercase hex SHA-256 of the RFC 8785 bytes of the other six fields. `policy_hash` is not part of that preimage. |

`policy_hash` uses the same RFC 8785 canonicalizer as `snapshot_hash`. The receipt's signed object is what governs that receipt.

Vector. Terms:

```
{"dispute_window_seconds":86400,"max_cumulative_spend":null,"policy_id":"chit402.receipt-policy","policy_version":"1","retention_days":365,"retention_mode":"compliance"}
```

`policy_hash` is `48a69e8a154e670ad67663feead6a6b7d9e0de6a8f733c49b108bf5d124502a8`.

The same cap set to the decimal string `2000` hashes to `ecf4cdabe9b755e4776167429dcffb73e1f275994cda68f0e32d776cac925601`.

Production boot (`NODE_ENV=production`) refuses to start unless `RECEIPT_POLICY_ID`, `RECEIPT_POLICY_VERSION`, `RECEIPT_POLICY_DISPUTE_WINDOW_SECONDS`, `RECEIPT_POLICY_RETENTION_DAYS`, and `RECEIPT_POLICY_RETENTION_MODE=compliance` are set. `RECEIPT_POLICY_MAX_CUMULATIVE_SPEND` is optional. Outside production, an empty config uses the dev defaults above. A partial config fails closed in every environment.

Boot and signing also refuse unless both of these hold:

- `retention_days` is at least 365.
- `retention_days * 86400` is at least the longest dispute window plus 30 days.

The longest dispute window is the maximum of this policy's `dispute_window_seconds` and the issuance window (`X402_ISSUANCE_DISPUTE_WINDOW_SEC`, or 7 days when that variable is unset). Thirty days is `2592000` seconds. A retention that merely outlives the window the receipt happens to use is not enough when a longer allowed window is configured. Equality with the floor passes. The check runs at boot and again when a v11 receipt is signed. Checking an already signed receipt does not apply the floor again: the signed `policy` object governs that receipt.

Floor vector. `dispute_window_seconds` is 335 days (`28944000`), which is the longest window that still fits in 365 days after the 30-day margin. Terms:

```
{"dispute_window_seconds":28944000,"max_cumulative_spend":null,"policy_id":"chit402.receipt-policy","policy_version":"1","retention_days":365,"retention_mode":"compliance"}
```

`policy_hash` is `c3229215b3badbb0ba8515827f92390753553680cce1501124fe339b042d369c`.

`retention_days` of 364 fails the day floor. A dispute window of `28944001` seconds with `retention_days` of 365 fails the margin. An issuance window of 340 days fails the margin even when the policy window stays at one day.

`GET /.well-known/receipt-policy-history.json` is `chit402.receipt_policy_history.v1`: an append-only `entries` list of `{ policy_version, policy_hash, terms, effective_from }`. `terms` is the six fields without `policy_hash`. A new `policy_version` or `policy_hash` appends a row. Older rows stay. The history announces the change. It does not replace the terms inside an already signed receipt.

PR #486 puts `retention_policy: { id, sha256 }` on the receipt-log bundle index from `RECEIPT_LOG_RETENTION_POLICY_ID` and `RECEIPT_LOG_RETENTION_POLICY_SHA256`. Those two values are this object's `policy_id` and `policy_hash`. This gateway is the source (`receiptPolicyRetentionClaim`). If either env var is set, boot requires both and requires them to equal that claim. #486 does not import this module, so it needs a follow-up to read `{ id, sha256 }` from here instead of a separately typed hash. Until that lands, an operator can point the log at a different digest only by skipping this check.

### Which canonicalizer covers which hash

| Hash | Canonicalizer |
|---|---|
| v11 receipt `payload_hash`, including the `issuer_history_snapshot` object inside that payload | RFC 8785 (`jcsRfc8785`) |
| v2 refusal `payload_hash` | RFC 8785 |
| `issuer_root` fingerprint suffix on a new issuer-history version | RFC 8785 |
| `issuer_history_snapshot.snapshot_hash`, and the v11 / refusal-v2 `issuer_history.hash` pin | RFC 8785 of the embed `entries` array only. SHA-256 of those UTF-8 bytes |
| v11 `policy.policy_hash` | RFC 8785 of the policy terms, excluding `policy_hash` itself |
| `guardian_set_hash` | RFC 8785 of `{ schema, threshold, guardians }`. Each guardian `jwk` is `{ crv, kty, x, y }`. Guardians are sorted by `kid`. The hash is not an input |
| issuer-history mirror `sha256` | chit402-jcs-v1 of the whole well-known issuer-history document. Same digest as `X-Chit-History-Hash`. Not `snapshot_hash` |
| well-known document hash (`?hash=` of the full issuer-history document, and the flag-off `issuer_history.hash` pin) | chit402-jcs-v1 (`jcsCanonicalize`) of the whole document |
| `entry_hash` | chit402-jcs-v1. SHA-256 of the entry without `entry_hash` |
| v7–v10 receipt `payload_hash`, flag-off refusal `payload_hash`, and every flag-off path | chit402-jcs-v1. Those bytes are not recomputed |

chit402-jcs-v1 writes every code unit U+0000 through U+001F as `\u00xx`, including tab and newline. The same control vector under that canonicalizer is the 30 bytes `7b2273223a225c75303030395c75303030615c7530303031f09f9880227d`. A stored v7–v10 receipt is not re-signed onto RFC 8785.

### `issuer_history_snapshot`

`chit402.issuer_history_embed.v1`. A minimal copy of the pinned history so a saved receipt can check the kid window without `GET /.well-known/issuer-history.json`.

| Field | Meaning |
|---|---|
| `schema` | `chit402.issuer_history_embed.v1` |
| `version` | Same as `issuer_history.version` |
| `seq` | Same as `issuer_history.seq` |
| `head_hash` | Last entry's `entry_hash` |
| `snapshot_hash` | SHA-256 of the RFC 8785 bytes of `entries` only. Same value as the `issuer_history.hash` pin. Not the well-known document hash |
| `entries` | One object per history entry, in chain order |

Each entry has `kid`, `jwk` (`kty`, `crv`, `x`, `y`, `kid`, `alg`, `use`), `alg`, `not_before`, `not_after`, `status`, `revoked_at`, `reason`, `custody`, `prev_hash`, `entry_hash`. Two further fields are included only when they are set, and they are omitted rather than null: `guardian_set_hash` and `retirement_block`. The snapshot vector below omits both, so its bytes stay the same. Flag-off history never adds them.

`snapshot_hash` is SHA-256 of the UTF-8 RFC 8785 canonicalization of the `entries` array alone, after each entry is reduced to `kid`, `jwk`, `alg`, `not_before`, `not_after`, `status`, `revoked_at`, `reason`, `custody`, `prev_hash`, and `entry_hash` (missing window fields are null). No trailing newline. It is not a hash of `schema`, `version`, `seq`, `head_hash`, or the well-known document. `entry_hash` inside each entry is still SHA-256 of the chit402-jcs-v1 entry body, without `entry_hash`.

The `issuer_history` pin in a v11 receipt and in a refusal v2 is that same digest computed from the entries of the published history document at that `version`. `version` and `seq` on the pin match the embed. Flag-off receipts still pin the chit402-jcs-v1 hash of the full well-known document. `?hash=` serves that document by its document hash, and also by this entries digest once the version has been sealed.

A chain of `entry_hash` values can be rewritten and still look self-consistent. That is not a check of `snapshot_hash`. Backdating `not_before`, swapping `jwk`, and recomputing `entry_hash` changes the RFC 8785 bytes, so the new digest is not the signed pin. Matching it requires changing `issuer_history.hash`, which is inside the signature.

Offline check, with no well-known fetch:

1. `canonicalization` is `{ hash_alg: "sha-256", jcs: "RFC8785" }`.
2. Recompute `snapshot_hash` as SHA-256 of the RFC 8785 bytes of `entries`. It equals `issuer_history.hash`.
3. `version` and `seq` equal the pin.
4. `entry_hash` is SHA-256 of the chit402-jcs-v1 bytes of the entry without `entry_hash`.
5. `prev_hash` chains, and the last `entry_hash` equals `head_hash`.
6. The entry whose `kid` is `issuer_root.kid` supplies `not_before`, `not_after`, `status`, and `revoked_at`.

When the published document is available, `issuer_history.hash` must also equal that same function applied to the document's entries. Do not compare the pin to the chit402-jcs-v1 hash of the whole document.

Refusal v2 (`chit402.refusal.v2`, payload version 3) carries `canonicalization` and `issuer_history_snapshot` and is checked with these rules. Payload version 3 is not `>= 11`. A verifier that only runs this check for payment payload version 11 or greater misses refusals. Flag-off refusal v1 (payload version 2) has neither field.

Test vector. One entry, `reason` containing U+000A. The preimage is this single line:

```
[{"alg":"ES256","custody":"env","entry_hash":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","jwk":{"alg":"ES256","crv":"P-256","kid":"kid","kty":"EC","use":"sig","x":"x","y":"y"},"kid":"kid","not_after":null,"not_before":"2026-01-01T00:00:00.000Z","prev_hash":null,"reason":"line\nbreak","revoked_at":null,"status":"active"}]
```

`snapshot_hash` is `5807995d545f994f774145bbc13de8102d9696b81f178eca800f08092f608d2d`. The newline in `reason` is the two characters `\n`, which is RFC 8785, not `\u000a`.

The embed sits inside the v11 payload, so the bytes of this object that feed `payload_hash` are RFC 8785. One live key is 1052 bytes of that form. The full well-known document is larger because of the prose and the history JWS; those stay on `/.well-known/issuer-history.json`. Its document hash is unchanged.

A receipt that already has a JWS is not re-signed. While the issuer root is on, a later covering root is an unsigned `covering_head` sidecar (`chit402.covering_head.v1`, `signed: false`). The stored `issuer_signature.jws` bytes stay put across a key rotation and a tree-head update. Flag-off v10 may still reseal `tree_head_hash` inside that same claim set. v9 and older are never restamped.

## Independent issuer-history mirror

The gateway never pushes, clones, or fetches a git remote. An operator copies the well-known document by hand:

1. Take the exact bytes of `GET /.well-known/issuer-history.json` (the `body` stored for the current version). `sha256` of those UTF-8 bytes is the chit402-jcs-v1 document hash, the same value as `X-Chit-History-Hash`.
2. Commit that file in a third-party repository at `issuer-history.json`, or at `ISSUER_HISTORY_MIRROR_PATH`.
3. Set `ISSUER_HISTORY_MIRROR_REPO`, `ISSUER_HISTORY_MIRROR_COMMIT` to that commit, and `ISSUER_HISTORY_MIRROR_SHA256` to that digest. Restart.

A partial set refuses to boot. A branch name is not a commit. A URL with userinfo is refused, so a token cannot sit in the repo string. `https://github.com/owner/name.git` is stored as `owner/name`.

`GET /.well-known/issuer-history-mirror.json` is `chit402.issuer_history_mirror.v1`. It carries `role: "announcement"`, `custodian: false`, `repo`, `commit`, `path`, `sha256`, and a note that this process does not push. When the pin is unset the route is 404. When `sha256` is not the current document hash the route is 409 `issuer_history_mirror_stale`, and v11 signing throws the same code.

The mirror object is not a field of the hashed issuer-history document. That document remains the announcement copy on this host. It is not a second custodian. Flag-off receipts do not carry `issuer_history_mirror`. When the flag is on and the pin matches, the v11 receipt and refusal v2 sign `{ repo, commit, path, sha256 }`.

After a new history version the document hash changes. The pinned bytes include the history JWS. A restart that seals a new snapshot, because the version file was not persisted, changes that hash even when the key set is the same. Boot and v11 signing stay closed until the operator commits the new bytes and updates the commit and the sha256.

## Guardian set and retirement

Names in this section are provisional until PR #485 publishes `docs/product/issuer-root.md`. Match that file when it lands.

`ISSUER_GUARDIAN_SET_FILE` is a JSON document:

```json
{
  "schema": "chit402.guardian_set.v1",
  "threshold": 2,
  "guardians": [
    { "kid": "<rfc7638 thumbprint>", "jwk": { "kty": "EC", "crv": "P-256", "x": "...", "y": "..." } }
  ]
}
```

`threshold` is an integer from 2 through the guardian count, and there are at least two guardians. `kid` must be the RFC 7638 thumbprint of that `jwk`. A `d` field or a PEM private key fails closed (`guardian_key_material`). The gateway signing key must not appear in the set (`issuer_key_is_guardian`). Safe keys and guardian private keys are not read from the environment, from AWS, or from CI. Tests generate throwaway public keys in process.

`guardian_set_hash` is SHA-256 of the RFC 8785 bytes of `{ schema, threshold, guardians }`. Guardians are sorted by `kid`. Each `jwk` in that preimage is `{ crv, kty, x, y }`. The hash is not inside the preimage.

While the issuer root is on and the file is set, every history entry in the new version includes `guardian_set_hash`. The field is inside `entry_hash` and inside `snapshot_hash`. When the file is unset the field is omitted, not null.

A registry kid is the RFC 7638 thumbprint decoded from base64url into 32 bytes, then hex with a `0x` prefix. That is the same encoding as `kidToBytes32` on the contract branch. `KeyRetired` is decoded from the artifact ABI. Strict startup reads those logs up to the agreed finalized block. The two RPCs must return the same set. The cache stores the log's block number. Signing does not read the chain again.

A history entry whose kid is in that cache has `retirement_block` set to the log block, `status` `retired` (a `revoked` entry stays revoked), and `not_after` filled from `KeyRetired.notAfter` when the entry had none and `notAfter` is above 0. Zero leaves the window open and does not become a timestamp. A kid the cache does not list omits `retirement_block`.

The gateway refuses to sign with a kid the cache shows as retired (`issuer_key_retired`). That includes payment receipts, refusals, foreign ingest, and the issuer-history JWS. `skip` does not fill the cache. It already cannot sign v11.

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
