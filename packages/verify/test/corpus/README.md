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
| Synthetic | 14 (25 case paths) | `synthetic.mjs`: `label`, `version`, `timing` and control cases, built fresh under a throwaway key on each run. |

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

## The rule

For each case and path (`cli`, `library`):

1. Never more permissive than `baseline.json`: exit rank
   VERIFIED > COULD_NOT_CHECK > INVALID, and every check
   pass > not decided > fail.
2. Exactly equal to `baseline.json` (exit, result, reason, checks), unless
   `changes.json` records the change with the PR and spec section. An entry
   may only make a result stricter.

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
`record-chain.mjs`: adds read-only JSON-RPC calls (an allowlist of read
methods) to public Base and Solana RPC hosts only, no keys and no paid
endpoints, never a transaction. It never writes the baseline. Recording replaces
the baseline. Do it only when the spec records a change, never to make a
failing corpus pass.
