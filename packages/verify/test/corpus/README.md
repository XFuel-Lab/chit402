# Golden corpus

Never-worse corpus for chit402-verify (verifier redesign, step 1). It pins
what the CLI and the library return for every case today, offline, and fails
if a later change makes any result more permissive or changes it without a
recorded entry.

## What runs in CI

`test/golden-corpus.test.mjs`, part of `npm test`.

| Tier | Cases | Source |
|---|---|---|
| Receipt ids | 96 | 81 Base receipt ids, the reference receipts, the demo receipt, and the task ids of the 54-file inventory. Public receipt shells only. |
| Fixture files | 6 | Receipt files already in `test/fixtures`. |
| Synthetic | 21 (32 case paths) | `synthetic.mjs`: `label`, `version`, `timing`, `gate` and control cases, built fresh under a throwaway key on each run. |

Every child process loads `tape-preload.mjs`, which answers each fetch from
`tapes/public.json` and fixes the clock to the recording time. A request not
on the tape fails like a network error and is counted. Chain JSON-RPC was
not recorded (recording is GET-only), so layer B and the anchor read as
could_not_check here; exit 0 for a real receipt needs live chain reads and is
not part of the offline corpus.

Paths: `cli` (the CLI with production pins), `library` (verifyReceipt with
the test key and a covering test history whose pin the claims carry), and
`signature` (verifyIssuerSignature only, for the gate 8 detached cases).

## The rule

For each case and path:

1. Well formed: exit is 0, 1 or 2 (anything else, a crash included, fails),
   `--json` exit_code equals the process exit, and the result matches the
   exit (`verified` only with 0).
2. Never more permissive than `baseline.json`: exit rank
   VERIFIED > COULD_NOT_CHECK > INVALID, result rank the same, and every
   check pass > not decided > fail. Every check the baseline has must still
   be reported.
3. Exactly equal to `baseline.json` (exit, result, reason, checks), unless
   `changes.json` records the change with the PR and spec section.
4. Synthetic cases also assert what decided them (`LIBRARY_CAUSE` in
   `synthetic.mjs`, `expect` on the gate cases), so a case cannot pass for an
   unrelated reason.

Gate cases pin each version gate in `src/version-registry.ts`
(`FEATURE_FIRST_VERSION`: 8, 9, 10) on both sides of its boundary. Moving a
gate start by one version fails the corpus.

## Baseline gate (CI)

`scripts/corpus-gate.mjs` runs in the `Verify package (Linux)` job before
the tests, against the merge base, using the merge base's copy of the gate.
It fails when:

- a `baseline.json` entry changed and no `changes.json` entry added in this
  change names it, or the new value is not that entry's `to`;
- a `tighten` entry (the default kind) is not at least as strict as the
  merge-base outcome;
- a `corpus_fix` entry (a synthetic case that was built wrong) is for a real
  receipt, has no note, or moves a case to exit 0;
- a real receipt case is removed;
- `changes.json` or `test/fixtures/version-registry.frozen.json` is edited
  other than by appending (an appended registry entry needs a `registry`
  entry in `changes.json`).

So a verifier change plus a baseline edit cannot bless a looser result in
one PR. Local run: `node scripts/corpus-gate.mjs --base origin/main --root ../..`.

Synthetic cases carry a `target` from the spec. The PR that reaches it adds
the `changes.json` entry.

## Local tier

Holder documents from the 54-file inventory carry payer fields, so they stay
off the repo. With a recorded local tier:

    CHIT_CORPUS_PRIVATE_DIR=<dir> node --test test/golden-corpus.test.mjs

## Recording (local only)

    npm run build
    node test/corpus/record.mjs

GET to the public receipt hosts only; nothing is posted. Redirects are
never followed: a 3xx is stored as an error entry and replays as a failed
read (`test/corpus-recorder.test.mjs` checks this against local servers). Recording replaces
the baseline. Do it only when the spec records a change, never to make a
failing corpus pass.
