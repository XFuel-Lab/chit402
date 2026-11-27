# Issuer-history signing

This is the ceremony for `chit402-verify` 0.5.0. It does not publish the package. It uses the production issuer key that already signs receipts. It does not put that key, a cloud key id, or a host name in the repo.

Two documents are signed, in either order. Both stay test-signed in git until this ceremony replaces the signatures. `prepublishOnly` refuses a test signature.

## Frozen history

`packages/verify/issuer-history.v2.snapshot.json` is the history receipts already pin. Do not edit it. The next snapshot is a new file, `issuer-history.snapshot.json`, with a higher `version` and `seq`. Its `entries` keep the frozen entry hashes, in order. Later entries may be appended. They may not rewrite an earlier `entry_hash`.

## Anchor pin

The signed payload and the document both carry one `contracts` row. Do not add `narrowing`. Leaving it out means there is no narrowing; an empty list is not required. The bytes the issuer signs are exactly the string printed by:

```
node scripts/issuer-history.mjs signing-input <unsigned.json> <production-kid>
```

Run that from `packages/verify`. `<production-kid>` is the thumbprint of the key in the frozen v2 snapshot. Sign that ASCII string with the production key. The verifier wants the signature as raw R||S, 64 bytes, base64url. A library that returns DER must be converted to raw R||S. Normalise to low-S before `assemble`. The verifier also accepts high-S; low-S is hygiene so every signature has one encoding.

Before `assemble`, verify that signature against the production JWK in the frozen v2 file. Do not take the key from the document being signed. Then:

```
node scripts/issuer-history.mjs assemble <unsigned.json> <production-kid> <signature> <out.json>
```

`assemble` refuses a signature that is not 64 bytes, and it refuses a `head_hash` that is not the last entry hash. The JWS prefix in the output is the signing-input string.

The contract row is fixed except for the hour:

| Field | Value |
|---|---|
| chainId | 8453 |
| address | `0xc16010f028a00a3addb37609c38d010ec1df93b1` |
| codeHash | `0xbaad531853ab89c65eeddee489d0290f41a623f785ded9855e80aefee9fb087f` |
| predecessor | `0x0000000000000000000000000000000000000000` |
| checkpoint | `0x7a8d6426e1057535a5442ba526ec9f317a9d9026` |
| checkpointVersions | `[1]` |
| retireHourStart | null |
| genesisHourStart | hour of the first finalized anchor |

`genesisHourStart` is not known until the first anchor is finalized. The contract does not expose a getter for it. Read `hourStart` from that anchor and pass the same integer to the publish check:

```
node scripts/issuer-history.mjs check --expect-genesis <hourStart>
```

The check compares the candidate at `issuer-history.snapshot.json` with the frozen v2 file, not with itself. It requires version and seq to both increase, the entry prefix above, one contract row with the values in the table, and a signature by the production key from the frozen file. A test key is refused. `--test-signer` exists for the package tests and is not used here.

Until `<hourStart>` is known, leave `PINNED_GENESIS` in `scripts/issuer-history.mjs` unset. The check then exits 1. After the hour is known, set that constant to the same integer so `prepublishOnly` can pass it without a flag. Setting `PINNED_GENESIS` is a code change and belongs in the same reviewed pull request as the signed snapshot. The value must be a whole UTC hour, at or after 1795460400 (19:00Z on 2026-11-23). `--expect-genesis` uses the same rule: an empty string, a non-integer, or an hour that is not a multiple of 3600 is refused.

`--test-signer` is for the package tests. It runs only when `CHIT402_TEST_SIGNER=1`, and it prints `TEST-SIGNED, not publishable`. The ceremony does not set that variable.

## Version windows

`version-windows.json` already contains `pv13`:

- `not_before`: `2026-11-23T19:28:25Z`
- `floor`: true
- `not_after`: null

The verifier applies that row to the anchored hour, and only after this file carries the production signature. A test signature leaves the row unenforced. Re-sign with the same helper as the other windows document:

```
node scripts/version-windows.mjs signing-input version-windows.json <production-kid> <iat-seconds>
node scripts/version-windows.mjs assemble version-windows.json <production-kid> <iat-seconds> <signature> version-windows.json
```

Sign the exact signing-input string. Then update `VERSION_WINDOWS_SHA256` to the sha256 of the file that was written.

## Publish

`npm publish` runs `prepublishOnly`, which runs both checks. Both must exit 0. Do not publish, tag, or merge as part of preparing the documents.

The check hashes the frozen v2 file and verifies its production signature before it trusts that file as the version baseline. The next ceremony, the one that replaces this v3 snapshot, must first copy the signed v3 bytes to a new sealed file and add that row. Do not point the sealed row at the file the ceremony is about to overwrite.
