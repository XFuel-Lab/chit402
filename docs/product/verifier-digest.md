# Verifier build digest

The offline verifier is `packages/verify` (`@xfuel/verify`). Its published digest is `packages/verify/BUILD_DIGEST.txt`.

The recipe is `npm run digest` in that package. It hashes the sorted `src/**/*.ts` files. Newlines are normalized to `\n`. The digest is SHA-256 of the lines `path file-sha256`. It is not a bit-reproducible compiler binary. `tsc` output depends on the toolchain, so that artifact is not what the issuer signs.

The receipt Merkle tree's genesis leaf (`chit402.tree_genesis.v1`, leaf index 0) copies `verifier_binary_build_digest` from that file at the moment the tree is created.

## What this proves

The issuer named this source digest in the genesis leaf. A holder who runs the recipe on the published `packages/verify` sources can see whether they match.

## What this does not prove

It does not prove the gateway process loaded that exact build. It does not prove a `tsc` binary byte-for-byte. A tree created before the digest file existed has a null digest in genesis; that tree is not rewritten.
