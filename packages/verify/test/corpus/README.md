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
on the tape fails like a network error and is counted. Chain JSON-RPC is
not on this tape (recording is GET-only), so layer B and the anchor read as
could_not_check here.

## Chain tier

`tapes/public-chain.json` is the same GET entries plus read-only JSON-RPC
answers from public Base and Solana RPCs (`record-chain.mjs`), so layer B
and the anchor run offline and the reference receipt is exit 0.
`baseline-chain.json` is what 0.4.11 returns on that tape. The same rule
applies. Payment senders not already in `test/fixtures` are replaced with
a placeholder.

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

`scripts/corpus-gate.mjs` runs in its own job, `Corpus baseline gate`, and
`Verify package (Linux)` needs it and fails unless it passed. The gate job
runs no code from the change under review:

- `Corpus inputs (head)` (a separate job) builds the head tree and exports
  its synthetic case inputs as one JSON file (`corpus-gate.mjs export`):
  the case document, the covering test issuer history and the JWKS of each
  case. Only that file is passed on.
- `Corpus baseline gate` checks out the merge base as a worktree, builds
  only that tree, and runs the merge base's copy of the gate. It reads the
  head baseline, changes.json and registry pin as data, digests the head
  inputs itself, and runs the merge-base verifier on them.

It fails when:

- a `baseline.json` entry changed and no `changes.json` entry added in this
  change names it, or the new value is not that entry's `to`;
- a `tighten` entry (the default kind) is not at least as strict as the
  merge-base outcome;
- a `corpus_fix` entry (a synthetic case that was built wrong) is for a real
  receipt, has no note, moves a case to exit 0, does not carry the case's
  `input_digest` (the head digest, which must differ from the merge-base
  digest), or its `to` is not exactly the outcome (exit, result, reason,
  checks, overall) that the merge-base verifier gives on the head input.
  So a corpus_fix covers only an outcome the input change alone explains.
  A corpus_fix whose row does not move (an input change with the same
  outcome) gets the same checks;
- a `corpus_fix` row is not decided by the expectation pinned for that
  case and path in the merge-base `test/corpus/declarations.frozen.json`:
  the merge-base verifier on the head input must give exactly the pinned
  value as its `cause` (or `reason` when it has no cause). There is no
  substring match. The pin is read from the merge-base tree with `git
  show`, never from the head, so a PR cannot loosen it and use it in the
  same change;
- `synthetic.mjs` and `declarations.frozen.json` differ. Every `expect`
  value in `synthetic.mjs` must equal the pinned one for that case and path
  (a `deferred` entry, overridden by a later `declarations` entry), with
  none missing and none extra. The head pair is checked on every change. A
  change with a `corpus_fix`, a `corpus_fix_reason` or a removed baseline
  row is also refused while the merge-base pair differs, so a change that
  edits `synthetic.mjs` alone cannot be merged first and used after;
- `declarations.frozen.json` is removed or edited other than by appending.
  It has three append-only lists: `declarations` (the per-rule cause of a
  case path), `deferred` (a case path whose own rule is not reached yet;
  its expectation is pinned but a correction on it is refused until a
  declaration is appended) and `reason_allowed`. An appended declaration
  may not declare a path twice, and an appended `reason_allowed` entry may
  not name a declared or deferred path. The pin is a verifier path, so a
  pin change cannot carry a correction;
- a `corpus_fix_reason` entry is for a path not on the merge-base
  `reason_allowed` list. That list holds the rule-class case paths
  (version, gate, timing) that were never declared. On those paths a plain
  `corpus_fix` is refused and `corpus_fix_reason`, which keeps every other
  corpus_fix rule, marks the row for a closer review. If the merge-base pin
  or the head declarations cannot be read, the gate fails closed;
- a baseline row of a pinned case path is removed (`to: null`), or a
  pinned case path is removed from the baseline at all;
- a `corpus_fix` or `corpus_fix_reason` entry, or a removed baseline row
  (`to: null`) of an unpinned path, is in a change that also touches a verifier path. Under
  `packages/verify/` every path is a verifier path by default, except
  `test/**`, `*.md` and `LICENSE` (`.md`, `.txt`). Inside `test/`, the
  corpus runners and recorders (`test/corpus/lib.mjs`, `run-*.mjs`,
  `tape-*.mjs`, `record*.mjs`), the tapes (`test/corpus/tapes/`) and
  `test/history-file.mjs` and `test/corpus/declarations.frozen.json` count
  as verifier paths too. So do everything
  under `packages/aliases/chit402-verify/` except `*.md`, and any `dist/`
  output. Paths are compared after NFKC normalization and lowercasing, and
  any path with a non-ASCII or control character counts as a verifier
  path. The gate reads the changed paths from `git diff --name-only`
  against the merge base, as data. Land corpus corrections and verifier changes in
  separate PRs: the verifier change is then checked against corrected
  inputs that are already on main;
- a real receipt case is removed;
- `changes.json` or `test/fixtures/version-registry.frozen.json` is edited
  other than by appending (an appended registry entry needs a `registry`
  entry in `changes.json`).

The input digest covers the case document, the issuer history (every entry
with kid, validity window, status and custody; version and seq) and the
JWKS. Public key bytes, signatures and the hashes computed from them are
left out, since the test key is new on every run.

Local run (merge-base tree checked out and built at <base>, this tree
built):

    node scripts/corpus-gate.mjs export . > /tmp/head-inputs.json
    node scripts/corpus-gate.mjs --base origin/main --root ../.. \
      --base-tree <base>/packages/verify --head-inputs /tmp/head-inputs.json

Deferred: `version-v10-claims-signed-as-v6-after-window|library` and
`timing-l5-backdated-iat|library` declare `log_unreachable` today, which is
not their own rule (the offline tape has no chain RPC). They are pinned as
`deferred`. A change that makes them reach their rule appends a
declaration for them in the same change as the `synthetic.mjs` update.

Every RPC entry on a tape (public, and the local tier's when set) must be an
error entry, and every GET entry an https URL on an allowed host
(`tape-hosts.mjs`): the recorder is GET-only.

Synthetic cases carry a `target` from the spec. The PR that reaches it adds
the `changes.json` entry.

## Local tier

Holder documents from the 54-file inventory carry payer fields, so they stay
off the repo. With a recorded local tier:

    CHIT_CORPUS_PRIVATE_DIR=<dir> node --test test/golden-corpus.test.mjs

## Recording (local only)

    npm run build
    node test/corpus/record.mjs
    CHIT_CORPUS_RPC=1 node test/corpus/record-chain.mjs   # chain tier tape only

`record.mjs`: GET to the public receipt hosts only; nothing is posted.
Redirects are never followed: a 3xx is stored as an error entry and replays
as a failed read (`test/corpus-recorder.test.mjs` checks this against local
servers). `record-chain.mjs` writes the chain tier tape only: read-only
JSON-RPC calls (an allowlist of read methods) to public Base and Solana RPC
hosts, no keys and no paid endpoints, never a transaction, and never a
baseline or a file in the source private directory. Recording replaces
the baseline. Do it only when the spec records a change, never to make a
failing corpus pass.
