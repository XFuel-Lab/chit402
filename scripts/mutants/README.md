# PR #665 mutant runner (portable)

Offline mutation runner for the post-settle hold work in chit402 PR #665.
It is independent of the PR's own `scripts/hold-mutants.mjs`.

## Files
- `run-mutants.mjs`: the runner (Node 18+; no dependencies).
- `mutants.json`: the mutant list and test suites, as data.

## Usage
```
node run-mutants.mjs <repo-root>                      # all mutants
node run-mutants.mjs <repo-root> --only S2_drop_prior_unknown,R7_late_gating_off
node run-mutants.mjs <repo-root> --list other.json --timeout-sec 180
node run-mutants.mjs <repo-root> --no-unshare         # only if unshare is unavailable; you must then be offline yourself
```
`<repo-root>` is a chit402 checkout (worktree is fine) that has its own installed `node_modules`
in `services/gateway`, `packages/sdk` and `packages/mcp`. The runner refuses a symlinked `node_modules`.
For the gateway suite, `packages/verify/dist` must be built.

## What it does
1. Runs a baseline of every suite the selected mutants use. If any baseline fails it stops (exit 3), since a broken baseline makes every mutant look KILLED.
2. For each mutant: applies the `nth` regex match of `find` → `replace` in `file` (NOT_APPLIED if nothing matched), runs its suite, then restores the file.
3. Each suite run is `unshare -rn` (network namespace, loopback up) with a private `TMPDIR`, a 180 s timeout (SIGKILL → TIMEOUT) and the suite env from `mutants.json`. The gateway env is `NODE_ENV=test ISSUER_HISTORY_TEST_ROTATION=true ISSUER_TEST_KEY=1 HUB_CATALOG_OFFLINE=true`, with `--test-concurrency=1`.
4. Restores on SIGINT/SIGTERM, and checks every touched file's sha256 against the start at the end (exit 4 if anything is still dirty).

Output lines: `BASELINE <suite> PASS`, `MUT <id> KILLED|SURVIVED|TIMEOUT|NOT_APPLIED <note>`, `TALLY {...} RESTORED yes`.

## Mutant naming
- `G*`, `X*`: the spec groups and the checkpoint extras.
- `S*`, `M*`: items from the e7d310e2 review.
- `R*`: new code in 07235b1a (hold-class upgrade, no eager success write, lazy catch handle, page precedence, success link, `late-` gating, first code kept, header try/catch, every register and ingest post-stamp hold site).
- `P*`: payer and payment binding on hold reads and stamp-hold upgrades.

No network, prod or secrets are used. The runner never commits and never touches git state.
