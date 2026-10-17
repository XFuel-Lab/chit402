# Changelog — chit402-verify

All notable changes to the Chit402 verifier alias are documented here. This project adheres to
[Semantic Versioning](https://semver.org/).

The package re-exports `chit402-verify` and forwards CLI arguments to that verifier.

## 0.4.3 — Pin chit402-verify 0.4.3

### Changed
- Depends on exactly `chit402-verify` `0.4.3`. The CLI forwards to that verifier. Exit 0 includes the on-chain payer check. An RPC that cannot be checked is exit 2. Not published. No deploy.

## 0.4.2 — Pin chit402-verify 0.4.2

### Changed
- Depends on exactly `chit402-verify` `0.4.2`.

## 0.4.1 — Pin chit402-verify 0.4.1

### Changed
- Depends on exactly `chit402-verify` `0.4.1`.
- Human text and the JSON `message` for `COULD_NOT_CHECK` say the receipt could not be checked and do not contain `invalid` or `INVALID`. `result`, `reason`, `exit_code`, and the verdict keys are unchanged. Not published. No deploy.

## 0.3.5 — Match @xfuel/verify 0.3.5

### Changed
- Depends on `@xfuel/verify` `^0.3.5`.
- `bin["chit402-verify"]` stays `cli.js` (npm 11 requirement).

### Fixed
- `package.json` declares `"type": "module"`. Without it, `cli.js` and `index.js` (ES module syntax) fail with `SyntaxError: Cannot use import statement outside a module` on Node 18 and Node 20 before 20.19, although `engines` says `>=18`.
- `cli.js` no longer exits 0 when the verifier is killed by a signal (crash, heap-OOM abort); it exits 128 + the signal number. SIGINT/SIGTERM/SIGHUP/SIGQUIT sent to the wrapper are forwarded to the verifier so it is not left running.

## 0.3.4 — Match @xfuel/verify 0.3.4

### Changed
- Depends on `@xfuel/verify` `^0.3.4`.
- `bin["chit402-verify"]` is `cli.js`. npm publish was rewriting `./cli.js` and warning that the script name was invalid.

## 0.3.0 — Match @xfuel/verify 0.3.0

### Changed
- Depends on `@xfuel/verify` `^0.3.0`.
- Publish notes: `publishConfig` does not name an owner. The registry maintainer is the npm user `xfuel`, the same account as `@xfuel/verify`.
- README usage includes `--canonical-preimage` and `--issuer-history-file`. Those flags hash the canonical object against signed `payload_hash` and read `not_after` from a pinned issuer-history snapshot. The CLI still forwards every argument unchanged.

## 0.2.0

- Public alias of `@xfuel/verify` `^0.2.0`, including the `chit402-verify` binary.
