# State SMT fixtures

One depth-256 sparse Merkle tree. Every proof in this directory verifies against `root.bytes`. `#685` checks these bytes exactly; do not regenerate them unless the tree encoding changes.

The payTo value and the `0x05` key value are histories this branch cannot decode or regenerate. Their generator lives on the seller-key add-on at `d2f80683`. The bytes stay opaque tree leaves. `SHA256SUMS` stays `189083cf310a6445f9cd65c973b01937405c72c395443ba15d12a548d5bada4e`.

## Tree

Leaves are state-slot values. The slot key is not stored again inside the value.

| File | What it is |
|---|---|
| `root.bytes` | 32-byte tree root |
| `payto-slot.bytes` | PayTo slot key, kind `0x01`, 20-byte id |
| `payto-value.bytes` | History under that slot: one PayToControl |
| `payto-member.proof` | Membership proof of `payto-value.bytes` |
| `absent-payto-slot.bytes` | A payTo slot key with no leaf |
| `absent-payto.proof` | Non-membership proof of that slot |
| `key-slot.bytes` | Key slot key, kind `0x05`, id = keyHash |
| `key-value.bytes` | History under that slot: one RevokeByKey |
| `key-member.proof` | Membership proof of `key-value.bytes` |
| `blank-key-slot.bytes` | A kind `0x05` slot key with no leaf |
| `blank-key.proof` | Non-membership proof. The slot is a blank subtree |

`SHA256SUMS` lists `sha256(file-bytes)` for each of those files, two spaces, then the file name. The hash is of the raw file, not of a hex encoding.

## Proof encoding

A proof is a 32-byte bitmap followed by the non-blank siblings. Depth 0 is the end nearest the root. Depth `d` reads key byte `floor(d / 8)`, bit `7 - (d % 8)` (mask `128 >> (d % 8)`).

Bit `d` is set only when the sibling at that depth is not the blank subtree of height `255 - d`. Siblings follow the bitmap in increasing depth, 32 bytes each. A set bit whose sibling is blank is not a valid proof. A clear bit means the verifier inserts that blank hash itself.

An absent slot uses the blank hash of height 0 as the leaf, not `stateLeaf`. A present slot uses `stateLeaf(slotKey, value)`. Internal nodes are `stateNode(left, right)`. The blank recurrence is the line module's empty hash: `blank(0) = H(0x02 ‖ "empty")`, and `blank(h+1) = stateNode(blank(h), blank(h))`.

There is one proof format. Proofs are not capped at 480 bytes. `#685` verifies these files byte for byte against `SHA256SUMS`.
