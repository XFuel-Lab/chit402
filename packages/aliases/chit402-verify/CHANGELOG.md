# Changelog — chit402-verify

All notable changes to the Chit402 verifier alias are documented here. This project adheres to
[Semantic Versioning](https://semver.org/).

The package re-exports `@xfuel/verify` and forwards CLI arguments to `xfuel-verify`.

## 0.3.0 — Match @xfuel/verify 0.3.0

### Changed
- Depends on `@xfuel/verify` `^0.3.0`.
- README usage includes `--canonical-preimage` and `--issuer-history-file`. Those flags hash the canonical object against signed `payload_hash` and read `not_after` from a pinned issuer-history snapshot. The CLI still forwards every argument unchanged.

## 0.2.0

- Public alias of `@xfuel/verify` `^0.2.0`, including the `chit402-verify` binary.
