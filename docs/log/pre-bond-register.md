# Pre-bond register

**Status: format decided 2026-10-22, not deployed.** Nothing here is pinned yet. Schema `chit402.pre_bond_register.v0`.

## Purpose
The register is the fixed list of excluded tree heads that exist before bond start, plus one `frontier` entry that marks where bond start sits in the log. Its hash is pinned when the bond is deployed. It is the authority for exclusions (rule R1 in [`quarantine-ack.md`](quarantine-ack.md)): a quarantine note is signed by the issuer key the escrow guards against (R4), so the note alone can't be trusted to say which heads are excused. The pinned hash fixes that set before anyone has a reason to add to it.

Good pre-bond heads are not listed. The `frontier` entry is the newest good anchored head at `as_of`, so "after bond start" has a fixed reference: a head is post-bond only if it is past the frontier by `(epoch, tree_size)`.

## Format
A JSON object with exactly these keys:

| Key | Type | Meaning |
|---|---|---|
| `schema` | string | `chit402.pre_bond_register.v0` |
| `as_of` | string | Bond start: the block time of the bond deploy, `YYYY-MM-DDTHH:MM:SSZ` (UTC, whole seconds). Set at deploy; no value is committed before then. Every note named here must have `iat` before it. |
| `issuer_kid` | string | The issuer key id (base64url, 43 chars) whose heads are listed. |
| `heads` | array | The excluded heads plus exactly one `frontier` entry. |

Each `heads[]` entry has exactly these keys:

| Key | Type | Meaning |
|---|---|---|
| `epoch` | integer | Log epoch. |
| `tree_size` | integer | Signed tree size. |
| `root` | hex64 | Signed root, lowercase. |
| `head_jws_sha256` | hex64 | SHA-256 of the head's compact JWS string. |
| `status` | `excluded` or `frontier` | Exactly one entry has `frontier`. Any number (zero or more) have `excluded`. |
| `ack_sha256` | hex64 or null | For `excluded`: SHA-256 of the JCS bytes of the signed quarantine note (`quarantineAckDocumentHash`). For `frontier`: `null`. |

Entries are sorted strictly ascending by `(epoch, tree_size, root, head_jws_sha256)`, with no duplicates. The `frontier` entry sorts with the others; it is not placed first or last by rule. The four parts are the head identity (R2); there is no lookup by root.

## Hash
`register_hash = sha256( "chit402.pre_bond_register.v0" || 0x00 || JCS(register) )`, where JCS is RFC 8785 and the result is 32 bytes (hex in tools, `bytes32` on chain). The domain prefix keeps the hash from colliding with a hash of the same JSON in any other role. This is a flat hash over the whole register; there is no Merkle root over the entries (the list is small).

## Where the hash is pinned
- **Bond contract:** an immutable `bytes32 preBondRegisterHash` set in the constructor. Evidence that names a pre-bond head comes with the register; the contract recomputes the hash and checks the entry. No setter, so it can't change after deploy.
- **Deploy config:** the same value in the deploy config and in the deploy record, so an off-chain reader can check it without reading contract storage.

## Ack pointer
An excluded entry points to its note by `ack_sha256`. A validator finds the note with that hash, verifies its signature under `issuer_kid`, checks that it names the same four-part head, and checks `iat < as_of`. Any failure makes the register invalid. The `frontier` entry has no note.

## After bond start
- A head is after bond start only if its `epoch` is greater than the frontier's, or its `epoch` is equal and its `tree_size` is greater.
- A head at or before the frontier position is pre-bond. If it is not listed as `excluded`, it is not excused by this register; the normal checks apply to it.
- A head with any identity part missing is never treated as after bond start.

## Example
[`pre-bond-register.example.json`](pre-bond-register.example.json) has the epoch-2 excluded entry for the Oct 9 head (size 11, root `cf9f998f…4341`) and a `frontier` entry. `as_of` and every `frontier` field read `SET_AT_BOND_DEPLOY`; `head_jws_sha256` and `ack_sha256` of the excluded entry are placeholders until the note is signed.

## Code
- `services/gateway/src/pre-bond-register.js`: `validatePreBondRegister(register, { acks, keys })`, `preBondRegisterHash`, `registerExcludes`, `registerLists`, `registerFrontier`, `isFrontierHead`, `headAfterBondStart`, `inclusionEvidenceAllowed`.
- Tests: `services/gateway/test/pre-bond-register.test.mjs`, throwaway keys only.

## Decided (2026-10-22)
1. Flat hash, no Merkle root.
2. Only excluded heads are listed, plus exactly one `frontier` entry (the newest good anchored head at `as_of`).
3. `as_of` is the bond deploy block time, set at deploy. No value is committed now.

## Open
- The constructor argument is built before the deploy block exists, so its time is not known exactly when the hash is computed. How the deploy fixes `as_of` against the block time (for example, a constructor check that `block.timestamp` is at or after `as_of` within a set bound) is to be settled with the bond contract.
