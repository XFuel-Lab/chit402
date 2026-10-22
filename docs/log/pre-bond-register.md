# Pre-bond register (PROPOSED)

**Status: proposed, for decision.** Nothing here is deployed or pinned. Schema `chit402.pre_bond_register.v0`. The `v0` marks it as a proposal; the accepted format gets `v1`.

## Purpose
The register is the fixed list of tree heads that exist before bond start, each marked `good` or `excluded`. Its hash is pinned when the bond is deployed. It is the authority for exclusions (rule R1 in [`quarantine-ack.md`](quarantine-ack.md)): a quarantine note is signed by the issuer key the escrow guards against (R4), so the note alone can't be trusted to say which heads are excused. The pinned hash fixes that set before anyone has a reason to add to it.

## Format
A JSON object with exactly these keys:

| Key | Type | Meaning |
|---|---|---|
| `schema` | string | `chit402.pre_bond_register.v0` |
| `as_of` | string | Bond start, `YYYY-MM-DDTHH:MM:SSZ` (UTC, whole seconds). Every note named here must have `iat` before it. |
| `issuer_kid` | string | The issuer key id (base64url, 43 chars) whose heads are listed. |
| `heads` | array | One entry per head, at least one. |

Each `heads[]` entry has exactly these keys:

| Key | Type | Meaning |
|---|---|---|
| `epoch` | integer | Log epoch. |
| `tree_size` | integer | Signed tree size. |
| `root` | hex64 | Signed root, lowercase. |
| `head_jws_sha256` | hex64 | SHA-256 of the head's compact JWS string. |
| `status` | `good` or `excluded` | |
| `ack_sha256` | hex64 or null | For `excluded`: SHA-256 of the JCS bytes of the signed quarantine note (`quarantineAckDocumentHash`). For `good`: `null`. |

Entries are sorted strictly ascending by `(epoch, tree_size, root, head_jws_sha256)`, with no duplicates. The four parts are the head identity (R2); there is no lookup by root.

## Hash
`register_hash = sha256( "chit402.pre_bond_register.v0" || 0x00 || JCS(register) )`, where JCS is RFC 8785 and the result is 32 bytes (hex in tools, `bytes32` on chain). The domain prefix keeps the hash from colliding with a hash of the same JSON in any other role.

## Where the hash is pinned (proposal)
- **Bond contract:** an immutable `bytes32 preBondRegisterHash` set in the constructor. Evidence that names a pre-bond head comes with the register; the contract recomputes the hash and checks the entry. No setter, so it can't change after deploy.
- **Deploy config:** the same value in the deploy config and in the deploy record, so an off-chain reader can check it without reading contract storage.
- If the contract can't recompute JCS on chain, the alternative is a Merkle root over the sorted entries. That is a separate decision; this proposal keeps the flat hash.

## Ack pointer
An excluded entry points to its note by `ack_sha256`. A validator finds the note with that hash, verifies its signature under `issuer_kid`, checks that it names the same four-part head, and checks `iat < as_of`. Any failure makes the register invalid.

## Example
[`pre-bond-register.example.json`](pre-bond-register.example.json) has the single epoch-2 excluded entry for the Oct 9 head (size 11, root `cf9f998f…4341`). `as_of`, `head_jws_sha256` and `ack_sha256` are placeholders until the bond start is set and the note is signed. The real register would also list every good pre-bond head.

## Code
- `services/gateway/src/pre-bond-register.js`: `validatePreBondRegister(register, { acks, keys })`, `preBondRegisterHash`, `registerExcludes`, `registerLists`, `inclusionEvidenceAllowed`.
- Tests: `services/gateway/test/pre-bond-register.test.mjs`, throwaway keys only.

## Open questions for decision
1. Flat hash or Merkle root over the entries (depends on what the contract checks on chain).
2. Whether `good` heads are listed at all, or only exclusions with every other pre-bond head treated as not excused.
3. The `as_of` value, which is the bond start.
