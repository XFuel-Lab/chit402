# Issuer key pin (Sepolia)

The issuer public key for a pinned era is `docs/well-known/issuer-key.json` at one git commit. The verifier takes that commit SHA and the SHA-256 of the file bytes. It does not fetch a branch name, `HEAD`, or `main`. A mutable ref is `ISSUER_PIN_MUTABLE_REF`.

The specimen pointer is `docs/well-known/issuer-key.ref.json`: commit `6c6d0a9483762f1120a0bacb067a0560f9d781b8`, SHA-256 `d14688282f5e8efe7efafbfc1f18192f93377b8d82f6400c388c4be4236600fb`. That commit is the pin. The pointer file is not a second copy of the key.

This file is not the gateway deploy and it is not `GET /.well-known/jwks.json`. It does not replace issuer-root startup, and it does not register a log witness. When a receipt carries `issuer_root.kid`, that kid must equal the pin. When the caller supplies a `/api/witnesses` document, each issuer `kid` or P-256 `jwk` in it must equal the pin. Witness account addresses are not issuer keys.

`docs/well-known/issuer-key.sig` is the registration self-signature. The same value is `self_signature` inside the JSON. The file hash covers the JSON, so stripping the signature changes the hash.

The preimage is UTF-8, one field per line:

```
chit402-issuer-registration-v1
1
<kid>
<created_at>
{"crv":"...","kty":"EC","x":"...","y":"..."}
```

`1` is the version. `<kid>` is the RFC 7638 thumbprint. The signature is ES256, IEEE-P1363, base64url. It is not a receipt JWS. A signature over another context, another key, or another `created_at` is `ISSUER_SELF_SIG_INVALID`. A pin with no `self_signature` still checks the key. Registries that only check key shape can verify this signature for possession.

The pin `chain_id` is `eip155:84532`. Base mainnet (`eip155:8453`) is `ISSUER_PIN_CHAIN_REFUSED`.

## Anchor check

`xfuel-verify receipt.json inclusion.json head.json --rpc` runs the pin check when the receipt or the head has `issuer_key_pin`, or when `--issuer-pin` is set.

```bash
xfuel-verify receipt.json inclusion.json head.json --rpc \
  --issuer-pin docs/well-known/issuer-key.json \
  --issuer-pin-commit <40-hex> \
  --issuer-pin-sha256 <64-hex>
```

`--issuer-pin-sig` is the sibling signature. `--issuer-witnesses` is a saved `/api/witnesses` document. The command reads those files. It does not GET the commit.

A claimed era with no pin file is `ISSUER_PIN_DOWNGRADE`. A file whose bytes are not the stated hash is `ISSUER_PIN_HASH_MISMATCH`. A receipt key that is not the pin is `ISSUER_PIN_MISMATCH`. A receipt that does not claim the era, and a command that does not pass `--issuer-pin`, keeps the previous anchor result.

## Rotation

Anchor mode treats a kid other than the specimen in this file as a rotation when the previous pin is not passed. That kid is `kATmVjz6J8QvSTS-bS1NUjWaLs35o-PXYurO2blMf-c`. A new kid is not accepted because the pin file was edited. Publish the new JSON and the new self-signature in the same control-key event as a `chit402.freeze.v1` JWS (`typ: chit402-freeze+jwt`) with `purpose: citizen_issuer_key`. The previous pin key signs it. The statement is:

```
chit402-issuer-rotation-v1
1
<prior kid>
<next kid>
<sha256 of the new pin file>
<40-hex commit of the new pin file>
<created_at>
eip155:84532
```

Pass the previous pin with `--issuer-prior-pin` and the freeze JWS with `--issuer-control`. A new key without that event is `ISSUER_ROTATION_UNCONTROLLED`. A receipt signed by the new key while the pin is still the old key is `ISSUER_PIN_MISMATCH`.

The freeze JWS is not inside the hashed pin file. The statement names the file hash, so the hash cannot include the JWS.

The file in this repo is a Sepolia registration specimen. It is not the production kid `IvFpmC-vPhkY_v0vidsrWVT9uzlE5XWKZgAEOeJTq1Q`. The private key is not in the repo, in CI, or in a Safe. This document does not sign a receipt.
