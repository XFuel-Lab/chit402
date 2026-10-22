# Quarantine acknowledgement (`chit402.quarantine_ack.v2`)

A quarantine acknowledgement is a public, issuer-signed note about one signed log head that the gateway does not serve. It says which head it is, why it isn't served, which head replaces it, and it carries a consistency proof that the quarantined root is an earlier prefix of the replacement root in the same epoch.

This format exists for the escrow pre-bond register. A signed head marked `excluded` on that register needs one of these notes plus that proof. The proof stops the note from excusing a real fork: a fork root is not a prefix of the replacement root, so a proof for it can't exist.

## Status
- **Format:** this document.
- **Draft entry:** [`quarantine-acks/epoch-2-size-11-cf9f998f.draft.json`](quarantine-acks/epoch-2-size-11-cf9f998f.draft.json). It is unsigned, and the fields marked `FILL_FROM_JOURNAL` are still placeholders.
- **Signing tool:** `services/gateway/scripts/sign-quarantine-ack.mjs`. It fills those fields from the receipt-log journal, signs, self-verifies and prints. It writes nothing. **On hold:** nobody runs it until PR3 of the verifier stack has landed and this PR has passed review.
- **Library:** `services/gateway/src/quarantine-ack.js` (validate, sign, verify, consistency check, four-part head identity). Tests: `services/gateway/test/quarantine-ack.test.mjs`, throwaway keys only.
- **Pre-bond register (proposed):** [`pre-bond-register.md`](pre-bond-register.md), with the example [`pre-bond-register.example.json`](pre-bond-register.example.json), the validator `services/gateway/src/pre-bond-register.js` and tests `services/gateway/test/pre-bond-register.test.mjs`.
- **Not done yet:** serving the signed note. See Publication.

## Relation to the journal note (`chit402.quarantine_ack.v1`)
The gateway already writes a v1 note to its private journal (`receipt-merkle.js` `acknowledgeQuarantinedHead`). It signs only `root`, `epoch`, `tree_size` and `prefix_size`, and `/health` reads it to set `quarantined_heads[].acknowledged`. v1 has no signed time, no replacement head and no proof, so it cannot serve as the public note.

v2 uses the same `typ` and the same issuer key. The two are kept apart by `schema`:
- the gateway's v1 reader requires `schema` = `chit402.quarantine_ack.v1`;
- the v2 verifier requires `schema` = `chit402.quarantine_ack.v2` and the exact v2 key set.

## Signing
| | |
|---|---|
| Key | The issuer key (`ISSUER_SIGNER=kms`), the same key that signs tree heads, receipts and issuer history. The verifier takes the key for `kid` from the published issuer history, never from the document. |
| JWS header | `{"alg":"ES256","typ":"chit402-quarantine-ack+jwt","kid":"<kid>"}`. The header is exactly these three keys. The `typ` separates this note from `chit402-tree-head+jwt`, `chit402-receipt+jwt` and `chit402-issuer-history+jwt`. |
| JWS payload | The RFC 8785 (JCS) UTF-8 bytes of the claims. A payload that is not byte-equal to the JCS of its own parse is refused. |
| Signature | ES256, 64-byte r‖s, base64url. |

The published document is the claims at top level plus `issuer_signature`: `{ alg, typ, payload_version, kid, jws }`. A reader uses only the signed payload. The top-level fields, without `issuer_signature`, must have the same JCS bytes as the payload, or the note is refused (`outer_mismatch`).

For a register entry, the document hash is the SHA-256 of the JCS bytes of the whole published document (`quarantineAckDocumentHash`).

## Claims
Every object has exactly the keys listed. Hashes are 64 lowercase hex. Integers are safe integers.

| Field | Meaning |
|---|---|
| `schema` | `chit402.quarantine_ack.v2` |
| `payload_version` | `2` |
| `iss` | `chit402` |
| `iat` | Signing time, in unix seconds. The escrow rule compares this time and the register to bond start (see below). |
| `epoch` | The log epoch. There is no log id, so the epoch identifies the log. |
| `quarantined_head.tree_size`, `.root` | What the bad head signed. |
| `quarantined_head.prefix_size` | The size whose root the bad head's root actually is. It must be below `tree_size`. |
| `quarantined_head.published_at` | The bad head's own signed `published_at`, taken from the journal. |
| `quarantined_head.kid` | The kid that signed the bad head. |
| `quarantined_head.head_jws_sha256` | SHA-256 of the bad head's compact JWS string, so the note names one exact signed object. |
| `quarantined_head.anchors` | Optional `base {chain_id: 8453, tx}` and `solana {cluster: "mainnet-beta", signature}`, where the bad root was anchored. |
| `reason` | `publish_append_race`. This is a closed list; a new reason needs a new schema revision. |
| `replacement_head.tree_size`, `.root`, `.published_at`, `.anchors` | The served head for the same size, from its signed payload. |
| `consistency.first_tree_size` | Equal to `quarantined_head.prefix_size`. |
| `consistency.second_tree_size` | Equal to `replacement_head.tree_size`. |
| `consistency.proof` | An RFC 6962 consistency proof from the quarantined root to the replacement root (the `GET /v1/receipts/tree/consistency` recipe). It must rebuild both roots exactly. |
| `handling` | Fixed values. `head_served: false`. `inclusion_against_head: "not_evidence"`: no inclusion proof against this head is evidence of inclusion. `receipts_only_in_head: 0`. `covered_by: "replacement_head"`. `escrow_register: "excluded"`. `scope: "this_head_only"`. |

A verifier checks, in order:
1. The JWS header.
2. That the kid is in the trusted keys.
3. The ES256 signature.
4. That the payload is canonical.
5. Every claim rule.
6. The consistency proof.
7. That the outer fields equal the payload.

## The Oct 9, 2026 entry (epoch 2)
- **What happened:** a receipt was appended while the daily publish was waiting on its Base send. The gateway signed and anchored a head that claims `tree_size` 11 over the size-10 root.
  - Quarantined head: root `cf9f998f…4341`.
  - Base anchor: `0xae4db6e8…b357` (nonce 12, block 52376044).
  - Solana memo: `5bdexVCB…qPF`.
- **Replacement head:** size 11, root `3519a85e…0856`, signed `published_at` 2026-10-09T10:23:55.863Z, Base `0xeb056e3a…6281` (nonce 13).
- **Proof:** the 10 to 11 consistency proof in the draft comes from the public `GET /v1/receipts/tree/consistency?first=10&second=11&epoch=2`, and it rebuilds both roots.
- **Receipts:** every leaf the bad root commits to is a leaf of the replacement head, so no receipt depends on the bad head. Leaf index 10 is committed only by the replacement head. A proof against the bad head can put leaf 9 at index 10. That is why `inclusion_against_head` is `not_evidence`.
- **Gateway behavior:** since #525 it quarantines this head at boot, and the head is not in `epoch.heads`, inclusion or head serving. `/health` lists it under `quarantined_heads` with `acknowledged: true` from the v1 journal note.

## Publication
The signed note is not published yet, and it is not signed yet. Signing waits until PR3 of the verifier stack has landed and this PR has passed review. The proposed steps after that are:
1. Commit the signed document as `docs/log/quarantine-acks/epoch-2-size-11-cf9f998f.json`, next to the draft. The repo copy is the durable public record.
2. Serve the same bytes from the gateway at `GET /.well-known/quarantine-acks.json`. That is a list document, `{ "schema": "chit402.quarantine_acks.v1", "acks": [ <published documents> ] }`, which is not itself signed: each entry carries its own signature. This route is a follow-up change.
3. Add `ack_url` and `ack_sha256` to each `/health` `quarantined_heads[]` entry, so a reader who sees a quarantined head can find its note.
4. The escrow pre-bond register lists this head by `{ epoch, tree_size, root, head_jws_sha256 }` with `status: "excluded"` and the note's `ack_sha256`. The register hash is pinned when the bond is deployed. See R1 and the proposed format in [`pre-bond-register.md`](pre-bond-register.md).

A verifier finds notes through `/.well-known/quarantine-acks.json` or the repo path. It checks each note under the issuer history key for its `kid`, as it does for tree heads.

## Normative rules
The key words MUST, MUST NOT and SHOULD are used as in RFC 2119.

### R1. The pinned register is the authority
- The pre-bond register hash pinned when the bond is deployed is the only authority on which heads are excluded. A note, a served file, a `/health` flag or a later register does not change it.
- A note excuses a head only if the head's entry on the pinned register has `status: "excluded"` and an `ack_sha256` equal to the SHA-256 of the JCS bytes of that note.
- The note's signed `iat` MUST be strictly before bond start (the register's `as_of`). A note signed at or after bond start excuses nothing, even if it is otherwise valid.
- A head that is not on the pinned register is never excused. Whether a head is after bond start is decided by the register's single `frontier` entry (the newest good anchored head at `as_of`): a head is post-bond only if it is past the frontier by `(epoch, tree_size)`.

### R2. A head is identified by four parts
- An exclusion names a head by `(epoch, tree_size, root, head_jws_sha256)`. All four MUST match. A verifier MUST NOT exclude a head by its root alone, or by any subset of the four parts.
- The reason: the excluded root `cf9f998f…` is also the honest size-10 root of epoch 2. A root-only rule would also excuse the honest size-10 head and any other signed object carrying that root.
- `head_jws_sha256` is the SHA-256 of the head's compact JWS string. ES256 is non-deterministic, so two signatures over the same claims are two different signed objects, and only the one named is excluded.
- `ackExcludesHead`, `registerExcludes` and `registerLists` enforce this: a head with any part missing, or with a `jws` that does not hash to the given `head_jws_sha256`, is never matched.

### R3. No evidence from an excluded head
- An inclusion proof against an excluded head MUST NOT be used as evidence either way: not to show that a receipt is in the log, and not to show that it is missing or at a different index.
- Escrow evidence that relies on an excluded head is rejected. A receipt's inclusion is shown only against a head that is not excluded (here, the replacement head or a later head).
- `inclusionEvidenceAllowed(register, head)` returns false for an excluded head.

### R4. The note is signed by the key it guards against
- The note is signed by the same issuer key whose heads the escrow watches. Whoever holds that key could also sign a note for a head they want excused, including a real fork, at any time.
- A valid signature therefore does not make a note trustworthy on its own. The pinned register exists for this reason: it fixes, before bond start, the exact set of excused heads and the hash of each note. A later note signed by the same key cannot be added to it.
- The consistency proof adds a second limit: a note can only describe a root that is a prefix of the replacement root, so it cannot describe a fork.
